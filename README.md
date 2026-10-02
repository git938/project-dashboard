# Project Dashboard

Local-first development of a shared MySQL-backed project workspace: projects, WBS, Kanban, Gantt, issues, milestones, notes, teams, members, avatars, documents and event calendar.

## Runtime

Node.js 24, Fastify 5, MySQL 8.0, Nginx and systemd on the VPS. No Redis, queue or scheduled jobs. Fastify serves both `dist/` and `/api/` on **127.0.0.1:3100**. Pino logs go to stdout/journald. Production authentication is Nginx Basic Auth over HTTPS; there is no application login, registration or per-user authorization. All authenticated users share the workspace.

## Install and initialize

From the repository root:

```sh
cp .env.example .env
# Adjust .env for this machine; never commit it.
npm ci --prefix api
npm run db:migrate --prefix api
# Optional demo records and sample attachment; do not use for importing real data:
CONFIRM_DEMO_SEED=yes npm run db:seed --prefix api
npm start --prefix api
```

Open http://127.0.0.1:3100. The old Python server on port 8765 cannot serve the backend. Set a writable local `UPLOAD_DIR` when developing on Mac (for example `.local/uploads`). Database `projects` and the configured MySQL account must exist. The requested example database credentials are `admin` / `admin`; configure the actual deployment credentials in the ignored `.env`.

`db/schema.sql` defines the initial schema. Prefer `db:migrate`, which initializes an empty database and applies the version migration. If importing `schema.sql` manually, run `db:migrate` afterwards too. Migrations are recorded in `schema_migrations`; seed is separate and preserves existing demo IDs. Back up before migrations.

## VPS deployment for Claude

1. Install Node.js 24 with `/usr/bin/node`, MySQL 8.0 and Nginx. Check out this repository to `/opt/project-dashboard`.
2. Create a system account `project-dashboard` with no login shell. Copy `.env.example` to `.env`, adjust credentials and keep the file readable only by root and the service group (0640).
3. Give the service account ownership of `/var/lib/project-dashboard/uploads`. Directory mode 0755 alone does not give a different service user write access.
4. Run the install/migration commands above. Load demo data only if wanted. If seeding as root, then restore service ownership of uploaded files.
5. Copy `deploy/project-dashboard.service` to `/etc/systemd/system/`. Run `systemctl daemon-reload`, then `systemctl enable --now project-dashboard`.
6. Check `curl http://127.0.0.1:3100/api/ready` and `journalctl -u project-dashboard`.
7. Adapt `deploy/nginx.conf.example` with the real domain and certificate paths. Create the Basic Auth password file (`htpasswd -c /etc/nginx/project-dashboard.htpasswd admin`), then validate with `nginx -t` and reload Nginx. The web password is separate from the MySQL account.

Keep port 3100 and MySQL private. Nginx protects the entire site including uploads and API documentation. Same-origin requests need no CORS configuration. Cross-origin writes are rejected. Nginx replaces the audit actor header with its authenticated user.

## API contract

See `api/openapi.json` or live `/api/openapi.json` for request field definitions and required properties. Regenerate with `npm run openapi --prefix api`.

Resources: `projects`, `issues`, `milestones`, `notes`, `teams`, `members`, `documents`, `events`.

- `GET /api/{resource}` → `{data: [...], pagination: {page, pageSize, total}}`.
- `GET /api/{resource}/{id}` → `{data: {...}}`.
- `POST /api/{resource}` → 201 `{data: {...}}`. IDs are generated unless a valid unique ID is supplied.
- `PUT /api/{resource}/{id}` replaces writable fields; `PATCH` changes supplied fields only. Both return `{data: {...}}`.
- `DELETE /api/{resource}/{id}` → 204; soft deletion. Referenced projects/teams/members cannot be deleted while in use.
- `GET /api/activity` → the paginated, read-only activity feed.

Queries: `page` (default 1), `pageSize` (default 50, max 200), `sortBy`, `sortOrder` and resource-specific filters documented in OpenAPI. Events support `from`/`to`; documents support `trashed=true`. Returned records include `version`, timestamps and relation IDs. Send the last `version` on updates to detect conflicting changes (409). Errors use `{error:{code,message,fields?}}`; validation errors are 400, missing records 404, conflicts 409, oversized uploads 413.

Files use multipart field `file`: `POST /api/documents/upload`, `PUT /api/documents/{id}/file`, `GET /api/documents/{id}/download`, `POST /api/documents/{id}/restore`. Avatar endpoints: `PUT/GET/DELETE /api/members/{id}/avatar`. Limits: attachments 25 MiB, avatars 2 MiB (PNG/JPEG/WebP). File storage keys are never exposed as filesystem paths. Deleted document files remain available after restoration; old file versions are retained on disk. No automatic garbage collection is enabled.

Calendar timestamps use UTC; each event stores an IANA timezone. All-day dates are date-only and inclusive. MySQL connections use UTC. `APP_TIMEZONE` defaults to Asia/Tokyo.

## Data and verification

The frontend loads and saves through the API. Old browser IndexedDB data is not imported automatically; retain the old browser export before moving to the new server. API operations are transactional individually; a workspace save involving several records is not one global transaction.

Back up MySQL **and** the upload directory together. The source repository does not contain user files, local MySQL runtime, or `.env`. The demo file in `db/demo-files/` is intentionally tracked.

```sh
npm test --prefix api
```

Integration tests require a migrated database, create unique temporary records and clean up only those records. They exercise CRUD, validation, references, optimistic concurrency, filtering, files, avatar signatures, soft deletion, and origin checks. Run against a development database. Readiness checks require both MySQL connectivity and applied migrations.

## Bug tracker and workflow update

After pulling this update, run `npm run db:migrate --prefix api` **before restarting the service**. Migration `003_issue_tracking` adds `kind` (Task/Bug) and `priority` (Low/Medium/High/Critical) to issues. Existing issue IDs beginning with `bug-` are classified as bugs; their status is preserved. Re-running the migration is safe.

The sidebar Bug tracker shows title, project, priority, status, assignee, due date and workflow stage. Search, project/status/priority filters and due-date/priority/title sorting apply to the table and its summary. Resolved percentage is Done divided by filtered bugs, not an estimated engineering completion percentage. Report/edit uses the shared task editor; bug changes also appear in WBS, Kanban and Gantt. API example: `GET /api/issues?kind=Bug&priority=High`.

Task editors now include descriptions, type, priority and an explicit Unassigned option. Assignees and project managers are saved by member ID. Projects support selecting project members. Milestone creation writes to the milestone tracker; notes and milestones can be edited by clicking their titles. Plan task opens the task editor; there is no separate sprint entity. Failed task saves retain the editor and restore the prior visible records. After a failed workspace save, reload before editing again to reconcile any individually committed records.

The dashboard timeline and full Gantt use each assignee's current member photo, falling back to initials or `?` when unassigned. Change the photo under Teams & members. The project export includes active document files and embeds member photos; trashed documents are excluded. Use the database/uploads backup described above for a full recovery backup.

Verification: API integration tests cover CRUD, references, file uploads, avatars, conflicts and bug filters; adapter tests cover ID-based assignment, dirty-field saves, conflict propagation and timeline photo/initials rendering. Browser checks cover reporting and completing a bug, reload persistence, status filtering, project membership creation and milestone creation. VPS deployment and authentication must still be checked by the deployer.

## Ticket image attachments

Run `npm run db:migrate --prefix api` and restart the service after updating. Migration `004_ticket_images` links documents to tickets through `issue_id` without changing existing documents.

Open a ticket from Bug tracker, WBS, Kanban or the timeline. Choose an image under **Images**, then save. Attach one PNG/JPEG/WebP at a time (up to 25 MiB per file); a ticket can contain multiple images. Click a thumbnail for a larger preview and download the original from the preview. Images remain after reload and are also listed in Documents, where they can be moved to trash or restored. Existing project files can be previewed in Documents; they are not automatically assigned to a ticket.

The upload uses `POST /api/documents/upload` with multipart `file`, `projectId`, `issueId`, and `name`. Read a ticket's attachments with `GET /api/documents?issueId=...`. The new `GET /api/documents/:id/preview` serves only PNG/JPEG/WebP signatures, with the same Nginx authentication as the rest of the site; SVG/HTML and other files are download-only. Ticket and document must belong to the same project. Tickets with attached documents cannot be moved between projects. File size limits use `MAX_UPLOAD_BYTES`.

Ticket saving and image uploading are separate operations. If the ticket saves but an upload fails, the editor stays open with an error; retrying uploads to the saved ticket rather than creating a duplicate.

### Dashboard navigation and timeline

Bug Tracker has a permanent sidebar entry immediately after Notes. Its badge counts open bugs; the table includes completed bugs unless filtered. The dashboard timeline offers calendar Week (Monday–Sunday), Month and Quarter ranges, displays up to four active issues, clips bars to the chosen range, shows assignee avatars and marks today. Open Gantt shows all tasks.

### Project keys, ticket types and member profiles (migration 005)

Projects → New project / Edit now manages a unique `projectKey` (2–16 uppercase letters/digits, starting with a letter) and `ticketTypes` (one name per line). Defaults are Task, Bug and Subtask. Add new types or rename/remove unused ones. Types used by any existing ticket, including deleted tickets, cannot be removed. Subtask is a ticket type; this release does not introduce parent/child task nesting.

Tickets receive server-assigned `ticketNumber` and `ticketKey` such as REV-1. Counters are per project, serialized in the creation transaction, and never reuse committed numbers. Internal IDs and attachment relationships stay unchanged. Once a project has tickets, its key is locked; numbered tickets cannot move to another project. API callers that omit a new project key receive an automatically generated key. Read a ticket by internal ID or key with `GET /api/issues/REV-1`; writes continue to use internal IDs. Ticket-key search is supported by `GET /api/issues?q=REV-1`.

Click a member name/photo in Teams & members, or a toolbar/team-summary avatar, to open the profile. It lists projects where the member is a manager, direct member, project-team member or task assignee, and all assigned tickets with type, status and due date.

VPS deployment: back up MySQL and uploads, stop project-dashboard.service, pull the new commit, run `npm ci --prefix api`, then `npm run db:migrate --prefix api`, and restart the service. Do not seed production. Migration 005 is implemented in `api/migrations/project-keys.js` because it needs a collision-safe, resumable backfill: it derives keys from existing project IDs and numbers all existing tickets (including deleted ones) in creation order. No environment changes are needed. Refresh open browser tabs after deployment to load the new fields and versions.

### Member work history (migration 006)

Member avatars in dashboard project cards, team/member views, project portfolios, calendar attendee lists, Kanban and timeline bars open the member profile. Clicking the rest of a timeline task still opens the task editor; avatar links also support keyboard activation.

Profiles include current project involvement, assigned tasks (including completed tasks), and paginated task history. `GET /api/members/:id/task-history?page=1&pageSize=20` returns assignment, assignment-ended, status-change, update and deletion snapshots with recorded timestamps and ticket/project names. Events are written in the same transaction as the task change. This describes assignment history, not proof of who performed an edit or logged working hours. Records remain when tasks are reassigned or soft-deleted.

Migration 006 creates `member_task_history` and captures existing assignments as explicitly labelled baseline snapshots. It cannot reconstruct earlier assignees or historical completion dates that were never stored. Deploy with the service stopped, run `npm run db:migrate --prefix api`, restart, and refresh browsers. No new environment settings. The migration runner matches foreign-key column collations to the existing database; use the runner rather than applying the SQL manually.

### Timeline period switching

The dashboard Time-Based Issue Map keeps all scheduled tasks, including completed tasks, in every period. Week/Month/Quarter changes the date scale; the plotted range expands to contain every task. Avatars and full task names are pinned in the left column rather than squeezed into duration bars. Scroll the chart horizontally for dates and vertically for more tasks.

### Per-project command center

Open Projects and click a project name or Dashboard, or click See details on a dashboard project card. Every project has its own command center and bookmarkable URL (`/#project=<internal project ID>`), with a project switcher.

It shows task totals, completion, in-progress/overdue/due-soon counts, current status distribution, schedule elapsed, project details and member profiles, milestones, workload, project-filtered activity with pagination, open tasks, documents and upcoming events. All metrics are calculated from the selected project's actual records. Task completion is count-based; schedule elapsed is calendar-based. There are no invented sprint, attendance or budget figures. Refresh reloads server data. New tasks/milestones and links to boards, Gantt, bugs, documents and calendar are scoped to the selected project.

This is a frontend-only change; no new database migration or environment settings. Deploy the latest frontend files together, including `project-dashboard.js` and the updated `boot.js`.

The project command center includes a Time-Based Issue Map directly below its summary metrics. It shares the main dashboard renderer and shows only the selected project's scheduled tasks, with pastel duration bars, assignee avatars, Today marker and Week/Month/Quarter controls. Period changes retain all tasks; names and avatars remain pinned while dates scroll. Task labels open tickets, avatars open member profiles, and Open Gantt keeps the same project filter.

## Project management toolkit (migration 007)

Every project dashboard now links to all twelve management areas: Charter, Plan,
Gantt, Status Reports, Risk Register, Issue Tracker, Budget, Resource Plan,
Communication Plan, Change Log, WBS, and RACI.

Nine new structured record sections are stored in `project_tools`. Charter and Plan
have one editable record each; the other sections support up to 500 entries each.
Existing tickets and work packages power Issue Tracker and WBS. Gantt now includes
editable milestone markers, including milestone dates outside the task range.

- `GET /api/projects/:id/tools` returns all nine sections, each with `entries` and `version`.
- `PUT /api/projects/:id/tools/:section` replaces that section with `{version, entries}`.
  Each entry has a stable `id`; version 0 creates an empty section's first revision.
  Stale saves return 409 and must be reviewed/reloaded, not overwritten blindly.
- Section keys: `charter`, `plan`, `reports`, `risks`, `budget`, `resources`,
  `communication`, `changes`, `raci`. Field contracts are in the OpenAPI document
  and shared `dist/project-tools-config.json`.
- Member references and real calendar dates are validated. Costs must be nonnegative
  with at most two decimal places. Totals are grouped by currency, without conversion.
- Resource allocations compare hours against the capacity entered for each date range;
  overlapping rows and allocations across projects require planning judgment.
- RACI requires at least one responsible member and exactly one accountable member.
- Status reports store authored progress/risk/issue updates; the adjacent task counts
  are live figures, not historical snapshots. Changes are manually logged decisions;
  approving a change does not automatically alter ticket dates or project scope.
- Section export and workspace JSON backup include these records. No sample plans,
  risks, approvals, or financial figures are inserted into existing projects.

Deployment: back up MySQL and uploads, stop the service, pull the new code, run
`npm ci --prefix api` and `npm run db:migrate --prefix api`, then restart the service.
Migration 007 creates the new table without replacing existing data. Ship the new
`project-tools.js` and `project-tools-config.json` together with `boot.js` and the
remaining frontend changes. Refresh browser tabs after deployment. Do not seed production.

### Single-project detail layout and sidebar

Projects are listed underneath Projects in the left navigation. Each expandable
project has its own Overview, Team Map, Timeline, Issues, WBS, Board, Gantt,
Charter, Project Plan, Status Reports, Risks, Budget, Resources, Communication,
Change Log, and RACI entries. Horizontal project tabs have been removed.

Clicking a project name opens its overview; the separate disclosure button expands
or collapses its sections. The current project and section are highlighted. The
sidebar scrolls independently. Project URLs continue to use
`#project=<internal-id>&tool=<section>` and survive refresh. The active project's
sections expand when opened through a saved link. Existing records and editing
flows remain project-scoped; the common project header and status sidebar remain.

This navigation update is frontend-only. Deploy the updated project detail,
workspace, project tools, and CSS together. No additional database migration is
required. Refresh existing browser tabs after deployment.

### Project Team Relationship Map

Each project has a **Team Map** sidebar item (`&tool=teammap`), with a dotted canvas,
connected cards, zoom in/out, 100%, fit-to-view, background dragging, and keyboard
panning. Cards come from the project's assigned team, direct project members,
manager, and task assignees. Members appear once even when they have several roles.
Solid edges represent assigned-team/team-membership links. Dashed edges represent
other project contributors; these are not delivery dependency or reporting lines.
Counts include only that project's tasks. Inactive contributors remain identified.
Member cards open existing member profiles and history; the team card opens its
editor, and Manage relationships opens project settings. An expandable table
provides the same relationships without requiring use of the chart.

Deploy the new `dist/team-map.js` with the updated boot script, tabs, workspace,
and CSS. No database migration or additional package dependency is required.
