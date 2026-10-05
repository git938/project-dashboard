window.DashboardLinks=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function button(value,label,type,rows){
   const records=rows.map(r=>({id:r.id,name:r.name||r.title||'',status:r.status||'',projectId:r.projectId||r.project?.id||'',assigneeId:r.assigneeId||'',endDate:r.endDate||'',priority:r.priority||'',role:r.role||'',email:r.email||''}));
   return `<button type="button" class="metric-link" data-metric-type="${esc(type)}" data-metric-title="${esc(label)}" data-metric-rows="${esc(JSON.stringify(records))}" aria-label="View ${esc(label)} (${esc(value)})">${esc(value)}</button>`;
 }
 function tasksFor(label,tasks,today){
   if(['Completed','Done'].includes(label))return tasks.filter(t=>t.status==='Done');
   if(['In Progress','In progress'].includes(label))return tasks.filter(t=>t.status==='In Progress');
   if(label==='At Risk')return tasks.filter(t=>t.status!=='Done'&&['High','Critical'].includes(t.priority));
   if(label==='Overdue')return tasks.filter(t=>t.status!=='Done'&&t.endDate<today);
   return tasks;
 }
 document.addEventListener('click',e=>{
   const b=e.target.closest('[data-metric-rows]');if(!b)return;e.preventDefault();e.stopPropagation();
   const rows=JSON.parse(b.dataset.metricRows),type=b.dataset.metricType,title=b.dataset.metricTitle;
   const dialog=document.createElement('dialog');dialog.className='metric-list';dialog.setAttribute('aria-label',title+' list');
   let query='';
   function draw(){
     const list=rows.filter(r=>(r.name+' '+r.status+' '+r.priority).toLowerCase().includes(query.toLowerCase()));
     dialog.innerHTML=`<div class="panel-heading"><div><h2>${esc(title)}</h2><p>${list.length} of ${rows.length} ${esc(type)} · Matching the dashboard count</p></div><button type="button" class="secondary" data-metric-close>Close</button></div><input aria-label="Search matching records" placeholder="Search this list…" value="${esc(query)}"><div class="bug-table-wrap"><table class="bug-table"><thead><tr><th>${type==='tasks'?'Ticket':'Name'}</th><th>${type==='members'?'Role':'Status'}</th><th>${type==='members'?'Email':'Project'}</th>${type==='tasks'?'<th>Priority</th><th>Due</th>':''}</tr></thead><tbody>${list.map(r=>`<tr><td>${type==='tasks'||type==='projects'?`<button class="task-title" data-metric-open="${esc(r.id)}">${type==='tasks'?esc(ProjectAPI.ticketKey((typeof issues!=='undefined'&&issues.find(t=>t.id===r.id))||r))+' · ':''}${esc(r.name)}</button>`:esc(r.name)}</td><td>${esc(type==='members'?r.role:r.status)}</td><td>${esc(type==='members'?r.email:(typeof projects!=='undefined'?projects.find(p=>p.id===r.projectId)?.name:'')||'—')}</td>${type==='tasks'?`<td>${esc(r.priority)}</td><td>${esc(r.endDate)}</td>`:''}</tr>`).join('')||'<tr><td colspan="5">No matching records.</td></tr>'}</tbody></table></div>`;
   }
   dialog.onclick=event=>{if(event.target.closest('[data-metric-close]'))dialog.close();const open=event.target.closest('[data-metric-open]');if(open){dialog.close();if(type==='tasks')window.TicketEditor?.open(open.dataset.metricOpen);else location.hash='project='+encodeURIComponent(open.dataset.metricOpen);}};
   dialog.oninput=event=>{if(event.target.matches('input')){query=event.target.value;const pos=event.target.selectionStart;draw();const input=dialog.querySelector('input');input.focus();input.setSelectionRange(pos,pos);}};
   dialog.onclose=()=>{dialog.remove();b.focus();};document.body.append(dialog);draw();dialog.showModal();
 },true);
 return {button,tasksFor};
})();
