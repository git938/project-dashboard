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
 state.issues[0].progress=40;await client.save(state);
 assert.deepEqual(writes[2],{type:'issues',id:'bug-one',body:{progress:40,version:4}});
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
 assert.match(sandbox.taskAvatar({assigneeId:'two'}),/data-member-profile="two" role="link" tabindex="0"/);
 assert.doesNotMatch(sandbox.taskAvatar({assigneeId:null}),/data-member-profile/);
 assert.match(sandbox.taskAvatar({assigneeId:null}),/>\?<\/span>/);
 members[0].avatar='';members[0].name='Renamed Person';assert.match(sandbox.taskAvatar({assigneeId:'one'}),/>RP<\/span>/);
});

test('timeline calendar windows handle week/year boundaries and leap months',async()=>{
 const code=await readFile(new URL('../../dist/planning-core.js',import.meta.url),'utf8'),sandbox={};vm.createContext(sandbox);vm.runInContext(code,sandbox);const p=sandbox.Planning;
 for(const [range,date,start,end,days] of [['Week','2027-01-01','2026-12-28','2027-01-03',7],['Month','2028-02-15','2028-02-01','2028-02-29',29],['Quarter','2026-12-31','2026-10-01','2026-12-31',92]]){const b=p.timelineWindow(range,date);assert.equal(p.iso(b.start),start);assert.equal(p.iso(b.end),end);assert.equal(b.days,days)}
});

test('avatar save decodes locally without a CSP-blocked data URL fetch and retains upload version',async()=>{
 const records={members:[{id:'m',name:'Avatar test',role:'Developer',email:null,active:true,color:'#eeeeee',version:1}],teams:[],projects:[],issues:[],notes:[],milestones:[],documents:[],events:[],activity:[]};let uploads=0;
 const sandbox={window:{},Intl,Date,Map,FormData,Blob,Uint8Array,atob,fetch:async(url,options={})=>{
  assert.ok(url.startsWith('/api/'),'Only same-origin API requests are allowed');
  if(options.method==='PUT'){uploads++;assert.equal(options.body.get('version'),'1');const file=options.body.get('file');assert.equal(file.type,'image/png');assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[137,80,78,71]);return {ok:true,status:200,json:async()=>({data:{...records.members[0],version:2,avatarUrl:'/api/members/m/avatar?v=2'}})}}
  if(options.method==='PATCH'){assert.equal(JSON.parse(options.body).version,2);return {ok:true,status:200,json:async()=>({data:{...records.members[0],version:3}})}}
  const type=url.split('/')[2].split('?')[0];return {ok:true,status:200,json:async()=>({data:records[type],pagination:{total:records[type].length}})};
 }};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);const client=sandbox.window.ProjectAPI,state=await client.load();state.members[0].avatar='data:image/png;base64,iVBORw==';await client.save(state);await client.save(state);assert.equal(uploads,1);state.members[0].role='Designer';await client.save(state);
});

test('project command center scopes every metric and handles empty projects',async()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(await readFile(new URL('../../dist/planning-core.js',import.meta.url),'utf8'),context);context.Planning=context.window.Planning;vm.runInContext(await readFile(new URL('../../dist/project-dashboard.js',import.meta.url),'utf8'),context);
 const data={project:{id:'p',managerId:'manager',teamId:'team',memberIds:['direct'],startDate:'2026-10-01',endDate:'2026-10-11'},issues:[{projectId:'p',status:'Done',progress:100,endDate:'2026-10-02',assigneeId:'worker',name:'Done'},{projectId:'p',status:'Todo',progress:0,endDate:'2026-10-03',assigneeId:'worker',name:'Late'},{projectId:'p',status:'In Progress',progress:0,endDate:'2026-10-08',name:'Soon'},{projectId:'other',status:'Done',progress:100,endDate:'2026-10-01',assigneeId:'outsider',name:'Other'}],members:['manager','direct','worker','teammate','outsider'].map(id=>({id})),teams:[{id:'team',memberIds:['teammate']}],milestones:[{projectId:'p',name:'Our milestone',date:'2026-10-10',status:'Planned'},{projectId:'other',date:'2026-10-02'}],documents:[{projectId:'p',id:'live'},{projectId:'p',id:'trash',trashed:true},{projectId:'other',id:'other'}],events:[{projectId:'p',title:'Next',date:'2026-10-07',endDate:'2026-10-07'},{projectId:'p',title:'Cancelled',date:'2026-10-07',endDate:'2026-10-07',cancelled:true},{projectId:'other',date:'2026-10-07',endDate:'2026-10-07'}]};
 const model=context.window.ProjectDashboard.model(data,'2026-10-06');assert.equal(model.tasks.length,3);assert.equal(model.done,1);assert.equal(model.overdue.length,1);assert.equal(model.dueSoon.length,1);assert.equal(model.progress,33);assert.equal(model.elapsed,50);assert.equal(model.health,'Needs attention');assert.equal(model.people.length,4);assert.equal(model.docs.length,1);assert.equal(model.upcoming.length,1);assert.equal(model.checkpoints.length,1);
 const empty=context.window.ProjectDashboard.model({...data,issues:[]},'2026-09-01');assert.equal(empty.progress,0);assert.equal(empty.elapsed,0);assert.equal(empty.health,'Not started');
});

test('team relationship map deduplicates contributors and isolates project assignments',async()=>{
 const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../../dist/team-map.js',import.meta.url),'utf8'),sandbox);
 const model=sandbox.window.ProjectTeamMap.model;
 const project={id:'p',teamId:'team',managerId:'a',memberIds:['a','b']};
 const members=['a','b','c','outside'].map(id=>({id,name:id,active:true}));
 const issues=[{projectId:'p',assigneeId:'a',status:'Done'},{projectId:'p',assigneeId:'c',status:'Todo'},{projectId:'p',assigneeId:null,status:'Todo'},{projectId:'other',assigneeId:'outside',status:'Todo'}];
 const graph=model({project,members,issues,teams:[{id:'team',name:'Team',memberIds:['a']},{id:'other',memberIds:['outside']}]});
 assert.equal(graph.people.length,3);assert.equal(graph.unassigned,1);assert.equal(graph.tasks.length,3);
 const manager=graph.people.find(p=>p.member.id==='a');assert.equal(manager.open,0);assert.equal(manager.total,1);assert.equal(manager.roles.length,4);assert.equal(manager.inTeam,true);
 assert.equal(graph.people.find(p=>p.member.id==='c').inTeam,false);assert.equal(graph.people.find(p=>p.member.id==='c').open,1);
 const empty=model({project:{id:'empty',memberIds:[]},members,issues,teams:[]});assert.equal(empty.people.length,0);assert.equal(empty.tasks.length,0);assert.equal(empty.team,undefined);
});

test('portfolio health categories, schedule filter and unique contributor counts use current records',async()=>{
 const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../../dist/planning-core.js',import.meta.url),'utf8'),sandbox);sandbox.Planning=sandbox.window.Planning;vm.runInContext(await readFile(new URL('../../dist/portfolio.js',import.meta.url),'utf8'),sandbox);
 const projects=[['complete','Completed','2026-09-01','2026-09-30'],['late','Active','2026-09-01','2026-09-30'],['risk','Active','2026-09-01','2026-12-01'],['ok','Active','2026-09-01','2026-12-01'],['future','Active','2027-01-01','2027-02-01']].map(([id,status,startDate,endDate])=>({id,name:id,status,startDate,endDate,managerId:'m',memberIds:['m'],teamId:'team'}));
 const issues=[{projectId:'risk',status:'Todo',endDate:'2026-11-01',priority:'High',assigneeId:'m',phase:'Development'},{projectId:'ok',status:'Todo',endDate:'2026-11-01',priority:'Medium',assigneeId:'n',phase:'Design'}];
 const data={projects,issues,teams:[{id:'team',memberIds:['m','n']}],members:[{id:'m'},{id:'n'},{id:'unrelated'}],milestones:[],activity:[]};
 const all=sandbox.window.ProjectPortfolio.model(data,'2026-10-02');assert.equal(all.rows.length,5);assert.equal(all.people.length,2);for(const count of all.counts)assert.equal(count.count,1,count.status);
 const filtered=sandbox.window.ProjectPortfolio.model(data,'2026-10-02','30');assert.equal(filtered.rows.length,2);assert.equal(filtered.tasks.length,2);assert.equal(filtered.phases.length,2);
 const empty=sandbox.window.ProjectPortfolio.model({...data,projects:[]},'2026-10-02');assert.equal(empty.rows.length,0);assert.equal(empty.people.length,0);
});

test('weekly report uses Monday boundaries, latest saved narrative and real reporting coverage',async()=>{
 const sandbox={window:{}};vm.createContext(sandbox);
 vm.runInContext(await readFile(new URL('../../dist/planning-core.js',import.meta.url),'utf8'),sandbox);sandbox.Planning=sandbox.window.Planning;
 vm.runInContext(await readFile(new URL('../../dist/portfolio.js',import.meta.url),'utf8'),sandbox);sandbox.ProjectPortfolio=sandbox.window.ProjectPortfolio;
 vm.runInContext(await readFile(new URL('../../dist/weekly-report.js',import.meta.url),'utf8'),sandbox);
 const w=sandbox.window.WeeklyReport;assert.equal(w.week('2027-01-03'),'2026-12-28');assert.equal(w.week('2027-01-04'),'2027-01-04');
 const data={projects:[{id:'p',name:'=Example',startDate:'2026-01-01',endDate:'2027-02-01'},{id:'q',name:'Missing',startDate:'2026-01-01',endDate:'2027-02-01'}],issues:[],members:[],teams:[],activity:[],milestones:[]};
 const reports={p:[{id:'a',date:'2026-12-28',progress:'First'},{id:'b',date:'2027-01-03',progress:'Latest, "quoted"',status:'On track'},{id:'c',date:'2027-01-04',progress:'Next week'}]};
 const m=w.model(data,reports,'2027-01-03');assert.equal(m.start,'2026-12-28');assert.equal(m.end,'2027-01-03');assert.equal(m.rows[0].report.id,'b');assert.equal(m.rows[1].report,undefined);assert.equal(m.trend[6].count,1);assert.equal(m.trend[5].count,0);
 const csv=w.csv(data,reports,'2027-01-03','2027-01-05');assert.ok(csv.includes("'=Example"));assert.ok(csv.includes('Latest, ""quoted""'));assert.ok(csv.includes('2027-01-05'));assert.ok(!csv.includes('Next week'));
});

test('risk assessment consistently scores all likelihood and impact combinations',async()=>{
 const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../../dist/risk-management.js',import.meta.url),'utf8'),sandbox);
 const score=sandbox.window.RiskManagement.level;
 for(const [likelihood,impact,expected] of [['Low','Low','Low'],['Low','Medium','Low'],['Low','High','Medium'],['Medium','Low','Low'],['Medium','Medium','Medium'],['Medium','High','High'],['High','Low','Medium'],['High','Medium','High'],['High','High','High']])assert.equal(score({likelihood,impact}),expected);
});

test('task progress averages per-task percentages instead of counting Done',async()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(await readFile(new URL('../../dist/planning-core.js',import.meta.url),'utf8'),context);const p=context.window.Planning;
 assert.equal(p.progress([]),0);
 assert.equal(p.progress([{progress:100},{progress:0},{progress:0}]),33);
 assert.equal(p.progress([{progress:60},{progress:100}]),80);
 assert.equal(p.progress([{progress:45}]),45);
 assert.equal(p.progress([{},{}]),0);
 assert.equal(p.progress([{progress:'50'},{progress:50}]),50);
});

test('RACI assignment keeps one accountable member and supports combined R/A',async()=>{
 const code=await readFile(new URL('../../dist/raci.js',import.meta.url),'utf8');
 const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const {assign,roleOf}=sandbox.window.ProjectRaci;
 const row={responsible:['one'],accountable:'one',consulted:['two'],informed:[]};
 assert.equal(roleOf(row,'one'),'R/A');
 assign(row,'two','A');assert.equal(row.accountable,'two');assert.equal(roleOf(row,'one'),'R');assert.equal(roleOf(row,'two'),'A');
 assign(row,'one','C');assert.equal(roleOf(row,'one'),'C');assert.equal(row.responsible.length,0);
 assign(row,'two','R/A');assert.equal(roleOf(row,'two'),'R/A');
 assign(row,'two','');assert.equal(row.accountable,'');assert.equal(row.responsible.length,0);
});

test('RACI columns use explicit project membership, not all workspace members or the manager',async()=>{
 const code=await readFile(new URL('../../dist/raci.js',import.meta.url),'utf8');const sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const members=[{id:'a'},{id:'b'},{id:'manager'}],get=sandbox.window.ProjectRaci.projectMembers;
 assert.deepEqual(Array.from(get({memberIds:['a'],managerId:'manager'},members),m=>m.id),['a']);
 assert.deepEqual(Array.from(get({memberIds:['b']},members),m=>m.id),['b']);
 assert.equal(get({memberIds:[]},members).length,0);
});
