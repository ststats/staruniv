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
    return cfg;
  }

  async function save(cfg,msg='사이트 설정을 저장했습니다'){
    await C().saveSiteConfig(cfg);
    C().toast(msg);
    if(typeof applyNavVisibility==='function') await applyNavVisibility();
    enhance();
  }

  // 표시/숨김·순서는 '메뉴 편집'/'서브탭 편집' 서랍에서만 바꾼다. 화면에는 숨김 상태만 흐리게 보여 준다.
  function subtabLabel(page,key){
    const el=[...document.querySelectorAll('.sub-tabs .sub-tab[id]')].find(x=>subKeyFromId(x.id)===key);
    return (el?.firstChild?.textContent||el?.textContent||key).trim()||key;
  }

  function orderRow(i,label,attrs,visible,extra=''){
    return `<div class="admin-order-row${visible?'':' is-off'}" ${attrs}>
      <span class="admin-order-num">${String(i+1).padStart(2,'0')}</span><b>${C().esc(label)}</b>
      ${extra}
      <label class="admin-switch"><input type="checkbox" data-visible${visible?' checked':''}><span class="admin-switch-track"></span><span class="admin-switch-text"></span></label>
    </div>`;
  }

  async function enhanceNav(){
    const cfg=configDefaults(await C().loadSiteConfig());
    const hidden=new Set(cfg.hidden);
    document.querySelectorAll('#mainMenu .nav-item[data-page]').forEach(el=>{
      el.hidden=false;
      el.classList.toggle('admin-config-hidden',hidden.has(el.dataset.page));
      el.querySelector('.admin-eye-toggle')?.remove();
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
      el.querySelector('.admin-subtab-eye')?.remove();
      el.classList.toggle('admin-default-subtab',String(sub.default||ids[0])===key);
      el.title=String(sub.default||ids[0])===key?'기본 서브탭':'';
    });
  }

  async function openNavManager(){
    const cfg=configDefaults(await C().loadSiteConfig());
    const order=cfg.order.filter(x=>NAV_LABELS[x]).concat(Object.keys(NAV_LABELS).filter(x=>!cfg.order.includes(x)));
    C().openDrawer({
      eyebrow:'SITE',title:'상단 메뉴 편집',
      html:`<p class="admin-help">상단 메뉴의 순서와 표시 여부를 정합니다. 숨긴 메뉴는 방문자에게 보이지 않고, 관리자 화면에서만 흐리게 보입니다</p>
        <div class="admin-order-list" id="an_order">${order.map((id,i)=>orderRow(i,NAV_LABELS[id],`data-nav="${id}"`,!cfg.hidden.includes(id),
          `<span class="admin-order-actions"><button type="button" data-dir="-1" aria-label="위로"></button><button type="button" data-dir="1" aria-label="아래로"></button></span>`)).join('')}</div>`,
      onSubmit:async()=>{
        const rows=[...document.querySelectorAll('#an_order [data-nav]')];
        cfg.order=rows.map(x=>x.dataset.nav);
        cfg.hidden=rows.filter(x=>!x.querySelector('[data-visible]')?.checked).map(x=>x.dataset.nav);
        await save(cfg);
      }
    });
    const list=document.getElementById('an_order');
    const renumber=()=>list.querySelectorAll('.admin-order-num').forEach((el,i)=>el.textContent=String(i+1).padStart(2,'0'));
    list?.addEventListener('click',ev=>{
      const b=ev.target.closest('[data-dir]');if(!b)return;
      ev.preventDefault();
      const row=b.closest('[data-nav]'), dir=Number(b.dataset.dir), sib=dir<0?row.previousElementSibling:row.nextElementSibling;
      if(sib) row.parentElement.insertBefore(dir<0?row:sib,dir<0?sib:row);
      renumber();C().markDirty(true);
    });
    list?.addEventListener('change',ev=>{const row=ev.target.closest('.admin-order-row');if(row)row.classList.toggle('is-off',!ev.target.checked);});
  }

  async function openSubtabManager(){
    const page=document.body.dataset.adminPage, ids=SUBTAB_IDS[page]; if(!ids)return;
    const cfg=configDefaults(await C().loadSiteConfig()), sub=cfg.subtabs[page]||{hidden:[],default:ids[0]};
    C().openDrawer({
      eyebrow:'SUBTAB',title:'서브탭 편집',
      html:`<p class="admin-help">이 페이지 서브탭의 표시 여부와, 처음 열릴 때 보여 줄 기본 탭을 정합니다. 기본 탭은 숨길 수 없습니다</p>
        <div class="admin-order-list" id="as_subtabs">${ids.map((key,i)=>orderRow(i,subtabLabel(page,key),`data-sub="${C().esc(key)}"`,!(sub.hidden||[]).includes(key),
          `<label class="admin-default-pick"><input type="radio" name="sub_default" value="${C().esc(key)}"${String(sub.default||ids[0])===key?' checked':''}><span>기본</span></label>`)).join('')}</div>`,
      onSubmit:async()=>{
        sub.hidden=ids.filter(key=>!document.querySelector(`[data-sub="${CSS.escape(key)}"] [data-visible]`)?.checked);
        sub.default=document.querySelector('input[name="sub_default"]:checked')?.value||ids[0];
        if(sub.hidden.includes(sub.default))throw new Error('기본 서브탭은 표시 상태여야 합니다');
        cfg.subtabs[page]=sub;await save(cfg);
      }
    });
    document.getElementById('as_subtabs')?.addEventListener('change',ev=>{const row=ev.target.closest('.admin-order-row');if(row&&ev.target.matches('[data-visible]'))row.classList.toggle('is-off',!ev.target.checked);});
  }

  async function openHomeSlide(index){
    const cfg=configDefaults(await C().loadSiteConfig());
    const key=['schedule','records','video'][index]; if(!key)return;
    const defaults={
      schedule:{title:'캄몬스타즈',description:'캄몬스타즈의 일정을 한곳에서 확인하세요',href:'schedule/'},
      records:{title:'전적아카이브',description:'캄몬스타즈의 모든 전적을 저장합니다',href:'records/'},
      video:{title:'캄몬플레이',description:'캄몬스타즈를 재생하세요',href:'video/'},
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

  async function enhanceHome(){
    if(document.body.dataset.adminPage!=='home')return;
    document.querySelectorAll('.home-carousel-slide').forEach((slide,i)=>{
      if(!slide.querySelector('.admin-home-edit')){
        slide.insertAdjacentHTML('beforeend',`<button type="button" class="admin-home-edit" data-admin-home-slide="${i}">편집</button>`);
      }
    });
  }

  // 운영 현황: 파이프라인 갱신 상태 · ELO DB 범위 · 테이블 건수(ststat migration 012의 admin_dashboard_stats 한 번).
  // 예전 독립 관리자(admin.html + page-admin.js)에만 있던 대시보드를 홈 맨 위 접기 카드로 옮겼다.
  const OPS_TABLES=[['members','멤버'],['matches','팀 경기'],['tier_members','티어 선수'],['calendar_events','일정'],
    ['calendar_off_air','휴방'],['videos','수집 영상'],['video_picks','추천 영상'],['elo_players','ELO 선수']];
  const kst=v=>{if(!v)return '-';const d=new Date(v);return isNaN(d)?String(v):d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};

  async function renderOps(){
    if(document.body.dataset.adminPage!=='home')return;
    const host=document.querySelector('#page-home > .container');
    if(!host)return;
    let box=document.getElementById('adminOps');
    if(!box){
      box=document.createElement('details');
      box.id='adminOps';
      box.className='admin-rank-explain admin-ops';
      try{box.open=localStorage.getItem('admin-ops-open')==='1';}catch(_){}
      box.addEventListener('toggle',()=>{try{localStorage.setItem('admin-ops-open',box.open?'1':'0');}catch(_){}});
      host.prepend(box);
    }
    const esc=C().esc;
    box.innerHTML='<summary class="admin-rank-explain-head"><b>운영 현황</b><span>불러오는 중</span></summary>';
    const {data,error}=await C().state.client.rpc('admin_dashboard_stats');
    if(error||!data){
      box.innerHTML=`<summary class="admin-rank-explain-head"><b>운영 현황</b><span>조회 실패 · ${esc(C().errorText?C().errorText(error):'')}</span></summary>`;
      return;
    }
    const f=data.freshness||{}, elo=data.elo||{}, counts=data.counts||{};
    const status=String(f.last_job_status||'unknown');
    const total=Number(counts.elo_matches||elo.total||0);
    // 경기 수는 표 전체를 세면 시간 초과라 DB 통계 추정치(ststat migration 012).
    const totalText=(elo.total_estimated?'약 ':'')+total.toLocaleString();
    box.innerHTML=`
      <summary class="admin-rank-explain-head"><b>운영 현황</b><span>ELO ${totalText}경기 · 최근 파이프라인 ${esc(f.last_job_name||'-')} ${esc(status)} (${esc(kst(f.last_job_finished_at))})</span></summary>
      <div class="admin-ops-grid">
        <div${status==='failed'?' class="is-error"':''}><span>최근 파이프라인</span><b>${esc(f.last_job_name||'-')} · ${esc(status)}</b><small>${esc(kst(f.last_job_finished_at))}</small></div>
        <div><span>ELO 기준일</span><b>${esc(f.elo_as_of||'-')}</b><small>${esc(kst(f.elo_activated_at))}</small></div>
        <div><span>방송통계 기준일</span><b>${esc(f.daily_stat_date||'-')}</b><small>${esc(kst(f.daily_updated_at))}</small></div>
        <div><span>ELO 경기</span><b>${totalText}</b><small>ID ${esc(elo.min_match_id??'-')}–${esc(elo.max_match_id??'-')}</small></div>
        <div><span>ELO 경기 날짜</span><b>${esc(elo.first_match_date||'-')}</b><small>~ ${esc(elo.last_match_date||'-')}</small></div>
        ${OPS_TABLES.map(([t,l])=>`<div><span>${esc(l)}</span><b>${Number(counts[t]||0).toLocaleString()}</b></div>`).join('')}
      </div>`;
  }

  async function enhance(){
    await enhanceNav();
    await enhanceSubtabs();
    await enhanceHome();
    const menu=document.getElementById('mainMenu');
    if(menu&&!document.getElementById('adminNavManage')){
      const b=document.createElement('button');b.id='adminNavManage';b.type='button';b.className='admin-nav-manage';b.textContent='메뉴 편집';b.dataset.icon='edit';b.onclick=openNavManager;
      menu.after(b);
    }
    // 서브탭 편집은 다른 페이지 관리 버튼(멤버 추가 등)과 같은 자리·모양: 본문 맨 위 관리 막대.
    // 예전엔 히어로의 탭 줄 끝에 붙어 좁은 화면에서 가로 스크롤에 밀려 화면 밖으로 나갔다.
    const tabs=document.querySelector('.sub-tabs');
    const host=tabs?.closest('.page-section')?.querySelector(':scope > .container');
    if(host&&SUBTAB_IDS[document.body.dataset.adminPage]&&!document.getElementById('adminSubtabManage')){
      const b=document.createElement('button');b.id='adminSubtabManage';b.type='button';b.className='admin-floating-add';b.textContent='서브탭 편집';b.dataset.icon='edit';b.onclick=openSubtabManager;
      host.prepend(b);
    }
  }

  async function init(){
    await C().loadSiteConfig(true);
    await enhance();
    renderOps().catch(e=>console.error('운영 현황',e));
    document.addEventListener('click',async ev=>{
      if(!C().state.editMode)return;
      const slide=ev.target.closest('[data-admin-home-slide]');if(slide){ev.preventDefault();ev.stopPropagation();openHomeSlide(Number(slide.dataset.adminHomeSlide));return;}
    },true);
  }
  document.addEventListener('admin:ready',init);
  document.addEventListener('admin:site-config-saved',()=>enhance().catch(()=>{}));
}());
