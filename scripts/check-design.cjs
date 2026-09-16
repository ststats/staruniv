const fs=require('fs'), path=require('path'), http=require('http');
const puppeteer=require('puppeteer');
const candidate=fs.readFileSync('build/design-audit/style.candidate.css','utf8');
const server=http.createServer((req,res)=>{
  let p=path.join(process.cwd(),'docs',decodeURIComponent(req.url.split('?')[0]));
  if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');
  if(!fs.existsSync(p)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.html':'text/html','.json':'application/json'})[path.extname(p)]||'application/octet-stream');
  res.end(fs.readFileSync(p));
});
(async()=>{
 await new Promise(r=>server.listen(8795,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 const results=[];
 try {
 for(const route of ['','schedule/','members/','records/','stats/','tier/','tools/','admin.html','multiview.html']) {
  const page=await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('http://127.0.0.1:8795/')||r.resourceType()==='stylesheet'||r.resourceType()==='font'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:8795/'+route,{waitUntil:'networkidle2',timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;const last=setInterval(()=>{},999999);for(let i=1;i<=last;i++)clearInterval(i);document.querySelectorAll('[id^="view-"]').forEach(e=>e.classList.remove('d-none'));document.querySelectorAll('*').forEach(e=>{e.style.animation='none';e.style.transition='none';});});
  const sheet=await page.evaluate(()=>Array.from(document.styleSheets).findIndex(s=>s.href&&s.href.includes('/style.css')));
  await page.evaluate(async()=>{const imgs=Array.from(document.images);imgs.forEach(i=>i.loading='eager');await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));});
  const inlineCandidate=route.endsWith('.html')?fs.readFileSync('build/design-audit/'+route.replace('.html','.candidate.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1]:null;
  for(const width of [390,768,1280]) for(const theme of ['light','dark']) {
   await page.setViewport({width,height:900});
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const snapshot=()=>page.evaluate(()=>{window.auditSnapshot=()=>Array.from(document.querySelectorAll('body,body *')).flatMap((el,i)=>['','::before','::after'].map(p=>{
    const s=getComputedStyle(el,p);const keys='display position top right bottom left z-index width height min-width min-height max-width max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left gap row-gap column-gap flex flex-direction flex-wrap order align-items align-self align-content justify-content grid-template-columns grid-template-rows grid-column grid-row color background-color background-image border-top border-right border-bottom border-left border-radius clip-path box-shadow opacity visibility overflow-x overflow-y font-family font-size font-weight line-height letter-spacing text-align text-decoration white-space transform content box-sizing'.split(' ');return {el:i+':'+el.tagName+'.'+el.className+p,values:Object.fromEntries(keys.map(k=>[k,s.getPropertyValue(k)]))};
   }));window.auditBefore=auditSnapshot();return auditBefore.length;});
   const before=await snapshot();
   await page.evaluate((css,index)=>{window.originalSheet=document.styleSheets[index];originalSheet.disabled=true;const s=document.createElement('style');s.id='audit-candidate';s.textContent=css;originalSheet.ownerNode.before(s);},candidate,sheet);
   if(inlineCandidate)await page.evaluate(css=>{window.auditInline=document.querySelector('style:not(#audit-candidate)');window.auditInlineOriginal=auditInline.textContent;auditInline.textContent=css;},inlineCandidate);
   const diffs=await page.evaluate(()=>{const after=auditSnapshot();return auditBefore.flatMap((x,i)=>{const props=Object.keys(x.values).filter(k=>x.values[k]!==after[i]?.values[k]);return props.length?[{el:x.el,props:props.map(k=>[k,x.values[k],after[i]?.values[k]])}]:[];});});
   results.push({route,width,theme,elements:before/3,diffs});
   await page.evaluate(()=>{document.getElementById('audit-candidate').remove();originalSheet.disabled=false;});
   if(inlineCandidate)await page.evaluate(()=>auditInline.textContent=auditInlineOriginal);
  }
  console.log(route||'home',results.slice(-6).map(r=>r.diffs.length).join(','));
  fs.writeFileSync('build/design-audit/verification.json',JSON.stringify(results,null,2));
  await page.close();
 }
 } finally {await browser.close();server.close();}
 fs.writeFileSync('build/design-audit/verification.json',JSON.stringify(results,null,2));
 if(results.some(r=>r.diffs.length))process.exitCode=1;
})();
