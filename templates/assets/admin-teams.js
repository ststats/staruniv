// 전적 관리 > 팀 관리: 대학(팀) 정보(설립자·창단일·해체일·우승·비고)와 로고.
// 로고는 올리면 브라우저가 긴 변 96px로 줄이고 대표 색을 뽑아 Supabase(staruniv-media/logos/ +
// university_logos 표, 대학 이름 기준)에 저장한다. 스타유니브·시너지가 같이 쓴다.
(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const esc=v=>C().esc(v);
  const sb=()=>C().state.client;
  const SIZE=96;
  const NO_TEAM=new Set(['FA','휴면','체크','미분류','']);
  const T={teams:[],logos:{},count:{}};

  const root=()=>document.getElementById('tmRoot');
  const clearLogoCache=()=>{try{localStorage.removeItem('staruniv-logos-v1');}catch(e){}};

  async function load(){
    const [teams,logos,people]=await Promise.all([
      sb().from('teams').select('*').order('source_order'),
      sb().from('university_logos').select('name,path,color,updated_at'),
      fetchAllPages((from,to)=>sb().from('tier_members').select('affiliation').order('id',{ascending:true}).range(from,to)),
    ]);
    if(teams.error)throw teams.error;
    T.teams=teams.data||[];
    // 로고 표가 아직 없으면(SQL 실행 전) 팀 정보만 보여 준다
    T.logoError=logos.error||null;
    T.logos={};(logos.data||[]).forEach(r=>{T.logos[r.name]=r;});
    T.count={};people.forEach(p=>{const a=String(p.affiliation||'').trim();if(!NO_TEAM.has(a))T.count[a]=(T.count[a]||0)+1;});
  }

  // ---------------------------------------------------------------------------
  // 로고: 대표 색(시너지 generate_pages.py의 get_team_topbar_color와 같은 방식)과 96px 사본
  // ---------------------------------------------------------------------------
  function topbarColor(bitmap){
    const c=document.createElement('canvas');c.width=40;c.height=40;
    const g=c.getContext('2d');g.drawImage(bitmap,0,0,40,40);
    const d=g.getImageData(0,0,40,40).data,buckets=new Map();
    for(let i=0;i<d.length;i+=4){
      const r=d[i],gg=d[i+1],b=d[i+2],a=d[i+3];
      if(a<128||(r>235&&gg>235&&b>235)||(r<20&&gg<20&&b<20))continue;
      const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b),sat=mx?(mx-mn)/mx:0;
      const key=[r,gg,b].map(v=>Math.floor(v/20)*20).join(',');
      const k=buckets.get(key)||[0,0];k[0]++;k[1]+=sat;buckets.set(key,k);
    }
    if(!buckets.size)return null;
    const top=[...buckets.entries()].sort((a,b)=>b[1][0]-a[1][0]).slice(0,6);
    const best=top.reduce((x,y)=>(y[1][1]/y[1][0]>x[1][1]/x[1][0]?y:x))[0];
    return '#'+best.split(',').map(v=>Number(v).toString(16).padStart(2,'0')).join('');
  }
  async function shrink(bitmap){
    const scale=Math.min(1,SIZE/Math.max(bitmap.width,bitmap.height));
    const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(bitmap,0,0,w,h);
    let blob=await new Promise(res=>c.toBlob(res,'image/webp',0.9));
    // 사파리 일부는 webp로 못 만든다 → png
    if(!blob||blob.type!=='image/webp')blob=await new Promise(res=>c.toBlob(res,'image/png'));
    return blob;
  }
  const hexName=name=>Array.from(new TextEncoder().encode(name)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,60);

  async function saveLogo(name,fileBlob,color){
    const bitmap=await createImageBitmap(fileBlob);
    const small=await shrink(bitmap);
    const ext=small.type==='image/png'?'png':'webp';
    const path=`logos/${hexName(name)}-${Date.now()}.${ext}`;
    const up=await sb().storage.from('staruniv-media').upload(path,small,{contentType:small.type,upsert:false});
    if(up.error)throw up.error;
    const prev=T.logos[name];
    const row={name,path,color:color||topbarColor(bitmap),updated_at:new Date().toISOString()};
    const {error}=await sb().from('university_logos').upsert(row,{onConflict:'name'});
    if(error){await sb().storage.from('staruniv-media').remove([path]);throw error;}
    if(prev&&prev.path&&prev.path!==path)await sb().storage.from('staruniv-media').remove([prev.path]);
    T.logos[name]=row;clearLogoCache();
    return row;
  }
  async function removeLogo(name){
    const prev=T.logos[name];if(!prev)return;
    const {error}=await sb().from('university_logos').delete().eq('name',name);
    if(error)throw error;
    await sb().storage.from('staruniv-media').remove([prev.path]);
    delete T.logos[name];clearLogoCache();
  }
  // 팀 이름을 바꾸면 로고도 새 이름으로 옮긴다(로고는 이름으로 찾는다)
  async function renameLogo(from,to){
    if(!T.logos[from]||T.logos[to])return;
    const {error}=await sb().from('university_logos').update({name:to}).eq('name',from);
    if(error)throw error;
    T.logos[to]={...T.logos[from],name:to};delete T.logos[from];clearLogoCache();
  }


  // ---------------------------------------------------------------------------
  // 팀 편집
  // ---------------------------------------------------------------------------
  function logoBox(name,cls='admin-tl-logo'){
    const r=T.logos[name];
    return `<div class="${cls}">${r?`<img src="${esc(C().mediaUrl(r.path))}" alt="">`:`<span class="admin-tl-initial">${esc(Array.from(name||'?')[0])}</span>`}</div>`;
  }
  function openTeam(team){
    const r=team||{};
    const logo=r.team_name?T.logos[r.team_name]:null;
    C().openDrawer({
      eyebrow:'TEAM',title:r.id?`${r.team_name} 수정`:'새 팀',
      html:`<div class="admin-form-grid">
        ${C().field('팀 이름',C().input('tm_name',r.team_name||'','text','required'),'티어표 소속·전적 상대 대학과 같은 이름')}
        ${C().field('설립자',C().input('tm_founders',r.founders||''))}
        ${C().field('창단일',C().input('tm_founded',r.founded_date||'','date'))}
        ${C().field('해체일',C().input('tm_disbanded',r.disbanded_date||'','date'))}
        ${C().field('우승',C().input('tm_championship',r.championship||''))}
      </div>
      ${C().field('비고',C().textarea('tm_note',r.note||'','rows="3"'))}
      <div class="admin-section-head"><b>로고</b><small>올리면 긴 변 ${SIZE}px로 줄여 저장합니다 · 시너지와 같이 씁니다</small></div>
      <div class="admin-tm-logo-edit">${logoBox(r.team_name||'?')}
        <div>${logo&&logo.color?`<small>카드 색 <i class="admin-tl-color" style="background:${esc(logo.color)}"></i>${esc(logo.color)}</small>`:''}
        <input class="admin-input" type="file" accept="image/*" id="tm_logo">
        ${logo?C().checkbox('tm_logo_del',false,'로고 지우기'):''}</div></div>`,
      onSubmit:async()=>{
        const name=C().value('tm_name').trim();
        if(!name)throw new Error('팀 이름은 필수입니다');
        const dup=T.teams.find(t=>t.team_name===name&&t.id!==r.id);
        if(dup)throw new Error(`${name}은(는) 이미 있는 팀입니다`);
        const row={team_name:name,founders:C().empty(C().value('tm_founders')),founded_date:C().empty(C().value('tm_founded')),
          disbanded_date:C().empty(C().value('tm_disbanded')),championship:C().empty(C().value('tm_championship')),note:C().empty(C().value('tm_note'))};
        if(r.id&&r.team_name!==name&&!confirm(`팀 이름을 ${r.team_name} → ${name}으로 바꿉니다\n전적의 상대 대학 이름과 티어표 소속은 자동으로 바뀌지 않습니다. 계속할까요`))throw new Error('저장을 취소했습니다');
        let error;
        if(r.id)({error}=await sb().from('teams').update(row).eq('id',r.id));
        else{row.source_order=await C().nextSourceOrder('teams');({error}=await sb().from('teams').insert(row));}
        if(error)throw error;
        if(r.id&&r.team_name&&r.team_name!==name)await renameLogo(r.team_name,name);
        const file=document.getElementById('tm_logo')?.files?.[0];
        if(file){
          if(!/^image\//.test(file.type))throw new Error('로고는 이미지 파일만 올릴 수 있습니다');
          await saveLogo(name,file);
        }else if(document.getElementById('tm_logo_del')?.checked){
          await removeLogo(name);
        }
        C().toast(`${name} 저장했습니다`);
        await load();render();
      },
      onDelete:r.id?async()=>{
        const {error}=await sb().from('teams').delete().eq('id',r.id);if(error)throw error;
        await C().audit('delete','teams',r.id,{team_name:r.team_name});
        C().toast(`${r.team_name} 팀을 지웠습니다(로고는 남겨 둡니다)`);
        await load();render();
      }:null,
      deleteConfirm:'이 팀을 지울까요? 전적의 상대 대학 이름은 그대로 남습니다',
    });
    // 고른 로고를 저장 전에 미리 보여 준다(실제 저장은 96px로 줄인 사본)
    const pick=document.getElementById('tm_logo');
    if(pick)pick.onchange=()=>{
      const f=pick.files&&pick.files[0],box=document.querySelector('.admin-tm-logo-edit .admin-tl-logo');
      if(f&&box&&/^image\//.test(f.type))box.innerHTML=`<img src="${esc(URL.createObjectURL(f))}" alt="">`;
    };
  }

  function render(){
    const el=root();if(!el)return;
    const names=new Set(T.teams.map(t=>t.team_name));
    // 팀 목록에 없지만 티어표에 선수가 있거나 로고가 있는 이름
    const extra=[...new Set([...Object.keys(T.count),...Object.keys(T.logos)])].filter(n=>!names.has(n)).sort((a,b)=>a.localeCompare(b,'ko'));
    el.innerHTML=`
      ${T.logoError?`<div class="admin-tl-import"><span>대학 로고 표가 아직 없습니다. supabase/staruniv.sql을 실행해 주세요</span></div>`:''}
      <div class="admin-table-wrap"><table class="admin-table admin-tm-table"><thead><tr><th>로고</th><th>팀</th><th>설립자</th><th>창단일</th><th>해체일</th><th>우승</th><th>비고</th><th>티어표 인원</th><th>관리</th></tr></thead><tbody>
      ${T.teams.map(t=>`<tr><td>${logoBox(t.team_name,'admin-tl-logo is-sm')}</td><td><b>${esc(t.team_name)}</b></td><td>${esc(t.founders)}</td><td>${esc(t.founded_date)}</td><td>${esc(t.disbanded_date)}</td><td>${esc(t.championship)}</td><td class="admin-tm-note">${esc(t.note)}</td><td>${T.count[t.team_name]||''}</td><td><button class="admin-btn" data-tm-edit="${t.id}">수정</button></td></tr>`).join('')||'<tr><td colspan="9">팀이 없습니다</td></tr>'}
      </tbody></table></div>
      ${extra.length?`<div class="admin-section-head"><b>팀 목록에 없는 대학 ${extra.length}</b><small>티어표에 선수가 있거나 로고만 있는 이름입니다. 누르면 팀으로 추가합니다</small></div>
      <div class="admin-tm-extra">${extra.map(n=>`<button type="button" class="admin-tm-chip" data-tm-add="${esc(n)}">${logoBox(n,'admin-tl-logo is-xs')}<span>${esc(n)}</span><small>${T.count[n]?`${T.count[n]}명`:'로고만'}</small></button>`).join('')}</div>`:''}`;
    el.querySelectorAll('[data-tm-edit]').forEach(b=>b.onclick=()=>openTeam(T.teams.find(t=>String(t.id)===b.dataset.tmEdit)));
    el.querySelectorAll('[data-tm-add]').forEach(b=>b.onclick=()=>openTeam({team_name:b.dataset.tmAdd}));
  }

  async function show(opts){
    const host=document.getElementById('adminDedicatedRoot');
    if(!host)return;
    host.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    host.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="RECORDS · ADMIN"><h1 class="page-header-title">팀 관리</h1><p class="page-header-subtitle">대학의 창단일·해체일·우승 기록과 로고를 관리합니다. 로고는 시너지에도 똑같이 보입니다</p></div>${opts.tabs()}</div><div class="admin-dedicated-shell">${C().pageToolsHtml([{id:'teamsAdd',label:'새 팀',icon:'plus'}])}<div id="tmRoot"><div class="admin-empty">불러오는 중</div></div></div>`;
    opts.bindTabs(host);
    host.querySelector('#teamsAdd').onclick=()=>openTeam(null);
    try{await load();render();}
    catch(e){
      console.error('팀 관리 조회 실패:',e);
      const el=root();if(el)el.innerHTML=`<div class="admin-empty">팀 정보를 불러오지 못했습니다<br><small>${esc(C().errorText(e))}</small></div>`;
    }
  }
  window.AdminTeams={show};
}());
