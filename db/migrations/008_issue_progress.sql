-- Per-task progress (0-100). Prefer `npm run db:migrate --prefix api`, which
-- checks column existence first and can resume if the DDL was interrupted.
ALTER TABLE issues ADD COLUMN progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
 ADD CONSTRAINT issues_progress_range CHECK (progress <= 100);
-- Backfill keeps existing numbers unchanged: before this column, completion was
-- derived as "status = Done", so Done rows become 100 and everything else 0.
UPDATE issues SET progress=100 WHERE status='Done';
INSERT INTO schema_migrations(version) VALUES ('008_issue_progress');
