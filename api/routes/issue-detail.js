import { transaction } from '../db.js';
import { getRecord, decorate, serialize, fail } from '../services/records.js';

// Aggregate payload for the ProjectHub-style ticket editor panel.
export async function issueDetailRoutes(app) {
  app.get('/api/issues/:id/detail', { schema: { tags: ['issues'], params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } } } }, async request => {
    const lookup = request.params.id;
    return transaction(app.db, async c => {
      // Resolve by id or by TICKET-KEY (e.g. TKE-7).
      let issue;
      const [byKey] = await c.execute("SELECT issues.id FROM issues JOIN projects ON projects.id=issues.project_id WHERE CONCAT(projects.project_key,'-',issues.ticket_number)=? AND issues.deleted_at IS NULL", [lookup]);
      issue = await getRecord(c, 'issues', byKey.length ? byKey[0].id : lookup);

      const [decorated] = await decorate(c, 'issues', [issue]);
      const [[project]] = await c.execute('SELECT id, name, project_key FROM projects WHERE id=?', [issue.project_id]);
      const [[assigneeRow]] = issue.assignee_id ? await c.execute('SELECT id, name, role, avatar_storage_key, version FROM members WHERE id=?', [issue.assignee_id]) : [[null]];
      const assignee = assigneeRow ? serialize(assigneeRow) : null;

      // Labels (full objects) via issue_labels.
      const [labels] = await c.query('SELECT l.id,l.name,l.color FROM issue_labels il JOIN labels l ON l.id=il.label_id WHERE il.issue_id=? AND l.deleted_at IS NULL ORDER BY l.name', [issue.id]);

      // Comments with author.
      const [comments] = await c.query('SELECT c.id,c.body,c.author_id,c.created_at,c.updated_at,c.version,m.name AS author_name,m.avatar_storage_key,m.version AS author_version FROM comments c LEFT JOIN members m ON m.id=c.author_id WHERE c.issue_id=? AND c.deleted_at IS NULL ORDER BY c.created_at ASC,c.id ASC', [issue.id]);

      // Attachments (documents bound to this issue).
      const [docs] = await c.query('SELECT id,name,category,kind,original_name,mime_type,size_bytes,created_at,version FROM documents WHERE issue_id=? AND deleted_at IS NULL ORDER BY created_at DESC', [issue.id]);
      const attachments = docs.map(d => ({ ...serialize(d), downloadUrl: d.kind === 'file' ? `/api/documents/${d.id}/download` : null }));

      // Time tracking.
      const [[timeAgg]] = await c.execute('SELECT COUNT(*) AS entries, COALESCE(SUM(minutes),0) AS logged FROM time_entries WHERE issue_id=? AND deleted_at IS NULL', [issue.id]);
      const [timeEntries] = await c.query('SELECT t.id,t.minutes,t.spent_on,t.note,t.member_id,m.name AS member_name FROM time_entries t LEFT JOIN members m ON m.id=t.member_id WHERE t.issue_id=? AND t.deleted_at IS NULL ORDER BY t.spent_on DESC,t.id DESC', [issue.id]);

      // Links: parent + related.
      const [links] = await c.query(`SELECT il.kind, i.id, i.name, i.status, i.kind AS ticket_kind, p.project_key, i.ticket_number
        FROM issue_links il
        JOIN issues i ON i.id = IF(il.from_issue_id=?, il.to_issue_id, il.from_issue_id)
        JOIN projects p ON p.id=i.project_id
        WHERE (il.from_issue_id=? OR il.to_issue_id=?) AND il.deleted_at IS NULL AND i.deleted_at IS NULL`, [issue.id, issue.id, issue.id]);
      const linkOf = kind => links.filter(l => l.kind === kind).map(l => ({ id: l.id, ticketKey: `${l.project_key}-${l.ticket_number}`, name: l.name, status: l.status, kind: l.ticket_kind }));

      // Status history from activity summaries (best-effort) + member task history.
      const [activity] = await c.query("SELECT id,actor,action,summary,created_at FROM activity WHERE entity_type='issues' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 50", [issue.id]);

      return {
        data: {
          ...decorated,
          project: project ? { id: project.id, name: project.name, projectKey: project.project_key } : null,
          assignee,
          labels,
          comments: comments.map(x => ({ id: x.id, body: x.body, createdAt: x.created_at, updatedAt: x.updated_at, version: x.version, author: x.author_id ? { id: x.author_id, name: x.author_name, avatarUrl: x.avatar_storage_key ? `/api/members/${x.author_id}/avatar?v=${x.author_version}` : null } : null })),
          attachments,
          timeTracking: { estimateMinutes: issue.estimate_minutes === null || issue.estimate_minutes === undefined ? null : Number(issue.estimate_minutes), loggedMinutes: Number(timeAgg.logged), entries: Number(timeAgg.entries), entriesList: timeEntries.map(t => ({ id: t.id, minutes: t.minutes, spentOn: t.spent_on, note: t.note, memberId: t.member_id, memberName: t.member_name })) },
          links: { parent: linkOf('parent'), related: linkOf('related') },
          activity: activity.map(a => serialize(a)),
          counts: { comments: comments.length, attachments: attachments.length, activity: activity.length }
        }
      };
    });
  });
}
