export const id = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const text = (max = 160) => ({ type: 'string', maxLength: max });
const name = { ...text(), minLength: 1, pattern: '\\S' };
const nullable = s => ({ ...s, type: [s.type, 'null'] });
const ref = nullable(id);
const date = { type: 'string', format: 'date' };
const timestamp = nullable({ type: 'string', format: 'date-time' });
const ids = { type: 'array', maxItems: 200, uniqueItems: true, items: id };
const color = { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' };
const bool = { type: 'boolean' };
const enumeration = values => ({ type: 'string', enum: values });
const resource = (fields, required, defaults, relations = {}) => ({ fields, required, defaults, relations });
export const resources = {
  projects: resource({ name, description: nullable(text(50000)), status: enumeration(['Active', 'On hold', 'Completed', 'Archived']), managerId: ref, teamId: ref, startDate: date, endDate: date, color, memberIds: ids }, ['name', 'startDate', 'endDate'], { description: null, status: 'Active', managerId: null, teamId: null, color: '#aaa0ce', memberIds: [] }, { memberIds: ['project_members', 'project_id', 'member_id', 'members'] }),
  issues: resource({ projectId: id, name, description: nullable(text(50000)), phase: enumeration(['Discovery', 'Design', 'Development', 'Launch']), status: enumeration(['Backlog', 'Todo', 'In Progress', 'Review', 'Done']), assigneeId: ref, startDate: date, endDate: date, sortOrder: { type: 'integer', minimum: 0, maximum: 1000000 } }, ['projectId', 'name', 'startDate', 'endDate'], { description: null, phase: 'Development', status: 'Todo', assigneeId: null, sortOrder: 0 }),
  milestones: resource({ projectId: id, name, date, status: enumeration(['Planned', 'Completed']) }, ['projectId', 'name', 'date'], { status: 'Planned' }),
  notes: resource({ projectId: ref, ownerId: ref, name, content: text(500000), tag: text(64) }, ['name', 'content'], { projectId: null, ownerId: null, tag: '' }),
  teams: resource({ name, description: nullable(text(50000)), memberIds: ids }, ['name'], { description: null, memberIds: [] }, { memberIds: ['team_members', 'team_id', 'member_id', 'members'] }),
  members: resource({ name, role: text(), email: nullable({ type: 'string', format: 'email', maxLength: 254 }), active: bool, color }, ['name'], { role: '', email: null, active: true, color: '#e7e2f3' }),
  documents: resource({ projectId: id, name, category: text(64), kind: enumeration(['note', 'file']), content: nullable(text(500000)) }, ['projectId', 'name', 'kind'], { category: 'Other', content: null }),
  events: resource({ projectId: id, title: name, type: enumeration(['Release', 'Meeting', 'Milestone', 'Other']), description: nullable(text(50000)), location: text(2048), allDay: bool, startAt: timestamp, endAt: timestamp, startDate: nullable(date), endDate: nullable(date), timezone: text(64), cancelled: bool, attendeeIds: ids }, ['projectId', 'title', 'type', 'allDay'], { description: null, location: '', startAt: null, endAt: null, startDate: null, endDate: null, timezone: 'Asia/Tokyo', cancelled: false, attendeeIds: [] }, { attendeeIds: ['event_attendees', 'event_id', 'member_id', 'members'] })
};
export const paramsSchema = { type: 'object', additionalProperties: false, required: ['id'], properties: { id } };
export function bodySchema(type, partial = false, create = false) {
  return { type: 'object', additionalProperties: false, minProperties: 1, required: partial ? [] : resources[type].required, properties: { ...resources[type].fields, ...(create ? { id } : {}), version: { type: 'integer', minimum: 1 } } };
}
export function querySchema(type) {
  const props = { page: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, q: text(160), sortOrder: { ...enumeration(['asc', 'desc']), default: 'desc' }, sortBy: { ...enumeration(type === 'activity' ? ['createdAt', 'id'] : ['createdAt', 'updatedAt', 'id', ...(type === 'events' ? ['title', 'startAt', 'startDate'] : ['name']), ...(type === 'issues' ? ['sortOrder'] : [])]), default: 'createdAt' } };
  const f = resources[type]?.fields || { projectId: id };
  for (const key of ['projectId', 'status', 'assigneeId', 'teamId', 'type', 'category']) if (f[key]) props[key] = { ...f[key], type: 'string' };
  if (type === 'documents') props.trashed = { type: 'boolean', default: false };
  if (type === 'events') Object.assign(props, { from: date, to: date, cancelled: bool });
  return { type: 'object', additionalProperties: false, properties: props };
}
export const errorSchema = { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, fields: { type: 'array', items: { type: 'object', additionalProperties: true } } } } } };
export function recordSchema(type) {
  const fields = type === 'activity' ? {
    id: { type: ['integer','string'] }, projectId: ref, actor: text(), action: text(), entityType: text(), entityId: text(), summary: text(500), metadata: { type: ['object','null'], additionalProperties: true }
  } : { ...resources[type].fields, id, version: { type: 'integer' }, updatedAt: timestamp, deletedAt: timestamp };
  if (type === 'members') fields.avatarUrl = nullable(text(2048));
  if (type === 'documents') Object.assign(fields, { originalName: nullable(text(255)), mimeType: nullable(text(255)), sizeBytes: { type: ['integer','string','null'] }, downloadUrl: nullable(text(2048)) });
  return { type: 'object', additionalProperties: true, properties: { ...fields, createdAt: timestamp } };
}
export function responseSchema(type, list = false) {
  return { type: 'object', required: list ? ['data','pagination'] : ['data'], properties: {
    data: list ? { type: 'array', items: recordSchema(type) } : recordSchema(type),
    ...(list ? { pagination: { type: 'object', required: ['page','pageSize','total'], properties: { page: {type:'integer'}, pageSize: {type:'integer'}, total: {type:'integer'} } } } : {})
  } };
}
