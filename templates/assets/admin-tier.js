(function () {
  'use strict';
  const C=()=>window.AdminCore;
  // 보기: 선수 관리 / 티어 랭킹 / 티어표 갱신(북마클릿은 #tier-update로 연다)
  const VIEWS=['members','ranking','update'];
  const startView=location.hash.startsWith('#tier-update')?'update':new URLSearchParams(location.search).get('view');
  const S={view:VIEWS.includes(startView)?startView:'members',page:0,size:50,count:0,rows:[],sort:'source_order',asc:true,selected:new Set(),filters:{q:'',tier:'',aff:'',race:''},options:{tiers:[],affs:[],races:[]}};
  const PROMO=[8,7,6,5,4,3,2,1,0];
  // 티어 사다리: core.js의 공통 순서(SITE_ORDER.tiers). ststat의 티어 순서와도 같아야 한다.
  const LADDER=SITE_ORDER.tiers;
  const tierLabel=t=>/^\d$/.test(String(t))?`${t}티어`:(String(t)==='체크'?'미분류':`${t}`);
  // 사다리에 없는 값(체크 = 아직 티어를 안 매긴 사람 등)은 맨 끝으로 보낸다
  const tierRank=t=>{const i=LADDER.indexOf(String(t));return i<0?LADDER.length:i;};
  // 티어 랭킹 보기 상태. 활성 Elo 스냅샷을 한 번 읽어 두고 화면에서만 거른다.
  const R={loaded:false,loading:null,rows:[],meta:{},tier:'',q:'',gapOnly:false};

  function esc(v){return C().esc(v);}
  // 승급일 칸은 글자다. 초기 티어표에는 강등이 있어서 같은 티어에 두 번 이상 오른 선수는
  // '2021-07-13, 2021-10-26'처럼 날짜를 쉼표로 이어 적는다(99칸 정도). 한 칸 = 날짜 여러 개로 읽는다.
  const promoDates=v=>String(v||'').split(/[,\s/]+/).map(x=>x.trim()).filter(Boolean);
  function promotionEvents(r){
    return PROMO.flatMap(n=>promoDates(r[`promoted_tier_${n}`]).map(date=>({n,date})))
      .sort((a,b)=>a.date.localeCompare(b.date));
  }
  function latestPromotion(r){
    const events=promotionEvents(r);
    return events.length?events[events.length-1].date:'';
  }
  function promotionWarnings(r){
    const warnings=[], chrono=promotionEvents(r);
    // 강등이 섞인 선수(같은 티어에 날짜가 여럿)는 순서가 거꾸로 가는 게 정상이라 순서 검사를 하지 않는다
    const demoted=PROMO.some(n=>promoDates(r[`promoted_tier_${n}`]).length>1);
    for(let i=1;i<chrono.length&&!demoted;i++){
      if(chrono[i].n>chrono[i-1].n)warnings.push('승급일 순서가 티어 진행 방향과 맞지 않을 수 있습니다');
    }
    if(chrono.length){
      const latest=chrono[chrono.length-1].n;
      const tier=String(r.tier||'').replace('티어','').trim();
      if(/^[0-8]$/.test(tier)&&Number(tier)!==latest)warnings.push(`현재 티어(${r.tier})와 마지막 승급 티어(${latest}티어)가 다릅니다`);
    }
    return [...new Set(warnings)];
  }
  function historyHtml(r){
    // 날짜 순으로 한 줄씩. 강등 뒤 다시 오른 경우도 순서대로 보인다
    const rows=promotionEvents(r).map(e=>`<tr><td>${esc(e.date)}</td><td>${e.n}티어 승급</td></tr>`).join('');
    return rows?`<table class="admin-mini-table"><tbody>${rows}</tbody></table>`:'승급 이력이 없습니다';
  }
  async function duplicateElo(elo,id){
    if(!elo)return null;
    let q=C().state.client.from('tier_members').select('id,nickname,elo_id').eq('elo_id',elo).limit(2);
    if(id)q=q.neq('id',id);
    const {data,error}=await q;if(error)throw error;return data?.[0]||null;
  }
  function fields(r={}){
    // 날짜 입력기(type=date)는 날짜 하나만 받아서, 여러 날짜가 든 칸이 빈칸으로 보이고 저장하면 지워졌다
    const promo=PROMO.map(n=>C().field(`${n}티어 승급일`,C().input(`ati_p${n}`,r[`promoted_tier_${n}`]||'','text','placeholder="YYYY-MM-DD" inputmode="numeric"'))).join('');
    return `<div class="admin-form-grid">
      ${C().field('이름',C().input('ati_name',r.name||''))}
      ${C().field('닉네임',C().input('ati_nick',r.nickname||'','text','required'))}
      ${C().field('SOOP ID',C().input('ati_soop',r.soop_id||''))}
      ${C().field('ELO ID',C().input('ati_elo',r.elo_id??'','number','min="1"'))}
      ${C().field('성별',C().input('ati_gender',r.gender||''))}
      ${C().field('종족',C().input('ati_race',r.race||''))}
      ${C().field('생년월일',C().input('ati_birth',r.birth_date||'','date'))}
      ${C().field('티어',C().input('ati_tier',r.tier||''))}
      ${C().field('소속',C().input('ati_aff',r.affiliation||'','text','placeholder="소속 / FA / 휴면"'))}
      ${C().field('직책',C().input('ati_role',r.role||''))}
      ${C().field('수정일',C().input('ati_modified',r.modified_at||''))}
      ${C().field('시작',C().input('ati_started',r.started_on||''))}
      ${C().field('ELO 등록',C().input('ati_elo_registered',r.elo_registered||''))}
      ${C().field('티어표 등록',C().input('ati_table_registered',r.tier_table_registered||''))}
    </div><div class="admin-section-head"><b>연혁</b></div>
    ${C().field('팀 이동 등 연혁',C().textarea('ati_history',r.history||'','rows="5"'))}
    <div class="admin-section-head"><b>승급 이력</b><small>강등 뒤 다시 올랐으면 날짜를 쉼표로 이어 적습니다(예: 2021-07-13, 2021-10-26)</small></div><div class="admin-form-grid">${promo}</div>`;
  }
  function collect(r={}){
    const p={name:C().empty(C().value('ati_name')),nickname:C().value('ati_nick').trim(),soop_id:C().empty(C().value('ati_soop')),elo_id:C().intOrNull(C().value('ati_elo')),gender:C().empty(C().value('ati_gender')),race:C().empty(C().value('ati_race')),birth_date:C().empty(C().value('ati_birth')),tier:C().empty(C().value('ati_tier')),affiliation:C().empty(C().value('ati_aff')),role:C().empty(C().value('ati_role')),modified_at:C().empty(C().value('ati_modified'))||new Date().toISOString()};
    p.history=C().empty(C().value('ati_history'));
    p.started_on=C().empty(C().value('ati_started'));
    p.elo_registered=C().empty(C().value('ati_elo_registered'));
    p.tier_table_registered=C().empty(C().value('ati_table_registered'));
    PROMO.forEach(n=>{
      const dates=promoDates(C().value(`ati_p${n}`));
      const bad=dates.find(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d));
      if(bad)throw new Error(`${n}티어 승급일 '${bad}'는 YYYY-MM-DD 형식이어야 합니다(여러 번이면 쉼표로 구분)`);
      p[`promoted_tier_${n}`]=dates.length?dates.sort().join(', '):null;
    });
    return p;
  }
  function open(r){
    r=r||{};
    C().openDrawer({
      eyebrow:'TIER',title:r.id?'티어 선수 수정':'새 선수 추가',html:fields(r),
      onSubmit:async()=>{
        const p=collect(r);if(!p.nickname)throw new Error('닉네임은 필수입니다');
        const dup=await duplicateElo(p.elo_id,r.id);if(dup)throw new Error(`ELO ID ${p.elo_id}는 이미 ${dup.nickname}에게 사용 중입니다`);
        const warnings=promotionWarnings({...r,...p});if(warnings.length&&!confirm(`${warnings.join('\n')}\n그래도 저장할까요?`))throw new Error('검증 경고로 저장을 취소했습니다');
        let error;if(r.id)({error}=await C().state.client.from('tier_members').update(p).eq('id',r.id));else{p.source_order=await C().nextSourceOrder('tier_members');({error}=await C().state.client.from('tier_members').insert(p));}
        if(error)throw error;C().toast('티어 선수를 저장했습니다');await load(S.page);
      },
      onDelete:r.id?async()=>{const {error}=await C().state.client.from('tier_members').delete().eq('id',r.id);if(error)throw error;await C().audit('delete','tier_members',r.id,{nickname:r.nickname,elo_id:r.elo_id});await load(S.page);}:null
    });
  }
  async function bulk(){
    if(!S.selected.size)return C().toast('선택한 행이 없습니다','error');
    C().openDrawer({
      eyebrow:'BULK',title:`${S.selected.size}명 일괄 수정`,
      html:`${C().field('소속',C().input('atb_aff','','text','placeholder="비우면 변경 안 함"'))}${C().field('티어',C().input('atb_tier','','text','placeholder="비우면 변경 안 함"'))}<p class="admin-help">소속에는 FA 또는 휴면을 그대로 저장할 수 있습니다</p>`,
      onSubmit:async()=>{
        const aff=C().empty(C().value('atb_aff')),tier=C().empty(C().value('atb_tier'));if(!aff&&!tier)throw new Error('소속 또는 티어 중 하나를 입력하세요');
        const {error}=await C().state.client.rpc('admin_bulk_update_tier_members',{p_ids:[...S.selected],p_affiliation:aff,p_tier:tier});if(error)throw error;C().toast('일괄 수정했습니다');S.selected.clear();await load(S.page);
      }
    });
  }
  async function loadFilterOptions(){
    const all=await fetchAllPages((from,to)=>C().state.client.from('tier_members')
      .select('tier,affiliation,race').order('id',{ascending:true}).range(from,to));
    const clean=key=>[...new Set(all.map(r=>String(r[key]||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'ko',{numeric:true,sensitivity:'base'}));
    const tiers=clean('tier').sort((a,b)=>tierRank(a)-tierRank(b)||a.localeCompare(b,'ko'));
    S.options={tiers,affs:clean('affiliation'),races:clean('race')};
  }

  async function load(page=0){
    S.page=Math.max(0,page);
    if(document.getElementById('tierQ')){
      S.filters={
        q:C().value('tierQ').trim().replace(/[%_,]/g,''),
        tier:C().value('tierFilter').trim(),
        aff:C().value('tierAff').trim(),
        race:C().value('tierRace').trim()
      };
    }
    const from=S.page*S.size,to=from+S.size-1;
    let q=C().state.client.from('tier_members').select('*',{count:'exact'}).order(S.sort,{ascending:S.asc}).range(from,to);
    const {q:search,tier,aff,race}=S.filters;
    if(search)q=q.or(`name.ilike.%${search}%,nickname.ilike.%${search}%,soop_id.ilike.%${search}%,elo_id.eq.${/^\d+$/.test(search)?search:-1}`);
    if(tier)q=q.eq('tier',tier);
    if(aff)q=q.eq('affiliation',aff);
    if(race)q=q.eq('race',race);
    const {data,count,error}=await q;
    if(error)throw error;
    S.rows=data||[];
    S.count=count||0;
    render();
  }
  // 히어로의 보기 전환 탭(공개 페이지 서브탭과 같은 모양)
  function viewTabs(){
    return `<div class="sub-tabs tab-scroll" role="tablist">${[['members','선수 관리'],['ranking','티어 랭킹'],['update','티어표 갱신']].map(([k,l])=>
      `<div class="sub-tab${S.view===k?' active':''}" role="tab" tabindex="0" aria-selected="${S.view===k}" data-tier-view="${k}">${l}</div>`).join('')}</div>`;
  }
  function bindViewTabs(root){
    root.querySelectorAll('[data-tier-view]').forEach(el=>el.onclick=()=>setView(el.dataset.tierView));
  }
  function setView(view){
    if(S.view===view)return;
    S.view=view;
    const url=new URL(location.href);
    if(view==='members')url.searchParams.delete('view');else url.searchParams.set('view',view);
    history.replaceState(null,'',url);
    if(view==='ranking')showRanking();else if(view==='update')showUpdate();else showMembers();
  }

  function showUpdate(){
    window.AdminTierUpdate?.show({tabs:viewTabs,bindTabs:bindViewTabs});
  }
  function render(){
    if(S.view==='update')return;
    if(S.view==='ranking')return renderRanking();
    const root=document.getElementById('adminDedicatedRoot');
    if(!root){console.error('티어 관리 영역을 찾지 못했습니다.');return;}
    root.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    const pages=Math.max(1,Math.ceil(S.count/S.size));
    const {tiers=[],affs=[],races=[]}=S.options||{};
    const selected=(value,current)=>String(value)===String(current||'')?' selected':'';
    root.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="STARCRAFT TIERS · ADMIN"><h1 class="page-header-title">티어표 관리</h1><div class="admin-hero-actions"><button class="admin-btn" id="tierBulk">일괄 수정</button><button class="admin-btn primary" id="tierAdd">+ 새 선수</button></div><p class="page-header-subtitle">선수 정보와 승급 이력을 관리합니다. 체크한 선수는 일괄 수정으로 소속·티어를 한 번에 바꿀 수 있습니다</p></div>${viewTabs()}</div><div class="admin-dedicated-shell">
      <div class="admin-filter-grid"><input class="admin-input" id="tierQ" placeholder="이름 · 닉네임 · SOOP ID · ELO ID" value="${esc(S.filters.q)}">
      <select class="admin-input" id="tierFilter"><option value="">전체 티어</option>${tiers.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.tier)}>${esc(tierLabel(x))}</option>`).join('')}</select>
      <select class="admin-input" id="tierAff"><option value="">전체 소속</option>${affs.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.aff)}>${esc(x)}</option>`).join('')}</select>
      <select class="admin-input" id="tierRace"><option value="">전체 종족</option>${races.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.race)}>${esc(x)}</option>`).join('')}</select><button class="admin-btn primary" id="tierSearch">조회</button></div>
      <div class="admin-table-wrap"><table class="admin-table admin-table-wide"><thead><tr><th></th>${[['name','이름'],['nickname','닉네임'],['soop_id','SOOP ID'],['elo_id','ELO ID'],['gender','성별'],['race','종족'],['birth_date','생년월일'],['tier','티어'],['affiliation','소속'],['role','직책'],['promoted_tier_0','최근 승급일'],['modified_at','수정일']].map(([k,l])=>`<th><button class="admin-sort" data-sort="${k}">${l}</button></th>`).join('')}<th>관리</th></tr></thead><tbody>${S.rows.map(r=>{const warn=promotionWarnings(r);return`<tr data-tier-id="${r.id}" class="${warn.length?'has-warning':''}"><td><input type="checkbox" data-select-id="${r.id}"${S.selected.has(r.id)?' checked':''}></td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b>${warn.length?`<span class="admin-warning" title="${esc(warn.join(' / '))}">!</span>`:''}</td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.gender)}</td><td>${esc(r.race)}</td><td>${esc(r.birth_date)}</td><td>${esc(r.tier)}</td><td>${esc(r.affiliation)}</td><td>${esc(r.role)}</td><td>${esc(latestPromotion(r))}</td><td>${esc(r.modified_at)}</td><td><button class="admin-btn" data-edit-tier="${r.id}">수정</button><button class="admin-btn" data-history-tier="${r.id}">이력</button></td></tr>`}).join('')||'<tr><td colspan="14">검색 결과가 없습니다</td></tr>'}</tbody></table></div>
      <div class="admin-pager"><button class="admin-btn" id="tierPrev"${S.page<=0?' disabled':''}>이전</button><span>${S.page+1} / ${pages} · ${S.count}명</span><button class="admin-btn" id="tierNext"${S.page>=pages-1?' disabled':''}>다음</button></div></div>`;
    bindViewTabs(root);
    root.querySelector('#tierAdd').onclick=()=>open(null);root.querySelector('#tierBulk').onclick=bulk;root.querySelector('#tierSearch').onclick=()=>load(0);root.querySelector('#tierPrev').onclick=()=>load(S.page-1);root.querySelector('#tierNext').onclick=()=>load(S.page+1);
    root.querySelectorAll('[data-select-id]').forEach(ch=>ch.onchange=()=>{const id=Number(ch.dataset.selectId);ch.checked?S.selected.add(id):S.selected.delete(id);});
    root.querySelectorAll('[data-edit-tier]').forEach(b=>b.onclick=()=>open(S.rows.find(r=>String(r.id)===b.dataset.editTier)));
    root.querySelectorAll('[data-history-tier]').forEach(b=>b.onclick=()=>{const r=S.rows.find(x=>String(x.id)===b.dataset.historyTier);C().openDrawer({eyebrow:'PROMOTION',title:`${r.nickname} 승급 이력`,html:historyHtml(r),onSubmit:async()=>{}});document.getElementById('adminDrawerSave').hidden=true;});
    root.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.sort;if(S.sort===k)S.asc=!S.asc;else{S.sort=k;S.asc=true;}load(0);});
  }
  // ---------------------------------------------------------------------------
  // 티어 랭킹 보기: ststat가 계산한 활성 스냅샷 전체(순위에 오른 모든 선수)
  // ---------------------------------------------------------------------------
  function pagedSelect(table,cols,order){
    return fetchAllPages((from,to)=>C().state.client.from(table).select(cols).order(order,{ascending:true}).range(from,to));
  }
  async function loadRanking(){
    if(R.loaded)return;
    if(!R.loading)R.loading=(async()=>{
      const [ranks,people]=await Promise.all([
        pagedSelect('elo_rankings','elo_id,tier,tier_rank,tier_count,raw_rating,rating,data_tier,tier_gap,recent_365_games,recent_365_wins,recent_90_games,recent_90_wins,recent_30_games,recent_30_wins,as_of','elo_id'),
        pagedSelect('elo_public_players','elo_id,elo_name,nickname,race,affiliation','elo_id'),
      ]);
      // 표준오차는 랭킹 v4(ststat migration 011)부터 있다. 없으면 칸만 비운다.
      let se={};
      try{(await pagedSelect('elo_player_ratings','elo_id,rating_se','elo_id')).forEach(r=>{se[r.elo_id]=r.rating_se;});}catch(e){se={};}
      const metaRes=await C().state.client.from('elo_ranking_meta').select('as_of').order('as_of',{ascending:false}).limit(1);
      if(metaRes.error)throw metaRes.error;
      const who={};people.forEach(p=>{who[p.elo_id]=p;});
      R.rows=ranks.filter(r=>r.tier_rank!=null).map(r=>({...r,...(who[r.elo_id]||{}),se:se[r.elo_id]??null}))
        .sort((a,b)=>tierRank(a.tier)-tierRank(b.tier)||a.tier_rank-b.tier_rank);
      R.meta=(metaRes.data||[])[0]||{};
      R.loaded=true;
    })().finally(()=>{R.loading=null;});
    await R.loading;
  }
  async function showRanking(){
    renderRanking();
    try{await loadRanking();renderRanking();}
    catch(err){
      console.error('티어 랭킹 조회 실패:',err);
      const box=document.getElementById('rankBody');
      if(box)box.innerHTML=`<div class="admin-empty">티어 랭킹을 불러오지 못했습니다<br><small>${esc(C().errorText(err))}</small></div>`;
    }
  }
  function recordCell(g,w){
    g=Number(g)||0;w=Number(w)||0;
    return g?`${g}판 <span class="admin-rank-rate">${(w/g*100).toFixed(0)}%</span>`:'<span class="admin-rank-none">—</span>';
  }
  function gapCell(r){
    const gap=Number(r.tier_gap)||0;
    if(!gap)return '<span class="admin-rank-none">일치</span>';
    // tier_gap > 0: 데이터상 더 높은 티어(승급 후보), < 0: 더 낮은 티어
    return `<span class="admin-wl ${gap>0?'wl-w':'wl-l'}">${esc(tierLabel(r.data_tier))} ${gap>0?'↑':'↓'}${Math.abs(gap)}</span>`;
  }
  // 티어 랭킹 계산식 설명. "이 순위 어떻게 나온 거야?"에 그대로 답할 수 있게 쓴다.
  function rankingExplain(){
    const steps=[
      ['실력 점수','선수마다 하나의 실력 점수(레이팅)를 둡니다 <b>레이팅 = 티어 기준점 + 개인 편차</b>입니다. 티어 기준점은 그 티어의 평균 실력, 개인 편차는 같은 티어 안에서 얼마나 위·아래인지입니다'],
      ['승리 확률','두 선수의 레이팅 차이로 승률을 정합니다(Elo와 같은 식) <code>A가 이길 확률 = 1 / (1 + 10^(−(A − B) / 400))</code> — 차이 0점이면 50%, 100점이면 약 64%, 200점이면 약 76%입니다'],
      ['점수 맞추기','EloBoard의 모든 1대1 경기 결과를 가장 잘 설명하는 레이팅을 한꺼번에 계산합니다. 그래서 <b>강한 상대를 이기면 크게 오르고, 약한 상대에게 지면 크게 떨어집니다</b>. 경기 순서에 따라 점수가 달라지는 일반 Elo와 달리, 같은 기록이면 늘 같은 점수가 나옵니다'],
      ['경기 비중','경기 형식과 최근성으로 경기마다 비중을 곱합니다. 형식: <b>대회 1.0 › 대학대전 0.9 › 미니 0.8 › 리그·CK 0.7 › 스폰 0.6</b>. 최근성: 개인 편차는 <b>90일</b>마다 비중이 절반(최근 3개월 폼), 티어 기준점은 <b>540일</b>마다 절반(티어 간격은 천천히 변함)'],
      ['종족 상성','테란·저그·프로토스 사이의 공통 유불리를 따로 계산해 빼고, 순수한 개인 실력만 비교합니다'],
      ['적은 기록','경기가 적은 선수는 몇 판의 운으로 튀지 않게 티어 평균 쪽으로 당겨집니다. 많이 둘수록 자기 성적대로 자리를 잡습니다'],
      ['승급한 선수','티어 기준점은 경기 당시 티어로 계산하고, 개인 편차는 지금 티어 기준으로 계산합니다. 그래서 막 승급한 선수가 옛 티어에서 번 성적만으로 새 티어 1위에 오르지 않습니다'],
      ['순위 매기기','지금 티어가 있고, <b>최근 1년에 10판 이상</b> 뒀고, 휴면이 아닌 선수만 같은 티어 안에서 레이팅 순서로 줄 세웁니다'],
      ['데이터 티어','레이팅이 오차 범위까지 고려해도 옆 티어 기준을 확실히 넘으면 ↑(더 높은 티어) · ↓(더 낮은 티어)로 표시합니다. 티어표 조정 검토용이며 순위에는 영향이 없습니다'],
    ];
    let open=false;
    try{open=localStorage.getItem('admin-rank-explain-open')==='1';}catch(e){}
    return `<details class="admin-rank-explain" id="rankExplain"${open?' open':''}>
      <summary class="admin-rank-explain-head"><b>티어 랭킹 계산 방식</b><span>ststat가 4시간마다 EloBoard 전체 경기로 다시 계산합니다</span></summary>
      <ol>${steps.map(([t,d])=>`<li><strong>${t}</strong><p>${d}</p></li>`).join('')}</ol>
    </details>`;
  }
  function renderRanking(){
    if(S.view!=='ranking')return;   // 불러오는 사이 다른 보기로 옮겼으면 덮어쓰지 않는다
    const root=document.getElementById('adminDedicatedRoot');
    if(!root)return;
    root.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    const counts={};R.rows.forEach(r=>{counts[r.tier]=(counts[r.tier]||0)+1;});
    const q=R.q.trim().toLowerCase();
    const rows=R.rows.filter(r=>(!R.tier||String(r.tier)===R.tier)
      &&(!R.gapOnly||Number(r.tier_gap))
      &&(!q||[r.nickname,r.elo_name,r.affiliation].some(v=>String(v||'').toLowerCase().includes(q))));
    const chips=[['','전체',R.rows.length],...LADDER.filter(t=>counts[t]).map(t=>[t,tierLabel(t),counts[t]])]
      .map(([k,l,n])=>`<button type="button" class="admin-rank-chip${R.tier===k?' is-on':''}" data-rank-tier="${esc(k)}">${esc(l)}<span>${n}</span></button>`).join('');
    let lastTier=null;
    const body=rows.map(r=>{
      const head=!R.tier&&r.tier!==lastTier?`<tr class="admin-rank-group"><td colspan="11">${esc(tierLabel(r.tier))} · ${counts[r.tier]||0}명</td></tr>`:'';
      lastTier=r.tier;
      return `${head}<tr${Number(r.tier_gap)?' class="has-gap"':''}>
        <td>${esc(tierLabel(r.tier))}</td>
        <td><b>${r.tier_rank}</b><span class="admin-rank-none"> / ${r.tier_count||counts[r.tier]||''}</span></td>
        <td><b>${esc(r.nickname||r.elo_name||r.elo_id)}</b>${r.nickname&&r.elo_name&&r.nickname!==r.elo_name?`<span class="admin-rank-none"> ${esc(r.elo_name)}</span>`:''}</td>
        <td>${esc(r.race||'')}</td>
        <td>${esc(r.affiliation||'')}</td>
        <td><b>${r.raw_rating==null?'—':Number(r.raw_rating).toFixed(0)}</b></td>
        <td>${r.se==null?'<span class="admin-rank-none">—</span>':'±'+Number(r.se).toFixed(0)}</td>
        <td>${gapCell(r)}</td>
        <td>${recordCell(r.recent_365_games,r.recent_365_wins)}</td>
        <td>${recordCell(r.recent_90_games,r.recent_90_wins)}</td>
        <td>${recordCell(r.recent_30_games,r.recent_30_wins)}</td>
      </tr>`;}).join('');
    const loading=!R.loaded;
    root.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="STARCRAFT TIERS · ADMIN"><h1 class="page-header-title">티어 랭킹</h1><p class="page-header-subtitle">ststat가 계산한 전체 티어 랭킹입니다. 같은 티어 안에서 레이팅 순서이고, 데이터 티어는 전적이 가리키는 티어입니다(승급·강등 검토용)${R.meta&&R.meta.as_of?` · ${esc(R.meta.as_of)} 기준`:''}</p></div>${viewTabs()}</div><div class="admin-dedicated-shell" id="rankBody">
      ${loading?'<div class="admin-empty">티어 랭킹을 불러오는 중</div>':`${rankingExplain()}
      <div class="admin-rank-tools">
        <div class="admin-rank-chips">${chips}</div>
        <input class="admin-input" id="rankQ" placeholder="닉네임 · 소속 검색" value="${esc(R.q)}">
        <label class="admin-switch"><input type="checkbox" id="rankGap"${R.gapOnly?' checked':''}><span class="admin-switch-track"></span><span class="admin-rank-gap-label">티어 괴리만</span></label>
      </div>
      <div class="admin-table-wrap"><table class="admin-table admin-rank-table"><thead><tr><th>티어</th><th>순위</th><th>닉네임</th><th>종족</th><th>소속</th><th>레이팅</th><th>오차</th><th>데이터 티어</th><th>최근 1년</th><th>90일</th><th>30일</th></tr></thead>
      <tbody>${body||'<tr><td colspan="11">조건에 맞는 선수가 없습니다</td></tr>'}</tbody></table></div>`}
    </div>`;
    bindViewTabs(root);
    root.querySelectorAll('[data-rank-tier]').forEach(b=>b.onclick=()=>{R.tier=b.dataset.rankTier;renderRanking();});
    const qEl=root.querySelector('#rankQ');
    if(qEl)qEl.oninput=()=>{R.q=qEl.value;const pos=qEl.selectionStart;renderRanking();const again=document.getElementById('rankQ');again.focus();again.setSelectionRange(pos,pos);};
    const explain=root.querySelector('#rankExplain');
    if(explain)explain.ontoggle=()=>{try{localStorage.setItem('admin-rank-explain-open',explain.open?'1':'0');}catch(e){}};
    const gapEl=root.querySelector('#rankGap');
    if(gapEl)gapEl.onchange=()=>{R.gapOnly=gapEl.checked;renderRanking();};
  }

  async function init(){
    if(document.body.dataset.adminPage!=='tier')return;
    if(S.view==='ranking'){showRanking();return;}
    if(S.view==='update'){showUpdate();return;}
    await showMembers();
  }

  // 선수 관리 표는 처음 볼 때 한 번만 불러온다(랭킹 보기로 먼저 들어온 경우도 있다).
  let membersLoaded=false;
  async function showMembers(){
    render();
    if(membersLoaded)return;
    membersLoaded=true;
    try{
      await load(0);
    }catch(err){
      console.error('티어표 관리 조회 실패:',err);
      const root=document.getElementById('adminDedicatedRoot');
      if(root) root.innerHTML=`<div class="admin-dedicated-shell"><div class="admin-empty">티어표 데이터를 불러오지 못했습니다<br><small>${esc(C().errorText(err))}</small></div></div>`;
      C().toast(`티어표 조회 실패: ${C().errorText(err)}`,'error');
      membersLoaded=false;
      return;
    }

    loadFilterOptions()
      .then(()=>render())
      .catch(err=>{
        console.error('티어 필터 옵션 조회 실패:',err);
        C().toast('티어 필터 옵션 일부를 불러오지 못했습니다. 표 조회는 계속 사용할 수 있습니다','error');
      });
  }
  document.addEventListener('admin:ready',init);
}());
