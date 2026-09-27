/**
 * 스타대학 사이트 공용 코어 (모든 페이지가 가장 먼저 불러온다).
 *
 * [페이지 구조] 메뉴마다 실제 페이지(docs/records/index.html 등)가 있고, 각 페이지는
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
// jsStrEscape만 거치면 값에 큰따옴표(")가 섞였을 때 속성 자체가 끊기면서 그 뒤가
// 새 속성(onmouseover=... 등)으로 해석될 수 있다(XSS). JS 이스케이프 후 HTML 이스케이프를
// 한 번 더 하면 브라우저가 속성값을 디코딩한 결과가 정확히 JS 이스케이프된 문자열이 된다.
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#07090d' : '#ffffff');
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
// (innerHTML로 다시 그려지는 요소에는 쓰면 안 된다 - 지워진 노드를 계속 붙잡게 된다)
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

// 모달·접기: 부트스트랩 JS(80KB) 대신 이 두 가지만 직접 구현한다. 부트스트랩과 같은 클래스(.modal .show
// .modal-backdrop .collapsing)와 같은 속성(data-bs-dismiss, data-bs-toggle="collapse")을 쓴다.
// CSS는 style/00-vendor-bootstrap.css에 있다.
const UI_FADE_MS = 300;
let openModalEl = null;
let modalBackdrop = null;
let modalReturnFocus = null;   // 창을 열기 전 포커스가 있던 요소 - 다 닫으면 그리로 돌려준다

function afterTransition(el, fn) {
    let done = false;
    const finish = () => { if (done) return; done = true; el.removeEventListener('transitionend', finish); fn(); };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, UI_FADE_MS + 50);   // 애니메이션을 끈 환경에서는 transitionend가 안 온다
}

function showModal(id) {
    const el = document.getElementById(id);
    if (!el || el === openModalEl) return;
    // 창에서 창으로 넘어갈 때는 처음 연 요소를 그대로 둔다
    if (!openModalEl) {
        const active = document.activeElement;
        modalReturnFocus = active && active !== document.body ? active : null;
    }
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
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    void el.offsetWidth;
    el.classList.add('show');
    afterTransition(el, () => { if (openModalEl === el) el.focus({ preventScroll: true }); });
}

function hideModal(el, keepBackdrop) {
    if (!el || !el.classList.contains('show')) return;
    // 모달 안에 포커스가 남은 채로 숨기면 포커스가 보이지 않는 곳에 남는다 - 먼저 뺀다
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.remove('show');
    if (openModalEl === el) openModalEl = null;
    afterTransition(el, () => {
        if (el.classList.contains('show')) return;
        el.style.display = 'none';
        el.removeAttribute('aria-modal');
        el.removeAttribute('role');
    });
    if (keepBackdrop) return;
    const back = modalReturnFocus;
    modalReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    if (!modalBackdrop) return;
    const backdrop = modalBackdrop;
    modalBackdrop = null;
    backdrop.classList.remove('show');
    // 스크롤바는 창이 다 사라진 뒤에 돌려놓는다 - 사라지는 도중에 돌려놓으면 화면 폭이 스크롤바만큼
    // 줄면서 가운데 놓인 창이 왼쪽으로 살짝 밀린다. 그 사이 다른 창이 열렸으면 그대로 둔다.
    afterTransition(backdrop, () => {
        backdrop.remove();
        if (openModalEl) return;
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    });
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
// 창이 열려 있으면 Tab/Shift+Tab이 창 안의 버튼·링크만 돌게 한다(뒤 화면으로 빠지지 않게)
const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || !openModalEl) return;
    const items = [...openModalEl.querySelectorAll(MODAL_FOCUSABLE)]
        .filter(x => !x.hidden && x.getClientRects().length > 0);
    if (!items.length) { ev.preventDefault(); openModalEl.focus({ preventScroll: true }); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (!openModalEl.contains(active) || active === openModalEl) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
    } else if (ev.shiftKey && active === first) {
        ev.preventDefault();
        last.focus();
    } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
    }
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
// Enter/Space로 누를 수 있게 한다. 탭 목록에서는 ←/→/Home/End로 옆 탭을 골라 연다(WAI-ARIA 탭 패턴).
// 마우스 클릭 동작에는 영향이 없다.
const TAB_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
document.addEventListener('keydown', e => {
    const el = e.target;
    if (!el || !el.matches) return;
    if (e.key in TAB_KEYS && el.matches('[role="tablist"] > [role="tab"]') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const list = el.parentElement;
        const visibleTabs = () => [...list.children].filter(t => t.matches('[role="tab"]') && t.getClientRects().length);
        const tabs = visibleTabs();
        const step = TAB_KEYS[e.key];
        const i = step === 'first' ? 0 : step === 'last' ? tabs.length - 1 : (tabs.indexOf(el) + step + tabs.length) % tabs.length;
        e.preventDefault();
        if (tabs[i] === el) return;
        tabs[i].click();
        // 필터처럼 누를 때 탭 목록을 새로 그리는 곳은 같은 자리의 새 탭으로 포커스를 옮긴다
        (tabs[i].isConnected ? tabs[i] : visibleTabs()[i])?.focus();
        return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!el.matches('[role="button"], [role="tab"]')) return;
    if (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    e.preventDefault();
    el.click();
});

// 노치(clip-path)로 잘린 모서리에서는 사각 포커스 테두리의 사선 구간이 비므로 02-base.css의 ::before가 사선까지 그린다.
// 그 크기(--cut: 요소 자신 또는 모서리를 같이 쓰는 조상의 노치에서 테두리 두께를 뺀 값)를 포커스 때 넣는다.
document.addEventListener('focusin', ({ target: el }) => {
    if (!(el instanceof Element)) return;
    for (let a = el, i = 0; a && i < 3; a = a.parentElement, i++) {
        const m = /calc\(100% - ([\d.]+)px\)/.exec(getComputedStyle(a).clipPath);
        if (!m) continue;
        const r = el.getBoundingClientRect(), p = a.getBoundingClientRect(), s = getComputedStyle(el);
        const cut = m[1] - (p.right - r.right) - (r.top - p.top) - parseFloat(s.borderTopWidth) - parseFloat(s.borderRightWidth);
        if (cut > 0) el.style.setProperty('--cut', cut + 'px');
        return;
    }
});
document.addEventListener('focusout', e => e.target.style?.removeProperty('--cut'));

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
        const payloads = await Promise.all(requested.map(async part => [part, await Api.siteData(part)]));
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

// 방송 중인 멤버 전체(ststat live-status가 2분마다 SOOP 전체 목록을 훑어 채우는 표).
// { soop_id(소문자): { broad_no, broad_title, current_sum_viewer, broad_start, category_name, broad_cate_no } }
// 수집이 5분 넘게 멈추면 뷰가 빈 목록을 준다. 사이드바·티어표가 같이 부르므로 20초 동안은 같은 결과를 쓴다.
const LIVE_BROADCASTS_TTL_MS = 20 * 1000;
let _liveBroadcasts = { at: 0, promise: null };
function fetchLiveBroadcasts() {
    if (_liveBroadcasts.promise && Date.now() - _liveBroadcasts.at < LIVE_BROADCASTS_TTL_MS) return _liveBroadcasts.promise;
    const promise = Api.liveBroadcasts()
        .then(data => {
            if (!Array.isArray(data)) throw new Error('Invalid live status');
            const live = {};
            data.forEach(row => { if (row.soop_id && row.broad_no) live[String(row.soop_id).toLowerCase()] = row; });
            return live;
        });
    _liveBroadcasts = { at: Date.now(), promise };
    promise.catch(() => { if (_liveBroadcasts.promise === promise) _liveBroadcasts = { at: 0, promise: null }; });
    return promise;
}

// 선택 사이드바가 탭 전환 시 늦게 만들어져도 LIVE 표시를 채운다.
// 일괄 조회(live_broadcasts)가 실패했을 때만 soop.js의 개별 조회로 대신한다(soop.js를 싣는 페이지만).
async function refreshSidebarLiveIndicators() {
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
        const live = await fetchLiveBroadcasts();
        ids.forEach(id => update(id, Boolean(live[id.toLowerCase()])));
    } catch (_) {
        if (typeof checkIsLiveRealtime !== 'function') return;
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
// [보강] ① 만료된 항목은 읽을 때 지운다(안 지우면 세션 내내 쌓인다).
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
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
    // DB에 결과가 아직 안 적혔거나 오타인 경기. '패'로 보이면 집계(승패 계산에서는 빠진다)와
    // 화면이 어긋나므로 따로 표시한다.
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
document.querySelectorAll('img[data-logo-failed]').forEach(img => teamLogoFallback(img, img.dataset.team));

// 대학 로고 주소. 로고는 어드민(전적 > 팀 관리)에서 올리고 Supabase(university_logos 표 + Storage)에
// 있으며 시너지와 같이 쓴다. 로고를 쓰는 페이지(bootPage의 logos: true)만 열 때 목록을 받아 둔다. 목록에 없으면 '' (배지로 대신).
const TeamLogos = { map: {} };
const LOGO_CACHE_KEY = 'staruniv-logos-v1';
function teamLogoSrc(name) {
    return TeamLogos.map[name] || '';
}
// Storage(staruniv-media)에 올린 파일의 공개 주소. 경로가 이상하면 빈 문자열.
function storageMediaUrl(path) {
    const p = String(path || '').trim();
    const base = String((window.STARUNIV_SUPABASE_CONFIG || {}).url || '').replace(/\/$/, '');
    if (!p || !base || /^[a-z]+:/i.test(p) || p.includes('..')) return '';
    return `${base}/storage/v1/object/public/staruniv-media/${p.split('/').map(encodeURIComponent).join('/')}`;
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
        const data = await Api.universityLogos();
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
    catch (e) { console.warn('대학 로고 목록을 불러오지 못했습니다. 이름 첫 글자 배지로 대신합니다.', e); }
}

function teamLogoHtml(teamName, sizePx) {
    const name = String(teamName || '').trim();
    if (!name) return '';
    const fileName = (name === '내전') ? '캄몬스타즈' : name;
    const size = sizePx || 16;
    const src = teamLogoSrc(fileName);
    // 로고가 없는 팀은 이미지를 요청하지 않고 바로 배지(teamLogoFallback과 같은 모양)
    if (!src) {
        const initial = escapeHTML(Array.from(name)[0] || '?');
        return `<span class="team-logo-fallback" style="width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.5))}px;">${initial}</span>`;
    }
    // 팀 이름을 onerror 안의 JS 문자열로 직접 꽂지 않고 data 속성으로 넘긴다(이스케이프 문제 원천 차단).
    // 크기는 대체 배지(teamLogoFallback)가 그대로 물려받아야 해서 인라인으로 둔다.
    return `<img src="${escapeHTML(src)}" alt="" class="team-logo-icon" loading="lazy" style="width:${size}px;height:${size}px;object-fit:contain;" data-team="${escapeHTML(name)}" onerror="teamLogoFallback(this, this.dataset.team)">`;
}

// 로고 + 팀 이름(말줄임) 묶음 - 팀/개인 전적 표 공용
function teamCellInnerHtml(teamName) {
    return `<span class="team-cell">${teamLogoHtml(teamName)}<span class="ellipsis-text">${escapeHTML(teamName)}</span></span>`;
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

// 오늘 날짜(YYYY-MM-DD, 로컬 기준). toISOString()(UTC 기준)을 쓰면 한국 시간 0~9시에는 어제
// 날짜가 나와 "활동 N일째"가 하루 적게 보인다. (calendar.js를 안 쓰는 페이지에서도 쓰이므로 자체 구현)
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
// 스크롤바를 그냥 숨겨두면 좁은 화면에서 탭이 잘려 있다는 걸 알 방법이 없다.
// 넘치는 쪽 끝을 흐리게 해서 "저쪽에 더 있다"를 보여준다.
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

// 히어로 서브탭이 4~5개면 좁은 화면(920px 이하)에서 한 줄에 같은 폭으로 나눠 담는다(글씨·여백을 조금 줄여서) -
// 줄을 늘리면 페이지마다 히어로 높이가 달라지고, 옆으로 밀면 뒤 탭이 가려진다. 6개 이상이면 옆으로 민다.
// 보이는 탭만 센다 - 메뉴 설정으로 숨기거나 다시 보이면(어드민 표시 포함) 다시 센다. 모양은 CSS(03-layout.css)가 정한다.
function syncSubTabDensity() {
    document.querySelectorAll('.page-header > .sub-tabs').forEach(el => {
        const n = [...el.children].filter(c => getComputedStyle(c).display !== 'none').length;
        const dense = n >= 4 && n <= 5;
        if (dense && el.dataset.tabDense === undefined) el.dataset.tabDense = '';
        else if (!dense && el.dataset.tabDense !== undefined) delete el.dataset.tabDense;
    });
}
// 탭이 숨고 보이는 건 탭 자신의 hidden·class(applyNavVisibility, 어드민 표시)로만 바뀌므로 서브탭 줄만 본다 -
// body 전체를 보면 경기 목록·모달처럼 탭과 무관한 변화에도 매번 다시 센다.
function watchSubTabDensity() {
    syncSubTabDensity();
    if (typeof MutationObserver === 'undefined') return;
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; syncSubTabDensity(); }, 0);   // 백그라운드 탭에서도 돈다(rAF는 멈춘다)
    });
    document.querySelectorAll('.page-header > .sub-tabs').forEach(el => {
        observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    });
}

// =====================================================================
// 5. 방송통계 데이터
// ststat -> Supabase daily_member_stats 를 직접 읽고 우리 로스터만 추린다.
// =====================================================================
const SynergyState = {
    data: null,          // [{ ...외부 필드, ourMember, active }]
    updatedAt: '',
    month: '',           // 보고 있는 달(YYYY-MM). ''이면 가장 최근 달
    statDate: '',        // 그 데이터의 날짜(그달 1일부터 이날까지의 누적)
    failed: false,
    metric: 'balloons',
};

function formatSecondsToHM(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h.toLocaleString('ko-KR')}시간 ${m}분`;   // 합계는 1만 시간을 넘는다(18,112시간)
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

// 방송통계가 있는 달 목록(최신순): [{ month: 'YYYY-MM', date: 그달 마지막 날짜 }].
// 하루치 행은 그달 1일부터 그날까지의 누적이라, 지난 달은 마지막 날짜 행이 그달 최종 기록이다.
let _synergyMonthsRequest = null;
function fetchSynergyMonths() {
    if (_synergyMonthsRequest) return _synergyMonthsRequest;
    _synergyMonthsRequest = (async () => {
        const rows = await Api.statsDates();
        const months = [];
        rows.forEach(r => {
            const date = String((r && r.stat_date) || '');
            if (date && (!months.length || months[months.length - 1].month !== date.slice(0, 7))) {
                months.push({ month: date.slice(0, 7), date });
            }
        });
        return months;
    })();
    _synergyMonthsRequest.catch(() => { _synergyMonthsRequest = null; });
    return _synergyMonthsRequest;
}

// 그 달에 팀에 있었는지(입단일~퇴단일이 그 달과 겹치는지). 날짜는 YYYY-MM-DD 문자열이다.
function memberInMonth(m, month) {
    const joined = String(m['입단일'] || '').trim() || '0000-00-00';
    const left = String(m['퇴단일'] || '').trim() || '9999-99-99';
    return joined.slice(0, 7) <= month && left.slice(0, 7) >= month;
}

// 방송통계 데이터를 달마다 한 번만 받아온다(여러 곳에서 불러도 요청은 1번). 실패하면 다음 호출 때 다시 시도.
// month를 비우면 가장 최근 날짜(이번 달 누적)이고, 활동 중인 멤버만 active다.
// 지난 달(YYYY-MM)은 그달 마지막 날짜의 누적을 읽고, 그 달에 팀에 있던 멤버만 담는다.
// fetchSynergyResult는 결과({ data, statDate, updatedAt })만 돌려주고 SynergyState는 건드리지 않는다 -
// 달을 빨리 바꾸면 먼저 보낸 요청이 늦게 올 수 있어서, 상태는 부르는 쪽이 '마지막으로 고른 달'인지 확인한 뒤
// applySynergyResult로 적용한다(page-stats.js loadSynergyData). 달을 바꾸지 않는 화면(멤버 프로필)은
// fetchSynergyData()로 최근 달을 받아 바로 적용한다.
const _synergyRequests = new Map();
function fetchSynergyData(month = '') {
    return fetchSynergyResult(month).then(
        result => applySynergyResult(month, result),
        err => { SynergyState.failed = true; throw err; });
}

function fetchSynergyResult(month = '') {
    if (_synergyRequests.has(month)) return _synergyRequests.get(month);

    const request = (async () => {
        // 날짜는 달 목록(fetchSynergyMonths, 한 번만 받는다)에서 고른다 - 최근 달은 그 첫 칸
        const months = await fetchSynergyMonths();
        const found = month ? months.find(m => m.month === month) : months[0];
        if (month && !found) throw new Error(`${month} 방송통계가 없습니다`);
        const latest = found ? { stat_date: found.date } : null;
        const latestDate = latest && latest.stat_date ? String(latest.stat_date) : '';
        if (!latestDate) throw new Error('사용 가능한 방송통계 날짜가 없습니다');

        // 같은 SOOP ID로 입단 기록이 여러 개(재입단)일 수 있다. 이번 달은 늘 그랬듯 마지막 기록을,
        // 지난 달은 그 달과 겹치는 기록을 쓴다(없으면 그 달엔 우리 멤버가 아니었다).
        const idToMember = new Map();
        SiteData.members.forEach(m => {
            const originalId = String(m['SOOP ID'] || '').trim();
            const soopId = originalId.toLowerCase();
            if (!soopId) return;
            if (month && !memberInMonth(m, month)) {
                if (!idToMember.has(soopId)) idToMember.set(soopId, null);
                return;
            }
            idToMember.set(soopId, m);
        });
        const memberIds = [...idToMember.values()]
            .filter(Boolean)
            .map(m => String(m['SOOP ID'] || '').trim())
            .filter(Boolean);
        if (!memberIds.length) throw new Error('조회할 StarUniv 선수 ID가 없습니다');

        const rows = await Api.stats(latestDate, memberIds);
        if (!rows.length) throw new Error(`${latestDate} 방송통계 데이터가 없습니다`);

        const data = rows
            .map(row => {
                const soopId = String((row && row.soop_id) || '').trim().toLowerCase();
                const ours = idToMember.get(soopId);
                if (!ours) return null;
                return {
                    id: row.soop_id,
                    nickname: row.nickname,
                    balloons: Number(row.balloons || 0),
                    broadcast_seconds: Number(row.broadcast_seconds || 0),
                    cumulative_viewers: Number(row.cumulative_viewers || 0),
                    sponsor_wins: Number(row.sponsor_wins || 0),
                    sponsor_losses: Number(row.sponsor_losses || 0),
                    ourMember: ours,
                    active: month ? true : isActiveMember(ours),
                };
            })
            .filter(Boolean);

        const latestUpdated = rows.reduce((acc, row) => {
            const value = String(row.updated_at || '');
            return value > acc ? value : acc;
        }, '');
        return { data, statDate: latestDate, updatedAt: latestUpdated || String(latest.updated_at || latestDate) };
    })();

    _synergyRequests.set(month, request);
    request.catch(() => { _synergyRequests.delete(month); });   // 실패한 달은 다음에 다시 받는다
    return request;
}

function applySynergyResult(month, result) {
    SynergyState.month = month;
    SynergyState.data = result.data;
    SynergyState.statDate = result.statDate;
    SynergyState.updatedAt = result.updatedAt;
    SynergyState.failed = false;
    return SynergyState.data;
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
// 상단 메뉴 표시/숨김 (Supabase site_config.nav - 어드민 페이지에서 관리)
// ---------------------------------------------------------------------------
// 페이지를 열 때 읽어 바로 반영한다. 실패하면(조회 실패/오프라인) 아무것도 건드리지 않는다 -
// 메뉴가 사라지는 쪽보다 HTML에 박혀 있는 기본 상태를 그대로 두는 쪽이 안전한 실패다.
// 숨긴 방송통계 지표 탭. 설정을 읽기 전에는 비어 있다(= 아무것도 숨기지 않음).
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

// 메뉴·서브탭 표시 설정(site_config.nav). 페이지 초기화가 이 값(서브탭 기본값 등)을 쓰므로
// 처음에는 기다려야 하지만, 모든 페이지가 요청 한 번을 통째로 기다리던 걸 줄이려고 마지막 값을
// 브라우저에 기억해 두고 바로 쓴다. 새 값은 뒤에서 받아 달라졌을 때만 다시 적용한다.
// (관리자 화면은 편집 결과가 곧바로 보여야 하므로 기억해 둔 값을 쓰지 않는다.)
const NAV_CACHE_KEY = 'staruniv-nav-config';
async function fetchNavConfig() {
    const data = await Api.navConfig();
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
// opts.logos: true인 페이지만 대학 로고 목록(university_logos)을 받는다 - 로고를 그리는 곳은 전적·티어표뿐이다.
// 다른 페이지에서 teamLogoHtml/teamLogoSrc를 쓰기 시작하면 그 페이지에 logos: true를 준다(안 주면 이름 첫 글자 배지).
// 구역 제목(.section-title의 글자)은 div·span이라 화면 읽기 프로그램이 제목으로 모른다. 제목(2단계)으로 알려
// 구역 사이를 건너뛸 수 있게 한다. 페이지 초기화가 그려 넣은 것까지 잡도록 초기화 뒤에 한 번 부른다.
function markSectionHeadings(root = document) {
    root.querySelectorAll('.section-title .section-title-label:not([role])').forEach(el => {
        if (el.closest('h1, h2, h3, h4, h5, h6')) return;
        el.setAttribute('role', 'heading');
        el.setAttribute('aria-level', '2');
    });
}

function bootPage(init, opts) {
    const siteDataParts = opts && opts.siteData === false
        ? [] : ((opts && Array.isArray(opts.siteData)) ? opts.siteData : ['shell']);
    const start = async () => {
        // 상단 메뉴/서브탭은 데이터와 무관하게 이미 그려져 있으니, 데이터를 기다리지 않고
        // 먼저 붙인다(ResizeObserver가 이후 변화를 알아서 따라간다).
        initEdgeFades();
        watchSubTabDensity();
        // 메뉴/서브탭 기본값을 페이지 초기화 전에 확정한다. 사이트 데이터 파일과는 서로 무관하니 함께 받는다.
        await Promise.all([
            applyNavVisibility(),
            opts && opts.logos ? loadTeamLogos() : null,
            siteDataParts.length ? loadSiteData(siteDataParts) : null,
        ]);
        safeInit('페이지', init);
        markSectionHeadings();
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
// 통으로 넘겨도 되지만, 항목을 나눠 두면 상자가 표처럼 읽혀서 훨씬 빨리 훑힌다.
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

// 상자 내용을 다시 그린다. JSON이 아니면 줄글로 본다.
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

// 승패 표기. 사이트 어디서나 '20승 19패'로 같게 적는다('20-19'와 섞지 않는다).
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
