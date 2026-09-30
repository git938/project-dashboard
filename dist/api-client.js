/* API adapter for the existing dashboard views. IndexedDB is not used in server mode. */
window.ProjectAPI = (() => {
  const types = ['members','teams','projects','issues','milestones','notes','events','documents'];
  const cache = Object.fromEntries(types.map(t=>[t,new Map()]));
  const avatarSent = new Map();
  const baseline = Object.fromEntries(types.map(t=>[t,new Map()]));
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials:'same-origin', ...options, headers:{ ...(options.body && !(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers } });
    if (!response.ok) { const body=await response.json().catch(()=>({})); const error=new Error(body.error?.message||`Request failed (${response.status})`); error.status=response.status;throw error; }
    return response.status===204?null:response.json();
  }
  async function list(type, extra='') {
    let all=[],page=1,total;
    do {const result=await request(`/api/${type}?pageSize=200&page=${page}${extra}`);all.push(...result.data);total=result.pagination.total;page++;if(!result.data.length)break;} while(all.length<total);
    return all;
  }
  const formatDate=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  function localParts(iso,tz){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {date:`${v.year}-${v.month}-${v.day}`,time:`${v.hour}:${v.minute}`};}
  // Resolve a local wall-clock time in its event timezone; reject nonexistent DST times.
  function utc(date,time,tz){const target=Date.parse(`${date}T${time}:00Z`);let value=target;for(let i=0;i<4;i++){const p=localParts(new Date(value).toISOString(),tz);const observed=Date.parse(`${p.date}T${p.time}:00Z`);const delta=target-observed;if(!delta)return new Date(value).toISOString();value+=delta;}throw Error('This local time does not exist in the selected timezone.');}
  function projectPeople(project, members) {
    const initials = name => name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').toUpperCase();
    const manager = members.find(member => member.id === project.managerId);
    const assigned = (project.memberIds || []).map(id => members.find(member => member.id === id)).filter(Boolean);
    const name = manager?.name || 'Unassigned';
    return { manager: name, lead: name, initials: manager ? initials(name) : '?', leadInitials: manager ? initials(name) : '?', memberInitials: assigned.slice(0, 4).map(member => initials(member.name)), memberCount: assigned.length };
  }
  function toUI(data){const memberName=id=>data.members.find(m=>m.id===id)?.name||'Unassigned';return {
    projects:data.projects.map(p=>({...p,...projectPeople(p,data.members),date:formatDate(p.startDate),end:formatDate(p.endDate),team:0})),
    issues:data.issues.map(t=>({...t,assignee:memberName(t.assigneeId),color:({Todo:'blue','In Progress':'yellow',Review:'purple',Done:'green',Backlog:'gray'})[t.status]})),
    members:data.members.map(m=>({...m,email:m.email||'',avatar:m.avatarUrl||''})),teams:data.teams,
    notes:data.notes.map(n=>({...n,description:n.content,date:formatDate(n.createdAt.slice(0,10))})),
    milestones:data.milestones.map(m=>({...m,project:data.projects.find(p=>p.id===m.projectId)?.name||''})),
    documents:data.documents.map(d=>({...d,fileName:d.originalName,mime:d.mimeType,size:Number(d.sizeBytes||0),updated:d.updatedAt,trashed:!!d.deletedAt})),
    events:data.events.map(e=>{const start=e.allDay?{date:e.startDate,time:'09:00'}:localParts(e.startAt,e.timezone),end=e.allDay?{date:e.endDate,time:'10:00'}:localParts(e.endAt,e.timezone);return {...e,date:start.date,endDate:end.date,time:start.time,endTime:end.time,attendees:e.attendeeIds,description:e.description||''}}),
    activity:data.activity.map(a=>({...a,initials:a.actor.slice(0,2).toUpperCase(),name:a.summary,description:'',time:new Date(a.createdAt).toLocaleString()}))
  };}
  async function load(){const values=await Promise.all([...types.map(t=>list(t)),list('activity')]);const data=Object.fromEntries([...types,'activity'].map((t,i)=>[t,values[i]]));data.documents.push(...await list('documents','&trashed=true'));for(const t of types)cache[t]=new Map(data[t].map(x=>[x.id,x]));for(const m of data.members)avatarSent.set(m.id,m.avatarUrl||'');const state=toUI(data);for(const t of types)for(const row of state[t])baseline[t].set(row.id,payload(t,row,state));return state;}
  function payload(type,row,state){const memberId=name=>state.members.find(m=>m.name===name)?.id||null;switch(type){
    case 'members':return {name:row.name,role:row.role||'',email:row.email||null,active:row.active!==false,color:row.color||'#e7e2f3'};
    case 'teams':return {name:row.name,description:row.description||'',memberIds:row.memberIds||[]};
    case 'projects':return {name:row.name,description:row.description||'',status:row.status||'Active',managerId:memberId(row.manager),teamId:row.teamId||null,startDate:row.startDate,endDate:row.endDate,color:row.color||'#aaa0ce'};
    case 'issues':return {projectId:row.projectId,name:row.name,description:row.description||'',phase:row.phase,status:row.status,assigneeId:memberId(row.assignee),startDate:row.startDate,endDate:row.endDate,sortOrder:row.sortOrder||0};
    case 'milestones':return {projectId:row.projectId||state.projects.find(p=>p.name===row.project)?.id||state.projects[0]?.id,name:row.name,date:row.date,status:row.status||'Planned'};
    case 'notes':return {projectId:row.projectId||null,ownerId:row.ownerId||null,name:row.name,content:row.description??row.content??'',tag:row.tag||''};
    case 'documents':return {projectId:row.projectId,name:row.name,category:row.category||'Other',kind:row.kind,content:row.kind==='note'?row.content||'':null};
    case 'events':{const timezone=row.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;return {projectId:row.projectId,title:row.title,type:row.type,description:row.description||'',location:row.location||'',allDay:!!row.allDay,cancelled:!!row.cancelled,timezone,attendeeIds:row.attendees||[],startAt:row.allDay?null:utc(row.date,row.time,timezone),endAt:row.allDay?null:utc(row.endDate,row.endTime,timezone),startDate:row.allDay?row.date:null,endDate:row.allDay?row.endDate:null};}
  }}
  const json=(method,body)=>({method,body:JSON.stringify(body)});
  async function save(state,fileEntry){
    for(const type of types){for(const row of state[type]){
      let previous=cache[type].get(row.id);const body=payload(type,row,state);
      if(type==='documents'&&row.trashed){if(previous&&!previous.deletedAt){await request(`/api/documents/${row.id}?version=${previous.version}`,{method:'DELETE'});cache[type].set(row.id,{...previous,deletedAt:new Date().toISOString(),version:previous.version+1});}continue;}
      if(type==='documents'&&previous?.deletedAt){previous=(await request(`/api/documents/${row.id}/restore`,{method:'POST'})).data;cache[type].set(row.id,previous);}
      if(type==='documents'&&fileEntry?.id===row.id){const form=new FormData();form.append('id',row.id);for(const key of ['projectId','name','category'])form.append(key,body[key]);if(previous)form.append('version',previous.version);form.append('file',fileEntry.file,fileEntry.file.name||row.fileName||'attachment');previous=(await request(previous?`/api/documents/${row.id}/file`:'/api/documents/upload',{method:previous?'PUT':'POST',body:form})).data;cache[type].set(row.id,previous);}
      else if(!previous){previous=(await request(`/api/${type}`,json('POST',{id:row.id,...body}))).data;cache[type].set(row.id,previous);}
      else {const changes=Object.fromEntries(Object.entries(body).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify((baseline[type].get(row.id)||previous)[k])));if(Object.keys(changes).length){previous=(await request(`/api/${type}/${row.id}`,json('PATCH',{...changes,version:previous.version}))).data;cache[type].set(row.id,previous);}}
      baseline[type].set(row.id,body);
      if(type==='members'&&(row.avatar||'')!==(avatarSent.get(row.id)||'')){
        if(row.avatar?.startsWith('data:image/')){const blob=await(await fetch(row.avatar)).blob();const form=new FormData();form.append('version',previous.version);form.append('file',blob,'avatar');previous=(await request(`/api/members/${row.id}/avatar`,{method:'PUT',body:form})).data;}
        else if(!row.avatar){await request(`/api/members/${row.id}/avatar`,{method:'DELETE'});previous=(await request(`/api/members/${row.id}`)).data;}
        cache[type].set(row.id,previous);avatarSent.set(row.id,row.avatar||'');
      }
    }}
  }
  async function file(id){const response=await fetch(`/api/documents/${id}/download`);if(!response.ok)throw Error('Could not download the document.');return response.blob();}
  return {load,save,file,request,toUI,utc,projectPeople};
})();
