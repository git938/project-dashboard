/* Project management records are saved separately from the task snapshot. */
window.ProjectTools=(()=>{
 let definitionsPromise;
 const definitions=()=>definitionsPromise||(definitionsPromise=fetch('/project-tools-config.json').then(r=>{if(!r.ok)throw Error('Could not load project tools');return r.json()}).catch(e=>{definitionsPromise=null;throw e}));
 const titles={overview:'Overview',teammap:'Team Map',timeline:'Timeline',issues:'Tasks',wbs:'WBS',kanban:'Board',gantt:'Gantt',charter:'Project Charter',plan:'Project Plan',reports:'Status Reports',risks:'Risks',budget:'Budget',resources:'Resources',communication:'Communication',changes:'Change Log',raci:'RACI Matrix'};
 async function mount(container,context,initial='charter'){
  const {project,members,tasks,avatar}=context;
  let defs,records,section=initial,filter='',busy=false,initialEdit=context.initialEdit;
  const base=`/api/projects/${encodeURIComponent(project.id)}/tools`;
  const memberName=id=>members.find(m=>m.id===id)?.name|| (id?'Former member':'Unassigned');
  const errorView=error=>{container.innerHTML=`<p role="alert">${esc(error.message)}</p><button class="secondary" data-tools-retry>Retry</button>`;container.querySelector('button').onclick=load};
  async function load(){container.innerHTML='<p role="status">Loading project records…</p>';try{[defs,records]=await Promise.all([definitions(),ProjectAPI.request(base).then(r=>r.data)]);draw();if(initialEdit){const id=initialEdit;initialEdit=null;edit(id==='new'?undefined:id)}}catch(error){errorView(error)}}
  function links(){return `<div class="pt-related"><button class="secondary" data-project-plan="${esc(project.id)}">Tasks / WBS</button><button class="secondary" data-project-gantt="${esc(project.id)}">Gantt & milestones</button><button class="secondary" data-pt-section="budget">Budget</button><button class="secondary" data-pt-section="resources">Resources</button></div>`}
  function metrics(){const done=tasks.filter(t=>t.status==='Done').length;return `<div class="pt-metrics"><b>${tasks.length} tasks</b><b>${done} completed</b><b>${Planning.progress(tasks)}% overall progress</b><span>${esc(project.startDate)} → ${esc(project.endDate)}</span></div>`}
  function display(f,value){if(f.type==='member')return value?`${avatar(members.find(m=>m.id===value))} ${esc(memberName(value))}`:'—';if(f.type==='members')return (value||[]).map(memberName).map(esc).join(', ')||'—';return esc(value===undefined||value===''?'—':String(value))}
  function summary(){const entries=records[section].entries;
   if(section==='budget'){const totals={};for(const row of entries){const t=totals[row.currency]||(totals[row.currency]={planned:0,actual:0});t.planned+=Math.round(row.planned*100);t.actual+=Math.round(row.actual*100)}return `<div class="pt-metrics">${Object.entries(totals).map(([currency,t])=>`<div><strong>${currency}</strong><p>Planned ${(t.planned/100).toLocaleString()} · Actual ${(t.actual/100).toLocaleString()}</p><b class="${t.actual>t.planned?'pd-late':''}">Remaining ${((t.planned-t.actual)/100).toLocaleString()}</b></div>`).join('')||'<p>Add cost items to compare planned and actual spending.</p>'}</div>`}
   if(section==='reports'||section==='plan')return metrics()+links();
   if(section==='resources')return `<p>Hours apply to each row’s date range. Compare overlapping allocations before committing capacity.</p><div class="pt-metrics">${[...new Set(tasks.map(t=>t.assigneeId))].map(id=>`<span>${esc(memberName(id))}: ${tasks.filter(t=>t.assigneeId===id&&t.status!=='Done').length} open tasks</span>`).join('')||'No task assignments yet.'}</div>`;
   return '';
  }
  function singleRecord(d,rows){return rows.map(row=>`<article class="pt-document"><h3>${esc(row.name)}</h3><dl>${d.fields.filter(f=>f.key!=='name').map(f=>`<div><dt>${esc(f.label)}</dt><dd>${display(f,row[f.key])}</dd></div>`).join('')}</dl><button class="secondary" data-pt-edit="${esc(row.id)}">Edit ${d.title}</button></article>`).join('')||'<p class="pd-empty">No record yet. Add the first version for this project.</p>'}
  function draw(){if(container.isConnected){if(!context.preserveHash)history.replaceState(null,'','#project='+encodeURIComponent(project.id)+'&tool='+section);context.onSection?.(section);container.closest('.project-detail')?.classList.toggle('detail-charter',['charter','raci'].includes(section));}const d=defs[section],rows=records[section].entries.filter(row=>JSON.stringify(row).toLowerCase().includes(filter.toLowerCase()));
   if(section==='raci'){ProjectRaci.mount(container,context,records.raci);return}
   if(section==='charter'){container.innerHTML=ProjectCharter.render(context,records.charter.entries[0],records.charter);return}
   container.innerHTML=`<section class="panel pt-section"><div class="work-heading"><div><h2>${d.title}</h2><p>${d.description}</p></div><div class="work-actions"><button class="secondary" data-pt-reload>Reload</button><button class="secondary" data-pt-export>Export JSON</button><button class="primary" data-pt-add>${d.single&&records[section].entries.length?'Edit':'+ Add record'}</button></div></div>${summary()}<label class="pt-search">Search records <input data-pt-search value="${esc(filter)}" placeholder="Search this section"></label><p role="status" class="pt-feedback"></p>${d.single?singleRecord(d,rows):`<div class="bug-table-wrap"><table class="bug-table pt-table"><thead><tr>${d.fields.map(f=>`<th>${f.label}</th>`).join('')}${section==='budget'?'<th>Remaining</th>':section==='resources'?'<th>Allocation</th>':''}<th>Actions</th></tr></thead><tbody>${rows.map(row=>`<tr>${d.fields.map(f=>`<td>${display(f,row[f.key])}</td>`).join('')}${section==='budget'?`<td>${((Math.round(row.planned*100)-Math.round(row.actual*100))/100).toLocaleString()}</td>`:section==='resources'?`<td class="${row.planned>row.capacity?'pd-late':''}">${row.planned>row.capacity?'Over capacity':'Within capacity'}</td>`:''}<td><button class="text-btn" data-pt-edit="${esc(row.id)}">Edit</button><button class="text-btn" data-pt-delete="${esc(row.id)}">Delete</button></td></tr>`).join('')||`<tr><td colspan="${d.fields.length+2}">No records yet. Add a record for ${esc(project.name)}.</td></tr>`}</tbody></table></div>`}<p class="muted">${records[section].entries.length} record${records[section].entries.length===1?'':'s'} · Saved to this project only</p></section>`;
  }
  async function save(entries){const result=await ProjectAPI.request(base+'/'+section,{method:'PUT',body:JSON.stringify({version:records[section].version,entries})});records[section]=result.data;draw();container.querySelector('.pt-feedback').textContent='Saved to MySQL';}
  function edit(id){const d=defs[section],entry=records[section].entries.find(e=>e.id===id)||{id:crypto.randomUUID()};const dialog=document.createElement('dialog');dialog.className='pt-editor';dialog.setAttribute('aria-label',d.title+' editor');
   function field(f){const v=entry[f.key]??'',required=f.required?'required':'',label=esc(f.label);let input;
    if(['member','members','select'].includes(f.type)){const values=f.type==='select'?f.options.map(v=>({id:v,name:v})):members;input=`<select name="${f.key}" ${required} ${f.type==='members'?'multiple size="5"':''}>${f.type!=='members'?'<option value="">Select…</option>':''}${values.map(m=>`<option value="${esc(m.id)}" ${(Array.isArray(v)?v.includes(m.id):v===m.id)?'selected':''}>${esc(m.name)}</option>`).join('')}</select>${f.type==='members'?'<small>Use Command/Ctrl to select multiple members.</small>':''}`}
    else if(f.type==='textarea')input=`<textarea name="${f.key}" ${required} maxlength="4000" rows="3">${esc(v)}</textarea>`;
    else input=`<input name="${f.key}" type="${['money','number'].includes(f.type)?'number':f.type==='date'?'date':'text'}" value="${esc(String(v))}" ${required} ${['money','number'].includes(f.type)?'min="0" max="1000000000" step="0.01"':'maxlength="240"'}>`;
    return `<label>${label}${f.required?' *':''}${input}</label>`;
   }
   dialog.innerHTML=`<form><h2>${d.title}</h2><div class="pt-fields">${d.fields.map(field).join('')}</div><p role="alert" class="pt-error"></p><div class="work-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary">Save record</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
   dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
   dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const fd=new FormData(e.target),next={id:entry.id};for(const f of d.fields){next[f.key]=f.type==='members'?fd.getAll(f.key):['money','number'].includes(f.type)?Number(fd.get(f.key)):String(fd.get(f.key)||'')}
    const entries=records[section].entries.map(row=>row.id===entry.id?next:row);if(!entries.some(row=>row.id===next.id))entries.push(next);
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await save(entries);dialog.close()}catch(error){dialog.querySelector('.pt-error').textContent=error.message+(error.status===409?' Copy your changes, then cancel and reload this section.':'')}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false)};
   };
  }
  container.onclick=async e=>{const b=e.target.closest('button');if(!b||busy)return;try{
   if(b.hasAttribute('data-pc-print')){document.body.classList.add('printing-charter');const clean=()=>document.body.classList.remove('printing-charter');window.addEventListener('afterprint',clean,{once:true});try{window.print()}finally{clean()}}
   else if(b.dataset.ptSection){section=b.dataset.ptSection;filter='';draw()}
   else if(b.hasAttribute('data-pt-add'))edit(defs[section].single?records[section].entries[0]?.id:undefined);
   else if(b.dataset.ptEdit)edit(b.dataset.ptEdit);
   else if(b.dataset.ptDelete){if(!confirm('Delete this project record?'))return;busy=true;b.disabled=true;try{await save(records[section].entries.filter(row=>row.id!==b.dataset.ptDelete))}finally{busy=false;b.disabled=false}}
   else if(b.hasAttribute('data-pt-reload'))await load();
   else if(b.hasAttribute('data-pt-export')){const blob=new Blob([JSON.stringify({projectId:project.id,project:project.name,section,...records[section]},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=section+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  }catch(error){container.querySelector('.pt-feedback').textContent=error.message}};
  container.oninput=e=>{if(e.target.hasAttribute('data-pt-search')){filter=e.target.value;const pos=e.target.selectionStart;draw();const input=container.querySelector('[data-pt-search]');input.focus();input.setSelectionRange(pos,pos)}};
  await load();
 }
 return {titles,mount};
})();
