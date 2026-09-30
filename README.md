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
