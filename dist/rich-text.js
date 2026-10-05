/* Versioned rich descriptions; legacy descriptions remain plain text. */
window.TicketRichText = (() => {
  const prefix = '<!--project-rich-text:v1-->';
  const allowed = new Set(['P','DIV','BR','STRONG','B','EM','I','U','S','STRIKE','H2','H3','UL','OL','LI','BLOCKQUOTE','PRE','CODE','A','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CAPTION','IMG']);
  const imagePath = /^\/api\/documents\/[A-Za-z0-9_-]{1,64}\/preview$/;
  function sanitize(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html'), out = document.createElement('div');
    function copy(node, parent) {
      if (node.nodeType === 3) { parent.append(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName)) return;
      if (!allowed.has(node.tagName)) { for (const child of node.childNodes) copy(child, parent); return; }
      if (node.tagName === 'IMG' && !imagePath.test(node.getAttribute('src') || '')) return;
      const el = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^(https?:\/\/|mailto:)/i.test(href) || imagePath.test(href)) { el.setAttribute('href', href); el.setAttribute('rel', 'noopener noreferrer'); }
      }
      if (node.tagName === 'IMG') {
        el.setAttribute('src', node.getAttribute('src'));
        el.setAttribute('alt', (node.getAttribute('alt') || 'Ticket image').slice(0, 255));
      }
      if (['TD','TH'].includes(node.tagName)) {
        for (const attr of ['colspan','rowspan']) {
          const value = Number(node.getAttribute(attr));
          if (Number.isInteger(value) && value > 1 && value <= 20) el.setAttribute(attr, value);
        }
      }
      for (const child of node.childNodes) copy(child, el);
      parent.append(el);
    }
    for (const child of doc.body.childNodes) copy(child, out);
    return out.innerHTML;
  }
  function html(value = '') {
    if (value.startsWith(prefix)) return sanitize(value.slice(prefix.length));
    const el = document.createElement('div'); el.textContent = value;
    return el.innerHTML.replaceAll('\n', '<br>');
  }
  function mount(textarea, options = {}) {
    textarea._rich?.remove();
    const box = document.createElement('div'); box.className = 'ticket-rich';
    box.innerHTML = '<div class="rich-toolbar" role="toolbar" aria-label="Description formatting"></div><div class="rich-body" contenteditable="true" role="textbox" aria-label="Ticket description" aria-multiline="true"></div><div class="rich-status" role="status"></div><div class="rich-count"></div>';
    textarea.after(box); textarea.hidden = true; textarea._rich = box;
    const body = box.querySelector('.rich-body'), toolbar = box.firstElementChild, status = box.querySelector('.rich-status');
    body.innerHTML = html(textarea.value || '');
    let range, uploading = false;
    function remember() { const s = getSelection(); if (s.rangeCount && body.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); }
    function restore() {
      body.focus(); const s = getSelection();
      if (!range || !body.contains(range.commonAncestorContainer)) { range = document.createRange(); range.selectNodeContents(body); range.collapse(false); }
      s.removeAllRanges(); s.addRange(range);
    }
    function count() { box.querySelector('.rich-count').textContent = (body.textContent.trim().match(/\S+/g) || []).length + ' words'; }
    function sync() { textarea.value = prefix + sanitize(body.innerHTML); textarea.dispatchEvent(new Event('input', { bubbles: true })); count(); remember(); }
    function insert(source) { restore(); document.execCommand('insertHTML', false, sanitize(source)); sync(); }
    const toolbarIcons={Paragraph:'paragraph',Heading:'heading',Bold:'bold',Italic:'italic',Underline:'underline',Strike:'strikethrough',Bullets:'list-ul','Numbered list':'list-ol',Quote:'quote-left',Code:'code',Link:'link',Undo:'rotate-left',Redo:'rotate-right','Insert table':'table','Add row':'table-list','Add column':'table-columns','Remove table':'table','Insert image':'image'};
    function button(label, action) {
      const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      const icon=document.createElement('span');icon.className='fa-solid fa-'+toolbarIcons[label];icon.setAttribute('aria-hidden','true');b.append(icon);
      if(['Add row','Add column','Remove table'].includes(label)){const badge=document.createElement('span');badge.className='rich-icon-badge';badge.setAttribute('aria-hidden','true');badge.textContent=label==='Remove table'?'−':'+';b.append(badge);}
      b.onmousedown = e => e.preventDefault(); b.onclick = () => { if (!uploading) action(); }; toolbar.append(b); return b;
    }
    for (const [label, command, value] of [['Paragraph','formatBlock','p'],['Heading','formatBlock','h2'],['Bold','bold'],['Italic','italic'],['Underline','underline'],['Strike','strikeThrough'],['Bullets','insertUnorderedList'],['Numbered list','insertOrderedList'],['Quote','formatBlock','blockquote'],['Code','formatBlock','pre'],['Link','createLink'],['Undo','undo'],['Redo','redo']]) {
      button(label, () => {
        restore(); let arg = value;
        if (command === 'createLink') { linkPanel.hidden = !linkPanel.hidden; linkInput.focus(); return; }
        document.execCommand(command, false, arg); sync();
      });
    }
    const linkPanel=document.createElement('div');linkPanel.className='rich-insert-panel';linkPanel.hidden=true;
    linkPanel.innerHTML='<input type="url" aria-label="Link URL" placeholder="https://example.com"><button type="button">Apply link</button>';
    toolbar.after(linkPanel);
    const linkInput=linkPanel.querySelector('input');
    linkPanel.querySelector('button').onclick=()=>{
      const url=linkInput.value.trim();
      if(!/^(https?:\/\/|mailto:)/i.test(url)){status.textContent='Use an http, https or mailto link.';return;}
      restore();document.execCommand('createLink',false,url);sync();linkPanel.hidden=true;
    };
    const tablePanel=document.createElement('div');tablePanel.className='rich-insert-panel';tablePanel.hidden=true;
    tablePanel.innerHTML='<label>Rows <input aria-label="Table rows" type="number" min="1" max="20" value="3"></label><label>Columns <input aria-label="Table columns" type="number" min="1" max="10" value="3"></label><button type="button">Create table</button>';
    toolbar.after(tablePanel);
    button('Insert table',()=>{remember();tablePanel.hidden=!tablePanel.hidden;});
    tablePanel.querySelector('button').onclick=()=>{
      const [rowInput,colInput]=tablePanel.querySelectorAll('input');
      const rows=Number(rowInput.value),cols=Number(colInput.value);
      if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||rows>20||cols<1||cols>10){status.textContent='Choose 1–20 rows and 1–10 columns.';return;}
      insert('<table><tbody>' + Array.from({ length: rows }, (_, r) => '<tr>' + Array.from({ length: cols }, () => r === 0 ? '<th>Heading</th>' : '<td>Cell</td>').join('') + '</tr>').join('') + '</tbody></table><p><br></p>');
      tablePanel.hidden=true;
    };
    function tableSelection() {
      restore(); const node = getSelection().anchorNode;
      const cell = (node.nodeType === 1 ? node : node.parentElement)?.closest('td,th');
      if (!cell || !body.contains(cell)) { status.textContent = 'Place the cursor in a table cell first.'; return; }
      return cell;
    }
    button('Add row', () => {
      const cell = tableSelection(); if (!cell) return;
      const row = document.createElement('tr');
      for (const original of cell.parentElement.cells) { const td = document.createElement('td'); td.innerHTML = '<br>'; td.colSpan = original.colSpan; row.append(td); }
      cell.parentElement.after(row); sync();
    });
    button('Add column', () => {
      const cell = tableSelection(); if (!cell) return;
      for (const row of cell.closest('table').rows) {
        const td = document.createElement(row.cells[0]?.tagName === 'TH' ? 'th' : 'td'); td.innerHTML = '<br>'; row.append(td);
      }
      sync();
    });
    button('Remove table', () => { const cell = tableSelection(); if (cell) { cell.closest('table').remove(); range = null; sync(); } });
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp'; fileInput.hidden = true; box.append(fileInput);
    const imageButton = button('Insert image', () => { remember(); fileInput.click(); });
    if (!options.uploadImage) { imageButton.disabled = true; imageButton.title = 'Save the new ticket first, then open it to insert images.'; }
    async function upload(file) {
      if (uploading || !options.uploadImage) return;
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { status.textContent = 'Choose a PNG, JPEG or WebP image.'; return; }
      if (file.size > 26214400) { status.textContent = 'Choose an image smaller than 25 MB.'; return; }
      uploading = true; body.contentEditable = 'false'; status.textContent = 'Uploading image…';
      toolbar.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        const image = await options.uploadImage(file);
        if (!imagePath.test(image.src)) throw Error('Invalid image location.');
        const img = document.createElement('img'); img.src = image.src; img.alt = file.name;
        body.contentEditable = 'true'; insert('<p>' + img.outerHTML + '</p><p><br></p>');
        status.textContent = 'Image attached. Save the ticket to keep its position in the description.';
      } catch (err) { status.textContent = err.message || 'Image upload failed. Try again.'; }
      finally { uploading = false; body.contentEditable = 'true'; toolbar.querySelectorAll('button').forEach(b => b.disabled = false); }
    }
    fileInput.onchange = () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) upload(file); };
    body.onkeyup = remember; body.onmouseup = remember; body.oninput = sync;
    body.onpaste = e => {
      e.preventDefault(); remember();
      const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
      if (file) { if (options.uploadImage) upload(file); else status.textContent = 'Save the new ticket first to paste images.'; return; }
      const source = e.clipboardData.getData('text/html');
      if (source) insert(source); else { restore(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); sync(); }
    };
    body.ondrop = e => { e.preventDefault(); const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (file) upload(file); };
    body.ondblclick = e => {
      if (e.target.tagName !== 'IMG') return;
      const dialog = document.createElement('dialog'); dialog.className = 'ticket-image-viewer';
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close image'; close.onclick = () => dialog.close();
      const img = document.createElement('img'); img.src = e.target.getAttribute('src'); img.alt = e.target.alt;
      dialog.append(close, img); document.body.append(dialog); dialog.onclose = () => dialog.remove(); dialog.showModal();
    };
    count(); return box;
  }
  return { mount, sanitize, html, prefix };
})();
