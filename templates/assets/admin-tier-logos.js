// 티어표 관리 > 대학 로고: 로고를 올리면 브라우저가 긴 변 96px로 줄이고 대표 색을 뽑아
// Supabase(staruniv-media/logos/ + university_logos 표)에 저장한다. 스타유니브·시너지가 같이 쓴다.
(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const esc=v=>C().esc(v);
  const sb=()=>C().state.client;
  const SIZE=96;
  const NO_TEAM=new Set(['FA','휴면','체크','미분류','']);
  // 예전에 저장소에 파일로 두던 로고(한 번에 옮기기용). 원본이 큰 시너지 파일을 먼저 쓴다.
  const OLD_LOGOS=['BGM','DM','HM','JSA','YB','거성대','노적단','뉴캣슬','늪지대','더블비','드림즈','마범대','섭이대','소림사',
    '수술대','신세계','씨나인','엠비대','영정','와플대','우끼끼즈','이노대','장독대','정선대','캄몬스타즈','케이대','흑카데미'];
  const SYNERGY_RAW='https://raw.githubusercontent.com/ststats/synergy/main/';
  const L={rows:{},names:[],busy:false,progress:''};

  const root=()=>document.getElementById('tlRoot');
  const publicUrl=path=>C().mediaUrl(path);

  async function load(){
    const [{data:logos,error},people]=await Promise.all([
      sb().from('university_logos').select('name,path,color,updated_at'),
      fetchAllPages((from,to)=>sb().from('tier_members').select('affiliation').order('id',{ascending:true}).range(from,to)),
    ]);
    if(error)throw error;
    L.rows={};(logos||[]).forEach(r=>{L.rows[r.name]=r;});
    const count={};people.forEach(p=>{const a=String(p.affiliation||'').trim();if(!NO_TEAM.has(a))count[a]=(count[a]||0)+1;});
    L.count=count;
    // 지금 대학(선수가 있는 곳) 먼저, 그다음 로고만 있는 예전 대학
    const now=Object.keys(count).sort((a,b)=>a.localeCompare(b,'ko'));
    const old=Object.keys(L.rows).filter(n=>!count[n]).sort((a,b)=>a.localeCompare(b,'ko'));
    L.names=[...now,...old];
  }

  // ---------------------------------------------------------------------------
  // 이미지 처리: 대표 색(시너지 generate_pages.py의 get_team_topbar_color와 같은 방식)과 96px 사본
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

  async function save(name,fileBlob,color){
    const bitmap=await createImageBitmap(fileBlob);
    const small=await shrink(bitmap);
    const ext=small.type==='image/png'?'png':'webp';
    const path=`logos/${hexName(name)}-${Date.now()}.${ext}`;
    const up=await sb().storage.from('staruniv-media').upload(path,small,{contentType:small.type,upsert:false});
    if(up.error)throw up.error;
    const prev=L.rows[name];
    const row={name,path,color:color||topbarColor(bitmap),updated_at:new Date().toISOString()};
    const {error}=await sb().from('university_logos').upsert(row,{onConflict:'name'});
    if(error){await sb().storage.from('staruniv-media').remove([path]);throw error;}
    if(prev&&prev.path&&prev.path!==path)await sb().storage.from('staruniv-media').remove([prev.path]);
    L.rows[name]=row;
    try{localStorage.removeItem('staruniv-logos-v1');}catch(e){}
    return row;
  }
  async function remove(name){
    const prev=L.rows[name];if(!prev)return;
    const {error}=await sb().from('university_logos').delete().eq('name',name);
    if(error)throw error;
    await sb().storage.from('staruniv-media').remove([prev.path]);
    delete L.rows[name];
    try{localStorage.removeItem('staruniv-logos-v1');}catch(e){}
  }

  // 예전 로고 파일을 한 번에 옮긴다. 시너지가 쓰던 색은 그대로 가져온다(원본에서 뽑은 값).
  async function importOld(){
    const todo=OLD_LOGOS.filter(n=>!L.rows[n]);
    if(!todo.length)return C().toast('옮길 로고가 없습니다');
    if(!confirm(`예전 로고 ${todo.length}개를 옮길까요`))return;
    L.busy=true;
    let colors={};
    try{const r=await fetch(SYNERGY_RAW+'data/team_logo_colors_cache.json',{cache:'no-store'});if(r.ok)colors=await r.json();}catch(e){}
    let done=0;const failed=[];
    for(const name of todo){
      L.progress=`옮기는 중 ${done+failed.length+1}/${todo.length} · ${name}`;render();
      try{
        let blob=null;
        for(const url of [SYNERGY_RAW+'assets/logos/'+encodeURIComponent(name)+'.webp','images/'+encodeURIComponent(name)+'.webp']){
          const r=await fetch(url,{cache:'no-store'}).catch(()=>null);
          if(r&&r.ok){blob=await r.blob();break;}
        }
        if(!blob)throw new Error('파일 없음');
        await save(name,blob,colors[name]&&colors[name].color);
        done++;
      }catch(e){console.error(name,e);failed.push(name);}
    }
    L.busy=false;L.progress='';
    await load();render();
    C().toast(`로고 ${done}개를 옮겼습니다${failed.length?` · 실패 ${failed.join(', ')}`:''}`,failed.length?'error':'ok');
  }

  // ---------------------------------------------------------------------------
  // 화면
  // ---------------------------------------------------------------------------
  function logoBox(name){
    const r=L.rows[name];
    if(r)return `<img src="${esc(publicUrl(r.path))}" alt="">`;
    return `<span class="admin-tl-initial">${esc(Array.from(name)[0]||'?')}</span>`;
  }
  function render(){
    const el=root();if(!el)return;
    const missing=OLD_LOGOS.filter(n=>!L.rows[n]).length;
    el.innerHTML=`<section class="admin-tu-box">
      <div class="admin-section-head"><b>대학 로고</b><small>올리면 긴 변 ${SIZE}px로 자동으로 줄여 저장합니다 · 스타유니브·시너지 공용</small></div>
      ${missing?`<div class="admin-tl-import"><span>예전 로고 파일 ${missing}개가 아직 옮겨지지 않았습니다</span><button class="admin-btn primary" id="tlImport"${L.busy?' disabled':''}>한 번에 옮기기</button></div>`:''}
      ${L.progress?`<div class="admin-empty">${esc(L.progress)}</div>`:''}
      <div class="admin-tl-grid">${L.names.map(name=>{const r=L.rows[name];return `<div class="admin-tl-item">
        <div class="admin-tl-logo">${logoBox(name)}</div>
        <div class="admin-tl-meta"><b>${esc(name)}</b><small>${L.count[name]?`선수 ${L.count[name]}명`:'선수 없음'}${r&&r.color?` · <i class="admin-tl-color" style="background:${esc(r.color)}"></i>${esc(r.color)}`:''}</small></div>
        <div class="admin-tl-actions">
          <label class="admin-btn">${r?'바꾸기':'올리기'}<input type="file" accept="image/*" hidden data-tl-file="${esc(name)}"${L.busy?' disabled':''}></label>
          ${r?`<button class="admin-btn" data-tl-del="${esc(name)}"${L.busy?' disabled':''}>지우기</button>`:''}
        </div></div>`;}).join('')}</div>
      <div class="admin-tl-add"><input class="admin-input" id="tlNewName" placeholder="목록에 없는 대학 이름"><label class="admin-btn">로고 올리기<input type="file" accept="image/*" hidden id="tlNewFile"></label></div>
    </section>`;
    el.querySelector('#tlImport')?.addEventListener('click',()=>importOld().catch(e=>{L.busy=false;L.progress='';render();C().toast(C().errorText(e),'error');}));
    el.querySelectorAll('[data-tl-file]').forEach(inp=>inp.onchange=()=>upload(inp.dataset.tlFile,inp.files[0]));
    el.querySelectorAll('[data-tl-del]').forEach(b=>b.onclick=async()=>{
      const name=b.dataset.tlDel;if(!confirm(`${name} 로고를 지울까요`))return;
      try{await remove(name);C().toast('로고를 지웠습니다');await load();render();}catch(e){C().toast(C().errorText(e),'error');}
    });
    const nf=el.querySelector('#tlNewFile');
    if(nf)nf.onchange=()=>{const name=(el.querySelector('#tlNewName').value||'').trim();if(!name){C().toast('대학 이름을 먼저 적어 주세요','error');nf.value='';return;}upload(name,nf.files[0]);};
  }
  async function upload(name,file){
    if(!file)return;
    if(!/^image\//.test(file.type))return C().toast('이미지 파일만 올릴 수 있습니다','error');
    L.busy=true;L.progress=`${name} 로고 저장 중`;render();
    try{const row=await save(name,file);C().toast(`${name} 로고를 저장했습니다 · 색 ${row.color||'없음'}`);await load();}
    catch(e){C().toast(`저장 실패: ${C().errorText(e)}`,'error');}
    finally{L.busy=false;L.progress='';render();}
  }

  async function show(opts){
    const host=document.getElementById('adminDedicatedRoot');
    if(!host)return;
    host.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    host.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="STARCRAFT TIERS · ADMIN"><h1 class="page-header-title">대학 로고</h1><p class="page-header-subtitle">스타유니브와 시너지에 보이는 대학 로고입니다. 올리면 크기를 자동으로 줄이고 시너지 카드 윗줄 색도 함께 뽑습니다</p></div>${opts.tabs()}</div><div class="admin-dedicated-shell" id="tlRoot"><div class="admin-empty">불러오는 중</div></div>`;
    opts.bindTabs(host);
    try{await load();render();}
    catch(e){
      console.error('대학 로고 조회 실패:',e);
      const el=root();if(el)el.innerHTML=`<div class="admin-empty">대학 로고를 불러오지 못했습니다<br><small>${esc(C().errorText(e))} · supabase/staruniv.sql을 실행했는지 확인하세요</small></div>`;
    }
  }
  window.AdminTierLogos={show};
}());
