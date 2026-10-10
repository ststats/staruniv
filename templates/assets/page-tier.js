/**
 * 티어표 페이지 - 스타 커뮤니티 전체 명단을 티어별로, 티어 안에서는 종족별로 보여준다.
 * (core.js → api.js → 이 파일) 상대전적·분석·엔트리 코드는 그 탭을 열 때 불러온다.
 * 방송 상태는 ststat live-status가 2분마다 채우는 api_live를 받아 쓴다(브라우저의 개별 SOOP 호출 없음).
 */

// 수집 주기(2분)보다 자주 받아도 같은 목록이라 egress만 는다. 화면 반영은 최악 약 4분.
const TIER_LIVE_REFRESH_MS = 2 * 60 * 1000;

// 티어표에서 빼는 소속. 막는 목록이라 여기 없는 팀은 자동으로 들어온다.
const TIER_HIDDEN_TEAMS = new Set(['휴면']);

// 여기 없는 종족(랜덤 등)은 뒤에 따로 묶인다.
const TIER_RACE_ORDER = ['테란', '저그', '프로토스'];

const TierState = {
    members: [],
    byId: {}, // soopId(소문자) -> member
    live: {}, // soopId(소문자) -> { id, member, broadNo, title, viewers }
    liveOnly: true,
    sections: [], // [{ tier, id, count }]
    activeId: null,
    jump: null, // 바로가기로 이동한 직후 { id, y } - 스크롤하기 전까지 그 티어를 강조한다
    visibleThumbs: new Set(),
    thumbObserver: null,
    view: '', // 방송 상태는 list일 때만 갱신
    requestSeq: 0, // 탭·선택 변경 뒤 이전 요청의 화면 갱신을 막는다
    listInit: null,
};

// ---------------------------------------------------------------------------
// 소분류 탭
// ---------------------------------------------------------------------------
const TIER_TABS = {
    list: ['tab-tier-list', 'view-tier-list'],
    h2h: ['tab-tier-h2h', 'view-tier-h2h'],
    analysis: ['tab-tier-analysis', 'view-tier-analysis'],
    entry: ['tab-tier-entry', 'view-tier-entry'],
};

const tierScriptUrls = { ...document.currentScript.dataset };
const tierScriptLoads = new Map();
function loadTierScript(name) {
    if (!tierScriptLoads.has(name)) {
        const script = document.createElement('script');
        script.src = tierScriptUrls[name];
        const pending = new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error(`${name} 코드를 불러오지 못했습니다`));
        }).catch(error => {
            script.remove();
            tierScriptLoads.delete(name);
            throw error;
        });
        tierScriptLoads.set(name, pending);
        document.head.appendChild(script);
    }
    return tierScriptLoads.get(name);
}

async function loadTierCode(view) {
    if (view === 'list') return;
    await loadTierScript('h2h'); // 분석·엔트리가 상대전적의 선수/기간 처리를 같이 쓴다
    if (view !== 'h2h') await loadTierScript(view);
}

function tierViewKey(view) {
    view = view || runtimeDefaultSubtab('tier', 'list');
    return hasOwn(TIER_TABS, view) ? view : 'list';
}

function tierViewRequest(view) {
    const sequence = ++TierState.requestSeq;
    return () => TierState.view === view && TierState.requestSeq === sequence;
}

function switchTierView(view, restoreParams = null) {
    const key = tierViewKey(view);
    const sequence = ++TierState.requestSeq;
    TierState.view = key;
    activateTabView(TIER_TABS, key);
    // 복원할 주소는 스냅샷으로 넘긴다. 비동기 초기화가 끝난 뒤 주소를 다시 쓰지 않는다.
    if (!restoreParams) {
        if (key === 'h2h' && typeof h2hSyncUrl === 'function') h2hSyncUrl();
        else if (key === 'analysis' && typeof analysisSyncUrl === 'function') analysisSyncUrl();
        else PageState.update(key === 'list' && runtimeDefaultSubtab('tier', 'list') === 'list' ? {} : { view: key });
    }
    if (key === 'list') safeInit('티어표', enterTierList);
    else
        safeInit('티어 탭', async () => {
            await loadTierCode(key);
            if (TierState.view !== key || TierState.requestSeq !== sequence) return;
            if (key === 'h2h') return h2hEnter(restoreParams);
            if (key === 'analysis') return analysisEnter(restoreParams);
            return entryEnsureLoaded();
        });
}

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
// bootPage prefetch에서 시작해 두고 목록을 그릴 때 쓴다. 실패하면 비워서 다음에 다시 받는다.
let _tierMembersRequest = null;
function requestTierMembers() {
    if (!_tierMembersRequest) {
        _tierMembersRequest = Api.tierMembers();
        _tierMembersRequest.catch(() => {
            _tierMembersRequest = null;
        });
    }
    return _tierMembersRequest;
}

// 비었거나 조회에 실패하면 null.
async function fetchTierMembers() {
    try {
        const data = await requestTierMembers();
        const members = asArray(data)
            .map(r => ({
                id: String(r.soop_id || '').trim(),
                nickname: String(r.nickname || '').trim(),
                team: String(r.affiliation || '').trim(),
                tier: r.tier == null ? '' : String(r.tier).trim(),
                race: String(r.race || '').trim(),
            }))
            .filter(m => isValidSoopId(m.id) && m.nickname && !TIER_HIDDEN_TEAMS.has(m.team));
        return members.length ? members : null;
    } catch (e) {
        console.error('[티어표] Supabase 명단 조회 실패:', e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// 카드
// ---------------------------------------------------------------------------
function tierGroupKey(member) {
    const raw = member.tier === null || member.tier === undefined ? '' : String(member.tier).trim();
    // DB의 '체크'는 아직 티어를 안 매긴 사람이라 미분류로 보낸다.
    if (!raw || TIER_UNRANKED.has(raw)) return '미분류';
    return raw;
}

function tierRaceKey(member) {
    const raw = String(member.race || '').trim();
    return raw || '기타';
}

function tierIdKey(member) {
    return String(member.id).trim().toLowerCase();
}

// 숫자 티어는 "3"만 쓰면 인원수와 헷갈려 "3티어"로 적는다. 이름 있는 티어("갓")는 그대로.
function tierDisplayName(tier) {
    const label = tier === null || tier === undefined ? '' : String(tier);
    return /^\d+$/.test(label) ? `${label}티어` : label;
}

// 썸네일은 방송번호로 만든다(아이디로는 안 된다). 분 단위 값은 캐시를 1분에 한 번만 비우려는 것.
function tierThumbUrl(broadNo) {
    return `https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broadNo)}?t=${Math.floor(Date.now() / 60000)}`;
}

function tierTeamLogoHtml(team) {
    if (!team) return '';
    const src = teamLogoSrc(team);
    // 로고 목록이 아직 안 왔으면 자리만 두고 swapTierTeamLogos가 채운다
    if (!src) return `<span class="tier-logo-pending" data-tier-logo="${escapeHTML(team)}" hidden></span>`;
    return `<img class="team-logo-icon tier-card-team-logo" src="${escapeHTML(src)}" alt=""
                 loading="lazy"${actOn('error', 'imgRemove', ACT.el)}>`;
}

function swapTierTeamLogos() {
    document.querySelectorAll('.tier-logo-pending[data-tier-logo]').forEach(el => {
        if (teamLogoSrc(el.dataset.tierLogo)) el.outerHTML = tierTeamLogoHtml(el.dataset.tierLogo);
    });
}

// 썸네일과 프로필 박스는 높이가 같아야 그리드가 들쭉날쭉하지 않는다.
function tierCardMediaHtml(member, live) {
    const soopId = String(member.id).trim();
    if (live) {
        const fallback = getProfileImgUrl(soopId) || '';
        // 방송 화면 자체가 켜져 있다는 표시라 LIVE 배지·시청자 수는 얹지 않는다.
        return `
            <img class="tier-card-thumb" src="${escapeHTML(tierThumbUrl(live.broadNo))}" alt="" loading="lazy"
                 ${fallback ? actOn('error', 'imgSrc', ACT.el, fallback) : ''}>`;
    }
    return avatarHtml(soopId, 'tier-card-avatar');
}

function tierCardHtml(member, live) {
    const soopId = String(member.id).trim();
    const team = String(member.team || '').trim();
    const raceLetter = raceShortLabel(member.race || '');
    const raceEdge = ['T', 'Z', 'P'].includes(raceLetter) ? ` edge-${raceLetter}` : '';
    return `
    <a class="tier-card${raceEdge}${live ? ' is-live' : ''}${live && !live.isStar ? ' is-offcate' : ''}" data-tier-id="${escapeHTML(tierIdKey(member))}"
       href="https://${live ? 'play' : 'ch'}.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
        <div class="tier-card-media">${tierCardMediaHtml(member, live)}</div>
        <div class="tier-card-body">
            <div class="tier-card-nameline">
                <span class="tier-card-name">${escapeHTML(member.nickname || soopId)}</span>
                ${member.race ? raceBadgeHtml(member.race) : ''}
            </div>
            <div class="tier-card-team">
                ${tierTeamLogoHtml(team)}<span class="tier-card-team-name">${escapeHTML(team)}</span>
            </div>
        </div>
    </a>`;
}

// ---------------------------------------------------------------------------
// 방송 미리보기 (마우스를 올린 방송 중 카드)
// ---------------------------------------------------------------------------
// 마우스가 있는 화면에서만 쓴다(터치는 누르면 바로 방송으로 간다). 스칠 때 뜨지 않게 잠깐 머물러야 뜬다.
const TIER_PEEK_DELAY_MS = 250;
const tierPeekHover = window.matchMedia('(hover: hover) and (pointer: fine)');
const TierPeek = { el: null, card: null, timer: 0, x: 0, y: 0, frame: 0, inside: false, scrollTimer: 0 };
const TIER_PEEK_OFFSET = 16; // 커서가 미리보기를 가리지 않게

function tierPeekEl() {
    if (!TierPeek.el) {
        TierPeek.el = document.createElement('div');
        TierPeek.el.className = 'tier-peek';
        TierPeek.el.setAttribute('aria-hidden', 'true'); // 카드 링크와 같은 내용을 크게 보여 줄 뿐이다
        document.body.appendChild(TierPeek.el);
    }
    return TierPeek.el;
}

// 홈 '방송 중' 카드(page-home.js liveCardHtml)와 같은 클래스를 쓴다
function tierPeekHtml(member, live) {
    const soopId = String(member.id).trim();
    const elapsed = formatLiveElapsed(live.start) || '-';
    return `
        <div class="live-thumb-wrap">
            <img class="live-thumb" src="${escapeHTML(tierThumbUrl(live.broadNo))}" alt=""${actOn('error', 'imgHide', ACT.el)}>
            <div class="live-thumb-overlay">
                <span>${escapeHTML(formatNum(live.viewers))}명</span><span>${escapeHTML(elapsed)}</span>
            </div>
        </div>
        <div class="live-card-body">
            <span class="live-card-avatar-ring">${avatarHtml(soopId, 'live-card-avatar')}</span>
            <span class="live-card-name">${escapeHTML(member.nickname || soopId)}</span>
            <div class="live-card-title">${escapeHTML(live.title || '')}</div>
        </div>`;
}

// 오른쪽 끝에 닿으면 커서 왼쪽으로 넘기고, 위아래는 화면 안으로 밀어 넣는다.
function tierPeekPlace() {
    TierPeek.frame = 0;
    const el = TierPeek.el;
    if (!el || !el.classList.contains('is-open')) return;
    const w = el.offsetWidth,
        h = el.offsetHeight,
        off = TIER_PEEK_OFFSET,
        pad = 8;
    let left = TierPeek.x + off;
    if (left + w > window.innerWidth - pad) left = TierPeek.x - off - w;
    const top = Math.min(Math.max(pad, TierPeek.y - h / 2), window.innerHeight - h - pad);
    el.style.transform = `translate(${Math.round(Math.max(pad, left))}px, ${Math.round(top)}px)`;
}

function tierPeekShow(card) {
    const key = card.dataset.tierId;
    const live = TierState.live[key];
    const member = TierState.byId[key];
    if (!live || !member) return;
    const el = tierPeekEl();
    const race = raceShortLabel(member.race || '');
    el.className = `tier-peek live-broadcast-card${['T', 'Z', 'P'].includes(race) ? ` edge-${race}` : ''}${live.isStar ? '' : ' is-offcate'}`;
    el.innerHTML = tierPeekHtml(member, live);
    el.classList.add('is-open');
    tierPeekPlace();
}

function tierPeekHide() {
    clearTimeout(TierPeek.timer);
    TierPeek.card = null;
    if (TierPeek.el) TierPeek.el.classList.remove('is-open');
}

function tierPeekTrack(card) {
    if (card === TierPeek.card) return;
    tierPeekHide();
    if (!card) return;
    TierPeek.card = card;
    TierPeek.timer = setTimeout(() => {
        if (TierPeek.card === card) tierPeekShow(card);
    }, TIER_PEEK_DELAY_MS);
}

function initTierPeek() {
    const root = document.getElementById('tier-root');
    if (!root || !tierPeekHover.matches) return;
    // mouseover만으로는 스크롤·갱신으로 닫힌 뒤 같은 카드 위에서 다시 뜨지 않아 mousemove도 본다.
    const onPointer = e => {
        TierPeek.x = e.clientX;
        TierPeek.y = e.clientY;
        tierPeekTrack(e.target.closest('.tier-card.is-live'));
        if (TierPeek.el && TierPeek.el.classList.contains('is-open') && !TierPeek.frame) {
            TierPeek.frame = requestAnimationFrame(tierPeekPlace);
        }
    };
    root.addEventListener('mouseover', onPointer);
    root.addEventListener('mousemove', onPointer, { passive: true });
    root.addEventListener('mouseenter', () => {
        TierPeek.inside = true;
    });
    root.addEventListener('mouseleave', () => {
        TierPeek.inside = false;
        tierPeekHide();
    });
    // 스크롤하면 닫고, 멈추면 마우스 아래 카드를 다시 찾는다
    window.addEventListener(
        'scroll',
        () => {
            tierPeekHide();
            clearTimeout(TierPeek.scrollTimer);
            TierPeek.scrollTimer = setTimeout(() => {
                if (!TierPeek.inside) return;
                const under = document.elementFromPoint(TierPeek.x, TierPeek.y);
                tierPeekTrack(under && under.closest('#tier-root .tier-card.is-live'));
            }, 150);
        },
        { passive: true }
    );
}

// ---------------------------------------------------------------------------
// 그리드
// ---------------------------------------------------------------------------
function tierVisibleMembers() {
    if (!TierState.liveOnly) return TierState.members;
    return TierState.members.filter(m => TierState.live[tierIdKey(m)]);
}

function tierRaceBlocksHtml(members) {
    const byRace = new Map();
    members.forEach(m => {
        const race = tierRaceKey(m);
        if (!byRace.has(race)) byRace.set(race, []);
        byRace.get(race).push(m);
    });

    const known = TIER_RACE_ORDER.filter(r => byRace.has(r));
    const unknown = Array.from(byRace.keys())
        .filter(r => !TIER_RACE_ORDER.includes(r))
        .sort((a, b) => a.localeCompare(b, 'ko'));

    return known
        .concat(unknown)
        .map(
            race => `
        <div class="tier-race-block" data-race="${escapeHTML(race)}">
            <div class="tier-grid">
                ${byRace
                    .get(race)
                    .map(m => tierCardHtml(m, TierState.live[tierIdKey(m)]))
                    .join('')}
            </div>
        </div>`
        )
        .join('');
}

function renderTierGroups() {
    // 다시 그리면 문서 높이가 바뀌므로 보던 티어의 위치를 먼저 재둔다.
    const anchor = captureTierAnchor();
    const list = tierVisibleMembers();

    const groups = new Map();
    list.forEach(m => {
        const key = tierGroupKey(m);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    });

    // 모르는 티어 값도 버리지 않고 맨 뒤로 보낸다(tierIndex). 데이터가 어긋나도 사람이 사라지면 안 된다.
    const tiers = Array.from(groups.keys()).sort((a, b) => {
        const diff = tierIndex(a) - tierIndex(b);
        return diff !== 0 ? diff : a.localeCompare(b, 'ko');
    });

    // id는 선택자로 쓰기 편하게 순번이다. count는 지금 보기('방송중'/'전체')에 그려지는 인원.
    TierState.sections = tiers.map((tier, i) => ({
        tier,
        id: `tier-sec-${i}`,
        count: groups.get(tier).length,
    }));

    tierPeekHide();
    document.getElementById('tier-root').innerHTML = TierState.sections.length
        ? TierState.sections
              .map(
                  sec => `
            <div class="tier-row" id="${sec.id}">
                <div class="section-title" data-en="${tierLatinLabel(sec.tier)}">
                    <span class="section-title-label">${escapeHTML(tierDisplayName(sec.tier))}</span><span class="title-count">${sec.count}명</span>
                </div>
                ${tierRaceBlocksHtml(groups.get(sec.tier))}
            </div>`
              )
              .join('')
        : `<div class="content-state is-boxed">${TierState.liveOnly ? '방송 중인 사람이 없습니다' : '표시할 인원이 없습니다'}</div>`;

    observeTierThumbs();
    syncTierCardHeight();
    renderTierBar();
    ensureTierPick();
    restoreTierAnchor(anchor);
    highlightTierBar();
    syncTierPickLabel();
}

function observeTierThumbs() {
    if (!TierState.thumbObserver) return;
    TierState.thumbObserver.disconnect();
    TierState.visibleThumbs.clear();
    document.querySelectorAll('#tier-root .tier-card-thumb').forEach(img => TierState.thumbObserver.observe(img));
}

// ---------------------------------------------------------------------------
// 티어 바로가기 바
// ---------------------------------------------------------------------------
function renderTierBar() {
    const list = document.getElementById('tier-bar-list');
    if (!list) return;
    list.innerHTML = TierState.sections
        .map(
            sec => `
        <button type="button" class="tier-bar-item" data-target="${sec.id}">
            <span class="tier-bar-name">${escapeHTML(tierDisplayName(sec.tier))}</span>
            <span class="tier-bar-count">${sec.count}</span>
        </button>`
        )
        .join('');
    TierState.activeId = null;
    attachBarScroll(list);
    syncTierBarHeight();
}

// 티어 바는 PC·모바일 모두 화면 위에 붙어 본문을 가린다(높이는 --tier-bar-h로 넘긴다).
function tierBarCoversContent() {
    return !!document.getElementById('tier-bar');
}

// 모바일에서는 접히는 한 줄 선택 바로 쓴다(가로는 티어 15개를 계속 밀어야 하고, 펼치면 화면을 다 먹는다).
function ensureTierPick() {
    const bar = document.getElementById('tier-bar');
    if (!bar || bar.querySelector('.tier-bar-pick')) return;
    const heading = bar.querySelector('.tier-bar-heading');
    heading.insertBefore(createBarPick(bar, 'tier-bar-pick', '티어 바로가기'), heading.firstChild);
}

function syncTierPickLabel() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    const pick = bar.querySelector('.tier-bar-pick');
    if (!pick) return;
    const active = bar.querySelector('.tier-bar-item.active');
    const label = pick.querySelector('.tier-bar-pick-label');
    // 칩 textContent는 '갓12'처럼 붙어 나와서 이름과 인원을 따로 읽는다.
    if (!label) return;
    if (!active) {
        label.textContent = '티어 바로가기';
        return;
    }
    const count = active.querySelector('.tier-bar-count');
    const name = active.cloneNode(true);
    const dropCount = name.querySelector('.tier-bar-count');
    if (dropCount) dropCount.remove();
    label.textContent = name.textContent.trim() + (count ? ` · ${count.textContent.trim()}명` : '');
}

function syncTierBarHeight() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    const h = tierBarCoversContent() ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--tier-bar-h', `${h}px`);
}

function onTierBarClick(event) {
    const btn = event.target.closest('.tier-bar-item');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    // 펼친 목록 높이가 스크롤 여백으로 들어가지 않도록 먼저 접는다.
    const bar = document.getElementById('tier-bar');
    bar.classList.add('is-closed');
    bar.querySelector('.tier-bar-pick')?.setAttribute('aria-expanded', 'false');
    syncTierBarHeight();
    scrollTierBarItemIntoView(btn);
    scrollTierIntoPlace(target);
}

// content-visibility로 건너뛴 카드가 스크롤 순간 그려지며 위치가 밀려서 두 프레임 더 보정한다.
function scrollTierIntoPlace(target, tries) {
    const gap = target.getBoundingClientRect().top - tierStickyOffset() - 12;
    if (Math.abs(gap) > 1) window.scrollBy({ top: gap, behavior: 'instant' });
    TierState.jump = { id: target.id, y: window.scrollY };
    highlightTierBar();
    const left = tries === undefined ? 2 : tries;
    if (left > 0 && Math.abs(gap) > 1) requestAnimationFrame(() => scrollTierIntoPlace(target, left - 1));
}

// 판정선은 보이는 영역 위에서 35%다. 바 바로 아래로 잡으면 화면 대부분이 다음 티어여도 이전 티어가 켜져 있다.
function currentTierSectionId() {
    if (TierState.sections.length === 0) return null;
    const offset = tierStickyOffset();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    // 바로가기 직후에는 누른 티어를 강조한다. 짧은 티어는 다음 티어가 판정선 위로 올라온다.
    if (TierState.jump && Math.abs(window.scrollY - TierState.jump.y) < 2) return TierState.jump.id;
    TierState.jump = null;
    const line = offset + (viewport - offset) * 0.35;

    let currentId = TierState.sections[0].id;
    for (const sec of TierState.sections) {
        const el = document.getElementById(sec.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) currentId = sec.id;
        else break;
    }
    // 맨 아래에서는 짧은 마지막 티어가 판정선까지 못 올라온다.
    const docHeight = document.documentElement.scrollHeight;
    if (window.scrollY + viewport >= docHeight - 2) {
        currentId = TierState.sections[TierState.sections.length - 1].id;
    }
    return currentId;
}

function highlightTierBar() {
    const currentId = currentTierSectionId();
    if (!currentId) return;

    // 그대로면 건드리지 않는다. 매번 smooth 스크롤을 다시 부르면 바를 손으로 밀 때 서로 잡아당긴다.
    if (currentId === TierState.activeId) return;
    TierState.activeId = currentId;

    let activeBtn = null;
    document.querySelectorAll('#tier-bar .tier-bar-item').forEach(btn => {
        const on = btn.dataset.target === currentId;
        btn.classList.toggle('active', on);
        if (on) activeBtn = btn;
    });
    if (activeBtn) scrollTierBarItemIntoView(activeBtn);
    syncTierPickLabel();
}

// scrollIntoView는 조상까지 움직여 페이지가 세로로 튀므로 바의 scrollLeft만 맞춘다.
function scrollTierBarItemIntoView(btn) {
    centerBarItem(btn);
}

// TIER는 여기서만 붙인다(제목 쪽에서도 붙이면 '1 TIER TIER').
const TIER_EN = {
    '갓': 'GOD',
    '킹': 'KING',
    '잭': 'JACK',
    '조커': 'JOKER',
    '스페이드': 'SPADE',
    '베이비': 'BABY',
    '미분류': 'UNRANKED',
};
function tierLatinLabel(tier) {
    // 0티어가 있어서 `tier || ''`로 읽으면 안 된다.
    const key = (tier === null || tier === undefined ? '' : String(tier)).replace('티어', '').trim();
    const word = TIER_EN[key] || (/^\d+$/.test(key) ? key : '');
    return word ? word + ' TIER' : 'TIER';
}

// 화면 밖 카드(content-visibility로 건너뛴 카드)의 예상 높이(--tier-card-h)를 실제 카드로 잰다. 건너뛰는 카드를 재면
// 예상 높이가 그대로 돌아오므로 맨 앞 카드에 is-measure를 달아 건너뛰기를 끈다.
function syncTierCardHeight() {
    const card = document.querySelector('#tier-root .tier-card');
    if (!card) return;
    card.classList.add('is-measure');
    // 건너뛸지 판정 전이라 바로 재면 예상 높이가 나온다. 한 번 그려진 다음 프레임에 잰다.
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            const h = Math.round(card.getBoundingClientRect().height);
            const root = document.documentElement;
            if (h > 0 && root.style.getPropertyValue('--tier-card-h') !== `${h}px`) {
                root.style.setProperty('--tier-card-h', `${h}px`);
            }
        })
    );
}

function tierStickyOffset() {
    const nav = document.querySelector('.top-navbar');
    const bar = document.getElementById('tier-bar');
    const barH = bar && tierBarCoversContent() ? bar.offsetHeight : 0;
    return (nav ? nav.offsetHeight : 64) + barH;
}

// ---------------------------------------------------------------------------
// 보기 전환 (전체 / 방송중)
// ---------------------------------------------------------------------------
function renderTierScope() {
    const scope = document.getElementById('tier-scope');
    if (!scope) return;
    // 바로가기 칩 숫자 색을 보기에 맞춘다(색은 CSS)
    const bar = document.getElementById('tier-bar');
    if (bar) bar.classList.toggle('is-live-only', TierState.liveOnly);
    const total = TierState.members.length;
    const liveCount = Object.keys(TierState.live).length;
    scope.innerHTML = `
        <button type="button" class="tier-scope-btn tier-scope-all${TierState.liveOnly ? '' : ' active'}"
                data-live-only="0" aria-pressed="${!TierState.liveOnly}">
            전체<span class="tier-scope-num">${formatNum(total)}</span>
        </button>
        <button type="button" class="tier-scope-btn tier-scope-live${TierState.liveOnly ? ' active' : ''}"
                data-live-only="1" aria-pressed="${TierState.liveOnly}">
            방송중<span class="tier-scope-num">${formatNum(liveCount)}</span>
        </button>`;
}

function onTierScopeClick(event) {
    const btn = event.target.closest('.tier-scope-btn');
    if (!btn) return;
    const wantLive = btn.dataset.liveOnly === '1';
    // '방송중'을 다시 누르면 꺼진다(필터 버튼처럼).
    const next = wantLive ? !TierState.liveOnly : false;
    if (next === TierState.liveOnly) return;
    TierState.liveOnly = next;
    renderTierScope();
    renderTierGroups();
}

// ---------------------------------------------------------------------------
// 다시 그릴 때 보던 자리 지키기
// ---------------------------------------------------------------------------
// 보기를 바꾸면 문서 높이가 크게 변해 스크롤이 다른 티어로 튄다. 보던 티어의 위치를 재두고 되돌린다.
// 섹션 id는 순번이라 티어 이름으로 찾는다.
function captureTierAnchor() {
    const id = TierState.activeId || currentTierSectionId();
    const sec = TierState.sections.find(s => s.id === id);
    const el = sec && document.getElementById(sec.id);
    if (!el) return null;
    return { tier: sec.tier, top: el.getBoundingClientRect().top };
}

function restoreTierAnchor(anchor) {
    if (!anchor) return;
    const offset = tierStickyOffset() + 16; // .tier-row의 scroll-margin-top과 맞춘다

    let sec = TierState.sections.find(s => s.tier === anchor.tier);
    let keepOffset = true;
    if (!sec) {
        // 보던 티어가 사라졌으면 순서상 다음 티어(없으면 마지막 티어)의 처음으로 간다.
        const idx = tierIndex(anchor.tier);
        sec =
            TierState.sections.find(s => tierIndex(s.tier) >= idx) || TierState.sections[TierState.sections.length - 1];
        keepOffset = false;
    }
    const el = sec && document.getElementById(sec.id);
    if (!el) return;

    // 티어가 짧아졌으면 지나쳐 가지 않게 잡아둔다.
    const top = keepOffset ? Math.max(anchor.top, offset + 80 - el.offsetHeight) : offset;
    const delta = el.getBoundingClientRect().top - top;
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: 'auto' }); // 순간 이동이어야 자리가 안 흔들려 보인다
}

// ---------------------------------------------------------------------------
// 카테고리 (스타크래프트인지)
// ---------------------------------------------------------------------------
// 번호 체계는 SOOP이 바꿀 수 있어 이름을 먼저 보고, 이름이 없을 때만 번호로 판단한다.
const TIER_STARCRAFT_CATE_NOS = new Set(['00040001']);
const TIER_STARCRAFT_NAME_RE = /스타\s*크래프트|starcraft|브루드\s*워|brood\s*war/i;

// 근거가 없으면 스타로 친다. 수집이 카테고리를 못 실을 때 방송이 전부 회색이 되면 안 된다.
function isStarcraftCategory(name, no) {
    if (name) return TIER_STARCRAFT_NAME_RE.test(name);
    if (no) return TIER_STARCRAFT_CATE_NOS.has(no);
    return true;
}

// ---------------------------------------------------------------------------
// 방송 상태
// ---------------------------------------------------------------------------
async function refreshTierLive() {
    if (TierState.members.length === 0 || TierState.view !== 'list') return;

    let merged;
    try {
        merged = await fetchLiveBroadcasts();
    } catch (e) {
        // 실패하면 직전 표시를 두고 다음 주기에 다시 받는다.
        return;
    }

    const next = {};
    Object.keys(merged).forEach(id => {
        const info = merged[id];
        const key = String(id).toLowerCase();
        const member = TierState.byId[key];
        if (!member || !info || !info.broad_no) return;
        const categoryName = String(info.category_name || '').trim();
        const categoryNo = String(info.broad_cate_no || '').trim();
        next[key] = {
            id: info.soop_id || id,
            member,
            broadNo: info.broad_no,
            title: info.broad_title || '',
            viewers: Number(info.current_sum_viewer) || 0,
            start: info.broad_start || '',
            isStar: isStarcraftCategory(categoryName, categoryNo),
        };
    });

    const changed = liveSetChanged(TierState.live, next);
    TierState.live = next;
    renderTierScope();

    // 전부 다시 그리면 수백 장의 이미지를 다시 받으므로, 방송중 보기의 명단이 바뀔 때만 다시 그린다.
    if (changed && TierState.liveOnly) {
        renderTierGroups();
        return;
    }
    applyLiveToCards(changed);
}

function liveSetChanged(prev, next) {
    return Object.keys(prev).sort().join(',') !== Object.keys(next).sort().join(',');
}

function applyLiveToCards(setChanged) {
    let needsObserve = false;
    document.querySelectorAll('#tier-root .tier-card').forEach(card => {
        const key = card.dataset.tierId;
        const live = TierState.live[key];
        card.href = `https://${live ? 'play' : 'ch'}.sooplive.co.kr/${encodeURIComponent(key)}`;
        const wasLive = card.classList.contains('is-live');
        const media = card.querySelector('.tier-card-media');
        if (!media) return;

        if (!!live !== wasLive) {
            const member = TierState.byId[key];
            if (!member) return;
            media.innerHTML = tierCardMediaHtml(member, live);
            card.classList.toggle('is-live', !!live);
            card.classList.toggle('is-offcate', !!live && !live.isStar);
            needsObserve = true;
        } else if (live) {
            // 방송 중 카테고리 변경(스타 → 저챗 등)도 따라간다.
            card.classList.toggle('is-offcate', !live.isStar);
            // 썸네일은 화면에 보이는 것만 다시 받는다.
            const img = media.querySelector('.tier-card-thumb');
            if (img && TierState.visibleThumbs.has(img)) img.src = tierThumbUrl(live.broadNo);
        }
    });
    if (needsObserve || setChanged) observeTierThumbs();
    if (TierPeek.card && !TierPeek.card.classList.contains('is-live')) tierPeekHide();
}

// 이 탭을 처음 열 때 한 번만 한다. 다른 탭 주소로 들어오면 쓰지 않는 명단을 받지 않는다.
function enterTierList() {
    if (TierState.listInit) {
        refreshTierLive(); // 다른 탭에 있던 사이에는 방송 상태를 갱신하지 않는다
        return TierState.listInit;
    }
    TierState.listInit = initTierList();
    return TierState.listInit;
}

async function initTierList() {
    let members;
    try {
        members = await fetchTierMembers();
        if (!members) throw new Error('티어 명단이 비어 있습니다');
    } catch (e) {
        console.error('티어 명단을 불러오지 못했습니다:', e);
        document.getElementById('tier-root').innerHTML =
            '<div class="content-state is-boxed">티어 명단을 불러오지 못했습니다. 잠시 후 다시 시도해주세요</div>';
        TierState.listInit = null;
        return;
    }

    // 로고를 기다리지 않고 그린 뒤 도착하면 그 자리만 채운다.
    loadTeamLogos(members.map(m => m.team)).then(swapTierTeamLogos);
    TierState.members = members;
    TierState.byId = {};
    TierState.members.forEach(m => {
        TierState.byId[tierIdKey(m)] = m;
    });

    // 방송 중이 100명을 넘으면 갱신마다 썸네일을 전부 받는 데 수 MB가 나가서 보이는 것만 갱신한다.
    if ('IntersectionObserver' in window) {
        TierState.thumbObserver = new IntersectionObserver(
            entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) TierState.visibleThumbs.add(e.target);
                    else TierState.visibleThumbs.delete(e.target);
                });
            },
            { rootMargin: '200px' }
        );
    }

    document.getElementById('tier-scope').addEventListener('click', onTierScopeClick);
    document.getElementById('tier-bar').addEventListener('click', onTierBarClick);
    initTierPeek();

    // 프레임당 한 번만 계산한다.
    let highlightScheduled = false;
    window.addEventListener(
        'scroll',
        () => {
            if (highlightScheduled) return;
            highlightScheduled = true;
            requestAnimationFrame(() => {
                highlightScheduled = false;
                highlightTierBar();
            });
        },
        { passive: true }
    );

    window.addEventListener('resize', syncTierBarHeight);
    window.addEventListener('resize', syncTierCardHeight);

    renderTierScope();
    renderTierGroups();
    highlightTierBar();

    // 다른 탭을 보고 있을 때는 멈추고, 돌아오면 바로 한 번 받는다.
    let tierLiveTimer = null;
    const startTierLive = () => {
        if (tierLiveTimer) return;
        tierLiveTimer = setInterval(refreshTierLive, TIER_LIVE_REFRESH_MS);
    };
    const stopTierLive = () => {
        if (tierLiveTimer) {
            clearInterval(tierLiveTimer);
            tierLiveTimer = null;
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopTierLive();
            return;
        }
        refreshTierLive();
        startTierLive();
    });

    refreshTierLive();
    if (!document.hidden) startTierLive();
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------
// 티어표는 우리 팀 멤버·경기 기록을 쓰지 않는다(siteData: false).
bootPage(
    async () => {
        // 명단 로딩이 실패하면 renderTierBar가 안 돌아 바가 펼쳐진 채로 남으므로 먼저 만든다.
        ensureTierPick();

        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                switchTierView(params.get('view'), params);
            })
        );
    },
    {
        siteData: false,
        view: params => activateTabView(TIER_TABS, tierViewKey(params.get('view'))),
        // 로고·설정을 기다리지 않고 받기 시작한다. 실패하면 탭이 다시 받는다.
        prefetch: () => {
            seedRuntimeConfigFromCache();
            const params = new URLSearchParams(location.search);
            const view = tierViewKey(params.get('view'));
            if (view !== 'list')
                loadTierCode(view)
                    .then(() => {
                        if (view === 'h2h' || view === 'analysis') h2hLoadIndex().catch(() => {});
                        if (view === 'analysis' && params.get('p')) analysisLoadRating(params.get('p'));
                    })
                    .catch(() => {});
            if (view === 'list') {
                requestTierMembers()
                    .then(rows => loadTeamLogos(asArray(rows).map(r => r.affiliation)))
                    .catch(() => {});
                fetchLiveBroadcasts().catch(() => {});
            }
        },
    }
);
