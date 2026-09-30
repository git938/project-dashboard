-- Reference SQL; use npm run db:migrate --prefix api for resumable migration.
ALTER TABLE issues ADD COLUMN kind ENUM('Task','Bug') NOT NULL DEFAULT 'Task';
ALTER TABLE issues ADD COLUMN priority ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium';
UPDATE issues SET kind='Bug',version=version+1 WHERE id LIKE 'bug-%' AND kind='Task';
INSERT INTO schema_migrations(version) VALUES ('003_issue_tracking');
