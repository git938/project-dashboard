// Run with the migration lock held and application writes stopped.
export async function migrateProjectKeys(c, database, { refresh = false } = {}) {
 const [history]=await c.query("SELECT version FROM schema_migrations WHERE version='005_project_keys'");if(history.length&&!refresh)return;
 for(const [table,column,definition] of [['projects','project_key','VARCHAR(16) NULL'],['projects','ticket_types','JSON NULL'],['projects','next_ticket_number','INT UNSIGNED NOT NULL DEFAULT 1'],['issues','ticket_number','INT UNSIGNED NULL']]){
  const [rows]=await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[database,table,column]);if(!rows.length)await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 }
 await c.query("ALTER TABLE issues MODIFY kind VARCHAR(64) NOT NULL DEFAULT 'Task'");
 await c.beginTransaction();
 try {
  const [projects]=await c.query('SELECT id,project_key,next_ticket_number FROM projects ORDER BY created_at,id');const used=new Set(projects.map(p=>p.project_key).filter(Boolean));
  for(const p of projects){
   let key=p.project_key;if(!key){const base=(p.id.split('-')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^[^A-Z]+/,'')||'PRJ').slice(0,10).padEnd(2,'P');key=base;let suffix=2;while(used.has(key))key=base+suffix++;used.add(key)}
   const [tickets]=await c.query('SELECT id,ticket_number FROM issues WHERE project_id=? ORDER BY created_at,id',[p.id]);let next=Math.max(Number(p.next_ticket_number)||1,Math.max(0,...tickets.map(t=>Number(t.ticket_number)||0))+1);
   for(const ticket of tickets)if(!ticket.ticket_number)await c.query('UPDATE issues SET ticket_number=?,version=version+1 WHERE id=?',[next++,ticket.id]);
   const [kinds]=await c.query('SELECT DISTINCT kind FROM issues WHERE project_id=?',[p.id]);const types=[...new Set(['Task','Bug','Subtask',...kinds.map(t=>t.kind)])];
   await c.query('UPDATE projects SET project_key=?,ticket_types=COALESCE(ticket_types,?),next_ticket_number=?,version=version+1 WHERE id=?',[key,JSON.stringify(types),next,p.id]);
  }
  await c.commit();
 }catch(error){await c.rollback();throw error}
 for(const [table,name,columns] of [['projects','projects_key_unique','project_key'],['issues','issues_project_number_unique','project_id,ticket_number']]){
  const [indexes]=await c.query('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?',[database,table,name]);if(!indexes.length)await c.query(`ALTER TABLE ${table} ADD UNIQUE INDEX ${name} (${columns})`);
 }
 await c.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('005_project_keys')");
}
