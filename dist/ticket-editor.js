/* ProjectHub-style ticket editor for the Project Workspace.
   Self-contained: reads/writes the REST API, mirrors changes into window.Bootstrap
   so the surrounding views stay in sync. Exposes window.TicketEditor.open(idOrKey). */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (url, options = {}) => {
    const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error?.message || `Request failed (${res.status})`); }
    return res.status === 204 ? null : res.json();
  };
  const shortDate = d => d ? new Date((String(d).length === 10 ? d + 'T12:00:00' : d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const initials = n => (n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase() || '?';
  const clock = m => { const h = Math.floor((m || 0) / 60), r = (m || 0) % 60; return r ? `${h}h ${r}m` : `${h}h`; };
  const STATUS = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'];
  const PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
  const PRIORITY_TONE = { Critical: 'crit', High: 'high', Medium: 'med', Low: 'low' };
  const STATUS_TONE = { Backlog: 'gray', Todo: 'blue', 'In Progress': 'blue', Review: 'purple', Done: 'green' };
  const uid = p => p + '-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  let root, state = null, saved = null, draft = {}, tab = 'details', busy = false, openSequence = 0;
  let commentBody='', commentEdit=null, actor='', pendingLabel='', quickForm='';
  const editable=['name','priority','status','assigneeId','description','startDate','endDate','phase','kind','progress','estimateMinutes','labelIds'];
  function memberSelect(name,label,value=actor){
    return `<label class="te-field"><span>${label}</span><select name="${name}" required><option value="">Select a member</option>${(window.Bootstrap?.members||[]).filter(m=>m.active!==false).map(m=>`<option value="${esc(m.id)}" ${m.id===value?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`;
  }
  function showError(err){const el=root.querySelector('[data-te-feedback]');if(el){el.textContent=err.message||String(err);el.focus();}else alert(err.message)}
  async function mutate(work,message){
    if(busy)return;
    captureDraft();busy=true;
    root.querySelectorAll('button,input[type=file]').forEach(el=>el.disabled=true);
    try{await work();await refresh(true);toast(message);}
    catch(err){showError(err);}
    finally{busy=false;root.querySelectorAll('button,input[type=file]').forEach(el=>el.disabled=false);}
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ticket-editor';
    root.className = 'te-overlay hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.append(root);
    return root;
  }

  async function open(idOrKey) {
    if(busy)return;
    ensureRoot();
    const sequence=++openSequence;
    root.classList.remove('hidden');
    document.body.classList.add('te-open');
    root.innerHTML = '<div class="te-shell"><div class="te-loading">Loading ticket…</div></div>';
    try {
      const res = await api('/api/issues/' + encodeURIComponent(idOrKey) + '/detail');
      if(sequence!==openSequence)return;
      saved=structuredClone(res.data);state=res.data;draft={};commentBody='';commentEdit=null;pendingLabel='';quickForm='';
      actor=window.WorkspaceSettings?.read().member||'';
      state.timeTracking.estimateMinutes = state.timeTracking.estimateMinutes == null ? '' : state.timeTracking.estimateMinutes;
      tab = 'details';
      root.innerHTML='';render();
    } catch (err) {
      root.innerHTML = `<div class="te-shell"><div class="te-error"><p>${esc(err.message)}</p><button class="te-btn" data-te-close>Close</button></div></div>`;
    }
  }
  function close() { if(busy)return;captureDraft();if((Object.keys(draft).length||commentBody.trim()||pendingLabel.trim())&&!confirm('Discard unsaved ticket changes?'))return;++openSequence;if (root) { root.classList.add('hidden'); document.body.classList.remove('te-open'); } }

  function badge(tone, text) { return `<span class="te-badge te-${esc(tone)}">${esc(text)}</span>`; }

  function render() {
    const d = state;
    const key = d.ticketKey || d.id;
    const labels = (d.labels || []).map(l => `<span class="te-label" style="--te-label:${esc(l.color)}">${esc(l.name)}<button type="button" class="te-label-x" data-te-remove-label="${esc(l.id)}" aria-label="Remove ${esc(l.name)}">×</button></span>`).join('');
    const memberOptions = (window.Workspace && document.querySelector('#ticket-editor')) ? '' : '';
    root.innerHTML = `
    <div class="te-shell">
      <header class="te-head">
        <div class="te-crumb">
          <span>Projects</span><i>›</i><span>${esc(d.project?.name || '')}</span><i>›</i><span>Tickets</span><i>›</i><strong>${esc(key)}</strong>
        </div>
        <div class="te-head-actions">
          <button type="button" class="te-btn te-ghost" data-te-close>Cancel</button>
          <button type="button" class="te-btn te-primary" data-te-save>Save</button>
        </div>
      </header>
      <div class="te-title-row">
        <div class="te-title-block">
          <span class="te-key">${esc(key)}</span>
          <h1 class="te-title" data-te-title-text>${esc(d.name)}</h1>
          <div class="te-badges">
            ${badge(STATUS_TONE[d.status] || 'gray', d.status)}
            ${badge(PRIORITY_TONE[d.priority] || 'med', d.priority)}
            ${d.phase ? badge('soft', d.phase) : ''}
          </div>
        </div>
      </div>
      <p data-te-feedback class="te-feedback" role="alert" tabindex="-1"></p><div class="te-body">
        <div class="te-main">
          <nav class="te-tabs">
            ${tabBtn('details', 'Details')}
            ${tabBtn('comments', 'Comments', (d.comments || []).length)}
            ${tabBtn('attachments', 'Attachments', (d.attachments || []).length)}
            ${tabBtn('activity', 'Activity Log', (d.activity || []).length)}
          </nav>
          <div class="te-tabpane">${pane(d, memberOptions)}</div>
        </div>
        <div class="te-rail">${rail(d)}</div>
      </div>
    </div>`;
    const description=root.querySelector('[data-te-field=description]');if(description)TicketRichText.mount(description,{uploadImage});
  }
  function tabBtn(id, label, count) {
    return `<button type="button" class="te-tab ${tab === id ? 'is-active' : ''}" data-te-tab="${id}">${esc(label)}${count != null ? ` <span class="te-tab-count">${count}</span>` : ''}</button>`;
  }

  function pane(d) {
    if (tab === 'comments') return commentsPane(d);
    if (tab === 'attachments') return attachmentsPane(d);
    if (tab === 'activity') return activityPane(d);
    return detailsPane(d);
  }

  function field(label, name, value, type = 'text', opts = {}) {
    const req = opts.required ? 'required' : '';
    return `<label class="te-field"><span>${esc(label)}</span><input ${req} data-te-field="${name}" type="${type}" value="${esc(value == null ? '' : value)}"></label>`;
  }
  function selectField(label, name, value, options) {
    return `<label class="te-field"><span>${esc(label)}</span><select data-te-field="${name}">${options.map(o => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  }
  function detailsPane(d) {
    const members = (window.Workspace && window.Bootstrap?.members) || [];
    const memberOpts = `<option value="">Unassigned</option>` + members.filter(m => m.active !== false || m.id === d.assigneeId).map(m => `<option value="${esc(m.id)}"${m.id === d.assigneeId ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    const words = (d.description || '').trim() ? (d.description || '').trim().split(/\s+/).length : 0;
    return `
    <div class="te-grid">
      ${field('Title *', 'name', d.name, 'text', { required: true })}
      ${selectField('Priority *', 'priority', d.priority, PRIORITY)}
      <label class="te-field"><span>Project *</span><input type="text" value="${esc(d.project?.name || '')}" disabled></label>
      ${selectField('Status *', 'status', d.status, STATUS)}
      ${selectField('Phase', 'phase', d.phase, ['Discovery','Design','Development','Launch'])}
      <label class="te-field"><span>Assignee *</span><select data-te-field="assigneeId">${memberOpts}</select></label>
      ${selectField('Ticket type', 'kind', d.kind, d.project?.ticketTypes||[d.kind])}
      ${field('Start date','startDate',d.startDate,'date')}
      ${field('Due date', 'endDate', d.endDate, 'date')}
      ${field('Progress (%)','progress',d.progress,'number')}
      <label class="te-field"><span>Labels</span><div class="te-labels">${(d.labels || []).map(l => `<span class="te-label" style="--te-label:${esc(l.color)}">${esc(l.name)}<button type="button" class="te-label-x" data-te-remove-label="${esc(l.id)}">×</button></span>`).join('')}<input class="te-label-add" data-te-label-input maxlength="64" value="${esc(pendingLabel)}" placeholder="Add label…"></div></label>
    </div>
    <label class="te-field te-block"><span>Description *</span>
      <textarea data-te-field="description" rows="10" placeholder="Describe the issue…">${esc(d.description || '')}</textarea>
      <small class="te-hint"><span data-te-wordcount>${words}</span> words</small>
    </label>`;
  }

  function commentsPane(d) {
    const list = (d.comments || []).map(c => `
      <article class="te-comment">
        <span class="te-avatar" style="background:${esc(c.author?.avatarUrl ? 'transparent' : '#e7e2f3')}">${c.author?.avatarUrl ? `<img src="${esc(c.author.avatarUrl)}" alt="">` : esc(initials(c.author?.name))}</span>
        <div><div class="te-comment-head"><strong>${esc(c.author?.name || 'Unknown')}</strong><time>${esc(shortDate(c.createdAt))}</time></div>
        <p class="te-comment-text">${esc(c.body)}</p><button type="button" class="te-btn te-ghost" data-te-comment-edit="${esc(c.id)}">Edit</button><button type="button" class="te-btn te-ghost" data-te-comment-remove="${esc(c.id)}">Remove</button></div>
      </article>`).join('') || '<p class="te-empty">No comments yet.</p>';
    return `<div class="te-comments">
      <div class="te-comment-list">${list}</div>
      <form data-te-form="comment" class="te-comment-form">
        ${memberSelect('authorId','Comment author')}
        <textarea name="body" rows="3" maxlength="50000" placeholder="Add a comment…" required>${esc(commentBody)}</textarea>
        <div class="te-form-actions"><button class="te-btn te-primary" type="submit">${commentEdit?'Save comment':'Add comment'}</button>${commentEdit?'<button type="button" class="te-btn" data-te-comment-cancel>Cancel edit</button>':''}</div>
      </form></div>`;
  }

  function attachmentsPane(d) {
    const list = (d.attachments || []).map(a => `
      <article class="te-attachment">
        <span class="te-file fa-solid fa-paperclip" aria-hidden="true"></span>
        ${/^image\/(png|jpeg|webp)$/.test(a.mimeType||'')?`<a href="/api/documents/${esc(a.id)}/preview" target="_blank" rel="noopener"><img class="te-image-preview" src="/api/documents/${esc(a.id)}/preview" alt="${esc(a.name)}"></a>`:''}
        <div><strong>${esc(a.originalName || a.name)}</strong><small>${a.sizeBytes ? (Number(a.sizeBytes) / 1024 / 1024).toFixed(1) + ' MB' : 'note'} · ${esc(shortDate(a.createdAt))}</small></div>
        ${a.downloadUrl ? `<a class="te-btn te-ghost" href="${esc(a.downloadUrl)}">Download</a>` : ''}
        ${/^image\/(png|jpeg|webp)$/.test(a.mimeType||'')?`<button type="button" class="te-btn te-ghost" data-te-insert-image="${esc(a.id)}">Insert in description</button>`:''}
        <button type="button" class="te-btn te-ghost" data-te-file-remove="${esc(a.id)}">Remove</button>
      </article>`).join('') || '<p class="te-empty">No attachments yet.</p>';
    return `<div class="te-attachments"><div class="te-attachment-list">${list}</div>
      <label class="te-upload">Attach a file<input type="file" data-te-upload hidden></label></div>`;
  }

  function activityPane(d) {
    const list = (d.activity || []).map(a => `<li><time>${esc(shortDate(a.createdAt))}</time><span>${esc(a.summary || a.action)}</span></li>`).join('') || '<li class="te-empty">No activity recorded.</li>';
    return `<ul class="te-activity">${list}</ul>`;
  }

  function rail(d) {
    const t = d.timeTracking;
    const pct = t.estimateMinutes ? Math.min(100, Math.round((t.loggedMinutes / Number(t.estimateMinutes)) * 100)) : 0;
    const flow = ['Open', 'In Progress', 'Review', 'Done'];
    const idx = { Backlog: 0, Todo: 0, 'In Progress': 1, Review: 2, Done: 3 }[d.status] ?? 0;
    const steps = flow.map((s, i) => `<li class="${i <= idx ? 'is-done' : ''} ${i === idx ? 'is-current' : ''}"><i></i><span>${s}</span></li>`).join('');
    const linkRow = (items, empty) => items.length ? items.map(x => `<article class="te-link"><button type="button" class="te-btn te-ghost" data-te-open="${esc(x.id)}">${esc(x.ticketKey)} · ${esc(x.name)}</button><small>${esc(x.status)}</small></article>`).join('') : `<p class="te-empty">${empty}</p>`;
    return `
    <section class="te-rail-card"><h3>Ticket Progress</h3><ul class="te-flow">${steps}</ul></section>
    <section class="te-rail-card"><h3>Related Items</h3>
      <div class="te-related"><small>Project</small><p>${esc(d.project?.name || '—')}</p>
      <small>Phase</small><p>${esc(d.phase || '—')}</p>
      <small>Parent ticket</small>${linkRow(d.links?.parent || [], 'None')}
      <small>Subtasks</small>${linkRow(d.links?.children||[],'None')}
      <small>Related tickets</small>${linkRow(d.links?.related || [], 'None')}</div></section>
    <section class="te-rail-card"><h3>Time Tracking</h3>
      <div class="te-time">
        <div><small>Estimated</small><b>${t.estimateMinutes ? clock(Number(t.estimateMinutes)) : '—'}</b></div>
        <div><small>Logged</small><b>${clock(t.loggedMinutes)}</b></div>
        <label class="te-field"><span>Set estimate (minutes)</span><input data-te-field="estimateMinutes" type="number" min="0" max="1000000" value="${esc(d.estimateMinutes??t.estimateMinutes)}"></label>
        <div class="te-time-bar"><i style="width:${pct}%"></i><span>${pct}%</span></div>
        <form data-te-form="time" class="te-time-form">${memberSelect('memberId','Member logging time')}
          <input aria-label="Minutes to log" name="minutes" type="number" min="1" max="100000" placeholder="minutes" required>
          <input aria-label="Work date" name="spentOn" type="date" value="${esc(new Date().toISOString().slice(0, 10))}" required>
          <input name="note" type="text" placeholder="note (optional)" maxlength="500">
          <button class="te-btn te-ghost" type="submit">Log time</button>
        </form>
      <ul class="te-time-entries">${(t.entriesList||[]).map(entry=>`<li><b>${esc(entry.memberName||'Unassigned')} · ${clock(entry.minutes)}</b><small>${shortDate(entry.spentOn)} ${esc(entry.note||'')}</small><button type="button" class="te-btn te-ghost" data-te-time-remove="${esc(entry.id)}">Remove</button></li>`).join('')}</ul>
      </div></section>
    <section class="te-rail-card"><h3>Quick Actions</h3>
      <div class="te-quick">
        <button type="button" class="te-btn te-ghost" data-te-quick="comment">Add Comment</button>
        <button type="button" class="te-btn te-ghost" data-te-quick="attach">Attach File</button>
        <button type="button" class="te-btn te-ghost" data-te-quick="subtask">Create Subtask</button>
      </div>${quickForm==='subtask'?`<form data-te-form="subtask" class="te-subtask-form"><label class="te-field"><span>Subtask title</span><input name="name" maxlength="160" required></label><label class="te-field"><span>Type</span><select name="kind">${(d.project?.ticketTypes||['Task']).map(k=>`<option ${k==='Subtask'?'selected':''}>${esc(k)}</option>`).join('')}</select></label>${memberSelect('assigneeId','Assignee')}<button class="te-btn te-primary">Create subtask</button></form>`:''}</section>`;
  }

  // ---- interactions ----
  function captureDraft(){
    if(!state||!root||!saved)return;
    root.querySelectorAll('[data-te-field]').forEach(el=>{
      const key=el.dataset.teField;let value=el.value;
      if(key==='assigneeId'||key==='estimateMinutes')value=value===''?null:value;
      if(['estimateMinutes','progress'].includes(key)&&value!==null)value=Number(value);
      state[key]=value;
      if(JSON.stringify(value)!==JSON.stringify(saved[key]))draft[key]=value;else delete draft[key];
    });
    const label=root.querySelector('[data-te-label-input]');if(label)pendingLabel=label.value;
    const comment=root.querySelector('[data-te-form=comment] textarea');if(comment)commentBody=comment.value;
  }
  function onClick(e) {
    if(busy)return;
    captureDraft();
    const t = e.target;
    const tabBtnEl = t.closest('[data-te-tab]');
    if (tabBtnEl) { tab = tabBtnEl.dataset.teTab; render(); return; }
    if (t.closest('[data-te-close]')) { close(); return; }
    if (t.closest('[data-te-save]')) { save(); return; }
    const rm = t.closest('[data-te-remove-label]');
    if (rm) { state.labelIds = (state.labelIds || []).filter(id => id !== rm.dataset.teRemoveLabel); state.labels = (state.labels || []).filter(l => l.id !== rm.dataset.teRemoveLabel); draft.labelIds=[...state.labelIds];render(); return; }
    const image=t.closest('[data-te-insert-image]');
    if(image){
      const attachment=state.attachments.find(a=>a.id===image.dataset.teInsertImage);
      if(!attachment)return;
      state.description=TicketRichText.prefix+TicketRichText.sanitize(TicketRichText.html(state.description||'')+'<p><img src="/api/documents/'+attachment.id+'/preview" alt="'+esc(attachment.name)+'"></p><p><br></p>');
      draft.description=state.description;tab='details';render();toast('Image inserted. Save the ticket to keep this change.');return;
    }
    const linked=t.closest('[data-te-open]');
    if(linked){if(Object.keys(draft).length&&!confirm('Discard unsaved changes and open this ticket?'))return;open(linked.dataset.teOpen);return;}
    if(t.closest('[data-te-comment-cancel]')){commentEdit=null;commentBody='';render();return;}
    const edit=t.closest('[data-te-comment-edit]');
    if(edit){const c=state.comments.find(c=>c.id===edit.dataset.teCommentEdit);commentEdit=c;commentBody=c.body;actor=c.author?.id||'';render();return;}
    for(const [attr,type,list] of [['comment','comments',state.comments],['time','time_entries',state.timeTracking.entriesList],['file','documents',state.attachments]]){
      const button=t.closest(`[data-te-${attr}-remove]`);if(!button)continue;
      const id=button.getAttribute(`data-te-${attr}-remove`),item=list.find(x=>x.id===id);
      if(confirm('Remove this '+attr+'?'))mutate(()=>api('/api/'+type+'/'+encodeURIComponent(id)+'?version='+item.version,{method:'DELETE'}),'Removed');
      return;
    }
    const q = t.closest('[data-te-quick]');
    if (q) {
      if (q.dataset.teQuick === 'comment') tab = 'comments';
      if (q.dataset.teQuick === 'attach') tab = 'attachments';
      if(q.dataset.teQuick==='subtask')quickForm=quickForm?'':'subtask';
      render(); return;
    }
  }
  function onInput(e) {
    if (e.target.matches('[data-te-field="description"]')) {
      const wc = root.querySelector('[data-te-wordcount]');
      const v = e.target._rich?.querySelector('.rich-body').textContent.trim()||e.target.value.trim();
      if (wc) wc.textContent = v ? v.split(/\s+/).length : 0;
    }
  }
  async function uploadImage(file){
    if(busy)throw Error('Wait for the current save to finish.');
    captureDraft();busy=true;
    try{
      const data=new FormData();data.append('projectId',state.projectId);data.append('issueId',state.id);data.append('name',file.name.slice(0,160));data.append('file',file);
      const result=await api('/api/documents/upload',{method:'POST',body:data});
      state.attachments.push(result.data);
      const count=root.querySelector('[data-te-tab="attachments"] .te-tab-count');if(count)count.textContent=state.attachments.length;
      return {src:'/api/documents/'+result.data.id+'/preview'};
    }finally{busy=false;}
  }
  function onChange(e){
    if(e.target.name==='authorId'||e.target.name==='memberId')actor=e.target.value;
    if(!e.target.matches('[data-te-upload]')||!e.target.files[0])return;
    const file=e.target.files[0];e.target.value='';
    mutate(async()=>{
      const data=new FormData();data.append('projectId',state.projectId);data.append('issueId',state.id);data.append('name',file.name);data.append('file',file);
      await api('/api/documents/upload',{method:'POST',body:data});
    },'File attached');
  }
  async function onSubmit(e) {
    const form=e.target.closest('[data-te-form]');if(!form)return;e.preventDefault();if(busy||!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form)),kind=form.dataset.teForm;
    await mutate(async()=>{
      if(kind==='comment'){
        if(!data.body.trim())throw Error('Enter a comment.');
        const body={issueId:state.id,authorId:data.authorId,body:data.body.trim()};
        if(commentEdit)body.version=commentEdit.version;
        await api('/api/comments'+(commentEdit?'/'+encodeURIComponent(commentEdit.id):''),{method:commentEdit?'PATCH':'POST',body:JSON.stringify(body)});
        commentBody='';commentEdit=null;
      }else if(kind==='time'){
        await api('/api/time_entries',{method:'POST',body:JSON.stringify({issueId:state.id,memberId:data.memberId,minutes:Number(data.minutes),spentOn:data.spentOn,note:data.note||null})});
      }else if(kind==='subtask'){
        const result=await api('/api/issues/'+encodeURIComponent(state.id)+'/subtasks',{method:'POST',body:JSON.stringify({projectId:state.projectId,name:data.name.trim(),kind:data.kind,assigneeId:data.assigneeId||null,startDate:state.startDate,endDate:state.endDate,phase:state.phase})});
        window.Workspace?.acceptTicket?.(result.data);quickForm='';
      }
    },kind==='comment'?'Comment saved':kind==='time'?'Time logged':'Subtask created');
  }

  async function save(){
    if(busy)return;captureDraft();
    const invalid=[...root.querySelectorAll('[data-te-field]')].find(el=>!el.checkValidity());
    if(invalid){invalid.reportValidity();return;}
    busy=true;
    try{
      const body={version:saved.version,...draft};
      if(pendingLabel.trim()){
        const name=pendingLabel.trim();
        const result=await api('/api/labels?q='+encodeURIComponent(name)+'&pageSize=200');
        let label=result.data.find(l=>l.name.toLowerCase()===name.toLowerCase());
        if(!label)label=(await api('/api/labels',{method:'POST',body:JSON.stringify({name,color:'#6366f1'})})).data;
        body.labelIds=[...new Set([...(state.labelIds||[]),label.id])];
      }
      if(Object.keys(body).length>1)await api('/api/issues/'+encodeURIComponent(state.id),{method:'PATCH',body:JSON.stringify(body)});
      draft={};pendingLabel='';await refresh(false);toast('Ticket saved');
    }catch(err){showError(err);}
    finally{busy=false;}
  }

  async function refresh(preserve=true){
    const res=await api('/api/issues/'+encodeURIComponent(state.id)+'/detail');
    window.Workspace?.acceptTicket?.(res.data);
    const baseVersion=saved.version;
    saved=structuredClone(res.data);
    if(preserve&&Object.keys(draft).length)saved.version=baseVersion;
    state={...res.data,...(preserve?draft:{})};
    if(preserve&&draft.labelIds)state.labels=res.data.labels.filter(l=>draft.labelIds.includes(l.id));
    root.innerHTML='';render();
  }

  function applyToBootstrap() {
    window.Workspace?.acceptTicket?.(state);
    const B = window.Bootstrap; if (!B || !Array.isArray(B.issues)) return;
    const row = B.issues.find(i => i.id === state.id);
    if (row) Object.assign(row, { name: state.name, status: state.status, priority: state.priority, assigneeId: state.assigneeId, description: state.description, endDate: state.endDate, phase: state.phase, progress: state.progress });
    try { window.PlanningUI?.refresh?.(); } catch (_) {}
  }

  function toast(msg) {
    let el = document.querySelector('#te-toast');
    if (!el) { el = document.createElement('div'); el.id = 'te-toast'; el.className = 'te-toast'; document.body.append(el); }
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2600);
  }

  // Open the ProjectHub editor when a ticket is clicked anywhere in the workspace.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-bug-edit]');
    if (!b) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    open(b.dataset.bugEdit);
  }, true);

  window.TicketEditor = { open, close };
})();
