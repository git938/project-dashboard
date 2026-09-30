import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, root } from './config.js';
const c = await mysql.createConnection({ ...config.db, multipleStatements: true });
try {
  const [[lock]] = await c.query("SELECT GET_LOCK('project_dashboard_migrations',30) AS acquired");
  if (lock.acquired !== 1) throw new Error('Could not acquire migration lock');
  const [tables] = await c.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [config.db.database]);
  if (!tables.length) {
    const sql = (await readFile(path.join(root, 'db/schema.sql'), 'utf8')).replace(/^USE projects;$/m, '');
    await c.query(sql);
    await c.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('001_initial')");
  } else {
    const [history] = await c.query("SELECT version FROM schema_migrations WHERE version='001_initial'");
    if (!history.length) throw new Error('Existing database has no initial migration marker. Back up and review it before proceeding.');
  }
  const [revisions] = await c.query("SELECT version FROM schema_migrations WHERE version='002_record_versions'");
  if (!revisions.length) {
    for (const table of ['projects','issues','milestones','notes','teams','members','documents','events']) {
      const [columns] = await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [config.db.database,table,'version']);
      if (!columns.length) await c.query(`ALTER TABLE ${table} ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1`);
    }
    await c.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('002_record_versions')");
  }
  const [bugMigration] = await c.query("SELECT version FROM schema_migrations WHERE version='003_issue_tracking'");
  if (!bugMigration.length) {
    for (const [name, definition] of [['kind', "ENUM('Task','Bug') NOT NULL DEFAULT 'Task'"], ['priority', "ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium'"]]) {
      const [columns] = await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [config.db.database, 'issues', name]);
      if (!columns.length) await c.query(`ALTER TABLE issues ADD COLUMN ${name} ${definition}`);
    }
    await c.query("UPDATE issues SET kind='Bug',version=version+1 WHERE id LIKE 'bug-%' AND kind='Task'");
    await c.query("INSERT INTO schema_migrations(version) VALUES ('003_issue_tracking')");
  }
  const [attachments] = await c.query("SELECT version FROM schema_migrations WHERE version='004_ticket_images'");
  if (!attachments.length) {
    const [columns] = await c.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='documents' AND COLUMN_NAME='issue_id'", [config.db.database]);
    if (!columns.length) await c.query('ALTER TABLE documents ADD COLUMN issue_id VARCHAR(64) NULL, ADD CONSTRAINT documents_issue_fk FOREIGN KEY(issue_id) REFERENCES issues(id)');
    await c.query("INSERT INTO schema_migrations(version) VALUES ('004_ticket_images')");
  }
  console.log('Database migrations complete. No seed data was loaded.');
} finally { await c.query("SELECT RELEASE_LOCK('project_dashboard_migrations')").catch(()=>{}); await c.end(); }
