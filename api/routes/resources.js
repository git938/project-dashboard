import { resources, bodySchema, querySchema, paramsSchema, responseSchema } from '../schemas/resources.js';
import { transaction } from '../db.js';
import { getRecord, decorate, saveRecord, audit, checkVersion, snake, fail, serialize } from '../services/records.js';
export async function resourceRoutes(app) {
  for (const type of [...Object.keys(resources), 'activity']) {
    app.get(`/api/${type}`, { schema: { tags: [type], querystring: querySchema(type), response: { 200: responseSchema(type, true) } } }, async request => {
      const q = request.query, where = [], params = [];
      if (type !== 'activity') where.push(`deleted_at IS ${q.trashed ? 'NOT ' : ''}NULL`);
      for (const key of ['projectId', 'status', 'assigneeId', 'teamId', 'type', 'category', 'cancelled', 'kind', 'priority']) if (q[key] !== undefined) { where.push(`${snake(key)}=?`); params.push(q[key]); }
      if (q.q) { where.push(`${type === 'events' ? 'title' : type === 'activity' ? 'summary' : 'name'} LIKE ?`); params.push(`%${q.q}%`); }
      if (type === 'events') {
        if (q.from && q.to && q.from > q.to) throw fail(400, 'INVALID_DATES', 'from must not be after to.');
        if (q.from) { where.push('((all_day=1 AND end_date>=?) OR (all_day=0 AND end_at>=?))'); params.push(q.from, q.from + ' 00:00:00'); }
        if (q.to) { where.push('((all_day=1 AND start_date<=?) OR (all_day=0 AND start_at<DATE_ADD(?, INTERVAL 1 DAY)))'); params.push(q.to, q.to); }
      }
      const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const direction = q.sortOrder.toUpperCase(), sort = snake(q.sortBy);
      return transaction(app.db, async connection => {
        const [count] = await connection.execute(`SELECT COUNT(*) AS total FROM ${type}${clause}`, params);
        const [rows] = await connection.query(`SELECT * FROM ${type}${clause} ORDER BY ${sort} ${direction},id ${direction} LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
        return { data: type === 'activity' ? rows.map(serialize) : await decorate(connection, type, rows), pagination: { page: q.page, pageSize: q.pageSize, total: Number(count[0].total) } };
      });
    });
    if (type === 'activity') continue;
    app.get(`/api/${type}/:id`, { schema: { tags: [type], params: paramsSchema, response: { 200: responseSchema(type) } } }, async request => {
      const row = await getRecord(app.db, type, request.params.id);
      return { data: (await decorate(app.db, type, [row]))[0] };
    });
    app.post(`/api/${type}`, { schema: { tags: [type], body: bodySchema(type, false, true), response: { 201: responseSchema(type) } } }, async (request, reply) => {
      const data = await transaction(app.db, c => saveRecord(c, request, type, request.body));
      return reply.code(201).send({ data });
    });
    for (const method of ['PUT', 'PATCH']) app.route({ method, url: `/api/${type}/:id`, schema: { tags: [type], params: paramsSchema, body: bodySchema(type, method === 'PATCH'), response: { 200: responseSchema(type) } }, handler: async request => {
      const data = await transaction(app.db, c => saveRecord(c, request, type, request.body, { id: request.params.id, replace: method === 'PUT' }));
      return { data };
    } });
    app.delete(`/api/${type}/:id`, { schema: { tags: [type], params: paramsSchema, querystring: { type: 'object', additionalProperties: false, properties: { version: { type: 'integer', minimum: 1 } } } } }, async (request, reply) => {
      await transaction(app.db, async c => {
        const row = await getRecord(c, type, request.params.id, { lock: true });
        checkVersion(request.query, row);
        // Do not strand active children. Archiving a project is available via its status field.
        if (type === 'projects') for (const child of ['issues', 'milestones', 'notes', 'documents', 'events']) {
          const [rows] = await c.execute(`SELECT id FROM ${child} WHERE project_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [row.id]);
          if (rows.length) throw fail(409, 'PROJECT_NOT_EMPTY', 'Archive this project, or remove its active records before deleting it.');
        }
        if (type === 'teams') {
          const [rows] = await c.execute('SELECT id FROM projects WHERE team_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [row.id]);
          if (rows.length) throw fail(409, 'TEAM_IN_USE', 'Reassign projects before deleting this team.');
        }
        if (type === 'members') {
          for (const [table, field] of [['projects', 'manager_id'], ['issues', 'assignee_id'], ['notes', 'owner_id']]) {
            const [rows] = await c.execute(`SELECT id FROM ${table} WHERE ${field}=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [row.id]);
            if (rows.length) throw fail(409, 'MEMBER_IN_USE', 'Reassign this member’s records, or set active=false.');
          }
          for (const table of ['team_members', 'project_members', 'event_attendees']) await c.execute(`DELETE FROM ${table} WHERE member_id=?`, [row.id]);
        }
        await c.execute(`UPDATE ${type} SET deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=?`, [row.id]);
        await audit(c, request, type, row, 'deleted');
      });
      return reply.code(204).send();
    });
  }
  app.post('/api/documents/:id/restore', { schema: { tags: ['documents'], params: paramsSchema } }, async request => {
    const data = await transaction(app.db, async c => {
      const row = await getRecord(c, 'documents', request.params.id, { deleted: true, lock: true });
      if (row.deleted_at) {
        await getRecord(c, 'projects', row.project_id, { lock: true });
        await c.execute('UPDATE documents SET deleted_at=NULL,version=version+1 WHERE id=?', [row.id]);
        await audit(c, request, 'documents', row, 'restored');
      }
      return (await decorate(c, 'documents', [await getRecord(c, 'documents', row.id)]))[0];
    });
    return { data };
  });
}
