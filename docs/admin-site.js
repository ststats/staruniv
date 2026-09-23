(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const NAV_LABELS={schedule:'일정',members:'멤버',records:'전적',tier:'티어표',video:'영상',stats:'방송통계',tools:'도구'};
  const SUBTAB_IDS={
    schedule:['calendar','history'],
    members:['status','news'],
    video:['fantube','pick'],
    tools:['multiviewer','entry','rider','external'],
  };

  function configDefaults(cfg){
    cfg=cfg&&typeof cfg==='object'?structuredClone(cfg):{};
    cfg.hidden=Array.isArray(cfg.hidden)?cfg.hidden:[];
    cfg.order=Array.isArray(cfg.order)&&cfg.order.length?cfg.order:Object.keys(NAV_LABELS);
    cfg.subtabs=cfg.subtabs&&typeof cfg.subtabs==='object'?cfg.subtabs:{};
    cfg.heroDescriptions=cfg.heroDescriptions&&typeof cfg.heroDescriptions==='object'?cfg.heroDescriptions:{};
    cfg.homeCarousel=cfg.homeCarousel&&typeof cfg.homeCarousel==='object'?cfg.homeCarousel:{};
    cfg.homeSections=cfg.homeSections&&typeof cfg.homeSections==='object'?cfg.homeSections:{live:true,notices:true};
    return cfg;
  }

  async function save(cfg,msg='사이트 설정을 저장했습니다.'){
    await C().saveSiteConfig(cfg);
    C().toast(msg);
    if(typeof applyNavVisibility==='function') await applyNavVisibility();
    enhance();
  }

  function eyeButton(hidden,page){
    return `<span role="button" tabindex="0" class="admin-eye-toggle${hidden?' is-hidden':''}" data-admin-nav-toggle="${C().esc(page)}" aria-label="${hidden?'표시':'숨김'}">${hidden?'◉':'◌'}</span>`;
  }

  async function enhanceNav(){
    const cfg=configDefaults(await C().loadSiteConfig());
    const hidden=new Set(cfg.hidden);
    document.querySelectorAll('#mainMenu .nav-item[data-page]').forEach(el=>{
      el.hidden=false;
      el.classList.toggle('admin-config-hidden',hidden.has(el.dataset.page));
      if(!el.querySelector('.admin-eye-toggle')) el.insertAdjacentHTML('beforeend',eyeButton(hidden.has(el.dataset.page),el.dataset.page));
    });
  }

  function subKeyFromId(id){
    if(id.startsWith('tab-member-'))return id.replace('tab-member-','');
    if(id.startsWith('tab-video-'))return id.replace('tab-video-','');
    if(id.startsWith('tab-tools-'))return id.replace('tab-tools-','');
    if(id==='tab-calendar')return 'calendar';
    if(id==='tab-history')return 'history';
    return id.replace(/^tab-/,'');
  }

  async function enhanceSubtabs(){
    const page=document.body.dataset.adminPage;
    const ids=SUBTAB_IDS[page];
    if(!ids)return;
    const cfg=configDefaults(await C().loadSiteConfig());
    const sub=cfg.subtabs[page]||{hidden:[],default:ids[0]};
    const hidden=new Set(sub.hidden||[]);
    document.querySelectorAll('.sub-tabs .sub-tab[id]').forEach(el=>{
      const key=subKeyFromId(el.id);
      if(!ids.includes(key))return;
      el.hidden=false;
      el.classList.toggle('admin-config-hidden',hidden.has(key));
      if(!el.querySelector('.admin-subtab-eye')){
        el.insertAdjacentHTML('beforeend',`<button type="button" class="admin-subtab-eye" data-admin-subtab-toggle="${C().esc(key)}" aria-label="표시 전환">◉</button>`);
      }
      el.classList.toggle('admin-default-subtab',String(sub.default||ids[0])===key);
      el.title=String(sub.default||ids[0])===key?'기본 서브탭':'';
    });
  }

  async function openNavManager(){
    const cfg=configDefaults(await C().loadSiteConfig());
    const order=cfg.order.filter(x=>NAV_LABELS[x]).concat(Object.keys(NAV_LABELS).filter(x=>!cfg.order.includes(x)));
    C().openDrawer({
      eyebrow:'SITE',title:'상단 메뉴 편집',
      html:`<p class="admin-help">표시 여부와 순서를 저장합니다. 숨긴 메뉴도 관리자 모드에서는 반투명하게 보입니다.</p>
        <div class="admin-order-list" id="an_order">${order.map((id,i)=>`
          <div class="admin-order-row" data-nav="${id}">
            <span class="admin-order-handle">↕</span><b>${C().esc(NAV_LABELS[id])}</b>
            <label class="admin-check"><input type="checkbox" data-visible="${id}"${cfg.hidden.includes(id)?'':' checked'}><span>표시</span></label>
            <span class="admin-order-actions"><button type="button" data-move="${id}" data-dir="-1">↑</button><button type="button" data-move="${id}" data-dir="1">↓</button></span>
          </div>`).join('')}</div>`,
      onSubmit:async()=>{
        const rows=[...document.querySelectorAll('#an_order [data-nav]')];
        cfg.order=rows.map(x=>x.dataset.nav);
        cfg.hidden=rows.filter(x=>!x.querySelector('[data-visible]')?.checked).map(x=>x.dataset.nav);
        await save(cfg);
      }
    });
    document.getElementById('an_order')?.addEventListener('click',ev=>{
      const b=ev.target.closest('[data-move]');if(!b)return;
      ev.preventDefault();
      const row=b.closest('[data-nav]'), dir=Number(b.dataset.dir), sib=dir<0?row.previousElementSibling:row.nextElementSibling;
      if(sib) row.parentElement.insertBefore(dir<0?row:sib,dir<0?sib:row);
      C().markDirty(true);
    });
  }

  async function openSubtabManager(){
    const page=document.body.dataset.adminPage, ids=SUBTAB_IDS[page]; if(!ids)return;
    const cfg=configDefaults(await C().loadSiteConfig()), sub=cfg.subtabs[page]||{hidden:[],default:ids[0]};
    C().openDrawer({
      eyebrow:'SUBTAB',title:'서브탭 편집',
      html:`${ids.map(key=>`<div class="admin-setting-row"><b>${C().esc(key)}</b>
        <label class="admin-check"><input type="checkbox" data-sub-visible="${key}"${(sub.hidden||[]).includes(key)?'':' checked'}><span>표시</span></label>
        <label class="admin-check"><input type="radio" name="sub_default" value="${key}"${String(sub.default||ids[0])===key?' checked':''}><span>기본</span></label>
      </div>`).join('')}`,
      onSubmit:async()=>{
        sub.hidden=ids.filter(key=>!document.querySelector(`[data-sub-visible="${CSS.escape(key)}"]`)?.checked);
        sub.default=document.querySelector('input[name="sub_default"]:checked')?.value||ids[0];
        if(sub.hidden.includes(sub.default))throw new Error('기본 서브탭은 표시 상태여야 합니다.');
        cfg.subtabs[page]=sub;await save(cfg);
      }
    });
  }

  async function openHomeSlide(index){
    const cfg=configDefaults(await C().loadSiteConfig());
    const key=['schedule','records','video'][index]; if(!key)return;
    const defaults={
      schedule:{title:'캄몬스타즈',description:'캄몬스타즈의 일정을 한곳에서 확인하세요.',href:'schedule/'},
      records:{title:'전적아카이브',description:'캄몬스타즈의 모든 전적을 저장합니다.',href:'records/'},
      video:{title:'캄몬플레이',description:'캄몬스타즈를 재생하세요.',href:'video/'},
    };
    const row={...defaults[key],...(cfg.homeCarousel[key]||{})};
    const slide=document.querySelectorAll('.home-carousel-slide')[index];
    const titleEl=slide?.querySelector('.page-header-title'), descEl=slide?.querySelector('.page-header-subtitle'), linkEl=slide?.querySelector('.home-hero-links a');
    const original={title:titleEl?.textContent||'',description:descEl?.textContent||'',href:linkEl?.getAttribute('href')||''};
    C().openDrawer({
      eyebrow:'HOME',title:'홈 캐러셀 편집',
      html:`${C().field('제목',C().input('ahs_title',row.title,'text','required'))}
        ${C().field('설명',C().textarea('ahs_desc',row.description,'rows="3"'))}
        ${C().field('바로가기',C().input('ahs_href',row.href,'text','required'))}`,
      onCancel:()=>{
        if(titleEl)titleEl.textContent=original.title;
        if(descEl)descEl.textContent=original.description;
        if(linkEl)linkEl.setAttribute('href',original.href);
      },
      onSubmit:async()=>{
        cfg.homeCarousel[key]={title:C().value('ahs_title').trim(),description:C().value('ahs_desc').trim(),href:C().value('ahs_href').trim()};
        cfg.heroDescriptions[key==='schedule'?'homeSchedule':key==='records'?'homeRecords':'homeVideo']=cfg.homeCarousel[key].description;
        await save(cfg);
      }
    });
    const preview=()=>{
      if(titleEl)titleEl.textContent=C().value('ahs_title');
      if(descEl)descEl.textContent=C().value('ahs_desc');
      if(linkEl)linkEl.setAttribute('href',C().value('ahs_href'));
    };
    ['ahs_title','ahs_desc','ahs_href'].forEach(id=>document.getElementById(id)?.addEventListener('input',preview));
  }

  async function toggleHomeSection(key){
    const cfg=configDefaults(await C().loadSiteConfig());
    cfg.homeSections[key]=!(cfg.homeSections[key]!==false);
    await save(cfg,`${key==='live'?'방송 중':'최근 공지'} 영역 표시를 변경했습니다.`);
  }

  async function enhanceHome(){
    if(document.body.dataset.adminPage!=='home')return;
    const cfg=configDefaults(await C().loadSiteConfig());
    document.querySelectorAll('.home-carousel-slide').forEach((slide,i)=>{
      if(!slide.querySelector('.admin-home-edit')){
        slide.insertAdjacentHTML('beforeend',`<button type="button" class="admin-home-edit" data-admin-home-slide="${i}">편집</button>`);
      }
    });
    const targets=[['live','home-live-broadcast'],['notices','home-notice-list']];
    targets.forEach(([key,id])=>{
      const el=document.getElementById(id);if(!el)return;
      el.hidden=false;
      const enabled=cfg.homeSections[key]!==false;
      el.classList.toggle('admin-config-hidden',!enabled);
      if(!el.querySelector(':scope > .admin-section-eye'))el.insertAdjacentHTML('afterbegin',`<button type="button" class="admin-section-eye" data-admin-home-section="${key}">${enabled?'◌':'◉'}</button>`);
    });
  }

  async function enhance(){
    await enhanceNav();
    await enhanceSubtabs();
    await enhanceHome();
    const menu=document.getElementById('mainMenu');
    if(menu&&!document.getElementById('adminNavManage')){
      const b=document.createElement('button');b.id='adminNavManage';b.type='button';b.className='admin-nav-manage';b.textContent='메뉴 편집';b.onclick=openNavManager;
      menu.after(b);
    }
    const tabs=document.querySelector('.sub-tabs');
    if(tabs&&SUBTAB_IDS[document.body.dataset.adminPage]&&!document.getElementById('adminSubtabManage')){
      const b=document.createElement('button');b.id='adminSubtabManage';b.type='button';b.className='admin-subtab-manage';b.textContent='서브탭 편집';b.onclick=openSubtabManager;
      tabs.appendChild(b);
    }
  }

  async function init(){
    await C().loadSiteConfig(true);
    await enhance();
    document.addEventListener('click',async ev=>{
      if(!C().state.editMode)return;
      const nav=ev.target.closest('[data-admin-nav-toggle]');
      if(nav){
        ev.preventDefault();ev.stopPropagation();
        const cfg=configDefaults(await C().loadSiteConfig()),id=nav.dataset.adminNavToggle;
        const hidden=new Set(cfg.hidden);hidden.has(id)?hidden.delete(id):hidden.add(id);cfg.hidden=[...hidden];await save(cfg);return;
      }
      const sub=ev.target.closest('[data-admin-subtab-toggle]');
      if(sub){
        ev.preventDefault();ev.stopPropagation();
        const page=document.body.dataset.adminPage,cfg=configDefaults(await C().loadSiteConfig());
        const ids=SUBTAB_IDS[page]||[],s=cfg.subtabs[page]||{hidden:[],default:ids[0]},hidden=new Set(s.hidden||[]);
        const key=sub.dataset.adminSubtabToggle;hidden.has(key)?hidden.delete(key):hidden.add(key);
        if(hidden.has(s.default)){C().toast('기본 서브탭은 숨길 수 없습니다.','error');return;}
        s.hidden=[...hidden];cfg.subtabs[page]=s;await save(cfg);return;
      }
      const slide=ev.target.closest('[data-admin-home-slide]');if(slide){ev.preventDefault();ev.stopPropagation();openHomeSlide(Number(slide.dataset.adminHomeSlide));return;}
      const section=ev.target.closest('[data-admin-home-section]');if(section){ev.preventDefault();ev.stopPropagation();await toggleHomeSection(section.dataset.adminHomeSection);}
    },true);
  }
  document.addEventListener('admin:ready',init);
  document.addEventListener('admin:site-config-saved',()=>enhance().catch(()=>{}));
}());
