import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import serveStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import path from 'node:path';
import { config, root } from './config.js';
import { createPool } from './db.js';
import { resourceRoutes } from './routes/resources.js';
import { fileRoutes } from './routes/files.js';
import { fail } from './services/records.js';
export async function buildApp({ pool, settings = config, logger = true } = {}) {
  const app = Fastify({ logger: logger ? { level: settings.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] } : false, bodyLimit: 1048576, trustProxy: '127.0.0.1', ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true } } });
  app.decorate('settings', settings); app.decorate('db', pool || createPool());
  app.addHook('onClose', async () => { if (!pool) await app.db.end(); });
  await app.register(swagger, { openapi: { info: { title: 'Project Workspace API', version: '1.0.0' }, servers: [{ url: '/' }], components: { securitySchemes: { basicAuth: { type: 'http', scheme: 'basic', description: 'Nginx enforces Basic Auth in production.' } } }, security: [{ basicAuth: [] }] } });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'self'"], upgradeInsecureRequests: null } } });
  await app.register(multipart, { limits: { files: 1, fileSize: settings.maxUpload, fields: 6, parts: 7 } });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.headers.origin) {
      const expected = `${request.protocol}://${request.host}`;
      if (request.headers.origin !== expected) throw fail(403, 'ORIGIN_REJECTED', 'Cross-origin writes are not allowed.');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    let status = error.statusCode || 500, code = error.code || 'INTERNAL_ERROR', message = error.message;
    if (error.validation) { status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid request data.'; }
    if (['ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW', 'ER_CHECK_CONSTRAINT_VIOLATED', 'ER_BAD_NULL_ERROR', 'ER_DATA_TOO_LONG', 'ER_TRUNCATED_WRONG_VALUE'].includes(error.code)) { status = 400; code = 'INVALID_DATA'; message = 'Invalid field value or relationship.'; }
    if (error.code === 'ER_DUP_ENTRY') { status = 409; code = 'CONFLICT'; message = 'This record already exists.'; }
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) { status = 409; code = 'RETRY_TRANSACTION'; message = 'Another change is in progress. Please retry.'; }
    if (status >= 500) { request.log.error({ err: error }, 'Request failed'); message = 'The service could not complete this request.'; code = 'SERVICE_ERROR'; }
    reply.code(status).send({ error: { code, message, ...(error.validation ? { fields: error.validation.map(v => ({ path: v.instancePath, message: v.message })) } : {}) } });
  });
  app.get('/api/health', { schema: { tags: ['operations'] } }, async () => ({ status: 'ok' }));
  app.get('/api/ready', { schema: { tags: ['operations'] } }, async (req, reply) => {
    try { await app.db.query('SELECT version,kind,priority FROM issues LIMIT 0'); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'not_ready' }); }
  });
  await app.register(resourceRoutes);
  await app.register(fileRoutes);
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.register(serveStatic, { root: path.join(root, 'dist'), dotfiles: 'deny', maxAge: 0, etag: true });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  return app;
}
