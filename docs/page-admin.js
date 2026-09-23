(() => {
'use strict';

const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
const views = ['configError','loginView','deniedView','adminView'];
const $ = id => document.getElementById(id);
const state = {
  client: null,
  user: null,
  role: null,
  members: [], teams: [], matches: [], calendarEvents: [], offAir: [], navConfig: {}, historyEntries: [], videoChannels: [], videoPicks: [], videos: [], externalTools: [],
  tierPage: 0, tierCount: 0, tierPageSize: 100,
  currentMember: null, currentTeam: null, currentMatch: null, currentTier: null, currentSetting: null, currentHistory: null, currentVideoChannel: null, currentVideoPick: null, currentExternalTool: null,
};

function showOnly(id) { views.forEach(v => $(v)?.classList.toggle('admin-hidden', v !== id)); }
function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = value;
  document.documentElement.dataset.bsTheme = value;
  try { localStorage.setItem('staruniv-theme', value); } catch (_) { }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === value)));
}
function toggleSiteMenu(force) {
  const header = document.querySelector('.admin-site-nav');
  const button = $('adminNavDrawerBtn');
  if (!header || !button) return;
  const open = typeof force === 'boolean' ? force : !header.classList.contains('menu-open');
  header.classList.toggle('menu-open', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
}
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
async function deleteRecord(table, column, value, confirmText, reload, successText='') {
  if (confirmText && !confirm(confirmText)) return;
  const {error}=await state.client.from(table).delete().eq(column,value);
  if(error)return setStatus(`삭제 실패: ${errText(error)}`,'error');
  if(successText)setStatus(successText,'ok');
  await reload();
}
function mediaExt(file){ const m=String(file?.name||'').toLowerCase().match(/\.(jpe?g|png|webp|gif)$/); return m ? (m[1]==='jpeg'?'jpg':m[1]) : ''; }
async function uploadMedia(file, folder, stem){
  if(!file) return null; const ext=mediaExt(file); if(!ext) throw new Error('이미지는 jpg/png/webp/gif만 업로드할 수 있습니다.');
  if(file.size>10*1024*1024) throw new Error('이미지는 10MB 이하만 업로드할 수 있습니다.');
  const safe=String(stem||Date.now()).replace(/[^a-zA-Z0-9_-]/g,'-'); const path=`${folder}/${safe}-${Date.now()}.${ext}`;
  const {error}=await state.client.storage.from('staruniv-media').upload(path,file,{upsert:true,contentType:file.type||`image/${ext}`}); if(error) throw error; return path;
}

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
  showPublicPage('home');
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

const ADMIN_SUBTABS = {
  home: [{id:'dashboard',label:'대시보드'}, {id:'navigation',label:'홈 · 메뉴 설정'}],
  schedule: [{id:'schedule',label:'일정 · 휴방'}, {id:'history',label:'연혁'}],
  members: [{id:'members',label:'멤버'}],
  records: [{id:'matches',label:'경기'}, {id:'teams',label:'팀'}, {id:'settings',label:'시즌'}],
  tier: [{id:'tier',label:'티어 명단'}, {id:'elo',label:'ELO 조회'}],
  video: [{id:'video',label:'영상'}],
  stats: [{id:'stats-settings',label:'표시 지표'}],
  tools: [{id:'external-tools',label:'외부도구'}],
};
const ADMIN_PAGE_META = {
  home:['ADMIN · HOME','홈 관리','홈과 사이트 공통 설정을 관리합니다.'],
  schedule:['ADMIN · SCHEDULE','일정 관리','본 페이지의 캘린더에서 일정·휴방·연혁을 바로 편집합니다.'],
  members:['ADMIN · MEMBERS','멤버 관리','본 페이지에 표시되는 멤버 정보를 관리합니다.'],
  records:['ADMIN · RECORDS','전적 관리','경기·팀·시즌 정보를 한 화면에서 관리합니다.'],
  tier:['ADMIN · TIER','티어표 관리','티어 명단을 편집하고 ELO 선수를 조회합니다.'],
  video:['ADMIN · VIDEO','영상 관리','팬튜브 채널과 추천·수집 영상을 관리합니다.'],
  stats:['ADMIN · STATS','방송통계 관리','본 페이지에 표시할 방송통계 지표를 관리합니다.'],
  tools:['ADMIN · TOOLS','도구 관리','본 페이지의 외부도구 링크를 관리합니다.'],
};

// The public document owns all page markup, styles, tabs and renderers.
// Admin adds only entry points; writes still use the verified Supabase session.
let publicPageName='home';
let publicObserver=null;
function showPublicPage(name) {
  publicPageName=name;
  $('adminPublicPage').src=name==='home'?'./':`${name}/`;
  document.querySelectorAll('#adminSiteMenu [data-panel]').forEach(el=>el.classList.toggle('active',el.dataset.panel===name));
}
function closeEditSurface() {
  $('adminEditDialog').close();
  $('adminPublicPage').contentWindow.location.reload();
}
async function openEditSurface(panel, edit) {
  if(!state.user || !state.role) return;
  const group=Object.keys(ADMIN_SUBTABS).find(key=>ADMIN_SUBTABS[key].some(tab=>tab.id===panel))||publicPageName;
  switchPanel(group, false);
  await switchSubPanel(panel);
  if(edit) await edit();
  if(!$('adminEditDialog').open) $('adminEditDialog').showModal();
}
function connectPublicPage() {
  publicObserver?.disconnect();
  const frame=$('adminPublicPage');
  const doc=frame.contentDocument;
  if(!doc || doc.location.href==='about:blank') return;
  const page=doc.location.pathname.split('/').filter(Boolean).pop();
  if(ADMIN_SUBTABS[page]) publicPageName=page;
  else publicPageName='home';
  document.querySelectorAll('#adminSiteMenu [data-panel]').forEach(el=>el.classList.toggle('active',el.dataset.panel===publicPageName));
  const header=doc.querySelector('.top-navbar');
  if(header) header.hidden=true;
  const addAction=(target,label,action)=>{
    if(!target||target.querySelector(':scope > [data-admin-action]')) return;
    const button=doc.createElement('button');
    button.type='button';button.className='text-action';button.dataset.adminAction='true';button.textContent=label;
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();action();});
    target.append(button);
  };
  const toolbar=doc.createElement('div');toolbar.className='container';
  const actions=doc.createElement('div');actions.className='admin-public-actions';
  for(const tab of ADMIN_SUBTABS[publicPageName]) {
    const button=doc.createElement('button');button.className='text-action';button.type='button';
    button.textContent=`${tab.label} 편집`;button.onclick=()=>openEditSurface(tab.id);actions.append(button);
  }
  toolbar.append(actions);
  const hero=doc.querySelector('.page-header')||doc.querySelector('.home-carousel');
  if(hero) hero.after(toolbar);else doc.body.prepend(toolbar);
  const style=doc.createElement('style');
  style.textContent='.top-navbar[hidden]{display:none}.admin-public-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:12px 0}.member-card>[data-admin-action]{position:absolute;right:8px;bottom:8px;background:var(--color-card);z-index:2}.member-card{position:relative}';
  doc.head.append(style);
  const decorate=()=>{
    doc.querySelectorAll('.member-card[data-member]').forEach(card=>addAction(card,'수정',()=>openEditSurface('members',()=>{
      const member=state.members.find(row=>row.nickname===card.dataset.member);
      if(member) editMember(member.id);
    })));
  };
  decorate();publicObserver=new MutationObserver(decorate);publicObserver.observe(doc.body,{childList:true,subtree:true});
  if(publicPageName==='schedule') {
    const win=frame.contentWindow;
    win.calOnDateSelect=date=>openEditSurface('schedule',()=>editSchedule(null,date));
    win.calCardExtra=item=>`<button type="button" class="text-action" data-admin-event="${esc(item.id)}">수정</button>`;
    doc.addEventListener('click',event=>{
      const button=event.target.closest('[data-admin-event]');
      if(button){event.preventDefault();event.stopPropagation();openEditSurface('schedule',()=>editSchedule(button.dataset.adminEvent));}
    });
    win.calRenderCalendar?.();
  }
}

const ADMIN_PANEL_LOADERS = {
  dashboard: loadDashboard,
  navigation: loadNavigation,
  schedule: loadSchedule,
  history: loadHistoryEntries,
  members: loadMembers,
  matches: loadMatches,
  teams: loadTeams,
  settings: loadSettings,
  tier: () => loadTierMembers(state.tierPage),
  elo: searchElo,
  video: loadVideoAdmin,
  'stats-settings': loadNavigation,
  'external-tools': loadExternalTools,
};

async function switchSubPanel(panelId) {
  document.querySelectorAll('.admin-panel').forEach(el => el.classList.toggle('active', el.id === `panel-${panelId}`));
  document.querySelectorAll('#adminSubTabs [data-admin-subpanel]').forEach(el => {
    const active = el.dataset.adminSubpanel === panelId;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
  });
  await ADMIN_PANEL_LOADERS[panelId]?.();
}

function switchPanel(name, load=true) {
  const tabs = ADMIN_SUBTABS[name] || ADMIN_SUBTABS.home;
  document.querySelectorAll('#adminSiteMenu [data-panel]').forEach(el => el.classList.toggle('active', el.dataset.panel === name));
  const meta=ADMIN_PAGE_META[name]||ADMIN_PAGE_META.home;
  $('adminPageEyebrow').textContent=meta[0];$('adminPageTitle').textContent=meta[1];$('adminPageDescription').textContent=meta[2];
  const tabBar=$('adminSubTabs');
  tabBar.innerHTML=tabs.map((tab,index)=>`<button type="button" class="sub-tab${index===0?' active':''}" role="tab" aria-selected="${index===0}" data-admin-subpanel="${esc(tab.id)}">${esc(tab.label)}</button>`).join('');
  tabBar.hidden=tabs.length<2;
  if(load) switchSubPanel(tabs[0].id);
}

async function loadDashboard() {
  const tables = [
    ['members','id','멤버'],['teams','id','팀'],['matches','match_no','팀 경기'],['tier_members','id','티어 선수'],
    ['calendar_events','id','일정'],['calendar_off_air','off_date','휴방'],['video_channels','channel_url','영상 채널'],
    ['videos','id','수집 영상'],['video_picks','id','추천 영상'],['external_tools','id','외부도구'],
    ['elo_matches','elo_match_id','ELO 경기','planned'],['elo_players','elo_id','ELO 선수'],
  ];
  const cards = await Promise.all(tables.map(async ([table,column,label,countMode='exact']) => {
    const {count,error}=await state.client.from(table).select(column,{count:countMode,head:true});
    return {table,label,count:count??0,error};
  }));
  $('dashboardKpis').innerHTML=cards.map(x=>x.error
    ? `<div class="admin-card admin-kpi is-error"><b>—</b><span>${esc(x.label)}</span><small>조회 실패</small></div>`
    : `<div class="admin-card admin-kpi"><b>${Number(x.count).toLocaleString()}</b><span>${esc(x.label)}</span></div>`).join('');
  const failed=cards.filter(x=>x.error);
  if(failed.length) setStatus(`일부 현황 조회 실패 · ${failed.map(x=>`${x.label}(${x.table}): ${errText(x.error)}`).join(' · ')}`,'error');
  else clearStatus();
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
  <div class="admin-field"><label>커스텀 프로필 (선택)</label><input id="m_avatar_file" class="admin-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><small>${esc(r.avatar_path||'없으면 SOOP 프로필 자동 사용')}</small></div>
  </div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('memberEditor')">취소</button><button class="admin-btn primary" type="submit">저장</button></div></form>`;
}
function editMember(id) { const r=id?state.members.find(x=>x.id===id):{}; state.currentMember=r||{}; $('memberEditor').innerHTML=memberForm(state.currentMember); $('memberEditor').classList.remove('hidden'); }
async function saveMember(ev) {
  ev.preventDefault();
  try {
    const row={name:inputValue('m_name').trim(),nickname:inputValue('m_nickname').trim(),soop_id:emptyToNull(inputValue('m_soop_id')),elo_id:intOrNull(inputValue('m_elo_id')),birth_date:emptyToNull(inputValue('m_birth_date')),gender:emptyToNull(inputValue('m_gender')),race:emptyToNull(inputValue('m_race')),join_tier:emptyToNull(inputValue('m_join_tier')),tier:emptyToNull(inputValue('m_tier')),role:emptyToNull(inputValue('m_role')),joined_date:emptyToNull(inputValue('m_joined_date')),left_date:emptyToNull(inputValue('m_left_date')),mbti:emptyToNull(inputValue('m_mbti')),avatar_path:state.currentMember?.avatar_path||null}; const avatar=await uploadMedia($('m_avatar_file')?.files?.[0],'members',row.soop_id||row.nickname); if(avatar) row.avatar_path=avatar;
    if (!row.name || !row.nickname) throw new Error('name과 nickname은 필수입니다.');
    let error;
    if (state.currentMember?.id) ({error}=await state.client.from('members').update(row).eq('id',state.currentMember.id));
    else { row.source_order=await nextSourceOrder('members'); ({error}=await state.client.from('members').insert(row)); }
    if(error) throw error; $('memberEditor').classList.add('hidden'); setStatus('멤버를 저장했습니다.','ok'); await loadMembers(); await loadDashboard();
  } catch(e){setStatus(`멤버 저장 실패: ${errText(e)}`,'error');} return false;
}
async function deleteMember(id){return deleteRecord('members','id',id,'이 멤버 행을 삭제할까요?',loadMembers,'멤버를 삭제했습니다.');}

// ---- teams ----
async function loadTeams(){const {data,error}=await state.client.from('teams').select('*').order('source_order');if(error)return setStatus(`팀 조회 실패: ${errText(error)}`,'error');state.teams=data||[];renderTeams();}
function renderTeams(){const q=inputValue('teamSearch').trim().toLowerCase();const rows=state.teams.filter(r=>!q||String(r.team_name||'').toLowerCase().includes(q));$('teamRows').innerHTML=rows.map(r=>`<tr><td>${r.id}</td><td><b>${esc(r.team_name)}</b></td><td>${esc(r.founders)}</td><td>${esc(r.founded_date)}</td><td>${esc(r.disbanded_date)}</td><td>${esc(r.championship)}</td><td>${esc(r.note)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editTeam(${r.id})`)}${button('삭제',`AdminApp.deleteTeam(${r.id})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="8">검색 결과가 없습니다.</td></tr>';}
function editTeam(id){const r=id?state.teams.find(x=>x.id===id):{};state.currentTeam=r||{};$('teamEditor').innerHTML=`<form onsubmit="return AdminApp.saveTeam(event)"><div class="admin-form-grid"><div class="admin-field"><label>팀 이름 *</label><input id="t_name" class="admin-input" value="${esc(r.team_name)}" required></div><div class="admin-field"><label>설립자</label><input id="t_founders" class="admin-input" value="${esc(r.founders)}"></div><div class="admin-field"><label>창단일</label><input id="t_founded" type="date" class="admin-input" value="${esc(r.founded_date)}"></div><div class="admin-field"><label>해체일</label><input id="t_disbanded" type="date" class="admin-input" value="${esc(r.disbanded_date)}"></div><div class="admin-field"><label>우승</label><input id="t_championship" class="admin-input" value="${esc(r.championship)}"></div><div class="admin-field"><label>팀 로고</label><input id="t_logo_file" class="admin-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><small>${esc(r.logo_path||'기존 Git 로고 fallback')}</small></div><div class="admin-field span-3"><label>비고</label><textarea id="t_note" class="admin-textarea">${esc(r.note)}</textarea></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('teamEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('teamEditor').classList.remove('hidden');}
async function saveTeam(ev){ev.preventDefault();try{const row={team_name:inputValue('t_name').trim(),founders:emptyToNull(inputValue('t_founders')),founded_date:emptyToNull(inputValue('t_founded')),disbanded_date:emptyToNull(inputValue('t_disbanded')),championship:emptyToNull(inputValue('t_championship')),note:emptyToNull(inputValue('t_note')),logo_path:state.currentTeam?.logo_path||null}; const logo=await uploadMedia($('t_logo_file')?.files?.[0],'teams',row.team_name); if(logo) row.logo_path=logo;let error;if(state.currentTeam?.id)({error}=await state.client.from('teams').update(row).eq('id',state.currentTeam.id));else{row.source_order=await nextSourceOrder('teams');({error}=await state.client.from('teams').insert(row));}if(error)throw error;$('teamEditor').classList.add('hidden');setStatus('팀 정보를 저장했습니다.','ok');await loadTeams();}catch(e){setStatus(`팀 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteTeam(id){return deleteRecord('teams','id',id,'이 팀을 삭제할까요? matches의 상대팀 문자열은 자동 변경되지 않습니다.',loadTeams);}

// ---- matches / rounds ----
async function loadMatches(){const {data,error}=await state.client.from('matches').select('*').order('match_date',{ascending:false}).order('match_no',{ascending:false}).limit(500);if(error)return setStatus(`전적 조회 실패: ${errText(error)}`,'error');state.matches=data||[];renderMatches();}
function renderMatches(){const q=inputValue('matchSearch').trim().toLowerCase();const rows=state.matches.filter(r=>!q||[r.opponent_team,r.match_date,r.final_result,r.match_no].some(v=>String(v??'').toLowerCase().includes(q)));$('matchRows').innerHTML=rows.map(r=>`<tr><td>${r.match_no}</td><td>${esc(r.match_date)}</td><td><b>${esc(r.opponent_team)}</b></td><td>${esc(r.match_format)}</td><td>${esc(r.method)}</td><td>${esc(r.final_result)}</td><td>${esc(r.set_result)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editMatch(${r.match_no})`)}${button('삭제',`AdminApp.deleteMatch(${r.match_no})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="8">검색 결과가 없습니다.</td></tr>';}
async function editMatch(matchNo){let r={};let rounds=[];if(matchNo){r=state.matches.find(x=>x.match_no===matchNo)||{};const res=await state.client.from('rounds').select('*').eq('match_no',matchNo).order('source_order');if(res.error)return setStatus(`세트 조회 실패: ${errText(res.error)}`,'error');rounds=res.data||[];}state.currentMatch=r;$('matchEditor').innerHTML=matchForm(r,rounds);$('matchEditor').classList.remove('hidden');}
function matchForm(r={},rounds=[]){return `<form onsubmit="return AdminApp.saveMatch(event)"><input id="ma_source_order" type="hidden" value="${esc(r.source_order)}"><div class="admin-form-grid"><div class="admin-field"><label>매치 번호 ${r.match_no?'(수정 불가)':'(비우면 자동)'}</label><input id="ma_no" class="admin-input" type="number" value="${esc(r.match_no)}" ${r.match_no?'readonly':''}></div><div class="admin-field"><label>날짜 *</label><input id="ma_date" class="admin-input" type="date" value="${esc(r.match_date)}" required></div><div class="admin-field"><label>상대팀 *</label><input id="ma_opponent" class="admin-input" value="${esc(r.opponent_team)}" required></div><div class="admin-field"><label>형식</label><input id="ma_format" class="admin-input" value="${esc(r.match_format)}"></div><div class="admin-field"><label>방식</label><input id="ma_method" class="admin-input" value="${esc(r.method)}"></div><div class="admin-field"><label>최종 결과</label><input id="ma_result" class="admin-input" value="${esc(r.final_result)}" placeholder="4:2"></div><div class="admin-field"><label>세트 결과</label><input id="ma_set_result" class="admin-input" value="${esc(r.set_result)}"></div><div class="admin-field"><label>득실</label><input id="ma_score_diff" class="admin-input" value="${esc(r.score_diff)}"></div><div class="admin-field"><label>펀딩</label><input id="ma_funding" class="admin-input" value="${esc(r.funding)}"></div><div class="admin-field"><label>지원금</label><input id="ma_support" class="admin-input" value="${esc(r.support_amount)}"></div><div class="admin-field"><label>사비</label><input id="ma_personal" class="admin-input" value="${esc(r.personal_amount)}"></div><div class="admin-field"><label>도전미션</label><input id="ma_challenge" class="admin-input" value="${esc(r.challenge_mission)}"></div></div><div class="admin-rounds"><div class="admin-toolbar"><b>세트/라운드</b><button type="button" class="admin-btn" onclick="AdminApp.addRound()">+ 라운드</button></div><div id="roundRows">${rounds.map(roundForm).join('')}</div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('matchEditor')">취소</button><button class="admin-btn primary">경기 저장</button></div></form>`;}
function roundForm(r={}){return `<div class="admin-round"><div class="admin-field"><label>세트</label><input data-key="set_name" class="admin-input" value="${esc(r.set_name)}"></div><div class="admin-field"><label>라운드</label><input data-key="round_name" class="admin-input" value="${esc(r.round_name)}"></div><div class="admin-field"><label>우리 선수</label><input data-key="our_player" class="admin-input" value="${esc(r.our_player)}"></div><div class="admin-field"><label>종족</label><input data-key="our_race" class="admin-input" value="${esc(r.our_race)}"></div><div class="admin-field"><label>티어</label><input data-key="our_tier" class="admin-input" value="${esc(r.our_tier)}"></div><div class="admin-field"><label>결과</label><input data-key="result" class="admin-input" value="${esc(r.result)}" placeholder="승/패"></div><div class="admin-field"><label>상대 선수</label><input data-key="opponent_player" class="admin-input" value="${esc(r.opponent_player)}"></div><div class="admin-field"><label>종족</label><input data-key="opponent_race" class="admin-input" value="${esc(r.opponent_race)}"></div><div class="admin-field"><label>티어</label><input data-key="opponent_tier" class="admin-input" value="${esc(r.opponent_tier)}"></div><div class="admin-field"><label>맵</label><input data-key="map_name" class="admin-input" value="${esc(r.map_name)}"></div><button type="button" class="admin-btn danger round-remove" onclick="this.closest('.admin-round').remove()">×</button></div>`;}
function addRound(){ $('roundRows').insertAdjacentHTML('beforeend',roundForm({})); }
async function saveMatch(ev){ev.preventDefault();try{const p_match={match_no:intOrNull(inputValue('ma_no')),source_order:intOrNull(inputValue('ma_source_order')),match_date:inputValue('ma_date'),opponent_team:inputValue('ma_opponent').trim(),match_format:emptyToNull(inputValue('ma_format')),method:emptyToNull(inputValue('ma_method')),final_result:emptyToNull(inputValue('ma_result')),set_result:emptyToNull(inputValue('ma_set_result')),score_diff:emptyToNull(inputValue('ma_score_diff')),funding:emptyToNull(inputValue('ma_funding')),support_amount:emptyToNull(inputValue('ma_support')),personal_amount:emptyToNull(inputValue('ma_personal')),challenge_mission:emptyToNull(inputValue('ma_challenge'))};if(!p_match.match_date||!p_match.opponent_team)throw new Error('날짜와 상대팀은 필수입니다.');const p_rounds=[...document.querySelectorAll('#roundRows .admin-round')].map(el=>{const obj={};el.querySelectorAll('[data-key]').forEach(i=>obj[i.dataset.key]=emptyToNull(i.value));return obj;});const {data,error}=await state.client.rpc('admin_save_match',{p_match,p_rounds});if(error)throw error;$('matchEditor').classList.add('hidden');setStatus(`경기 ${data}번을 저장했습니다.`,'ok');await loadMatches();}catch(e){setStatus(`경기 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteMatch(matchNo){return deleteRecord('matches','match_no',matchNo,`${matchNo}번 경기와 연결된 모든 라운드를 삭제할까요?`,loadMatches,'경기를 삭제했습니다.');}

// ---- tier members ----
function safeSearch(q){return q.replace(/[,()%"']/g,' ').trim();}
async function loadTierMembers(page=0){state.tierPage=Math.max(0,page);const from=state.tierPage*state.tierPageSize,to=from+state.tierPageSize-1;let query=state.client.from('tier_members').select('*',{count:'exact'}).order('source_order').range(from,to);const q=safeSearch(inputValue('tierSearch'));if(q)query=query.or(`name.ilike.%${q}%,nickname.ilike.%${q}%,soop_id.ilike.%${q}%`);const {data,count,error}=await query;if(error)return setStatus(`티어 명단 조회 실패: ${errText(error)}`,'error');state.tierCount=count||0;$('tierRows').innerHTML=(data||[]).map(r=>`<tr><td>${r.id}</td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b></td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.race)}</td><td>${esc(r.tier)}</td><td>${esc(r.affiliation)}</td><td>${esc(r.role)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editTierMember(${r.id})`)}${button('삭제',`AdminApp.deleteTierMember(${r.id})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="10">검색 결과가 없습니다.</td></tr>';state.currentTierPageRows=data||[];const pages=Math.max(1,Math.ceil(state.tierCount/state.tierPageSize));$('tierPageInfo').textContent=`${state.tierPage+1} / ${pages} · ${state.tierCount.toLocaleString()}명`;$('tierPrev').disabled=state.tierPage<=0;$('tierNext').disabled=state.tierPage>=pages-1;}
function tierPromotionFields(r){return [8,7,6,5,4,3,2,1,0].map(n=>`<div class="admin-field"><label>${n}티어 승급</label><input id="tm_p${n}" class="admin-input" value="${esc(r[`promoted_tier_${n}`])}"></div>`).join('');}
function editTierMember(id){const r=id?(state.currentTierPageRows||[]).find(x=>x.id===id):{};state.currentTier=r||{};$('tierEditor').innerHTML=`<form onsubmit="return AdminApp.saveTierMember(event)"><div class="admin-form-grid"><div class="admin-field"><label>이름</label><input id="tm_name" class="admin-input" value="${esc(r.name)}"></div><div class="admin-field"><label>닉네임 *</label><input id="tm_nickname" class="admin-input" value="${esc(r.nickname)}" required></div><div class="admin-field"><label>SOOP ID</label><input id="tm_soop" class="admin-input" value="${esc(r.soop_id)}"></div><div class="admin-field"><label>ELO ID</label><input id="tm_elo" type="number" class="admin-input" value="${esc(r.elo_id)}"></div><div class="admin-field"><label>생년월일</label><input id="tm_birth" type="date" class="admin-input" value="${esc(r.birth_date)}"></div><div class="admin-field"><label>성별</label><input id="tm_gender" class="admin-input" value="${esc(r.gender)}"></div><div class="admin-field"><label>종족</label><input id="tm_race" class="admin-input" value="${esc(r.race)}"></div><div class="admin-field"><label>티어</label><input id="tm_tier" class="admin-input" value="${esc(r.tier)}"></div><div class="admin-field"><label>소속</label><input id="tm_aff" class="admin-input" value="${esc(r.affiliation)}"></div><div class="admin-field"><label>직책</label><input id="tm_role" class="admin-input" value="${esc(r.role)}"></div><div class="admin-field"><label>수정일</label><input id="tm_modified" class="admin-input" value="${esc(r.modified_at)}"></div><div class="admin-field"><label>시작</label><input id="tm_started" class="admin-input" value="${esc(r.started_on)}"></div><div class="admin-field"><label>ELO 등록</label><input id="tm_elo_registered" class="admin-input" value="${esc(r.elo_registered)}"></div><div class="admin-field"><label>티어표 등록</label><input id="tm_table_registered" class="admin-input" value="${esc(r.tier_table_registered)}"></div>${tierPromotionFields(r)}<div class="admin-field span-3"><label>연혁</label><textarea id="tm_history" class="admin-textarea">${esc(r.history)}</textarea></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('tierEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('tierEditor').classList.remove('hidden');}
async function saveTierMember(ev){ev.preventDefault();try{const row={name:emptyToNull(inputValue('tm_name')),nickname:inputValue('tm_nickname').trim(),soop_id:emptyToNull(inputValue('tm_soop')),elo_id:intOrNull(inputValue('tm_elo')),birth_date:emptyToNull(inputValue('tm_birth')),gender:emptyToNull(inputValue('tm_gender')),race:emptyToNull(inputValue('tm_race')),tier:emptyToNull(inputValue('tm_tier')),affiliation:emptyToNull(inputValue('tm_aff')),role:emptyToNull(inputValue('tm_role')),modified_at:emptyToNull(inputValue('tm_modified')),history:emptyToNull(inputValue('tm_history')),started_on:emptyToNull(inputValue('tm_started')),elo_registered:emptyToNull(inputValue('tm_elo_registered')),tier_table_registered:emptyToNull(inputValue('tm_table_registered'))};for(const n of [8,7,6,5,4,3,2,1,0])row[`promoted_tier_${n}`]=emptyToNull(inputValue(`tm_p${n}`));if(!row.nickname)throw new Error('닉네임은 필수입니다.');let error;if(state.currentTier?.id)({error}=await state.client.from('tier_members').update(row).eq('id',state.currentTier.id));else{row.source_order=await nextSourceOrder('tier_members');({error}=await state.client.from('tier_members').insert(row));}if(error)throw error;$('tierEditor').classList.add('hidden');setStatus('티어 선수를 저장했습니다.','ok');await loadTierMembers(state.tierPage);}catch(e){setStatus(`티어 선수 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteTierMember(id){return deleteRecord('tier_members','id',id,'이 티어 선수 행을 삭제할까요?',()=>loadTierMembers(state.tierPage));}

// ---- settings ----
async function loadSettings(){const {data,error}=await state.client.from('settings').select('*').order('source_order');if(error)return setStatus(`설정 조회 실패: ${errText(error)}`,'error');state.settings=data||[];$('settingRows').innerHTML=state.settings.map(r=>`<tr><td>${r.source_order}</td><td><b>${esc(r.season)}</b></td><td>${esc(r.start_date)}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editSetting(${r.source_order})`)}${button('삭제',`AdminApp.deleteSetting(${r.source_order})`,'danger')}</div></td></tr>`).join('');}
function editSetting(order){const r=order?(state.settings||[]).find(x=>x.source_order===order):{};state.currentSetting=r||{};$('settingEditor').innerHTML=`<form onsubmit="return AdminApp.saveSetting(event)"><div class="admin-form-grid"><div class="admin-field"><label>순서</label><input id="s_order" type="number" class="admin-input" value="${esc(r.source_order)}" ${r.source_order?'readonly':''} placeholder="비우면 자동"></div><div class="admin-field"><label>시즌 *</label><input id="s_season" class="admin-input" value="${esc(r.season)}" required></div><div class="admin-field"><label>시작일</label><input id="s_date" type="date" class="admin-input" value="${esc(r.start_date)}"></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('settingEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('settingEditor').classList.remove('hidden');}
async function saveSetting(ev){ev.preventDefault();try{const order=intOrNull(inputValue('s_order'))||await nextSourceOrder('settings');const row={source_order:order,season:inputValue('s_season').trim(),start_date:emptyToNull(inputValue('s_date'))};const {error}=await state.client.from('settings').upsert(row,{onConflict:'source_order'});if(error)throw error;$('settingEditor').classList.add('hidden');setStatus('시즌 설정을 저장했습니다.','ok');await loadSettings();}catch(e){setStatus(`설정 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteSetting(order){return deleteRecord('settings','source_order',order,'이 시즌 설정을 삭제할까요?',loadSettings);}


// ---- schedule / off-air ----
async function loadSchedule(){
  const [evRes,offRes]=await Promise.all([state.client.from('calendar_events').select('*').order('start_date').order('source_order'),state.client.from('calendar_off_air').select('*').order('off_date').order('source_order')]);
  if(evRes.error||offRes.error)return setStatus(`일정 조회 실패: ${errText(evRes.error||offRes.error)}`,'error');
  state.calendarEvents=evRes.data||[];state.offAir=offRes.data||[];
  calEvents=state.calendarEvents.map(r=>({id:r.id,startDate:r.start_date,endDate:r.end_date||r.start_date,time:r.event_time||'',person:r.person||'',desc:r.description||'',detail:r.detail||'',color:r.color||''}));
  calOffAir={};state.offAir.forEach(r=>(calOffAir[r.off_date]??=[]).push(r.soop_id));
  $('offAirRows').innerHTML=state.offAir.map(r=>`<tr><td>${esc(r.off_date)}</td><td><b>${esc(r.soop_id)}</b></td><td>${button('삭제',`AdminApp.deleteOffAir('${String(r.off_date).replaceAll("'","\'")}','${String(r.soop_id).replaceAll("'","\'")}')`,'danger')}</td></tr>`).join('')||'<tr><td colspan="3">등록된 휴방이 없습니다.</td></tr>';
  calRenderCalendar();
  calSelectDate(calSelectedDateStr||calTodayStr());
}
function editSchedule(id,date){const r=id?state.calendarEvents.find(x=>String(x.id)===String(id)):{};const selected=date||calSelectedDateStr||calTodayStr();state.currentSchedule=r||{};$('scheduleEditor').innerHTML=`<form onsubmit="return AdminApp.saveSchedule(event)"><div class="admin-form-grid"><div class="admin-field"><label>시작일 *</label><input id="c_start" type="date" class="admin-input" value="${esc(r.start_date||selected)}" required></div><div class="admin-field"><label>종료일 *</label><input id="c_end" type="date" class="admin-input" value="${esc(r.end_date||r.start_date||selected)}" required></div><div class="admin-field"><label>시간</label><input id="c_time" class="admin-input" value="${esc(r.event_time)}" placeholder="19:00"></div><div class="admin-field"><label>사람/제목 *</label><input id="c_person" class="admin-input" value="${esc(r.person)}" required></div><div class="admin-field"><label>간략내용</label><input id="c_desc" class="admin-input" value="${esc(r.description)}"></div><div class="admin-field"><label>상세내용</label><input id="c_detail" class="admin-input" value="${esc(r.detail)}"></div><div class="admin-field"><label>색상</label><input id="c_color" type="color" class="admin-input" value="${esc(r.color||'#1677ff')}"></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('scheduleEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('scheduleEditor').classList.remove('hidden');}
async function saveSchedule(ev){ev.preventDefault();try{const row={start_date:inputValue('c_start'),end_date:inputValue('c_end')||inputValue('c_start'),event_time:emptyToNull(inputValue('c_time')),person:inputValue('c_person').trim(),description:emptyToNull(inputValue('c_desc')),detail:emptyToNull(inputValue('c_detail')),color:emptyToNull(inputValue('c_color'))};let error;if(state.currentSchedule?.id){({error}=await state.client.from('calendar_events').update(row).eq('id',state.currentSchedule.id));}else{row.id=Date.now();row.source_order=await nextSourceOrder('calendar_events');({error}=await state.client.from('calendar_events').insert(row));}if(error)throw error;$('scheduleEditor').classList.add('hidden');setStatus('일정을 저장했습니다.','ok');await loadSchedule();}catch(e){setStatus(`일정 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteSchedule(id){return deleteRecord('calendar_events','id',id,'이 일정을 삭제할까요?',loadSchedule);}
async function saveOffAir(ev){ev.preventDefault();try{const date=inputValue('o_date'),sid=inputValue('o_soop').trim();if(!date||!sid)throw new Error('날짜와 SOOP ID는 필수입니다.');const same=state.offAir.filter(x=>x.off_date===date);const {error}=await state.client.from('calendar_off_air').upsert({off_date:date,soop_id:sid,source_order:same.length+1},{onConflict:'off_date,soop_id'});if(error)throw error;$('o_soop').value='';setStatus('휴방을 저장했습니다.','ok');await loadSchedule();}catch(e){setStatus(`휴방 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteOffAir(date,sid){const {error}=await state.client.from('calendar_off_air').delete().eq('off_date',date).eq('soop_id',sid);if(error)return setStatus(`휴방 삭제 실패: ${errText(error)}`,'error');await loadSchedule();}

window.calCardExtra=(item,_date,type)=>type==='selected'?`<div class="cal-card-actions"><button type="button" class="edit-btn" onclick="AdminApp.editSchedule(${Number(item.id)})">수정</button><button type="button" class="delete-btn" onclick="AdminApp.deleteSchedule(${Number(item.id)})">삭제</button></div>`:'';
window.calOnDateSelect=date=>{if($('o_date'))$('o_date').value=date;editSchedule(null,date);};

// ---- navigation ----
async function loadNavigation(){const {data,error}=await state.client.from('site_config').select('config_value').eq('config_key','nav').maybeSingle();if(error)return setStatus(`메뉴 설정 조회 실패: ${errText(error)}`,'error');state.navConfig=data?.config_value||{hidden:[],statsTabs:[],heroDescriptions:{}};const hidden=new Set(state.navConfig.hidden||[]),stats=new Set(state.navConfig.statsTabs||[]);document.querySelectorAll('[data-nav-key]').forEach(x=>x.checked=!hidden.has(x.dataset.navKey));document.querySelectorAll('[data-stat-key]').forEach(x=>x.checked=!stats.has(x.dataset.statKey));$('heroDescriptionsJson').value=JSON.stringify(state.navConfig.heroDescriptions||{},null,2);}
async function saveNavigation(){try{const hidden=[...document.querySelectorAll('[data-nav-key]')].filter(x=>!x.checked).map(x=>x.dataset.navKey);const statsTabs=[...document.querySelectorAll('[data-stat-key]')].filter(x=>!x.checked).map(x=>x.dataset.statKey);let heroDescriptions={};try{heroDescriptions=JSON.parse(inputValue('heroDescriptionsJson')||'{}');}catch(_){throw new Error('히어로 설명 JSON 형식이 올바르지 않습니다.');}const config_value={hidden,statsTabs,heroDescriptions};const {error}=await state.client.from('site_config').upsert({config_key:'nav',config_value,updated_at:new Date().toISOString()},{onConflict:'config_key'});if(error)throw error;state.navConfig=config_value;setStatus('메뉴 설정을 저장했습니다. 사이트에 즉시 반영됩니다.','ok');}catch(e){setStatus(`메뉴 설정 저장 실패: ${errText(e)}`,'error');}}


// ---- history ----
async function loadHistoryEntries(){const {data,error}=await state.client.from('history_entries').select('*').order('event_date',{ascending:false,nullsFirst:false}).order('sort_order');if(error)return setStatus(`연혁 조회 실패: ${errText(error)}`,'error');state.historyEntries=data||[];$('historyRows').innerHTML=state.historyEntries.map(r=>`<tr><td>${r.entry_kind==='override'?'자동 보정':'수동'}</td><td>${esc(r.event_date)}</td><td>${esc(r.event_type)}</td><td><b>${esc(r.title)}</b>${r.hidden?' <small>(숨김)</small>':''}</td><td>${r.youtube_url?'있음':'-'}</td><td>${r.image_path?'있음':'-'}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editHistory('${String(r.id).replaceAll("'","\\'")}')`)}${button('삭제',`AdminApp.deleteHistory('${String(r.id).replaceAll("'","\\'")}')`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="7">등록된 연혁 메타데이터가 없습니다.</td></tr>';}
function editHistory(id){const r=id?state.historyEntries.find(x=>String(x.id)===String(id)):{};state.currentHistory=r||{};$('historyEditor').innerHTML=`<form onsubmit="return AdminApp.saveHistory(event)"><div class="admin-form-grid"><div class="admin-field"><label>ID</label><input id="h_id" class="admin-input" value="${esc(r.id)}" placeholder="비우면 자동" ${r.id?'readonly':''}></div><div class="admin-field"><label>종류</label><select id="h_kind" class="admin-input"><option value="manual" ${r.entry_kind==='override'?'':'selected'}>수동 연혁</option><option value="override" ${r.entry_kind==='override'?'selected':''}>자동 입/퇴단 보정</option></select></div><div class="admin-field"><label>날짜 (수동)</label><input id="h_date" type="date" class="admin-input" value="${esc(r.event_date)}"></div><div class="admin-field"><label>분류</label><select id="h_type" class="admin-input">${['founding','join','leave','match','broadcast','event'].map(x=>`<option value="${x}" ${r.event_type===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="admin-field span-3"><label>제목</label><input id="h_title" class="admin-input" value="${esc(r.title)}"></div><div class="admin-field span-3"><label>설명</label><textarea id="h_desc" class="admin-textarea">${esc(r.description)}</textarea></div><div class="admin-field span-3"><label>멤버 (한 줄에 한 명, 예: 김윤환(감독))</label><textarea id="h_members" class="admin-textarea">${esc((Array.isArray(r.members)?r.members:[]).join('\n'))}</textarea></div><div class="admin-field span-3"><label>YouTube URL</label><input id="h_youtube" class="admin-input" value="${esc(r.youtube_url)}"></div><div class="admin-field"><label>연혁 이미지</label><input id="h_image_file" type="file" class="admin-input" accept="image/jpeg,image/png,image/webp,image/gif"><small>${esc(r.image_path||'없음')}</small></div><div class="admin-field"><label>같은 날 정렬</label><input id="h_order" type="number" class="admin-input" value="${esc(r.sort_order)}"></div><label class="admin-field"><span>숨김</span><input id="h_hidden" type="checkbox" ${r.hidden?'checked':''}></label></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('historyEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('historyEditor').classList.remove('hidden');}
async function saveHistory(ev){ev.preventDefault();try{const kind=inputValue('h_kind');const id=inputValue('h_id').trim()||`h-${Date.now().toString(36)}`;if(kind==='override'&&!id.startsWith('auto-'))throw new Error('자동 보정 ID는 auto-join-YYYY-MM-DD 또는 auto-leave-YYYY-MM-DD 형식이어야 합니다.');const row={id,entry_kind:kind,event_date:kind==='manual'?emptyToNull(inputValue('h_date')):null,event_type:kind==='manual'?emptyToNull(inputValue('h_type')):null,title:emptyToNull(inputValue('h_title')),description:emptyToNull(inputValue('h_desc')),members:inputValue('h_members').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),youtube_url:emptyToNull(inputValue('h_youtube')),image_path:state.currentHistory?.image_path||null,sort_order:intOrNull(inputValue('h_order')),hidden:!!$('h_hidden')?.checked,updated_at:new Date().toISOString()};if(kind==='manual'&&!row.event_date)throw new Error('수동 연혁은 날짜가 필요합니다.');const image=await uploadMedia($('h_image_file')?.files?.[0],'history',id);if(image)row.image_path=image;const {error}=await state.client.from('history_entries').upsert(row,{onConflict:'id'});if(error)throw error;$('historyEditor').classList.add('hidden');setStatus('연혁을 저장했습니다. 사이트에 즉시 반영됩니다.','ok');await loadHistoryEntries();}catch(e){setStatus(`연혁 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteHistory(id){return deleteRecord('history_entries','id',id,'이 연혁을 삭제할까요? 업로드 사진은 다른 항목이 참조할 수 있어 Storage에서 자동 삭제하지 않습니다.',loadHistoryEntries);}


// ---- standalone video tab ----
function youtubeIdFromUrl(url){const m=String(url||'').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);return m?m[1]:'';}
function soopVodNoFromUrl(url){const u=String(url||'');if(!/(?:sooplive\.(?:co\.kr|com)|afreecatv\.com)/i.test(u))return '';const m=u.match(/\/(?:player|video|PLAYER\/STATION)\/(\d{1,20})/i);return m?m[1]:'';}
async function loadVideoAdmin(){
  const [ch,picks,videos]=await Promise.all([
    state.client.from('video_channels').select('*').order('source_order'),
    state.client.from('video_picks').select('*').order('source_order'),
    state.client.from('videos').select('id,channel_url,title,published,views,hidden').order('published',{ascending:false}).limit(200)
  ]);
  const error=ch.error||picks.error||videos.error;if(error)return setStatus(`영상 조회 실패: ${errText(error)}`,'error');
  state.videoChannels=ch.data||[];state.videoPicks=picks.data||[];state.videos=videos.data||[];
  const names=Object.fromEntries(state.videoChannels.map(x=>[x.channel_url,x.display_name||x.title||x.channel_url]));
  $('videoChannelRows').innerHTML=state.videoChannels.map(r=>`<tr><td>${r.source_order}</td><td><b>${esc(r.display_name||r.title)}</b></td><td>${esc(r.channel_url)}</td><td>${r.active?'사용':'중지'}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editVideoChannel('${String(r.channel_url).replaceAll("'","\\'")}')`)}${button('삭제',`AdminApp.deleteVideoChannel('${String(r.channel_url).replaceAll("'","\\'")}')`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="5">등록된 채널이 없습니다.</td></tr>';
  $('videoPickRows').innerHTML=state.videoPicks.map(r=>`<tr><td>${r.source_order}</td><td>${esc(r.group_name)}</td><td><b>${esc(r.title)}</b></td><td>${esc(r.kind)}</td><td>${r.hidden?'숨김':'표시'}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editVideoPick('${String(r.id).replaceAll("'","\\'")}')`)}${button('삭제',`AdminApp.deleteVideoPick('${String(r.id).replaceAll("'","\\'")}')`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="6">추천 영상이 없습니다.</td></tr>';
  $('videoRows').innerHTML=state.videos.map(r=>`<tr><td>${esc(String(r.published||'').slice(0,10))}</td><td>${esc(names[r.channel_url]||r.channel_url)}</td><td><b>${esc(r.title)}</b></td><td>${Number(r.views||0).toLocaleString()}</td><td>${r.hidden?'숨김':'표시'}</td><td>${button(r.hidden?'표시':'숨김',`AdminApp.toggleVideoHidden('${String(r.id).replaceAll("'","\\'")}',${!r.hidden})`)}</td></tr>`).join('')||'<tr><td colspan="6">수집된 영상이 없습니다.</td></tr>';
}
function editVideoChannel(url){const r=url?state.videoChannels.find(x=>x.channel_url===url):{};state.currentVideoChannel=r||{};$('videoChannelEditor').innerHTML=`<form onsubmit="return AdminApp.saveVideoChannel(event)"><div class="admin-form-grid"><div class="admin-field span-3"><label>YouTube 채널 URL *</label><input id="vc_url" class="admin-input" value="${esc(r.channel_url)}" ${r.channel_url?'readonly':''} required></div><div class="admin-field"><label>표시 이름</label><input id="vc_name" class="admin-input" value="${esc(r.display_name)}"></div><div class="admin-field"><label>순서</label><input id="vc_order" type="number" class="admin-input" value="${esc(r.source_order)}"></div><label class="admin-field"><span>사용</span><input id="vc_active" type="checkbox" ${r.active===false?'':'checked'}></label></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('videoChannelEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('videoChannelEditor').classList.remove('hidden');}
async function saveVideoChannel(ev){ev.preventDefault();try{const row={channel_url:inputValue('vc_url').trim(),display_name:emptyToNull(inputValue('vc_name')),source_order:intOrNull(inputValue('vc_order'))||await nextSourceOrder('video_channels'),active:!!$('vc_active')?.checked,updated_at:new Date().toISOString()};if(!row.channel_url)throw new Error('채널 URL은 필수입니다.');const {error}=await state.client.from('video_channels').upsert(row,{onConflict:'channel_url'});if(error)throw error;$('videoChannelEditor').classList.add('hidden');setStatus('영상 채널을 저장했습니다. 다음 동기화부터 반영됩니다.','ok');await loadVideoAdmin();}catch(e){setStatus(`채널 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteVideoChannel(url){return deleteRecord('video_channels','channel_url',url,'이 채널을 삭제할까요? 이미 수집된 영상은 보존됩니다.',loadVideoAdmin);}
function editVideoPick(id){const r=id?state.videoPicks.find(x=>String(x.id)===String(id)):{};state.currentVideoPick=r||{};const url=r.id?(String(r.id).startsWith('soop:')?`https://vod.sooplive.co.kr/player/${String(r.id).slice(5)}`:`https://youtu.be/${r.id}`):'';$('videoPickEditor').innerHTML=`<form onsubmit="return AdminApp.saveVideoPick(event)"><div class="admin-form-grid"><div class="admin-field span-3"><label>YouTube / SOOP VOD URL *</label><input id="vp_url" class="admin-input" value="${esc(url)}" ${r.id?'readonly':''} required></div><div class="admin-field span-3"><label>제목 *</label><input id="vp_title" class="admin-input" value="${esc(r.title)}" required></div><div class="admin-field span-3"><label>설명</label><input id="vp_note" class="admin-input" value="${esc(r.note)}"></div><div class="admin-field"><label>분류</label><input id="vp_group" class="admin-input" value="${esc(r.group_name)}"></div><div class="admin-field"><label>영문 라벨</label><input id="vp_group_en" class="admin-input" value="${esc(r.group_en)}"></div><div class="admin-field"><label>작성자</label><input id="vp_author" class="admin-input" value="${esc(r.author)}"></div><div class="admin-field"><label>추가일</label><input id="vp_date" type="date" class="admin-input" value="${esc(r.added_at)}"></div><div class="admin-field"><label>썸네일 URL</label><input id="vp_thumb" class="admin-input" value="${esc(r.thumb)}"></div><div class="admin-field"><label>순서</label><input id="vp_order" type="number" class="admin-input" value="${esc(r.source_order)}"></div><label class="admin-field"><span>쇼츠</span><input id="vp_short" type="checkbox" ${r.short?'checked':''}></label><label class="admin-field"><span>숨김</span><input id="vp_hidden" type="checkbox" ${r.hidden?'checked':''}></label></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('videoPickEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;$('videoPickEditor').classList.remove('hidden');}
async function saveVideoPick(ev){ev.preventDefault();try{const url=inputValue('vp_url').trim(),yt=youtubeIdFromUrl(url),soop=yt?'':soopVodNoFromUrl(url),id=state.currentVideoPick?.id||(yt|| (soop?`soop:${soop}`:''));if(!id)throw new Error('지원하는 YouTube 또는 SOOP VOD URL이 아닙니다.');const row={id,kind:String(id).startsWith('soop:')?'soop':'youtube',title:inputValue('vp_title').trim(),note:emptyToNull(inputValue('vp_note')),group_name:emptyToNull(inputValue('vp_group')),group_en:emptyToNull(inputValue('vp_group_en')),added_at:emptyToNull(inputValue('vp_date')),author:emptyToNull(inputValue('vp_author')),thumb:emptyToNull(inputValue('vp_thumb')),short:!!$('vp_short')?.checked,hidden:!!$('vp_hidden')?.checked,source_order:intOrNull(inputValue('vp_order'))||await nextSourceOrder('video_picks'),updated_at:new Date().toISOString()};if(!row.title)throw new Error('제목은 필수입니다.');if(!row.thumb&&row.kind==='youtube')row.thumb=`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;const {error}=await state.client.from('video_picks').upsert(row,{onConflict:'id'});if(error)throw error;$('videoPickEditor').classList.add('hidden');setStatus('추천 영상을 저장했습니다. 영상 탭에 즉시 반영됩니다.','ok');await loadVideoAdmin();}catch(e){setStatus(`추천 영상 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteVideoPick(id){return deleteRecord('video_picks','id',id,'이 추천 영상을 삭제할까요?',loadVideoAdmin);}
async function toggleVideoHidden(id,hidden){const {error}=await state.client.from('videos').update({hidden,updated_at:new Date().toISOString()}).eq('id',id);if(error)return setStatus(`영상 노출 변경 실패: ${errText(error)}`,'error');await loadVideoAdmin();}

// ---- external tools ----
async function loadExternalTools(){
  const {data,error}=await state.client.from('external_tools').select('*').order('source_order');
  if(error)return setStatus(`외부도구 조회 실패: ${errText(error)}`,'error');
  state.externalTools=data||[];
  $('externalToolRows').innerHTML=state.externalTools.map(r=>`<tr><td>${r.source_order}</td><td>${r.category==='extSites'?'외부 사이트':'외부 도구'}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.url)}</td><td>${r.active?'표시':'숨김'}</td><td><div class="admin-row-actions">${button('수정',`AdminApp.editExternalTool(${r.id})`)}${button('삭제',`AdminApp.deleteExternalTool(${r.id})`,'danger')}</div></td></tr>`).join('')||'<tr><td colspan="6">등록된 외부도구가 없습니다.</td></tr>';
}
function editExternalTool(id){
  const r=id?state.externalTools.find(x=>Number(x.id)===Number(id)):{};state.currentExternalTool=r||{};
  $('externalToolEditor').innerHTML=`<form onsubmit="return AdminApp.saveExternalTool(event)"><div class="admin-form-grid"><div class="admin-field"><label>구분</label><select id="et_category" class="admin-input"><option value="extTools" ${r.category==='extSites'?'':'selected'}>외부 도구</option><option value="extSites" ${r.category==='extSites'?'selected':''}>외부 사이트</option></select></div><div class="admin-field"><label>순서</label><input id="et_order" type="number" class="admin-input" value="${esc(r.source_order)}"></div><label class="admin-field"><span>표시</span><input id="et_active" type="checkbox" ${r.active===false?'':'checked'}></label><div class="admin-field span-3"><label>이름 *</label><input id="et_name" class="admin-input" value="${esc(r.name)}" required></div><div class="admin-field span-3"><label>URL *</label><input id="et_url" class="admin-input" value="${esc(r.url)}" required></div><div class="admin-field span-3"><label>파비콘 URL (선택)</label><input id="et_favicon" class="admin-input" value="${esc(r.favicon)}" placeholder="비우면 사이트 파비콘 자동 사용"></div></div><div class="admin-form-actions"><button type="button" class="admin-btn" onclick="AdminApp.closeEditor('externalToolEditor')">취소</button><button class="admin-btn primary">저장</button></div></form>`;
  $('externalToolEditor').classList.remove('hidden');
}
async function saveExternalTool(ev){ev.preventDefault();try{
  const row={category:inputValue('et_category'),name:inputValue('et_name').trim(),url:inputValue('et_url').trim(),favicon:emptyToNull(inputValue('et_favicon')),source_order:intOrNull(inputValue('et_order'))||await nextSourceOrder('external_tools'),active:!!$('et_active')?.checked,updated_at:new Date().toISOString()};
  if(!row.name||!/^https?:\/\//i.test(row.url))throw new Error('이름과 http/https URL이 필요합니다.');
  let error;if(state.currentExternalTool?.id)({error}=await state.client.from('external_tools').update(row).eq('id',state.currentExternalTool.id));else({error}=await state.client.from('external_tools').insert(row));
  if(error)throw error;$('externalToolEditor').classList.add('hidden');setStatus('외부도구를 저장했습니다. 도구 탭에 즉시 반영됩니다.','ok');await loadExternalTools();
}catch(e){setStatus(`외부도구 저장 실패: ${errText(e)}`,'error');}return false;}
async function deleteExternalTool(id){return deleteRecord('external_tools','id',id,'이 외부도구 링크를 삭제할까요?',loadExternalTools);}

// ---- ELO read-only ----
async function searchElo(){const q=inputValue('eloSearch').trim();let query=state.client.from('elo_players').select('*').order('elo_id').limit(100);if(q){if(/^\d+$/.test(q))query=query.eq('elo_id',Number(q));else query=query.ilike('name',`%${q.replace(/[%(),]/g,' ')}%`);}const {data,error}=await query;if(error)return setStatus(`ELO 조회 실패: ${errText(error)}`,'error');$('eloRows').innerHTML=(data||[]).map(r=>`<tr><td>${r.elo_id}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.race)}</td></tr>`).join('')||'<tr><td colspan="3">검색 결과가 없습니다.</td></tr>';}

function closeEditor(id){$(id)?.classList.add('hidden');}

async function init(){
  setTheme(document.documentElement.dataset.theme);
  $('adminPublicPage').addEventListener('load',connectPublicPage);
  $('adminEditDialog').addEventListener('cancel',event=>{event.preventDefault();closeEditSurface();});
  $('adminSiteMenu')?.addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(b){showPublicPage(b.dataset.panel);toggleSiteMenu(false);}});
  $('adminSubTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-admin-subpanel]');if(b)switchSubPanel(b.dataset.adminSubpanel);});
  if(!cfg.url||!cfg.key||!window.supabase?.createClient){showOnly('configError');return;}
  state.client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  $('loginForm').addEventListener('submit',login);$('logoutBtn').addEventListener('click',logout);$('deniedLogout').addEventListener('click',logout);
  $('memberSearch').addEventListener('input',renderMembers);$('teamSearch').addEventListener('input',renderTeams);$('matchSearch').addEventListener('input',renderMatches);
  $('tierPrev').addEventListener('click',()=>loadTierMembers(state.tierPage-1));$('tierNext').addEventListener('click',()=>loadTierMembers(state.tierPage+1));$('tierSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadTierMembers(0);});$('eloSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchElo();});
  state.client.auth.onAuthStateChange((_event,session)=>{if(!session && !$('loginView').classList.contains('admin-hidden'))return;if(!session)showOnly('loginView');});
  await verifyAdmin();
}

window.AdminApp={closeEditSurface,setTheme,toggleSiteMenu,loadDashboard,loadMembers,editMember,saveMember,deleteMember,loadTeams,editTeam,saveTeam,deleteTeam,addRound,loadMatches,editMatch,saveMatch,deleteMatch,loadTierMembers,editTierMember,saveTierMember,deleteTierMember,loadSettings,editSetting,saveSetting,deleteSetting,loadSchedule,editSchedule,saveSchedule,deleteSchedule,saveOffAir,deleteOffAir,loadNavigation,saveNavigation,loadHistoryEntries,editHistory,saveHistory,deleteHistory,loadVideoAdmin,editVideoChannel,saveVideoChannel,deleteVideoChannel,editVideoPick,saveVideoPick,deleteVideoPick,toggleVideoHidden,loadExternalTools,editExternalTool,saveExternalTool,deleteExternalTool,searchElo,closeEditor};
init().catch(e=>{console.error(e);showOnly('configError');});
})();
