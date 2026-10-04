import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink, realpath, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { transaction } from '../db.js';
import { paramsSchema } from '../schemas/resources.js';
import { fail, getRecord, saveRecord, audit, checkVersion, decorate } from '../services/records.js';
async function safePath(root, key) {
  const base = await realpath(root);
  const candidate = path.resolve(base, key);
  if (!candidate.startsWith(base + path.sep)) throw fail(404, 'FILE_NOT_FOUND', 'File not found.');
  const actual = await realpath(candidate).catch(() => { throw fail(404, 'FILE_NOT_FOUND', 'File not found.'); });
  if (!actual.startsWith(base + path.sep)) throw fail(404, 'FILE_NOT_FOUND', 'File not found.');
  return actual;
}
async function imageType(file) {
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(12); const {bytesRead} = await handle.read(bytes, 0, 12, 0);
    if (bytesRead >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
    if (bytesRead >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytesRead === 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
    return null;
  } finally { await handle.close(); }
}
async function receive(app, request, avatar = false) {
  if (!request.isMultipart()) throw fail(415, 'MULTIPART_REQUIRED', 'Use multipart/form-data.');
  const fields = Object.create(null); let file;
  await mkdir(app.settings.uploadDir, { recursive: true });
  try {
    for await (const part of request.parts({ limits: { files: 1, fields: 6, parts: 7, fieldSize: 4096, fileSize: avatar ? app.settings.maxAvatar : app.settings.maxUpload } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') throw fail(400, 'INVALID_FIELD', 'Use the file field for the upload.');
        const key = randomUUID(), target = path.join(app.settings.uploadDir, key);
        file = { key, target, name: path.basename(part.filename || 'attachment').slice(0, 255), mime: 'application/octet-stream', size: 0 };
        part.file.on('data', chunk => { file.size += chunk.length; });
        await pipeline(part.file, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw fail(413, 'FILE_TOO_LARGE', 'File exceeds the upload limit.');
        if (file.size === 0) throw fail(400, 'EMPTY_FILE', 'Choose a non-empty file.');
        const detected = await imageType(target);
        if (detected) file.mime = detected;
        else if (avatar) throw fail(400, 'INVALID_AVATAR', 'Avatar must be a PNG, JPEG or WebP image.');
        else if (/\.(txt|md)$/i.test(file.name)) file.mime = 'text/plain';
        else if (/\.pdf$/i.test(file.name)) file.mime = 'application/pdf';
      } else {
        if (!['id', 'projectId', 'name', 'category', 'version', 'issueId'].includes(part.fieldname) || part.fieldname in fields || part.valueTruncated) throw fail(400, 'INVALID_FIELD', 'Invalid upload metadata.');
        fields[part.fieldname] = part.value;
      }
    }
    if (!file) throw fail(400, 'FILE_REQUIRED', 'Choose a file to upload.');
    if (fields.version !== undefined) {
      if (!/^[1-9][0-9]*$/.test(fields.version)) throw fail(400, 'INVALID_VERSION', 'Invalid version.');
      fields.version = Number(fields.version);
    }
    return { file, fields };
  } catch (error) { if (file) await unlink(file.target).catch(() => {}); throw error; }
}
export async function fileRoutes(app) {
  for (const replace of [false, true]) app.route({ method: replace ? 'PUT' : 'POST', url: replace ? '/api/documents/:id/file' : '/api/documents/upload', schema: { tags: ['documents'], consumes: ['multipart/form-data'], ...(replace ? { params: paramsSchema } : {}) }, handler: async (request, reply) => {
    const { file, fields } = await receive(app, request);
    try {
      const data = await transaction(app.db, async c => {
        const old = replace ? await getRecord(c, 'documents', request.params.id, { lock: true }) : null;
        if (fields.id && !/^[A-Za-z0-9_-]{1,64}$/.test(fields.id)) throw fail(400, 'INVALID_ID', 'Invalid document ID.');
        const meta = { ...(fields.id ? { id: fields.id } : {}), projectId: fields.projectId ?? old?.project_id, issueId: fields.issueId ?? old?.issue_id ?? null, name: fields.name ?? old?.name, category: fields.category ?? old?.category ?? 'Other', kind: 'file', content: null, ...(fields.version ? { version: fields.version } : {}) };
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(meta.projectId || '') || !meta.name?.trim() || meta.name.length > 160 || meta.category.length > 64) throw fail(400, 'VALIDATION_ERROR', 'Provide a valid projectId, name (1–160 characters), and category (up to 64 characters).');
        if(meta.issueId&&!/^[A-Za-z0-9_-]{1,64}$/.test(meta.issueId))throw fail(400,'INVALID_REFERENCE','Invalid ticket ID.');
        if(meta.issueId&&/\.(png|jpe?g|webp)$/i.test(file.name)&&!['image/png','image/jpeg','image/webp'].includes(file.mime))throw fail(400,'INVALID_TICKET_IMAGE','The image contents do not match a supported image format.');
        return saveRecord(c, request, 'documents', meta, { id: old?.id, file: { storage_key: file.key, original_name: file.name, mime_type: file.mime, size_bytes: file.size } });
      });
      return reply.code(replace ? 200 : 201).send({ data });
    } catch (error) { await unlink(file.target).catch(() => {}); throw error; }
  } });
  app.get('/api/documents/:id/preview', { schema: { tags: ['documents'], params: paramsSchema } }, async (request, reply) => {
    const row = await getRecord(app.db, 'documents', request.params.id);
    if (row.kind !== 'file' || !row.storage_key) throw fail(415, 'NOT_AN_IMAGE', 'This document has no image preview.');
    const file = await safePath(app.settings.uploadDir, row.storage_key);
    const mime = await imageType(file);
    if (!mime) throw fail(415, 'NOT_AN_IMAGE', 'Only PNG, JPEG and WebP images can be previewed.');
    return reply.type(mime).header('content-disposition', 'inline').header('cache-control', 'private, no-store').send(createReadStream(file));
  });
  app.get('/api/documents/:id/download', { schema: { tags: ['documents'], params: paramsSchema } }, async (request, reply) => {
    const row = await getRecord(app.db, 'documents', request.params.id);
    const filename = row.kind === 'file' ? row.original_name : row.name + '.txt';
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`);
    reply.header('cache-control', 'private, no-store');
    if (row.kind === 'note') return reply.type('text/plain; charset=utf-8').send(row.content || '');
    const file = await safePath(app.settings.uploadDir, row.storage_key);
    return reply.type('application/octet-stream').send(createReadStream(file));
  });
  app.put('/api/members/:id/avatar', { schema: { tags: ['members'], params: paramsSchema, consumes: ['multipart/form-data'] } }, async request => {
    const { file, fields } = await receive(app, request, true);
    try {
      const data = await transaction(app.db, async c => {
        const row = await getRecord(c, 'members', request.params.id, { lock: true }); checkVersion(fields, row);
        await c.execute('UPDATE members SET avatar_storage_key=?,avatar_mime=?,version=version+1 WHERE id=?', [file.key, file.mime, row.id]);
        await audit(c, request, 'members', row, 'avatar_updated');
        return (await decorate(c, 'members', [await getRecord(c, 'members', row.id)]))[0];
      }); return { data };
    } catch (error) { await unlink(file.target).catch(() => {}); throw error; }
  });
  app.get('/api/members/:id/avatar', { schema: { tags: ['members'], params: paramsSchema } }, async (request, reply) => {
    const row = await getRecord(app.db, 'members', request.params.id);
    if (!row.avatar_storage_key) throw fail(404, 'FILE_NOT_FOUND', 'No avatar uploaded.');
    const file = await safePath(app.settings.uploadDir, row.avatar_storage_key);
    return reply.type(row.avatar_mime).header('cache-control', 'private, no-store').send(createReadStream(file));
  });
  app.delete('/api/members/:id/avatar', { schema: { tags: ['members'], params: paramsSchema } }, async (request, reply) => {
    await transaction(app.db, async c => {
      const row = await getRecord(c, 'members', request.params.id, { lock: true });
      await c.execute('UPDATE members SET avatar_storage_key=NULL,avatar_mime=NULL,version=version+1 WHERE id=?', [row.id]);
      await audit(c, request, 'members', row, 'avatar_removed');
    }); return reply.code(204).send();
  });
}
