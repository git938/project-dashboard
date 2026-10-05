window.ProjectWbs=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function mount(container,{project,tasks}){
  const base='/api/projects/'+encodeURIComponent(project.id)+'/tools';
  let entries=[],version=0,parents=new Map(),busy=false;
  container.innerHTML='<p>Loading work breakdown…</p>';
  async function load(){
   const [result,details]=await Promise.all([ProjectAPI.request(base),Promise.all(tasks.map(t=>ProjectAPI.request('/api/issues/'+encodeURIComponent(t.id)+'/detail')))]);
   entries=result.data.wbs?.entries||[];version=result.data.wbs?.version||0;
   parents=new Map();details.forEach((d,i)=>{const parent=d.data.links.parent[0];if(parent&&tasks.some(t=>t.id===parent.id))parents.set(tasks[i].id,parent.id)});
   entries=entries.filter(e=>e.kind!=='Task'||tasks.some(t=>t.id===e.taskId&&!parents.has(t.id)));
  }
  const roots=()=>tasks.filter(t=>!parents.has(t.id));
  function descendants(t,seen=new Set()){
   if(seen.has(t.id))return [];seen.add(t.id);
   return [t,...tasks.filter(x=>parents.get(x.id)===t.id).flatMap(x=>descendants(x,seen))];
  }
  function taskRow(t,code,seen=new Set()){
   if(seen.has(t.id))return '';const next=new Set(seen);next.add(t.id);
   const children=tasks.filter(x=>parents.get(x.id)===t.id);
   return '<div class="wbs-node"><div class="wbs-node-heading"><span>'+esc(code)+'</span><button class="task-title" data-wbs-task="'+esc(t.id)+'">'+esc(ProjectAPI.ticketKey(t)+' · '+t.name)+'</button><span class="badge">'+esc(parents.has(t.id)?'Subtask':'Task')+'</span><span>'+esc(t.status)+'</span><span>'+esc(t.progress||0)+'%</span></div>'+children.map((x,i)=>taskRow(x,code+'.'+(i+1),next)).join('')+'</div>';
  }
  function group(node,code){
   const children=entries.filter(e=>e.parentId===node.id),assigned=children.filter(e=>e.kind==='Task').map(e=>roots().find(t=>t.id===e.taskId)).filter(Boolean);
   const all=node.kind==='Deliverable'?children.flatMap(p=>entries.filter(e=>e.parentId===p.id&&e.kind==='Task').map(e=>roots().find(t=>t.id===e.taskId)).filter(Boolean)):assigned;
   const total=all.flatMap(t=>descendants(t));
   return '<details class="wbs-node" open><summary class="wbs-node-heading"><b>'+esc(code)+'</b><strong>'+esc(node.name)+'</strong><span class="badge">'+esc(node.kind)+'</span><span>'+total.length+' tasks · '+Planning.progress(total)+'%</span></summary><div class="work-actions"><button class="text-btn" data-wbs-rename="'+esc(node.id)+'">Rename</button><button class="text-btn" data-wbs-remove="'+esc(node.id)+'">Remove grouping</button></div>'+ (node.kind==='Deliverable'?children.filter(x=>x.kind==='Work package').map((x,i)=>group(x,code+'.'+(i+1))).join(''):assigned.map((t,i)=>taskRow(t,code+'.'+(i+1))).join(''))+'</details>';
  }
  function draw(){
   const packages=entries.filter(e=>e.kind==='Work package'),deliverables=entries.filter(e=>e.kind==='Deliverable');
   const unassigned=roots().filter(t=>!entries.some(e=>e.kind==='Task'&&e.taskId===t.id&&packages.some(p=>p.id===e.parentId)));
   container.innerHTML='<section class="panel wbs-hierarchy"><h2>Work Breakdown Structure</h2><p>Deliverable → Work package → Task → Subtask. Changes save automatically. Open a task to create or manage its subtasks.</p><form data-wbs-add class="work-filters"><label>Name<input name="name" required maxlength="240" placeholder="Deliverable or work package"></label><label>Parent<select name="parentId"><option value="">Project (new deliverable)</option>'+deliverables.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+'</option>').join('')+'</select></label><button class="primary" '+(busy?'disabled':'')+'>Add grouping</button></form><form data-wbs-assign class="work-filters"><label>Task<select name="taskId" required>'+roots().map(t=>'<option value="'+esc(t.id)+'">'+esc(ProjectAPI.ticketKey(t)+' · '+t.name)+'</option>').join('')+'</select></label><label>Work package<select name="parentId" required><option value="">Select work package</option>'+packages.map(e=>'<option value="'+esc(e.id)+'">'+esc((entries.find(p=>p.id===e.parentId)?.name||'')+' / '+e.name)+'</option>').join('')+'</select></label><button class="primary" '+(busy||!packages.length||!roots().length?'disabled':'')+'>Assign / move task</button></form><p role="status" data-wbs-message></p>'+deliverables.map((e,i)=>group(e,String(i+1))).join('')+'<details class="wbs-node" open><summary>Unassigned tasks ('+unassigned.length+')</summary>'+unassigned.map((t,i)=>taskRow(t,'U.'+(i+1))).join('')+'</details><p>Removing a grouping keeps its tasks. Subtasks inherit their parent task’s work package.</p></section>';
  }
  async function save(next){
   if(busy)return;busy=true;
   try{const r=await ProjectAPI.request(base+'/wbs',{method:'PUT',body:JSON.stringify({version,entries:next})});entries=r.data.entries;version=r.data.version;busy=false;draw();container.querySelector('[data-wbs-message]').textContent='Saved';}
   catch(e){busy=false;draw();container.querySelector('[data-wbs-message]').textContent=e.message+' Reload this view before trying again.';}
   finally{busy=false;}
  }
  container.addEventListener('submit',e=>{
   if(!e.target.matches('[data-wbs-add],[data-wbs-assign]'))return;e.preventDefault();
   const f=new FormData(e.target),parentId=f.get('parentId'),taskId=f.get('taskId');let next=structuredClone(entries);
   if(e.target.hasAttribute('data-wbs-add')){const name=f.get('name').trim();if(!name)return;next.push({id:crypto.randomUUID(),name,kind:parentId?'Work package':'Deliverable',parentId});}
   else{if(!parentId||!taskId)return;next=next.filter(x=>x.taskId!==taskId);next.push({id:crypto.randomUUID(),kind:'Task',name:'Task assignment',taskId,parentId});}
   save(next);
  });
  container.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b||busy)return;
   if(b.dataset.wbsTask){TicketEditor.open(b.dataset.wbsTask);return;}
   if(b.dataset.wbsRemove){const id=b.dataset.wbsRemove,ids=new Set([id,...entries.filter(x=>x.parentId===id).map(x=>x.id)]);save(entries.filter(x=>!ids.has(x.id)&&!ids.has(x.parentId)));return;}
   if(b.dataset.wbsRename){
    const row=entries.find(x=>x.id===b.dataset.wbsRename),form=document.createElement('form');
    form.innerHTML='<label>New name<input required maxlength="240" value="'+esc(row.name)+'"></label><button>Save name</button>';
    b.replaceWith(form);form.onsubmit=ev=>{ev.preventDefault();ev.stopPropagation();const name=form.querySelector('input').value.trim();if(name)save(entries.map(x=>x.id===row.id?{...x,name}:x));};
   }
  });
  try{await load();if(container.isConnected)draw();}catch(e){container.textContent='Could not load WBS: '+e.message;}
 }
 return {mount};
})();
