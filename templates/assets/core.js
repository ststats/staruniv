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

// 외부/DB 원본 텍스트를 innerHTML에 꽂을 때 깨지거나 마크업이 섞이지 않도록 이스케이프
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
    return `<div class="content-state${extraClass ? ' ' + extraClass : ''}">${escapeHTML(text)}</div>`;
}

// 표(tbody) 안에서 쓰는 안내 문구 <tr>
function emptyRowHtml(colspan, text, cellClass) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted ${cellClass || 'py-4'}">${text}</td></tr>`;
}

const EMPTY_MATCH_ROW_HTML = emptyRowHtml(6, '경기 기록이 없습니다');

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

// 모달·접기: 예전엔 부트스트랩 JS(80KB)를 받아 이 두 가지만 썼다. 같은 클래스(.modal .show
// .modal-backdrop .collapsing)와 같은 속성(data-bs-dismiss, data-bs-toggle="collapse")을 그대로
// 쓰므로 모양과 동작은 같다. CSS는 style/00-vendor-bootstrap.css에 있다.
const UI_FADE_MS = 300;
let openModalEl = null;
let modalBackdrop = null;

function afterTransition(el, fn) {
    let done = false;
    const finish = () => { if (done) return; done = true; el.removeEventListener('transitionend', finish); fn(); };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, UI_FADE_MS + 50);   // 애니메이션을 끈 환경에서는 transitionend가 안 온다
}

function showModal(id) {
    const el = document.getElementById(id);
    if (!el || el === openModalEl) return;
    if (openModalEl) hideModal(openModalEl, true);
    openModalEl = el;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    if (!modalBackdrop) {
        modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop fade';
        document.body.appendChild(modalBackdrop);
        void modalBackdrop.offsetWidth;
        modalBackdrop.classList.add('show');
    }
    el.style.display = 'block';
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    void el.offsetWidth;
    el.classList.add('show');
    afterTransition(el, () => { if (openModalEl === el) el.focus({ preventScroll: true }); });
}

function hideModal(el, keepBackdrop) {
    if (!el || !el.classList.contains('show')) return;
    // 모달 안에 포커스가 남은 채로 aria-hidden을 씌우면 크롬 접근성 경고가 뜬다 - 먼저 뺀다
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.remove('show');
    if (openModalEl === el) openModalEl = null;
    afterTransition(el, () => {
        if (el.classList.contains('show')) return;
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
        el.removeAttribute('aria-modal');
        el.removeAttribute('role');
    });
    if (keepBackdrop || !modalBackdrop) return;
    const backdrop = modalBackdrop;
    modalBackdrop = null;
    backdrop.classList.remove('show');
    afterTransition(backdrop, () => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
}

function toggleCollapse(target, trigger) {
    if (!target || target.classList.contains('collapsing')) return;
    const opening = !target.classList.contains('show');
    if (trigger) {
        trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
        trigger.classList.toggle('collapsed', !opening);
    }
    if (opening) {
        target.classList.remove('collapse');
        target.classList.add('collapsing');
        target.style.height = '0px';
        void target.offsetHeight;
        target.style.height = `${target.scrollHeight}px`;
    } else {
        target.style.height = `${target.getBoundingClientRect().height}px`;
        void target.offsetHeight;
        target.classList.add('collapsing');
        target.classList.remove('collapse', 'show');
        target.style.height = '0px';
    }
    afterTransition(target, () => {
        target.classList.remove('collapsing');
        target.classList.add('collapse');
        if (opening) target.classList.add('show');
        target.style.height = '';
    });
}

document.addEventListener('click', ev => {
    const dismiss = ev.target.closest('[data-bs-dismiss="modal"]');
    if (dismiss) { hideModal(dismiss.closest('.modal')); return; }
    // 대화상자 바깥(어두운 바탕)을 누르면 닫는다
    if (openModalEl && ev.target === openModalEl) { hideModal(openModalEl); return; }
    const toggle = ev.target.closest('[data-bs-toggle="collapse"]');
    if (toggle) {
        ev.preventDefault();
        toggleCollapse(document.querySelector(toggle.dataset.bsTarget || toggle.getAttribute('href')), toggle);
    }
});
document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && openModalEl) hideModal(openModalEl);
});

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
// 2. 페이지별 사이트 데이터
// =====================================================================
// 멤버/매치/라운드/개인통계는 경기가 쌓일수록 계속 커지는 데이터라, HTML에 직접
// 박아넣지 않고 shell/records JSON에서 필요한 묶음만 비동기로 가져온다.
const SiteData = {
    members: [],
    matches: [],
    rounds: [],
    playersStats: [],
    matchCount: 0,
    roundCount: 0,
};

// 페이지 초기화는 데이터 요청 실패 뒤에도 계속되어야 한다. 화면이 빈 데이터와 요청 실패를
// 구분할 수 있도록 결과 상태만 따로 남긴다(기존 SiteData 배열 사용 방식은 유지한다).
const SiteDataLoad = { status: 'idle', error: null, loaded: new Set() };

const asArray = v => (Array.isArray(v) ? v : []);

// [캐시] 예전엔 매번 no-store로 받아서 브라우저 캐시를 전혀 못 썼다. 빌드가 index.html에 넣어준
// 버전(<meta name="site-data-version">)을 주소에 붙이면, 데이터가 바뀐 배포에서만 주소가 바뀌므로
// 평소엔 캐시를 그대로 쓰고 바뀌면 즉시 새로 받는다. 버전이 없으면(옛 index.html 등) 매번
// 서버에 변경 여부만 확인(no-cache → 안 바뀌었으면 304로 본문 없이 끝남)한다.
function siteDataRequest(part) {
    const meta = document.querySelector('meta[name="site-data-version"]');
    const version = meta && meta.content;
    return version
        ? { url: `data/site_${part}.json?v=${encodeURIComponent(version)}`, cache: 'default' }
        : { url: `data/site_${part}.json`, cache: 'no-cache' };
}

// Supabase는 한 번에 1000줄까지만 준다. 1000줄씩 끊어 받는 조회를 한 쪽씩 기다리지 않고
// 여러 쪽(parallel, 표 크기에 맞춰 고른다)을 동시에 요청한다 - 8천 줄이면 8번 차례로 기다리던 게 1번이 된다.
// 끝을 넘은 쪽은 빈 목록으로 오므로 그대로 멈추면 된다.
// makeQuery(from, to)는 .range(from, to)까지 붙인 요청(또는 {data, error}를 주는 Promise)을 돌려준다.
async function fetchAllPages(makeQuery, { pageSize = 1000, parallel = 2 } = {}) {
    const rows = [];
    for (let from = 0; ; from += pageSize * parallel) {
        const results = await Promise.all(Array.from({ length: parallel }, (_, i) => {
            const start = from + i * pageSize;
            return makeQuery(start, start + pageSize - 1);
        }));
        for (const { data, error } of results) {
            if (error) throw error;
            const batch = Array.isArray(data) ? data : [];
            rows.push(...batch);
            if (batch.length < pageSize) return rows;
        }
    }
}

async function loadSiteData(parts) {
    const requested = (Array.isArray(parts) ? parts : ['shell'])
        .filter(part => !SiteDataLoad.loaded.has(part));
    if (!requested.length) return;
    SiteDataLoad.status = 'loading';
    SiteDataLoad.error = null;
    try {
        const payloads = await Promise.all(requested.map(async part => {
            const { url, cache } = siteDataRequest(part);
            const res = await fetch(url, { cache });
            if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
            return [part, await res.json()];
        }));
        payloads.forEach(([part, data]) => {
            if (part === 'shell') {
                SiteData.members = asArray(data && data.members);
                SiteData.matchCount = Number(data && data.matchCount) || 0;
                SiteData.roundCount = Number(data && data.roundCount) || 0;
            } else if (part === 'records') {
                SiteData.matches = asArray(data && data.matches);
                SiteData.rounds = asArray(data && data.rounds);
                SiteData.playersStats = asArray(data && data.playersStats);
            }
            SiteDataLoad.loaded.add(part);
        });
        SiteDataLoad.status = 'loaded';
    } catch (e) {
        SiteDataLoad.status = 'error';
        SiteDataLoad.error = e;
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
        const pending = ids.slice();
        const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
            while (pending.length) {
                const id = pending.shift();
                update(id, Boolean(await checkIsLiveRealtime(id)));
            }
        });
        await Promise.allSettled(workers);
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
    const res = String(resText == null ? '' : resText).trim();
    if (res === '승') return '<span class="match-badge badge-win" title="승">W</span>';
    if (res === '무' || res === '무승부') return '<span class="match-badge badge-draw" title="무">D</span>';
    if (res === '패') return '<span class="match-badge badge-lose" title="패">L</span>';
    // DB에 결과가 아직 안 적혔거나 오타인 경기. 예전에는 무조건 '패'로 나와서
    // 집계(승패 계산에서는 빠진다)와 화면이 어긋났다.
    return '<span class="match-badge badge-draw" title="결과 미기재">-</span>';
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
    return `https://stimg.sooplive.com/LOGO/${prefix}/${id}/m/${id}.webp`;
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

// 상대팀 로고: teamLogoSrc(아래). '내전'(자체 스크림)은 상대가 우리 팀 자신이므로 캄몬스타즈 로고를 쓴다.
// 로고가 없는 팀은 원형 배지에 팀 이름 첫 글자를 넣어 대신 보여준다.
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

// 대학 로고 주소. 어드민(티어표 > 대학 로고)에서 올린 로고는 Supabase(university_logos 표 + Storage)에
// 있고 시너지와 같이 쓴다. 페이지를 열 때 bootPage가 목록을 받아 두며, 목록에 없으면 예전 정적 파일을 쓴다.
const TeamLogos = { map: {} };
const LOGO_CACHE_KEY = 'staruniv-logos-v1';
function teamLogoSrc(name) {
    return TeamLogos.map[name] || `images/${encodeURIComponent(name)}.webp`;
}
function setTeamLogos(rows) {
    const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
    const base = String(cfg.url || '').replace(/\/$/, '');
    const map = {};
    (Array.isArray(rows) ? rows : []).forEach(r => {
        if (r && r.name && r.path) map[r.name] = `${base}/storage/v1/object/public/staruniv-media/${r.path}`;
    });
    TeamLogos.map = map;
}
async function loadTeamLogos() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || 'null'); } catch (_) {}
    const fresh = (async () => {
        const client = publicSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from('university_logos').select('name,path');
        if (error) throw error;
        try { localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(data || [])); } catch (_) {}
        return data || [];
    })();
    // 전에 받아 둔 목록이 있으면 바로 쓰고 새 목록은 뒤에서 받는다(다음 화면부터 반영)
    if (Array.isArray(cached)) {
        setTeamLogos(cached);
        fresh.catch(e => console.warn('대학 로고 목록을 새로 받지 못했습니다.', e));
        return;
    }
    try { setTeamLogos(await fresh); }
    catch (e) { console.warn('대학 로고 목록을 불러오지 못했습니다. 기본 로고 파일을 씁니다.', e); }
}

function teamLogoHtml(teamName, sizePx) {
    const name = String(teamName || '').trim();
    if (!name) return '';
    const fileName = (name === '내전') ? '캄몬스타즈' : name;
    const size = sizePx || 16;
    // 팀 이름을 onerror 안의 JS 문자열로 직접 꽂지 않고 data 속성으로 넘긴다(이스케이프 문제 원천 차단).
    // 크기는 대체 배지(teamLogoFallback)가 그대로 물려받아야 해서 인라인으로 둔다.
    return `<img src="${escapeHTML(teamLogoSrc(fileName))}" alt="" class="team-logo-icon" loading="lazy" style="width:${size}px;height:${size}px;object-fit:contain;" data-team="${escapeHTML(name)}" onerror="teamLogoFallback(this, this.dataset.team)">`;
}

// 로고 + 팀 이름(말줄임) 묶음 - 팀/개인 전적 표 공용
function teamCellInnerHtml(teamName) {
    return `<span class="d-flex align-items-center justify-content-center gap-2">${teamLogoHtml(teamName)}<span class="ellipsis-text">${escapeHTML(teamName)}</span></span>`;
}

// 사이트 공통 순서 - 여기 한 곳만 고친다. 티어는 높은 순, 직책은 멤버 목록 순서.
// scripts/write_site_data.py도 이 블록을 JSON으로 읽어 같은 순서를 쓴다(큰따옴표 JSON 형식 유지).
const SITE_ORDER = {
    "tiers": ["갓", "킹", "잭", "조커", "스페이드", "0", "1", "2", "3", "4", "5", "6", "7", "8", "베이비"],
    "roles": ["감독", "코치", "선수"]
};
const TIER_ORDER = SITE_ORDER.tiers;
// DB에서 '체크'는 아직 티어를 매기지 않은 사람이다 - 화면에서는 미분류로 다룬다.
const TIER_UNRANKED = new Set(['체크', '미분류']);

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

// 이름 자체가 길어 '티어'를 붙이면 뱃지가 너무 길어지는 티어. '스페이드티어'는 여섯 자라
// 좁은 칸에서 줄바꿈되거나 이름을 밀어낸다 - 이런 티어는 이름만 적는다.
const TIER_NO_SUFFIX = new Set(['스페이드']);

// 티어 표기(예: "3티어")를 멤버 카드/모달/개인전적 프로필에서 동일하게 사용
function tierLabel(tier) {
    const raw = (tier === undefined || tier === null) ? '' : String(tier).trim();
    // 비어 있거나 '체크'면 아직 티어를 안 매긴 사람이다 - 둘 다 '미분류'로 적는다.
    if (!raw || TIER_UNRANKED.has(raw)) return '미분류';
    return TIER_NO_SUFFIX.has(raw) ? raw : `${raw}티어`;
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

// 활동기간 뱃지(개인 전적 머리 카드). 뱃지 한 칸에 들어가야 해서 '804일째'만 적고,
// 기간 범위는 마우스를 올렸을 때 보이게 title로 붙인다. 퇴단한 멤버는 퇴단일까지만 센다.
// (멤버 프로필 팝업은 표 한 줄을 통째로 쓰므로 범위를 그대로 적는다 - page-members.js)
function memberPeriodBadgeHtml(m) {
    const join = m && m['입단일'];
    if (!join) return '<span class="rank-badge-text">활동기간 -</span>';
    const active = isActiveMember(m);
    const end = active ? '현재' : (m['퇴단일'] || '-');
    const range = `${String(join).replace(/-/g, '.')} ~ ${String(end).replace(/-/g, '.')}`;
    const days = daysBetween(join, active ? todayStr() : (m['퇴단일'] || null));
    const text = days === null ? range : `${days.toLocaleString('ko-KR')}일${active ? '째' : ''}`;
    return `<span class="rank-badge-text" title="활동기간 ${escapeHTML(range)}">${escapeHTML(text)}</span>`;
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
    const tierText = tierLabel(m['티어']).replace('티어', '');
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
    attachBarScroll(list.parentElement);
}

// 선택 바(PC 가로 바)의 넘치는 목록은 마우스로 눌러 끌어서 넘긴다.
// 5px 넘게 끌었으면 손을 뗄 때의 클릭은 버린다(항목이 눌리지 않게).
// 넘칠 때만 바에 .is-scrollable이 붙는다(끌기 커서). 모바일 세로 목록은 넘치지 않아 해당 없음.
function attachBarScroll(el) {
    if (!el || el._barScroll) return;
    const bar = el.closest('.avatar-bar, .tier-bar');
    if (!bar) return;
    el._barScroll = true;

    const update = () => bar.classList.toggle('is-scrollable', el.scrollWidth - el.clientWidth > 1);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
    else window.addEventListener('resize', update);
    new MutationObserver(update).observe(el, { childList: true, subtree: true });

    let startX = 0, startLeft = 0, moved = false, id = null;
    el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !bar.classList.contains('is-scrollable')) return;
        id = e.pointerId; startX = e.clientX; startLeft = el.scrollLeft; moved = false;
    });
    el.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < 5) return;
        if (!moved) { moved = true; el.setPointerCapture(id); bar.classList.add('is-dragging'); }
        el.scrollLeft = startLeft - dx;
    });
    const end = e => {
        if (e.pointerId !== id) return;
        id = null;
        bar.classList.remove('is-dragging');
        if (moved) el._dragged = true;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', e => {
        if (!el._dragged) return;
        el._dragged = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    el.addEventListener('dragstart', e => e.preventDefault());
    update();
}

// 고른 항목을 선택 바 목록의 가운데로 데려온다(목록 처음/끝이면 그쪽 끝에 붙는다).
// 목록 밖 항목('전체'처럼 왼쪽에 고정된 칸)을 고르면 목록을 맨 앞으로 되돌린다.
// [주의] offsetLeft는 쓰지 않는다 - 바가 position:sticky라 offsetParent가 바가 되어
// 왼쪽 고정 칸 폭만큼 어긋난다. 목록 기준 좌표를 직접 구한다.
function centerBarItem(item) {
    if (!item) return;
    const bar = item.closest('.avatar-bar, .tier-bar');
    const list = item.closest('.avatar-selector-scroll, .tier-bar-list')
        || (bar && bar.querySelector('.avatar-selector-scroll, .tier-bar-list'));
    if (!list || list.scrollWidth <= list.clientWidth) return;
    let left = 0;
    if (list.contains(item)) {
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        const itemLeft = itemRect.left - listRect.left + list.scrollLeft;
        left = itemLeft - (list.clientWidth - itemRect.width) / 2;
        left = Math.max(0, Math.min(left, list.scrollWidth - list.clientWidth));
    }
    if (Math.abs(left - list.scrollLeft) < 1) return;
    list.scrollTo({ left, behavior: 'smooth' });
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
    centerBarItem(activeEl);

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
// 5. 방송통계 데이터
// ststat -> Supabase daily_member_stats 를 직접 읽고 우리 로스터만 추린다.
// =====================================================================
let _publicSupabaseClient = null;
// 공개 페이지는 Supabase 표를 읽기만 한다. 그래서 supabase-js(213KB)를 받지 않고, 쓰는 조회
// (select·eq·in·not·order·range·limit·maybeSingle)만 같은 주소 형식으로 직접 만든다 - 주소와
// 헤더가 supabase-js와 한 글자까지 같아서 서버 쪽에서 보면 차이가 없다. 결과도 똑같이 {data, error}.
// 로그인이 필요한 관리자 화면은 진짜 supabase-js를 따로 받는다(base.html).
class SupabaseReadQuery {
    constructor(restUrl, table, key) {
        this.url = new URL(`${restUrl}/${table}`);
        this.key = key;
        this.maybeOne = false;
    }
    select(columns = '*') {
        let quoted = false;
        const cleaned = String(columns).split('')
            .map(ch => (/\s/.test(ch) && !quoted ? '' : (ch === '"' && (quoted = !quoted), ch))).join('');
        this.url.searchParams.set('select', cleaned);
        return this;
    }
    eq(column, value) { this.url.searchParams.append(column, `eq.${value}`); return this; }
    not(column, operator, value) { this.url.searchParams.append(column, `not.${operator}.${value}`); return this; }
    in(column, values) {
        const list = Array.from(new Set(values))
            .map(v => (typeof v === 'string' && /[,()]/.test(v) ? `"${v}"` : `${v}`)).join(',');
        this.url.searchParams.append(column, `in.(${list})`);
        return this;
    }
    order(column, { ascending = true, nullsFirst } = {}) {
        const prev = this.url.searchParams.get('order');
        const nulls = nullsFirst === undefined ? '' : (nullsFirst ? '.nullsfirst' : '.nullslast');
        this.url.searchParams.set('order', `${prev ? `${prev},` : ''}${column}.${ascending ? 'asc' : 'desc'}${nulls}`);
        return this;
    }
    limit(count) { this.url.searchParams.set('limit', `${count}`); return this; }
    range(from, to) {
        this.url.searchParams.set('offset', `${from}`);
        this.url.searchParams.set('limit', `${to - from + 1}`);
        return this;
    }
    maybeSingle() { this.maybeOne = true; return this; }
    async run() {
        try {
            const res = await fetch(this.url.href, {
                headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
            });
            const text = await res.text();
            let body = null;
            if (text) {
                try { body = JSON.parse(text); } catch (_) { return { data: null, error: { message: text }, status: res.status }; }
            }
            if (!res.ok) return { data: null, error: body || { message: res.statusText }, status: res.status };
            if (this.maybeOne && Array.isArray(body)) {
                if (body.length > 1) {
                    return { data: null, status: 406, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
                }
                body = body.length ? body[0] : null;
            }
            return { data: body, error: null, status: res.status };
        } catch (e) {
            return { data: null, error: { message: `${e?.name ?? 'FetchError'}: ${e?.message}` }, status: 0 };
        }
    }
    then(onFulfilled, onRejected) { return this.run().then(onFulfilled, onRejected); }
}

function publicSupabaseClient() {
    if (_publicSupabaseClient) return _publicSupabaseClient;
    const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.key) return null;
    const restUrl = new URL('rest/v1', cfg.url.endsWith('/') ? cfg.url : `${cfg.url}/`).href;
    _publicSupabaseClient = { from: table => new SupabaseReadQuery(restUrl, table, cfg.key) };
    return _publicSupabaseClient;
}

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

function formatKstDateTime(value, includeTime) {
    if (!value) return '';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return String(value).slice(0, includeTime ? 19 : 10);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } : {})
    }).formatToParts(parsed).reduce((out, part) => {
        if (part.type !== 'literal') out[part.type] = part.value;
        return out;
    }, {});
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return includeTime ? `${date} ${parts.hour}:${parts.minute}:${parts.second} KST` : date;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 방송통계 데이터를 한 번만 받아온다(여러 곳에서 불러도 요청은 1번). 실패하면 다음 호출 때 다시 시도.
let _synergyRequest = null;
function fetchSynergyData() {
    if (_synergyRequest) return _synergyRequest;

    _synergyRequest = (async () => {
        const client = publicSupabaseClient();
        if (!client) throw new Error('Supabase 공개 클라이언트를 초기화하지 못했습니다');

        const { data: dateRows, error: dateError } = await client
            .from('synergy_daily_dates')
            .select('stat_date,updated_at')
            .order('stat_date', { ascending: false })
            .limit(1);
        if (dateError) throw dateError;

        const latest = Array.isArray(dateRows) ? dateRows[0] : null;
        const latestDate = latest && latest.stat_date ? String(latest.stat_date) : '';
        if (!latestDate) throw new Error('사용 가능한 방송통계 날짜가 없습니다');

        const idToMember = new Map();
        SiteData.members.forEach(m => {
            const originalId = String(m['SOOP ID'] || '').trim();
            const soopId = originalId.toLowerCase();
            if (soopId) idToMember.set(soopId, m);
        });
        const memberIds = [...idToMember.values()]
            .map(m => String(m['SOOP ID'] || '').trim())
            .filter(Boolean);
        if (!memberIds.length) throw new Error('조회할 StarUniv 선수 ID가 없습니다');

        const rows = await fetchAllPages((from, to) => client
            .from('daily_member_stats')
            .select('stat_date,soop_id,elo_id,nickname,role,affiliation,race,tier,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses,updated_at,sponsor_updated_at')
            .eq('stat_date', latestDate)
            .in('soop_id', memberIds)
            .order('soop_id', { ascending: true })
            .range(from, to), { parallel: 1 });
        if (!rows.length) throw new Error(`${latestDate} 방송통계 데이터가 없습니다`);

        SynergyState.data = rows
            .map(row => {
                const soopId = String((row && row.soop_id) || '').trim().toLowerCase();
                const ours = idToMember.get(soopId);
                if (!ours) return null;
                return {
                    id: row.soop_id,
                    elo_id: row.elo_id,
                    nickname: row.nickname,
                    role: row.role || '',
                    team: row.affiliation || null,
                    race: row.race || null,
                    tier: row.tier || null,
                    balloons: Number(row.balloons || 0),
                    broadcast_seconds: Number(row.broadcast_seconds || 0),
                    cumulative_viewers: Number(row.cumulative_viewers || 0),
                    sponsor_wins: Number(row.sponsor_wins || 0),
                    sponsor_losses: Number(row.sponsor_losses || 0),
                    ourMember: ours,
                    active: isActiveMember(ours),
                };
            })
            .filter(Boolean);

        const latestUpdated = rows.reduce((acc, row) => {
            const value = String(row.updated_at || '');
            return value > acc ? value : acc;
        }, '');
        SynergyState.updatedAt = latestUpdated || String(latest.updated_at || latestDate);
        SynergyState.failed = false;
        return SynergyState.data;
    })();

    _synergyRequest.catch(() => {
        SynergyState.failed = true;
        _synergyRequest = null;
    });
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

let SiteRuntimeConfig = {};
function runtimePageId() {
    return document.body.dataset.adminPage
        || document.querySelector('.page-section.active')?.id?.replace(/^page-/,'')
        || location.pathname.split('/').filter(Boolean).pop()
        || 'home';
}
function runtimeSubtabConfig(pageId, fallbackDefault) {
    const raw = SiteRuntimeConfig?.subtabs?.[pageId] || {};
    return {
        hidden: Array.isArray(raw.hidden) ? raw.hidden.map(String) : [],
        default: String(raw.default || fallbackDefault || ''),
    };
}
function runtimeDefaultSubtab(pageId, fallbackDefault) {
    return runtimeSubtabConfig(pageId, fallbackDefault).default || fallbackDefault;
}
function runtimeSectionEnabled(key, fallback=true) {
    const sections = SiteRuntimeConfig?.homeSections;
    if (!sections || !Object.prototype.hasOwnProperty.call(sections, key)) return fallback;
    return !!sections[key];
}

// 메뉴·서브탭 표시 설정(site_config.nav). 페이지 초기화가 이 값(서브탭 기본값 등)을 쓰므로
// 처음에는 기다려야 하지만, 모든 페이지가 요청 한 번을 통째로 기다리던 걸 줄이려고 마지막 값을
// 브라우저에 기억해 두고 바로 쓴다. 새 값은 뒤에서 받아 달라졌을 때만 다시 적용한다.
// (관리자 화면은 편집 결과가 곧바로 보여야 하므로 기억해 둔 값을 쓰지 않는다.)
const NAV_CACHE_KEY = 'staruniv-nav-config';
async function fetchNavConfig() {
    const client = typeof publicSupabaseClient === 'function' ? publicSupabaseClient() : null;
    if (!client) throw new Error('Supabase browser client is not configured');
    const { data: row, error } = await client.from('site_config')
        .select('config_value').eq('config_key','nav').maybeSingle();
    if (error) throw error;
    const data = row?.config_value || {};
    try { localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
    return data;
}

async function applyNavVisibility() {
    let cached = null;
    if (!document.body.classList.contains('admin-mode')) {
        try { cached = JSON.parse(localStorage.getItem(NAV_CACHE_KEY) || 'null'); } catch (_) {}
    }
    const fresh = fetchNavConfig();
    if (cached && typeof cached === 'object') {
        applyNavConfig(cached);
        fresh.then(data => { if (JSON.stringify(data) !== JSON.stringify(cached)) applyNavConfig(data); })
            .catch(e => console.warn('사이트 표시 설정을 새로 받지 못했습니다.', e));
        return;
    }
    let data = null;
    try { data = await fresh; }
    catch (e) { console.warn('사이트 표시 설정을 불러오지 못했습니다.', e); }
    if (data) applyNavConfig(data);
    delete document.documentElement.dataset.navPending;
}

// 사이트 문구는 끝에 마침표·말줄임표를 붙이지 않는다. 관리자가 입력한 문구도 표시할 때 맞춘다.
function trimEndPunct(text) {
    return String(text || '').trim().replace(/(?:\.|…)+$/, '').trim();
}

function applyNavConfig(data) {
    try {
        SiteRuntimeConfig = data;

        const isAdmin = document.body.classList.contains('admin-mode');
        const hidden = new Set((Array.isArray(data.hidden) ? data.hidden : []).map(String));
        const order = Array.isArray(data.order) ? data.order.map(String) : [];
        const menu = document.getElementById('mainMenu');
        const navItems = [...document.querySelectorAll('.top-navbar .nav-item[data-page]')];
        navItems.forEach(el => {
            const isHidden = hidden.has(el.dataset.page);
            el.hidden = isHidden && !isAdmin;
            el.classList.toggle('admin-config-hidden', isHidden && isAdmin);
        });
        if (menu && order.length) {
            order.forEach(pageId => {
                const el = navItems.find(x => x.dataset.page === pageId);
                if (el) menu.appendChild(el);
            });
        }

        const pageId = runtimePageId();
        const sub = runtimeSubtabConfig(pageId, '');
        document.querySelectorAll('.sub-tabs .sub-tab[id]').forEach(el => {
            const key = el.id.replace(/^tab-(?:member-|tools-|video-)?/,'').replace(/^tab-/,'');
            const hiddenSub = sub.hidden.includes(key);
            el.hidden = hiddenSub && !isAdmin;
            el.classList.toggle('admin-config-hidden', hiddenSub && isAdmin);
        });

        const heroDescriptions = (data.heroDescriptions && typeof data.heroDescriptions === 'object') ? data.heroDescriptions : {};
        document.querySelectorAll('[data-hero-description]').forEach(subtitle => {
            const heroText = trimEndPunct(heroDescriptions[subtitle.dataset.heroDescription]);
            if (heroText) subtitle.textContent = heroText;
        });
        const heroText = trimEndPunct(heroDescriptions[pageId]);
        if (heroText) {
            const subtitle = document.querySelector('.page-section.active .page-header-subtitle:not([data-hero-description])');
            if (subtitle) {
                if (subtitle.id === 'tier-subtitle' && subtitle.firstChild) subtitle.firstChild.nodeValue = heroText + '. 출처 : ';
                else subtitle.textContent = heroText;
            }
        }

        const carousel = data.homeCarousel && typeof data.homeCarousel === 'object' ? data.homeCarousel : {};
        document.querySelectorAll('.home-carousel-slide').forEach((slide, idx) => {
            const key = ['schedule','records','video'][idx];
            const cfg = carousel[key];
            if (!cfg) return;
            const title = slide.querySelector('.page-header-title');
            const desc = slide.querySelector('.page-header-subtitle');
            const link = slide.querySelector('.home-hero-links a');
            if (title && cfg.title) title.textContent = cfg.title;
            if (desc && cfg.description) desc.textContent = trimEndPunct(cfg.description);
            if (link && cfg.href) link.setAttribute('href', cfg.href);
        });

        const liveTitle = document.querySelector('#home-live-broadcast')?.previousElementSibling;
        const noticeList = document.getElementById('home-notice-list');
        const noticeTitle = noticeList?.previousElementSibling;
        const liveWrap = document.getElementById('home-live-broadcast');
        if (liveWrap) {
            const enabled = runtimeSectionEnabled('live', true);
            liveWrap.hidden = !enabled && !isAdmin;
            liveTitle?.classList.toggle('admin-config-hidden', !enabled && isAdmin);
            liveWrap.classList.toggle('admin-config-hidden', !enabled && isAdmin);
        }
        if (noticeList) {
            const enabled = runtimeSectionEnabled('notices', true);
            noticeList.hidden = !enabled && !isAdmin;
            noticeTitle?.classList.toggle('admin-config-hidden', !enabled && isAdmin);
            noticeList.classList.toggle('admin-config-hidden', !enabled && isAdmin);
        }

        HiddenStatsTabs = new Set((Array.isArray(data.statsTabs) ? data.statsTabs : []).map(String));
        document.querySelectorAll('#synergy-metric-filter .sub-tab[data-metric]').forEach(el => {
            const isHidden = HiddenStatsTabs.has(el.dataset.metric);
            el.hidden = isHidden && !isAdmin;
            el.classList.toggle('admin-config-hidden', isHidden && isAdmin);
        });
        if (typeof syncStatsMetricVisibility === 'function') syncStatsMetricVisibility();
        if (menu && menu._edgeFadeUpdate) menu._edgeFadeUpdate();
        document.dispatchEvent(new CustomEvent('site:config', {detail:data}));
    } catch (e) {
        console.warn('사이트 표시 설정을 적용하지 못했습니다.', e);
    } finally {
        delete document.documentElement.dataset.navPending;
    }
}

// 페이지 시작: 사이트 데이터(멤버/경기 등)를 먼저 불러온 뒤 페이지별 초기화를 실행한다.
// 이 스크립트들은 body 맨 끝에서 실행되므로 DOM은 이미 준비돼 있지만, 순서를 확실히 하려고
// DOMContentLoaded에 맞춘다(이미지 로딩까지 기다리는 window.onload보다 빠르다).
// opts.siteData: false면 데이터를 받지 않고, 배열이면 해당 묶음만 받는다.
// 티어표·영상처럼 그 데이터를 한 줄도 안 쓰는 페이지가 400KB짜리 파일을 기다렸다
// 시작하던 걸 없애기 위한 것이다. 그 페이지에서 SiteData를 쓰기 시작하면 여기 옵션을
// 지워야 한다(안 지우면 목록이 빈 채로 그려진다).
function bootPage(init, opts) {
    const siteDataParts = opts && opts.siteData === false
        ? [] : ((opts && Array.isArray(opts.siteData)) ? opts.siteData : ['shell']);
    const start = async () => {
        // 상단 메뉴/서브탭은 데이터와 무관하게 이미 그려져 있으니, 데이터를 기다리지 않고
        // 먼저 붙인다(ResizeObserver가 이후 변화를 알아서 따라간다).
        initEdgeFades();
        // 메뉴/서브탭 기본값을 페이지 초기화 전에 확정한다. 사이트 데이터 파일과는 서로 무관하니 함께 받는다.
        await Promise.all([
            applyNavVisibility(),
            loadTeamLogos(),
            siteDataParts.length ? loadSiteData(siteDataParts) : null,
        ]);
        safeInit('페이지', init);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}

// 물음표 도움말. 뱃지나 제목 옆에 붙여서, 누르면 설명 상자가 열린다.
// 설명 상자는 단추 옆이 아니라 <body>에 띄운다 - 선수 머리 카드 같은 곳은 노치 모서리를
// clip-path로 깎기 때문에, 카드 안에 두면 상자가 카드 밖으로 못 나가고 잘린다.
// 문구는 우리가 적는 고정 텍스트고, 그리기도 textContent로 하므로 HTML이 섞일 일이 없다.
let helpSeq = 0;

// 설명은 { title, lead, rows: [[이름, 값], ...], note } 꼴로 적는다. 줄글 하나를
// 통으로 넘겨도 되지만(옛 호출), 항목을 나눠 두면 상자가 표처럼 읽혀서 훨씬 빨리 훑힌다.
// 내용은 JSON으로 data-help에 싣고 열 때 DOM으로 짠다 - 문자열을 innerHTML로 꽂지 않는다.
function helpBadgeHtml(help) {
    const uid = `help-${++helpSeq}`;
    const payload = typeof help === 'string' ? { lead: help } : (help || {});
    return `<span class="help-pop"><button type="button" class="help-btn" id="${uid}"
            aria-expanded="false" aria-label="설명 보기"
            data-help="${escapeHTML(JSON.stringify(payload))}" onclick="toggleHelp(this)"><i class="i-info" aria-hidden="true"></i></button></span>`;
}

function helpEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null && text !== '') el.textContent = text;
    return el;
}

// 상자 내용을 다시 그린다. 옛 호출이 남아 있을 수 있어 JSON이 아니면 줄글로 본다.
function helpFill(box, raw) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { data = { lead: raw || '' }; }
    if (!data || typeof data !== 'object') data = { lead: String(raw || '') };
    box.textContent = '';
    if (data.title) box.appendChild(helpEl('div', 'help-head', data.title));
    if (data.lead) box.appendChild(helpEl('p', 'help-lead', data.lead));
    if (Array.isArray(data.rows) && data.rows.length) {
        const dl = helpEl('dl', 'help-rows');
        data.rows.forEach(pair => {
            if (!Array.isArray(pair)) return;
            dl.appendChild(helpEl('dt', null, pair[0]));
            dl.appendChild(helpEl('dd', null, pair[1]));
        });
        box.appendChild(dl);
    }
    if (data.note) box.appendChild(helpEl('p', 'help-note', data.note));
}

function helpBox() {
    let box = document.getElementById('help-floating');
    if (!box) {
        box = document.createElement('div');
        box.id = 'help-floating';
        box.className = 'help-body';
        box.setAttribute('role', 'tooltip');
        box.hidden = true;
        document.body.appendChild(box);
    }
    return box;
}

function closeAllHelp() {
    const box = document.getElementById('help-floating');
    if (box) { box.hidden = true; box.removeAttribute('data-owner'); }
    document.querySelectorAll('.help-btn[aria-expanded="true"]')
        .forEach(el => el.setAttribute('aria-expanded', 'false'));
}

function toggleHelp(btn) {
    const box = helpBox();
    const wasOpen = !box.hidden && box.dataset.owner === btn.id;
    closeAllHelp();
    if (wasOpen) return;                       // 같은 단추를 다시 누르면 닫기만 한다

    helpFill(box, btn.dataset.help || '');
    box.dataset.owner = btn.id;
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');

    // 단추 바로 아래에 두되, 좁은 화면에서 오른쪽으로 삐져나가지 않게 안쪽으로 당긴다.
    const r = btn.getBoundingClientRect();
    box.style.left = '0px';
    box.style.top = '0px';
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    box.style.left = `${Math.round(Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)))}px`;
    // 아래 공간이 모자라면 단추 위로 올린다
    const below = r.bottom + 6;
    box.style.top = `${Math.round(below + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below)}px`;
}

// 설명 상자 바깥을 누르거나 Esc를 누르면 닫는다. 화면을 스크롤해도 닫는다 -
// 위치를 열 때 한 번만 계산하므로 따라다니게 두면 어긋난다.
document.addEventListener('click', e => {
    if (e.target.closest && (e.target.closest('.help-pop') || e.target.closest('#help-floating'))) return;
    closeAllHelp();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllHelp();
});
window.addEventListener('scroll', () => closeAllHelp(), { passive: true });
window.addEventListener('resize', () => closeAllHelp());

// 티어랭킹 뱃지 옆 설명. 계산은 ststat 중앙 파이프라인이 수행한다.
const RANK_HELP = {
    title: '티어 랭킹',
    lead: '상대의 강함과 경기 중요도까지 반영한 실력 추정치로, 같은 티어 안에서 매긴 순위입니다',
    rows: [
        ['순위 범위', '현재 티어 안에서만 비교'],
        ['계산', '상대가 강할수록 승리 가치가 커짐'],
        ['종족 상성', '종족 간 공통 유불리를 빼고 실력만 비교'],
        ['최근성', '개인 폼 90일 · 티어 간격 540일 반감기'],
        ['승급 반영', '티어 기준선은 당시 티어, 개인 폼은 지금 티어 기준'],
        ['적은 표본', '기록이 적을수록 티어 평균 쪽으로 당겨짐'],
        ['형식 비중', '대회 › 대학 › 미니 › 리그·CK › 스폰'],
    ],
    note: "티어 기준점은 갓→베이비 순서를 지키며, 최근 1년 10판 미만이거나 휴면이면 '기록 없음'입니다",
};

// 티어 랭킹 뱃지: '갓티어 · 3위/16명'. 활성 Supabase Elo 스냅샷의 순위를 쓴다.
// 최근 1년에 10판을 못 채웠거나 지금 티어표에 없는 사람은 순위가 없어서 '기록 없음'이 된다.
// 종족·티어 뱃지와 같은 높이·크기지만, 뱃지 줄에 같이 세우면 좁은 화면에서 줄이 넘쳐
// 잘리므로 머리 카드의 셋째 줄을 따로 내준다(.player-summary-position).
function playerRankBadgeHtml(tier, rank, tierTotal) {
    const label = escapeHTML(tierLabel(tier));
    const body = (rank && tierTotal)
        ? `${rank}위/${Number(tierTotal).toLocaleString('ko-KR')}명`
        : '기록 없음';
    return `<span class="tag-badge rank-badge">${label} · ${body}</span>`;
}

// 승패 표기. 사이트 어디서나 '20승 19패'로 같게 적는다(예전엔 '20-19'와 섞여 있었다).
// 숫자만 색을 입히고 '승/패' 글자는 본문 색으로 둬서, 좁은 칸에서도 숫자가 먼저 읽힌다.
function winLoseText(win, lose, winClass, loseClass) {
    return `<span class="${winClass || 'h2h-win'}">${win}</span>승 `
        + `<span class="${loseClass || 'h2h-lose'}">${lose}</span>패`;
}

function playerBadgesHtml(p) {
    return `${p.r ? raceBadgeHtml(p.r) : ''}${p.t !== undefined && p.t !== '' ? `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(p.t))}</span>` : ''}${p.tm ? `<span class="tag-badge team-badge">${escapeHTML(p.tm)}</span>` : ''}`;
}
function playerSummaryHtml(p, rec, close = '', opts = {}) {
    return `<div class="player-summary">
        <div class="player-summary-avatar">${avatarHtml(p.s || '', 'player-summary-image')}</div>
        <div class="player-summary-id">
            <div class="player-summary-name">${escapeHTML(p.n)}</div>
            <div class="player-summary-badges">${playerBadgesHtml(p)}</div>
            <div class="player-summary-position">${playerRankBadgeHtml(p.t, opts.rank, opts.tierTotal)}${helpBadgeHtml(RANK_HELP)}</div>
        </div>
        <div class="player-summary-stats">
            <div class="player-summary-total">총 전적 ${rec.total.toLocaleString('ko-KR')}전</div>
            <div class="player-summary-wl">${rec.win}승 ${rec.lose}패</div>
            <div class="player-summary-rate">${rec.total ? `${Math.round(rec.win / rec.total * 1000) / 10}%` : '-'}</div>
        </div>${close}</div>`;
}
function matchPaginationHtml(total, page, size, handler) {
    const count = Math.max(1, Math.ceil(total / size));
    const cur = Math.min(Math.max(1, page), count);
    const start = Math.floor((cur - 1) / 5) * 5 + 1;
    const end = Math.min(count, start + 4);
    // 숫자 버튼과 앞뒤 이동 버튼은 모양이 달라서(활성 표시가 숫자에만 붙는다) 따로 만든다.
    const num = n => `<button type="button" class="match-page${n === cur ? ' active' : ''}"${n === cur ? ' aria-current="page"' : ''} onclick="${handler}(${n})">${n}</button>`;
    const step = (n, label, aria, disabled) =>
        `<button type="button" class="match-page is-edge" aria-label="${aria}"${disabled ? ' disabled' : ` onclick="${handler}(${n})"`}>${label}</button>`;
    return `<nav class="match-pagination" aria-label="페이지">
        <span class="match-pagination-nav">
            ${step(1, '&laquo;', '첫 페이지', cur === 1)}
            ${step(cur - 1, '&lsaquo;', '이전 페이지', cur === 1)}
        </span>
        <span class="match-page-nums">
            ${start > 1 ? `<button type="button" class="match-page is-gap" onclick="${handler}(${start - 1})" aria-label="이전 묶음">…</button>` : ''}
            ${Array.from({ length: end - start + 1 }, (_, i) => num(start + i)).join('')}
            ${end < count ? `<button type="button" class="match-page is-gap" onclick="${handler}(${end + 1})" aria-label="다음 묶음">…</button>` : ''}
        </span>
        <span class="match-pagination-nav">
            ${step(cur + 1, '&rsaquo;', '다음 페이지', cur === count)}
            ${step(count, '&raquo;', '마지막 페이지', cur === count)}
        </span>
        <span class="match-pagination-info">${cur} / ${count} 페이지 · ${total.toLocaleString('ko-KR')}경기</span>
    </nav>`;
}
