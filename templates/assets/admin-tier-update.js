// 티어표 관리 > 티어표 갱신: 펨코 티어표 이미지 + FA 명단 글을 분석(GitHub Actions)하고,
// 결과를 사람이 확인해 tier_members에 반영한다. 분석은 scripts/tier_table.py, DB 쪽은
// supabase/tier_table_update.sql. 반영한 카드는 다음 분석 때 기억(학습)에 더해진다.
(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const esc=v=>C().esc(v);
  const sb=()=>C().state.client;
  const RACES=['테란','저그','프로토스'];
  const NO_TEAM=new Set(['FA','휴면']);
  const STATUS={queued:'대기',running:'분석 중',done:'확인 대기',failed:'실패',applied:'반영됨'};
  const U={opts:null,jobs:[],jobId:null,job:null,people:null,byId:{},pickIndex:{},timer:null,
    form:{img:'',fa:''},decide:{},date:'',busy:false};

  const kstToday=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
  const root=()=>document.getElementById('tuRoot');
  const fmtTime=t=>t?new Date(t).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  const tierText=t=>/^\d$/.test(String(t??''))?`${t}티어`:String(t??'');

  // 북마클릿이 넘긴 값: admin-tier.html?view=update#tier-update?img=…&fa=…
  function takeHash(){
    const h=location.hash;
    if(!h.startsWith('#tier-update'))return;
    const p=new URLSearchParams(h.slice(h.indexOf('?')+1));
    U.form={img:p.get('img')||'',fa:p.get('fa')||''};
    history.replaceState(null,'',location.pathname+location.search);
  }

  // ---------------------------------------------------------------------------
  // 데이터
  // ---------------------------------------------------------------------------
  async function loadJobs(){
    const {data,error}=await sb().from('tier_update_jobs')
      .select('id,created_at,status,error,started_at,finished_at,applied_at,image_url')
      .order('id',{ascending:false}).limit(12);
    if(error)throw error;
    U.jobs=data||[];
  }
  async function loadPeople(){
    if(U.people)return;
    U.people=await fetchAllPages((from,to)=>sb().from('tier_members')
      .select('id,nickname,soop_id,tier,race,affiliation').order('id',{ascending:true}).range(from,to));
    U.byId={};U.pickIndex={};
    U.people.forEach(p=>{U.byId[p.id]=p;U.pickIndex[pickLabel(p)]=p.id;});
  }
  const pickLabel=p=>`${p.nickname} · ${p.affiliation||'-'} · ${tierText(p.tier)}`;
  async function openJob(id){
    U.jobId=id;U.job=null;U.decide={};render();
    const [{data,error}]=await Promise.all([
      sb().from('tier_update_jobs').select('id,status,error,image_url,fa_text,result,applied,created_at,applied_at').eq('id',id).maybeSingle(),
      loadPeople(),
    ]);
    if(error)throw error;
    U.job=data;
    U.date=kstToday();
    if(data&&data.status==='done')initDecisions();
    render();
  }

  // ---------------------------------------------------------------------------
  // 결과 → 관리자 선택(기본값)
  // ---------------------------------------------------------------------------
  function initDecisions(){
    const r=U.job.result||{};
    const d={changes:{},teams:{},cards:{},missing:{},faOnly:{}};
    (r.changes||[]).forEach((c,i)=>{d.changes[i]=!c.uncertain;});
    (r.review||[]).forEach((x,i)=>{
      if(x.type==='새 대학')d.teams[i]={name:x.team};
      else if(x.type==='신규 또는 인식 실패')d.cards[i]={mode:'skip',pick:'',nick:x.card?.nickname_ocr||'',tier:x.card?.tier||'',race:x.card?.race||''};
      else if(x.type==='표에서 빠짐')d.missing[i]='keep';
      else if(x.type&&x.type.startsWith('FA 명단에만 있음'))d.faOnly[i]={mode:'skip',pick:''};
    });
    U.decide=d;
  }
  // 새 대학 이름을 관리자가 고치면 그 대학으로 가는 모든 변동에 반영한다
  function teamName(team){
    const r=U.job.result||{};
    const i=(r.review||[]).findIndex(x=>x.type==='새 대학'&&x.team===team);
    return i>=0?(U.decide.teams[i]?.name||team).trim():team;
  }

  // 반영할 내용 모으기
  function buildPayload(){
    const r=U.job.result||{};
    const updates={},inserts=[],confirmed=[],unchecked=new Set();
    const put=(id,fields)=>{
      const cur=U.byId[id];if(!cur)return;
      const u=updates[id]||(updates[id]={id});
      Object.entries(fields).forEach(([k,v])=>{if(v!=null&&v!==''&&String(cur[k]??'')!==String(v))u[k]=v;});
    };
    (r.changes||[]).forEach((c,i)=>{
      if(!U.decide.changes[i]){if(c.ref)unchecked.add(c.ref.join(','));return;}
      if(c.id==null)return;
      const f={};
      if(c.diff.affiliation)f.affiliation=teamName(c.diff.affiliation[1]);
      if(c.diff.tier)f.tier=String(c.diff.tier[1]);
      if(c.diff.race)f.race=c.diff.race[1];
      put(c.id,f);
    });
    (r.review||[]).forEach((x,i)=>{
      if(x.type==='신규 또는 인식 실패'){
        const dc=U.decide.cards[i];const team=teamName(x.team);
        if(dc.mode==='pick'){
          const id=U.pickIndex[dc.pick];
          if(!id)throw new Error(`'${x.card?.nickname_ocr||'카드'}' 기존 선수를 목록에서 골라 주세요`);
          put(id,{affiliation:team,tier:x.card?.tier,race:x.card?.race});
          confirmed.push({ref:x.ref,id});
        }else if(dc.mode==='new'){
          if(!dc.nick.trim())throw new Error('새 선수 닉네임을 적어 주세요');
          confirmed.push({ref:x.ref,insert:inserts.length});
          inserts.push({nickname:dc.nick.trim(),tier:dc.tier,race:dc.race,affiliation:team});
        }
      }else if(x.type==='표에서 빠짐'){
        const v=U.decide.missing[i];
        if(v!=='keep'&&x.id!=null)put(x.id,{affiliation:v});
      }else if(x.type&&x.type.startsWith('FA 명단에만 있음')){
        const dc=U.decide.faOnly[i];
        if(dc.mode==='pick'){
          const id=U.pickIndex[dc.pick];
          if(!id)throw new Error(`FA '${x.nickname}' 기존 선수를 목록에서 골라 주세요`);
          put(id,{affiliation:'FA',tier:x.tier,race:x.race,nickname:x.nickname});
        }else if(dc.mode==='new'){
          inserts.push({nickname:x.nickname,tier:x.tier,race:x.race,affiliation:'FA'});
        }
      }
    });
    // 분석기가 맞춘 카드: 관리자가 체크를 뺀 변동의 카드는 배우지 않는다(짝이 틀렸을 수 있음)
    (r.matches||[]).forEach(m=>{
      if(m.id!=null&&!unchecked.has(m.ref.join(',')))confirmed.push({ref:m.ref,id:m.id});
    });
    const ups=Object.values(updates).filter(u=>Object.keys(u).length>1);
    return {updates:ups,inserts,confirmed};
  }

  async function apply(){
    if(U.busy)return;
    let p;
    try{p=buildPayload();}catch(e){C().toast(e.message,'error');return;}
    if(!p.updates.length&&!p.inserts.length&&!confirm('바꿀 선수가 없습니다. 확인만 한 것으로 표시할까요'))return;
    if((p.updates.length||p.inserts.length)&&!confirm(`선수 ${p.updates.length}명 수정, 새 선수 ${p.inserts.length}명 추가\n승급일은 ${U.date}로 적습니다. 반영할까요`))return;
    U.busy=true;render();
    try{
      const {data,error}=await sb().rpc('admin_apply_tier_update',{p_job_id:U.jobId,p_updates:p.updates,p_inserts:p.inserts,p_confirmed:p.confirmed,p_date:U.date||null});
      if(error)throw error;
      C().toast(`반영했습니다: 수정 ${data.updated}명 · 추가 ${data.inserted}명`);
      U.people=null;
      await loadJobs();await openJob(U.jobId);
    }catch(e){C().toast(`반영 실패: ${C().errorText(e)}`,'error');}
    finally{U.busy=false;render();}
  }

  async function request(){
    const img=(document.getElementById('tuImg')?.value||'').trim();
    const fa=document.getElementById('tuFa')?.value||'';
    U.form={img,fa};
    if(!/^https:\/\/image\.fmkorea\.com\//.test(img)){C().toast('이미지 주소는 https://image.fmkorea.com/ 으로 시작해야 합니다','error');return;}
    if(!fa.trim()&&!confirm('FA 명단 글 없이 분석하면 휴면 처리를 하지 않습니다(표에서 빠진 선수는 확인으로만 나옵니다). 계속할까요'))return;
    U.busy=true;render();
    try{
      const {data,error}=await sb().rpc('admin_request_tier_analysis',{p_image_url:img,p_fa_text:fa});
      if(error)throw error;
      U.form={img:'',fa:''};
      C().toast(`분석을 요청했습니다(작업 ${data}) 1~2분 걸립니다`);
      await loadJobs();U.jobId=data;U.job=null;
    }catch(e){C().toast(`요청 실패: ${C().errorText(e)}`,'error');}
    finally{U.busy=false;render();poll();}
  }

  // 대기·분석 중인 작업이 있으면 5초마다 상태를 본다
  function poll(){
    clearTimeout(U.timer);
    if(!U.jobs.some(j=>j.status==='queued'||j.status==='running'))return;
    U.timer=setTimeout(async()=>{
      if(!root())return;
      try{
        const before=Object.fromEntries(U.jobs.map(j=>[j.id,j.status]));
        await loadJobs();
        // 오래 '대기'면 GitHub 실행 요청이 거절됐는지 확인
        for(const j of U.jobs.filter(j=>j.status==='queued'&&Date.now()-new Date(j.created_at)>45e3)){
          const {data}=await sb().rpc('admin_tier_job_dispatch_status',{p_job_id:j.id});
          const s=(data||[])[0];
          if(s&&s.status_code&&s.status_code!==204)j.dispatchError=`GitHub 실행 요청 실패(${s.status_code}) ${s.error||''}`;
        }
        const cur=U.jobs.find(j=>j.id===U.jobId);
        if(cur&&before[cur.id]!==cur.status&&cur.status==='done'){await openJob(cur.id);}
        else render();
      }catch(e){console.error('작업 상태 확인 실패:',e);}
      poll();
    },5000);
  }

  // ---------------------------------------------------------------------------
  // 화면
  // ---------------------------------------------------------------------------
  function cardThumb(ref){
    const img=U.job?.result?.image?.url||U.job?.image_url;
    const sec=U.job?.result?.sections?.[ref?.[0]];
    const card=sec?.cards[ref[1]];
    if(!card||!img)return '';
    const x=Math.max(0,card.x-4),y=Math.max(0,card.y-4);
    // 같은 줄 다음 카드 사진 앞까지만 보여 준다(칸이 좁은 대학은 옆 카드가 섞이지 않게)
    const next=Math.min(...sec.cards.filter(c=>c.row===card.row&&c.x>card.x).map(c=>c.x),x+218);
    // 펨코 이미지 서버는 다른 사이트 Referer를 막고 Referer가 없으면 보여 준다
    return `<div class="admin-tu-thumb" style="width:${next-x-2}px"><img src="${esc(img)}" referrerpolicy="no-referrer" alt="" style="transform:translate(${-x}px,${-y}px)"></div>`;
  }
  function diffText(c){
    const parts=[];
    if(c.diff.affiliation)parts.push(`소속 ${esc(c.diff.affiliation[0]||'-')} → <b>${esc(teamName(c.diff.affiliation[1]))}</b>`);
    if(c.diff.tier)parts.push(`티어 ${esc(tierText(c.diff.tier[0])||"-")} → <b>${esc(tierText(c.diff.tier[1]))}</b>`);
    if(c.diff.race)parts.push(`종족 ${esc(c.diff.race[0]||'-')} → <b>${esc(c.diff.race[1])}</b>`);
    return parts.join('<br>');
  }
  function pickInput(id,value){
    return `<input class="admin-input" list="tuPeople" data-tu-pick="${id}" value="${esc(value)}" placeholder="닉네임으로 찾기">`;
  }
  function optionList(list,cur){
    return list.map(v=>`<option value="${esc(v)}"${String(v)===String(cur)?' selected':''}>${esc(v?tierText(v):'-')}</option>`).join('');
  }

  function requestHtml(){
    const admin=`${location.origin}${location.pathname}?view=update`;
    // 펨코 글에서 누르면 티어표 이미지 주소와 FA 명단 줄만 뽑아 이 화면을 연다
    const code=`(()=>{const a=document.querySelector('.xe_content,article')||document.body;let b=null,h=0;a.querySelectorAll('img').forEach(i=>{const s=i.getAttribute('data-original')||i.currentSrc||i.src||'';const v=i.naturalHeight||i.offsetHeight||0;if(/image\\.fmkorea\\.com/.test(s)&&v>=h){h=v;b=new URL(s,location.href).href.replace(/^http:/,'https:');}});const f=a.innerText.split('\\n').filter(l=>/[｜|]/.test(l)||/^\\s*[TZP]\\s/.test(l)||/FA 인원/.test(l)).join('\\n');if(!b){alert('티어표 이미지를 찾지 못했습니다');return;}open('${admin}#tier-update?img='+encodeURIComponent(b)+'&fa='+encodeURIComponent(f));})()`;
    // 폰 북마크 주소칸은 공백·한글을 받지 않는다: 코드 전체를 URL 인코딩한다(실행할 때 브라우저가 풀어 준다)
    const bm='javascript:'+encodeURIComponent(code);
    return `<section class="admin-tu-box">
      <div class="admin-section-head"><b>분석 요청</b><small>펨코 티어표 글의 이미지 주소와 FA 명단 글을 넣습니다</small></div>
      <div class="admin-tu-form">
        <label class="admin-field"><span>티어표 이미지 주소</span><input class="admin-input" id="tuImg" value="${esc(U.form.img)}" placeholder="https://image.fmkorea.com/files/attach/"></label>
        <label class="admin-field"><span>FA 명단 글</span><textarea class="admin-input admin-textarea" id="tuFa" rows="5" placeholder="갓티어｜ T 이재호 유영진  Z 이제동  P 송병구">${esc(U.form.fa)}</textarea></label>
        <div class="admin-tu-actions"><button class="admin-btn primary" id="tuRequest"${U.busy?' disabled':''}>분석 요청</button>
        <a class="admin-btn" href="${esc(bm)}" id="tuBookmarklet" title="북마크바로 끌어다 놓기">펨코 글에서 가져오기</a>
        <button type="button" class="admin-btn" id="tuBmCopy">북마크 코드 복사</button></div>
        <small class="admin-help">PC: '펨코 글에서 가져오기'를 북마크바로 끌어다 놓고, 펨코 티어표 글에서 누르면 두 칸이 채워진 채로 이 화면이 열립니다<br>
        폰: '북마크 코드 복사' → 아무 페이지나 북마크 추가 → 북마크 주소를 복사한 코드로 바꾸고 이름을 '티어표'로 저장 → 펨코 글에서 주소창에 '티어표'를 쳐서 북마크를 누릅니다(크롬). 번거로우면 이미지를 길게 눌러 '이미지 주소 복사'하고 FA 글을 복사해 붙여 넣어도 됩니다</small>
      </div>
    </section>`;
  }
  function jobsHtml(){
    if(!U.jobs.length)return '';
    return `<section class="admin-tu-box"><div class="admin-section-head"><b>최근 작업</b><small>누르면 결과를 봅니다</small></div>
      <div class="admin-tu-jobs">${U.jobs.map(j=>`<button type="button" class="admin-tu-job${j.id===U.jobId?' is-on':''}" data-tu-job="${j.id}">
        <b>#${j.id}</b><span class="admin-tu-status is-${j.status}">${STATUS[j.status]||j.status}</span><small>${esc(fmtTime(j.created_at))}</small>
        ${j.status==='failed'&&j.error?`<small class="admin-tu-err">${esc(j.error.slice(0,120))}</small>`:''}
        ${j.dispatchError?`<small class="admin-tu-err">${esc(j.dispatchError)}</small>`:''}</button>`).join('')}</div></section>`;
  }
  function resultHtml(){
    if(!U.jobId)return '';
    const j=U.job;
    if(!j){
      const meta=U.jobs.find(x=>x.id===U.jobId);
      if(meta&&(meta.status==='queued'||meta.status==='running'))return `<section class="admin-tu-box"><div class="admin-empty">작업 #${U.jobId} ${STATUS[meta.status]}<br>GitHub Actions에서 이미지를 읽는 중입니다. 끝나면 결과가 자동으로 열립니다</div></section>`;
      return `<section class="admin-tu-box"><div class="admin-empty">결과를 불러오는 중</div></section>`;
    }
    if(j.status==='failed')return `<section class="admin-tu-box"><div class="admin-empty">분석 실패<br><small>${esc(j.error||'')}</small></div></section>`;
    if(j.status==='applied')return appliedHtml(j);
    if(j.status!=='done')return `<section class="admin-tu-box"><div class="admin-empty">작업 #${j.id} ${STATUS[j.status]||j.status}</div></section>`;
    if(!j.result)return `<section class="admin-tu-box"><div class="admin-empty">작업 #${j.id}의 분석 결과는 오래되어 정리했습니다<br>다시 분석을 요청해 주세요</div></section>`;
    const r=j.result||{};
    const cards=(r.sections||[]).reduce((n,s)=>n+s.cards.length,0);
    const changes=(r.changes||[]).map((c,i)=>{
      return `<tr class="${c.uncertain?'is-uncertain':''}"><td><input type="checkbox" data-tu-change="${i}"${U.decide.changes[i]?' checked':''}></td>
        <td>${cardThumb(c.ref)}</td><td><b>${esc(c.nickname)}</b>${c.ocr&&c.ocr!==c.nickname?`<br><small>카드 글씨: ${esc(c.ocr)}</small>`:''}</td>
        <td>${diffText(c)}${c.reason?`<br><small>${esc(c.reason)}</small>`:''}${c.uncertain?`<br><small class="admin-tu-err">확인 필요: ${esc(c.uncertain)}</small>`:''}</td></tr>`;
    }).join('');
    const reviews=(r.review||[]).map((x,i)=>reviewRow(x,i)).join('');
    return `<section class="admin-tu-box">
      <div class="admin-section-head"><b>작업 #${j.id} 결과</b><small>카드 ${cards}장 · FA ${(r.fa||[]).length}명 · <a href="${esc(r.image?.url||j.image_url)}" target="_blank" rel="noreferrer">원본 이미지</a></small></div>
      <div class="admin-section-head"><b>변동 ${(r.changes||[]).length}건</b><small>체크한 것만 반영합니다. 확인 필요 표시는 기본으로 빠져 있습니다</small></div>
      ${changes?`<div class="admin-table-wrap"><table class="admin-table admin-tu-table"><thead><tr><th><input type="checkbox" id="tuAll"></th><th>카드</th><th>선수</th><th>바뀌는 내용</th></tr></thead><tbody>${changes}</tbody></table></div>`:'<div class="admin-empty">바뀐 선수가 없습니다</div>'}
      ${reviews?`<div class="admin-section-head"><b>사람이 볼 것 ${(r.review||[]).length}건</b><small>새 얼굴·새 대학 등은 직접 고릅니다</small></div><div class="admin-tu-reviews">${reviews}</div>`:''}
      <div class="admin-tu-apply"><label class="admin-field"><span>승급일로 적을 날짜</span><input class="admin-input" type="date" id="tuDate" value="${esc(U.date)}"></label>
        <button class="admin-btn primary" id="tuApply"${U.busy?' disabled':''}>반영</button></div>
      <datalist id="tuPeople">${(U.people||[]).map(p=>`<option value="${esc(pickLabel(p))}"></option>`).join('')}</datalist>
    </section>`;
  }
  // ---------------------------------------------------------------------------
  // 반영 내역: 누가 무엇이 바뀌었는지(공지용 글 복사 포함)
  // ---------------------------------------------------------------------------
  const tierPos=t=>{const i=SITE_ORDER.tiers.indexOf(String(t??''));return i<0?99:i;};
  // 기록 한 줄 → 분류(한 선수가 여러 개일 수 있음)와 설명
  function logKinds(e){
    const b=e.before||{},a=e.after||{},out=[];
    if(e.new){out.push(['새 선수',`${a.nickname} (${a.affiliation||'-'}, ${tierText(a.tier)||'-'}, ${a.race||'-'})`]);return out;}
    const who=a.nickname;
    if(b.tier!==a.tier){
      const up=tierPos(a.tier)<tierPos(b.tier);
      out.push([up?'승급':'강등',`${who} ${tierText(b.tier)||'-'} → ${tierText(a.tier)}`]);
    }
    if(b.affiliation!==a.affiliation){
      const to=a.affiliation,from=b.affiliation;
      const kind=to==='휴면'?'휴면':to==='FA'?'FA':NO_TEAM.has(from)||!from?'입단·복귀':'이적';
      out.push([kind,kind==='휴면'||kind==='FA'?`${who} (${from||'-'})`:`${who} ${from||'-'} → ${to}`]);
    }
    if(b.race!==a.race)out.push(['종족',`${who} ${b.race||'-'} → ${a.race}`]);
    if(b.nickname!==a.nickname)out.push(['닉네임',`${b.nickname} → ${a.nickname}`]);
    return out;
  }
  const LOG_ORDER=['승급','강등','입단·복귀','이적','FA','휴면','새 선수','종족','닉네임'];
  function logGroups(log){
    const g={};
    log.forEach(e=>logKinds(e).forEach(([k,t])=>{(g[k]=g[k]||[]).push(t);}));
    return LOG_ORDER.filter(k=>g[k]).map(k=>[k,g[k]]);
  }
  function appliedText(j){
    const a=j.applied||{};
    const lines=logGroups(a.log||[]).map(([k,items])=>`[${k}] ${items.join(', ')}`);
    return `티어표 갱신 ${a.date||''}\n${lines.join('\n')||'바뀐 선수 없음'}`;
  }
  function appliedHtml(j){
    const a=j.applied||{},log=a.log;
    const head=`<div class="admin-section-head"><b>작업 #${j.id} 반영 내역</b><small>${esc(fmtTime(j.applied_at))} 반영 · 승급일 ${esc(a.date||'-')} · 확인된 카드 ${(a.confirmed||[]).length}장은 다음 분석 때 학습</small></div>`;
    if(!log)return `<section class="admin-tu-box">${head}<div class="admin-empty">수정 ${(a.updates||[]).length}명 · 추가 ${(a.inserts||[]).length}명<br>이 작업은 자세한 기록 전에 반영되어 선수별 내역이 없습니다</div></section>`;
    if(!log.length)return `<section class="admin-tu-box">${head}<div class="admin-empty">바뀐 선수가 없습니다</div></section>`;
    const groups=logGroups(log);
    return `<section class="admin-tu-box">${head}
      <div class="admin-tu-log">${groups.map(([k,items])=>`<div class="admin-tu-log-row"><b>${esc(k)} ${items.length}</b><span>${items.map(esc).join('<br>')}</span></div>`).join('')}</div>
      <div class="admin-tu-apply"><button class="admin-btn" id="tuCopyLog">공지용 글 복사</button></div>
    </section>`;
  }

  function reviewRow(x,i){
    const d=U.decide;
    if(x.type==='새 대학'){
      return `<div class="admin-tu-review"><b>새 대학</b><div>표 머리 글씨: ${esc((x.title_ocr||[]).join(' / ')||'못 읽음')} · 카드 ${x.cards}장
        ${x.prev_affiliation?.length?`<br><small>선수들 원래 소속: ${x.prev_affiliation.map(([t,n])=>`${esc(t)} ${n}명`).join(', ')}</small>`:''}
        ${x.renamed_from?`<br><small class="admin-tu-err">${esc(x.renamed_from)}이(가) 표에서 없어졌습니다. 이름이 바뀐 것일 수 있습니다</small>`:''}</div>
        <label class="admin-field"><span>대학 이름</span><input class="admin-input" data-tu-team="${i}" value="${esc(d.teams[i].name)}"></label></div>`;
    }
    if(x.type==='신규 또는 인식 실패'){
      const dc=d.cards[i];
      return `<div class="admin-tu-review">${cardThumb(x.ref)}<div><b>모르는 카드</b> · ${esc(teamName(x.team))}<br><small>글씨: ${esc(x.card?.nickname_ocr||'못 읽음')} · ${esc(tierText(x.card?.tier)||'티어 ?')} · ${esc(x.card?.race||'종족 ?')}</small></div>
        <div class="admin-tu-choice"><select class="admin-input" data-tu-card-mode="${i}">${[['skip','보류(반영 안 함)'],['pick','기존 선수'],['new','새 선수 추가']].map(([k,l])=>`<option value="${k}"${dc.mode===k?' selected':''}>${l}</option>`).join('')}</select>
        ${dc.mode==='pick'?pickInput(`card-${i}`,dc.pick):''}
        ${dc.mode==='new'?`<input class="admin-input" data-tu-card-nick="${i}" value="${esc(dc.nick)}" placeholder="닉네임">
          <select class="admin-input" data-tu-card-tier="${i}">${optionList(['',...SITE_ORDER.tiers],dc.tier)}</select>
          <select class="admin-input" data-tu-card-race="${i}">${optionList(['',...RACES],dc.race)}</select>`:''}</div></div>`;
    }
    if(x.type==='표에서 빠짐'){
      return `<div class="admin-tu-review"><div><b>표에서 빠짐</b> · ${esc(x.nickname)} (${esc(x.team)}, ${esc(tierText(x.tier))})<br><small>FA 명단 글이 없어 휴면인지 모릅니다</small></div>
        <select class="admin-input" data-tu-missing="${i}">${[['keep','그대로'],['휴면','휴면'],['FA','FA']].map(([k,l])=>`<option value="${k}"${d.missing[i]===k?' selected':''}>${l}</option>`).join('')}</select></div>`;
    }
    if(x.type&&x.type.startsWith('FA 명단에만 있음')){
      const dc=d.faOnly[i];
      return `<div class="admin-tu-review"><div><b>FA 명단에만 있음</b> · ${esc(x.nickname)} (${esc(tierText(x.tier))}, ${esc(x.race)})<br><small>새 선수이거나 닉네임이 바뀐 선수입니다</small></div>
        <div class="admin-tu-choice"><select class="admin-input" data-tu-fa-mode="${i}">${[['skip','보류'],['pick','기존 선수(닉네임 변경)'],['new','새 선수 추가']].map(([k,l])=>`<option value="${k}"${dc.mode===k?' selected':''}>${l}</option>`).join('')}</select>
        ${dc.mode==='pick'?pickInput(`fa-${i}`,dc.pick):''}</div></div>`;
    }
    if(x.type==='표에서 없어진 대학')return `<div class="admin-tu-review"><div><b>표에서 없어진 대학</b> · ${esc(x.team)} (${x.members}명)<br><small>선수들은 FA 명단에 있으면 FA, 없으면 휴면 변동으로 올라가 있습니다</small></div></div>`;
    return `<div class="admin-tu-review"><div><b>${esc(x.type)}</b> · ${esc(x.nickname||x.team||'')}</div></div>`;
  }

  function render(){
    const el=root();if(!el)return;
    const keep=document.activeElement&&el.contains(document.activeElement)?document.activeElement.id:null;
    el.innerHTML=requestHtml()+jobsHtml()+resultHtml();
    bind(el);
    if(keep)document.getElementById(keep)?.focus();
  }
  function bind(el){
    const on=(sel,ev,fn)=>el.querySelectorAll(sel).forEach(n=>n[ev]=()=>fn(n));
    el.querySelector('#tuRequest')?.addEventListener('click',request);
    el.querySelector('#tuApply')?.addEventListener('click',apply);
    el.querySelector('#tuCopyLog')?.addEventListener('click',async()=>{
      const text=appliedText(U.job);
      try{await navigator.clipboard.writeText(text);C().toast('반영 내역을 복사했습니다');}
      catch(e){prompt('아래 글을 복사하세요',text);}
    });
    const bmLink=el.querySelector('#tuBookmarklet');
    bmLink?.addEventListener('click',ev=>{ev.preventDefault();C().toast('북마크바로 끌어다 놓아 쓰는 버튼입니다');});
    el.querySelector('#tuBmCopy')?.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(bmLink.getAttribute('href'));C().toast('북마크 코드를 복사했습니다');}
      catch(e){prompt('아래 코드를 복사하세요',bmLink.getAttribute('href'));}
    });
    ['tuImg','tuFa'].forEach(id=>{const n=el.querySelector('#'+id);if(n)n.oninput=()=>{U.form[id==='tuImg'?'img':'fa']=n.value;};});
    const date=el.querySelector('#tuDate');if(date)date.onchange=()=>{U.date=date.value;};
    on('[data-tu-job]','onclick',n=>openJob(Number(n.dataset.tuJob)).catch(e=>C().toast(C().errorText(e),'error')));
    on('[data-tu-change]','onchange',n=>{U.decide.changes[n.dataset.tuChange]=n.checked;});
    const all=el.querySelector('#tuAll');
    if(all)all.onchange=()=>{Object.keys(U.decide.changes).forEach(k=>{U.decide.changes[k]=all.checked;});render();};
    on('[data-tu-team]','oninput',n=>{U.decide.teams[n.dataset.tuTeam].name=n.value;});
    on('[data-tu-team]','onchange',()=>render());
    on('[data-tu-card-mode]','onchange',n=>{U.decide.cards[n.dataset.tuCardMode].mode=n.value;render();});
    on('[data-tu-card-nick]','oninput',n=>{U.decide.cards[n.dataset.tuCardNick].nick=n.value;});
    on('[data-tu-card-tier]','onchange',n=>{U.decide.cards[n.dataset.tuCardTier].tier=n.value;});
    on('[data-tu-card-race]','onchange',n=>{U.decide.cards[n.dataset.tuCardRace].race=n.value;});
    on('[data-tu-missing]','onchange',n=>{U.decide.missing[n.dataset.tuMissing]=n.value;});
    on('[data-tu-fa-mode]','onchange',n=>{U.decide.faOnly[n.dataset.tuFaMode].mode=n.value;render();});
    on('[data-tu-pick]','oninput',n=>{
      const [kind,i]=n.dataset.tuPick.split('-');
      (kind==='card'?U.decide.cards:U.decide.faOnly)[i].pick=n.value;
    });
  }

  // admin-tier.js의 '티어표 갱신' 탭이 부른다
  async function show(opts){
    U.opts=opts;
    takeHash();
    const host=document.getElementById('adminDedicatedRoot');
    if(!host)return;
    host.hidden=false;
    document.body.classList.add('admin-dedicated-active');
    host.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="STARCRAFT TIERS · ADMIN"><h1 class="page-header-title">티어표 갱신</h1><p class="page-header-subtitle">펨코 티어표 이미지를 읽어 DB와 비교합니다. 바뀐 점을 확인하고 반영하면, 확인한 카드는 다음 분석 때 학습됩니다</p></div>${opts.tabs()}</div><div class="admin-dedicated-shell" id="tuRoot"></div>`;
    opts.bindTabs(host);
    render();
    try{
      await loadJobs();
      if(!U.jobId&&U.jobs[0]&&!U.form.img)U.jobId=U.jobs[0].id;
      render();
      const cur=U.jobs.find(j=>j.id===U.jobId);
      if(cur&&!['queued','running'].includes(cur.status))await openJob(cur.id);
      poll();
    }catch(e){
      console.error('티어표 갱신 작업 조회 실패:',e);
      const el=root();
      if(el)el.insertAdjacentHTML('beforeend',`<div class="admin-empty">작업 목록을 불러오지 못했습니다<br><small>${esc(C().errorText(e))} · supabase/tier_table_update.sql을 실행했는지 확인하세요</small></div>`);
    }
  }
  window.AdminTierUpdate={show};
}());
