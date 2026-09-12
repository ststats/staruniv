/**
 * 스타대학 사이트 공용 코어 (모든 페이지가 가장 먼저 불러온다).
 *
 * [페이지 구조] 예전엔 index.html 하나에 모든 메뉴를 넣고 JS로 보였다 숨겼다 하는 SPA였다.
 * 이제 메뉴마다 실제 페이지(docs/records/index.html 등)가 있고, 각 페이지는
 *   core.js(이 파일) → [soop.js] → page-<메뉴>.js
 * 순서로 필요한 스크립트만 불러온다. 메뉴 이동은 평범한 링크라 브라우저가 처리하고,
 * 페이지 안의 하위 상태(탭, 선택한 멤버 등)만 PageState가 URL 쿼리(?view=...&member=...)와 맞춘다.
 *
 * [전역 이름 규칙] 인라인 핸들러(onclick="...")와 calendar.js·mv-shared.js가 이름으로 부르는
 * 함수는 전역 함수로 둔다(ES 모듈로 바꾸려면 인라인 핸들러 제거가 먼저 필요하다).
 *
 * [구성] 1. 공용 유틸  2. 사이트 데이터  3. API 캐시  4. 공용 표시 헬퍼
 *        5. 방송통계 데이터(방송통계·멤버 페이지 공용)  6. 페이지 상태/시작
 */

// =====================================================================
// 1. 공용 유틸
// =====================================================================

// 구글시트 원본 텍스트를 innerHTML에 꽂을 때 깨지거나 마크업이 섞이지 않도록 이스케이프
// (mv-shared.js가 이 이름을 그대로 호출하므로 이름/동작을 바꾸면 안 된다)
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// JS 문자열 리터럴('...') 안에 값을 꽂을 때 백슬래시/따옴표를 이스케이프한다.
function jsStrEscape(str) {
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// onclick="fn('${값}')"처럼 "HTML 속성 안의 JS 문자열"에 값을 꽂을 때 쓴다.
// 예전엔 jsStrEscape만 거쳐서, 값에 큰따옴표(")가 섞이면 속성 자체가 끊기면서 그 뒤가
// 새 속성(onmouseover=... 등)으로 해석될 수 있었다(XSS). JS 이스케이프 후 HTML 이스케이프를
// 한 번 더 하면 브라우저가 속성값을 디코딩한 결과가 정확히 JS 이스케이프된 문자열이 된다.
// 특수문자가 없는 평범한 이름은 결과가 예전과 완전히 같다.
function jsAttr(str) {
    return escapeHTML(jsStrEscape(str));
}

// SOOP API의 "YYYY-MM-DD HH:MM:SS" 형식을 Date로 바꾼다. 공백을 'T'로 바꾸는 이유:
// 공백 구분 형식은 표준이 아니라 사파리(iOS)에서 Invalid Date가 나와 정렬/상대시간이
// 깨진다. 크롬/파이어폭스에서는 두 형식 모두 로컬 시각으로 해석되므로 결과가 같다.
function parseSoopDate(value) {
    return new Date(String(value || '').replace(' ', 'T'));
}

function soopDateMs(value) {
    return parseSoopDate(value).getTime();
}

// 전적 표의 날짜 칸: "2025-01-02 ..." -> "25-01-02". (숫자 등 문자열이 아닌 값이 와도 죽지 않게 String 처리)
function shortMatchDate(value) {
    return value ? String(value).split(' ')[0].substring(2) : '';
}

// 로딩중/데이터없음 등 안내 문구를 보여주는 <div> (공지, 방송중, 소식 피드 등 공용)
function emptyStateHtml(text, extraClass) {
    return `<div class="text-center text-muted py-4 fs-body${extraClass ? ' ' + extraClass : ''}">${text}</div>`;
}

// 표(tbody) 안에서 쓰는 안내 문구 <tr>
function emptyRowHtml(colspan, text, cellClass) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted ${cellClass || 'py-4'}">${text}</td></tr>`;
}

const EMPTY_MATCH_ROW_HTML = emptyRowHtml(6, '경기 기록이 없습니다.');

// 아래 방향 쉐브론 아이콘(더 보기/이전 멤버/세트 상세 토글 등에서 공용)
function chevronDownSvg(size, extraAttrs) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${extraAttrs || ''}><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}

// 화면 표시/숨김은 인라인 style.display 대신 부트스트랩 d-none 클래스 하나로 통일한다.
function setVisible(el, visible) {
    if (el) el.classList.toggle('d-none', !visible);
}

function isVisible(el) {
    return !!el && !el.classList.contains('d-none');
}
// (전적 페이지의 아바타 바, 멤버 페이지의 이전 멤버 목록 양쪽에서 쓴다)
// "이전 멤버" 접기/펼치기 공용: 대상 영역 표시 + 쉐브론 회전
function toggleCollapsible(areaId, chevronId) {
    const area = document.getElementById(areaId);
    const chevron = document.getElementById(chevronId);
    const nowOpen = !isVisible(area);
    setVisible(area, nowOpen);
    if (chevron) chevron.classList.toggle('is-open', nowOpen);
}

// 정적 HTML에 처음부터 있고 절대 다시 그려지지 않는 요소 목록 전용 캐시.
// (innerHTML로 다시 그려지는 요소에는 쓰면 안 된다 - 옛 노드를 계속 붙잡게 된다)
const _staticQueryCache = new Map();

function staticAll(selector) {
    if (!_staticQueryCache.has(selector)) _staticQueryCache.set(selector, Array.from(document.querySelectorAll(selector)));
    return _staticQueryCache.get(selector);
}

// requestAnimationFrame 스로틀: 프레임당 최대 한 번만 fn을 실행한다(resize/scroll 공용).
function rafThrottle(fn) {
    let scheduled = false;
    return (...args) => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; fn(...args); });
    };
}

// 같은 스로틀을 대상(key)별로 따로 적용한다(여러 사진 갤러리가 각자 스크롤될 때).
function rafThrottleByKey(fn) {
    const scheduled = new WeakSet();
    return (key, ...args) => {
        if (scheduled.has(key)) return;
        scheduled.add(key);
        requestAnimationFrame(() => { scheduled.delete(key); fn(key, ...args); });
    };
}

// 탭 + 뷰 전환 공용: tabs = { 키: [탭 id, 뷰 id] }. 활성 탭 표시/aria-selected/뷰 표시를 함께 맞춘다.
function activateTabView(tabs, activeKey) {
    Object.entries(tabs).forEach(([key, [tabId, viewId]]) => {
        const on = key === activeKey;
        const tab = document.getElementById(tabId);
        if (tab) {
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        setVisible(document.getElementById(viewId), on);
    });
}

function isTabActive(tabId) {
    const tab = document.getElementById(tabId);
    return !!tab && tab.classList.contains('active');
}

// 부트스트랩 모달 열기. new bootstrap.Modal()을 열 때마다 만들면 같은 요소에 인스턴스와
// 이벤트 리스너가 계속 쌓이므로(누수) 기존 인스턴스를 재사용한다.
function showModal(id) {
    const el = document.getElementById(id);
    if (el) bootstrap.Modal.getOrCreateInstance(el).show();
}

// 초기화 단계 하나가 실패해도(스크립트 로드 실패, 예상 못한 데이터 형태 등) 그 아래
// 단계들까지 통째로 멈추지 않도록 각 단계를 격리한다. async 함수가 넘어오면 반환된
// Promise의 실패까지 잡아서 "Uncaught (in promise)"로 새지 않게 한다.
function safeInit(label, fn) {
    const report = e => console.error(`${label} 초기화 중 오류가 발생했습니다:`, e);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') result.catch(report);
    } catch (e) {
        report(e);
    }
}

// role="button"/"tab"을 단 div/tr 등(네이티브 버튼이 아닌 클릭 요소)도 키보드
// Enter/Space로 누를 수 있게 한다. 마우스 클릭 동작에는 영향이 없다.
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!el || !el.matches || !el.matches('[role="button"], [role="tab"]')) return;
    if (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    e.preventDefault();
    el.click();
});

// =====================================================================
// 2. 사이트 데이터 (site_data.json)
// =====================================================================
// 멤버/매치/라운드/개인통계는 경기가 쌓일수록 계속 커지는 데이터라, HTML에 직접
// 박아넣지 않고 별도 JSON(data/site_data.json)에서 비동기로 fetch해온다.
const SiteData = {
    members: [],
    matches: [],
    rounds: [],
    playersStats: [],
};

const asArray = v => (Array.isArray(v) ? v : []);

// [캐시] 예전엔 매번 no-store로 받아서 브라우저 캐시를 전혀 못 썼다. 빌드가 index.html에 넣어준
// 버전(<meta name="site-data-version">)을 주소에 붙이면, 데이터가 바뀐 배포에서만 주소가 바뀌므로
// 평소엔 캐시를 그대로 쓰고 바뀌면 즉시 새로 받는다. 버전이 없으면(옛 index.html 등) 매번
// 서버에 변경 여부만 확인(no-cache → 안 바뀌었으면 304로 본문 없이 끝남)한다.
function siteDataRequest() {
    const meta = document.querySelector('meta[name="site-data-version"]');
    const version = meta && meta.content;
    return version
        ? { url: `data/site_data.json?v=${encodeURIComponent(version)}`, cache: 'default' }
        : { url: 'data/site_data.json', cache: 'no-cache' };
}

async function loadSiteData() {
    try {
        const { url, cache } = siteDataRequest();
        const res = await fetch(url, { cache });
        if (res.ok) {
            const data = await res.json();
            SiteData.members = asArray(data && data.members);
            SiteData.matches = asArray(data && data.matches);
            SiteData.rounds = asArray(data && data.rounds);
            SiteData.playersStats = asArray(data && data.playersStats);
        }
    } catch (e) {
        console.error('사이트 데이터를 불러오지 못했습니다:', e);
    }
}

function findMemberByName(name) {
    return SiteData.members.find(x => x['이름'] === name);
}

function findMemberBySoopId(soopId) {
    return SiteData.members.find(x => x['SOOP ID'] === soopId);
}

function findPlayerStats(name) {
    return SiteData.playersStats.find(x => x['이름'] === name) || {};
}

// =====================================================================
// 3. API 캐시 (SOOP 게시판/방송 상태 등)
// =====================================================================
// 홈/소식 화면 열 때마다 멤버 30명씩 SOOP API를 다시 호출하면 사용자가 몰릴 때
// 브라우저 쪽에서 API 호출 빈도 제한(Rate Limit)에 걸릴 수 있어, 세션 안에서는
// 짧은 시간 내 같은 요청을 재사용하도록 sessionStorage에 캐싱해둔다.
// [보강] ① 만료된 항목은 읽을 때 지운다(예전엔 세션 내내 쌓이기만 했다).
//        ② 저장 공간이 꽉 차면 캐시 항목을 비우고 한 번 더 시도한다.
//        ③ 같은 URL 요청이 이미 진행 중이면 새로 부르지 않고 그 결과를 같이 기다린다
//           (페이지 로드 직후 홈 "방송 중"과 멀티뷰어 LIVE 뱃지가 멤버 전원의 방송 상태를
//           동시에 조회해서 요청이 두 배로 나가던 문제).
const API_CACHE_PREFIX = 'apicache:';

const _inflightRequests = new Map();

function readApiCache(url, ttlMs) {
    const cacheKey = API_CACHE_PREFIX + url;
    try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return undefined;
        const entry = JSON.parse(raw);
        if (entry && typeof entry.ts === 'number' && Date.now() - entry.ts < ttlMs) return entry.data;
        sessionStorage.removeItem(cacheKey);
    } catch (e) { /* 캐시 읽기 실패는 무시하고 그냥 새로 받아온다 */ }
    return undefined;
}

function purgeApiCache() {
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(API_CACHE_PREFIX)) sessionStorage.removeItem(key);
        }
    } catch (e) { /* 무시 */ }
}

function writeApiCache(url, data) {
    const payload = JSON.stringify({ data, ts: Date.now() });
    try {
        sessionStorage.setItem(API_CACHE_PREFIX + url, payload);
    } catch (e) {
        // 저장 공간이 꽉 찼으면 오래된 캐시를 비우고 한 번만 재시도. 캐싱은 선택사항이라 실패해도 무시.
        purgeApiCache();
        try { sessionStorage.setItem(API_CACHE_PREFIX + url, payload); } catch (e2) { /* 무시 */ }
    }
}

async function cachedFetchJson(url, ttlMs) {
    const cached = readApiCache(url, ttlMs);
    if (cached !== undefined) return cached;
    if (_inflightRequests.has(url)) return _inflightRequests.get(url);

    const request = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('요청 실패: ' + res.status);
        const data = await res.json();
        writeApiCache(url, data);
        return data;
    })();
    _inflightRequests.set(url, request);
    try {
        return await request;
    } finally {
        _inflightRequests.delete(url);
    }
}

// =====================================================================
// 4. 공용 표시 헬퍼
// =====================================================================

// 승/패/무 결과 뱃지 HTML - 팀/개인 최근전적 리스트 공용
function resultBadgeHtml(resText) {
    if (resText === '승') return '<span class="match-badge badge-win">WIN</span>';
    if (resText === '무' || resText === '무승부') return '<span class="match-badge badge-draw">DRAW</span>';
    return '<span class="match-badge badge-lose">LOSE</span>';
}

const SOOP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidSoopId(soopId) {
    return !!soopId && SOOP_ID_PATTERN.test(String(soopId).trim());
}

function getProfileImgUrl(soopId) {
    if (!soopId) return null;
    const id = String(soopId).trim().toLowerCase();
    // SOOP 아이디는 영문/숫자/일부 특수문자만 쓰이므로, 형식이 이상한 값은 URL/속성에 꽂지 않고 무시
    if (!id || !/^[a-z0-9_-]+$/.test(id)) return null;
    const prefix = id.substring(0, 2);
    return `https://profile.img.sooplive.co.kr/LOGO/${prefix}/${id}/${id}.jpg`;
}

function avatarHtml(soopId, cls) {
    const url = getProfileImgUrl(soopId);
    if (!url) return `<span class="${cls} d-flex align-items-center justify-content-center">👤</span>`;
    return `<img src="${url}" class="${cls}" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'${cls} d-flex align-items-center justify-content-center\\'>👤</span>';">`;
}

// 프로필 카드(개인전적 상단/멤버 프로필 모달)의 큰 원형 아바타 내용
function profileAvatarInnerHtml(soopId) {
    const url = getProfileImgUrl(soopId);
    return url ? `<img src="${url}" alt="" onerror="this.parentElement.innerHTML='👤';">` : '👤';
}

// 상대팀 로고: docs/images/{팀이름}.webp 로 관리. '내전'(자체 스크림)은 상대가 우리 팀
// 자신이므로 캄몬스타즈.webp를 대신 쓴다(build_html.py의 team_logo_src 필터와 같은 규칙).
// 로고 파일이 없는 팀은 원형 배지에 팀 이름 첫 글자를 넣어 대신 보여준다.
function teamLogoFallback(imgEl, teamName) {
    const initial = String(teamName || '').trim().charAt(0) || '?';
    const span = document.createElement('span');
    span.className = 'team-logo-fallback';
    const w = imgEl.style.width, h = imgEl.style.height;
    if (w) span.style.width = w;
    if (h) span.style.height = h;
    const sizeNum = parseInt(w, 10);
    if (sizeNum) span.style.fontSize = Math.max(8, Math.round(sizeNum * 0.5)) + 'px';
    span.textContent = initial;
    imgEl.replaceWith(span);
}

// 서버에서 구운 페이지(전적의 상대 전적 표)의 로고는 이 스크립트보다 먼저 HTML에 있어서, 로고 파일이
// 없을 때(404) 이 함수가 정의되기 전에 onerror가 먼저 불릴 수 있다(특히 앞에 CDN 스크립트가 있는 페이지).
// 그 경우 onerror는 data-logo-failed 표시만 남기고, 이 파일이 로드되는 즉시 여기서 마저 처리한다.
// (예전 SPA에서는 전적 표가 처음엔 숨겨져 있어 로고를 늦게 불러오는 바람에 우연히 안 드러났던 경쟁 상태)
document.querySelectorAll('img[data-logo-failed]').forEach(img => teamLogoFallback(img, img.dataset.team));

function teamLogoHtml(teamName, sizePx) {
    const name = String(teamName || '').trim();
    if (!name) return '';
    const fileName = (name === '내전') ? '캄몬스타즈' : name;
    const size = sizePx || 16;
    // 팀 이름을 onerror 안의 JS 문자열로 직접 꽂지 않고 data 속성으로 넘긴다(이스케이프 문제 원천 차단).
    // 크기는 대체 배지(teamLogoFallback)가 그대로 물려받아야 해서 인라인으로 둔다.
    return `<img src="images/${encodeURIComponent(fileName)}.webp" alt="" class="team-logo-icon" loading="lazy" style="width:${size}px;height:${size}px;" data-team="${escapeHTML(name)}" onerror="teamLogoFallback(this, this.dataset.team)">`;
}

// 로고 + 팀 이름(말줄임) 묶음 - 팀/개인 전적 표 공용
function teamCellInnerHtml(teamName) {
    return `<span class="d-flex align-items-center justify-content-center gap-2">${teamLogoHtml(teamName)}<span class="ellipsis-text">${escapeHTML(teamName)}</span></span>`;
}

const TIER_ORDER = ['갓','킹','잭','조커','스페이드','0','1','2','3','4','5','6','7','8','베이비'];

function tierIndex(tier) {
    const idx = TIER_ORDER.indexOf(String(tier));
    return idx === -1 ? TIER_ORDER.length : idx;
}

function raceShortLabel(race) {
    if (!race) return '-';
    if (race.includes('테란')) return 'T';
    if (race.includes('저그')) return 'Z';
    if (race.includes('프로토스')) return 'P';
    return race;
}

// 종족 뱃지 클래스(T/Z/P별 색상)
function raceBadgeClass(race) {
    const letter = raceShortLabel(race);
    return ['T', 'Z', 'P'].includes(letter) ? ` race-badge race-${letter}` : '';
}

function raceBadgeHtml(race) {
    return `<span class="tag-badge${raceBadgeClass(race)}">${escapeHTML(raceShortLabel(race))}</span>`;
}

// 티어 표기(예: "3티어")를 멤버 카드/모달/개인전적 프로필에서 동일하게 사용
function tierLabel(tier) {
    return (tier !== undefined && tier !== null && tier !== '') ? `${tier}티어` : '티어 미정';
}

function tierBadgeHtml(tier) {
    return `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(tier))}</span>`;
}

// 뱃지 요소 하나에 텍스트/클래스를 채운다(개인전적 프로필, 멤버 프로필 모달 공용)
function applyBadge(el, text, className) {
    if (!el) return;
    el.textContent = text;
    el.className = className;
}

// 직책 뱃지 색상: 자주 쓰는 직책은 고정 색상, 그 외(전력분석관 등 임의의 직책)는
// 단일 그레이 톤으로 통일 - 종족 뱃지 색과 겹치지 않도록 선수는 진한 네이비를 사용
const ROLE_COLOR_FIXED = {
    '감독': '#c62828',
    '코치': '#2e7d32',
    '선수': '#0d47a1',
};

const ROLE_COLOR_FALLBACK = '#78909c';

function roleColor(role) {
    if (!role) return '#9e9e9e';
    return ROLE_COLOR_FIXED[role] || ROLE_COLOR_FALLBACK;
}

function isActiveMember(m) {
    return !m['퇴단일'] || String(m['퇴단일']).trim() === '';
}

// 방송중 체크/소식 피드 등 SOOP API를 부르는 화면들이 공통으로 쓰는 대상:
// 활동중이면서 SOOP ID 형식이 유효한 멤버만 추려낸다.
function activeMembersWithSoopId() {
    return SiteData.members.filter(m => isActiveMember(m) && isValidSoopId(m['SOOP ID']));
}

// 오늘 날짜(YYYY-MM-DD, 로컬 기준). 예전엔 toISOString()(UTC 기준)이라 한국 시간 0~9시에는 어제
// 날짜가 나와 "활동 N일째"가 하루 적게 보였다. (calendar.js를 안 쓰는 페이지에서도 쓰이므로 자체 구현)
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.floor((end - start) / 86400000) + 1;
}

// 아바타 선택 바(개인 전적/멤버 공지 상단)의 항목 한 칸 - 두 화면이 같은 마크업을 쓴다.
function avatarSelectItemHtml(idPrefix, name, soopId, onclickFn) {
    return `<div class="avatar-select-item" id="${idPrefix}${escapeHTML(name)}" role="button" tabindex="0" onclick="${onclickFn}('${jsAttr(name)}')">
                            ${avatarHtml(soopId, 'avatar-select-img')}
                            <span class="avatar-select-name">${escapeHTML(name)}</span>
                        </div>`;
}

// 아바타 선택 바 맨 앞의 "전체" 항목
function avatarSelectAllItemHtml(id, onclickJs) {
    return `<div class="avatar-select-item avatar-select-all active" id="${id}" role="button" tabindex="0" onclick="${onclickJs}">
                            <img src="images/캄몬스타즈.webp" alt="전체" class="avatar-select-img" onerror="this.outerHTML='&lt;div class=&quot;avatar-select-fallback&quot;&gt;전체&lt;/div&gt;';">
                            <span class="avatar-select-name">전체</span>
                       </div>`;
}

// 아바타 선택 바에서 하나만 활성 표시
function setActiveAvatarItem(listId, activeEl) {
    document.querySelectorAll(`#${listId} .avatar-select-item`).forEach(el => el.classList.remove('active'));
    if (activeEl) activeEl.classList.add('active');
}

// =====================================================================
// 5. 방송통계 데이터 (ststats 외부 데이터에서 우리 로스터만 추림 - 방송통계 표, 멤버 프로필 공용)
// =====================================================================
const STSTATS_BASE = 'https://ststats.github.io/synergy';

const SynergyState = {
    data: null,          // [{ ...외부 필드, ourMember, active }]
    updatedAt: '',
    failed: false,
    metric: 'balloons',
};

function formatSecondsToHM(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}시간 ${m}분`;
}

function formatCount(value, unit) {
    return (value || 0).toLocaleString('ko-KR') + unit;
}

function formatSponsorRecord(wins, losses) {
    wins = wins || 0;
    losses = losses || 0;
    const total = wins + losses;
    const rate = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
    return `${wins}승 ${losses}패 (${rate}%)`;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 모달이 닫히기 시작할 때 그 안에 포커스가 남아있으면 부트스트랩이 aria-hidden을 씌우면서
// 크롬 접근성 경고가 뜬다. 닫히기 직전에 포커스를 미리 빼주면 경고 자체가 안 뜬다.
staticAll('.modal').forEach(modalEl => {
    modalEl.addEventListener('hide.bs.modal', () => {
        if (modalEl.contains(document.activeElement)) document.activeElement.blur();
    });
});

// 방송통계 데이터를 한 번만 받아온다(여러 곳에서 불러도 요청은 1번). 실패하면 다음 호출 때 다시 시도.
let _synergyRequest = null;
function fetchSynergyData() {
    if (_synergyRequest) return _synergyRequest;
    _synergyRequest = (async () => {
        const datesRes = await fetch(`${STSTATS_BASE}/data/dates.js`, { cache: 'no-cache' });
        if (!datesRes.ok) throw new Error(`dates.js HTTP ${datesRes.status}`);
        const datesText = await datesRes.text();
        const match = datesText.match(/window\.AVAILABLE_DATES\s*=\s*(\[[^\]]*\])/);
        if (!match) throw new Error('날짜 목록 형식을 읽을 수 없습니다.');
        const dates = JSON.parse(match[1]);
        const latestDate = Array.isArray(dates) ? dates[0] : null;
        if (!latestDate) throw new Error('사용 가능한 날짜가 없습니다.');

        const dataRes = await fetch(`${STSTATS_BASE}/data/daily/${encodeURIComponent(latestDate)}.json`, { cache: 'no-cache' });
        if (!dataRes.ok) throw new Error(`daily json HTTP ${dataRes.status}`);
        const data = await dataRes.json();

        // team 이름이 아니라 SOOP ID로 매칭한다 - 외부 쪽 team 표기가 우리 쪽 개편
        // (예: 캄몬스타즈 -> 스타대학)과 항상 동기화된다는 보장이 없기 때문.
        const idToMember = new Map();
        SiteData.members.forEach(m => {
            const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
            if (soopId) idToMember.set(soopId, m);
        });
        SynergyState.data = asArray(data && data.members)
            .map(m => {
                const ours = idToMember.get(String((m && m.id) || '').trim().toLowerCase());
                return ours ? { ...m, ourMember: ours, active: isActiveMember(ours) } : null;
            })
            .filter(Boolean);
        SynergyState.updatedAt = (data && data.updated_at) || '';
        SynergyState.failed = false;
        return SynergyState.data;
    })();
    _synergyRequest.catch(() => { SynergyState.failed = true; _synergyRequest = null; });
    return _synergyRequest;
}

// =====================================================================
// 6. 페이지 상태(URL 쿼리) / 페이지 시작
// =====================================================================

// 페이지 안의 하위 상태(선택 탭, 선택한 멤버 등)를 현재 경로의 쿼리로 반영한다.
// 뒤로가기/앞으로가기(popstate)로 화면을 되살리는 동안(restoring)에는 새 기록을 쌓지 않고
// 현재 기록만 고쳐 쓴다 - 앞으로가기 기록이 지워지거나 기록이 겹겹이 쌓이는 것을 막는다.
const PageState = {
    restoring: false,
    update(params) {
        const qs = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => { if (v) qs.set(k, v); });
        const qsStr = qs.toString();
        const url = location.pathname + (qsStr ? '?' + qsStr : '');
        if (url === location.pathname + location.search) return;
        if (this.restoring) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
    },
    // restore(params)를 지금 한 번(첫 진입/새로고침) + 뒤로·앞으로 갈 때마다 실행한다.
    bindRestore(restore) {
        const run = () => {
            this.restoring = true;
            try { restore(new URLSearchParams(location.search)); } finally { this.restoring = false; }
        };
        window.addEventListener('popstate', run);
        run();
    },
};

// 페이지 시작: 사이트 데이터(멤버/경기 등)를 먼저 불러온 뒤 페이지별 초기화를 실행한다.
// 이 스크립트들은 body 맨 끝에서 실행되므로 DOM은 이미 준비돼 있지만, 순서를 확실히 하려고
// DOMContentLoaded에 맞춘다(이미지 로딩까지 기다리는 window.onload보다 빠르다).
function bootPage(init) {
    const start = async () => {
        await loadSiteData();
        safeInit('페이지', init);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}
