const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict'), puppeteer = require('puppeteer');
const data = JSON.parse(fs.readFileSync('docs/data/site_data.json', 'utf8'));
const out = 'build/requested-fixes';
fs.mkdirSync(out, {recursive:true});
const server = http.createServer((req,res)=>{
 let file = path.join(process.cwd(),'docs',decodeURIComponent(req.url.split('?')[0]));
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
 if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
const results=[];
(async()=>{
 await new Promise(r=>server.listen(8797,r));
 const browser=await puppeteer.launch({headless:true});
 try {
  for(const width of (process.env.NARROW_ONLY?[320]:[390,1280])) for(const theme of ['light','dark']) {
   const headers=[],orders=[];
   for(const route of (process.env.CAPTURE_REAL?['admin.html']:['', 'schedule/','members/','records/?view=solo','stats/','tier/','tools/?view=multiview','multiview.html','admin.html'])) {
    const page=await browser.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    await page.setViewport({width,height:900});
    await page.evaluateOnNewDocument(theme=>{localStorage.setItem('staruniv-theme',theme);localStorage.setItem('mv-theme',theme);},theme);
    await page.setRequestInterception(true);
    page.on('request',r=>{
     const url=r.url();
     const headers={'Access-Control-Allow-Origin':'*'};
     if(url.includes('synergy.ststats.workers.dev')) return r.respond({headers,contentType:'application/json',body:JSON.stringify({live:Object.fromEntries(data.members.filter((_,i)=>i%2===0).map(m=>[m['SOOP ID'],{broad_no:123,broad_title:'테스트 방송'}]))})});
     if(url.includes('/data/dates.js')) return r.respond({headers,body:'window.AVAILABLE_DATES = ["2026-09-16"];'});
     if(url.includes('/data/daily/')) return r.respond({headers,contentType:'application/json',body:JSON.stringify({updated_at:'2026-09-16 12:34:56',members:data.members.map((m,i)=>({id:m['SOOP ID'],nickname:m['이름'],team:'캄몬스타즈',tier:String(i%9),race:'Z',balloons:10000,broadcast_seconds:1000,cumulative_viewers:500,sponsor_wins:1,sponsor_losses:1}))})});
     if(url.startsWith('http://localhost:8797/')||['stylesheet','font'].includes(r.resourceType())||url.includes('bootstrap.bundle')||(process.env.CAPTURE_REAL&&url.includes('html2canvas'))) return r.continue();
     return r.abort();
    });
    await page.goto('http://localhost:8797/'+route,{waitUntil:'domcontentloaded'});
    await page.waitForNetworkIdle({idleTime:300,timeout:4000}).catch(()=>{});
    await page.addStyleTag({content:'* {transition:none!important;animation:none!important;}'});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.bsTheme=theme;},theme);
    if(route==='members/') {
     await page.evaluate(()=>switchMemberView('news'));
     await page.waitForNetworkIdle({idleTime:300,timeout:4000}).catch(()=>{});
     await page.evaluate(()=>{
     const avatar=document.querySelector('.member-card .member-avatar-img');
     if(!avatar||getComputedStyle(avatar).boxShadow==='none') throw new Error('Member race ring missing');
     NewsState.items=Array.from({length:6},(_,i)=>({member:SiteData.members[i],post:{titleNo:String(i+1),titleName:'검증 공지 '+(i+1),regDate:'2026-09-16 12:00:00',content:{textContent:'검증 공지 본문입니다.'},photos:[]}}));
     NewsState.featuredKey=newsItemKey(NewsState.items[0]);
     renderNewsLayout(document.getElementById('news-feed-content'));
     const body=document.createElement('div');body.className='news-post-body';
     body.append(sanitizeNewsFragment('<p style="color:#000;background:#fff"><font color="#000">공지 본문 테스트</font></p>'));
     document.querySelector('.selection-content').prepend(body);
     if(body.querySelector('[color]')||body.querySelector('[style]')) throw new Error('Notice fixed colors survived sanitizing');
     });
    }
    if(route==='members/'&&width===1280) {
     const clips=await page.$$eval('#news-past-list .home-notice-card',els=>els.map(e=>getComputedStyle(e).clipPath));
     assert(clips[0].startsWith('polygon')&&clips.slice(1).every(x=>x==='none'),'Notice group outer notch only');
    }
    if(route==='members/'&&width<768) {
     await page.evaluate(()=>setNewsFeatured(newsItemKey(NewsState.items[3])));
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const top=await page.$eval('#news-feed-content .featured-post',e=>e.getBoundingClientRect().top);
     assert(top>=60&&top<800,'Selected mobile notice visible below navbar');
    }
    if(route.startsWith('records')) {
     await page.waitForSelector('#indiv-avatar-list .avatar-select-live');
     await page.evaluate(()=>document.querySelector('.avatar-bar')?.classList.remove('is-closed'));
     const live=await page.$$eval('#indiv-avatar-list .avatar-select-live',els=>els.filter(e=>!e.hidden&&e.getBoundingClientRect().width>0).length);
     assert(live>0,'Individual sidebar live dots');
     await page.evaluate(()=>selectPlayer(SiteData.members.find(m=>isActiveMember(m))['이름']));
     const modal=await page.evaluate(()=>{
      openIndivMatchModal();
      const t=document.querySelector('#indivMatchesModal .modal-title');
      return {fg:getComputedStyle(t).color,bg:getComputedStyle(t.closest('.modal-header')).backgroundColor};
     });
     assert.notEqual(modal.fg,modal.bg,'Modal title contrast');
     await page.screenshot({path:`${out}/records-modal-${width}-${theme}.png`});
     await page.evaluate(()=>bootstrap.Modal.getInstance(document.getElementById('indivMatchesModal')).hide());
     const filter=await page.$eval('.record-recent-header',e=>{
      const all=Array.from(e.children).map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,center:r.top+r.height/2};});
      const nav=e.querySelector('.filter-nav');return {all,overflow:nav.scrollWidth>nav.clientWidth+1,client:nav.clientWidth,scroll:nav.scrollWidth,html:nav.outerHTML};
     });
     if(filter.overflow) await page.$('.record-recent-header').then(e=>e.screenshot({path:`${out}/filter-failure.png`}));
     assert(!filter.overflow,'All five record filters fit '+JSON.stringify(filter));
     assert(filter.all.every(c=>Math.abs(c.center-filter.all[0].center)<1),'Record heading and filters one row');
     assert(filter.all[0].right<=filter.all[1].left&&filter.all[1].right<=filter.all[2].left,'Record filter order');
     await page.$('.record-recent-header').then(e=>e.screenshot({path:`${out}/record-filters-${width}-${theme}.png`}));
    }
    if(route==='tier/') {
     await page.waitForSelector('.tier-bar-item');
     if(width===390) {
      const jump=await page.evaluate(()=>{
       document.querySelector('.tier-bar-pick').click();
       const btn=Array.from(document.querySelectorAll('.tier-bar-item')).find(e=>e.querySelector('.tier-bar-name').textContent==='4티어');
       btn.click();
       const el=document.getElementById(btn.dataset.target);
       return {id:btn.dataset.target,active:TierState.activeId,top:el.getBoundingClientRect().top,offset:tierStickyOffset()};
      });
      assert.equal(jump.id,jump.active,'Tier 4 selection');
      assert(Math.abs(jump.top-jump.offset-12)<2,'Tier 4 scroll offset');
     }
     const ring=await page.evaluate(()=>{
      const box=document.createElement('div');box.innerHTML=tierCardHtml(TierState.members[0],null);document.getElementById('tier-root').append(box);
      const avatar=box.querySelector('.tier-card-avatar'),shadow=getComputedStyle(avatar).boxShadow;box.remove();return shadow;
     });
     assert.notEqual(ring,'none','Tier race ring');
    }
    if(route.startsWith('tools/')) await page.evaluate(()=>{
     switchToolsView('multiviewer');
     MvState.order=[{soopId:'test1',name:'테스트 멤버',type:'member'},{soopId:'test2',name:'두번째',type:'member'}];
     MvState.focus=true;MvState.focusId='test1';mvRenderAll();
    });
    if(route==='multiview.html') await page.evaluate(()=>{
     mvOrder=[{soopId:'test1',name:'테스트 멤버',type:'member'},{soopId:'test2',name:'두번째',type:'member'}];
     mvFocus=true;mvFocusId='test1';mvRenderOrderRow();document.getElementById('mv-settings-panel').classList.add('open');
    });
    if(route.startsWith('tools/')||route==='multiview.html') {
     orders.push(await page.$eval('.mv-order-detail',e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      const children=Array.from(e.children).map(c=>({tag:c.className,center:c.getBoundingClientRect().top+c.getBoundingClientRect().height/2}));
      return {padding:s.padding,background:s.backgroundColor,border:s.borderLeftColor,clip:s.clipPath,cols:s.gridTemplateColumns,height:r.height,children};
     }));
    }
    if(route==='admin.html') {
     assert(await page.evaluate(()=>calendarLoaded&&navLoaded&&toolsLoaded),'Admin public data loading');
     await page.evaluate(()=>switchPage('schedule'));
     assert(await page.$$eval('#daysGrid .cal-cell-event',es=>es.length)>0,'Admin schedule populated');
     if(width===390){await page.click('.admin-nav-toggle');assert(await page.$eval('#mainMenu',e=>getComputedStyle(e).display!=='none'),'Admin mobile menu');await page.click('.admin-nav-toggle');}
     if((width===1280&&theme==='light')||process.env.CAPTURE_REAL) {
      const admin=await require('./admin-fixture.cjs')(page,Boolean(process.env.CAPTURE_REAL));
      if(admin.imageBase64) { fs.writeFileSync(`${out}/calendar-capture-${width}-${theme}.png`,Buffer.from(admin.imageBase64,'base64'));delete admin.imageBase64; }
      fs.writeFileSync(`${out}/admin-actions.json`,JSON.stringify(admin,null,2));
     }
    }
    if(route==='schedule/') {
     assert(await page.$$eval('.cal-event-time,.cal-event-person,.cal-event-desc',es=>es.every(e=>getComputedStyle(e).color==='rgb(255, 255, 255)')),'Calendar text stays white');
     const empty=await page.evaluate(()=>{
      calEvents=[];calOffAir={};calRenderCalendar();
      return Array.from(document.querySelectorAll('.cal-no-schedule')).map(e=>({align:getComputedStyle(e).placeItems,min:getComputedStyle(e).minHeight}));
     });
     assert(empty.every(x=>x.align==='center'&&x.min==='104px'),'Both empty schedule alignments');
    }
    if(route!=='multiview.html') {
     const nav=await page.evaluate(()=>{
      const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right};};
      return {logo:box('.logo'),drawer:box('.nav-drawer-btn'),theme:box('.theme-toggle'),inner:box('.navbar-inner'),order:Array.from(document.querySelectorAll('#mainMenu [data-page]')).map(e=>e.dataset.page),border:getComputedStyle(document.querySelector('.top-navbar')).borderBottomWidth,heroBorder:getComputedStyle(document.querySelector('.page-header')||document.querySelector('.home-carousel')).borderBottomWidth};
     });
     assert(nav.order.indexOf('tier')<nav.order.indexOf('stats'),'Navigation tier before stats');
     assert.equal(nav.border,nav.heroBorder,'Hero/nav blue rule width');
     if(width<768) {assert(nav.logo.right<=nav.drawer.left,'Drawer after logo');assert(Math.abs(nav.inner.right-nav.theme.right-18)<2,'Theme right alignment');}
    }
    if(!route||!['multiview.html','admin.html'].includes(route)) {
     const h=await page.evaluate(()=>{
      const hero=document.querySelector('.page-header')||document.querySelector('.home-carousel-slide');
      const title=hero.querySelector('.page-header-title,h1'),desc=hero.querySelector('.page-header-subtitle,p'),stats=hero.querySelector('.page-header-stats');
      const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
      return {hero:rect(hero),title:rect(title),desc:rect(desc),font:getComputedStyle(title).fontSize,weight:getComputedStyle(title).fontWeight,descFont:getComputedStyle(desc).fontSize,descColor:getComputedStyle(desc).color,padding:getComputedStyle(hero).padding,stats:stats&&rect(stats),tabs:hero.querySelector('.sub-tabs')&&rect(hero.querySelector('.sub-tabs'))};
     });
     headers.push({route,...h});
     assert(!h.tabs||h.tabs.top>=h.desc.bottom,'Tabs below description '+route);
     if(h.stats) assert(Math.abs(h.stats.top+h.stats.height/2-h.title.top-h.title.height/2)<1,'Stats title alignment '+route);
    }
    await page.screenshot({path:`${out}/${route.split('/')[0]||'home'}-${width}-${theme}.png`});
    const contrast=theme==='dark'?await page.evaluate(require('./audit-contrast.cjs')):[];
    results.push({route,width,theme,errors,contrast});
    console.log('checked',width,theme,route||'home');
    assert.deepEqual(errors,[],'Runtime errors '+route);
    await page.close();
   }
   fs.writeFileSync(`${out}/geometry-${width}-${theme}.json`,JSON.stringify({headers,orders},null,2));
   for(const h of headers.slice(1)) {
    assert.equal(h.font,headers[0].font,'Hero title font '+h.route);
    assert.equal(h.weight,headers[0].weight,'Hero title weight '+h.route);
    assert.equal(h.descFont,headers[0].descFont,'Hero description font '+h.route);
    assert.equal(h.descColor,headers[0].descColor,'Hero description color '+h.route);
    assert.equal(h.padding,headers[0].padding,'Hero insets '+h.route);
    assert(Math.abs(h.title.left-headers[0].title.left)<1,'Hero text left edge '+h.route);
    assert(Math.abs(h.desc.top-h.title.bottom-10)<1,'Description gap '+h.route);
   }
   if(orders.length) for(const key of ['padding','background','border','clip','height']) assert.equal(orders[0][key],orders[1][key],'Shared selection list '+key);
   fs.writeFileSync(`${out}/geometry-${width}-${theme}.json`,JSON.stringify({headers,orders},null,2));
   console.log('PASS',width,theme);
  }
 } finally {
  await browser.close();server.close();
  const report=process.env.CAPTURE_REAL?'results-capture':process.env.NARROW_ONLY?'results-narrow':'results';
  fs.writeFileSync(`${out}/${report}.json`,JSON.stringify(results,null,2));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
