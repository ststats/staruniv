/**
 * 멤버 페이지: 현황(멤버 카드 + 프로필 팝업) + 공지(SOOP 게시판 피드). 로드 순서: core.js → api.js → soop.js → 이 파일
 * URL: /members/ (현황), /members/?view=news[&member=이름] (공지)
 */

const MEMBER_TABS = {
    status: ['tab-member-status', 'view-member-status'],
    news: ['tab-member-news', 'view-member-news'],
};

const ROLE_ORDER_BASE = SITE_ORDER.roles;
// 현황 탭에서 받은 방송 상태를 공지 탭 사이드바가 나중에 그려질 때도 쓴다.
let MEMBER_LIVE_IDS = [];
const MEMBER_LIVE_DATA = new Map();

function updateMembersHash() {
    const params = {};
    if (isTabActive('tab-member-news')) {
        params.view = 'news';
        if (NewsState.player) params.member = NewsState.player['이름'];
    }
    PageState.update(params);
}

function switchMemberView(viewType, skipHashUpdate) {
    activateTabView(MEMBER_TABS, viewType);
    if (viewType === 'news') {
        if (!NewsState.sidebarRendered) {
            renderNewsSidebar();
            NewsState.sidebarRendered = true;
            showNewsAll(true);
        } else {
            // 숨겨져 있던 동안 그려졌거나 창 크기가 바뀌었으면 PC/모바일 레이아웃을 다시 맞춘다.
            refreshNewsLayoutIfNeeded();
        }
        safeInit('사이드바 방송 상태', refreshSidebarLiveIndicators);
    }
    if (!skipHashUpdate) updateMembersHash();
}

function memberCardHtml(m) {
    return `
        <div class="member-card${isActiveMember(m) ? '' : ' former'}${memberRaceEdgeClass(m)}" data-member="${escapeHTML(m['이름'])}" data-soop-id="${escapeHTML(m['SOOP ID'] || '')}" role="button" tabindex="0"${act('openMemberProfile', m._id)}>
            <div class="member-card-media tier-card-media">
                <img class="member-live-thumb" data-member-live-thumb="${escapeHTML(m['SOOP ID'] || '')}" alt="" hidden>
                <div class="member-profile-media">${avatarHtml(m['SOOP ID'], 'member-avatar-img')}</div>
            </div>
            <div class="member-card-body tier-card-body">
                <div class="member-card-name">${escapeHTML(m['이름'])}</div>
                <div class="member-card-tags">
                    ${tierBadgeHtml(m['티어'])}
                    ${raceBadgeHtml(m['종족'])}
                </div>
            </div>
        </div>`;
}

// 종족 색 왼쪽 띠: 뱃지 글자를 읽지 않고도 종족 분포가 한눈에 보인다.
function memberRaceEdgeClass(m) {
    const letter = raceShortLabel(m['종족'] || '');
    return ['T', 'Z', 'P'].includes(letter) ? ` edge-${letter}` : '';
}

// 섹션 제목 위 라틴 라벨. 없는 직책은 ROSTER로 떨어진다.
const ROLE_EN = { '감독': 'HEAD COACH', '코치': 'COACH', '선수': 'PLAYER', '매니저': 'MANAGER' };

function renderMemberGroup(title, members) {
    if (members.length === 0) return '';
    const sorted = [...members].sort(
        (a, b) =>
            tierIndex(a['티어']) - tierIndex(b['티어']) ||
            String(a['입단일'] || '9999').localeCompare(String(b['입단일'] || '9999')) ||
            String(a['이름']).localeCompare(String(b['이름']), 'ko')
    );

    return `
        <div class="section-title" data-en="${ROLE_EN[title] || 'ROSTER'}"><span class="section-title-label">${escapeHTML(title)}</span><span class="title-count">${sorted.length}명</span></div>
        <div class="member-grid mb-block">${sorted.map(memberCardHtml).join('')}</div>`;
}

// 머리 ACTIVE / ON AIR 칸. 조회에 실패하면 '-' 또는 직전 값을 유지한다.
function renderMemberHeadCounts(activeMembers) {
    const activeEl = document.getElementById('member-count-active');
    if (activeEl) activeEl.innerText = activeMembers.length;

    const liveEl = document.getElementById('member-count-live');
    if (!liveEl) return;
    const targets = activeMembersWithSoopId();
    if (!targets.length) {
        liveEl.innerText = '0';
        return;
    }
    return fetchLiveBroadcasts()
        .then(live => {
            MEMBER_LIVE_DATA.clear();
            targets.forEach(m => {
                const id = String(m['SOOP ID']);
                const row = live[id.toLowerCase()];
                if (row) MEMBER_LIVE_DATA.set(id, row);
            });
            MEMBER_LIVE_IDS = [...MEMBER_LIVE_DATA.keys()];
            liveEl.innerText = MEMBER_LIVE_IDS.length;
            markLiveMembers(MEMBER_LIVE_IDS);
        })
        .catch(() => {
            /* 실패하면 '-' 유지 */
        });
}

// 조회가 느리거나 실패하면 표시가 켜지지 않을 뿐 카드는 그대로 보인다.
function markLiveMembers(liveIds) {
    const set = new Set(liveIds.map(String));
    document.querySelectorAll('.member-card[data-soop-id]').forEach(card => {
        const on = set.has(String(card.dataset.soopId));
        card.classList.toggle('is-live', on);
        const thumb = card.querySelector('.member-live-thumb');
        const broad = MEMBER_LIVE_DATA.get(String(card.dataset.soopId));
        if (thumb) {
            thumb.hidden = !on;
            if (on && broad && broad.broad_no)
                thumb.src = `https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broad.broad_no)}`;
        }
        const profile = card.querySelector('.member-profile-media');
        if (profile) profile.hidden = on;
    });
    document.querySelectorAll('.avatar-select-live[data-soop-id]').forEach(dot => {
        dot.hidden = !set.has(String(dot.dataset.soopId));
    });
}

function renderMembersPage() {
    const groups = document.getElementById('members-groups');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.errors.has('members')) {
        groups.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못했습니다');
        groups.setAttribute('aria-busy', 'false');
        return;
    }
    const activeMembers = SiteData.members.filter(isActiveMember);
    const formerMembers = SiteData.members.filter(m => !isActiveMember(m));
    const allRoles = [...new Set(activeMembers.map(m => m['직책'] || '기타'))];
    const roleOrder = [...ROLE_ORDER_BASE, ...allRoles.filter(r => !ROLE_ORDER_BASE.includes(r))];

    renderMemberHeadCounts(activeMembers);

    let html = roleOrder
        .map(role =>
            renderMemberGroup(
                role,
                activeMembers.filter(m => (m['직책'] || '기타') === role)
            )
        )
        .join('');

    // 이전 멤버는 제목(인원 배지 포함)은 보여주고 카드 목록만 접어 둔다.
    if (formerMembers.length > 0) {
        const sortedFormer = [...formerMembers].sort((a, b) => {
            const ad = String(a['퇴단일'] || '');
            const bd = String(b['퇴단일'] || '');
            return bd.localeCompare(ad) || String(a['이름']).localeCompare(String(b['이름']), 'ko');
        });
        html += `
            <div class="section-title" data-en="FORMER">
                <span class="section-title-label">이전 멤버</span>
                <button type="button" class="text-action former-members-toggle" id="former-members-toggle-btn"
                    aria-expanded="false" aria-controls="former-members-section"${act('toggleFormerMembersSection')}>
                    <span id="former-members-toggle-text">보기</span>${chevronDownSvg(12, ' id="former-members-toggle-chevron" class="chevron-rotatable"')}
                </button>
                <span class="title-count">${sortedFormer.length}명</span>
            </div>
            <div id="former-members-section" class="d-none">
                <div class="member-grid mb-block">${sortedFormer.map(memberCardHtml).join('')}</div>
            </div>`;
    }

    groups.innerHTML = html || emptyStateHtml('등록된 멤버가 없습니다');
    groups.setAttribute('aria-busy', 'false');
}

function toggleFormerMembersSection() {
    const nowOpen = toggleCollapsible('former-members-section', 'former-members-toggle-chevron');
    document.getElementById('former-members-toggle-btn')?.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    const label = document.getElementById('former-members-toggle-text');
    if (label) label.textContent = nowOpen ? '접기' : '보기';
}

// 실제 youtube.com / youtu.be 주소일 때만 버튼을 띄운다. "@핸들"은 채널 주소로 바꾼다.
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

let _profileMember = null; // 방송 활동 데이터가 늦게 오면 다시 채우기용

function openMemberProfile(id) {
    const m = findMemberById(id);
    if (!m) return;
    const name = m['이름'];
    _profileMember = m;
    loadProfileActivityData(); // 한 번만 받는다

    document.getElementById('mp-name').innerText = name;
    const mpRoleBadge = document.getElementById('mp-role-badge');
    applyBadge(mpRoleBadge, m['직책'] || '미정', 'tag-badge role-badge');
    mpRoleBadge.style.background = roleColor(m['직책']); // 직책마다 달라지는 동적 색이라 인라인
    applyBadge(
        document.getElementById('mp-race-badge'),
        raceShortLabel(m['종족']),
        'tag-badge' + raceBadgeClass(m['종족'])
    );
    applyBadge(document.getElementById('mp-tier-badge'), tierLabel(m['티어']), 'tag-badge tier-badge');
    document.getElementById('mp-avatar').innerHTML = profileAvatarInnerHtml(m['SOOP ID']);

    const active = isActiveMember(m);
    const days = m['입단일'] ? daysBetween(m['입단일'], active ? todayStr() : m['퇴단일'] || null) : null;
    document.getElementById('mp-period').textContent = m['입단일']
        ? m['입단일'] + ' ~ ' + (active ? '현재' : m['퇴단일'] || '-')
        : '-';
    const daysEl = document.getElementById('mp-days');
    daysEl.hidden = days === null || !Number.isFinite(days);
    daysEl.textContent = daysEl.hidden ? '' : formatNum(days) + '일';
    // 티어 뱃지는 현재 티어, 입단 티어는 이 입단 때 티어다.
    const joinTier = String(m['입단 티어'] ?? '').trim();
    document.getElementById('mp-join-tier').textContent = joinTier ? tierLabel(joinTier) : '-';
    const rows = [
        ['성별', m['성별']],
        ['생년월일', m['생년월일']],
        ['MBTI', m['MBTI']],
    ];
    document.getElementById('mp-info-body').innerHTML = rows
        .map(
            ([label, value]) => '<div><dt>' + escapeHTML(label) + '</dt><dd>' + escapeHTML(value || '-') + '</dd></div>'
        )
        .join('');
    // href 없는 a에는 target·rel을 둘 수 없다
    const setLink = (a, url) => {
        a.hidden = !url;
        ['href', 'target', 'rel'].forEach(k => a.removeAttribute(k));
        if (url) Object.assign(a, { href: url, target: '_blank', rel: 'noopener' });
        return a;
    };
    const station = setLink(
        document.getElementById('mp-station-link'),
        isValidSoopId(m['SOOP ID'])
            ? 'https://www.sooplive.com/station/' + encodeURIComponent(String(m['SOOP ID']).trim())
            : ''
    );
    const youtube = setLink(document.getElementById('mp-youtube-link'), memberYoutubeUrl(m['YouTube']));
    document.getElementById('mp-external-links').hidden = station.hidden && youtube.hidden;
    document.getElementById('mp-records-link').href = 'records/?view=solo&member=' + encodeURIComponent(name);
    updateMemberAnalysisLink(m);

    renderMemberActivitySummary(m);
    showModal('memberProfileModal');
}

// 이 입단 때 쓴 ELO ID로만 간다. 같은 사람의 다른 계정이 섞이지 않게 티어표 메인 계정으로 대신 가지 않는다.
function updateMemberAnalysisLink(member) {
    const link = document.getElementById('mp-analysis-link');
    const eloId = String(member['ELO ID'] ?? '').trim();
    link.hidden = !/^\d+$/.test(eloId);
    link.removeAttribute('href');
    if (!link.hidden) link.href = 'tier/?view=analysis&p=' + encodeURIComponent(eloId);
}

// "이번 달 방송 활동"은 시너지표(ststats) 데이터로 채운다.
function renderMemberActivitySummary(m) {
    const statusEl = document.getElementById('mp-activity-status');
    const valueEls = ['mp-balloons', 'mp-broadcast-hours', 'mp-viewers', 'mp-sponsor-record'].map(id =>
        document.getElementById(id)
    );
    const setValues = values =>
        valueEls.forEach((el, i) => {
            el.innerText = values[i];
        });

    // 받는 중에 안내 줄을 띄우면 줄이 사라질 때 창 높이가 튄다.
    if (!SynergyState.data) {
        statusEl.innerText = SynergyState.failed ? '불러오지 못했습니다' : '';
        setValues(['-', '-', '-', '-']);
        return;
    }

    const soopId = String(m['SOOP ID'] || '')
        .trim()
        .toLowerCase();
    const entry = SynergyState.data.find(
        s =>
            String(s.id || '')
                .trim()
                .toLowerCase() === soopId
    );
    // 기록이 없으면 '-'로 충분하다(안내 줄은 창 높이만 늘린다).
    if (!entry) {
        statusEl.innerText = '';
        setValues(['-', '-', '-', '-']);
        return;
    }

    statusEl.innerText = '';
    setValues([
        formatCount(entry.balloons, '개'),
        formatSecondsToHM(entry.broadcast_seconds),
        formatCount(entry.cumulative_viewers, '명'),
        formatSponsorRecord(entry.sponsor_wins, entry.sponsor_losses),
    ]);
}

// "전체 공지"/"멤버별 공지"가 같은 상태를 쓴다.
const NewsState = {
    sidebarRendered: false,
    player: null, // null = 전체 공지
    mode: 'all', // 더 보기 때 어느 API를 부를지 정한다
    items: [],
    featuredKey: null, // 리스트 클릭 시 이 값만 바뀐다
    hasMore: false,
    loading: false,
    memberPage: 1,
    memberTotalPages: 1,
    allPool: [], // 멤버별로 모아 날짜순 정렬한 후보
    allShownCount: 0,
    // 전체 모드: Map<soopId, { nextPage, totalPages }>
    allMemberState: new Map(),
    // 목록 API의 content.content가 이미 전체 본문이라 상세 API 없이 titleNo로 기억해 둔다.
    fullContent: {},
    // 늦게 온 이전 요청의 응답이 다른 멤버 이름으로 그려지지 않게, 번호가 바뀌었으면 버린다.
    requestSeq: 0,
};

function renderNewsSidebar() {
    renderAvatarBar(
        'news-avatar-list',
        avatarSelectAllItemHtml('news-side-btn-all', act('showNewsAll'), `${activeMembersWithSoopId().length}`),
        activeMembersWithSoopId()
            .map(mem => avatarSelectItemHtml('news-side-player-', mem['이름'], mem['SOOP ID'], 'selectNewsPlayer', mem))
            .join('')
    );
    // 방송 상태 조회가 사이드바보다 먼저 끝났을 때도 LIVE 표시를 켠다.
    if (MEMBER_LIVE_IDS.length) markLiveMembers(MEMBER_LIVE_IDS);
}

function newsAnyMemberHasMorePages() {
    for (const st of NewsState.allMemberState.values()) {
        if (st.nextPage <= st.totalPages) return true;
    }
    return false;
}

function newsItemKey(item) {
    const soopId = item.member ? item.member['SOOP ID'] : item.post.userId;
    return soopId + '_' + item.post.titleNo;
}

// 받는 동안 높이를 붙잡아 둔다. 내용이 짧아지면 브라우저가 스크롤을 위로 끌어올린다.
function showNewsLoading(content) {
    content.style.minHeight = `${content.offsetHeight}px`;
    content.innerHTML = emptyStateHtml('불러오는 중');
}
function releaseNewsHeight(content) {
    content.style.minHeight = '';
}

async function showNewsAll(skipHashUpdate) {
    setActiveAvatarItem('news-avatar-list', document.getElementById('news-side-btn-all'));
    document.getElementById('news-content-title').innerText = '전체 공지';
    NewsState.player = null;
    if (!skipHashUpdate) updateMembersHash();

    const content = document.getElementById('news-feed-content');
    content.setAttribute('aria-busy', 'true');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.errors.has('members')) {
        content.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못해 공지를 확인할 수 없습니다');
        content.setAttribute('aria-busy', 'false');
        return;
    }
    showNewsLoading(content);
    const token = ++NewsState.requestSeq;

    // mergeOwnPosts가 공지를 합쳐 10개보다 많이 올 수 있으니 자르지 않고 전부 담는다.
    const memberState = new Map();
    const settled = await Promise.allSettled(
        activeMembersWithSoopId().map(async m => {
            const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], 1);
            memberState.set(m['SOOP ID'], { nextPage: 2, totalPages });
            return posts.map(post => ({ member: m, post }));
        })
    );
    if (token !== NewsState.requestSeq) return; // 그 사이 다른 목록이 선택됨

    NewsState.allMemberState = memberState;
    NewsState.allPool = sortNewsByDateDesc(settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value));
    NewsState.mode = 'all';
    NewsState.featuredKey = null;
    NewsState.allShownCount = NewsState.allPool.length;
    NewsState.items = NewsState.allPool.slice(0, NewsState.allShownCount);
    NewsState.hasMore = NewsState.allShownCount < NewsState.allPool.length || newsAnyMemberHasMorePages();
    renderNewsLayout(content);
    releaseNewsHeight(content);
    content.setAttribute('aria-busy', 'false');
}

function selectNewsPlayer(name, skipHashUpdate) {
    setActiveAvatarItem('news-avatar-list', document.getElementById(`news-side-player-${name}`));
    document.getElementById('news-content-title').innerText = `${name}의 공지`;

    const m = findMemberByName(name);
    if (!m) return;
    NewsState.player = m;
    NewsState.memberPage = 1;
    NewsState.memberTotalPages = 1;
    if (!skipHashUpdate) updateMembersHash();

    const content = document.getElementById('news-feed-content');
    content.setAttribute('aria-busy', 'true');
    showNewsLoading(content);
    loadNewsFeed();
}

async function loadNewsFeed() {
    const member = NewsState.player;
    if (!member) return;
    const content = document.getElementById('news-feed-content');
    const token = ++NewsState.requestSeq;

    try {
        const { posts, totalPages } = await fetchMemberFeed(member['SOOP ID'], 1);
        if (token !== NewsState.requestSeq) return;

        NewsState.memberPage = 1;
        NewsState.memberTotalPages = totalPages;
        NewsState.mode = 'member';
        NewsState.featuredKey = null;
        NewsState.items = posts.map(post => ({ member, post }));
        NewsState.hasMore = NewsState.memberPage < NewsState.memberTotalPages;
        renderNewsLayout(content);
        releaseNewsHeight(content);
        content.setAttribute('aria-busy', 'false');
    } catch (e) {
        if (token === NewsState.requestSeq) {
            releaseNewsHeight(content);
            content.innerHTML = emptyStateHtml('글을 불러오지 못했습니다');
            content.setAttribute('aria-busy', 'false');
        }
    }
}

// 풀이 한 페이지어치보다 적으면 남은 멤버의 다음 페이지를 받아 채운다.
async function loadMoreAllNews(token) {
    const S = NewsState;
    if (S.allPool.length - S.allShownCount < NEWS_PAGE_SIZE && newsAnyMemberHasMorePages()) {
        const membersToFetch = activeMembersWithSoopId().filter(m => {
            const st = S.allMemberState.get(m['SOOP ID']);
            return st && st.nextPage <= st.totalPages;
        });
        const settled = await Promise.allSettled(
            membersToFetch.map(async m => {
                const st = S.allMemberState.get(m['SOOP ID']);
                const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], st.nextPage);
                st.totalPages = totalPages;
                st.nextPage += 1;
                return posts.map(post => ({ member: m, post }));
            })
        );
        if (token !== S.requestSeq) return false;
        // 공지가 페이지마다 딸려올 수 있어 이미 있는 글은 건너뛴다.
        const existingKeys = new Set(S.allPool.map(newsItemKey));
        const fetched = settled
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .filter(item => !existingKeys.has(newsItemKey(item)));
        S.allPool = sortNewsByDateDesc(S.allPool.concat(fetched));
    }
    S.allShownCount = Math.min(S.allShownCount + NEWS_PAGE_SIZE, S.allPool.length);
    S.items = S.allPool.slice(0, S.allShownCount);
    S.hasMore = S.allShownCount < S.allPool.length || newsAnyMemberHasMorePages();
    return true;
}

async function loadMoreMemberNews(token) {
    const S = NewsState;
    const member = S.player;
    S.memberPage += 1;
    const { posts, totalPages } = await fetchMemberFeed(member['SOOP ID'], S.memberPage);
    if (token !== S.requestSeq) return false;
    S.memberTotalPages = totalPages;
    // 공지가 페이지마다 딸려올 수 있어 이미 있는 글은 건너뛴다.
    const existingKeys = new Set(S.items.map(newsItemKey));
    S.items = S.items.concat(
        posts.map(post => ({ member, post })).filter(item => !existingKeys.has(newsItemKey(item)))
    );
    S.hasMore = S.memberPage < S.memberTotalPages;
    return true;
}

async function loadMoreNewsFeed() {
    if (NewsState.loading) return;
    NewsState.loading = true;
    const token = NewsState.requestSeq;
    // 다시 그리면 #news-past-list가 새로 만들어져 스크롤이 0이 된다.
    const restoreScroll = capturePastListScroll();
    try {
        let updated = false;
        if (NewsState.mode === 'all') updated = await loadMoreAllNews(token);
        else if (NewsState.mode === 'member' && NewsState.player) updated = await loadMoreMemberNews(token);
        if (!updated) return;
        renderNewsLayout(document.getElementById('news-feed-content'));
        restoreScroll();
    } finally {
        NewsState.loading = false;
    }
}

// "지난 글" 리스트의 스크롤 위치를 저장하고, 다시 그린 뒤 복원하는 함수를 돌려준다.
function capturePastListScroll() {
    const before = document.getElementById('news-past-list');
    const saved = before ? before.scrollTop : 0;
    return () => {
        const after = document.getElementById('news-past-list');
        if (after) after.scrollTop = saved;
    };
}

// 리스트에서 고른 글을 왼쪽 큰 카드로 올린다. 리스트는 날짜순 그대로다.
function setNewsFeatured(key) {
    const mobile = isNewsMobileLayout();
    const restoreScroll = capturePastListScroll();
    NewsState.featuredKey = key;
    renderNewsLayout(document.getElementById('news-feed-content'));
    restoreScroll();
    if (mobile)
        requestAnimationFrame(() => {
            const card = document.querySelector('#news-feed-content .featured-post');
            if (!card) return;
            const nav = document.querySelector('.top-navbar');
            const bar = document.querySelector('#view-member-news .avatar-bar');
            const barHeight =
                bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
            const top =
                window.scrollY +
                card.getBoundingClientRect().top -
                (nav?.getBoundingClientRect().height || 0) -
                barHeight -
                12;
            window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
        });
}

// CSS 두 컬럼의 min-width(300px + 300px) + gap(28px). 리스트가 아래로 떨어지려는 순간 모바일 모드로 바꾼다.
const NEWS_TWO_COL_MIN_WIDTH = 300 + 28 + 300;

function isNewsMobileLayout() {
    const content = document.getElementById('news-feed-content');
    if (!content) return false;
    return content.clientWidth < NEWS_TWO_COL_MIN_WIDTH;
}

// 숨겨진 탭에서는 폭이 0으로 재져 모바일로 오판된다.
function isNewsFeedShown(content) {
    return !!content && content.offsetParent !== null;
}

// 숨겨진 상태에서는 판단을 미루고 다시 보일 때 맞춘다.
function refreshNewsLayoutIfNeeded() {
    const content = document.getElementById('news-feed-content');
    if (NewsState.items.length === 0 || !isNewsFeedShown(content)) return;
    const wasMobile = content.classList.contains('news-feed-mobile');
    if (wasMobile !== isNewsMobileLayout()) renderNewsLayout(content);
}

window.addEventListener('resize', rafThrottle(refreshNewsLayoutIfNeeded));

function featuredPostWrapHtml(item) {
    return `<div class="featured-post" data-news-key="${escapeHTML(newsItemKey(item))}">${renderFeaturedPostHtml(item)}</div>`;
}

// 모바일: 고른 글을 그 자리에서 펼친다(맨 위에 고정하면 누를 때마다 위로 스크롤해야 한다).
function newsMobileLayoutHtml(sorted, loadMoreHtml) {
    return (
        sorted
            .map(item =>
                newsItemKey(item) === NewsState.featuredKey ? featuredPostWrapHtml(item) : renderPastNoticeHtml(item)
            )
            .join('') + loadMoreHtml
    );
}

function newsDesktopLayoutHtml(sorted, loadMoreHtml) {
    const featuredItem = sorted.find(it => newsItemKey(it) === NewsState.featuredKey);
    const restItems = sorted.filter(it => newsItemKey(it) !== NewsState.featuredKey);
    const pastListHtml = restItems.length
        ? restItems.map(renderPastNoticeHtml).join('')
        : emptyStateHtml('지난 글이 없습니다');
    return `
                ${featuredPostWrapHtml(featuredItem)}
                <div class="past-posts">
                    <div id="news-past-list" class="scroll-area scroll-y">${pastListHtml}</div>
                    ${loadMoreHtml}
                </div>`;
}

const NEWS_LOAD_MORE_HTML = `<div class="news-load-more-wrap" id="news-load-more-wrap"><button class="news-load-more" data-click="loadMoreNewsFeed">더 보기 ${chevronDownSvg(9)}</button></div>`;

function renderNewsLayout(content) {
    content.setAttribute('aria-busy', 'false');
    if (NewsState.items.length === 0) {
        content.classList.remove('news-feed-mobile');
        content.innerHTML = emptyStateHtml('작성된 글이 없습니다');
        return;
    }

    const sorted = sortNewsByDateDesc(NewsState.items);
    if (!NewsState.featuredKey || !sorted.some(it => newsItemKey(it) === NewsState.featuredKey)) {
        NewsState.featuredKey = newsItemKey(sorted[0]); // 기본은 가장 최신 글
    }
    const loadMoreHtml = NewsState.hasMore ? NEWS_LOAD_MORE_HTML : '';

    const mobile = isNewsMobileLayout();
    content.classList.toggle('news-feed-mobile', mobile);
    content.innerHTML = mobile
        ? newsMobileLayoutHtml(sorted, loadMoreHtml)
        : newsDesktopLayoutHtml(sorted, loadMoreHtml);
    checkNewsClampButtons(content);
}

// ----- 공지 본문(외부 HTML) 정제 -----
// [보안] SOOP 외부 HTML은 차단 목록 대신 DOMPurify 허용 목록으로 정제한다.
// - class 금지: 사이트/부트스트랩 클래스(position-fixed 등)로 화면을 덮는 가짜 UI를 막는다.
// - style은 허용하되 화면 위에 뜰 수 있는 위치 속성은 뺀다.
// - 문자열로 다시 직렬화하지 않고 DOM 조각을 붙인다(mutation XSS 방지).
// - DOMPurify가 없으면 순수 텍스트로 보여준다.
const NEWS_ALLOWED_TAGS = [
    'p',
    'br',
    'div',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'del',
    'ins',
    'sub',
    'sup',
    'small',
    'mark',
    'font',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
    'figure',
    'figcaption', // 통째로 지우려고 허용한다(안 하면 캡션 글자만 남는다)
];

const NEWS_ALLOWED_ATTR = [
    'href',
    'target',
    'title',
    'style',
    'align',
    'color',
    'size',
    'face',
    'colspan',
    'rowspan',
    'dir',
    'lang',
];

const NEWS_STRIPPED_STYLE_PROPS = [
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'inset',
    'z-index',
    'transform',
    'color',
    'background',
    'background-color',
    '-webkit-text-fill-color',
];

// DOMPurify가 없을 때. .news-post-body가 pre-wrap이라 줄바꿈이 보인다.
function newsPlainTextFragment(html) {
    const withBreaks = String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html'); // 스크립트가 실행되지 않는 문서
    doc.querySelectorAll('figure, script, style, noscript, template').forEach(el => el.remove()); // 사진 캡션·코드 글자 제외
    const text = doc.body.textContent || '';
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode(text.replace(/\n{3,}/g, '\n\n').trim()));
    return frag;
}

function sanitizeNewsFragment(html) {
    if (!html) return document.createDocumentFragment();
    const purifier = window.DOMPurify;
    if (!purifier || !purifier.isSupported || typeof purifier.sanitize !== 'function')
        return newsPlainTextFragment(html);

    const frag = purifier.sanitize(String(html), {
        ALLOWED_TAGS: NEWS_ALLOWED_TAGS,
        ALLOWED_ATTR: NEWS_ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
        RETURN_DOM_FRAGMENT: true,
    });
    // 사진은 하단 갤러리가 보여주므로 캡션까지 뺀다.
    frag.querySelectorAll('figure').forEach(el => el.remove());
    // 외부 에디터의 고정 글자/배경색은 사이트 테마를 따르게 한다.
    frag.querySelectorAll('[color], [bgcolor]').forEach(el => {
        el.removeAttribute('color');
        el.removeAttribute('bgcolor');
    });
    frag.querySelectorAll('[style]').forEach(el => {
        NEWS_STRIPPED_STYLE_PROPS.forEach(prop => el.style.removeProperty(prop));
        if (!el.getAttribute('style').trim()) el.removeAttribute('style');
    });
    frag.querySelectorAll('a[target]').forEach(a => a.setAttribute('rel', 'noopener noreferrer'));
    // 사진을 지우고 남은 빈 문단을 정리한다.
    frag.querySelectorAll('p').forEach(p => {
        const onlyBr = p.children.length === 1 && p.children[0].tagName === 'BR';
        if (!p.textContent.trim() && (p.children.length === 0 || onlyBr)) p.remove();
    });
    return frag;
}

// 3줄을 넘거나, 목록 API가 이미 "..."로 자른 미리보기면 "더 보기"가 필요하다.
function checkNewsClampButtons(container) {
    container.querySelectorAll('.news-post-body-clamp:not([data-clamp-checked])').forEach(body => {
        body.setAttribute('data-clamp-checked', '1');
        const overflowed = body.scrollHeight > body.clientHeight + 1;
        const looksApiTruncated = /(\.\.\.|…)\s*$/.test((body.textContent || '').trim());
        if (overflowed || looksApiTruncated) {
            const btn = body.nextElementSibling;
            if (btn && btn.classList.contains('news-post-more-btn')) btn.hidden = false;
        }
    });
}

// DOMPurify(9KB)는 처음 펼칠 때 받는다(주소는 스크립트 태그의 data-purify).
const PURIFY_SRC = document.currentScript && document.currentScript.dataset.purify;
let purifyLoading = null;
function loadPurify() {
    if (window.DOMPurify || !PURIFY_SRC) return Promise.resolve();
    if (!purifyLoading) {
        purifyLoading = new Promise(resolve => {
            const s = document.createElement('script');
            s.src = PURIFY_SRC;
            s.onload = s.onerror = () => resolve();
            document.head.appendChild(s);
        });
    }
    return purifyLoading;
}

async function expandNewsPost(btn, titleNo) {
    const body = btn.previousElementSibling;
    const fullHtml = NewsState.fullContent[String(titleNo)];
    if (!fullHtml || !body || btn.disabled) return;
    btn.disabled = true;
    await loadPurify();
    body.replaceChildren(sanitizeNewsFragment(fullHtml));
    body.classList.remove('news-post-body-clamp');
    btn.remove();
}

// 스와이프 중 scroll이 여러 번 와도 갤러리마다 한 프레임에 한 번만 계산한다.
// data-scroll이 이름으로 부르므로 전역 var로 둔다.
var updateNewsPhotoDots = rafThrottleByKey(scroller => {
    const wrap = scroller.parentElement;
    if (!wrap || !wrap.classList.contains('news-post-photos-wrap')) return;
    const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
    const total = scroller.children.length;

    wrap.querySelectorAll('.news-post-photos-dots .photo-dot').forEach((d, i) =>
        d.classList.toggle('active', i === idx)
    );
    const prevBtn = wrap.querySelector('.news-photo-nav-prev');
    const nextBtn = wrap.querySelector('.news-photo-nav-next');
    if (prevBtn) prevBtn.classList.toggle('is-hidden', idx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-hidden', idx >= total - 1);
});

function scrollNewsPhotos(btn, dir) {
    const wrap = btn.closest('.news-post-photos-wrap');
    const scroller = wrap && wrap.querySelector('.news-post-photos');
    if (scroller) scroller.scrollBy({ left: dir * scroller.clientWidth, behavior: 'smooth' });
}

const HEART_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.2 1.4 6.9 4 5.3c2.2-1.3 4.7-.6 6 1.2l2 2.7 2-2.7c1.3-1.8 3.8-2.5 6-1.2 2.6 1.6 3 4.9 1.3 7.6C18.7 16.65 12 21 12 21z"/></svg>';

const EYE_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// 첫 사진만 즉시 로드하고 나머지는 지연 로딩한다. 화살표는 hover 기기에서만 보인다(CSS).
function newsPhotosHtml(photos) {
    if (!photos.length) return '';
    const multi = photos.length > 1;
    const dotsHtml = multi
        ? `<div class="news-post-photos-dots">${photos.map((_, i) => `<span class="photo-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
        : '';
    const navHtml = multi
        ? `<button type="button" class="news-photo-nav news-photo-nav-prev is-hidden"${act('scrollNewsPhotos', ACT.el, -1)} aria-label="이전 사진">‹</button>
               <button type="button" class="news-photo-nav news-photo-nav-next"${act('scrollNewsPhotos', ACT.el, 1)} aria-label="다음 사진">›</button>`
        : '';
    return `<div class="news-post-photos-wrap">
                    <div class="news-post-photos"${multi ? actOn('scroll', 'updateNewsPhotoDots', ACT.el) : ''}>${photos.map((p, i) => `<img src="${escapeHTML(p && p.url)}" alt=""${i > 0 ? ' loading="lazy"' : ''}${actOn('error', 'imgRemove', ACT.el)}>`).join('')}</div>
                    ${navHtml}
                    ${dotsHtml}
               </div>`;
}

function newsPostStatsHtml(post) {
    const likeCnt = post.count && post.count.likeCnt;
    const readCnt = post.count && post.count.readCnt;
    if (!likeCnt && !readCnt) return '<div class="news-post-stats"></div>';
    const stat = (icon, n) => `<span class="news-post-stat">${icon}${escapeHTML(formatNum(Number(n)))}</span>`;
    return `<div class="news-post-stats">
                    ${likeCnt ? stat(HEART_ICON, likeCnt) : ''}
                    ${readCnt ? stat(EYE_ICON, readCnt) : ''}
               </div>`;
}

function renderFeaturedPostHtml(item) {
    const { member, post } = item;
    const title = post.titleName || '';
    const snippet = (post.content && post.content.textContent) || '';
    const fullHtml = (post.content && post.content.content) || '';
    if (fullHtml) NewsState.fullContent[String(post.titleNo)] = fullHtml;
    const category = (post.display && post.display.bbsName) || '';
    const timeText = formatRelativeTime(post.regDate);
    const soopId = member ? member['SOOP ID'] : post.userId;
    const name = member ? member['이름'] : post.userNick || '';
    const postUrl = `https://www.sooplive.co.kr/station/${encodeURIComponent(soopId)}/post/${encodeURIComponent(post.titleNo)}`;

    return `
        <div class="news-post-card news-post-card-fade">
            <div class="news-post-header">
                ${avatarHtml(soopId, 'news-post-avatar')}
                <div>
                    <div class="news-post-name">${escapeHTML(name)}</div>
                    <div class="news-post-meta">${escapeHTML(category)}${category && timeText ? ' · ' : ''}${escapeHTML(timeText)}</div>
                </div>
            </div>
            ${title ? `<div class="news-post-title">${escapeHTML(title)}</div>` : ''}
            ${snippet ? `<div class="news-post-body news-post-body-clamp">${formatNewsContent(snippet)}</div><button type="button" class="news-post-more-btn" hidden${act('expandNewsPost', ACT.el, post.titleNo)}>더 보기 ${chevronDownSvg(9)}</button>` : ''}
            ${newsPhotosHtml(asArray(post.photos))}
            <div class="news-post-link-row">
                ${newsPostStatsHtml(post)}
                <a class="text-action" href="${postUrl}" target="_blank" rel="noopener">
                    <span>원글 보기</span><span class="i-arrow" aria-hidden="true"></span>
                </a>
            </div>
        </div>`;
}

// 홈 "최근 공지"와 같은 카드지만, 클릭하면 원글 대신 왼쪽 큰 카드로 올린다.
function renderPastNoticeHtml(item) {
    const key = newsItemKey(item);
    return homeNoticeCardHtml(noticeCardFields(item.member, item.post), {
        action: act('setNewsFeatured', key),
        extraClass: 'news-past-item',
        dataAttr: `data-news-key="${escapeHTML(key)}"`,
    });
}

// 팝업이 이미 열려 있으면 도착하는 대로 다시 채운다.
function loadProfileActivityData() {
    const refresh = () => {
        const modal = document.getElementById('memberProfileModal');
        if (_profileMember && modal && modal.classList.contains('is-open')) renderMemberActivitySummary(_profileMember);
    };
    return fetchSynergyData().then(refresh, err => {
        console.error(err);
        refresh();
    });
}

// 프로필 창은 첫 배치가 무거워 처음 열 때 멈칫한다. 한가할 때 미리 한 번 배치해 둔다.
function prewarmProfileModal() {
    const el = document.getElementById('memberProfileModal');
    if (!el || el.classList.contains('is-open')) return;
    el.style.visibility = 'hidden';
    el.style.display = 'block';
    void el.offsetWidth;
    el.style.display = '';
    el.style.visibility = '';
}

bootPage(
    () => {
        safeInit('멤버 페이지', renderMembersPage);
        (window.requestIdleCallback || (fn => setTimeout(fn, 500)))(() => prewarmProfileModal(), { timeout: 3000 });
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                const rawView = params.get('view') || runtimeDefaultSubtab('members', 'status');
                const view = rawView === 'news' ? 'news' : 'status';
                switchMemberView(view);
                const member = params.get('member');
                if (view === 'news' && member) selectNewsPlayer(member);
                // 뒤로가기로 "전체 공지" 주소에 돌아오면 화면도 되돌린다
                else if (view === 'news' && NewsState.player && NewsState.sidebarRendered) showNewsAll(true);
            })
        );
    },
    {
        siteData: ['members', 'profiles'], // profiles: 프로필 창에서만 보이는 칸
        prefetch: () => fetchLiveBroadcasts().catch(() => {}),
        view: params =>
            activateTabView(
                MEMBER_TABS,
                (params.get('view') || runtimeDefaultSubtab('members', 'status')) === 'news' ? 'news' : 'status'
            ),
    }
);
