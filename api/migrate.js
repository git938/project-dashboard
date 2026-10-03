import { migrateProjectKeys } from './migrations/project-keys.js';
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
  await migrateProjectKeys(c, config.db.database);
  const [memberHistory]=await c.query("SELECT version FROM schema_migrations WHERE version='006_member_task_history'");
  if(!memberHistory.length){
    let historySql=await readFile(path.join(root,'db/migrations/006_member_task_history.sql'),'utf8');
    for(const [table,column] of [['members','member_id'],['issues','issue_id']]){
      const [[definition]]=await c.query('SELECT CHARACTER_SET_NAME AS charsetName,COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[config.db.database,table,'id']);
      if(!/^[a-zA-Z0-9_]+$/.test(definition.charsetName)||!/^[a-zA-Z0-9_]+$/.test(definition.collationName))throw Error('Invalid ID column character set');
      historySql=historySql.replace(column+' VARCHAR(64) NOT NULL',column+` VARCHAR(64) CHARACTER SET ${definition.charsetName} COLLATE ${definition.collationName} NOT NULL`);
    }
    await c.query(historySql);
    await c.beginTransaction();
    try {
      await c.query(`INSERT INTO member_task_history(member_id,issue_id,ticket_key,task_name,project_name,kind,status,event)
        SELECT i.assignee_id,i.id,CONCAT(p.project_key,'-',i.ticket_number),i.name,p.name,i.kind,i.status,'baseline'
        FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.assignee_id IS NOT NULL`);
      await c.query("INSERT INTO schema_migrations(version) VALUES ('006_member_task_history')");await c.commit();
    }catch(error){await c.rollback();throw error}
  }
  const [[projectIdColumn]]=await c.query("SELECT CHARACTER_SET_NAME AS charsetName,COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='projects' AND COLUMN_NAME='id'",[config.db.database]);
  if(!/^[a-zA-Z0-9_]+$/.test(projectIdColumn.charsetName)||!/^[a-zA-Z0-9_]+$/.test(projectIdColumn.collationName))throw Error('Invalid project ID collation');
  const toolsSql=(await readFile(path.join(root,'db/migrations/007_project_tools.sql'),'utf8')).replace('project_id VARCHAR(64) NOT NULL',`project_id VARCHAR(64) CHARACTER SET ${projectIdColumn.charsetName} COLLATE ${projectIdColumn.collationName} NOT NULL`);
  await c.query(toolsSql);
  await c.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('007_project_tools')");
  const [progressMigration]=await c.query("SELECT version FROM schema_migrations WHERE version='008_issue_progress'");
  if(!progressMigration.length){
    const [columns]=await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[config.db.database,'issues','progress']);
    if(!columns.length) await c.query('ALTER TABLE issues ADD COLUMN progress TINYINT UNSIGNED NOT NULL DEFAULT 0, ADD CONSTRAINT issues_progress_range CHECK (progress <= 100)');
    await c.query("UPDATE issues SET progress=100 WHERE status='Done'");
    await c.query("INSERT INTO schema_migrations(version) VALUES ('008_issue_progress')");
  }
  const [ticketEditorMigration]=await c.query("SELECT version FROM schema_migrations WHERE version='009_ticket_editor'");
  if(!ticketEditorMigration.length){
    const editorSql=await readFile(path.join(root,'db/migrations/009_ticket_editor.sql'),'utf8');
    await c.query(editorSql);
    await c.query("INSERT INTO schema_migrations(version) VALUES ('009_ticket_editor')");
  }
  const [estimateMigration]=await c.query("SELECT version FROM schema_migrations WHERE version='010_issue_estimate'");
  if(!estimateMigration.length){
    const [columns]=await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[config.db.database,'issues','estimate_minutes']);
    if(!columns.length) await c.query(await readFile(path.join(root,'db/migrations/010_issue_estimate.sql'),'utf8'));
    await c.query("INSERT INTO schema_migrations(version) VALUES ('010_issue_estimate')");
  }
  console.log('Database migrations complete. No seed data was loaded.');
} finally { await c.query("SELECT RELEASE_LOCK('project_dashboard_migrations')").catch(()=>{}); await c.end(); }
