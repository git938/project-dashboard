(async()=>{
  const overlay=document.createElement('div');overlay.className='boot-overlay';overlay.setAttribute('role','status');overlay.innerHTML='<div><h2>Opening your workspace</h2><p>Connecting to the project database…</p></div>';document.body.append(overlay);
  const script=src=>new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('Could not load '+src));document.body.append(el)});
  try{
    await script('/api-client.js');window.Bootstrap=await ProjectAPI.load();
    for(const file of ['/app.js','/planning-core.js','/planning.js','/project-charter.js','/project-tools.js','/team-map.js','/project-detail.js','/project-dashboard.js','/project-overview.js','/portfolio.js','/weekly-report.js','/risk-management.js','/settings.js','/workspace.js'])await script(file);
    overlay.remove();
  }catch(error){overlay.innerHTML='';const box=document.createElement('div'),h=document.createElement('h2'),p=document.createElement('p'),button=document.createElement('button');h.textContent='The workspace could not connect';p.textContent=error.message+' Start the backend and MySQL, then try again.';button.textContent='Try again';button.onclick=()=>location.reload();box.append(h,p,button);overlay.append(box);}
})();
