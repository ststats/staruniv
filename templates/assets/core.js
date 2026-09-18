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

// [리디자인] 모바일 상단바 서랍. 열림 상태는 <header>에 클래스로 붙여서 CSS가 그린다.
// 메뉴를 누르면(페이지 이동) 자동으로 닫히고, 화면이 넓어지면 열림 상태를 지운다.
function toggleMainMenu(force) {
    const bar = document.querySelector('.top-navbar');
    const btn = document.getElementById('navDrawerBtn');
    if (!bar) return;
    const open = typeof force === 'boolean' ? force : !bar.classList.contains('menu-open');
    bar.classList.toggle('menu-open', open);
    if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    }
}
document.addEventListener('click', (e) => {
    const bar = document.querySelector('.top-navbar');
    if (!bar || !bar.classList.contains('menu-open')) return;
    // 메뉴 항목을 눌렀거나 상단바 밖을 눌렀으면 닫는다
    if (e.target.closest('.nav-menu .nav-item') || !e.target.closest('.top-navbar')) toggleMainMenu(false);
});
window.addEventListener('resize', () => { if (window.innerWidth > 767.98) toggleMainMenu(false); });

// 사용자가 고른 테마는 다음 방문에도 유지한다. 시스템 설정은 첫 방문의 기본값으로만 쓴다.
function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.bsTheme = dark ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        const selected = button.dataset.themeChoice === (dark ? 'dark' : 'light');
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}
function setTheme(theme) { localStorage.setItem('staruniv-theme', theme); applyTheme(theme); }
try {
    applyTheme(localStorage.getItem('staruniv-theme') ||
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
} catch (_) { applyTheme('light'); }
// (전적 페이지의 아바타 바, 멤버 페이지의 이전 멤버 목록 양쪽에서 쓴다)
// "이전 멤버" 접기/펼치기 공용: 대상 영역 표시 + 쉐브론 회전
function toggleCollapsible(areaId, chevronId) {
    const area = document.getElementById(areaId);
    const chevron = document.getElementById(chevronId);
    const nowOpen = !isVisible(area);
    setVisible(area, nowOpen);
    if (chevron) chevron.classList.toggle('is-open', nowOpen);
    return nowOpen;
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

// 선택 사이드바가 탭 전환 시 늦게 만들어져도 LIVE 표시를 채운다.
async function refreshSidebarLiveIndicators() {
    if (typeof checkIsLiveRealtime !== 'function') return;
    const dots = Array.from(document.querySelectorAll('.avatar-select-live[data-soop-id]'));
    if (!dots.length) return;
    const ids = [...new Set(dots.map(dot => dot.dataset.soopId).filter(Boolean))];
    const update = (id, live) => {
        document.querySelectorAll('.avatar-select-live[data-soop-id]').forEach(dot => {
            if (dot.dataset.soopId === id) dot.hidden = !live;
        });
    };
    // 티어표와 같은 일괄 조회를 사용한다. 개별 SOOP 요청 하나가 지연되어도
    // 전체 사이드바가 Promise.all 종료를 기다리며 빈 상태로 남지 않는다.
    try {
        const res = await fetch(`https://synergy.ststats.workers.dev/?ids=${encodeURIComponent(ids.join(','))}`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`Live status: ${res.status}`);
        const data = await res.json();
        if (!data || typeof data.live !== 'object' || data.live === null) throw new Error('Invalid live status');
        const live = new Set(Object.entries(data.live).filter(([, info]) => info && info.broad_no).map(([id]) => id.toLowerCase()));
        ids.forEach(id => update(id, live.has(id.toLowerCase())));
    } catch (_) {
        await Promise.allSettled(ids.map(async id => update(id, Boolean(await checkIsLiveRealtime(id)))));
    }
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
// [리디자인] WIN/LOSE/DRAW 세 글자를 W/L/D 한 글자로 줄였다. 이 뱃지가 종족 뱃지(20x20)와
// 같은 가족이 되려면 폭이 비슷해야 하는데, 세 글자는 36px을 먹어서 늘 혼자 커 보였다.
// 원래 글자는 title로 남겨둔다(마우스를 올리면 승/패/무가 뜬다).
function resultBadgeHtml(resText) {
    if (resText === '승') return '<span class="match-badge badge-win" title="승">W</span>';
    if (resText === '무' || resText === '무승부') return '<span class="match-badge badge-draw" title="무">D</span>';
    return '<span class="match-badge badge-lose" title="패">L</span>';
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
// [리디자인] 선택 사이드바의 한 줄 구성은 시안대로 [종족 뱃지][이름][방송 표시][티어]다.
// 프로필 사진을 쓰지 않는 이유: 40명을 세로로 훑을 때 필요한 건 "누가 무슨 종족 몇 티어인지"이고,
// 24px 사진은 그 정보를 주지 못하면서 줄 높이만 먹는다. 종족은 왼쪽 엣지 색으로도 한 번 더 읽힌다.
// member는 SiteData의 멤버 객체(없으면 이름만 그린다).
function avatarSelectItemHtml(idPrefix, name, soopId, onclickFn, member) {
    const m = member || {};
    const race = m['종족'] || '';
    const letter = raceShortLabel(race);
    const edgeClass = ['T', 'Z', 'P'].includes(letter) ? ` edge-${letter}` : '';
    const tierText = tierLabel(m['티어'] || '').replace('티어', '');
    return `<div class="avatar-select-item${edgeClass}" id="${idPrefix}${escapeHTML(name)}" role="button" tabindex="0" onclick="${onclickFn}('${jsAttr(name)}')">
                            ${race ? raceBadgeHtml(race) : ''}
                            <span class="avatar-select-name">${escapeHTML(name)}</span>
                            <span class="avatar-select-live" data-soop-id="${escapeHTML(soopId || '')}" hidden></span>
                            <span class="avatar-select-tier">${escapeHTML(tierText)}</span>
                        </div>`;
}

// 아바타 선택 바 맨 앞의 "전체" 항목
// [리디자인] '전체' 줄. 시안에서는 사진 없이 "전체 · 인원수" 한 줄이고, 목록과 구분선으로만
// 나뉜다. 로고 이미지를 쓰면 아래 멤버 줄(종족 뱃지)과 왼쪽 기준선이 어긋난다.
function avatarSelectAllItemHtml(id, onclickJs, countText) {
    return `<div class="avatar-select-item avatar-select-all active" id="${id}" role="button" tabindex="0" onclick="${onclickJs}">
                            <span class="avatar-select-name">전체</span>
                            <span class="avatar-select-tier">${escapeHTML(countText || '')}</span>
                       </div>`;
}

// 아바타 선택 바를 티어 바와 같은 구조로 그린다:
//   .avatar-bar > [ .avatar-bar-tools('전체') , .avatar-selector-scroll > .avatar-selector-list(나머지) ]
// '전체'를 목록 안에 두면 같이 가로로 흘러가버린다. 붙잡아 두려고 sticky를 걸고 뒤를
// 가상 요소로 가리는 방법을 써봤지만, 알약의 둥근 모서리로 뒤 칩이 비치고 목록 여백만큼
// 밀리는 문제가 남았다. 스크롤되는 영역 밖으로 꺼내면 가릴 것도 붙잡을 것도 없어진다.
// 가로 스크롤 막대는 .avatar-selector-scroll에 걸린 공용 스타일(.scroll-area)이 그린다.
// 템플릿이 아니라 여기서 감싸는 이유: 이 바를 쓰는 페이지가 둘(멤버 공지/개인 전적)인데,
// 템플릿을 각각 고치는 것보다 목록 요소 하나만 알면 되는 이 방식이 손이 덜 간다.
function renderAvatarBar(listId, allItemHtml, itemsHtml) {
    const list = document.getElementById(listId);
    if (!list) return;
    avatarBarTools(list).querySelector('.bar-scope').innerHTML = allItemHtml;
    list.innerHTML = itemsHtml;
}

// 바 구조를 한 번만 만들고, 그 다음부터는 만들어 둔 '전체' 칸을 그대로 돌려준다.
function avatarBarTools(list) {
    const scroll = list.parentElement;
    const parent = scroll.parentElement;
    if (parent && parent.classList.contains('avatar-bar')) {
        return parent.querySelector('.avatar-bar-tools');
    }
    const bar = document.createElement('div');
    bar.className = 'avatar-bar';
    const tools = document.createElement('div');
    tools.className = 'avatar-bar-tools';
    // '전체'는 티어 바의 보기 전환과 같은 컨트롤 박스(.bar-scope) 안에 들어간다 -
    // 두 바의 왼쪽 고정 칸이 같은 크기(34px)가 되어 바 높이까지 똑같아진다.
    const scope = document.createElement('div');
    scope.className = 'bar-scope';
    tools.appendChild(scope);
    // [리디자인] 모바일(<=920px)에서만 보이는 '현재 선택' 줄. 누르면 같은 목록이 아래로
    // 펼쳐진다. 좁은 화면에서 40명을 가로로 밀게 하는 대신, 한 줄만 두고 필요할 때만
    // 목록을 꺼내는 쪽이 본문을 덜 가린다. 데스크톱에서는 CSS가 숨긴다.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'avatar-bar-pick';
    pick.setAttribute('aria-expanded', 'false');
    pick.innerHTML = '<span class="avatar-bar-pick-label">전체</span>'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" '
        + 'stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    pick.addEventListener('click', () => {
        const closed = bar.classList.toggle('is-closed');
        pick.setAttribute('aria-expanded', closed ? 'false' : 'true');
    });
    bar.classList.add('is-closed');
    bar.appendChild(pick);
    scroll.replaceWith(bar);   // 껍데기가 있던 자리에 바를 놓고
    bar.appendChild(tools);    // 그 안에 '전체' 칸과
    bar.appendChild(scroll);   // 원래 껍데기를 차례로 넣는다
    return tools;
}

// 아바타 선택 바에서 하나만 활성 표시.
// '전체'는 목록 밖(.avatar-bar-tools)에 있으므로 목록이 아니라 바 전체에서 지운다 -
// 목록 안만 지우면 멤버를 골라도 '전체'가 계속 눌린 것처럼 남는다.
function setActiveAvatarItem(listId, activeEl) {
    const list = document.getElementById(listId);
    const scope = list && (list.closest('.avatar-bar') || list);
    if (scope) scope.querySelectorAll('.avatar-select-item').forEach(el => el.classList.remove('active'));
    if (activeEl) activeEl.classList.add('active');

    // [리디자인] 모바일 선택 줄에 지금 고른 이름을 반영하고, 골랐으면 목록을 접는다.
    const bar = scope && scope.closest ? scope.closest('.avatar-bar') : null;
    if (!bar) return;
    const pick = bar.querySelector('.avatar-bar-pick');
    if (!pick) return;
    const label = pick.querySelector('.avatar-bar-pick-label');
    const name = activeEl && activeEl.querySelector('.avatar-select-name');
    if (label) label.textContent = name ? name.textContent.trim() : '전체';
    bar.classList.add('is-closed');
    pick.setAttribute('aria-expanded', 'false');
}


// ---------------------------------------------------------------------------
// 얇은 줄(서브탭 / 필터 / GNB)의 가로 스크롤 끝 흐림 - 스크롤 패턴 [C]
// ---------------------------------------------------------------------------
// 높이가 24~44px인 줄에는 스크롤 손잡이를 넣을 자리가 없다. 그렇다고 네이티브
// 스크롤바를 그냥 숨겨두면(예전 상태) 좁은 화면에서 탭이 잘려 있다는 걸 알 방법이
// 없었다. 넘치는 쪽 끝을 흐리게 해서 "저쪽에 더 있다"를 보여준다.
// 흐림 자체는 CSS(.tab-scroll.is-fade-*)가 그리고, 여기서는 지금 스크롤 위치가
// 양 끝인지 아닌지만 판단해 클래스를 토글한다(CSS는 스크롤 위치를 모른다).
function attachEdgeFade(el) {
    if (!el) return null;
    if (el._edgeFadeUpdate) return el._edgeFadeUpdate;

    const update = () => {
        const max = el.scrollWidth - el.clientWidth;
        // 소수점 오차(브라우저 확대/기기 배율)로 끝에 닿아도 1px쯤 남는 경우가 있어 여유를 둔다.
        el.classList.toggle('is-fade-start', el.scrollLeft > 1);
        el.classList.toggle('is-fade-end', max > 1 && el.scrollLeft < max - 1);
    };
    el.addEventListener('scroll', update, { passive: true });

    // 숨어 있는 탭(d-none) 안의 줄은 폭이 0으로 재져서 "넘치지 않는다"로 판단된다.
    // resize 이벤트만 듣고 있으면 그 줄이 처음 보여질 때 흐림이 안 생긴다 - 요소
    // 크기가 바뀌는 순간을 직접 보는 ResizeObserver가 이 경우까지 한 번에 해결한다.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
    else window.addEventListener('resize', update);

    el._edgeFadeUpdate = update;
    update();
    return update;
}

// .tab-scroll이 붙은 줄은 페이지마다 따로 챙기지 않고 여기서 한 번에 처리한다.
function initEdgeFades(root) {
    (root || document).querySelectorAll('.tab-scroll').forEach(attachEdgeFade);
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

// ---------------------------------------------------------------------------
// 상단 메뉴 표시/숨김 (docs/data/nav.json - 어드민 페이지에서 관리)
// ---------------------------------------------------------------------------
// 메뉴는 빌드 타임에 HTML로 박히므로(build_html.py가 nav.json을 읽어 hidden을 붙인다)
// 평소엔 이 함수가 할 일이 없다. 이 함수가 필요한 이유는 어드민에서 저장한 직후다 -
// 다음 빌드(데이터 갱신 워크플로)까지 기다리지 않고 바로 반영되게 한다.
// 실패하면(파일 없음/깨짐/오프라인) 아무것도 건드리지 않는다 - 메뉴가 사라지는 쪽보다
// HTML에 이미 박혀 있는 상태를 그대로 두는 쪽이 안전한 실패다.
// 숨긴 방송통계 지표 탭. nav.json을 읽기 전에는 비어 있다(= 아무것도 숨기지 않음).
let HiddenStatsTabs = new Set();
const isStatsTabHidden = key => HiddenStatsTabs.has(String(key));

async function applyNavVisibility() {
    try {
        const res = await fetch('data/nav.json', { cache: 'no-cache', signal: AbortSignal.timeout(3500) });
        if (!res.ok) return;
        const data = await res.json();
        if (!data || typeof data !== 'object') return;
        if (Array.isArray(data.hidden)) {
            const hidden = new Set(data.hidden.map(String));
            document.querySelectorAll('.top-navbar .nav-item[data-page]').forEach(el => {
                el.hidden = hidden.has(el.dataset.page);
            });
            const menu = document.getElementById('mainMenu');
            if (menu && menu._edgeFadeUpdate) menu._edgeFadeUpdate();
        }
        // 방송통계 지표 탭(별풍선·방송시간·…)도 같은 파일에서 끈다. 빌드 때 이미 hidden이
        // 붙어 있지만, 어드민에서 방금 저장한 걸 다음 빌드까지 기다리지 않고 바로 반영한다.
        HiddenStatsTabs = new Set((Array.isArray(data.statsTabs) ? data.statsTabs : []).map(String));
        document.querySelectorAll('#synergy-metric-filter .sub-tab[data-metric]').forEach(el => {
            el.hidden = HiddenStatsTabs.has(el.dataset.metric);
        });
        // 켜져 있던 탭이 숨겨졌으면 보이는 탭으로 옮긴다(방송통계 페이지에서만 있는 함수).
        if (typeof syncStatsMetricVisibility === 'function') syncStatsMetricVisibility();
    } catch (_) {
        // 실패하면 빌드에 저장된 메뉴 상태를 유지한다.
    } finally {
        delete document.documentElement.dataset.navPending;
    }
}

// 페이지 시작: 사이트 데이터(멤버/경기 등)를 먼저 불러온 뒤 페이지별 초기화를 실행한다.
// 이 스크립트들은 body 맨 끝에서 실행되므로 DOM은 이미 준비돼 있지만, 순서를 확실히 하려고
// DOMContentLoaded에 맞춘다(이미지 로딩까지 기다리는 window.onload보다 빠르다).
function bootPage(init) {
    const start = async () => {
        // 상단 메뉴/서브탭은 데이터와 무관하게 이미 그려져 있으니, 데이터를 기다리지 않고
        // 먼저 붙인다(ResizeObserver가 이후 변화를 알아서 따라간다).
        initEdgeFades();
        applyNavVisibility();   // 메뉴는 사이트 데이터와 무관하므로 기다리지 않는다
        await loadSiteData();
        safeInit('페이지', init);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}
