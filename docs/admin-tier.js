(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const S={page:0,size:50,count:0,rows:[],sort:'source_order',asc:true,selected:new Set(),filters:{q:'',tier:'',aff:'',race:''},options:{tiers:[],affs:[],races:[]}};
  const PROMO=[8,7,6,5,4,3,2,1,0];

  function esc(v){return C().esc(v);}
  function latestPromotion(r){
    const pairs=PROMO.map(n=>[n,r[`promoted_tier_${n}`]]).filter(x=>x[1]);
    if(!pairs.length)return '';
    return pairs.sort((a,b)=>String(b[1]).localeCompare(String(a[1])))[0][1];
  }
  function promotionWarnings(r){
    const warnings=[], dated=PROMO.map(n=>({n,date:r[`promoted_tier_${n}`]})).filter(x=>x.date);
    const chrono=[...dated].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    for(let i=1;i<chrono.length;i++){
      if(chrono[i].n>chrono[i-1].n)warnings.push('승급일 순서가 티어 진행 방향과 맞지 않을 수 있습니다.');
    }
    if(dated.length){
      const latest=[...dated].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0].n;
      const tier=String(r.tier||'').replace('티어','').trim();
      if(/^[0-8]$/.test(tier)&&Number(tier)!==latest)warnings.push(`현재 티어(${r.tier})와 마지막 승급 티어(${latest}티어)가 다릅니다.`);
    }
    return [...new Set(warnings)];
  }
  function historyHtml(r){
    const rows=PROMO.filter(n=>r[`promoted_tier_${n}`]).map(n=>`<tr><td>${n}티어</td><td>${esc(r[`promoted_tier_${n}`])}</td></tr>`).join('');
    return rows?`<table class="admin-mini-table"><tbody>${rows}</tbody></table>`:'승급 이력이 없습니다.';
  }
  async function duplicateElo(elo,id){
    if(!elo)return null;
    let q=C().state.client.from('tier_members').select('id,nickname,elo_id').eq('elo_id',elo).limit(2);
    if(id)q=q.neq('id',id);
    const {data,error}=await q;if(error)throw error;return data?.[0]||null;
  }
  function fields(r={}){
    const promo=PROMO.map(n=>C().field(`${n}티어 승급일`,C().input(`ati_p${n}`,r[`promoted_tier_${n}`]||'','date'))).join('');
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
    </div><div class="admin-section-head"><b>승급 이력</b></div><div class="admin-form-grid">${promo}</div>`;
  }
  function collect(r={}){
    const p={name:C().empty(C().value('ati_name')),nickname:C().value('ati_nick').trim(),soop_id:C().empty(C().value('ati_soop')),elo_id:C().intOrNull(C().value('ati_elo')),gender:C().empty(C().value('ati_gender')),race:C().empty(C().value('ati_race')),birth_date:C().empty(C().value('ati_birth')),tier:C().empty(C().value('ati_tier')),affiliation:C().empty(C().value('ati_aff')),role:C().empty(C().value('ati_role')),modified_at:C().empty(C().value('ati_modified'))||new Date().toISOString()};
    PROMO.forEach(n=>p[`promoted_tier_${n}`]=C().empty(C().value(`ati_p${n}`)));
    return p;
  }
  function open(r){
    r=r||{};
    C().openDrawer({
      eyebrow:'TIER',title:r.id?'티어 선수 수정':'새 선수 추가',html:fields(r),
      onSubmit:async()=>{
        const p=collect(r);if(!p.nickname)throw new Error('닉네임은 필수입니다.');
        const dup=await duplicateElo(p.elo_id,r.id);if(dup)throw new Error(`ELO ID ${p.elo_id}는 이미 ${dup.nickname}에게 사용 중입니다.`);
        const warnings=promotionWarnings({...r,...p});if(warnings.length&&!confirm(`${warnings.join('\n')}\n그래도 저장할까요?`))throw new Error('검증 경고로 저장을 취소했습니다.');
        let error;if(r.id)({error}=await C().state.client.from('tier_members').update(p).eq('id',r.id));else{p.source_order=await C().nextSourceOrder('tier_members');({error}=await C().state.client.from('tier_members').insert(p));}
        if(error)throw error;C().toast('티어 선수를 저장했습니다.');await load(S.page);
      },
      onDelete:r.id?async()=>{const {error}=await C().state.client.from('tier_members').delete().eq('id',r.id);if(error)throw error;await C().audit('delete','tier_members',r.id,{nickname:r.nickname,elo_id:r.elo_id});await load(S.page);}:null
    });
  }
  async function bulk(){
    if(!S.selected.size)return C().toast('선택한 행이 없습니다.','error');
    C().openDrawer({
      eyebrow:'BULK',title:`${S.selected.size}명 일괄 수정`,
      html:`${C().field('소속',C().input('atb_aff','','text','placeholder="비우면 변경 안 함"'))}${C().field('티어',C().input('atb_tier','','text','placeholder="비우면 변경 안 함"'))}<p class="admin-help">소속에는 FA 또는 휴면을 그대로 저장할 수 있습니다.</p>`,
      onSubmit:async()=>{
        const aff=C().empty(C().value('atb_aff')),tier=C().empty(C().value('atb_tier'));if(!aff&&!tier)throw new Error('소속 또는 티어 중 하나를 입력하세요.');
        const {error}=await C().state.client.rpc('admin_bulk_update_tier_members',{p_ids:[...S.selected],p_affiliation:aff,p_tier:tier});if(error)throw error;C().toast('일괄 수정했습니다.');S.selected.clear();await load(S.page);
      }
    });
  }
  async function loadFilterOptions(){
    const all=[], size=1000;
    for(let from=0;;from+=size){
      const {data,error}=await C().state.client.from('tier_members')
        .select('tier,affiliation,race').order('id',{ascending:true}).range(from,from+size-1);
      if(error)throw error;
      const batch=data||[];
      all.push(...batch);
      if(batch.length<size)break;
    }
    const clean=key=>[...new Set(all.map(r=>String(r[key]||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'ko',{numeric:true,sensitivity:'base'}));
    S.options={tiers:clean('tier'),affs:clean('affiliation'),races:clean('race')};
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
  function render(){
    const root=document.getElementById('adminDedicatedRoot');
    if(!root){console.error('티어 관리 영역을 찾지 못했습니다.');return;}
    root.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    const pages=Math.max(1,Math.ceil(S.count/S.size));
    const {tiers=[],affs=[],races=[]}=S.options||{};
    const selected=(value,current)=>String(value)===String(current||'')?' selected':'';
    root.innerHTML=`<div class="admin-dedicated-shell"><div class="admin-dedicated-head"><div><span>TIER</span><h1>전체 티어표 관리</h1></div><div><button class="admin-btn" id="tierBulk">일괄 수정</button> <button class="admin-btn primary" id="tierAdd">+ 새 선수</button></div></div>
      <div class="admin-filter-grid"><input class="admin-input" id="tierQ" placeholder="이름 · 닉네임 · SOOP ID · ELO ID" value="${esc(S.filters.q)}">
      <select class="admin-input" id="tierFilter"><option value="">전체 티어</option>${tiers.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.tier)}>${esc(x)}</option>`).join('')}</select>
      <select class="admin-input" id="tierAff"><option value="">전체 소속</option>${affs.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.aff)}>${esc(x)}</option>`).join('')}</select>
      <select class="admin-input" id="tierRace"><option value="">전체 종족</option>${races.map(x=>`<option value="${esc(x)}"${selected(x,S.filters.race)}>${esc(x)}</option>`).join('')}</select><button class="admin-btn" id="tierSearch">조회</button></div>
      <div class="admin-table-wrap"><table class="admin-table admin-table-wide"><thead><tr><th></th>${[['name','이름'],['nickname','닉네임'],['soop_id','SOOP ID'],['elo_id','ELO ID'],['gender','성별'],['race','종족'],['birth_date','생년월일'],['tier','티어'],['affiliation','소속'],['role','직책'],['promoted_tier_0','최근 승급일'],['modified_at','수정일']].map(([k,l])=>`<th><button class="admin-sort" data-sort="${k}">${l}</button></th>`).join('')}<th>관리</th></tr></thead><tbody>${S.rows.map(r=>{const warn=promotionWarnings(r);return`<tr data-tier-id="${r.id}" class="${warn.length?'has-warning':''}"><td><input type="checkbox" data-select-id="${r.id}"${S.selected.has(r.id)?' checked':''}></td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b>${warn.length?`<span class="admin-warning" title="${esc(warn.join(' / '))}">!</span>`:''}</td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.gender)}</td><td>${esc(r.race)}</td><td>${esc(r.birth_date)}</td><td>${esc(r.tier)}</td><td>${esc(r.affiliation)}</td><td>${esc(r.role)}</td><td>${esc(latestPromotion(r))}</td><td>${esc(r.modified_at)}</td><td><button class="admin-btn" data-edit-tier="${r.id}">수정</button><button class="admin-btn" data-history-tier="${r.id}">이력</button></td></tr>`}).join('')||'<tr><td colspan="14">검색 결과가 없습니다.</td></tr>'}</tbody></table></div>
      <div class="admin-pager"><button class="admin-btn" id="tierPrev"${S.page<=0?' disabled':''}>이전</button><span>${S.page+1} / ${pages} · ${S.count}명</span><button class="admin-btn" id="tierNext"${S.page>=pages-1?' disabled':''}>다음</button></div></div>`;
    root.querySelector('#tierAdd').onclick=()=>open(null);root.querySelector('#tierBulk').onclick=bulk;root.querySelector('#tierSearch').onclick=()=>load(0);root.querySelector('#tierPrev').onclick=()=>load(S.page-1);root.querySelector('#tierNext').onclick=()=>load(S.page+1);
    root.querySelectorAll('[data-select-id]').forEach(ch=>ch.onchange=()=>{const id=Number(ch.dataset.selectId);ch.checked?S.selected.add(id):S.selected.delete(id);});
    root.querySelectorAll('[data-edit-tier]').forEach(b=>b.onclick=()=>open(S.rows.find(r=>String(r.id)===b.dataset.editTier)));
    root.querySelectorAll('[data-history-tier]').forEach(b=>b.onclick=()=>{const r=S.rows.find(x=>String(x.id)===b.dataset.historyTier);C().openDrawer({eyebrow:'PROMOTION',title:`${r.nickname} 승급 이력`,html:historyHtml(r),onSubmit:async()=>{}});document.getElementById('adminDrawerSave').hidden=true;});
    root.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.sort;if(S.sort===k)S.asc=!S.asc;else{S.sort=k;S.asc=true;}load(0);});
  }
  async function init(){
    if(document.body.dataset.adminPage!=='tier')return;
    render();

    try{
      await load(0);
    }catch(err){
      console.error('티어표 관리 조회 실패:',err);
      const root=document.getElementById('adminDedicatedRoot');
      if(root) root.innerHTML=`<div class="admin-dedicated-shell"><div class="admin-empty">티어표 데이터를 불러오지 못했습니다.<br><small>${esc(C().errorText(err))}</small></div></div>`;
      C().toast(`티어표 조회 실패: ${C().errorText(err)}`,'error');
      return;
    }

    loadFilterOptions()
      .then(()=>render())
      .catch(err=>{
        console.error('티어 필터 옵션 조회 실패:',err);
        C().toast('티어 필터 옵션 일부를 불러오지 못했습니다. 표 조회는 계속 사용할 수 있습니다.','error');
      });
  }
  document.addEventListener('admin:ready',init);
}());
