import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app.js';
import { createPool } from '../db.js';
import { config } from '../config.js';
let app,pool,dir;const created=[];
const json = response => response.json();
async function call(method,url,payload,headers={}){return app.inject({method,url,payload,headers});}
async function create(type,body){const r=await call('POST','/api/'+type,body);assert.equal(r.statusCode,201,r.body);created.push([type,r.json().data.id]);return r.json().data;}
function multipart(fields,buffer,filename='fixture.txt'){const boundary='----test'+randomUUID();const chunks=[];for(const [k,v] of Object.entries(fields))chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),buffer,Buffer.from(`\r\n--${boundary}--\r\n`));return {payload:Buffer.concat(chunks),headers:{'content-type':`multipart/form-data; boundary=${boundary}`}};}
before(async()=>{pool=createPool();dir=await mkdtemp(path.join(os.tmpdir(),'dashboard-api-test-'));app=await buildApp({pool,logger:false,settings:{...config,uploadDir:dir,maxUpload:2048,maxAvatar:512}});await app.ready();});
after(async()=>{for(const [type,id] of created.reverse()){
 await pool.execute('DELETE FROM activity WHERE entity_id=?',[id]);
 if(type==='issues'){await pool.execute('DELETE FROM member_task_history WHERE issue_id=?',[id]);await pool.execute('DELETE FROM issue_links WHERE from_issue_id=? OR to_issue_id=?',[id,id]);}
 if(type==='labels')await pool.execute('DELETE FROM issue_labels WHERE label_id=?',[id]);
 for(const [table,column] of [['event_attendees','event_id'],['team_members','team_id'],['project_members','project_id']]) if((type==='events'&&table==='event_attendees')||(type==='teams'&&table==='team_members')||(type==='projects'&&table==='project_members'))await pool.execute(`DELETE FROM ${table} WHERE ${column}=?`,[id]);
 await pool.execute(`DELETE FROM ${type} WHERE id=?`,[id]);
}await app?.close();await pool?.end();if(dir)await rm(dir,{recursive:true,force:true});});
test('CRUD, relationships, date checks, versions, files, soft delete, and origin guard',async()=>{
 assert.equal((await call('GET','/api/ready')).statusCode,200);
 const member=await create('members',{name:'API test member',email:'test@example.test'});
 const team=await create('teams',{name:'API test team',memberIds:[member.id]});
 assert.deepEqual(team.memberIds,[member.id]);
 const project=await create('projects',{name:'API test project',managerId:member.id,teamId:team.id,startDate:'2026-09-01',endDate:'2026-10-01',memberIds:[member.id]});
 const bug=await create('issues',{projectId:project.id,name:'Regression bug',kind:'Bug',priority:'Critical',description:'Steps to reproduce',assigneeId:member.id,startDate:'2026-09-02',endDate:'2026-09-03'});
 assert.equal(bug.kind,'Bug');assert.equal(bug.priority,'Critical');
 const bugs=json(await call('GET',`/api/issues?projectId=${project.id}&kind=Bug&priority=Critical`));assert.equal(bugs.pagination.total,1);assert.equal(bugs.data[0].id,bug.id);
 assert.equal((await call('PATCH',`/api/issues/${bug.id}`,{priority:'Unknown'})).statusCode,400);
 assert.equal((await call('PATCH',`/api/issues/${bug.id}`,{status:'Review',version:bug.version})).statusCode,200);
 assert.equal(json(await call('GET',`/api/issues/${bug.id}`)).data.status,'Review');
 const bad=await call('POST','/api/issues',{projectId:project.id,name:'Invalid date',startDate:'2026-10-02',endDate:'2026-10-01'});assert.equal(bad.statusCode,400);
 const issue=await create('issues',{projectId:project.id,name:'Test task',assigneeId:member.id,startDate:'2026-09-02',endDate:'2026-09-03'});
 assert.equal((await call('PATCH',`/api/issues/${issue.id}`,{status:'Done',version:issue.version})).statusCode,200);
 assert.equal((await call('PATCH',`/api/issues/${issue.id}`,{status:'Todo',version:issue.version})).statusCode,409);
 const filtered=json(await call('GET',`/api/issues?projectId=${project.id}&status=Done&pageSize=1&sortBy=updatedAt`));assert.equal(filtered.pagination.total,1);assert.equal(filtered.data[0].id,issue.id);
 assert.equal((await call('GET','/api/issues?sortBy=name%3BDROP%20TABLE%20issues')).statusCode,400);
 assert.equal((await call('PATCH',`/api/issues/${issue.id}`,{unknown:'ignored?'})).statusCode,400);
 assert.equal((await call('PATCH',`/api/issues/${issue.id}`,{status:'Todo'},{origin:'https://evil.example',host:'localhost:3100'})).statusCode,403);
 assert.equal((await call('PATCH',`/api/issues/${issue.id}`,{status:'Todo'},{origin:'http://localhost:3100',host:'localhost:3100'})).statusCode,200);
 assert.equal((await call('PATCH',`/api/teams/${team.id}`,{name:'Should roll back',memberIds:[randomUUID()]})).statusCode,400);
 assert.equal(json(await call('GET',`/api/teams/${team.id}`)).data.name,'API test team');
 assert.equal((await call('DELETE',`/api/projects/${project.id}`)).statusCode,409);
 const milestone=await create('milestones',{name:'Test milestone',projectId:project.id,date:'2026-09-20'});
 const note=await create('notes',{name:'Test note',projectId:project.id,content:'Hello <script> is text'});
 assert.equal((await call('PUT',`/api/notes/${note.id}`,{name:'Replaced',content:'Replacement'})).statusCode,200);
 assert.equal(json(await call('GET',`/api/notes/${note.id}`)).data.projectId,null);
 const event=await create('events',{title:'Test meeting',type:'Meeting',projectId:project.id,allDay:false,startAt:'2026-09-29T01:00:00Z',endAt:'2026-09-29T02:00:00Z',attendeeIds:[member.id],timezone:'Asia/Tokyo'});
 assert.deepEqual(event.attendeeIds,[member.id]);assert.equal(event.startAt,'2026-09-29T01:00:00.000Z');
 assert.equal((await call('PATCH',`/api/events/${event.id}`,{endAt:'2026-09-28T01:00:00Z'})).statusCode,400);
 assert.equal(json(await call('GET',`/api/events?projectId=${project.id}&from=2026-09-29&to=2026-09-29`)).pagination.total,1);
 await create('events',{title:'All day test',type:'Release',projectId:project.id,allDay:true,startDate:'2026-09-30',endDate:'2026-10-01'});
 assert.equal(json(await call('GET',`/api/events?projectId=${project.id}&from=2026-10-01&to=2026-10-01`)).pagination.total,1);
 const content=Buffer.from('Test attachment\n中文 UTF-8\n');const upload=multipart({projectId:project.id,name:'Test file'},content);
 const uploaded=await app.inject({method:'POST',url:'/api/documents/upload',...upload});assert.equal(uploaded.statusCode,201,uploaded.body);const doc=uploaded.json().data;created.push(['documents',doc.id]);
 assert.equal('storageKey' in doc,false);const downloaded=await call('GET',`/api/documents/${doc.id}/download`);assert.equal(downloaded.statusCode,200);assert.deepEqual(downloaded.rawPayload,content);
 assert.equal((await call('DELETE',`/api/documents/${doc.id}`)).statusCode,204);assert.equal((await call('GET',`/api/documents/${doc.id}/download`)).statusCode,404);
 assert.equal(json(await call('GET',`/api/documents?projectId=${project.id}&trashed=true`)).pagination.total,1);
 assert.equal((await call('POST',`/api/documents/${doc.id}/restore`)).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/api/documents/upload',...multipart({projectId:project.id,name:'Large'},Buffer.alloc(3000))})).statusCode,413);
 assert.equal((await app.inject({method:'PUT',url:`/api/members/${member.id}/avatar`,...multipart({},Buffer.from('<svg>bad</svg>'),'bad.png')})).statusCode,400);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
 const imageUpload=await app.inject({method:'POST',url:'/api/documents/upload',...multipart({projectId:project.id,issueId:bug.id,name:'Bug screenshot'},png,'screenshot.png')});
 assert.equal(imageUpload.statusCode,201,imageUpload.body);const screenshot=imageUpload.json().data;created.push(['documents',screenshot.id]);assert.equal(screenshot.issueId,bug.id);assert.equal(screenshot.mimeType,'image/png');
 const preview=await call('GET',`/api/documents/${screenshot.id}/preview`);assert.equal(preview.statusCode,200);assert.match(preview.headers['content-type'],/^image\/png/);assert.deepEqual(preview.rawPayload,png);
 assert.equal(json(await call('GET',`/api/documents?issueId=${bug.id}`)).pagination.total,1);
 assert.equal((await call('GET',`/api/documents/${doc.id}/preview`)).statusCode,415);
 assert.equal((await app.inject({method:'POST',url:'/api/documents/upload',...multipart({projectId:project.id,issueId:bug.id,name:'Fake image'},Buffer.from('<svg>not a raster image</svg>'),'fake.png')})).statusCode,400);
 const otherProject=await create('projects',{name:'Other test project',startDate:'2026-09-01',endDate:'2026-10-01'});
 assert.equal((await app.inject({method:'POST',url:'/api/documents/upload',...multipart({projectId:otherProject.id,issueId:bug.id,name:'Wrong project'},png,'wrong.png')})).statusCode,400);
 assert.equal((await call('PATCH',`/api/issues/${bug.id}`,{projectId:otherProject.id})).statusCode,409);
 assert.equal((await call('DELETE',`/api/documents/${screenshot.id}`)).statusCode,204);assert.equal((await call('GET',`/api/documents/${screenshot.id}/preview`)).statusCode,404);
 assert.equal((await call('POST',`/api/documents/${screenshot.id}/restore`)).statusCode,200);assert.equal((await call('GET',`/api/documents/${screenshot.id}/preview`)).statusCode,200);
 const avatar=await app.inject({method:'PUT',url:`/api/members/${member.id}/avatar`,...multipart({},png,'avatar.png')});assert.equal(avatar.statusCode,200,avatar.body);assert.match(avatar.json().data.avatarUrl,/\/avatar/);
 assert.deepEqual((await call('GET',`/api/members/${member.id}/avatar`)).rawPayload,png);
 assert.equal((await call('DELETE',`/api/members/${member.id}/avatar`)).statusCode,204);
 assert.equal((await call('GET',`/api/members/${member.id}/avatar`)).statusCode,404);
 const activity=json(await call('GET',`/api/activity?projectId=${project.id}`));assert(activity.pagination.total>0);
 assert.equal((await call('GET','/.env')).statusCode,403);
 assert.equal((await call('GET','/api/openapi.json')).statusCode,200);
 assert.equal((await call('DELETE',`/api/milestones/${milestone.id}`)).statusCode,204);
 assert.equal((await call('GET',`/api/milestones/${milestone.id}`)).statusCode,404);
});

test('project keys, concurrent ticket numbers, project-scoped types and stable identities',async()=>{
 const key='Q'+randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
 let p=await create('projects',{projectKey:key,ticketTypes:['Task','Bug','Subtask','Research'],name:'Key/type regression',startDate:'2026-10-01',endDate:'2026-10-10'});
 assert.equal(p.projectKey,key);assert.ok(p.ticketTypes.includes('Research'));
 assert.equal((await call('POST','/api/projects',{projectKey:key,name:'Duplicate key',startDate:'2026-10-01',endDate:'2026-10-02'})).statusCode,409);
 const ticket={projectId:p.id,name:'Concurrent ticket',kind:'Research',startDate:'2026-10-01',endDate:'2026-10-02'};
 const tickets=await Promise.all(Array.from({length:6},()=>create('issues',ticket)));
 assert.equal(new Set(tickets.map(t=>t.ticketNumber)).size,6);assert.deepEqual(tickets.map(t=>t.ticketNumber).sort((a,b)=>a-b),[1,2,3,4,5,6]);
 assert.ok(tickets.every(t=>t.ticketKey===key+'-'+t.ticketNumber));
 assert.equal((await call('GET','/api/issues/'+tickets[0].ticketKey)).json().data.id,tickets[0].id);
 assert.equal((await call('GET','/api/issues?q='+tickets[0].ticketKey)).json().pagination.total,1);
 assert.equal((await call('POST','/api/issues',{...ticket,kind:'Unconfigured'})).statusCode,400);
 assert.equal((await call('PATCH','/api/projects/'+p.id,{projectKey:key+'X'})).statusCode,409);
 assert.equal((await call('PATCH','/api/projects/'+p.id,{ticketTypes:['Task','Bug']})).statusCode,409);
 const added=await call('PATCH','/api/projects/'+p.id,{ticketTypes:['Task','Bug','Subtask','Research','Support'],version:p.version});assert.equal(added.statusCode,200,added.body);p=added.json().data;
 assert.equal((await call('PATCH','/api/projects/'+p.id,{ticketTypes:['Task','task']})).statusCode,400);
 const independent=await create('projects',{name:'Independent types',startDate:'2026-10-01',endDate:'2026-10-10'});
 assert.equal((await call('POST','/api/issues',{...ticket,projectId:independent.id})).statusCode,400);
 assert.equal((await call('PATCH','/api/issues/'+tickets[0].id,{projectId:independent.id})).statusCode,409);
 assert.equal((await call('DELETE','/api/issues/'+tickets[0].id)).statusCode,204);
 const next=await create('issues',{...ticket,kind:'Subtask'});assert.equal(next.ticketNumber,7);
 const removed=await call('PATCH','/api/projects/'+p.id,{ticketTypes:['Task','Bug','Subtask','Research'],version:p.version});assert.equal(removed.statusCode,200,removed.body);
});

test('member task history survives reassignment and deletion and supports pagination',async()=>{
 const a=await create('members',{name:'History A'}),b=await create('members',{name:'History B'});
 const p=await create('projects',{name:'History project',startDate:'2026-10-01',endDate:'2026-10-05'});
 const t=await create('issues',{projectId:p.id,name:'History task',assigneeId:a.id,startDate:'2026-10-01',endDate:'2026-10-02'});
 for(const update of [{status:'In Progress'},{status:'Done'},{assigneeId:b.id}])assert.equal((await call('PATCH','/api/issues/'+t.id,update)).statusCode,200);
 const history=(await call('GET','/api/members/'+a.id+'/task-history')).json();
 assert.deepEqual(history.data.map(r=>r.event),['unassigned','status_changed','status_changed','assigned']);
 assert.equal(history.data[1].status,'Done');assert.equal(history.data[1].previousStatus,'In Progress');assert.equal(history.data[0].ticketKey,t.ticketKey);
 assert.equal((await call('DELETE','/api/issues/'+t.id)).statusCode,204);
 const other=(await call('GET','/api/members/'+b.id+'/task-history')).json();assert.equal(other.data[0].event,'deleted');assert.equal(other.data[1].ticketDeleted,true);
 const page=(await call('GET','/api/members/'+a.id+'/task-history?page=2&pageSize=2')).json();assert.equal(page.pagination.total,4);assert.equal(page.data.length,2);
 assert.equal((await call('GET','/api/members/'+a.id+'/task-history?page=0')).statusCode,400);
});

test('project tools persist independently, reject stale saves and validate members, dates, costs and RACI',async()=>{
 const member=await create('members',{name:'Project tools test'});
 const project=await create('projects',{name:'Project tools test',startDate:'2026-10-01',endDate:'2026-11-01'});
 const other=await create('projects',{name:'Isolated tools test',startDate:'2026-10-01',endDate:'2026-11-01'});
 const base=`/api/projects/${project.id}/tools`;
 const examples={
  charter:{name:'Scope',objectives:'Launch',scope:'Web',status:'Draft'},
  plan:{name:'Delivery',approach:'Phases',status:'Approved',startDate:'2026-10-01',endDate:'2026-11-01'},
  reports:{name:'Weekly',date:'2026-10-01',status:'On track',progress:'Started'},
  risks:{name:'Dependency',likelihood:'High',impact:'High',mitigation:'Alternative',status:'Open'},
  budget:{name:'Hosting',currency:'JPY',planned:100,actual:25.55},
  resources:{name:'Development',owner:member.id,startDate:'2026-10-01',endDate:'2026-11-01',planned:40,capacity:32},
  communication:{name:'Review',audience:'Sponsors',channel:'Meeting',frequency:'Weekly'},
  changes:{name:'New scope',date:'2026-10-01',reason:'Customer need',status:'Proposed'},
  raci:{name:'Launch',responsible:[member.id],accountable:member.id,consulted:[],informed:[]}
 };
 assert.equal(Object.keys((await call('GET',base)).json().data).length,9);
 for(const [section,fields] of Object.entries(examples)){
  const entries=[{id:randomUUID(),...fields}];
  const saved=await call('PUT',base+'/'+section,{version:0,entries});assert.equal(saved.statusCode,200,saved.body);
  assert.deepEqual((await call('GET',base)).json().data[section].entries,entries);
  assert.equal((await call('PUT',base+'/'+section,{version:0,entries})).statusCode,409);
  assert.deepEqual((await call('GET',`/api/projects/${other.id}/tools`)).json().data[section].entries,[]);
 }
 const invalid=async(section,patch)=>{const response=await call('PUT',base+'/'+section,{version:1,entries:[{id:'invalid',...examples[section],...patch}]});assert.equal(response.statusCode,400,response.body)};
 await invalid('budget',{actual:-1});await invalid('budget',{actual:1.111});
 await invalid('resources',{owner:'missing-member'});await invalid('resources',{endDate:'2026-09-01'});
 await invalid('reports',{date:'2026-02-30'});await invalid('raci',{responsible:[]});await invalid('raci',{accountable:''});
 await invalid('charter',{scope:'  '});await invalid('charter',{unexpected:'field'});
 const conflicting=await Promise.all([1,2].map(n=>call('PUT',base+'/budget',{version:1,entries:[{id:'cost',...examples.budget,actual:n}]})));
 assert.deepEqual(conflicting.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal((await call('PUT',base+'/budget',{version:2,entries:[]})).statusCode,200);
 assert.deepEqual((await call('GET',base)).json().data.budget.entries,[]);
 assert.equal((await call('GET','/api/projects/no-project/tools')).statusCode,404);
 assert.equal((await call('PUT',base+'/unknown',{version:0,entries:[]})).statusCode,404);
 const activity=(await call('GET',`/api/activity?projectId=${project.id}`)).json().data;
 assert.ok(activity.some(a=>a.entityType==='project_tools'));
 await pool.execute('DELETE FROM activity WHERE project_id IN (?,?)',[project.id,other.id]);
});

test('rich ticket descriptions survive create, update and detail reload',async()=>{
 const project=await create('projects',{name:'Rich description regression',startDate:'2026-10-01',endDate:'2026-10-31'});
 const original='Legacy plain text <not markup>';
 const issue=await create('issues',{projectId:project.id,name:'Rich editor roundtrip',description:original,startDate:'2026-10-01',endDate:'2026-10-02'});
 assert.equal(json(await call('GET',`/api/issues/${issue.id}/detail`)).data.description,original);
 const description='<!--project-rich-text:v1--><h2>Overview</h2><p><strong>Formatted</strong> description</p><ol><li>First step</li></ol><table><tbody><tr><th>Result</th></tr><tr><td>Passed</td></tr></tbody></table><p><img src="/api/documents/test-image/preview" alt="Evidence"></p>';
 const result=await call('PATCH',`/api/issues/${issue.id}`,{version:issue.version,description});
 assert.equal(result.statusCode,200,result.body);
 assert.equal(json(await call('GET',`/api/issues/${issue.id}/detail`)).data.description,description);
});

test('ticket collaboration persists comments, time, attachments, labels, subtasks and activity',async()=>{
 const member=await create('members',{name:'Collaboration tester'});
 const project=await create('projects',{name:'Collaboration regression',startDate:'2026-10-01',endDate:'2026-10-31'});
 const issue=await create('issues',{projectId:project.id,name:'Parent ticket',startDate:'2026-10-01',endDate:'2026-10-10'});
 const comment=await create('comments',{issueId:issue.id,authorId:member.id,body:'First comment'});
 let result=await call('PATCH',`/api/comments/${comment.id}`,{version:comment.version,body:'Edited comment'});
 assert.equal(result.statusCode,200,result.body);
 assert.equal((await call('PATCH',`/api/comments/${comment.id}`,{version:comment.version,body:'Stale'})).statusCode,409);
 assert.equal((await call('POST','/api/comments',{issueId:issue.id,authorId:'missing-member',body:'Invalid'})).statusCode,400);
 assert.equal((await call('POST','/api/comments',{issueId:issue.id,body:'   '})).statusCode,400);
 const time=await create('time_entries',{issueId:issue.id,memberId:member.id,minutes:90,spentOn:'2026-10-04',note:'Testing'});
 const label=await create('labels',{name:'Test-'+randomUUID().slice(0,8)});
 result=await call('PATCH',`/api/issues/${issue.id}`,{version:issue.version,labelIds:[label.id],estimateMinutes:180});
 assert.equal(result.statusCode,200,result.body);
 const upload=await app.inject({method:'POST',url:'/api/documents/upload',...multipart({projectId:project.id,issueId:issue.id,name:'Evidence'},Buffer.from('Evidence'),'evidence.txt')});
 assert.equal(upload.statusCode,201,upload.body);created.push(['documents',upload.json().data.id]);
 const childResponse=await call('POST',`/api/issues/${issue.id}/subtasks`,{projectId:project.id,name:'Child ticket',kind:'Subtask',startDate:'2026-10-01',endDate:'2026-10-02'});
 assert.equal(childResponse.statusCode,201,childResponse.body);
 const child=childResponse.json().data;created.push(['issues',child.id]);
 let detail=json(await call('GET',`/api/issues/${child.id}/detail`)).data;
 assert.equal(detail.links.parent[0].id,issue.id);
 created.push(['issue_links',detail.links.parent[0].linkId]);
 assert.equal((await call('POST','/api/issue_links',{fromIssueId:issue.id,toIssueId:child.id,kind:'parent'})).statusCode,400);
 detail=json(await call('GET',`/api/issues/${issue.id}/detail`)).data;
 assert.equal(detail.links.parent.length,0);
 assert.equal(detail.links.children[0].id,child.id);
 assert.equal(detail.comments[0].body,'Edited comment');
 assert.equal(detail.comments[0].author.id,member.id);
 assert.equal(detail.timeTracking.loggedMinutes,90);
 assert.equal(detail.timeTracking.estimateMinutes,180);
 assert.equal(detail.attachments.length,1);
 assert.equal(detail.labels[0].id,label.id);
 for(const word of ['Comment','Time entry','Attachment','Ticket link'])assert.ok(detail.activity.some(a=>a.summary.includes(word)),word);
 assert.equal((await call('DELETE',`/api/comments/${comment.id}?version=2`)).statusCode,204);
 assert.equal((await call('DELETE',`/api/time_entries/${time.id}?version=1`)).statusCode,204);
 assert.equal((await call('DELETE',`/api/documents/${upload.json().data.id}`)).statusCode,204);
 result=await call('PATCH',`/api/issues/${issue.id}`,{version:detail.version,labelIds:[]});
 assert.equal(result.statusCode,200,result.body);
 detail=json(await call('GET',`/api/issues/${issue.id}/detail`)).data;
 assert.equal(detail.comments.length,0);assert.equal(detail.timeTracking.loggedMinutes,0);assert.equal(detail.attachments.length,0);assert.equal(detail.labels.length,0);
});
