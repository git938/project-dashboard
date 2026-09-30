-- Reference migration. `npm run db:migrate` checks column existence before each ALTER,
-- so it can resume if MySQL DDL was interrupted. Do not run this reference twice.
ALTER TABLE projects ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE issues ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE milestones ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE members ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
INSERT INTO schema_migrations(version) VALUES ('002_record_versions');
