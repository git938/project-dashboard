import { randomUUID } from 'node:crypto';
import { resources } from '../schemas/resources.js';
export const snake = value => value.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const camel = value => value.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function fail(status, code, message) { return Object.assign(new Error(message), { statusCode: status, code }); }
export function serialize(row) {
  const out = {};
  for (let [key, value] of Object.entries(row)) {
    if (['storage_key', 'avatar_storage_key', 'avatar_mime', 'next_ticket_number'].includes(key)) continue;
    const field = camel(key);
    if(field==='ticketTypes'&&typeof value==='string')value=JSON.parse(value);
    if (['active', 'allDay', 'cancelled'].includes(field)) value = Boolean(value);
    if (value && ['createdAt', 'updatedAt', 'deletedAt', 'startAt', 'endAt'].includes(field)) value = new Date(value.replace(' ', 'T') + 'Z').toISOString();
    out[field] = value;
  }
  if (row.avatar_storage_key) out.avatarUrl = `/api/members/${row.id}/avatar?v=${row.version}`;
  else if ('avatar_storage_key' in row) out.avatarUrl = null;
  if (row.kind === 'file') out.downloadUrl = `/api/documents/${row.id}/download`;
  return out;
}
export async function getRecord(connection, type, id, { deleted = false, lock = false } = {}) {
  const [rows] = await connection.execute(`SELECT * FROM ${type} WHERE id=?${deleted ? '' : ' AND deleted_at IS NULL'}${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw fail(404, 'NOT_FOUND', 'Record not found.');
  return rows[0];
}
export async function decorate(connection, type, rows) {
  const results = rows.map(serialize);
  if(type==='issues'&&rows.length){const [projects]=await connection.query('SELECT id,project_key FROM projects WHERE id IN (?)',[rows.map(r=>r.project_id)]);for(const row of results)row.ticketKey=projects.find(p=>p.id===row.projectId)?.project_key+'-'+row.ticketNumber;}

  for (const [key, [table, owner, column]] of Object.entries(resources[type]?.relations || {})) {
    if (!rows.length) break;
    const [links] = await connection.query(`SELECT ${owner}, ${column} FROM ${table} WHERE ${owner} IN (?) ORDER BY ${column}`, [rows.map(r => r.id)]);
    for (const row of results) row[key] = links.filter(l => l[owner] === row.id).map(l => l[column]);
  }
  return results;
}
export async function audit(connection, request, type, row, action, before = null) {
  const actor = String(request.headers['x-authenticated-user'] || 'local').slice(0, 160);
  const project = type === 'projects' ? row.id : row.project_id || null;
  if(type==='issues'){
    const [[projectRow]]=await connection.execute('SELECT project_key,name FROM projects WHERE id=?',[row.project_id]);
    const record=async(memberId,event,snapshot)=>{if(!memberId)return;await connection.execute('INSERT INTO member_task_history(member_id,issue_id,ticket_key,task_name,project_name,kind,status,previous_status,event) VALUES (?,?,?,?,?,?,?,?,?)',[memberId,row.id,projectRow.project_key+'-'+row.ticket_number,row.name,projectRow.name,row.kind,snapshot.status,before?.status||null,event])};
    if(action==='deleted')await record(row.assignee_id,'deleted',row);
    else if(!before||before.assignee_id!==row.assignee_id){
      if(before?.assignee_id)await record(before.assignee_id,'unassigned',before);
      await record(row.assignee_id,'assigned',row);
    }else await record(row.assignee_id,before.status!==row.status?'status_changed':'updated',row);
  }

  await connection.execute('INSERT INTO activity (project_id,actor,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)', [project, actor, action, type, row.id, `${action}: ${row.name || row.title || row.id}`.slice(0, 500)]);
}
export function checkVersion(body, row) {
  if (body.version !== undefined && body.version !== row.version) throw fail(409, 'VERSION_CONFLICT', 'This record changed. Reload before saving again.');
}
export async function validateRecord(connection, type, values) {
  if (values.name !== undefined) values.name = values.name.trim();
  if (values.title !== undefined) values.title = values.title.trim();
  if (values.endDate && values.startDate && values.endDate < values.startDate) throw fail(400, 'INVALID_DATES', 'End date must not be before start date.');
  if (type === 'events') {
    try { new Intl.DateTimeFormat('en', { timeZone: values.timezone }); } catch { throw fail(400, 'INVALID_TIMEZONE', 'Use an IANA timezone such as Asia/Tokyo.'); }
    if (values.allDay) {
      if (!values.startDate || !values.endDate || values.startAt || values.endAt) throw fail(400, 'INVALID_DATES', 'All-day events require startDate/endDate and null startAt/endAt.');
    } else {
      if (!values.startAt || !values.endAt || values.startDate || values.endDate || Date.parse(values.endAt) <= Date.parse(values.startAt)) throw fail(400, 'INVALID_DATES', 'Timed events require increasing startAt/endAt and null startDate/endDate.');
    }
  }
  if (type === 'documents' && values.issueId) {
    const [rows] = await connection.execute('SELECT project_id FROM issues WHERE id=? AND deleted_at IS NULL FOR SHARE', [values.issueId]);
    if (!rows.length || rows[0].project_id !== values.projectId) throw fail(400, 'INVALID_REFERENCE', 'The ticket must belong to the selected project.');
  }
  const refs = { projectId: 'projects', managerId: 'members', teamId: 'teams', assigneeId: 'members', ownerId: 'members' };
  for (const [key, table] of Object.entries(refs)) if (values[key]) {
    const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE id=? AND deleted_at IS NULL FOR SHARE`, [values[key]]);
    if (!rows.length) throw fail(400, 'INVALID_REFERENCE', `${key} does not refer to an active record.`);
  }
  for (const [key, relation] of Object.entries(resources[type].relations)) if (values[key]) {
    for (const member of values[key]) {
      const [rows] = await connection.execute(`SELECT id FROM ${relation[3]} WHERE id=? AND deleted_at IS NULL FOR SHARE`, [member]);
      if (!rows.length) throw fail(400, 'INVALID_REFERENCE', `Invalid member in ${key}.`);
    }
  }
}
export async function saveRecord(connection, request, type, body, { id, replace = false, file = null } = {}) {
  const spec = resources[type];
  const old = id ? await getRecord(connection, type, id, { lock: true }) : null;
  if (old) checkVersion(body, old);
  const [previous] = old ? await decorate(connection, type, [old]) : [{}];
  const values = { ...(old && !replace ? previous : spec.defaults), ...body };
  let ticketProject;
  if(type==='projects'){
    values.projectKey=values.projectKey||old?.project_key||('P'+randomUUID().replaceAll('-','').slice(0,10).toUpperCase());
    values.ticketTypes=(values.ticketTypes||previous.ticketTypes||['Task','Bug','Subtask']).map(t=>t.trim());
    if(new Set(values.ticketTypes.map(t=>t.toLowerCase())).size!==values.ticketTypes.length)throw fail(400,'DUPLICATE_TYPES','Ticket type names must be unique.');
    if(old){
      const [used]=await connection.execute('SELECT DISTINCT kind FROM issues WHERE project_id=?',[old.id]);
      if(used.length&&values.projectKey!==old.project_key)throw fail(409,'KEY_IN_USE','Project keys cannot change after tickets have been created.');
      if(used.some(t=>!values.ticketTypes.includes(t.kind)))throw fail(409,'TYPE_IN_USE','Reassign tickets before renaming or removing their type.');
    }
  }
  if(type==='issues'){
    if(old&&old.project_id!==values.projectId)throw fail(409,'PROJECT_LOCKED','Numbered tickets stay in their original project.');
    ticketProject=await getRecord(connection,'projects',values.projectId,{lock:true});
    const types=typeof ticketProject.ticket_types==='string'?JSON.parse(ticketProject.ticket_types):ticketProject.ticket_types;
    if(!types.includes(values.kind))throw fail(400,'INVALID_TICKET_TYPE','Choose a ticket type configured for this project.');
  }
  await validateRecord(connection, type, values);
  if (type === 'issues' && old && old.project_id !== values.projectId) {
    const [attachments] = await connection.execute('SELECT id FROM documents WHERE issue_id=? LIMIT 1 FOR UPDATE', [old.id]);
    if (attachments.length) throw fail(409, 'ATTACHED_IMAGES', 'Tickets with attachments must stay in their current project.');
  }

  if (type === 'documents') {
    if (values.kind === 'file' && !file && (!old || old.kind !== 'file')) throw fail(400, 'FILE_REQUIRED', 'Use the upload endpoint to create a file document.');
    if (values.kind === 'file') values.content = null;
  }
  const columns = {};
  for (const key of Object.keys(spec.fields)) if (!(key in spec.relations) && values[key] !== undefined) {
    let value = values[key];
    if (value && ['startAt', 'endAt'].includes(key)) value = new Date(value).toISOString().slice(0, 23).replace('T', ' ');
    columns[snake(key)] = key==='ticketTypes'?JSON.stringify(value):value;
  }
  if(type==='issues'&&!old){columns.ticket_number=ticketProject.next_ticket_number;await connection.execute('UPDATE projects SET next_ticket_number=next_ticket_number+1 WHERE id=?',[values.projectId]);}
  if (file) Object.assign(columns, file);
  if (type === 'documents' && values.kind === 'note') Object.assign(columns, { storage_key: null, original_name: null, mime_type: null, size_bytes: null });
  const recordId = id || body.id || randomUUID();
  if (old) {
    await connection.execute(`UPDATE ${type} SET ${Object.keys(columns).map(k => `${k}=?`).join(',')}, version=version+1 WHERE id=?`, [...Object.values(columns), recordId]);
  } else {
    await connection.execute(`INSERT INTO ${type} (id,${Object.keys(columns).join(',')}) VALUES (${Array(Object.keys(columns).length + 1).fill('?').join(',')})`, [recordId, ...Object.values(columns)]);
  }
  for (const [key, [table, owner, column]] of Object.entries(spec.relations)) if (values[key] !== undefined) {
    await connection.execute(`DELETE FROM ${table} WHERE ${owner}=?`, [recordId]);
    for (const member of values[key]) await connection.execute(`INSERT INTO ${table} (${owner},${column}) VALUES (?,?)`, [recordId, member]);
  }
  const row = await getRecord(connection, type, recordId);
  await audit(connection, request, type, row, old ? 'updated' : 'created', old);
  const [result] = await decorate(connection, type, [row]);
  return result;
}
