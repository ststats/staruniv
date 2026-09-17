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
    liveOnly: true,    // 방송 중인 사람만 보기 (첫 진입 기본값)
    sections: [],      // [{ tier, id, count }] - 티어 제목·바로가기 바가 쓴다
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
        // 미디어 영역에는 방송 화면만 둔다. LIVE 알약도 시청자 수도 뺐다 - 화면이 보이는
        // 것 자체가 이미 "켜져 있다"는 표시고, 티어표는 누가 방송 중인지 훑는 곳이지
        // 시청자 수를 비교하는 곳이 아니다. 작은 카드에 얹을수록 방송 화면만 가린다.
        return `
            <img class="tier-card-thumb" src="${escapeHTML(tierThumbUrl(live.broadNo))}" alt="" loading="lazy"
                 ${fallback ? `onerror="this.src='${jsAttr(fallback)}';"` : ''}>`;
    }
    return avatarHtml(soopId, 'tier-card-avatar');
}

// 스타크래프트가 아닌 방송은 카드를 살짝 회색으로 눌러둔다(명단에서 빼지는 않는다 -
// 방송을 켠 건 맞으니까). 제목 옆에 카테고리도 같이 달아 왜 회색인지 알 수 있게 한다.
function tierCardTitle(member, live) {
    const base = live ? live.title : (member.nickname || String(member.id).trim());
    return (live && live.category && !live.isStar) ? `[${live.category}] ${base}` : base;
}

function tierCardHtml(member, live) {
    const soopId = String(member.id).trim();
    const team = String(member.team || '').trim();
    const raceLetter = raceShortLabel(member.race || '');
    const raceEdge = ['T', 'Z', 'P'].includes(raceLetter) ? ` edge-${raceLetter}` : '';
    return `
    <a class="tier-card${raceEdge}${live ? ' is-live' : ''}${live && !live.isStar ? ' is-offcate' : ''}" data-tier-id="${escapeHTML(tierIdKey(member))}"
       href="https://${live ? 'play' : 'ch'}.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener"
       title="${escapeHTML(tierCardTitle(member, live))}">
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
    // 다시 그리면 문서 높이가 바뀐다 - 그 전에 지금 보던 티어의 위치를 재둔다.
    const anchor = captureTierAnchor();
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
    // count = 지금 화면에 그려지는 인원. 제목 배지와 바로가기 칩이 같이 쓴다.
    // '방송중' 보기면 방송 중인 인원, '전체' 보기면 티어 전체 인원이 된다.
    TierState.sections = tiers.map((tier, i) => ({
        tier,
        id: `tier-sec-${i}`,
        count: groups.get(tier).length,
    }));

    document.getElementById('tier-root').innerHTML = TierState.sections.length
        ? TierState.sections.map(sec => `
            <div class="tier-row" id="${sec.id}">
                <div class="section-title" data-en="${tierLatinLabel(sec.tier)} TIER">
                    <span class="section-title-label">${escapeHTML(tierDisplayName(sec.tier))}</span><span class="title-count">${sec.count}명</span>
                </div>
                ${tierRaceBlocksHtml(groups.get(sec.tier))}
            </div>`).join('')
        : `<div class="tier-empty">${TierState.liveOnly ? '방송 중인 사람이 없습니다.' : '표시할 인원이 없습니다.'}</div>`;

    observeTierThumbs();
    renderTierBar();
    ensureTierPick();
    restoreTierAnchor(anchor);
    highlightTierBar();  // 칩을 새로 만들었으니 지금 보고 있는 티어를 바로 강조해준다
    syncTierPickLabel();
}

function observeTierThumbs() {
    if (!TierState.thumbObserver) return;
    TierState.thumbObserver.disconnect();
    TierState.visibleThumbs.clear();
    document.querySelectorAll('#tier-root .tier-card-thumb')
        .forEach(img => TierState.thumbObserver.observe(img));
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
// [리디자인] 티어 바가 왼쪽 사이드바로 서 있을 때는 본문을 가리지 않는다. 그때 바 높이
// (사이드바라 500px이 넘는다)를 그대로 넘기면 scroll-margin-top이 터무니없이 커져서
// 바로가기를 눌렀을 때 제목이 화면 밖으로 날아간다. 그래서 0을 넘긴다.
function tierBarCoversContent() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return false;
    // 사이드바 틀 안에 있고 화면이 좁지 않으면 = 세로 사이드바 = 본문을 가리지 않는다
    const inSidebar = !!bar.closest('.selection-layout');
    const narrow = window.matchMedia('(max-width: 920px)').matches;
    return !inSidebar || narrow;
}

// [리디자인] 모바일에서 티어 바도 아바타 사이드바와 같은 '접히는 한 줄 선택 바'가 되게 한다.
// 가로로 눕히면 티어 15개를 계속 밀어야 하고, 세로로 펼쳐두면 화면을 다 먹는다.
// 줄과 토글을 여기서 한 번만 만들고, 선택이 바뀌면 라벨을 갱신하며 접는다.
function ensureTierPick() {
    const bar = document.getElementById('tier-bar');
    if (!bar || bar.querySelector('.tier-bar-pick')) return;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'tier-bar-pick';
    pick.setAttribute('aria-expanded', 'false');
    pick.innerHTML = '<span class="tier-bar-pick-label">티어 바로가기</span>'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" '
        + 'stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    pick.addEventListener('click', () => {
        const closed = bar.classList.toggle('is-closed');
        pick.setAttribute('aria-expanded', closed ? 'false' : 'true');
    });
    bar.classList.add('is-closed');
    bar.insertBefore(pick, bar.firstChild);
}

// 눌린 티어 칩의 이름을 모바일 선택 줄에 반영하고 목록을 접는다.
function syncTierPickLabel() {
    const bar = document.getElementById('tier-bar');
    if (!bar) return;
    const pick = bar.querySelector('.tier-bar-pick');
    if (!pick) return;
    const active = bar.querySelector('.tier-bar-item.active');
    const label = pick.querySelector('.tier-bar-pick-label');
    // 칩 안의 이름과 인원수 사이에 공백이 없어서 '갓12'처럼 붙어 나온다 - 따로 읽어서 띄운다.
    if (!label) return;
    if (!active) { label.textContent = '티어 바로가기'; return; }
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
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - tierStickyOffset() - 12, behavior: 'instant' });
    highlightTierBar();
}

// 선택한 제목이 놓이는 고정 바 바로 아래를 활성 티어 판정선으로 사용한다.

// 지금 화면을 차지하고 있는 티어 섹션의 id.
function currentTierSectionId() {
    if (TierState.sections.length === 0) return null;
    const offset = tierStickyOffset();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const line = offset + 16;

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
    return currentId;
}

// 스크롤에 따라 지금 보고 있는 티어를 바에서 강조한다.
function highlightTierBar() {
    const currentId = currentTierSectionId();
    if (!currentId) return;

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
    syncTierPickLabel();   // 모바일 선택 줄의 라벨도 같이 따라간다
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
    //
    // [주의] 여기서 offsetLeft를 쓰면 안 된다. offsetLeft는 "스크롤되는 목록"이 아니라
    // offsetParent 기준인데, .tier-bar가 position:sticky라 그게 offsetParent가 된다.
    // 그래서 칩 위치에 왼쪽 전환 버튼 폭까지 얹혀서 계산되고, 딱 그만큼 어긋난 자리로
    // 스크롤됐다(폭이 좁은 휴대폰에서 티가 크게 났다). 목록 기준 좌표를 직접 구한다.
    const listRect = list.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const btnLeft = btnRect.left - listRect.left + list.scrollLeft;  // 목록 내용 기준 x
    const centered = btnLeft - (list.clientWidth - btnRect.width) / 2;
    const maxLeft = list.scrollWidth - list.clientWidth;
    const left = Math.max(0, Math.min(centered, maxLeft));
    if (Math.abs(left - list.scrollLeft) < 1) return;
    list.scrollTo({ left, behavior: 'smooth' });
}

// [리디자인] 티어 제목 위에 붙는 라틴 라벨. 이름 티어는 대응 영문을, 숫자 티어는 T0~T8로.
const TIER_EN = { '갓': 'GOD', '킹': 'KING', '잭': 'JACK', '조커': 'JOKER', '스페이드': 'SPADE', '베이비': 'BABY' };
function tierLatinLabel(tier) {
    const key = String(tier || '').replace('티어', '').trim();
    if (TIER_EN[key]) return TIER_EN[key];
    return /^\d+$/.test(key) ? key + ' TIER' : 'TIER';
}

function tierStickyOffset() {
    const nav = document.querySelector('.top-navbar');
    const bar = document.getElementById('tier-bar');
    // 사이드바로 서 있을 때는 바가 본문을 가리지 않으므로 높이를 더하지 않는다.
    const barH = bar && tierBarCoversContent() ? bar.offsetHeight : 0;
    return (nav ? nav.offsetHeight : 64) + barH;
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
    // 바로가기 칩의 숫자 색을 지금 보기에 맞추려고 바 자체에 표시해둔다(색은 CSS가 정한다).
    const bar = document.getElementById('tier-bar');
    if (bar) bar.classList.toggle('is-live-only', TierState.liveOnly);
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
// 다시 그릴 때 보던 자리 지키기
// ---------------------------------------------------------------------------
// '방송중'을 켜면 카드가 확 줄어들면서 문서 전체가 짧아진다. 브라우저는 스크롤 위치를
// 픽셀 값으로만 기억하므로, 2티어를 보고 있었어도 같은 높이에 있던 7티어로 튀어버린다.
// 그래서 다시 그리기 직전에 "지금 보던 티어가 화면 어디쯤에 걸려 있었는지"를 재두고,
// 다 그린 뒤 그 티어를 같은 자리로 되돌린다. 섹션 id는 순번이라 필터가 바뀌면 값이
// 달라지므로 id가 아니라 티어 이름으로 찾는다.
function captureTierAnchor() {
    const id = TierState.activeId || currentTierSectionId();
    const sec = TierState.sections.find(s => s.id === id);
    const el = sec && document.getElementById(sec.id);
    if (!el) return null;
    return { tier: sec.tier, top: el.getBoundingClientRect().top };
}

function restoreTierAnchor(anchor) {
    if (!anchor) return;
    const offset = tierStickyOffset() + 16;  // .tier-row의 scroll-margin-top과 같은 기준

    let sec = TierState.sections.find(s => s.tier === anchor.tier);
    let keepOffset = true;
    if (!sec) {
        // 보던 티어가 통째로 사라진 경우(그 티어에 방송 중인 사람이 한 명도 없음).
        // 맨 위로 튕기지 말고 원래 순서상 바로 다음 티어로 - 없으면 마지막 티어로 - 데려간다.
        const idx = tierIndex(anchor.tier);
        sec = TierState.sections.find(s => tierIndex(s.tier) >= idx)
            || TierState.sections[TierState.sections.length - 1];
        keepOffset = false;  // 남의 티어에 원래 높이를 맞출 이유는 없다. 그 티어의 처음부터.
    }
    const el = sec && document.getElementById(sec.id);
    if (!el) return;

    // 원래 걸려 있던 높이를 그대로 지키되, 그 티어가 짧아졌으면 지나쳐 가지 않게 잡아둔다
    // (예: 20명짜리 티어 한가운데를 보고 있었는데 방송 중은 2명이면 그 2명 위로 올라온다).
    const top = keepOffset ? Math.max(anchor.top, offset + 80 - el.offsetHeight) : offset;
    const delta = el.getBoundingClientRect().top - top;
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: 'auto' });  // 순간이동이어야 자리가 안 흔들린 것처럼 보인다
}

// ---------------------------------------------------------------------------
// 카테고리 (스타크래프트인지)
// ---------------------------------------------------------------------------
// SOOP 방송 목록이 주는 값을 워커가 그대로 실어준다(category_name: "스타크래프트",
// broad_cate_no: "00040001"). 이름을 먼저 보고, 이름이 없을 때만 번호로 판단한다 -
// 번호 체계는 SOOP이 언제든 바꿀 수 있지만 이름은 사람이 읽는 값이라 덜 흔들린다.
const TIER_STARCRAFT_CATE_NOS = new Set(['00040001']);
const TIER_STARCRAFT_NAME_RE = /스타\s*크래프트|starcraft|브루드\s*워|brood\s*war/i;

// 판단할 근거가 아예 없으면 "스타로 친다"(true). 워커가 아직 카테고리를 안 싣고 있거나
// 필드 이름이 바뀌었을 때 멀쩡한 방송이 전부 회색이 되면 안 된다 - 모를 때는 아무 표시도
// 안 하는 쪽이 안전하다.
function isStarcraftCategory(name, no) {
    if (name) return TIER_STARCRAFT_NAME_RE.test(name);
    if (no) return TIER_STARCRAFT_CATE_NOS.has(no);
    return true;
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
        const categoryName = String(info.category_name || '').trim();
        const categoryNo = String(info.broad_cate_no || '').trim();
        next[key] = {
            id,
            member,
            broadNo: info.broad_no,
            title: info.broad_title || '',
            viewers: Number(info.current_sum_viewer) || 0,
            category: categoryName,
            isStar: isStarcraftCategory(categoryName, categoryNo),
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
            // 방송이 켜지거나 꺼진 카드만 위쪽 영역을 새로 만든다.
            const member = TierState.byId[key];
            if (!member) return;
            media.innerHTML = tierCardMediaHtml(member, live);
            card.classList.toggle('is-live', !!live);
            card.classList.toggle('is-offcate', !!live && !live.isStar);
            card.title = tierCardTitle(member, live);
            needsObserve = true;
        } else if (live) {
            // 방송 중에 카테고리를 바꾸는 일은 흔하다(스타 하다가 저챗 등) - 회색 여부도 따라간다.
            card.classList.toggle('is-offcate', !live.isStar);
            card.title = tierCardTitle(TierState.byId[key] || live.member, live);
            // 계속 방송 중이면 썸네일만, 그것도 화면에 보이는 것만 새로 받는다.
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
    // [리디자인] 모바일 선택 줄은 명단이 오기 전에도 있어야 한다 - 명단 로딩이 실패하면
    // 아래 renderTierBar가 아예 안 돌아서, 거기서만 만들면 바가 펼쳐진 채로 남는다.
    ensureTierPick();

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
