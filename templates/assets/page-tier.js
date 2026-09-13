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
    sections: [],      // [{ tier, id, count }] - 티어 바로가기 바가 쓴다
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
    TierState.sections = tiers.map((tier, i) => ({
        tier,
        id: `tier-sec-${i}`,
        count: groups.get(tier).length,
    }));

    document.getElementById('tier-total').textContent = `${list.length}명`;
    document.getElementById('tier-root').innerHTML = TierState.sections.length
        ? TierState.sections.map((sec, i) => `
            <div class="tier-row" id="${sec.id}">
                <div class="tier-head${i === 0 ? ' is-top' : ''}">
                    <span class="tier-name">${escapeHTML(sec.tier)}</span>
                    <span class="tier-count">${sec.count}명</span>
                    <span class="tier-live" data-tier-live></span>
                </div>
                ${tierRaceBlocksHtml(groups.get(sec.tier))}
            </div>`).join('')
        : `<div class="tier-empty">${TierState.liveOnly ? '방송 중인 사람이 없습니다.' : '표시할 인원이 없습니다.'}</div>`;

    observeTierThumbs();
    renderTierBar();
    updateTierRowLiveCounts();
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
        if (slot) slot.textContent = count > 0 ? `${count}명 방송중` : '';
    });
}

// ---------------------------------------------------------------------------
// 티어 바로가기 바
// ---------------------------------------------------------------------------
function renderTierBar() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    bar.innerHTML = TierState.sections.map(sec => `
        <button type="button" class="tier-bar-item" data-target="${sec.id}">
            <span class="tier-bar-name">${escapeHTML(sec.tier)}</span>
            <span class="tier-bar-count">${sec.count}</span>
        </button>`).join('');
}

function onTierBarClick(event) {
    const btn = event.target.closest('.tier-bar-item');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    // 얼마나 위로 띄울지는 CSS의 scroll-margin-top이 정한다(상단 메뉴 + 티어 바 높이).
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 스크롤에 따라 지금 보고 있는 티어를 바에서 강조한다.
function highlightTierBar() {
    if (TierState.sections.length === 0) return;
    const line = tierStickyOffset() + 8;
    let currentId = TierState.sections[0].id;
    for (const sec of TierState.sections) {
        const el = document.getElementById(sec.id);
        if (el && el.getBoundingClientRect().top <= line) currentId = sec.id;
        else break;
    }
    let activeBtn = null;
    document.querySelectorAll('#tier-bar .tier-bar-item').forEach(btn => {
        const on = btn.dataset.target === currentId;
        btn.classList.toggle('on', on);
        if (on) activeBtn = btn;
    });
    // 티어가 많으면 바가 좌우로 스크롤되는데, 강조된 항목이 화면 밖이면 의미가 없다.
    if (activeBtn && activeBtn.scrollIntoView) {
        activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

function tierStickyOffset() {
    const nav = document.querySelector('.top-navbar');
    const bar = document.getElementById('tier-bar');
    return (nav ? nav.offsetHeight : 64) + (bar ? bar.offsetHeight : 0);
}

// ---------------------------------------------------------------------------
// 방송중 필터
// ---------------------------------------------------------------------------
function renderTierFilters() {
    const liveCount = Object.keys(TierState.live).length;
    document.getElementById('tier-filters').innerHTML = `
        <button type="button" class="tier-filter tier-filter-live${TierState.liveOnly ? ' on' : ''}"
                data-live-only="1" aria-pressed="${TierState.liveOnly}">
            <span class="tier-filter-dot"></span>방송중${liveCount ? ` ${liveCount}` : ''}
        </button>`;
}

function onTierFilterClick(event) {
    const btn = event.target.closest('.tier-filter');
    if (!btn) return;
    TierState.liveOnly = !TierState.liveOnly;
    renderTierFilters();
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
    renderTierFilters();

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

    const subtitle = document.getElementById('tier-subtitle');
    if (subtitle) {
        subtitle.textContent = payload.date
            ? `${payload.date} 기준 · 방송 중이면 카드에 방송 화면이 보입니다.`
            : '방송 중이면 카드에 방송 화면이 보입니다.';
    }

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

    document.getElementById('tier-filters').addEventListener('click', onTierFilterClick);
    document.getElementById('tier-bar').addEventListener('click', onTierBarClick);

    // 스크롤 이벤트는 초당 수십 번 온다. 프레임당 한 번만 계산한다.
    let highlightScheduled = false;
    window.addEventListener('scroll', () => {
        if (highlightScheduled) return;
        highlightScheduled = true;
        requestAnimationFrame(() => { highlightScheduled = false; highlightTierBar(); });
    }, { passive: true });

    renderTierFilters();
    renderTierGroups();
    highlightTierBar();

    refreshTierLive();
    setInterval(refreshTierLive, TIER_LIVE_REFRESH_MS);
});
