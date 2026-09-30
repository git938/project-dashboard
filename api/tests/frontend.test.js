import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../../dist/api-client.js',import.meta.url),'utf8');
test('API adapter preserves ID assignments and sends only edited bug fields with the server version',async()=>{
 const records={members:[{id:'m',name:'Robin',role:'Developer',active:true,email:null,color:'#eeeeee',version:1}],teams:[],projects:[{id:'p',name:'Project',managerId:'m',memberIds:['m'],status:'Active',color:'#aaaaaa',startDate:'2026-09-01',endDate:'2026-10-01',version:1}],issues:[{id:'bug-one',projectId:'p',name:'Bug',kind:'Bug',priority:'High',status:'Todo',phase:'Development',assigneeId:'m',startDate:'2026-09-01',endDate:'2026-10-01',version:3}],notes:[],milestones:[],documents:[],events:[],activity:[]};
 const writes=[];let conflict=false;
 const sandbox={window:{},Intl,Date,Map,FormData,fetch:async(url,options={})=>{
  const parsed=new URL(url,'http://localhost');const [,api,type,id]=parsed.pathname.split('/');
  if(options.method){if(conflict)return {ok:false,status:409,json:async()=>({error:{message:'Reload before saving.'}})};const body=JSON.parse(options.body);writes.push({type,id,body});const row=records[type].find(r=>r.id===id);Object.assign(row,body,{version:row.version+1});return {ok:true,status:200,json:async()=>({data:structuredClone(row)})};}
  return {ok:true,status:200,json:async()=>({data:structuredClone(records[type]),pagination:{total:records[type].length}})};
 }};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);const client=sandbox.window.ProjectAPI,state=await client.load();
 assert.equal(state.issues[0].assigneeInitials,'R');assert.equal(state.projects[0].memberCount,1);
 await client.save(state);assert.equal(writes.length,0);
 state.members[0].name='Renamed Member';state.issues[0].assignee='Renamed Member';state.projects[0].manager='Renamed Member';await client.save(state);assert.equal(writes.length,1);assert.equal(writes[0].type,'members');
 state.issues[0].status='Review';state.issues[0].priority='Critical';await client.save(state);
 assert.deepEqual(writes[1],{type:'issues',id:'bug-one',body:{status:'Review',priority:'Critical',version:3}});
 conflict=true;state.issues[0].status='Done';await assert.rejects(client.save(state),/Reload/);
 assert.equal(client.assigneeInitials('Unassigned'),'?');assert.equal(client.assigneeInitials('David Chen'),'DC');
});
test('timeline avatar uses the current member photo, initials or unassigned fallback',async()=>{
 const code=await readFile(new URL('../../dist/app.js',import.meta.url),'utf8');
 const members=[{id:'one',name:'Robin',avatar:'/api/members/one/avatar?v=2'},{id:'two',name:'David Chen',avatar:''}];
 const sandbox={window:{Workspace:{memberById:id=>members.find(m=>m.id===id)}},ProjectAPI:{assigneeInitials:name=>name==='Unassigned'?'?':name.split(' ').map(s=>s[0]).join('')},esc:s=>String(s).replace(/"/g,'&quot;')};
 sandbox.Workspace=sandbox.window.Workspace;vm.createContext(sandbox);vm.runInContext(code.slice(code.indexOf('function taskAvatar('),code.indexOf('function renderTimeline(')),sandbox);
 assert.match(sandbox.taskAvatar({assigneeId:'one'}),/<img.*src="\/api\/members\/one\/avatar\?v=2".*alt="Robin"/);
 assert.match(sandbox.taskAvatar({assigneeId:'two'}),/>DC<\/span>/);
 assert.match(sandbox.taskAvatar({assigneeId:null}),/>\?<\/span>/);
 members[0].avatar='';members[0].name='Renamed Person';assert.match(sandbox.taskAvatar({assigneeId:'one'}),/>RP<\/span>/);
});
