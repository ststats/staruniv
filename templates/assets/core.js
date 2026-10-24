// 사이트 공용 코어. 로드 순서: core.js → api.js → [soop.js 등] → page-<메뉴>.js
// data-click이나 다른 파일이 이름으로 부르는 함수는 전역 function으로 둔다.

// =====================================================================
// 1. 공용 유틸
// =====================================================================

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(
        /[&<>'"]/g,
        tag =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;',
            })[tag]
    );
}

// SOOP 시각은 오프셋 없는 한국 시간 글자라 +09:00을 붙인다(안 붙이면 보는 사람의 시간대로 읽힌다).
// 공백 구분 형식은 사파리에서 Invalid Date가 되므로 'T'로 바꾼다.
function parseSoopDate(value) {
    const text = String(value || '')
        .trim()
        .replace(' ', 'T');
    return new Date(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}+09:00` : text);
}

function formatLiveElapsed(broadStart) {
    if (!broadStart) return '';
    const startDate = parseSoopDate(broadStart);
    if (isNaN(startDate.getTime())) return '';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
    const eh = Math.floor(elapsedSec / 3600);
    const em = Math.floor((elapsedSec % 3600) / 60);
    return eh > 0 ? `${eh}시간 ${em}분` : `${em}분`;
}

function soopDateMs(value) {
    return parseSoopDate(value).getTime();
}

// "2025-01-02 ..." -> "25-01-02"
function shortMatchDate(value) {
    return value ? String(value).split(' ')[0].substring(2) : '';
}

function emptyStateHtml(text, extraClass) {
    return `<div class="content-state${extraClass ? ' ' + extraClass : ''}">${escapeHTML(text)}</div>`;
}

function emptyRowHtml(colspan, text, cellClass) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted ${cellClass || 'py-4'}">${text}</td></tr>`;
}

const EMPTY_MATCH_ROW_HTML = emptyRowHtml(6, '경기 기록이 없습니다');

function chevronDownSvg(size, extraAttrs) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${extraAttrs || ''}><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}

// 표시/숨김은 인라인 style 대신 d-none 클래스 하나로 한다
function setVisible(el, visible) {
    if (el) el.classList.toggle('d-none', !visible);
}

function isVisible(el) {
    return !!el && !el.classList.contains('d-none');
}

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
document.addEventListener('click', e => {
    const bar = document.querySelector('.top-navbar');
    if (!bar || !bar.classList.contains('menu-open')) return;
    if (e.target.closest('.nav-menu .nav-item') || !e.target.closest('.top-navbar')) toggleMainMenu(false);
});
window.addEventListener('resize', () => {
    if (window.innerWidth > 767.98) toggleMainMenu(false);
});

function scrollPageTo(where) {
    window.scrollTo({ top: where === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' });
}

// 시스템 설정은 저장된 테마가 없을 때의 기본값으로만 쓴다
function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#07090d' : '#ffffff');
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        const selected = button.dataset.themeChoice === (dark ? 'dark' : 'light');
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}
function setTheme(theme) {
    try {
        localStorage.setItem('staruniv-theme', theme);
    } catch (_) {}
    applyTheme(theme);
}
function storedTheme() {
    try {
        return localStorage.getItem('staruniv-theme');
    } catch (_) {
        return null;
    }
}
applyTheme(
    storedTheme() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
);
function toggleCollapsible(areaId, chevronId) {
    const area = document.getElementById(areaId);
    const chevron = document.getElementById(chevronId);
    const nowOpen = !isVisible(area);
    setVisible(area, nowOpen);
    if (chevron) chevron.classList.toggle('is-open', nowOpen);
    return nowOpen;
}

// 다시 그려지지 않는 정적 요소 전용. 다시 그려지는 요소에 쓰면 지워진 노드를 붙잡는다.
const _staticQueryCache = new Map();

function staticAll(selector) {
    if (!_staticQueryCache.has(selector))
        _staticQueryCache.set(selector, Array.from(document.querySelectorAll(selector)));
    return _staticQueryCache.get(selector);
}

function rafThrottle(fn) {
    let scheduled = false;
    return (...args) => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            fn(...args);
        });
    };
}

function rafThrottleByKey(fn) {
    const scheduled = new WeakSet();
    return (key, ...args) => {
        if (scheduled.has(key)) return;
        scheduled.add(key);
        requestAnimationFrame(() => {
            scheduled.delete(key);
            fn(key, ...args);
        });
    };
}

// tabs = { 키: [탭 id, 뷰 id] }
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

// 모달·접기: 부트스트랩 JS(80KB) 대신 직접 구현한다. 열림 상태는 .is-open이다.
const UI_FADE_MS = 300;
let openModalEl = null;
let modalBackdrop = null;
let modalReturnFocus = null;

function afterTransition(el, fn) {
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', finish);
        fn();
    };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, UI_FADE_MS + 50); // 애니메이션을 끈 환경에서는 transitionend가 안 온다
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
    // 폭이 바뀌면 전체 재배치로 멈칫한다. scrollbar-gutter를 못 쓰는 브라우저만 여백으로 메운다.
    if (scrollbar > 0 && !(CSS.supports && CSS.supports('scrollbar-gutter', 'stable')))
        document.body.style.paddingRight = `${scrollbar}px`;
    if (!modalBackdrop) {
        modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop fade';
        document.body.appendChild(modalBackdrop);
        void modalBackdrop.offsetWidth;
        modalBackdrop.classList.add('is-open');
    }
    el.style.display = 'block';
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    void el.offsetWidth;
    el.classList.add('is-open');
    afterTransition(el, () => {
        if (openModalEl === el) el.focus({ preventScroll: true });
    });
}

function hideModal(el, keepBackdrop) {
    if (!el || !el.classList.contains('is-open')) return;
    // 숨긴 창 안에 포커스가 남지 않게 먼저 뺀다
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.remove('is-open');
    if (openModalEl === el) openModalEl = null;
    afterTransition(el, () => {
        if (el.classList.contains('is-open')) return;
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
    backdrop.classList.remove('is-open');
    // 사라지는 도중에 스크롤바를 돌려놓으면 창이 왼쪽으로 밀린다
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
    const opening = !target.classList.contains('is-open');
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
        target.classList.remove('collapse', 'is-open');
        target.style.height = '0px';
    }
    afterTransition(target, () => {
        target.classList.remove('collapsing');
        target.classList.add('collapse');
        if (opening) target.classList.add('is-open');
        target.style.height = '';
    });
}

document.addEventListener('click', ev => {
    const dismiss = ev.target.closest('[data-dismiss="modal"]');
    if (dismiss) {
        hideModal(dismiss.closest('.modal'));
        return;
    }
    if (openModalEl && ev.target === openModalEl) {
        hideModal(openModalEl);
        return;
    }
    const toggle = ev.target.closest('[data-toggle="collapse"]');
    if (toggle) {
        ev.preventDefault();
        toggleCollapse(document.querySelector(toggle.dataset.target), toggle);
    }
});
document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && openModalEl) hideModal(openModalEl);
});
// 포커스 가두기
const MODAL_FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || !openModalEl) return;
    const items = [...openModalEl.querySelectorAll(MODAL_FOCUSABLE)].filter(
        x => !x.hidden && x.getClientRects().length > 0
    );
    if (!items.length) {
        ev.preventDefault();
        openModalEl.focus({ preventScroll: true });
        return;
    }
    const first = items[0],
        last = items[items.length - 1];
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

// 한 단계가 실패해도 다음 단계가 돌도록 격리한다(async 실패도 잡는다)
function safeInit(label, fn) {
    const report = e => console.error(`${label} 초기화 중 오류가 발생했습니다:`, e);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') result.catch(report);
    } catch (e) {
        report(e);
    }
}

// WAI-ARIA 탭 패턴의 화살표 키. Enter/Space는 core.js가 없는 멀티뷰어도 되도록 actions.js가 처리한다.
const TAB_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
document.addEventListener('keydown', e => {
    const el = e.target;
    if (!el || !el.matches) return;
    if (e.key in TAB_KEYS && el.matches('[role="tablist"] > [role="tab"]') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const list = el.parentElement;
        const visibleTabs = () =>
            [...list.children].filter(t => t.matches('[role="tab"]') && t.getClientRects().length);
        const tabs = visibleTabs();
        const step = TAB_KEYS[e.key];
        const i =
            step === 'first'
                ? 0
                : step === 'last'
                  ? tabs.length - 1
                  : (tabs.indexOf(el) + step + tabs.length) % tabs.length;
        e.preventDefault();
        if (tabs[i] === el) return;
        tabs[i].click();
        // 클릭으로 탭 목록이 다시 그려졌으면 같은 자리의 새 탭으로 옮긴다
        (tabs[i].isConnected ? tabs[i] : visibleTabs()[i])?.focus();
    }
});

// =====================================================================
// 2. 페이지별 사이트 데이터
// =====================================================================
// 계속 커지는 데이터라 HTML에 넣지 않고 필요한 묶음만 받는다(records는 빌드 파일).
const SiteData = {
    members: [],
    matches: [],
    rounds: [],
    playersStats: [],
    matchCount: 0,
    roundCount: 0,
    profiles: null,
};

// 종류별로 따로 관리해 부가 정보 실패가 명단을 지우지 않게 한다
const SiteDataLoad = { loaded: new Set(), pending: new Map(), errors: new Map() };

const asArray = v => (Array.isArray(v) ? v : []);

async function loadSiteData(parts) {
    const load = {
        members: () => Api.members(),
        profiles: () => Api.memberProfiles(),
        records: () => Api.siteData('records'),
    };
    await Promise.all(
        (Array.isArray(parts) ? parts : ['members']).map(part => {
            if (SiteDataLoad.loaded.has(part)) return;
            if (SiteDataLoad.pending.has(part)) return SiteDataLoad.pending.get(part);
            SiteDataLoad.errors.delete(part);
            const pending = Promise.resolve()
                .then(() => load[part]())
                .then(data => {
                    if (part === 'members') {
                        // _id는 화면에 칸으로 나오지 않게 열거되지 않는 속성으로 둔다
                        SiteData.members = asArray(data && data.members).map(({ _id, ...m }) =>
                            Object.defineProperty(m, '_id', { value: _id })
                        );
                        SiteData.matchCount = Number(data && data.matchCount) || 0;
                        SiteData.roundCount = Number(data && data.roundCount) || 0;
                    } else if (part === 'profiles') {
                        SiteData.profiles = (data && data.profiles) || {};
                    } else if (part === 'records') {
                        SiteData.matches = asArray(data && data.matches);
                        SiteData.rounds = asArray(data && data.rounds);
                        SiteData.playersStats = asArray(data && data.playersStats);
                    }
                    SiteDataLoad.loaded.add(part);
                    // 응답 순서와 무관하게 둘 다 준비되면 합친다
                    if (SiteData.profiles && SiteDataLoad.loaded.has('members')) {
                        SiteData.members.forEach(m => Object.assign(m, SiteData.profiles[m._id] || {}));
                        SiteData.profiles = null;
                    }
                })
                .catch(error => {
                    SiteDataLoad.errors.set(part, error);
                    console.error(`사이트 데이터(${part})를 불러오지 못했습니다:`, error);
                })
                .finally(() => {
                    SiteDataLoad.pending.delete(part);
                });
            SiteDataLoad.pending.set(part, pending);
            return pending;
        })
    );
}

// 데이터를 못 받았는데 화면이 '기록 없음'으로만 보이지 않게, 본문 맨 위에 알리고 새로고침 링크를 둔다
const SITE_DATA_NAMES = { members: '멤버', profiles: '멤버 프로필', records: '전적' };
function showSiteDataErrors(parts) {
    const failed = parts.filter(part => SiteDataLoad.errors.has(part));
    const main = document.querySelector('main');
    if (!failed.length || !main || main.querySelector('.site-data-error')) return;
    const box = document.createElement('div');
    box.className = 'content-state is-boxed site-data-error';
    box.setAttribute('role', 'alert');
    box.append(
        `${failed.map(part => SITE_DATA_NAMES[part] || part).join(', ')} 데이터를 불러오지 못했습니다. `,
        Object.assign(document.createElement('a'), { href: location.href, textContent: '새로고침' })
    );
    (main.querySelector('.page-section.active > .container') || main).prepend(box);
}

function findMemberById(id) {
    return SiteData.members.find(x => String(x._id) === String(id));
}

// 과거 경기와 공지 URL은 이름으로 저장되어 있다
function findMemberByName(name) {
    return SiteData.members.find(x => x['이름'] === name);
}

function findMemberBySoopId(soopId) {
    return SiteData.members.find(x => x['SOOP ID'] === soopId);
}

function findPlayerStats(name) {
    return SiteData.playersStats.find(x => x['이름'] === name) || {};
}

// { soop_id(소문자): 방송 행 }. 수집이 5분 넘게 멈추면 빈 목록이 온다. 여러 화면이 부르므로 20초 재사용한다.
const LIVE_BROADCASTS_TTL_MS = 20 * 1000;
let _liveBroadcasts = { at: 0, promise: null };
function fetchLiveBroadcasts() {
    if (_liveBroadcasts.promise && Date.now() - _liveBroadcasts.at < LIVE_BROADCASTS_TTL_MS)
        return _liveBroadcasts.promise;
    const promise = Api.liveBroadcasts().then(data => {
        if (!Array.isArray(data)) throw new Error('Invalid live status');
        const live = {};
        data.forEach(row => {
            if (row.soop_id && row.broad_no) live[String(row.soop_id).toLowerCase()] = row;
        });
        return live;
    });
    _liveBroadcasts = { at: Date.now(), promise };
    promise.catch(() => {
        if (_liveBroadcasts.promise === promise) _liveBroadcasts = { at: 0, promise: null };
    });
    return promise;
}

// LIVE 점만 찍는 화면용 가벼운 조회. 전체 방송 정보를 이미 받았으면 그걸 쓴다.
let _liveIds = { at: 0, promise: null };
function fetchLiveIds() {
    if (_liveBroadcasts.promise && Date.now() - _liveBroadcasts.at < LIVE_BROADCASTS_TTL_MS)
        return _liveBroadcasts.promise;
    if (_liveIds.promise && Date.now() - _liveIds.at < LIVE_BROADCASTS_TTL_MS) return _liveIds.promise;
    const promise = Api.liveSoopIds().then(data => {
        if (!Array.isArray(data)) throw new Error('Invalid live status');
        const live = {};
        data.forEach(row => {
            if (row.soop_id) live[String(row.soop_id).toLowerCase()] = true;
        });
        return live;
    });
    _liveIds = { at: Date.now(), promise };
    promise.catch(() => {
        if (_liveIds.promise === promise) _liveIds = { at: 0, promise: null };
    });
    return promise;
}

async function refreshSidebarLiveIndicators() {
    const dots = Array.from(document.querySelectorAll('.avatar-select-live[data-soop-id]'));
    if (!dots.length) return;
    const ids = [...new Set(dots.map(dot => dot.dataset.soopId).filter(Boolean))];
    const update = (id, live) => {
        document.querySelectorAll('.avatar-select-live[data-soop-id]').forEach(dot => {
            if (dot.dataset.soopId === id) dot.hidden = !live;
        });
    };
    try {
        const live = await fetchLiveIds();
        ids.forEach(id => update(id, Boolean(live[id.toLowerCase()])));
    } catch (_) {
        // 실패를 방송 종료로 보지 않고 직전 표시를 둔다
    }
}

// =====================================================================
// 3. 요청 시간 제한
// =====================================================================
// Api의 wrap 옵션. 재시도·본문 읽기까지 같은 시간 예산으로 취소된다.
function withTimeout(query, label, ms) {
    return query.run({ timeoutMs: ms, label });
}

// AbortSignal.timeout이 없는 브라우저(iOS 15 이하 사파리와 그 위의 카카오톡 등)에서도 쓰게 직접 만든다.
// 없으면 바로 TypeError가 나서 전적 데이터를 통째로 못 불러왔다. api.js도 이걸 쓴다(core.js가 먼저 실린다).
function timeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('요청 시간이 초과되었습니다', 'TimeoutError')), ms);
    return controller.signal;
}

// =====================================================================
// 4. 공용 표시 헬퍼
// =====================================================================

// 종족 뱃지(20x20)와 크기를 맞추려고 W/L/D 한 글자로 쓰고 승/패/무는 title에 둔다
function resultBadgeHtml(resText) {
    const res = String(resText == null ? '' : resText).trim();
    if (res === '승') return '<span class="match-badge badge-win" title="승">W</span>';
    if (res === '무' || res === '무승부') return '<span class="match-badge badge-draw" title="무">D</span>';
    if (res === '패') return '<span class="match-badge badge-lose" title="패">L</span>';
    // 결과가 비었거나 오타인 경기는 집계에서 빠지므로 '패'로 보이지 않게 따로 표시한다
    return '<span class="match-badge badge-draw" title="결과 미기재">-</span>';
}

const SOOP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidSoopId(soopId) {
    return !!soopId && SOOP_ID_PATTERN.test(String(soopId).trim());
}

function getProfileImgUrl(soopId) {
    if (!soopId) return null;
    const id = String(soopId).trim().toLowerCase();
    // 형식이 이상한 값은 URL에 넣지 않는다
    if (!id || !/^[a-z0-9_-]+$/.test(id)) return null;
    const prefix = id.substring(0, 2);
    return `https://stimg.sooplive.com/LOGO/${prefix}/${id}/m/${id}.webp`;
}

function avatarHtml(soopId, cls) {
    const url = getProfileImgUrl(soopId);
    if (!url) return `<span class="${cls} d-flex align-items-center justify-content-center">👤</span>`;
    return `<img src="${url}" class="${cls}" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, `${cls} d-flex align-items-center justify-content-center`, '👤')}>`;
}

function profileAvatarInnerHtml(soopId) {
    const url = getProfileImgUrl(soopId);
    return url ? `<img src="${url}" alt=""${actOn('error', 'imgSwap', ACT.el, '', '👤')}>` : '👤';
}

// 로고가 없는 팀은 이름 첫 글자 배지로 대신한다
function teamLogoFallback(imgEl, teamName) {
    const initial =
        String(teamName || '')
            .trim()
            .charAt(0) || '?';
    const span = document.createElement('span');
    span.className = 'team-logo-fallback';
    const size = imgEl.dataset.logoSize;
    if (size) {
        span.dataset.logoSize = size;
        span.style.setProperty('--logo-size', `${size}px`);
    }
    span.textContent = initial;
    imgEl.replaceWith(span);
}

// 대학 로고. 각 화면이 그 화면에 나오는 대학 이름으로 loadTeamLogos를 부른다.
const TeamLogos = { map: {}, pending: {} };
const LOGO_CACHE_KEY = 'staruniv-logos-v2'; // { 대학 이름: Storage 경로('' = 로고 없음) }
function teamLogoSrc(name) {
    return TeamLogos.map[name] || '';
}
// 올린 미디어 주소: 저장소에 둔 대표 영상(templates/static/media/members/)은 사이트 파일 그대로, 나머지는 Storage
function siteMediaUrl(path) {
    const raw = String(path || '');
    return /^media\/members\/[a-z0-9_-]+\.[a-z0-9]+(\?v=[0-9a-f]+)?$/.test(raw) ? raw : storageMediaUrl(raw);
}
const memberPhotoUrl = m => siteMediaUrl(m && m['대표 사진']);
const isVideoUrl = src => /\.(mp4|webm)(\?|$)/i.test(src);

function setTeamLogos(paths) {
    Object.entries(paths).forEach(([name, path]) => {
        const url = storageMediaUrl(path);
        if (url) TeamLogos.map[name] = url;
        else delete TeamLogos.map[name];
    });
}
// 저장해 둔 대학은 바로 쓰고 뒤에서 다시 받는다. 처음 보는 대학이 있을 때만 기다린다.
async function loadTeamLogos(names) {
    const wanted = [
        ...new Set(
            asArray(names)
                .map(n => String(n || '').trim())
                .filter(Boolean)
        ),
    ];
    if (!wanted.length) return;
    let cached = {};
    try {
        cached = JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || '{}') || {};
    } catch (_) {}
    const known = wanted.filter(n => Object.prototype.hasOwnProperty.call(cached, n));
    setTeamLogos(Object.fromEntries(known.map(n => [n, cached[n]])));
    const ask = wanted.filter(n => !TeamLogos.pending[n]);
    if (ask.length) {
        const request = Api.universityLogos(ask).then(rows => {
            const paths = Object.fromEntries(ask.map(n => [n, '']));
            asArray(rows).forEach(r => {
                if (r && r.name && ask.includes(r.name)) paths[r.name] = r.path || '';
            });
            setTeamLogos(paths);
            try {
                const all = JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || '{}') || {};
                localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(Object.assign(all, paths)));
            } catch (_) {}
        });
        ask.forEach(n => {
            TeamLogos.pending[n] = request;
        });
        request.catch(() =>
            ask.forEach(n => {
                if (TeamLogos.pending[n] === request) delete TeamLogos.pending[n];
            })
        );
    }
    const waits = [...new Set(wanted.filter(n => !known.includes(n)).map(n => TeamLogos.pending[n]))];
    try {
        await Promise.all(waits);
    } catch (e) {
        console.warn('대학 로고를 불러오지 못했습니다. 이름 첫 글자 배지로 대신합니다.', e);
    }
}

function teamLogoHtml(teamName, sizePx) {
    const name = String(teamName || '').trim();
    if (!name) return '';
    const fileName = name === '내전' ? '캄몬스타즈' : name;
    const size = sizePx || 16;
    const src = teamLogoSrc(fileName);
    // 로고 목록이 늦게 오면 swapTeamLogoFallbacks가 data-logo-team으로 찾아 바꾼다
    if (!src) {
        const initial = escapeHTML(Array.from(name)[0] || '?');
        return `<span class="team-logo-fallback" data-logo-team="${escapeHTML(name)}" data-logo-size="${size}" style="--logo-size:${size}px">${initial}</span>`;
    }
    // 크기는 변수로만 넘겨 CSS가 !important 없이 줄일 수 있게 한다
    return `<img src="${escapeHTML(src)}" alt="" class="team-logo-icon" loading="lazy" data-logo-size="${size}" style="--logo-size:${size}px"${actOn('error', 'teamLogoFallback', ACT.el, name)}>`;
}

function swapTeamLogoFallbacks(root = document) {
    root.querySelectorAll('.team-logo-fallback[data-logo-team]').forEach(el => {
        const name = el.dataset.logoTeam;
        if (!teamLogoSrc(name === '내전' ? '캄몬스타즈' : name)) return;
        el.outerHTML = teamLogoHtml(name, Number(el.dataset.logoSize) || 16);
    });
}

function teamCellInnerHtml(teamName) {
    return `<span class="team-cell">${teamLogoHtml(teamName)}<span class="ellipsis-text">${escapeHTML(teamName)}</span></span>`;
}

// staruniv.sql의 tier_ladder·멤버 목록 정렬과 같아야 한다(npm test가 확인한다). ststat의 티어 순서와도 같아야 한다.
// prettier-ignore
const SITE_ORDER = {
    "tiers": ["갓", "킹", "잭", "조커", "스페이드", "0", "1", "2", "3", "4", "5", "6", "7", "8", "베이비"],
    "roles": ["감독", "코치", "선수"]
};
const TIER_ORDER = SITE_ORDER.tiers;
// DB의 '체크'는 아직 티어를 매기지 않은 사람이다
const TIER_UNRANKED = new Set(['체크', '미분류']);

function tierIndex(tier) {
    const idx = TIER_ORDER.indexOf(String(tier));
    return idx === -1 ? TIER_ORDER.length : idx;
}

// EloBoard 값과 티어표 값을 같은 기준으로 비교하려고 한 글자로 맞춘다
function raceCode(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    if (upper === 'T' || upper === 'TERRAN' || raw === '테란') return 'T';
    if (upper === 'P' || upper === 'PROTOSS' || raw === '프로토스') return 'P';
    if (upper === 'Z' || upper === 'ZERG' || raw === '저그') return 'Z';
    if (upper === 'R' || upper === 'RANDOM' || raw === '랜덤') return 'R';
    return upper;
}

// 화면에 적는 종족 글자. 모르면 '-'
function raceShortLabel(race) {
    return raceCode(race) || '-';
}
const RACE_NAMES = { T: '테란', Z: '저그', P: '프로토스', R: '랜덤' };

function raceBadgeClass(race) {
    const letter = raceShortLabel(race);
    return ['T', 'Z', 'P'].includes(letter) ? ` race-badge race-${letter}` : '';
}

// 카드 왼쪽 종족 색 띠(edge-T/Z/P): 뱃지 글자를 읽지 않고도 종족 분포가 한눈에 보인다. 모르는 종족은 띠가 없다
function raceEdgeClass(race) {
    const letter = raceShortLabel(race);
    return ['T', 'Z', 'P'].includes(letter) ? ` edge-${letter}` : '';
}

function raceBadgeHtml(race, extraClass = '') {
    return `<span class="tag-badge${raceBadgeClass(race)}${extraClass}">${escapeHTML(raceShortLabel(race))}</span>`;
}

// 표·카드의 선수 이름 + 종족 뱃지. 종족을 모르면 이름만. badgeAfter면 뱃지를 이름 뒤에 두고, 이름이 잘릴 자리면 뱃지를 뺀다.
function raceNameHtml(race, name, badgeAfter = false) {
    const badge = race ? raceBadgeHtml(race, ' race-inline') : '';
    const text = `<span class="race-name-text">${escapeHTML(name)}</span>`;
    return badgeAfter
        ? `<span class="race-name is-after">${text + badge}</span>`
        : `<span class="race-name">${badge + text}</span>`;
}

// '스페이드티어'는 좁은 칸에서 줄바꿈되어 이름만 적는다
const TIER_NO_SUFFIX = new Set(['스페이드']);

function tierLabel(tier) {
    const raw = tier === undefined || tier === null ? '' : String(tier).trim();
    if (!raw || TIER_UNRANKED.has(raw)) return '미분류';
    return TIER_NO_SUFFIX.has(raw) ? raw : `${raw}티어`;
}

function tierBadgeHtml(tier) {
    return `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(tier))}</span>`;
}

// 반 뱃지. 값 목록은 staruniv.sql class_group 제약과 같아야 한다(npm test가 확인). 어드민 선택지도 이것을 쓴다.
const CLASS_GROUPS = { 우등반: 'top', 중등반: 'mid', 열등반: 'low' };

function classBadgeClass(group) {
    return CLASS_GROUPS[group] ? ` class-${CLASS_GROUPS[group]}` : '';
}

function classBadgeHtml(group) {
    return CLASS_GROUPS[group] ? `<span class="tag-badge${classBadgeClass(group)}">${escapeHTML(group)}</span>` : '';
}

function applyBadge(el, text, className) {
    if (!el) return;
    el.textContent = text;
    el.className = className;
}

// 선수는 종족 뱃지 색과 겹치지 않게 진한 네이비다
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

function activeMembersWithSoopId() {
    return SiteData.members.filter(m => isActiveMember(m) && isValidSoopId(m['SOOP ID']));
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// 'YYYY-MM-DD' → '10.16 FRI'(캘린더 오늘 제목·홈 기념일)
function dayLabel(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} ${WEEKDAYS_EN[new Date(y, m - 1, d).getDay()]}`;
}

// 날짜(기본 오늘)를 YYYY-MM-DD로. 로컬 기준이다. toISOString()은 UTC라 한국 시간 0~9시에 어제가 된다.
function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.floor((end - start) / 86400000) + 1;
}

// 뱃지 한 칸에 들어가도록 일수만 적고 기간 범위는 title에 둔다
function memberPeriodBadgeHtml(m) {
    const join = m && m['입단일'];
    if (!join) return '<span class="rank-badge-text">활동기간 -</span>';
    const active = isActiveMember(m);
    const end = active ? '현재' : m['퇴단일'] || '-';
    const range = `${String(join).replace(/-/g, '.')} ~ ${String(end).replace(/-/g, '.')}`;
    const days = daysBetween(join, active ? todayStr() : m['퇴단일'] || null);
    const text = days === null ? range : `${formatNum(days)}일${active ? '째' : ''}`;
    return `<span class="rank-badge-text" title="활동기간 ${escapeHTML(range)}">${escapeHTML(text)}</span>`;
}

// 실제 youtube.com / youtu.be 주소일 때만 주소를 준다. "@핸들"은 채널 주소로 바꾼다.
function memberYoutubeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^@[\w.\-]+$/.test(raw)) return 'https://www.youtube.com/' + raw;
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
        const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
        if (host !== 'youtube.com' && host !== 'youtu.be') return '';
        url.protocol = 'https:';
        return url.href;
    } catch (e) {
        return '';
    }
}

// 많은 멤버를 훑을 때는 종족·티어가 중요해서 프로필 사진은 넣지 않는다
// onclickFn은 함수 이름이나 [함수 이름, 이름 앞에 넘길 값…]. side는 오른쪽 글자(기본은 티어, ''면 비움)
function avatarSelectItemHtml(idPrefix, name, soopId, onclickFn, member, side) {
    const m = member || {};
    const [fn, ...lead] = [].concat(onclickFn);
    const race = m['종족'] || '';
    const edgeClass = raceEdgeClass(race);
    const tierText = side ?? tierLabel(m['티어']).replace('티어', '');
    return `<div class="avatar-select-item${edgeClass}" id="${idPrefix}${escapeHTML(name)}" role="button" tabindex="0"${act(fn, ...lead, name)}>
                            ${race ? raceBadgeHtml(race) : ''}
                            <span class="avatar-select-name">${escapeHTML(name)}</span>
                            <span class="avatar-select-live" data-soop-id="${escapeHTML(soopId || '')}" hidden></span>
                            <span class="avatar-select-tier">${escapeHTML(tierText)}</span>
                        </div>`;
}

function avatarSelectAllItemHtml(id, action, countText) {
    return `<div class="avatar-select-item avatar-select-all active" id="${id}" role="button" tabindex="0"${action}>
                            <span class="avatar-select-name">전체</span>
                            <span class="avatar-select-tier">${escapeHTML(countText || '')}</span>
                       </div>`;
}

// '전체' 칸은 가로 스크롤과 같이 흘러가지 않도록 스크롤 영역 밖에 둔다
function renderAvatarBar(listId, allItemHtml, itemsHtml) {
    const list = document.getElementById(listId);
    if (!list) return;
    avatarBarTools(list).querySelector('.bar-scope').innerHTML = allItemHtml;
    list.innerHTML = itemsHtml;
    attachBarScroll(list.parentElement);
}

// PC 가로 바는 마우스로 끌어 넘긴다. 5px 넘게 끌었으면 뗄 때의 클릭은 버린다.
function attachBarScroll(el) {
    if (!el || el._barScroll) return;
    const bar = el.closest('.avatar-bar, .tier-bar');
    if (!bar) return;
    el._barScroll = true;

    const update = () => bar.classList.toggle('is-scrollable', el.scrollWidth - el.clientWidth > 1);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
    else window.addEventListener('resize', update);
    new MutationObserver(update).observe(el, { childList: true, subtree: true });

    let startX = 0,
        startLeft = 0,
        moved = false,
        id = null;
    el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !bar.classList.contains('is-scrollable')) return;
        id = e.pointerId;
        startX = e.clientX;
        startLeft = el.scrollLeft;
        moved = false;
    });
    el.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < 5) return;
        if (!moved) {
            moved = true;
            el.setPointerCapture(id);
            bar.classList.add('is-dragging');
        }
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
    el.addEventListener(
        'click',
        e => {
            if (!el._dragged) return;
            el._dragged = false;
            e.preventDefault();
            e.stopPropagation();
        },
        true
    );
    el.addEventListener('dragstart', e => e.preventDefault());
    update();
}

// 바가 position:sticky라 offsetLeft는 고정 칸 폭만큼 어긋난다. 목록 기준 좌표를 직접 구한다.
function centerBarItem(item) {
    if (!item) return;
    const bar = item.closest('.avatar-bar, .tier-bar');
    const list =
        item.closest('.avatar-selector-scroll, .tier-bar-list') ||
        (bar && bar.querySelector('.avatar-selector-scroll, .tier-bar-list'));
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

// 모바일에서 바를 접고 펴는 '현재 선택' 줄. 아바타 바·티어 바가 같이 쓴다.
function createBarPick(bar, className, label) {
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = className;
    pick.setAttribute('aria-expanded', 'false');
    pick.innerHTML =
        `<span class="${className}-label">${escapeHTML(label)}</span>` +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    pick.addEventListener('click', () => {
        const closed = bar.classList.toggle('is-closed');
        pick.setAttribute('aria-expanded', closed ? 'false' : 'true');
    });
    bar.classList.add('is-closed');
    return pick;
}

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
    // 티어 바와 같은 .bar-scope에 넣어 두 바의 높이를 맞춘다
    const scope = document.createElement('div');
    scope.className = 'bar-scope';
    tools.appendChild(scope);
    bar.appendChild(createBarPick(bar, 'avatar-bar-pick', '전체'));
    scroll.replaceWith(bar);
    bar.appendChild(tools);
    bar.appendChild(scroll);
    return tools;
}

// '전체'는 목록 밖에 있어 바 전체에서 active를 지운다
function setActiveAvatarItem(listId, activeEl) {
    const list = document.getElementById(listId);
    const scope = list && (list.closest('.avatar-bar') || list);
    if (scope) scope.querySelectorAll('.avatar-select-item').forEach(el => el.classList.remove('active'));
    if (activeEl) activeEl.classList.add('active');
    centerBarItem(activeEl);

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

// 얇은 줄에는 스크롤바 자리가 없어 넘치는 쪽 끝을 흐리게 한다. CSS는 스크롤 위치를 몰라 클래스로 알린다.
function attachEdgeFade(el) {
    if (!el) return null;
    if (el._edgeFadeUpdate) return el._edgeFadeUpdate;

    const update = () => {
        const max = el.scrollWidth - el.clientWidth;
        // 배율 소수점 오차로 끝에 닿아도 1px쯤 남는다
        el.classList.toggle('is-fade-start', el.scrollLeft > 1);
        el.classList.toggle('is-fade-end', max > 1 && el.scrollLeft < max - 1);
    };
    el.addEventListener('scroll', update, { passive: true });

    // 숨은 탭 안의 줄은 폭이 0이라, 처음 보일 때를 잡으려면 ResizeObserver가 필요하다
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
    else window.addEventListener('resize', update);

    el._edgeFadeUpdate = update;
    update();
    return update;
}

function initEdgeFades(root) {
    (root || document).querySelectorAll('.tab-scroll').forEach(attachEdgeFade);
}

// 보이는 서브탭이 4~5개면 좁은 화면에서 한 줄에 나눠 담는다(줄이 늘면 히어로 높이가 페이지마다 달라진다).
function syncSubTabDensity() {
    document.querySelectorAll('.page-header > .sub-tabs').forEach(el => {
        const n = [...el.children].filter(c => getComputedStyle(c).display !== 'none').length;
        const dense = n >= 4 && n <= 5;
        if (dense && el.dataset.tabDense === undefined) el.dataset.tabDense = '';
        else if (!dense && el.dataset.tabDense !== undefined) delete el.dataset.tabDense;
    });
}
// 탭 표시는 탭 자신의 hidden·class로만 바뀌므로 body 전체가 아니라 서브탭 줄만 본다
function watchSubTabDensity() {
    syncSubTabDensity();
    if (typeof MutationObserver === 'undefined') return;
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            syncSubTabDensity();
        }, 0); // rAF는 백그라운드 탭에서 멈춘다
    });
    document.querySelectorAll('.page-header > .sub-tabs').forEach(el => {
        observer.observe(el, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['hidden', 'class'],
        });
    });
}

// =====================================================================
// 5. 방송통계 데이터
// =====================================================================
const SynergyState = {
    data: null,
    updatedAt: '',
    month: '', // ''이면 가장 최근 달
    statDate: '', // 그달 1일부터 이날까지의 누적
    failed: false,
    loading: false,
    metric: 'balloons',
};

function formatSecondsToHM(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${formatNum(h)}시간 ${m}분`; // 합계는 1만 시간을 넘는다
}

// toLocaleString('ko-KR')은 첫 호출에 수십 ms 멈춰서 정수는 직접 쉼표를 넣는다
function formatNum(value) {
    const n = Number(value) || 0;
    if (!Number.isSafeInteger(n)) return n.toLocaleString('ko-KR');
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatCount(value, unit) {
    return formatNum(value || 0) + unit;
}

function formatSponsorRecord(wins, losses) {
    wins = wins || 0;
    losses = losses || 0;
    const total = wins + losses;
    const rate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    return `${wins}승 ${losses}패 (${rate}%)`;
}

// =====================================================================
// 6. 선수 프로필 창 (partials/profile_modal.html) - 멤버 페이지와 티어표 현황판
// =====================================================================
// p: { name, soopId, role, tier, race, classGroup, facts: [[이름, 값]], joinTier, period, days, eloId, recordsUrl, youtube }
// 입단 티어·활동기간(period가 없으면)과 소속 전적(recordsUrl이 없으면)은 숨긴다.
// activity(): 이번 달 방송통계 한 줄(없으면 null). 값이나 Promise를 돌려준다.
let _profileSeq = 0;
function openProfileModal(p, activity) {
    const seq = ++_profileSeq;
    document.getElementById('mp-name').innerText = p.name;
    const roleBadge = document.getElementById('mp-role-badge');
    applyBadge(roleBadge, p.role || '미정', 'tag-badge role-badge');
    roleBadge.style.background = roleColor(p.role); // 직책마다 달라지는 동적 색이라 인라인
    applyBadge(document.getElementById('mp-race-badge'), raceShortLabel(p.race), 'tag-badge' + raceBadgeClass(p.race));
    applyBadge(document.getElementById('mp-tier-badge'), tierLabel(p.tier), 'tag-badge tier-badge');
    const classBadge = document.getElementById('mp-class-badge');
    applyBadge(classBadge, p.classGroup, 'tag-badge' + classBadgeClass(p.classGroup));
    classBadge.hidden = !p.classGroup;
    document.getElementById('mp-avatar').innerHTML = profileAvatarInnerHtml(p.soopId);

    document.getElementById('mp-info-body').innerHTML = (p.facts || [])
        .map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value || '-')}</dd></div>`)
        .join('');
    document.getElementById('mp-period-block').hidden = !p.period;
    document.getElementById('mp-period').textContent = p.period || '-';
    document.getElementById('mp-join-tier').textContent = p.joinTier ? tierLabel(p.joinTier) : '-';
    const daysEl = document.getElementById('mp-days');
    daysEl.hidden = !Number.isFinite(p.days);
    daysEl.textContent = daysEl.hidden ? '' : formatNum(p.days) + '일';

    // href 없는 a에는 target·rel을 둘 수 없다
    const setLink = (id, url, external) => {
        const a = document.getElementById(id);
        a.hidden = !url;
        ['href', 'target', 'rel'].forEach(k => a.removeAttribute(k));
        if (url) Object.assign(a, external ? { href: url, target: '_blank', rel: 'noopener' } : { href: url });
        return a;
    };
    // 이 입단 때 쓴 ELO ID로만 간다. 같은 사람의 다른 계정이 섞이지 않게 티어표 메인 계정으로 대신 가지 않는다.
    const eloId = String(p.eloId ?? '').trim();
    const analysis = setLink(
        'mp-analysis-link',
        /^\d+$/.test(eloId) ? 'tier/?view=analysis&p=' + encodeURIComponent(eloId) : ''
    );
    const records = setLink('mp-records-link', p.recordsUrl || '');
    document.getElementById('mp-site-links').hidden = analysis.hidden && records.hidden;
    const soopId = String(p.soopId || '').trim();
    const station = setLink(
        'mp-station-link',
        isValidSoopId(soopId) ? 'https://www.sooplive.com/station/' + encodeURIComponent(soopId) : '',
        true
    );
    const youtube = setLink('mp-youtube-link', memberYoutubeUrl(p.youtube), true);
    document.getElementById('mp-external-links').hidden = station.hidden && youtube.hidden;

    // 받는 중에 안내 줄을 띄우면 줄이 사라질 때 창 높이가 튄다. 늦게 온 이전 선수의 값은 버린다.
    const status = document.getElementById('mp-activity-status');
    const show = entry => {
        if (seq !== _profileSeq) return;
        status.innerText = '';
        // 기록이 없으면 '-'로 충분하다(안내 줄은 창 높이만 늘린다).
        const values = entry
            ? [
                  formatCount(entry.balloons, '개'),
                  formatSecondsToHM(entry.broadcast_seconds),
                  formatCount(entry.cumulative_viewers, '명'),
                  formatSponsorRecord(entry.sponsor_wins, entry.sponsor_losses),
              ]
            : ['-', '-', '-', '-'];
        ['mp-balloons', 'mp-broadcast-hours', 'mp-viewers', 'mp-sponsor-record'].forEach((id, i) => {
            document.getElementById(id).innerText = values[i];
        });
    };
    let result;
    try {
        result = activity ? activity() : null;
    } catch (e) {
        result = Promise.reject(e);
    }
    if (result && typeof result.then === 'function') {
        show(null);
        result.then(show, err => {
            console.error(err);
            show(null);
            if (seq === _profileSeq) status.innerText = '불러오지 못했습니다';
        });
    } else show(result);
    showModal('memberProfileModal');
}

function formatKstDateTime(value, includeTime) {
    if (!value) return '';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return String(value).slice(0, includeTime ? 19 : 10);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } : {}),
    })
        .formatToParts(parsed)
        .reduce((out, part) => {
            if (part.type !== 'literal') out[part.type] = part.value;
            return out;
        }, {});
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return includeTime ? `${date} ${parts.hour}:${parts.minute}:${parts.second} KST` : date;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 하루치 행은 월 누적이라 각 달의 마지막 날짜가 그달 최종 기록이다
let _synergyMonthsRequest = null;
let _synergyMonthsExpiresAt = 0;
const STATS_LATEST_CACHE_MS = 5 * 60 * 1000;
const STATS_HISTORY_CACHE_MS = 60 * 60 * 1000;
function fetchSynergyMonths() {
    if (_synergyMonthsRequest && Date.now() < _synergyMonthsExpiresAt) return _synergyMonthsRequest;
    _synergyMonthsExpiresAt = Infinity; // 진행 중인 요청도 공유한다
    _synergyMonthsRequest = (async () => {
        const rows = await Api.statsDates();
        const months = [];
        rows.forEach(r => {
            const date = String((r && r.stat_date) || '');
            if (date && (!months.length || months[months.length - 1].month !== date.slice(0, 7))) {
                months.push({ month: date.slice(0, 7), date });
            }
        });
        _synergyMonthsExpiresAt = Date.now() + STATS_LATEST_CACHE_MS;
        return months;
    })();
    _synergyMonthsRequest.catch(() => {
        _synergyMonthsRequest = null;
    });
    return _synergyMonthsRequest;
}

// 월 결산은 말일 기준이다
function memberAtMonthEnd(m, month) {
    const joined = String(m['입단일'] || '').trim() || '0000-00-00';
    const left = String(m['퇴단일'] || '').trim() || '9999-99-99';
    return joined.slice(0, 7) <= month && left.slice(0, 7) > month;
}

// fetchSynergyResult는 상태를 바꾸지 않는다. 늦게 온 응답이 덮지 않게 부르는 쪽이 확인 후 적용한다.
const _synergyRequests = new Map();
function isSynergyResultFresh(month = '') {
    const entry = _synergyRequests.get(month);
    return !!entry && Date.now() < entry.expiresAt;
}
function fetchSynergyData(month = '') {
    return fetchSynergyResult(month).then(
        result => applySynergyResult(month, result),
        err => {
            SynergyState.failed = true;
            throw err;
        }
    );
}

function fetchSynergyResult(month = '') {
    if (isSynergyResultFresh(month)) {
        const entry = _synergyRequests.get(month);
        _synergyRequests.delete(month);
        _synergyRequests.set(month, entry);
        return entry.request;
    }

    const request = (async () => {
        // 재입단으로 같은 SOOP ID 기록이 여럿일 수 있어 활동 중 → 입단일이 늦은 기록 순으로 고른다
        const joinedAt = m => String(m['입단일'] || '').trim();
        const better = (a, b) =>
            !month && isActiveMember(a) !== isActiveMember(b) ? isActiveMember(a) : joinedAt(a) > joinedAt(b);
        const idToMember = new Map();
        SiteData.members.forEach(m => {
            const originalId = String(m['SOOP ID'] || '').trim();
            const soopId = originalId.toLowerCase();
            if (!soopId) return;
            if (month && !memberAtMonthEnd(m, month)) {
                if (!idToMember.has(soopId)) idToMember.set(soopId, null);
                return;
            }
            const prev = idToMember.get(soopId);
            if (!prev || better(m, prev)) idToMember.set(soopId, m);
        });
        const memberIds = [...idToMember.values()]
            .filter(Boolean)
            .map(m => String(m['SOOP ID'] || '').trim())
            .filter(Boolean);
        if (!memberIds.length) throw new Error('조회할 StarUniv 선수 ID가 없습니다');

        // 최근 달은 날짜 목록을 기다리지 않고 한 번에 받고, 실패하면 달 목록 경로로 받는다
        let latestDate = '';
        let rows = null;
        if (!month) {
            try {
                rows = await Api.statsLatest(memberIds);
                latestDate = rows.length ? String(rows[0].stat_date || '') : '';
            } catch (_) {
                /* 아래 경로로 받는다 */
            }
            if (!latestDate) rows = null;
        }
        if (!rows) {
            const months = await fetchSynergyMonths();
            const found = month ? months.find(m => m.month === month) : months[0];
            if (month && !found) throw new Error(`${month} 방송통계가 없습니다`);
            latestDate = found && found.date ? String(found.date) : '';
            if (!latestDate) throw new Error('사용 가능한 방송통계 날짜가 없습니다');
            rows = await Api.stats(latestDate, memberIds);
        }
        if (!rows.length) throw new Error(`${latestDate} 방송통계 데이터가 없습니다`);

        const data = rows
            .map(row => {
                const soopId = String((row && row.soop_id) || '')
                    .trim()
                    .toLowerCase();
                const ours = idToMember.get(soopId);
                if (!ours) return null;
                return {
                    id: row.soop_id,
                    nickname: row.nickname,
                    balloons: Number(row.balloons || 0),
                    broadcast_seconds: Number(row.broadcast_seconds || 0),
                    cumulative_viewers: Number(row.cumulative_viewers || 0),
                    // 집계 시작 전 날짜는 null이라 0과 구분한다
                    viewership_seconds: row.viewership_seconds == null ? null : Number(row.viewership_seconds),
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
        return { data, statDate: latestDate, updatedAt: latestUpdated || latestDate };
    })();

    const entry = { request, expiresAt: Infinity };
    _synergyRequests.delete(month);
    _synergyRequests.set(month, entry);
    request.then(
        () => {
            entry.expiresAt = Date.now() + (month ? STATS_HISTORY_CACHE_MS : STATS_LATEST_CACHE_MS);
            // 최근 32개월만 두고, 진행 중인 요청은 지우지 않는다
            for (const [key, value] of _synergyRequests) {
                if (_synergyRequests.size <= 32) break;
                if (value.expiresAt !== Infinity) _synergyRequests.delete(key);
            }
        },
        () => {
            if (_synergyRequests.get(month) === entry) _synergyRequests.delete(month);
        }
    );
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
// 7. 페이지 상태(URL 쿼리) / 페이지 시작
// =====================================================================

// 페이지 안 상태를 쿼리에 반영한다. 뒤로·앞으로 복원 중에는 앞으로가기 기록이 지워지지 않게 replaceState를 쓴다.
const PageState = {
    restoring: false,
    update(params) {
        const qs = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v) qs.set(k, v);
        });
        const qsStr = qs.toString();
        const url = location.pathname + (qsStr ? '?' + qsStr : '');
        if (url === location.pathname + location.search) return;
        if (this.restoring) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
    },
    bindRestore(restore) {
        const run = () => {
            this.restoring = true;
            try {
                restore(new URLSearchParams(location.search));
            } finally {
                this.restoring = false;
            }
        };
        window.addEventListener('popstate', run);
        run();
    },
};

// ---------------------------------------------------------------------------
// 메뉴·서브탭 표시 설정(site_config.nav)
// ---------------------------------------------------------------------------
// 실패하면 메뉴가 사라지지 않도록 HTML 기본 상태를 그대로 둔다.
let SiteRuntimeConfig = {};
function runtimePageId() {
    return (
        document.body.dataset.adminPage ||
        document.querySelector('.page-section.active')?.id?.replace(/^page-/, '') ||
        location.pathname.split('/').filter(Boolean).pop() ||
        'home'
    );
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
function publicSubtabKey(id) {
    return id.replace(/^tab-(?:member-|tools-|video-|tier-|stats-)?/, '');
}

// 요청을 기다리지 않도록 마지막 값을 기억해 두고 바로 쓴다. 관리자 화면은 늘 최신 값을 쓴다.
const NAV_CACHE_KEY = 'staruniv-nav-config';
async function fetchNavConfig() {
    const data = await Api.navConfig();
    try {
        localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(data));
    } catch (_) {}
    return data;
}

// 설정 응답 전에도 runtimeDefaultSubtab이 기억해 둔 값을 읽게 한다
function seedRuntimeConfigFromCache() {
    if (document.body.classList.contains('admin-mode') || Object.keys(SiteRuntimeConfig).length) return;
    const cached = cachedNavConfig();
    if (cached) SiteRuntimeConfig = cached;
}
// 브라우저에 기억해 둔 값, 없으면 빌드가 넣은 <meta name="nav-config">
function cachedNavConfig() {
    if (document.body.classList.contains('admin-mode')) return null;
    for (const read of [
        () => localStorage.getItem(NAV_CACHE_KEY),
        () => document.querySelector('meta[name="nav-config"]')?.content,
    ]) {
        try {
            const value = JSON.parse(read() || 'null');
            if (value && typeof value === 'object') return value;
        } catch (_) {}
    }
    return null;
}

async function applyNavVisibility() {
    const cached = cachedNavConfig();
    const fresh = fetchNavConfig();
    if (cached) {
        applyNavConfig(cached);
        fresh
            .then(data => {
                if (JSON.stringify(data) !== JSON.stringify(cached)) applyNavConfig(data);
            })
            .catch(e => console.warn('사이트 표시 설정을 새로 받지 못했습니다.', e));
        return;
    }
    let data = null;
    try {
        data = await fresh;
    } catch (e) {
        console.warn('사이트 표시 설정을 불러오지 못했습니다.', e);
    }
    if (data) applyNavConfig(data);
    delete document.documentElement.dataset.navPending;
}

// 사이트 문구는 끝에 마침표·말줄임표를 붙이지 않는다
function trimEndPunct(text) {
    return String(text || '')
        .trim()
        .replace(/(?:\.|…)+$/, '')
        .trim();
}
function setHeroDescription(subtitle, text) {
    if (subtitle.id === 'tier-subtitle' && subtitle.firstChild)
        subtitle.firstChild.nodeValue = (text ? text + '. ' : '') + '출처 : ';
    else subtitle.textContent = text;
}

function setHomeHeroTitle(title, text) {
    const letters = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(String(text))].map(
        x => x.segment
    );
    title.innerHTML = `<span>${escapeHTML(letters.slice(0, 2).join(''))}</span><i>${escapeHTML(letters.slice(2).join(''))}</i>`;
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
            const key = publicSubtabKey(el.id);
            const hiddenSub = sub.hidden.includes(key);
            el.hidden = hiddenSub && !isAdmin;
            el.classList.toggle('admin-config-hidden', hiddenSub && isAdmin);
        });

        const heroDescriptions =
            data.heroDescriptions && typeof data.heroDescriptions === 'object' ? data.heroDescriptions : {};
        const heroText = trimEndPunct(heroDescriptions[pageId]);
        if (hasOwn(heroDescriptions, pageId)) {
            const subtitle = document.querySelector('.page-section.active > .page-header .page-header-subtitle');
            if (subtitle) setHeroDescription(subtitle, heroText);
        }

        const carousel = data.homeCarousel && typeof data.homeCarousel === 'object' ? data.homeCarousel : {};
        // 기념일 장이 앞에 끼어도 어긋나지 않게 순서가 아니라 data-carousel 키로 찾는다
        document.querySelectorAll('.home-carousel-slide[data-carousel]').forEach(slide => {
            const cfg = carousel[slide.dataset.carousel];
            if (!cfg) return;
            const title = slide.querySelector('.page-header-title');
            const desc = slide.querySelector('.page-header-subtitle');
            const link = slide.querySelector('.home-hero-links a');
            if (title && cfg.title) setHomeHeroTitle(title, cfg.title);
            if (desc && hasOwn(cfg, 'description')) desc.textContent = trimEndPunct(cfg.description);
            if (link && cfg.href) link.setAttribute('href', cfg.href);
        });

        if (menu && menu._edgeFadeUpdate) menu._edgeFadeUpdate();
        document.dispatchEvent(new CustomEvent('site:config', { detail: data }));
    } catch (e) {
        console.warn('사이트 표시 설정을 적용하지 못했습니다.', e);
    } finally {
        delete document.documentElement.dataset.navPending;
    }
}

// .section-title은 div·span이라 화면 읽기 프로그램이 제목으로 알도록 role을 단다
function markSectionHeadings(root = document) {
    root.querySelectorAll('.section-title .section-title-label:not([role])').forEach(el => {
        if (el.closest('h1, h2, h3, h4, h5, h6')) return;
        el.setAttribute('role', 'heading');
        el.setAttribute('aria-level', '2');
    });
}

// 사이트 데이터를 받은 뒤 페이지 초기화를 실행한다.
// opts.siteData: false면 받지 않고 배열이면 그 묶음만(기본 ['members']). SiteData를 쓰는 페이지는 맞춰야 한다.
// opts.logos: 로고가 필요한 대학 이름 목록을 돌려주는 함수. 없으면 첫 글자 배지로 그린다.
function bootPage(init, opts) {
    // opts.prefetch: 설정을 기다리지 않고 바로 시작할 요청. 결과는 조회 함수의 캐시가 들고 있다가 init이 쓴다.
    if (opts && typeof opts.prefetch === 'function') {
        try {
            opts.prefetch();
        } catch (e) {
            console.warn('미리 받기 실패', e);
        }
    }
    // opts.view(params): 기본 탭이 잠깐 보이지 않도록 데이터를 기다리기 전에 탭 모양만 맞춘다
    if (opts && typeof opts.view === 'function') {
        seedRuntimeConfigFromCache();
        try {
            opts.view(new URLSearchParams(location.search));
        } catch (e) {
            console.warn('탭 먼저 맞추기 실패', e);
        }
    }
    delete document.documentElement.dataset.viewPending; // actions.js가 걸어 둔 탭 가림을 푼다
    const siteDataParts =
        opts && opts.siteData === false ? [] : opts && Array.isArray(opts.siteData) ? opts.siteData : ['members'];
    const start = async () => {
        initEdgeFades();
        watchSubTabDensity();
        // 서브탭 기본값을 초기화 전에 확정한다
        await Promise.all([applyNavVisibility(), siteDataParts.length ? loadSiteData(siteDataParts) : null]);
        showSiteDataErrors(siteDataParts);
        // 로고는 본문을 막지 않는다. 처음 보는 대학은 배지로 그렸다가 도착하면 바꾼다.
        const logosReady = opts && typeof opts.logos === 'function' ? loadTeamLogos(opts.logos()) : null;
        safeInit('페이지', init);
        if (logosReady) logosReady.then(() => swapTeamLogoFallbacks());
        markSectionHeadings();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}

// 물음표 도움말. clip-path로 깎인 카드 안에서 잘리지 않도록 상자는 <body>에 띄운다.
let helpSeq = 0;

// help: 문자열 또는 { title, lead, rows: [[이름, 값], ...], note }. 열 때 textContent로 그린다.
function helpBadgeHtml(help) {
    const uid = `help-${++helpSeq}`;
    const payload = typeof help === 'string' ? { lead: help } : help || {};
    return `<span class="help-pop"><button type="button" class="help-btn" id="${uid}"
            aria-expanded="false" aria-label="설명 보기"
            data-help="${escapeHTML(JSON.stringify(payload))}"${act('toggleHelp', ACT.el)}><i class="i-info" aria-hidden="true"></i></button></span>`;
}

function helpEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null && text !== '') el.textContent = text;
    return el;
}

function helpFill(box, raw) {
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        data = { lead: raw || '' };
    }
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
    if (box) {
        box.hidden = true;
        box.removeAttribute('data-owner');
    }
    document
        .querySelectorAll('.help-btn[data-help][aria-expanded="true"]')
        .forEach(el => el.setAttribute('aria-expanded', 'false'));
}

function toggleHelp(btn) {
    const box = helpBox();
    const wasOpen = !box.hidden && box.dataset.owner === btn.id;
    closeAllHelp();
    if (wasOpen) return; // 같은 단추를 다시 누르면 닫기만 한다

    helpFill(box, btn.dataset.help || '');
    box.dataset.owner = btn.id;
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');

    // 좁은 화면에서 오른쪽으로 삐져나가지 않게 당긴다
    const r = btn.getBoundingClientRect();
    box.style.left = '0px';
    box.style.top = '0px';
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    box.style.left = `${Math.round(Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)))}px`;
    const below = r.bottom + 6;
    box.style.top = `${Math.round(below + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below)}px`;
}

// 위치를 열 때 한 번만 계산하므로 스크롤·크기 변경에도 닫는다
document.addEventListener('click', e => {
    if (e.target.closest && (e.target.closest('.help-pop') || e.target.closest('#help-floating'))) return;
    closeAllHelp();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllHelp();
});
window.addEventListener('scroll', () => closeAllHelp(), { passive: true });
window.addEventListener('resize', () => closeAllHelp());

// 계산은 ststat 파이프라인이 한다
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
        ['예상 승률과의 차이', '랭킹은 기본 실력 순위이며, 엔트리 승률은 별도 모델로 상대 종족과 선택 맵을 반영'],
    ],
    note: "맵이나 상대를 선택해도 랭킹은 바뀌지 않습니다. 최근 1년 10판 미만이거나 휴면이면 '기록 없음'입니다",
};

// '갓티어 · 3위/16명'. 뱃지 줄에 같이 두면 좁은 화면에서 넘쳐서 셋째 줄에 따로 둔다.
function playerRankBadgeHtml(tier, rank, tierTotal) {
    const label = escapeHTML(tierLabel(tier));
    const body = rank && tierTotal ? `${rank}위/${formatNum(Number(tierTotal))}명` : '기록 없음';
    return `<span class="tag-badge rank-badge">${label} · ${body}</span>`;
}

// 사이트 어디서나 '20승 19패' 꼴로 적는다('20-19'와 섞지 않는다)
function winLoseText(win, lose, winClass, loseClass) {
    return (
        `<span class="${winClass || 'h2h-win'}">${win}</span>승 ` +
        `<span class="${loseClass || 'h2h-lose'}">${lose}</span>패`
    );
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
            <div class="player-summary-total">총 전적 ${formatNum(rec.total)}전</div>
            <div class="player-summary-wl">${rec.win}승 ${rec.lose}패</div>
            <div class="player-summary-rate">${rec.total ? `${Math.round((rec.win / rec.total) * 1000) / 10}%` : '-'}</div>
        </div>${close}</div>`;
}
function matchPaginationHtml(total, page, size, handler, unit = '경기') {
    const count = Math.max(1, Math.ceil(total / size));
    const cur = Math.min(Math.max(1, page), count);
    const start = Math.floor((cur - 1) / 5) * 5 + 1;
    const end = Math.min(count, start + 4);
    const num = n =>
        `<button type="button" class="match-page${n === cur ? ' active' : ''}"${n === cur ? ' aria-current="page"' : ''}${act(handler, n)}>${n}</button>`;
    const step = (n, label, aria, disabled) =>
        `<button type="button" class="match-page is-edge" aria-label="${aria}"${disabled ? ' disabled' : act(handler, n)}>${label}</button>`;
    return `<nav class="match-pagination" aria-label="페이지">
        <span class="match-pagination-nav">
            ${step(1, '&laquo;', '첫 페이지', cur === 1)}
            ${step(cur - 1, '&lsaquo;', '이전 페이지', cur === 1)}
        </span>
        <span class="match-page-nums">
            ${start > 1 ? `<button type="button" class="match-page is-gap"${act(handler, start - 1)} aria-label="이전 묶음">…</button>` : ''}
            ${Array.from({ length: end - start + 1 }, (_, i) => num(start + i)).join('')}
            ${end < count ? `<button type="button" class="match-page is-gap"${act(handler, end + 1)} aria-label="다음 묶음">…</button>` : ''}
        </span>
        <span class="match-pagination-nav">
            ${step(cur + 1, '&rsaquo;', '다음 페이지', cur === count)}
            ${step(count, '&raquo;', '마지막 페이지', cur === count)}
        </span>
        <span class="match-pagination-info">${cur} / ${count} 페이지 · ${formatNum(total)}${escapeHTML(unit)}</span>
    </nav>`;
}

// ---------------------------------------------------------------------------
// 이미지 저장(엔트리 포스터 · 숲리캡): canvas에 그리는 공용 부품
// ---------------------------------------------------------------------------
// 프로필 사진은 다른 도메인이라 CORS가 막히면 null을 돌려 캔버스를 더럽히지 않는다(이니셜 원으로 대신).
function posterLoadImage(url) {
    return new Promise(resolve => {
        if (!url) {
            resolve(null);
            return;
        }
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url;
    });
}

// 포스터는 테마와 상관없이 흰 바탕이라 지금 테마가 아니라 :root(라이트) 토큰 값을 읽는다.
let posterPaletteCache = null;
function posterPalette() {
    if (posterPaletteCache) return posterPaletteCache;
    const vars = {};
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (e) {
            continue;
        }
        for (const r of rules) {
            if (r.selectorText !== ':root') continue;
            for (const p of r.style) if (p.startsWith('--')) vars[p] = r.style.getPropertyValue(p).trim();
        }
    }
    const tok = (name, depth = 0) => {
        const v = vars[name] || '';
        const ref = v.match(/^var\((--[\w-]+)\)$/);
        return ref && depth < 5 ? tok(ref[1], depth + 1) : v;
    };
    posterPaletteCache = {
        race: { T: tok('--color-race-t'), Z: tok('--color-race-z'), P: tok('--color-race-p') },
        raceText: { T: '#fff', Z: '#fff', P: tok('--color-race-p-text') },
        tier: tok('--color-tier-badge'),
        bg: tok('--color-card'),
        navy: tok('--navy'),
        navyText: tok('--navy-on-text'),
        navyMuted: tok('--navy-on-muted'),
        gold: tok('--color-accent-gold'),
        text: tok('--color-text-main'),
        sub: tok('--color-text-sub'),
        faint: tok('--color-text-faint'),
        empty: tok('--color-icon-faint'),
        stripe: tok('--color-bg-subtle'),
        foot: tok('--color-bg'),
        win: tok('--color-win'),
        lose: tok('--color-lose'),
        kammon: tok('--kammon'),
        line: tok('--color-border'),
    };
    return posterPaletteCache;
}

// 사이트 카드·뱃지처럼 오른쪽 위 모서리를 깎은 사각형 경로(--notch-*)
function posterNotchPath(ctx, x, y, w, h, cut) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
}

// 네이비 면의 사선 무늬(--navy-pattern: 135도, 8px 간격 옅은 흰 선)를 지금 경로 안에 그린다
function posterNavyPattern(ctx, x, y, w, h) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -h; i < w; i += 8) {
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
    }
    ctx.stroke();
    ctx.restore();
}

// .tag-badge를 캔버스로 옮긴 것. 그린 폭을 돌려준다.
function posterDrawBadge(ctx, text, x, y, h, bg, fg, fixedW) {
    const label = String(text || '');
    if (!label) return 0;
    const fontSize = Math.round(h * 0.6);
    ctx.save();
    ctx.font = `800 ${fontSize}px Pretendard, sans-serif`;
    const w = fixedW || Math.max(h, Math.ceil(ctx.measureText(label).width) + h * 0.7);
    posterNotchPath(ctx, x, y, w, h, Math.round(h * 0.25));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    return w;
}

function posterDrawRaceBadge(ctx, letter, x, y, size) {
    const pal = posterPalette();
    const bg = pal.race[letter];
    if (!bg) return 0;
    return posterDrawBadge(ctx, letter, x, y, size, bg, pal.raceText[letter] || '#fff', size);
}

function posterInitialColor(name) {
    let h = 0;
    String(name || '?')
        .split('')
        .forEach(c => {
            h = (h * 31 + c.charCodeAt(0)) % 360;
        });
    return `hsl(${h} 45% 42%)`;
}

function posterDrawAvatar(ctx, img, name, x, y, d) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
        ctx.drawImage(img, x, y, d, d);
    } else {
        ctx.fillStyle = posterInitialColor(name);
        ctx.fillRect(x, y, d, d);
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(d * 0.42)}px Pretendard, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(name || '?').slice(0, 1), x + d / 2, y + d / 2 + 1);
    }
    ctx.restore();
}
