// Browser-only fake GitHub transport. Never sends writes to a real service.
module.exports = async function checkAdmin(page, realCapture=false) {
 return page.evaluate(async(realCapture)=>{
  const originalFetch=window.fetch, originalCapture=window.html2canvas, originalConfirm=window.confirm;
  const writes=[], fixtures={
   'calendar.json':{events:structuredClone(calEvents),offAir:structuredClone(calOffAir)},
   'nav.json':{hidden:[]}, 'tools.json':structuredClone(toolsData)
  };
  let reject=false;
  const token='fixture-token-not-a-real-credential';
  window.confirm=()=>true;
  if(!realCapture) window.html2canvas=async()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;return canvas;};
  window.fetch=async(url,options={})=>{
   if(!String(url).startsWith('https://api.github.com/repos/ststats/staruniv')) throw new Error('Unexpected fixture request');
   const method=options.method||'GET';
   if(reject) return new Response(JSON.stringify({message:'fixture permission denied'}),{status:403});
   if(method!=='GET') writes.push({url,method,body:JSON.parse(options.body)});
   let body;
   if(String(url).includes('/contents/')) {
    const name=String(url).split('/').pop();
    body=method==='GET'?{sha:'file-sha',content:btoa(unescape(encodeURIComponent(JSON.stringify(fixtures[name]))))}:{content:{sha:'saved'}};
   } else if(String(url).includes('/git/refs/')) body={object:{sha:'commit-sha'}};
   else if(String(url).endsWith('/git/blobs')) body={sha:'blob-sha'};
   else if(String(url).endsWith('/git/trees')) body={sha:'tree-sha'};
   else if(String(url).includes('/git/commits/')) body={tree:{sha:'tree-sha'}};
   else if(String(url).endsWith('/git/commits')) body={sha:'new-commit-sha'};
   else body={default_branch:'main'};
   return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  try {
   document.getElementById('githubToken').value=token;
   adminTokenStore.set(token);
   check((await Promise.all([loadDataFromGithub(),loadNavFromGithub(),loadToolsFromGithub()])).every(Boolean),'Authenticated load');
   const count=calEvents.length;
   document.getElementById('inputStartDate').value='2026-09-16';
   document.getElementById('inputPerson').value='검증 일정';
   document.getElementById('inputTime').value='19:00';
   addOrUpdateSchedule();
   check(calEvents.length===count+1,'Add schedule');
   const id=calEvents[calEvents.length-1].id;
   enterEditMode(id);document.getElementById('inputPerson').value='검증 수정';addOrUpdateSchedule();
   check(calEvents.find(e=>e.id===id).person==='검증 수정','Edit schedule');
   deleteSchedule(id);check(calEvents.length===count,'Delete schedule');
   const n=toolsData.extTools.items.length;
   document.getElementById('toolNameInput-extTools').value='검증 도구';
   document.getElementById('toolUrlInput-extTools').value='https://example.com/';
   addTool('extTools');check(toolsData.extTools.items.length===n+1,'Add tool');
   editTool('extTools',n);document.getElementById('toolNameInput-extTools').value='수정 도구';addTool('extTools');
   check(toolsData.extTools.items[n].name==='수정 도구','Edit tool');
   deleteTool('extTools',n);check(toolsData.extTools.items.length===n,'Delete tool');
   toggleNavItem('tier',false);await saveNavToGithub();await saveToolsToGithub();await saveAllToGithub();
   check(writes.some(w=>w.method==='PUT'&&w.url.endsWith('/nav.json')),'Save navigation');
   check(writes.some(w=>w.method==='PUT'&&w.url.endsWith('/tools.json')),'Save tools');
   check(writes.some(w=>w.method==='PATCH'&&w.url.includes('/git/refs/')),'Atomic calendar save');
   const countBefore=writes.length;
   reject=true;
   check(!(await loadDataFromGithub()),'Denied calendar load');
   await saveAllToGithub();check(writes.length===countBefore,'No save after failed load');
   check(!document.getElementById('saveAllBtn').disabled,'Save button restored');
   check(document.getElementById('captureToday').parentElement.classList.contains('admin-side'),'Capture layout restored');
   return {passed:true,imageBase64:realCapture?writes.find(w=>w.body.encoding==='base64')?.body.content:null,writes:writes.map(w=>({method:w.method,path:w.url.replace('https://api.github.com/repos/ststats/staruniv','')}))};
  } finally {
   window.fetch=originalFetch;window.html2canvas=originalCapture;window.confirm=originalConfirm;adminTokenStore.clear();document.getElementById('githubToken').value='';
  }
 },realCapture);
};
