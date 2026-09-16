const fs=require('fs'), assert=require('assert/strict'), puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<div class="avatar-select-live" data-soop-id="on" hidden></div><div class="avatar-select-live" data-soop-id="off" hidden></div><div class="selection-content"><div id="news-feed-content"><div id="news-past-list"><div class="home-notice-card">one</div><div class="home-notice-card">two</div></div></div></div>');
  await page.addStyleTag({content:fs.readFileSync('docs/style.css','utf8')});
  const core=fs.readFileSync('templates/assets/core.js','utf8');
  const fn=core.slice(core.indexOf('async function refreshSidebarLiveIndicators()'),core.indexOf('// =====================================================================',core.indexOf('async function refreshSidebarLiveIndicators()')));
  await page.evaluate(fn=>{
   window.fetch=async()=>{throw new Error('Fixture: use direct fallback');};
   window.checkIsLiveRealtime=async id=>id==='on'?{broad:{broad_no:1}}:null;
   window.eval(fn);
  },fn);
  await page.evaluate(()=>refreshSidebarLiveIndicators());
  const live=await page.evaluate(()=>Array.from(document.querySelectorAll('.avatar-select-live')).map(e=>({hidden:e.hidden,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  assert.deepEqual(live,[{hidden:false,width:5,height:5},{hidden:true,width:0,height:0}]);
  // A sidebar may be rebuilt while the request is pending.
  await page.evaluate(async()=>{
   window.checkIsLiveRealtime=()=>new Promise(r=>window.resolveLive=r);
   document.querySelector('[data-soop-id="off"]').remove();
   const pending=refreshSidebarLiveIndicators();
   await new Promise(r=>setTimeout(r,0));
   document.querySelector('[data-soop-id="on"]').outerHTML='<div class="avatar-select-live" data-soop-id="on" hidden></div>';
   resolveLive({broad:{broad_no:1}});await pending;
  });
  assert.equal(await page.$eval('.avatar-select-live',e=>e.hidden),false);
  for(const width of [390,1280]) {
   await page.setViewport({width,height:800});
   await page.$eval('#news-feed-content',(e,mobile)=>e.classList.toggle('news-feed-mobile',mobile),width===390);
   const clips=await page.$$eval('.home-notice-card',els=>els.map(e=>getComputedStyle(e).clipPath));
   assert(clips.every((c,i)=>width===390||i===0?c.startsWith('polygon'):c==='none'));
  }
  assert(fs.readFileSync('docs/records/index.html','utf8').includes('soop.js?'));
  const admin=fs.readFileSync('docs/admin.html','utf8');
  assert(admin.includes('value="#9aa6ba"')&&admin.includes('value="#6b7280"'));
  assert(fs.readFileSync('docs/calendar.js','utf8').includes("CAL_YOUNHWAN_COLOR = '#111318'"));
  const navFn=core.slice(core.indexOf('async function applyNavVisibility()'),core.indexOf('// 페이지 시작:',core.indexOf('async function applyNavVisibility()')));
  await page.addStyleTag({content:'html[data-nav-pending] #mainMenu { visibility: hidden; }'});
  await page.evaluate(async fn=>{
   document.body.insertAdjacentHTML('beforeend','<div class="top-navbar"><nav id="mainMenu" class="nav-menu"><a class="nav-item active" data-page="tools">도구</a><a class="nav-item" data-page="schedule">일정</a></nav></div>');
   document.documentElement.dataset.navPending='';
   if(getComputedStyle(document.getElementById('mainMenu')).visibility!=='hidden')throw new Error('Menu flashed while pending');
   window.fetch=async()=>({ok:true,json:async()=>({hidden:['tools']})});
   window.eval(fn);await applyNavVisibility();
   if(getComputedStyle(document.querySelector('[data-page="tools"]')).display!=='none')throw new Error('Hidden active menu exposed');
   if(document.documentElement.hasAttribute('data-nav-pending'))throw new Error('Menu pending not cleared');
  },navFn);
  console.log('PASS: live/offline visibility, sidebar rebuild race, desktop/mobile notches, records dependency, calendar colors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
