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

  let root, state = null, tab = 'details', busy = false;

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
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.append(root);
    return root;
  }

  async function open(idOrKey) {
    ensureRoot();
    root.classList.remove('hidden');
    document.body.classList.add('te-open');
    root.innerHTML = '<div class="te-shell"><div class="te-loading">Loading ticket…</div></div>';
    try {
      const res = await api('/api/issues/' + encodeURIComponent(idOrKey) + '/detail');
      state = res.data;
      state.timeTracking.estimateMinutes = state.timeTracking.estimateMinutes == null ? '' : state.timeTracking.estimateMinutes;
      tab = 'details';
      render();
    } catch (err) {
      root.innerHTML = `<div class="te-shell"><div class="te-error"><p>${esc(err.message)}</p><button class="te-btn" data-te-close>Close</button></div></div>`;
    }
  }
  function close() { if (root) { root.classList.add('hidden'); document.body.classList.remove('te-open'); } }

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
      <div class="te-body">
        <div class="te-main">
          <nav class="te-tabs">
            ${tabBtn('details', 'Details')}
            ${tabBtn('comments', 'Comments', (d.comments || []).length)}
            ${tabBtn('attachments', 'Attachments', (d.attachments || []).length)}
            ${tabBtn('activity', 'Activity Log', (d.activity || []).length)}
          </nav>
          <div class="te-tabpane">${pane(d, memberOptions)}</div>
        </div>
        <aside class="te-rail">${rail(d)}</aside>
      </div>
    </div>`;
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
      ${field('Milestone (phase)', 'phase', d.phase || '', 'text')}
      <label class="te-field"><span>Assignee *</span><select data-te-field="assigneeId">${memberOpts}</select></label>
      ${field('Due date', 'endDate', d.endDate, 'date')}
      <label class="te-field"><span>Labels</span><div class="te-labels">${(d.labels || []).map(l => `<span class="te-label" style="--te-label:${esc(l.color)}">${esc(l.name)}<button type="button" class="te-label-x" data-te-remove-label="${esc(l.id)}">×</button></span>`).join('')}<input class="te-label-add" data-te-label-input placeholder="Add label…"></div></label>
    </div>
    <label class="te-field te-block"><span>Description *</span>
      <textarea data-te-field="description" rows="10" placeholder="Describe the issue…">${esc(d.description || '')}</textarea>
      <small class="te-hint"><span data-te-wordcount>${words}</span> words · use plain text</small>
    </label>`;
  }

  function commentsPane(d) {
    const list = (d.comments || []).map(c => `
      <article class="te-comment">
        <span class="te-avatar" style="background:${esc(c.author?.avatarUrl ? 'transparent' : '#e7e2f3')}">${c.author?.avatarUrl ? `<img src="${esc(c.author.avatarUrl)}" alt="">` : esc(initials(c.author?.name))}</span>
        <div><div class="te-comment-head"><strong>${esc(c.author?.name || 'Unknown')}</strong><time>${esc(shortDate(c.createdAt))}</time></div>
        <p>${esc(c.body)}</p></div>
      </article>`).join('') || '<p class="te-empty">No comments yet.</p>';
    return `<div class="te-comments">
      <div class="te-comment-list">${list}</div>
      <form data-te-form="comment" class="te-comment-form">
        <textarea name="body" rows="3" placeholder="Add a comment…" required></textarea>
        <div class="te-form-actions"><button class="te-btn te-primary" type="submit">Add comment</button></div>
      </form></div>`;
  }

  function attachmentsPane(d) {
    const list = (d.attachments || []).map(a => `
      <article class="te-attachment">
        <span class="te-file">${a.kind === 'file' ? '📎' : '≡'}</span>
        <div><strong>${esc(a.originalName || a.name)}</strong><small>${a.sizeBytes ? (Number(a.sizeBytes) / 1024 / 1024).toFixed(1) + ' MB' : 'note'} · ${esc(shortDate(a.createdAt))}</small></div>
        ${a.downloadUrl ? `<a class="te-btn te-ghost" href="${esc(a.downloadUrl)}">Download</a>` : ''}
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
    const linkRow = (items, empty) => items.length ? items.map(x => `<article class="te-link"><span class="te-tag">${esc(x.ticketKey)}</span><span>${esc(x.name)}</span><small>${esc(x.status)}</small></article>`).join('') : `<p class="te-empty">${empty}</p>`;
    return `
    <section class="te-rail-card"><h3>Ticket Progress</h3><ul class="te-flow">${steps}</ul></section>
    <section class="te-rail-card"><h3>Related Items</h3>
      <div class="te-related"><small>Project</small><p>${esc(d.project?.name || '—')}</p>
      <small>Milestone</small><p>${esc(d.phase || '—')}</p>
      <small>Parent ticket</small>${linkRow(d.links?.parent || [], 'None')}
      <small>Related tickets</small>${linkRow(d.links?.related || [], 'None')}</div></section>
    <section class="te-rail-card"><h3>Time Tracking</h3>
      <div class="te-time">
        <div><small>Estimated</small><b>${t.estimateMinutes ? clock(Number(t.estimateMinutes)) : '—'}</b></div>
        <div><small>Logged</small><b>${clock(t.loggedMinutes)}</b></div>
        <label class="te-field"><span>Set estimate (minutes)</span><input data-te-field="estimateMinutes" type="number" min="0" max="1000000" value="${esc(t.estimateMinutes)}"></label>
        <div class="te-time-bar"><i style="width:${pct}%"></i><span>${pct}%</span></div>
        <form data-te-form="time" class="te-time-form">
          <input name="minutes" type="number" min="1" max="100000" placeholder="minutes" required>
          <input name="spentOn" type="date" value="${esc(new Date().toISOString().slice(0, 10))}" required>
          <input name="note" type="text" placeholder="note (optional)" maxlength="500">
          <button class="te-btn te-ghost" type="submit">Log time</button>
        </form>
      </div></section>
    <section class="te-rail-card"><h3>Quick Actions</h3>
      <div class="te-quick">
        <button type="button" class="te-btn te-ghost" data-te-quick="comment">Add Comment</button>
        <button type="button" class="te-btn te-ghost" data-te-quick="attach">Attach File</button>
        <button type="button" class="te-btn te-ghost" data-te-quick="subtask" disabled title="Coming soon">Create Subtask</button>
      </div></section>`;
  }

  // ---- interactions ----
  function onClick(e) {
    const t = e.target;
    const tabBtnEl = t.closest('[data-te-tab]');
    if (tabBtnEl) { tab = tabBtnEl.dataset.teTab; render(); return; }
    if (t.closest('[data-te-close]')) { close(); return; }
    if (t.closest('[data-te-save]')) { save(); return; }
    const rm = t.closest('[data-te-remove-label]');
    if (rm) { state.labelIds = (state.labelIds || []).filter(id => id !== rm.dataset.teRemoveLabel); state.labels = (state.labels || []).filter(l => l.id !== rm.dataset.teRemoveLabel); render(); return; }
    const q = t.closest('[data-te-quick]');
    if (q) {
      if (q.dataset.teQuick === 'comment') tab = 'comments';
      if (q.dataset.teQuick === 'attach') tab = 'attachments';
      render(); return;
    }
  }
  function onInput(e) {
    if (e.target.matches('[data-te-field="description"]')) {
      const wc = root.querySelector('[data-te-wordcount]');
      const v = e.target.value.trim();
      if (wc) wc.textContent = v ? v.split(/\s+/).length : 0;
    }
  }
  async function onSubmit(e) {
    const form = e.target.closest('[data-te-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.teForm;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (kind === 'comment') {
        if (!data.body?.trim()) return;
        await api('/api/comments', { method: 'POST', body: JSON.stringify({ id: uid('cmt'), issueId: state.id, authorId: 'openclaw', body: data.body.trim() }) });
      } else if (kind === 'time') {
        await api('/api/time_entries', { method: 'POST', body: JSON.stringify({ id: uid('te'), issueId: state.id, memberId: 'openclaw', minutes: Number(data.minutes), spentOn: data.spentOn, note: data.note || null }) });
      }
      await refresh();
    } catch (err) { alert(err.message); }
  }

  async function save() {
    if (busy) return; busy = true;
    const get = n => root.querySelector(`[data-te-field="${n}"]`);
    try {
      const body = { version: state.version };
      for (const n of ['name', 'priority', 'status', 'assigneeId', 'description', 'endDate']) { const el = get(n); if (el) body[n] = el.value === '' && n === 'assigneeId' ? null : el.value; }
      const phase = get('phase'); if (phase) body.phase = phase.value || null;
      const labelInput = root.querySelector('[data-te-label-input]');
      if (labelInput && labelInput.value.trim()) {
        const name = labelInput.value.trim();
        const existing = ((window.Bootstrap?.labels) || []).find(l => l.name.toLowerCase() === name.toLowerCase());
        let labelId = existing?.id;
        if (!labelId) labelId = (await api('/api/labels', { method: 'POST', body: JSON.stringify({ id: uid('lbl'), name, color: '#6366f1' }) })).data.id;
        body.labelIds = Array.from(new Set([...(state.labelIds || []), labelId]));
      }
      if ('assigneeId' in body && body.assigneeId == null) body.assigneeId = null;
      const est = get('estimateMinutes');
      if (est) body.estimateMinutes = est.value === '' ? null : Number(est.value);
      await api('/api/issues/' + encodeURIComponent(state.id), { method: 'PATCH', body: JSON.stringify(body) });
      await refresh();
      toast('Ticket saved');
      applyToBootstrap();
    } catch (err) { alert(err.message); }
    finally { busy = false; }
  }

  async function refresh() {
    const res = await api('/api/issues/' + encodeURIComponent(state.id) + '/detail');
    state = res.data;
    state.timeTracking.estimateMinutes = state.timeTracking.estimateMinutes == null ? '' : state.timeTracking.estimateMinutes;
    render();
    applyToBootstrap();
  }

  function applyToBootstrap() {
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
