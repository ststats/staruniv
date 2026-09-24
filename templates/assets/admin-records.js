(function () {
  'use strict';
  const C=()=>window.AdminCore;
  const S={page:0,size:25,count:0,rows:[],expanded:new Map(),members:[],roundCounts:{}};

  function esc(v){return C().esc(v);}
  function resultKind(v){
    const s=String(v||'').trim().toLowerCase();
    if(['승','승리','win','w'].includes(s))return 'win';
    if(['패','패배','loss','lose','l'].includes(s))return 'loss';
    return '';
  }
  function validateScore(match,rounds){
    let w=0,l=0;rounds.forEach(r=>{const k=resultKind(r.result);if(k==='win')w++;if(k==='loss')l++;});
    if(!w&&!l)return null;
    const score=`${w}:${l}`, final=w>l?'승':w<l?'패':'무';
    const mismatches=[];
    if(match.set_result&&String(match.set_result).replace(/\s/g,'')!==score)mismatches.push(`세트 스코어 ${match.set_result} ↔ ${score}`);
    if(match.final_result&&resultKind(match.final_result)&&resultKind(match.final_result)!==resultKind(final))mismatches.push(`결과 ${match.final_result} ↔ ${final}`);
    return {w,l,score,final,mismatches};
  }
  // 캄몬 선수는 용병이 뛰는 경우도 있어 자유 입력이다. 멤버 이름은 자동완성으로만 제안한다.
  function memberDatalist(){
    const names=[...new Set(S.members.map(m=>m.name||m.nickname).filter(Boolean))];
    return `<datalist id="ar_member_names">${names.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>`;
  }
  function roundRow(r={},idx=0){
    return `<tr class="admin-round-row" data-round-index="${idx}">
      <td><input class="admin-input" data-k="source_order" type="number" value="${esc(r.source_order??idx+1)}"></td>
      <td><input class="admin-input" data-k="set_name" value="${esc(r.set_name||'')}"></td>
      <td><input class="admin-input" data-k="round_name" value="${esc(r.round_name||'')}"></td>
      <td><input class="admin-input" data-k="our_player" list="ar_member_names" placeholder="멤버 또는 용병" value="${esc(r.our_player||'')}"></td>
      <td><input class="admin-input" data-k="our_race" value="${esc(r.our_race||'')}"></td>
      <td><input class="admin-input" data-k="our_tier" value="${esc(r.our_tier||'')}"></td>
      <td><input class="admin-input" data-k="opponent_player" value="${esc(r.opponent_player||'')}"></td>
      <td><input class="admin-input" data-k="opponent_race" value="${esc(r.opponent_race||'')}"></td>
      <td><input class="admin-input" data-k="opponent_tier" value="${esc(r.opponent_tier||'')}"></td>
      <td><input class="admin-input" data-k="map_name" value="${esc(r.map_name||'')}"></td>
      <td><select class="admin-input" data-k="result"><option value=""></option><option${r.result==='승'?' selected':''}>승</option><option${r.result==='패'?' selected':''}>패</option></select></td>
      <td><button type="button" class="admin-btn danger admin-round-delete">삭제</button></td>
    </tr>`;
  }
  function editorHtml(match={},rounds=[]){
    return `
      <div class="admin-form-grid">
        ${C().field('경기번호',C().input('ar_no',match.match_no??'','number','min="1"'))}
        ${C().field('날짜',C().input('ar_date',match.match_date||'','date','required'))}
        ${C().field('상대 대학',C().input('ar_opp',match.opponent_team||'','text','required'))}
        ${C().field('형식',C().input('ar_format',match.match_format||''))}
        ${C().field('진행 방식',C().input('ar_method',match.method||''))}
        ${C().field('결과',C().input('ar_result',match.final_result||''))}
        ${C().field('세트 스코어',C().input('ar_set',match.set_result||''))}
        ${C().field('세트 수',C().input('ar_sets',rounds.length,'number','readonly'))}
      </div>
      <div class="admin-section-head"><b>세트</b><button type="button" class="admin-btn" id="ar_add_round">+ 세트 추가</button></div>
      <div class="admin-table-wrap"><table class="admin-table admin-table-wide"><thead><tr><th>순서</th><th>세트명</th><th>라운드명</th><th>캄몬 선수</th><th>캄몬 종족</th><th>캄몬 티어</th><th>상대 선수</th><th>상대 종족</th><th>상대 티어</th><th>맵</th><th>결과</th><th>관리</th></tr></thead><tbody id="ar_rounds">${rounds.map(roundRow).join('')}</tbody></table></div>${memberDatalist()}`;
  }
  function collectRounds(){
    return [...document.querySelectorAll('#ar_rounds .admin-round-row')].map((tr,i)=>{
      const r={};tr.querySelectorAll('[data-k]').forEach(el=>r[el.dataset.k]=C().empty(el.value));r.source_order=Number(r.source_order||i+1);return r;
    });
  }
  async function getRounds(matchNo){
    const {data,error}=await C().state.client.from('rounds').select('*').eq('match_no',matchNo).order('source_order');if(error)throw error;return data||[];
  }
  async function openEditor(match,clone=false){
    match=match||{};const sourceNo=match.match_no;const rounds=sourceNo?await getRounds(sourceNo):[];
    const editing=clone?{...match,match_no:null,source_order:null}:match;
    C().openDrawer({
      eyebrow:'RECORD',title:clone?'매치 복제':sourceNo?'매치 수정':'새 매치',
      html:editorHtml(editing,rounds),
      onSubmit:async()=>{
        const p_match={
          match_no:C().intOrNull(C().value('ar_no')),source_order:editing.source_order||null,match_date:C().value('ar_date'),
          opponent_team:C().value('ar_opp').trim(),match_format:C().empty(C().value('ar_format')),method:C().empty(C().value('ar_method')),
          final_result:C().empty(C().value('ar_result')),set_result:C().empty(C().value('ar_set'))
        };
        if(!p_match.match_date||!p_match.opponent_team)throw new Error('날짜와 상대 대학은 필수입니다.');
        const p_rounds=collectRounds();
        const check=validateScore(p_match,p_rounds);
        if(check?.mismatches.length&&!confirm(`세트 결과와 매치 결과가 다릅니다.\n${check.mismatches.join('\n')}\n그래도 저장할까요?`))throw new Error('결과 불일치로 저장을 취소했습니다.');
        const {data,error}=await C().state.client.rpc('admin_save_match',{p_match,p_rounds});if(error)throw error;
        C().toast(`경기 ${data}번을 저장했습니다.`);await load(S.page);
      },
      onDelete:sourceNo&&!clone?async()=>{const {error}=await C().state.client.from('matches').delete().eq('match_no',sourceNo);if(error)throw error;await C().audit('delete','matches',sourceNo,{opponent_team:match.opponent_team});await load(S.page);}:null
    });
    document.getElementById('ar_add_round').onclick=()=>{
      const tb=document.getElementById('ar_rounds');tb.insertAdjacentHTML('beforeend',roundRow({},tb.children.length));C().markDirty(true);
    };
    document.getElementById('ar_rounds').addEventListener('click',ev=>{const b=ev.target.closest('.admin-round-delete');if(!b)return;b.closest('tr').remove();C().markDirty(true);});
  }
  async function load(page=0){
    S.page=Math.max(0,page);let allowed=null;
    const player=C().value('recordsPlayer').trim();
    if(player){
      const {data,error}=await C().state.client.from('rounds').select('match_no').or(`our_player.ilike.%${player.replace(/[%_,]/g,'')}%,opponent_player.ilike.%${player.replace(/[%_,]/g,'')}%`).limit(5000);
      if(error)throw error;allowed=[...new Set((data||[]).map(x=>x.match_no))];if(!allowed.length){S.rows=[];S.count=0;render();return;}
    }
    const from=S.page*S.size,to=from+S.size-1;
    let q=C().state.client.from('matches').select('*',{count:'exact'}).order('match_date',{ascending:false}).order('match_no',{ascending:false}).range(from,to);
    const date=C().value('recordsDate'),opp=C().value('recordsOpponent').trim(),fmt=C().value('recordsFormat').trim();
    if(date)q=q.eq('match_date',date);if(opp)q=q.ilike('opponent_team',`%${opp}%`);if(fmt)q=q.ilike('match_format',`%${fmt}%`);if(allowed)q=q.in('match_no',allowed);
    const {data,count,error}=await q;
    if(error)throw error;
    S.rows=data||[];
    S.count=count||0;
    S.roundCounts={};
    const matchNos=S.rows.map(r=>r.match_no).filter(v=>v!==null&&v!==undefined);
    if(matchNos.length){
      const {data:roundRows,error:roundError}=await C().state.client.from('rounds').select('match_no').in('match_no',matchNos);
      if(roundError)throw roundError;
      (roundRows||[]).forEach(r=>{const k=String(r.match_no);S.roundCounts[k]=(S.roundCounts[k]||0)+1;});
    }
    render();
  }
  async function toggleRounds(no,tr){
    if(S.expanded.has(no)){S.expanded.delete(no);tr.nextElementSibling?.remove();return;}
    const rows=await getRounds(no);S.expanded.set(no,rows);
    const detail=document.createElement('tr');detail.className='admin-expand-row';detail.innerHTML=`<td colspan="9"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>순서</th><th>세트명</th><th>라운드명</th><th>캄몬 선수</th><th>종족</th><th>티어</th><th>상대 선수</th><th>상대 종족</th><th>상대 티어</th><th>맵</th><th>결과</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.source_order}</td><td>${esc(r.set_name)}</td><td>${esc(r.round_name)}</td><td>${esc(r.our_player)}</td><td>${esc(r.our_race)}</td><td>${esc(r.our_tier)}</td><td>${esc(r.opponent_player)}</td><td>${esc(r.opponent_race)}</td><td>${esc(r.opponent_tier)}</td><td>${esc(r.map_name)}</td><td>${wl(r.result)}</td></tr>`).join('')}</tbody></table></div></td>`;tr.after(detail);
  }
  // 승/패는 공개 전적 페이지와 같은 파랑·빨강으로 구분한다
  function wl(v){const t=String(v??'');const c=t.includes('승')?'wl-w':t.includes('패')?'wl-l':'';return c?`<span class="admin-wl ${c}">${esc(t)}</span>`:esc(t);}
  function render(){
    const root=document.getElementById('adminDedicatedRoot');root.hidden=false;document.body.classList.add('admin-dedicated-active');
    const pages=Math.max(1,Math.ceil(S.count/S.size));
    root.innerHTML=`<div class="page-header"><div class="page-header-main" data-label="RECORDS · ADMIN"><h1 class="page-header-title">전적 관리</h1><div class="admin-hero-actions"><button class="admin-btn primary" id="recordsAdd">+ 새 매치</button></div><p class="page-header-subtitle">캄몬스타즈 매치와 세트 기록을 추가하고 수정합니다. 행을 누르면 세트가 펼쳐집니다.</p></div></div><div class="admin-dedicated-shell">
      <div class="admin-toolbar admin-filter-grid">
        <input class="admin-input" id="recordsDate" type="date" value="${esc(C().value('recordsDate'))}">
        <input class="admin-input" id="recordsOpponent" placeholder="상대 대학" value="${esc(C().value('recordsOpponent'))}">
        <input class="admin-input" id="recordsFormat" placeholder="경기 형식" value="${esc(C().value('recordsFormat'))}">
        <input class="admin-input" id="recordsPlayer" placeholder="선수 검색" value="${esc(C().value('recordsPlayer'))}">
        <button class="admin-btn primary" id="recordsSearch">조회</button>
      </div>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>경기번호</th><th>날짜</th><th>상대 대학</th><th>형식</th><th>진행 방식</th><th>결과</th><th>세트 스코어</th><th>세트 수</th><th>관리</th></tr></thead><tbody>${S.rows.map(r=>`<tr data-match="${r.match_no}"><td>${r.match_no}</td><td>${esc(r.match_date)}</td><td><b>${esc(r.opponent_team)}</b></td><td>${esc(r.match_format)}</td><td>${esc(r.method)}</td><td>${wl(r.final_result)}</td><td>${esc(r.set_result)}</td><td>${S.roundCounts[String(r.match_no)]||0}</td><td><button class="admin-btn" data-edit="${r.match_no}">수정</button><button class="admin-btn" data-clone="${r.match_no}">복제</button></td></tr>`).join('')||'<tr><td colspan="9">검색 결과가 없습니다.</td></tr>'}</tbody></table></div>
      <div class="admin-pager"><button class="admin-btn" id="recordsPrev"${S.page<=0?' disabled':''}>이전</button><span>${S.page+1} / ${pages} · ${S.count}경기</span><button class="admin-btn" id="recordsNext"${S.page>=pages-1?' disabled':''}>다음</button></div></div>`;
    root.querySelector('#recordsAdd').onclick=()=>openEditor(null);
    root.querySelector('#recordsSearch').onclick=()=>load(0);
    root.querySelector('#recordsPrev').onclick=()=>load(S.page-1);root.querySelector('#recordsNext').onclick=()=>load(S.page+1);
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();openEditor(S.rows.find(r=>String(r.match_no)===b.dataset.edit));});
    root.querySelectorAll('[data-clone]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();openEditor(S.rows.find(r=>String(r.match_no)===b.dataset.clone),true);});
    root.querySelectorAll('tr[data-match]').forEach(tr=>tr.onclick=()=>toggleRounds(Number(tr.dataset.match),tr).catch(e=>C().toast(C().errorText(e),'error')));
  }
  async function init(){
    if(document.body.dataset.adminPage!=='records')return;
    S.members=await C().loadMembers();render();await load(0);
  }
  document.addEventListener('admin:ready',init);
}());
