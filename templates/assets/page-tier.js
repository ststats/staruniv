/**
 * 티어표 페이지 - 스타 커뮤니티 전체 명단을 티어별로, 티어 안에서는 종족별로 보여준다.
 *
 * core.js의 fetchSynergyData()를 안 쓰는 이유:
 *   그 함수는 시너지 명단에서 "우리 멤버"만 남기고 나머지를 버린다(방송통계 페이지는
 *   그게 맞다). 티어표는 전체 명단이 필요해서 같은 파일을 따로 읽는다. 읽는 주소와
 *   방식은 완전히 동일하므로, 나중에 core.js가 전체 목록도 남겨두게 고치면
 *   fetchAllSynergyMembers()를 지우고 그걸 쓰면 된다.
 *
 * soop.js의 checkIsLiveRealtime()을 안 쓰는 이유:
 *   그건 한 명씩 bjapi에 묻는 방식이라 "활성 멤버가 소수"일 때만 성립한다. 수백 명에
 *   쓰면 브라우저 연결 한도에 걸려 대부분 조용히 실패한다. 대신 시너지가 이미 운영 중인
 *   클라우드플레어 워커를 쓴다 - 크론이 SOOP 전체 방송 목록을 미리 훑어 KV에 담아두므로
 *   우리는 그걸 한 번 읽기만 하면 된다(우리 쪽에서 SOOP 호출 0회).
 */

const TIER_LIVE_PROXY = 'https://synergy.ststats.workers.dev/';
// 워커 응답은 KV 읽기라 사실상 공짜다. 크론이 2분마다 KV를 채우는데 여기서도 2분마다
// 받아가면 최악의 경우 "채우기 직전에 받아가서" 2분을 더 기다린다(합계 4분).
// 짧게 잡아 그 대기를 없앤다.
const TIER_LIVE_REFRESH_MS = 30 * 1000;
// 수백 명이어도 URL이 7KB 안쪽이고 Cloudflare는 16KB까지 받는다. 나눌 이유가 없다.
const TIER_LIVE_CHUNK = 600;

// 시너지 명단에는 있지만 티어표에서는 빼는 팀.
// 여기 없는 값은 전부 통과시킨다 - 'FA'처럼 나중에 새로 생기는 팀이 자동으로 들어오게.
const TIER_HIDDEN_TEAMS = new Set(['휴면']);

// 티어 안에서 종족을 이 순서로 줄을 나눈다. 여기 없는 값(랜덤 등)은 뒤에 따로 묶인다.
const TIER_RACE_ORDER = ['테란', '저그', '프로토스'];

const TierState = {
    members: [],       // 표시 대상 전체
    byId: {},          // soopId(소문자) -> member
    live: {},          // soopId(소문자) -> { id, member, broadNo, title, viewers }
    liveOnly: false,   // 방송 중인 사람만 보기
    sections: [],      // [{ tier, id, count, total }] - 티어 바로가기 바가 쓴다
    activeId: null,    // 지금 강조 중인 티어 섹션 id (같으면 바를 다시 안 건드린다)
    visibleThumbs: new Set(),
    thumbObserver: null,
};

// ---------------------------------------------------------------------------
// 소분류 탭
// ---------------------------------------------------------------------------
function switchTierView(view) {
    const isList = view === 'list';
    document.getElementById('view-tier-list').classList.toggle('d-none', !isList);
    document.getElementById('view-tier-analysis').classList.toggle('d-none', isList);
    [['tab-tier-list', isList], ['tab-tier-analysis', !isList]].forEach(([id, on]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
    });
}

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function fetchAllSynergyMembers() {
    // dates.js는 JS 파일이라 JSON으로 못 읽는다 - 텍스트로 받아 배열만 뽑는다
    // (core.js의 fetchSynergyData와 같은 방식).
    const datesRes = await fetch(`${STSTATS_BASE}/data/dates.js`, { cache: 'no-cache' });
    if (!datesRes.ok) throw new Error(`dates.js HTTP ${datesRes.status}`);
    const match = (await datesRes.text()).match(/window\.AVAILABLE_DATES\s*=\s*(\[[^\]]*\])/);
    if (!match) throw new Error('날짜 목록 형식을 읽을 수 없습니다.');

    const dates = JSON.parse(match[1]);
    const latestDate = Array.isArray(dates) ? dates[0] : null;
    if (!latestDate) throw new Error('사용 가능한 날짜가 없습니다.');

    const dataRes = await fetch(`${STSTATS_BASE}/data/daily/${encodeURIComponent(latestDate)}.json`, { cache: 'no-cache' });
    if (!dataRes.ok) throw new Error(`daily json HTTP ${dataRes.status}`);
    const data = await dataRes.json();

    // 팀 값이 비어 있는 사람은 뺀다. 다만 조용히 버리지는 않는다 - 시트에서 팀 셀이
    // 실수로 지워지면 그 사람이 아무 흔적 없이 사라져서 원인을 찾기가 매우 어려워진다.
    // 콘솔에 남겨두면 "쟤 왜 없지?" 할 때 F12 한 번으로 답이 나온다.
    const noTeam = [];
    const members = asArray(data && data.members).filter(m => {
        if (!m || !isValidSoopId(m.id)) return false;
        const team = String(m.team || '').trim();
        if (!team) { noTeam.push(m.nickname || m.id); return false; }
        return !TIER_HIDDEN_TEAMS.has(team);
    });
    if (noTeam.length) {
        console.warn(`[티어표] 팀 값이 비어 있어 제외한 ${noTeam.length}명:`, noTeam);
    }

    return { date: latestDate, updatedAt: (data && data.updated_at) || '', members };
}

// ---------------------------------------------------------------------------
// 카드
// ---------------------------------------------------------------------------
function tierGroupKey(member) {
    const raw = (member.tier === null || member.tier === undefined) ? '' : String(member.tier).trim();
    return raw || '미분류';
}

function tierRaceKey(member) {
    const raw = String(member.race || '').trim();
    return raw || '기타';
}

function tierIdKey(member) {
    return String(member.id).trim().toLowerCase();
}

// 화면에 쓰는 티어 이름. 숫자 티어(0~8)는 그냥 "3"이라고만 쓰면 인원수인지 티어인지
// 헷갈려서 "3티어"로 적는다. 갓/킹/잭처럼 이름이 있는 티어는 그대로 둔다
// ("갓티어"는 어색하다). 그룹 키는 원본 값 그대로 쓰고 표기만 바꾼다.
function tierDisplayName(tier) {
    const label = String(tier);
    return /^\d+$/.test(label) ? `${label}티어` : label;
}

// 썸네일 주소에는 아이디가 아니라 방송번호가 들어간다 - 방송을 켤 때마다 새로 생기는
// 값이라 아이디만으로는 만들 수 없다. 뒤의 분 단위 값은 브라우저 캐시를 1분에 한 번만
// 비우기 위한 것(매번 새로 받으면 낭비).
function tierThumbUrl(broadNo) {
    return `https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broadNo)}?t=${Math.floor(Date.now() / 60000)}`;
}

// 팀 로고 경로 규칙은 build_html.py의 team_logo_src와 같다(images/{팀이름}.webp).
// 로고 파일이 없는 팀도 있으므로 실패하면 이미지만 조용히 숨긴다 - 팀 이름은 남는다.
function tierTeamLogoHtml(team) {
    if (!team) return '';
    const src = `images/${encodeURIComponent(team)}.webp`;
    return `<img class="team-logo-icon tier-card-team-logo" src="${escapeHTML(src)}" alt=""
                 loading="lazy" onerror="this.remove();">`;
}

// 카드 위쪽 영역. 방송 중이면 16:9 썸네일, 아니면 같은 크기 박스 안에 동그란 프로필.
// 두 경우의 높이가 같아야 그리드가 들쭉날쭉해지지 않는다.
function tierCardMediaHtml(member, live) {
    const soopId = String(member.id).trim();
    if (live) {
        const fallback = getProfileImgUrl(soopId) || '';
        return `
            <span class="live-badge">LIVE</span>
            <span class="tier-card-viewers">${live.viewers.toLocaleString('ko-KR')}</span>
            <img class="tier-card-thumb" src="${escapeHTML(tierThumbUrl(live.broadNo))}" alt="" loading="lazy"
                 ${fallback ? `onerror="this.src='${jsAttr(fallback)}';"` : ''}>`;
    }
    return avatarHtml(soopId, 'tier-card-avatar');
}

function tierCardHtml(member, live) {
    const soopId = String(member.id).trim();
    const team = String(member.team || '').trim();
    return `
    <a class="tier-card${live ? ' is-live' : ''}" data-tier-id="${escapeHTML(tierIdKey(member))}"
       href="https://ch.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener"
       title="${escapeHTML(live ? live.title : (member.nickname || soopId))}">
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
// 그리드
// ---------------------------------------------------------------------------
function tierVisibleMembers() {
    if (!TierState.liveOnly) return TierState.members;
    return TierState.members.filter(m => TierState.live[tierIdKey(m)]);
}

// 한 티어 안을 종족별로 줄을 나눈다. 종족이 섞여 있으면 누가 뭘 하는지 한눈에 안 들어와서,
// 테란 → 저그 → 프로토스 순으로 묶어 각각 한 줄(그리드)로 만든다.
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

    return known.concat(unknown).map(race => `
        <div class="tier-race-block" data-race="${escapeHTML(race)}">
            <div class="tier-grid">
                ${byRace.get(race).map(m => tierCardHtml(m, TierState.live[tierIdKey(m)])).join('')}
            </div>
        </div>`).join('');
}

function renderTierGroups() {
    const list = tierVisibleMembers();

    // 제목에 쓸 "그 티어의 전체 인원"은 필터와 무관하게 항상 같은 값이어야 한다.
    // '방송중'을 켰을 때 이 숫자까지 줄어들면, 뒤에 붙는 "N명 방송중"과 같은 값이 되어
    // 같은 말을 두 번 하게 되고 정작 티어 규모라는 정보만 사라진다.
    const totals = new Map();
    TierState.members.forEach(m => {
        const key = tierGroupKey(m);
        totals.set(key, (totals.get(key) || 0) + 1);
    });

    const groups = new Map();
    list.forEach(m => {
        const key = tierGroupKey(m);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    });

    // core.js의 tierIndex()는 목록에 없는 값이면 배열 길이를 돌려줘 맨 뒤로 보낸다.
    // 모르는 값(오타·새 티어·미분류)을 버리지 않는 게 중요하다 - 데이터가 조금 어긋나도
    // 사람이 화면에서 사라지지는 않아야 한다.
    const tiers = Array.from(groups.keys()).sort((a, b) => {
        const diff = tierIndex(a) - tierIndex(b);
        return diff !== 0 ? diff : a.localeCompare(b, 'ko');
    });

    // 티어 이름을 그대로 id에 쓰면(한글·숫자·공백) 선택자에서 다루기 번거로워서 순번으로 만든다.
    // count = 지금 화면에 그려지는 수(바로가기 칩), total = 필터와 무관한 티어 전체 인원(제목).
    TierState.sections = tiers.map((tier, i) => ({
        tier,
        id: `tier-sec-${i}`,
        count: groups.get(tier).length,
        total: totals.get(tier) || groups.get(tier).length,
    }));

    document.getElementById('tier-root').innerHTML = TierState.sections.length
        ? TierState.sections.map(sec => `
            <div class="tier-row" id="${sec.id}">
                <div class="section-title">
                    <span class="section-title-label">${escapeHTML(tierDisplayName(sec.tier))}<span class="title-count-divider"></span><span class="text-secondary title-count">${sec.total}명</span><span class="tier-live" data-tier-live></span></span>
                </div>
                ${tierRaceBlocksHtml(groups.get(sec.tier))}
            </div>`).join('')
        : `<div class="tier-empty">${TierState.liveOnly ? '방송 중인 사람이 없습니다.' : '표시할 인원이 없습니다.'}</div>`;

    observeTierThumbs();
    renderTierBar();
    updateTierRowLiveCounts();
    highlightTierBar();  // 칩을 새로 만들었으니 지금 보고 있는 티어를 바로 강조해준다
}

function observeTierThumbs() {
    if (!TierState.thumbObserver) return;
    TierState.thumbObserver.disconnect();
    TierState.visibleThumbs.clear();
    document.querySelectorAll('#tier-root .tier-card-thumb')
        .forEach(img => TierState.thumbObserver.observe(img));
}

function updateTierRowLiveCounts() {
    document.querySelectorAll('#tier-root .tier-row').forEach(row => {
        const count = row.querySelectorAll('.tier-card.is-live').length;
        const slot = row.querySelector('[data-tier-live]');
        if (!slot) return;
        // 0명이면 앞의 구분점까지 같이 사라져야 한다(점만 덩그러니 남으면 이상하다).
        slot.innerHTML = count > 0
            ? `<span class="tier-live-sep">·</span>${count}명 방송중`
            : '';
    });
}

// ---------------------------------------------------------------------------
// 티어 바로가기 바
// ---------------------------------------------------------------------------
// 공지/전적의 아바타 바처럼 가로로 흐르는 한 줄짜리 바인데, 티어는 사진이 없으니
// 동그라미 대신 이름+인원이 들어간 알약형 칩으로 만든다.
function renderTierBar() {
    const list = document.getElementById('tier-bar-list');
    if (!list) return;
    list.innerHTML = TierState.sections.map(sec => `
        <button type="button" class="tier-bar-item" data-target="${sec.id}">
            <span class="tier-bar-name">${escapeHTML(tierDisplayName(sec.tier))}</span>
            <span class="tier-bar-count">${sec.count}</span>
        </button>`).join('');
    TierState.activeId = null;  // 칩을 새로 만들었으니 강조도 다시 붙여야 한다
    syncTierBarHeight();
}

// 티어 바 높이를 CSS 변수로 넘겨서, 바로가기로 이동했을 때 제목이 바 뒤에 가리지 않게 한다.
// (아바타 바는 내용에 따라 높이가 달라져서 CSS에 숫자로 못 박아둔다.)
function syncTierBarHeight() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    document.documentElement.style.setProperty('--tier-bar-h', `${bar.offsetHeight}px`);
}

function onTierBarClick(event) {
    const btn = event.target.closest('.tier-bar-item');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    // 얼마나 위로 띄울지는 CSS의 scroll-margin-top이 정한다(상단 메뉴 + 티어 바 높이).
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 지금 보고 있는 티어로 판정하는 가로선을, 바 바로 밑이 아니라 "바 아래 남은 화면"의
// 이만큼 내려온 곳에 둔다. 예전엔 바 바로 밑(+8px)이라, 다음 티어의 제목이 바에 겨우
// 걸치기만 해도 - 화면의 90%는 아직 윗 티어인데 - 아랫 티어로 넘어가지 않고 반대로
// 윗 티어가 화면에서 거의 사라질 때까지 계속 강조됐다. 0.35면 화면의 3분의 1 이상을
// 차지한 티어가 강조된다.
const TIER_HIGHLIGHT_RATIO = 0.35;

// 스크롤에 따라 지금 보고 있는 티어를 바에서 강조한다.
function highlightTierBar() {
    if (TierState.sections.length === 0) return;
    const offset = tierStickyOffset();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const line = offset + Math.max(72, (viewport - offset) * TIER_HIGHLIGHT_RATIO);

    let currentId = TierState.sections[0].id;
    for (const sec of TierState.sections) {
        const el = document.getElementById(sec.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) currentId = sec.id;
        else break;
    }
    // 맨 아래에서는 마지막 티어가 짧으면 판정선까지 못 올라온다 - 더 스크롤할 데가 없으니
    // 그 티어를 보고 있는 게 맞다.
    const docHeight = document.documentElement.scrollHeight;
    if (window.scrollY + viewport >= docHeight - 2) {
        currentId = TierState.sections[TierState.sections.length - 1].id;
    }

    // 활성 티어가 그대로면 아무것도 건드리지 않는다. 스크롤은 초당 수십 번 오는데 그때마다
    // scrollTo(smooth)를 다시 부르면 애니메이션이 매번 처음부터 다시 시작해서, 사용자가 바를
    // 손으로 밀고 있을 때 서로 잡아당기는 것처럼 보인다.
    if (currentId === TierState.activeId) return;
    TierState.activeId = currentId;

    let activeBtn = null;
    document.querySelectorAll('#tier-bar .tier-bar-item').forEach(btn => {
        const on = btn.dataset.target === currentId;
        btn.classList.toggle('active', on);   // 아바타 바와 같은 클래스명
        if (on) activeBtn = btn;
    });
    if (activeBtn) scrollTierBarItemIntoView(activeBtn);
}

// 티어가 많으면 바가 좌우로 스크롤되는데, 강조된 항목이 화면 밖이면 의미가 없다.
// scrollIntoView 대신 바 자체의 scrollLeft만 건드린다 - scrollIntoView는 조상 요소까지
// 같이 움직여서, 사용자가 스크롤하는 중에 페이지가 세로로 튀는 일이 생길 수 있다.
function scrollTierBarItemIntoView(btn) {
    const list = document.getElementById('tier-bar-list');
    if (!list || list.scrollWidth <= list.clientWidth) return;
    // 보이는 범위 안에 "들어오기만" 하면 되는 게 아니라 가운데로 데려온다. 휴대폰에서는
    // 왼쪽 전환 버튼이 먹고 남은 폭이 좁아서, 가장자리에 걸쳐 놓으면 다음 티어로 넘어가는
    // 순간 바로 화면 밖으로 밀린다. 가운데면 앞뒤 티어도 같이 보인다.
    // (목록의 처음/끝에서는 더 갈 데가 없으므로 자연스럽게 왼쪽/오른쪽 끝에 붙는다.)
    const centered = btn.offsetLeft - (list.clientWidth - btn.offsetWidth) / 2;
    const maxLeft = list.scrollWidth - list.clientWidth;
    const left = Math.max(0, Math.min(centered, maxLeft));
    if (Math.abs(left - list.scrollLeft) < 1) return;
    list.scrollTo({ left, behavior: 'smooth' });
}

function tierStickyOffset() {
    const nav = document.querySelector('.top-navbar');
    const bar = document.getElementById('tier-bar');
    return (nav ? nav.offsetHeight : 64) + (bar ? bar.offsetHeight : 0);
}

// ---------------------------------------------------------------------------
// 보기 전환 (전체 / 방송중)
// ---------------------------------------------------------------------------
// 예전엔 "512명"이라는 맨 글자 옆에 방송중 토글이 따로 있었다. 둘은 사실 "무엇을 보여줄까"
// 라는 같은 축의 두 선택지라, 숫자를 각자 달고 있는 세그먼트 컨트롤 하나로 합쳤다.
// 누르지 않아도 전체 대비 방송 중 인원이 바로 읽힌다. 두 버튼은 생김새가 완전히 같고,
// 숫자 색(전체=파랑, 방송중=빨강)만 다르다.
function renderTierScope() {
    const scope = document.getElementById('tier-scope');
    if (!scope) return;
    const total = TierState.members.length;
    const liveCount = Object.keys(TierState.live).length;
    scope.innerHTML = `
        <button type="button" class="tier-scope-btn tier-scope-all${TierState.liveOnly ? '' : ' on'}"
                data-live-only="0" aria-pressed="${!TierState.liveOnly}">
            전체<span class="tier-scope-num">${total.toLocaleString('ko-KR')}</span>
        </button>
        <button type="button" class="tier-scope-btn tier-scope-live${TierState.liveOnly ? ' on' : ''}"
                data-live-only="1" aria-pressed="${TierState.liveOnly}">
            방송중<span class="tier-scope-num">${liveCount.toLocaleString('ko-KR')}</span>
        </button>`;
}

function onTierScopeClick(event) {
    const btn = event.target.closest('.tier-scope-btn');
    if (!btn) return;
    const wantLive = btn.dataset.liveOnly === '1';
    // '방송중'을 다시 눌러도 꺼지게 둔다(옛 필터 버튼의 습관이 남아 있는 사람용).
    const next = wantLive ? !TierState.liveOnly : false;
    if (next === TierState.liveOnly) return;  // 이미 그 보기면 다시 그릴 필요가 없다
    TierState.liveOnly = next;
    renderTierScope();
    renderTierGroups();
}

// ---------------------------------------------------------------------------
// 방송 상태
// ---------------------------------------------------------------------------
function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function refreshTierLive() {
    const ids = TierState.members.map(m => String(m.id).trim());
    if (ids.length === 0) return;

    const merged = {};
    await Promise.all(chunkArray(ids, TIER_LIVE_CHUNK).map(async part => {
        try {
            const res = await fetch(`${TIER_LIVE_PROXY}?ids=${encodeURIComponent(part.join(','))}`);
            if (!res.ok) return;
            const data = await res.json();
            Object.assign(merged, (data && data.live) || {});
        } catch (e) {
            // 방송 표시는 부가 정보다. 실패해도 명단 자체에는 영향이 없어야 한다.
        }
    }));

    const next = {};
    Object.keys(merged).forEach(id => {
        const info = merged[id];
        const key = String(id).toLowerCase();
        const member = TierState.byId[key];
        if (!member || !info || !info.broad_no) return;
        next[key] = {
            id,
            member,
            broadNo: info.broad_no,
            title: info.broad_title || '',
            viewers: Number(info.current_sum_viewer) || 0,
        };
    });

    const changed = liveSetChanged(TierState.live, next);
    TierState.live = next;
    renderTierScope();

    // "방송중만"이 켜져 있고 명단 자체가 바뀌었으면 통째로 다시 그린다. 그 외에는 카드를
    // 다시 만들지 않고 필요한 카드만 손본다 - 전부 다시 그리면 수백 장의 이미지가
    // 매번 새로 로드된다.
    if (changed && TierState.liveOnly) {
        renderTierGroups();
        return;
    }
    applyLiveToCards(changed);
    updateTierRowLiveCounts();
}

function liveSetChanged(prev, next) {
    return Object.keys(prev).sort().join(',') !== Object.keys(next).sort().join(',');
}

function applyLiveToCards(setChanged) {
    let needsObserve = false;
    document.querySelectorAll('#tier-root .tier-card').forEach(card => {
        const key = card.dataset.tierId;
        const live = TierState.live[key];
        const wasLive = card.classList.contains('is-live');
        const media = card.querySelector('.tier-card-media');
        if (!media) return;

        if (!!live !== wasLive) {
            // 방송이 켜지거나 꺼진 카드만 위쪽 영역을 새로 만든다.
            const member = TierState.byId[key];
            if (!member) return;
            media.innerHTML = tierCardMediaHtml(member, live);
            card.classList.toggle('is-live', !!live);
            card.title = live ? live.title : (member.nickname || member.id);
            needsObserve = true;
        } else if (live) {
            // 계속 방송 중이면 숫자만 고치고, 썸네일은 화면에 보이는 것만 새로 받는다.
            const viewers = media.querySelector('.tier-card-viewers');
            if (viewers) viewers.textContent = live.viewers.toLocaleString('ko-KR');
            const img = media.querySelector('.tier-card-thumb');
            if (img && TierState.visibleThumbs.has(img)) img.src = tierThumbUrl(live.broadNo);
        }
    });
    if (needsObserve || setChanged) observeTierThumbs();
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------
bootPage(async () => {
    const root = document.getElementById('tier-root');

    let payload;
    try {
        payload = await fetchAllSynergyMembers();
    } catch (e) {
        console.error('티어 명단을 불러오지 못했습니다:', e);
        root.innerHTML = '<div class="tier-empty">티어 명단을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
        return;
    }

    TierState.members = payload.members;
    TierState.byId = {};
    TierState.members.forEach(m => { TierState.byId[tierIdKey(m)] = m; });

    // 썸네일은 화면에 보이는 것만 갱신한다. 방송 중인 사람이 100명을 넘어가면
    // 30초마다 전부 새로 받는 순간 수 MB가 나간다.
    if ('IntersectionObserver' in window) {
        TierState.thumbObserver = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) TierState.visibleThumbs.add(e.target);
                else TierState.visibleThumbs.delete(e.target);
            });
        }, { rootMargin: '200px' });
    }

    document.getElementById('tier-scope').addEventListener('click', onTierScopeClick);
    document.getElementById('tier-bar').addEventListener('click', onTierBarClick);

    // 스크롤 이벤트는 초당 수십 번 온다. 프레임당 한 번만 계산한다.
    let highlightScheduled = false;
    window.addEventListener('scroll', () => {
        if (highlightScheduled) return;
        highlightScheduled = true;
        requestAnimationFrame(() => { highlightScheduled = false; highlightTierBar(); });
    }, { passive: true });

    window.addEventListener('resize', syncTierBarHeight);

    renderTierScope();
    renderTierGroups();
    highlightTierBar();

    refreshTierLive();
    setInterval(refreshTierLive, TIER_LIVE_REFRESH_MS);
});
