(() => {
'use strict';

const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
const views = ['configError','loginView','deniedView','adminView'];
const $ = id => document.getElementById(id);
const state = {
  client: null,
  user: null,
  role: null,
  members: [], teams: [], matches: [],
  tierPage: 0, tierCount: 0, tierPageSize: 100,
  currentMember: null, currentTeam: null, currentMatch: null, currentTier: null, currentSetting: null,
};

function showOnly(id) { views.forEach(v => $(v)?.classList.toggle('admin-hidden', v !== id)); }
function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function emptyToNull(v) { const s = String(v ?? '').trim(); return s === '' ? null : s; }
function intOrNull(v) { const s = String(v ?? '').trim(); if (!s) return null; const n = Number.parseInt(s, 10); return Number.isFinite(n) ? n : null; }
function inputValue(id) { return $(id)?.value ?? ''; }
function setStatus(msg, type='info', target='globalStatus') {
  const el = $(target); if (!el) return;
  el.textContent = msg; el.className = `admin-status show ${type}`;
  if (type === 'ok') setTimeout(() => { if (el.textContent === msg) el.className = 'admin-status'; }, 3500);
}
function clearStatus(target='globalStatus') { const el=$(target); if(el){el.textContent=''; el.className='admin-status';} }
function errText(e) { return e?.message || e?.details || String(e); }
function button(label, fn, cls='') { return `<button class="admin-btn ${cls}" type="button" onclick="${fn}">${esc(label)}</button>`; }

async function nextSourceOrder(table) {
  const { data, error } = await state.client.from(table).select('source_order').order('source_order', {ascending:false}).limit(1);
  if (error) throw error;
  return (data?.[0]?.source_order || 0) + 1;
}

async function verifyAdmin() {
  const { data: { user }, error } = await state.client.auth.getUser();
  if (error || !user) { state.user=null; state.role=null; showOnly('loginView'); return false; }
  state.user = user;
  const { data, error: roleErr } = await state.client.from('admin_users').select('role,is_active').eq('user_id', user.id).maybeSingle();
  if (roleErr || !data?.is_active) { showOnly('deniedView'); return false; }
  state.role = data.role;
  $('adminIdentity').textContent = user.email || user.id;
  $('adminRole').textContent = data.role;
  showOnly('adminView');
  await loadDashboard();
  await loadMembers();
  return true;
}

async function login(ev) {
  ev.preventDefault(); clearStatus('loginStatus');
  const email = inputValue('loginEmail').trim(); const password = inputValue('loginPassword');
  setStatus('로그인 중...', 'info', 'loginStatus');
  const { error } = await state.client.auth.signInWithPassword({email, password});
  if (error) return setStatus(`로그인 실패: ${errText(error)}`, 'error', 'loginStatus');
  clearStatus('loginStatus'); await verifyAdmin();
}
async function logout() { await state.client.auth.signOut(); state.user=null; showOnly('loginView'); }

function switchPanel(name) {
  document.querySelectorAll('.admin-panel').forEach(el => el.classList.toggle('active', el.id === `panel-${name}`));
  document.querySelectorAll('#adminNav button').forEach(el => el.classList.toggle('active', el.dataset.panel === name));
  if (name==='members') loadMembers();
  if (name==='teams') loadTeams();
  if (name==='matches') loadMatches();
  if (name==='tier') loadTierMembers(state.tierPage);
  if (name==='settings') loadSettings();
}

async function loadDashboard() {
  try {
    const tables = [['members','멤버'],['teams','팀'],['matches','팀 경기'],['tier_members','티어 선수'],['elo_matches','ELO 경기'],['elo_players','ELO 선수']];
    const cards = await Promise.all(tables.map(async ([table,label]) => {
      const { count, error } = await state.client.from(table).select('*',{count:'exact',head:true});
      if (error) throw error; return {label,count:count ?? 0};
    }));
    $('dashboardKpis').innerHTML = cards.map(x=>`<div class="admin-card admin-kpi"><b>${Number(x.count).toLocaleString()}</b><span>${esc(x.label)}</span></div>`).join('');
  } catch(e) { setStatus(`대시보드 조회 실패: ${errText(e)}`, 'error'); }
}

// ---- members ----
async function loadMembers() {
  const { data, error } = await state.client.from('members').select('*').order('source_order');
  if (error) return setStatus(`멤버 조회 실패: ${errText(error)}`, 'error');
  state.members = data || []; renderMembers();
}
function renderMembers() {
  const q = inputValue('memberSearch').trim().toLowerCase();
  const rows = state.members.filter(r => !q || [r.name,r.nickname,r.soop_id,r.elo_id].some(v => String(v ?? '').toLowerCase().includes(q)));
  $('memberRows').innerHTML = rows.map(r=>`<tr><td>${r.id}</td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b></td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.race)}</td><td>${esc(r.tier)}</td><td>${esc(r.role)}</td><td>${esc(r.joined_date)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editMember(${r.id})`)}${button('삭제',`AdminApp.deleteMember(${r.id})`,'danger')}</div></td></tr>`).join('') || '<tr><td colspan="10">검색 결과가 없습니다.</td></tr>';
}
function memberForm(r={}) {
  return `<form onsubmit="return AdminApp.saveMember(event)"><div class="admin-section-title"><div><h2>${r.id?'멤버 수정':'새 멤버'}</h2><p>ID는 StarUniv 내부 행 식별자이며 ELO ID와 다릅니다.</p></div></div><div class="admin-form-grid">
  <div class="admin-field"><label>내부 ID</label><input class="admin-input" value="${esc(r.id ?? '자동')}" disabled></div>
  <div class="admin-field"><label>기준 이름 (name) *</label><input id="m_name" class="admin-input" value="${esc(r.name)}" required></div>
  <div class="admin-field"><label>표시 닉네임 (nickname) *</label><input id="m_nickname" class="admin-input" value="${esc(r.nickname)}" required></div>
  <div class="admin-field"><label>SOOP ID</label><input id="m_soop_id" class="admin-input" value="${esc(r.soop_id)}"></div>
  <div class="admin-field"><label>ELO ID</label><input id="m_elo_id" class="admin-input" type="number" value="${esc(r.elo_id)}"></div>
  <div class="admin-field"><label>생년월일</label><input id="m_birth_date" class="admin-input" type="date" value="${esc(r.birth_date)}"></div>
  <div class="admin-field"><label>성별</label><input id="m_gender" class="admin-input" value="${esc(r.gender)}"></div>
  <div class="admin-field"><label>종족</label><input id="m_race" class="admin-input" value="${esc(r.race)}" placeholder="T / P / Z"></div>
  <div class="admin-field"><label>입단 티어</label><input id="m_join_tier" class="admin-input" value="${esc(r.join_tier)}"></div>
  <div class="admin-field"><label>현재 티어</label><input id="m_tier" class="admin-input" value="${esc(r.tier)}"></div>
  <div class="admin-field"><label>직책</label><input id="m_role" class="admin-input" value="${esc(r.role)}"></div>
  <div class="admin-field"><label>입단일</label><input id="m_joined_date" class="admin-input" type="date" value="${esc(r.joined_date)}"></div>
  <div class="admin-field"><label>퇴단일</label><input id="m_left_date" class="admin-input" type="date" value="${esc(r.left_date)}"></div>
  <div class="admin-field"><label>MBTI</label><input id="m_mbti" class="admin-input" value="${esc(r.mbti)}"></div>
  </div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('memberEditor')">취소</button><button class="admin-btn primary" type="submit">저장</button></div></form>`;
}
function editMember(id) { const r=id?state.members.find(x=>x.id===id):{}; state.currentMember=r||{}; $('memberEditor').innerHTML=memberForm(state.currentMember); $('memberEditor').classList.remove('hidden'); }
async function saveMember(ev) {
  ev.preventDefault();
  try {
    const row={name:inputValue('m_name').trim(),nickname:inputValue('m_nickname').trim(),soop_id:emptyToNull(inputValue('m_soop_id')),elo_id:intOrNull(inputValue('m_elo_id')),birth_date:emptyToNull(inputValue('m_birth_date')),gender:emptyToNull(inputValue('m_gender')),race:emptyToNull(inputValue('m_race')),join_tier:emptyToNull(inputValue('m_join_tier')),tier:emptyToNull(inputValue('m_tier')),role:emptyToNull(inputValue('m_role')),joined_date:emptyToNull(inputValue('m_joined_date')),left_date:emptyToNull(inputValue('m_left_date')),mbti:emptyToNull(inputValue('m_mbti'))};
    if (!row.name || !row.nickname) throw new Error('name과 nickname은 필수입니다.');
    let error;
    if (state.currentMember?.id) ({error}=await state.client.from('members').update(row).eq('id',state.currentMember.id));
    else { row.source_order=await nextSourceOrder('members'); ({error}=await state.client.from('members').insert(row)); }
    if(error) throw error; $('memberEditor').classList.add('hidden'); setStatus('멤버를 저장했습니다.','ok'); await loadMembers(); await loadDashboard();
  } catch(e){setStatus(`멤버 저장 실패: ${errText(e)}`,'error');} return false;
}
async function deleteMember(id){if(!confirm('이 멤버 행을 삭제할까요?'))return; const {error}=await state.client.from('members').delete().eq('id',id); if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error'); setStatus('멤버를 삭제했습니다.','ok'); await loadMembers();}

// ---- teams ----
async function loadTeams(){const {data,error}=await state.client.from('teams').select('*').order('source_order');if(error)return setStatus(`팀 조회 실패: ${errText(error)}`,'error');state.teams=data||[];renderTeams();}
function renderTeams(){const q=inputValue('teamSearch').trim().toLowerCase();const rows=state.teams.filter(r=>!q||String(r.team_name||'').toLowerCase().includes(q));$('teamRows').innerHTML=rows.map(r=>`<tr><td>${r.id}</td><td><b>${esc(r.team_name)}</b></td><td>${esc(r.founders)}</td><td>${esc(r.founded_date)}</td><td>${esc(r.disbanded_date)}</td><td>${esc(r.championship)}</td><td>${esc(r.note)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editTeam(${r.id})`)}${button('삭제',`AdminApp.deleteTeam(${r.id})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="8">검색 결과가 없습니다.</td></tr>';}
function editTeam(id){const r=id?state.teams.find(x=>x.id===id):{};state.currentTeam=r||{};$('teamEditor').innerHTML=`<form onsubmit="return AdminApp.saveTeam(event)"><div class="admin-form-grid"><div class="admin-field"><label>팀 이름 *</label><input id="t_name" class="admin-input" value="${esc(r.team_name)}" required></div><div class="admin-field"><label>설립자</label><input id="t_founders" class="admin-input" value="${esc(r.founders)}"></div><div class="admin-field"><label>창단일</label><input id="t_founded" type="date" class="admin-input" value="${esc(r.founded_date)}"></div><div class="admin-field"><label>해체일</label><input id="t_disbanded" type="date" class="admin-input" value="${esc(r.disbanded_date)}"></div><div class="admin-field"><label>우승</label><input id="t_championship" class="admin-input" value="${esc(r.championship)}"></div><div class="admin-field span-3"><label>비고</label><textarea id="t_note" class="admin-textarea">${esc(r.note)}</textarea></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('teamEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('teamEditor').classList.remove('hidden');}
async function saveTeam(ev){ev.preventDefault();try{const row={team_name:inputValue('t_name').trim(),founders:emptyToNull(inputValue('t_founders')),founded_date:emptyToNull(inputValue('t_founded')),disbanded_date:emptyToNull(inputValue('t_disbanded')),championship:emptyToNull(inputValue('t_championship')),note:emptyToNull(inputValue('t_note'))};let error;if(state.currentTeam?.id)({error}=await state.client.from('teams').update(row).eq('id',state.currentTeam.id));else{row.source_order=await nextSourceOrder('teams');({error}=await state.client.from('teams').insert(row));}if(error)throw error;$('teamEditor').classList.add('hidden');setStatus('팀 정보를 저장했습니다.','ok');await loadTeams();}catch(e){setStatus(`팀 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteTeam(id){if(!confirm('이 팀을 삭제할까요? matches의 상대팀 문자열은 자동 변경되지 않습니다.'))return;const {error}=await state.client.from('teams').delete().eq('id',id);if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error');await loadTeams();}

// ---- matches / rounds ----
async function loadMatches(){const {data,error}=await state.client.from('matches').select('*').order('match_date',{ascending:false}).order('match_no',{ascending:false}).limit(500);if(error)return setStatus(`전적 조회 실패: ${errText(error)}`,'error');state.matches=data||[];renderMatches();}
function renderMatches(){const q=inputValue('matchSearch').trim().toLowerCase();const rows=state.matches.filter(r=>!q||[r.opponent_team,r.match_date,r.final_result,r.match_no].some(v=>String(v??'').toLowerCase().includes(q)));$('matchRows').innerHTML=rows.map(r=>`<tr><td>${r.match_no}</td><td>${esc(r.match_date)}</td><td><b>${esc(r.opponent_team)}</b></td><td>${esc(r.match_format)}</td><td>${esc(r.method)}</td><td>${esc(r.final_result)}</td><td>${esc(r.set_result)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editMatch(${r.match_no})`)}${button('삭제',`AdminApp.deleteMatch(${r.match_no})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="8">검색 결과가 없습니다.</td></tr>';}
async function editMatch(matchNo){let r={};let rounds=[];if(matchNo){r=state.matches.find(x=>x.match_no===matchNo)||{};const res=await state.client.from('rounds').select('*').eq('match_no',matchNo).order('source_order');if(res.error)return setStatus(`세트 조회 실패: ${errText(res.error)}`,'error');rounds=res.data||[];}state.currentMatch=r;$('matchEditor').innerHTML=matchForm(r,rounds);$('matchEditor').classList.remove('hidden');}
function matchForm(r={},rounds=[]){return `<form onsubmit="return AdminApp.saveMatch(event)"><input id="ma_source_order" type="hidden" value="${esc(r.source_order)}"><div class="admin-form-grid"><div class="admin-field"><label>매치 번호 ${r.match_no?'(수정 불가)':'(비우면 자동)'}</label><input id="ma_no" class="admin-input" type="number" value="${esc(r.match_no)}" ${r.match_no?'readonly':''}></div><div class="admin-field"><label>날짜 *</label><input id="ma_date" class="admin-input" type="date" value="${esc(r.match_date)}" required></div><div class="admin-field"><label>상대팀 *</label><input id="ma_opponent" class="admin-input" value="${esc(r.opponent_team)}" required></div><div class="admin-field"><label>형식</label><input id="ma_format" class="admin-input" value="${esc(r.match_format)}"></div><div class="admin-field"><label>방식</label><input id="ma_method" class="admin-input" value="${esc(r.method)}"></div><div class="admin-field"><label>최종 결과</label><input id="ma_result" class="admin-input" value="${esc(r.final_result)}" placeholder="4:2"></div><div class="admin-field"><label>세트 결과</label><input id="ma_set_result" class="admin-input" value="${esc(r.set_result)}"></div><div class="admin-field"><label>득실</label><input id="ma_score_diff" class="admin-input" value="${esc(r.score_diff)}"></div><div class="admin-field"><label>펀딩</label><input id="ma_funding" class="admin-input" value="${esc(r.funding)}"></div><div class="admin-field"><label>지원금</label><input id="ma_support" class="admin-input" value="${esc(r.support_amount)}"></div><div class="admin-field"><label>사비</label><input id="ma_personal" class="admin-input" value="${esc(r.personal_amount)}"></div><div class="admin-field"><label>도전미션</label><input id="ma_challenge" class="admin-input" value="${esc(r.challenge_mission)}"></div></div><div class="admin-rounds"><div class="admin-toolbar"><b>세트/라운드</b><button type="button" class="admin-btn" onclick="AdminApp.addRound()">+ 라운드</button></div><div id="roundRows">${rounds.map(roundForm).join('')}</div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('matchEditor')">취소</button><button class="admin-btn primary">경기 저장</button></div></form>`;}
function roundForm(r={}){return `<div class="admin-round"><div class="admin-field"><label>세트</label><input data-key="set_name" class="admin-input" value="${esc(r.set_name)}"></div><div class="admin-field"><label>라운드</label><input data-key="round_name" class="admin-input" value="${esc(r.round_name)}"></div><div class="admin-field"><label>우리 선수</label><input data-key="our_player" class="admin-input" value="${esc(r.our_player)}"></div><div class="admin-field"><label>종족</label><input data-key="our_race" class="admin-input" value="${esc(r.our_race)}"></div><div class="admin-field"><label>티어</label><input data-key="our_tier" class="admin-input" value="${esc(r.our_tier)}"></div><div class="admin-field"><label>결과</label><input data-key="result" class="admin-input" value="${esc(r.result)}" placeholder="승/패"></div><div class="admin-field"><label>상대 선수</label><input data-key="opponent_player" class="admin-input" value="${esc(r.opponent_player)}"></div><div class="admin-field"><label>종족</label><input data-key="opponent_race" class="admin-input" value="${esc(r.opponent_race)}"></div><div class="admin-field"><label>티어</label><input data-key="opponent_tier" class="admin-input" value="${esc(r.opponent_tier)}"></div><div class="admin-field"><label>맵</label><input data-key="map_name" class="admin-input" value="${esc(r.map_name)}"></div><button type="button" class="admin-btn danger round-remove" onclick="this.closest('.admin-round').remove()">×</button></div>`;}
function addRound(){ $('roundRows').insertAdjacentHTML('beforeend',roundForm({})); }
async function saveMatch(ev){ev.preventDefault();try{const p_match={match_no:intOrNull(inputValue('ma_no')),source_order:intOrNull(inputValue('ma_source_order')),match_date:inputValue('ma_date'),opponent_team:inputValue('ma_opponent').trim(),match_format:emptyToNull(inputValue('ma_format')),method:emptyToNull(inputValue('ma_method')),final_result:emptyToNull(inputValue('ma_result')),set_result:emptyToNull(inputValue('ma_set_result')),score_diff:emptyToNull(inputValue('ma_score_diff')),funding:emptyToNull(inputValue('ma_funding')),support_amount:emptyToNull(inputValue('ma_support')),personal_amount:emptyToNull(inputValue('ma_personal')),challenge_mission:emptyToNull(inputValue('ma_challenge'))};if(!p_match.match_date||!p_match.opponent_team)throw new Error('날짜와 상대팀은 필수입니다.');const p_rounds=[...document.querySelectorAll('#roundRows .admin-round')].map(el=>{const obj={};el.querySelectorAll('[data-key]').forEach(i=>obj[i.dataset.key]=emptyToNull(i.value));return obj;});const {data,error}=await state.client.rpc('admin_save_match',{p_match,p_rounds});if(error)throw error;$('matchEditor').classList.add('hidden');setStatus(`경기 ${data}번을 저장했습니다.`,'ok');await loadMatches();}catch(e){setStatus(`경기 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteMatch(matchNo){if(!confirm(`${matchNo}번 경기와 연결된 모든 라운드를 삭제할까요?`))return;const {error}=await state.client.from('matches').delete().eq('match_no',matchNo);if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error');setStatus('경기를 삭제했습니다.','ok');await loadMatches();}

// ---- tier members ----
function safeSearch(q){return q.replace(/[,()%"']/g,' ').trim();}
async function loadTierMembers(page=0){state.tierPage=Math.max(0,page);const from=state.tierPage*state.tierPageSize,to=from+state.tierPageSize-1;let query=state.client.from('tier_members').select('*',{count:'exact'}).order('source_order').range(from,to);const q=safeSearch(inputValue('tierSearch'));if(q)query=query.or(`name.ilike.%${q}%,nickname.ilike.%${q}%,soop_id.ilike.%${q}%`);const {data,count,error}=await query;if(error)return setStatus(`티어 명단 조회 실패: ${errText(error)}`,'error');state.tierCount=count||0;$('tierRows').innerHTML=(data||[]).map(r=>`<tr><td>${r.id}</td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b></td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.race)}</td><td>${esc(r.tier)}</td><td>${esc(r.affiliation)}</td><td>${esc(r.role)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editTierMember(${r.id})`)}${button('삭제',`AdminApp.deleteTierMember(${r.id})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="10">검색 결과가 없습니다.</td></tr>';state.currentTierPageRows=data||[];const pages=Math.max(1,Math.ceil(state.tierCount/state.tierPageSize));$('tierPageInfo').textContent=`${state.tierPage+1} / ${pages} · ${state.tierCount.toLocaleString()}명`;$('tierPrev').disabled=state.tierPage<=0;$('tierNext').disabled=state.tierPage>=pages-1;}
function tierPromotionFields(r){return [8,7,6,5,4,3,2,1,0].map(n=>`<div class="admin-field"><label>${n}티어 승급</label><input id="tm_p${n}" class="admin-input" value="${esc(r[`promoted_tier_${n}`])}"></div>`).join('');}
function editTierMember(id){const r=id?(state.currentTierPageRows||[]).find(x=>x.id===id):{};state.currentTier=r||{};$('tierEditor').innerHTML=`<form onsubmit="return AdminApp.saveTierMember(event)"><div class="admin-form-grid"><div class="admin-field"><label>이름</label><input id="tm_name" class="admin-input" value="${esc(r.name)}"></div><div class="admin-field"><label>닉네임 *</label><input id="tm_nickname" class="admin-input" value="${esc(r.nickname)}" required></div><div class="admin-field"><label>SOOP ID</label><input id="tm_soop" class="admin-input" value="${esc(r.soop_id)}"></div><div class="admin-field"><label>ELO ID</label><input id="tm_elo" type="number" class="admin-input" value="${esc(r.elo_id)}"></div><div class="admin-field"><label>생년월일</label><input id="tm_birth" type="date" class="admin-input" value="${esc(r.birth_date)}"></div><div class="admin-field"><label>성별</label><input id="tm_gender" class="admin-input" value="${esc(r.gender)}"></div><div class="admin-field"><label>종족</label><input id="tm_race" class="admin-input" value="${esc(r.race)}"></div><div class="admin-field"><label>티어</label><input id="tm_tier" class="admin-input" value="${esc(r.tier)}"></div><div class="admin-field"><label>소속</label><input id="tm_aff" class="admin-input" value="${esc(r.affiliation)}"></div><div class="admin-field"><label>직책</label><input id="tm_role" class="admin-input" value="${esc(r.role)}"></div><div class="admin-field"><label>수정일</label><input id="tm_modified" class="admin-input" value="${esc(r.modified_at)}"></div><div class="admin-field"><label>시작</label><input id="tm_started" class="admin-input" value="${esc(r.started_on)}"></div><div class="admin-field"><label>ELO 등록</label><input id="tm_elo_registered" class="admin-input" value="${esc(r.elo_registered)}"></div><div class="admin-field"><label>티어표 등록</label><input id="tm_table_registered" class="admin-input" value="${esc(r.tier_table_registered)}"></div>${tierPromotionFields(r)}<div class="admin-field span-3"><label>연혁</label><textarea id="tm_history" class="admin-textarea">${esc(r.history)}</textarea></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('tierEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('tierEditor').classList.remove('hidden');}
async function saveTierMember(ev){ev.preventDefault();try{const row={name:emptyToNull(inputValue('tm_name')),nickname:inputValue('tm_nickname').trim(),soop_id:emptyToNull(inputValue('tm_soop')),elo_id:intOrNull(inputValue('tm_elo')),birth_date:emptyToNull(inputValue('tm_birth')),gender:emptyToNull(inputValue('tm_gender')),race:emptyToNull(inputValue('tm_race')),tier:emptyToNull(inputValue('tm_tier')),affiliation:emptyToNull(inputValue('tm_aff')),role:emptyToNull(inputValue('tm_role')),modified_at:emptyToNull(inputValue('tm_modified')),history:emptyToNull(inputValue('tm_history')),started_on:emptyToNull(inputValue('tm_started')),elo_registered:emptyToNull(inputValue('tm_elo_registered')),tier_table_registered:emptyToNull(inputValue('tm_table_registered'))};for(const n of [8,7,6,5,4,3,2,1,0])row[`promoted_tier_${n}`]=emptyToNull(inputValue(`tm_p${n}`));if(!row.nickname)throw new Error('닉네임은 필수입니다.');let error;if(state.currentTier?.id)({error}=await state.client.from('tier_members').update(row).eq('id',state.currentTier.id));else{row.source_order=await nextSourceOrder('tier_members');({error}=await state.client.from('tier_members').insert(row));}if(error)throw error;$('tierEditor').classList.add('hidden');setStatus('티어 선수를 저장했습니다.','ok');await loadTierMembers(state.tierPage);}catch(e){setStatus(`티어 선수 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteTierMember(id){if(!confirm('이 티어 선수 행을 삭제할까요?'))return;const {error}=await state.client.from('tier_members').delete().eq('id',id);if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error');await loadTierMembers(state.tierPage);}

// ---- settings ----
async function loadSettings(){const {data,error}=await state.client.from('settings').select('*').order('source_order');if(error)return setStatus(`설정 조회 실패: ${errText(error)}`,'error');state.settings=data||[];$('settingRows').innerHTML=state.settings.map(r=>`<tr><td>${r.source_order}</td><td><b>${esc(r.season)}</b></td><td>${esc(r.start_date)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editSetting(${r.source_order})`)}${button('삭제',`AdminApp.deleteSetting(${r.source_order})`,'danger')}</div></td></tr>`).join('');}
function editSetting(order){const r=order?(state.settings||[]).find(x=>x.source_order===order):{};state.currentSetting=r||{};$('settingEditor').innerHTML=`<form onsubmit="return AdminApp.saveSetting(event)"><div class="admin-form-grid"><div class="admin-field"><label>순서</label><input id="s_order" type="number" class="admin-input" value="${esc(r.source_order)}" ${r.source_order?'readonly':''} placeholder="비우면 자동"></div><div class="admin-field"><label>시즌 *</label><input id="s_season" class="admin-input" value="${esc(r.season)}" required></div><div class="admin-field"><label>시작일</label><input id="s_date" type="date" class="admin-input" value="${esc(r.start_date)}"></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('settingEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('settingEditor').classList.remove('hidden');}
async function saveSetting(ev){ev.preventDefault();try{const order=intOrNull(inputValue('s_order'))||await nextSourceOrder('settings');const row={source_order:order,season:inputValue('s_season').trim(),start_date:emptyToNull(inputValue('s_date'))};const {error}=await state.client.from('settings').upsert(row,{onConflict:'source_order'});if(error)throw error;$('settingEditor').classList.add('hidden');setStatus('시즌 설정을 저장했습니다.','ok');await loadSettings();}catch(e){setStatus(`설정 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteSetting(order){if(!confirm('이 시즌 설정을 삭제할까요?'))return;const {error}=await state.client.from('settings').delete().eq('source_order',order);if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error');await loadSettings();}

// ---- ELO read-only ----
async function searchElo(){const q=inputValue('eloSearch').trim();let query=state.client.from('elo_players').select('*').order('elo_id').limit(100);if(q){if(/^\d+$/.test(q))query=query.eq('elo_id',Number(q));else query=query.ilike('name',`%${q.replace(/[%(),]/g,' ')}%`);}const {data,error}=await query;if(error)return setStatus(`ELO 조회 실패: ${errText(error)}`,'error');$('eloRows').innerHTML=(data||[]).map(r=>`<tr><td>${r.elo_id}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.race)}</td></tr>`).join('')||'<tr><td colspan="3">검색 결과가 없습니다.</td></tr>';}

function closeEditor(id){$(id)?.classList.add('hidden');}

async function init(){
  if(!cfg.url||!cfg.key||!window.supabase?.createClient){showOnly('configError');return;}
  state.client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  $('loginForm').addEventListener('submit',login);$('logoutBtn').addEventListener('click',logout);$('deniedLogout').addEventListener('click',logout);
  $('adminNav').addEventListener('click',e=>{const b=e.target.closest('button[data-panel]');if(b)switchPanel(b.dataset.panel);});
  $('memberSearch').addEventListener('input',renderMembers);$('teamSearch').addEventListener('input',renderTeams);$('matchSearch').addEventListener('input',renderMatches);
  $('tierPrev').addEventListener('click',()=>loadTierMembers(state.tierPage-1));$('tierNext').addEventListener('click',()=>loadTierMembers(state.tierPage+1));$('tierSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadTierMembers(0);});$('eloSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchElo();});
  state.client.auth.onAuthStateChange((_event,session)=>{if(!session && !$('loginView').classList.contains('admin-hidden'))return;if(!session)showOnly('loginView');});
  await verifyAdmin();
}

window.AdminApp={loadDashboard,loadMembers,editMember,saveMember,deleteMember,loadTeams,editTeam,saveTeam,deleteTeam,loadMatches,editMatch,saveMatch,deleteMatch,addRound,loadTierMembers,editTierMember,saveTierMember,deleteTierMember,loadSettings,editSetting,saveSetting,deleteSetting,searchElo,closeEditor};
init().catch(e=>{console.error(e);showOnly('configError');});
})();
