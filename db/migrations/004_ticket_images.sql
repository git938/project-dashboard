-- Prefer npm run db:migrate --prefix api for resumable application.
ALTER TABLE documents ADD COLUMN issue_id VARCHAR(64) NULL,
 ADD CONSTRAINT documents_issue_fk FOREIGN KEY(issue_id) REFERENCES issues(id);
INSERT INTO schema_migrations(version) VALUES ('004_ticket_images');
