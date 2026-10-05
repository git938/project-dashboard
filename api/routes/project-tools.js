import { readFile } from 'node:fs/promises';
import { transaction } from '../db.js';
import { fail, getRecord } from '../services/records.js';
const definitions=JSON.parse(await readFile(new URL('../../dist/project-tools-config.json',import.meta.url),'utf8'));
const string={type:'string',maxLength:4000};
function fieldSchema(f){
 if(f.type==='members')return {type:'array',items:{type:'string',minLength:1,maxLength:64},uniqueItems:true,maxItems:200,...(f.required?{minItems:1}:{})};
 if(['money','number'].includes(f.type))return {type:'number',minimum:0,maximum:1000000000};
 if(f.type==='select')return {type:'string',enum:f.options};
 if(f.type==='date')return {type:'string',pattern:f.required?'^\\d{4}-\\d{2}-\\d{2}$':'^(|\\d{4}-\\d{2}-\\d{2})$'};
 return {...string,maxLength:f.type==='member'?64:f.type==='textarea'?4000:240,...(f.required?{minLength:1}:{})};
}
export async function projectToolRoutes(app){
 const params={type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:64}}};
 app.get('/api/projects/:id/tools',{schema:{tags:['project tools'],params}},async request=>{
  await getRecord(app.db,'projects',request.params.id);
  const [rows]=await app.db.execute('SELECT section,entries,version,updated_at FROM project_tools WHERE project_id=?',[request.params.id]);
  return {data:Object.fromEntries(Object.keys(definitions).map(section=>{const row=rows.find(x=>x.section===section);return [section,row?{entries:typeof row.entries==='string'?JSON.parse(row.entries):row.entries,version:row.version,updatedAt:row.updated_at}:{entries:[],version:0,updatedAt:null}]}))};
 });
 for(const [section,definition] of Object.entries(definitions)){
  const properties=Object.fromEntries(definition.fields.map(f=>[f.key,fieldSchema(f)]));properties.id={type:'string',minLength:1,maxLength:64};
  app.put(`/api/projects/:id/tools/${section}`,{schema:{tags:['project tools'],params,body:{type:'object',additionalProperties:false,required:['entries','version'],properties:{version:{type:'integer',minimum:0},entries:{type:'array',maxItems:definition.single?1:500,items:{type:'object',additionalProperties:false,required:['id',...definition.fields.filter(f=>f.required).map(f=>f.key)],properties}}}}}},async request=>transaction(app.db,async c=>{
   const project=await getRecord(c,'projects',request.params.id,{lock:true});
   const {entries,version}=request.body;
   const [[old]]=await c.execute('SELECT version FROM project_tools WHERE project_id=? AND section=?',[project.id,section]);
   if((old?.version||0)!==version)throw fail(409,'VERSION_CONFLICT','This section changed in another session. Reload this section before saving.');
   if(new Set(entries.map(e=>e.id)).size!==entries.length)throw fail(400,'INVALID_DATA','Entry IDs must be unique.');
   if(section==='wbs'){
    const byId=new Map(entries.map(e=>[e.id,e])),tasks=new Set();
    for(const e of entries){
     const parent=byId.get(e.parentId);
     if(e.kind==='Deliverable'&&(e.parentId||e.taskId))throw fail(400,'INVALID_DATA','Deliverables belong directly to the project.');
     if(e.kind==='Work package'&&(parent?.kind!=='Deliverable'||e.taskId))throw fail(400,'INVALID_DATA','Work packages require a deliverable.');
     if(e.kind==='Task'){
      if(parent?.kind!=='Work package'||!e.taskId||tasks.has(e.taskId))throw fail(400,'INVALID_DATA','Each task must belong to one work package.');
      const task=await getRecord(c,'issues',e.taskId);
      if(task.project_id!==project.id)throw fail(400,'INVALID_DATA','Tasks must belong to this project.');
      const [[link]]=await c.execute("SELECT id FROM issue_links WHERE from_issue_id=? AND kind='parent' AND deleted_at IS NULL LIMIT 1",[e.taskId]);
      if(link)throw fail(400,'INVALID_DATA','Subtasks inherit their parent task’s work package.');
      tasks.add(e.taskId);
     }
    }
   }
   const memberIds=new Set();
   for(const entry of entries){
    for(const f of definition.fields){const value=entry[f.key];
     if(f.required&&typeof value==='string'&&!value.trim())throw fail(400,'INVALID_DATA',f.label+' is required.');
     if(f.type==='member'&&value)memberIds.add(value);
     if(f.type==='members')for(const id of value||[])memberIds.add(id);
     if(f.type==='date'&&value){const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw fail(400,'INVALID_DATA','Invalid calendar date.');}
     if(f.type==='money'&&value!==undefined&&Math.abs(value*100-Math.round(value*100))>0.001)throw fail(400,'INVALID_DATA','Costs support at most two decimal places.');
    }
    if(entry.startDate&&entry.endDate&&entry.endDate<entry.startDate)throw fail(400,'INVALID_DATA','Finish date must follow start date.');
   }
   if(memberIds.size){const [members]=await c.query('SELECT id FROM members WHERE deleted_at IS NULL AND id IN (?)',[[...memberIds]]);if(members.length!==memberIds.size)throw fail(400,'INVALID_DATA','A selected member no longer exists.');}
   await c.execute('INSERT INTO project_tools(project_id,section,entries,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE entries=VALUES(entries),version=version+1',[project.id,section,JSON.stringify(entries)]);
   await c.execute('INSERT INTO activity(project_id,actor,action,entity_type,entity_id,summary,metadata) VALUES (?,?,?,?,?,?,?)',[project.id,String(request.headers['x-authenticated-user']||'local').slice(0,160),'updated','project_tools',project.id,`Updated ${definition.title}`,JSON.stringify({section,entryCount:entries.length,version:version+1})]);
   return {data:{entries,version:version+1}};
  }));
 }
}
