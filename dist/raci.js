window.ProjectRaci = (() => {
  const roles = {R:['Responsible','Does the work'],A:['Accountable','Final decision / approval'],C:['Consulted','Provides input'],I:['Informed','Kept in the loop']};
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function roleOf(row,id){return [row.responsible?.includes(id)?'R':'',row.accountable===id?'A':'',row.consulted?.includes(id)?'C':'',row.informed?.includes(id)?'I':''].filter(Boolean).join('/');}
  function assign(row,id,value){
    for(const [key,letter] of [['responsible','R'],['consulted','C'],['informed','I']])row[key]=[...(row[key]||[]).filter(x=>x!==id),...(value.split('/').includes(letter)?[id]:[])];
    if(row.accountable===id)row.accountable='';
    if(value.includes('A'))row.accountable=id;
    return row;
  }
  function mount(container,context,record){
    const {project,members,tasks,avatar}=context;
    let entries=structuredClone(record.entries),version=record.version,dirty=false,busy=false,search='',phase='',role='',message='';
    const collapsed=new Set();
    const base='/api/projects/'+encodeURIComponent(project.id)+'/tools';
    const blank=t=>({id:t.id,name:t.name,responsible:[],accountable:'',consulted:[],informed:[],notes:''});
    function rows(){return [...tasks.map(t=>({...blank(t),...(entries.find(e=>e.id===t.id)||{}),name:t.name,phase:t.phase||'Other',ticketKey:ProjectAPI.ticketKey(t)})),...entries.filter(e=>!tasks.some(t=>t.id===e.id)).map(e=>({...e,phase:'Activities',ticketKey:'—'}))];}
    function people(){return projectMembers(project,members);}
    function visible(){
      return rows().filter(row=>(!phase||row.phase===phase)&&(!role||people().some(m=>roleOf(row,m.id).split('/').includes(role)))&&(!search||[row.name,row.ticketKey,...people().filter(m=>roleOf(row,m.id)).map(m=>m.name)].join(' ').toLowerCase().includes(search.toLowerCase())));
    }
    function draw(){
      const all=rows(),shown=visible(),team=people(),counts=Object.fromEntries(Object.keys(roles).map(r=>[r,all.reduce((n,row)=>n+team.filter(m=>roleOf(row,m.id).split('/').includes(r)).length,0)]));
      const groups=[...new Set(shown.map(r=>r.phase))];
      const outside=entries.some(r=>[...(r.responsible||[]),r.accountable,...(r.consulted||[]),...(r.informed||[])].some(id=>id&&!team.some(m=>m.id===id)));
      container.innerHTML=`<div class="rc-heading"><div><h2><span class="fa-solid fa-people-arrows"></span> RACI Matrix</h2><p>Define roles and responsibilities for ${escape(project.name)}.</p></div><div class="work-actions"><button class="secondary" data-rc-export>Export CSV</button><button class="secondary" data-rc-reload>Reload</button><button class="primary" data-rc-save ${!dirty||busy?'disabled':''}>Save changes</button></div></div>
      ${outside?'<p class="rc-feedback">Some saved assignments belong to former project members. They are preserved but hidden. Use Manage project members to add them back, or clear the activity’s assignments and reassign.</p>':''}
      <p class="rc-feedback" role="status">${escape(message|| (dirty?'Unsaved changes':'Assignments saved per project'))}</p>
      <div class="rc-layout"><section class="panel rc-main"><div class="rc-filters">
      <select aria-label="Filter RACI phase" data-rc-phase><option value="">All phases</option>${[...new Set(all.map(r=>r.phase))].map(p=>`<option ${p===phase?'selected':''}>${escape(p)}</option>`).join('')}</select>
      <select aria-label="Filter RACI role" data-rc-role><option value="">All RACI roles</option>${Object.entries(roles).map(([key,v])=>`<option value="${key}" ${role===key?'selected':''}>${key} · ${v[0]}</option>`).join('')}</select>
      <button class="secondary" data-project-edit="${escape(project.id)}">Manage project members</button>
      <input aria-label="Search RACI" data-rc-search placeholder="Search tasks or assigned members…" value="${escape(search)}"></div>
      <div class="rc-scroll"><table class="rc-table"><thead><tr><th class="rc-task">Task / Activity</th>${team.map(m=>`<th><div class="rc-member">${avatar(m)}<strong>${escape(m.name)}</strong><small>${escape(m.role||'Member')}</small></div></th>`).join('')}</tr></thead><tbody>
      ${groups.map(group=>`<tr class="rc-group"><th colspan="${team.length+1}"><button data-rc-group="${escape(group)}" aria-expanded="${!collapsed.has(group)}">${collapsed.has(group)?'▸':'▾'} ${escape(group)}</button></th></tr>${collapsed.has(group)?'':shown.filter(r=>r.phase===group).map(row=>`<tr><th class="rc-task"><span>${escape(row.name)}</span><small>${escape(row.ticketKey)} ${!row.responsible?.length||!row.accountable?'· Needs R and A':''}</small>${entries.some(e=>e.id===row.id)?`<button class="text-btn" data-rc-remove="${escape(row.id)}">${tasks.some(t=>t.id===row.id)?'Clear assignments':'Remove activity'}</button>`:''}</th>${team.map(m=>{const v=roleOf(row,m.id);return `<td><select class="rc-cell rc-${v.replace('/','')||'none'}" aria-label="${escape(row.name+' — '+m.name)}" data-rc-row="${escape(row.id)}" data-rc-member="${escape(m.id)}"><option value="">—</option>${[...new Set(['R','A','C','I','R/A',...(v?[v]:[])])].map(r=>`<option value="${r}" ${v===r?'selected':''}>${r}</option>`).join('')}</select></td>`}).join('')}</tr>`).join('')}`).join('')||`<tr><td colspan="${team.length+1}">No activities match these filters.</td></tr>`}
      </tbody></table></div>
      ${!team.length?'<p class="rc-empty">Add project members to assign responsibilities.</p>':''}
      <p class="rc-caption">${shown.length} of ${all.length} activities · Each saved row needs at least one Responsible and one Accountable member. R/A may be the same person.</p>
      <form class="rc-add"><input name="name" aria-label="New RACI activity" placeholder="Add a project activity…" maxlength="240" required><button class="secondary">Add activity</button></form></section>
      <div class="rc-side"><section class="panel"><h3>RACI Legend</h3>${Object.entries(roles).map(([r,v])=>`<div class="rc-legend"><b class="rc-bubble rc-${r}">${r}</b><div><strong>${v[0]}</strong><small>${v[1]}</small></div></div>`).join('')}</section>
      <section class="panel"><h3>RACI Summary</h3>${Object.entries(roles).map(([r,v])=>`<div class="rc-summary"><span class="rc-bubble rc-${r}">${r}</span><span>${v[0]}</span><b>${counts[r]}</b></div>`).join('')}<p class="rc-caption">Counts across the complete project matrix.</p></section>
      <section class="panel"><h3>Team Members</h3>${team.map(m=>`<div class="rc-person">${avatar(m)}<span>${escape(m.name)}<small>${escape(m.role||'Member')}</small></span><b title="Assigned activities">${all.filter(r=>roleOf(r,m.id)).length}</b></div>`).join('')||'<p>No project members yet.</p>'}</section></div></div>`;
      if(busy)container.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    }
    container.onchange=e=>{
      if(busy)return;
      if(e.target.hasAttribute('data-rc-phase'))phase=e.target.value;
      else if(e.target.hasAttribute('data-rc-role'))role=e.target.value;
      else if(e.target.dataset.rcRow){
        const id=e.target.dataset.rcRow;
        let row=entries.find(r=>r.id===id);
        if(!row){const task=tasks.find(t=>t.id===id);row=blank(task);entries.push(row);}
        assign(row,e.target.dataset.rcMember,e.target.value);dirty=true;message='';
      }else return;draw();
    };
    container.oninput=e=>{if(e.target.hasAttribute('data-rc-search')){search=e.target.value;const pos=e.target.selectionStart;draw();const input=container.querySelector('[data-rc-search]');input.focus();input.setSelectionRange(pos,pos);}};
    container.onsubmit=e=>{e.preventDefault();if(busy)return;const form=e.target;if(!form.matches('.rc-add'))return;const name=new FormData(form).get('name').trim();if(!name)return;entries.push(blank({id:crypto.randomUUID(),name}));dirty=true;search='';phase='';role='';draw();};
    container.onclick=async e=>{
      const button=e.target.closest('button');if(!button||busy)return;
      if(button.hasAttribute('data-project-edit')&&dirty){e.stopPropagation();message='Save or reload your RACI changes before updating project members.';draw();return;}
      if(button.dataset.rcRemove){entries=entries.filter(r=>r.id!==button.dataset.rcRemove);dirty=true;draw();return;}
      if(button.dataset.rcGroup){const key=button.dataset.rcGroup;collapsed.has(key)?collapsed.delete(key):collapsed.add(key);draw();return;}
      try{
        if(button.hasAttribute('data-rc-save')){
          const invalid=entries.find(r=>!r.responsible?.length||!r.accountable);
          if(invalid){message='Assign Responsible and Accountable members for “'+invalid.name+'” before saving.';draw();return;}
          busy=true;draw();const result=await ProjectAPI.request(base+'/raci',{method:'PUT',body:JSON.stringify({version,entries})});
          entries=result.data.entries;version=result.data.version;dirty=false;message='Saved to MySQL';
        }else if(button.hasAttribute('data-rc-reload')){
          if(dirty&&!confirm('Discard unsaved RACI changes and reload?'))return;
          busy=true;draw();const result=await ProjectAPI.request(base);entries=result.data.raci.entries;version=result.data.raci.version;dirty=false;message='Reloaded';
        }else if(button.hasAttribute('data-rc-export')){
          const team=people(),csvValue=v=>'"'+String(/^[=+@-]/.test(String(v))?"'"+v:v).replaceAll('"','""')+'"';
          const csv=[['Task / Activity','Phase',...team.map(m=>m.name)],...visible().map(r=>[r.name,r.phase,...team.map(m=>roleOf(r,m.id))])].map(row=>row.map(csvValue).join(',')).join('\r\n');
          const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=ProjectAPI.projectKey(project)+'-raci.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
        }else return;
      }catch(error){message=error.message;}finally{busy=false;draw();}
    };
    draw();
  }
  function projectMembers(project,members){const ids=new Set(project.memberIds||[]);return members.filter(m=>ids.has(m.id));}
  return {mount,roleOf,assign,projectMembers};
})();
