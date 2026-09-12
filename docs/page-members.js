/**
 * 멤버 페이지: 현황(멤버 카드 + 프로필 팝업) + 공지(SOOP 게시판 피드). (core.js → soop.js → 이 파일)
 * URL: /members/ (현황), /members/?view=news[&member=이름] (공지)
 * 공지 본문 정제에 DOMPurify(purify.min.js)를 쓰므로 이 페이지만 그 파일을 먼저 불러온다.
 */

const MEMBER_TABS = { status: ['tab-member-status', 'view-member-status'], news: ['tab-member-news', 'view-member-news'] };

const ROLE_ORDER_BASE = ['감독', '코치', '선수'];

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
            // 숨겨져 있던 동안 그려졌거나 창 크기가 바뀌었으면 레이아웃(PC/모바일)을 다시 맞춘다.
            refreshNewsLayoutIfNeeded();
        }
    }
    if (!skipHashUpdate) updateMembersHash();
}

function memberCardHtml(m) {
    return `
        <div class="member-card${isActiveMember(m) ? '' : ' former'}" role="button" tabindex="0" onclick="openMemberProfile('${jsAttr(m['이름'])}')">
            <span class="tool-card-ext">↗</span>
            ${avatarHtml(m['SOOP ID'], 'member-avatar-img')}
            <div class="member-card-name">${escapeHTML(m['이름'])}</div>
            <div class="member-card-tags">
                ${tierBadgeHtml(m['티어'])}
                ${raceBadgeHtml(m['종족'])}
            </div>
        </div>`;
}

// (예전의 opts.collapseId 분기는 어디서도 쓰이지 않던 죽은 코드라 제거했다)
function renderMemberGroup(title, members) {
    if (members.length === 0) return '';
    const sorted = [...members].sort((a, b) =>
        tierIndex(a['티어']) - tierIndex(b['티어']) || String(a['이름']).localeCompare(String(b['이름']), 'ko'));

    return `
        <div class="section-title"><span class="section-title-label">${escapeHTML(title)}<span class="title-count-divider"></span><span class="text-secondary title-count">${sorted.length}명</span></span></div>
        <div class="member-grid mb-block">${sorted.map(memberCardHtml).join('')}</div>`;
}

function renderMembersPage() {
    const activeMembers = SiteData.members.filter(isActiveMember);
    const formerMembers = SiteData.members.filter(m => !isActiveMember(m));
    const allRoles = [...new Set(activeMembers.map(m => m['직책'] || '기타'))];
    const roleOrder = [...ROLE_ORDER_BASE, ...allRoles.filter(r => !ROLE_ORDER_BASE.includes(r))];

    let html = roleOrder.map(role => renderMemberGroup(role, activeMembers.filter(m => (m['직책'] || '기타') === role))).join('');

    if (formerMembers.length > 0) {
        html += `
            <div class="text-center section-trailer">
                <button class="news-load-more" id="former-members-toggle-btn" onclick="toggleFormerMembersSection()">이전 멤버 ${chevronDownSvg(9, ' id="former-members-toggle-chevron" class="chevron-rotatable"')}</button>
            </div>
            <div id="former-members-section" class="d-none">
                ${renderMemberGroup('이전 멤버', formerMembers)}
            </div>`;
    }

    document.getElementById('members-groups').innerHTML = html || '<div class="text-center text-muted py-5">등록된 멤버가 없습니다.</div>';
}

function toggleFormerMembersSection() {
    toggleCollapsible('former-members-section', 'former-members-toggle-chevron');
}

let _profileMember = null; // 지금 프로필 팝업에 떠 있는 멤버(방송 활동 데이터가 늦게 오면 다시 채우기용)

function openMemberProfile(name) {
    const m = findMemberByName(name);
    if (!m) return;
    _profileMember = m;

    document.getElementById('mp-name').innerText = name;
    const mpRoleBadge = document.getElementById('mp-role-badge');
    applyBadge(mpRoleBadge, m['직책'] || '미정', 'tag-badge role-badge');
    mpRoleBadge.style.background = roleColor(m['직책']); // 직책마다 달라지는 동적 색이라 인라인 유지
    applyBadge(document.getElementById('mp-race-badge'), raceShortLabel(m['종족']), 'tag-badge' + raceBadgeClass(m['종족']));
    applyBadge(document.getElementById('mp-tier-badge'), tierLabel(m['티어']), 'tag-badge tier-badge');
    document.getElementById('mp-avatar').innerHTML = profileAvatarInnerHtml(m['SOOP ID']);

    const active = isActiveMember(m);
    const days = m['입단일'] ? daysBetween(m['입단일'], active ? todayStr() : (m['퇴단일'] || null)) : null;
    // 다른 뱃지들(직책/티어/종족)과 같은 tag-badge 패밀리를 써서 톤을 맞추고, 텍스트와
    // 뱃지를 flex로 묶어 기준선이 아니라 박스 높이 기준으로 정렬한다.
    const daysBadge = days !== null
        ? `<span class="tag-badge tier-badge">${days}일${active ? '째' : ''}</span>`
        : '';
    const period = m['입단일']
        ? `<span class="d-inline-flex align-items-center flex-wrap gap-2">${escapeHTML(m['입단일'])} ~ ${active ? '현재' : (escapeHTML(m['퇴단일']) || '-')}${daysBadge}</span>`
        : '-';
    const soopId = m['SOOP ID'];
    const broadcast = isValidSoopId(soopId)
        ? `<a href="https://www.sooplive.com/station/${encodeURIComponent(String(soopId).trim())}" target="_blank" rel="noopener" class="d-inline-flex align-items-center" aria-label="SOOP 방송국">
                   <img src="images/숲로고.webp" alt="SOOP" class="soop-logo-icon">
               </a>`
        : '-';

    const rows = [
        ['성별', escapeHTML(m['성별']) || '-'],
        ['생년월일', escapeHTML(m['생년월일']) || '-'],
        ['MBTI', escapeHTML(m['MBTI']) || '-'],
        ['활동기간', period],
        ['방송국', broadcast],
    ];
    document.getElementById('mp-info-body').innerHTML = rows.map(([label, val]) => `
            <tr>
                <td class="text-secondary profile-info-label">${label}</td>
                <td class="fw-bold text-dark profile-info-value">${val}</td>
            </tr>`).join('');

    renderMemberActivitySummary(m);
    showModal('memberProfileModal');
}

// 프로필 팝업의 "이번 달 방송 활동"을 시너지표(ststats)에서 가져온 데이터로 채운다.
function renderMemberActivitySummary(m) {
    const statusEl = document.getElementById('mp-activity-status');
    const valueEls = ['mp-balloons', 'mp-broadcast-hours', 'mp-viewers', 'mp-sponsor-record'].map(id => document.getElementById(id));
    const setValues = values => valueEls.forEach((el, i) => { el.innerText = values[i]; });

    if (!SynergyState.data) {
        statusEl.innerText = SynergyState.failed ? '불러오지 못했습니다' : '데이터 불러오는 중';
        setValues(['-', '-', '-', '-']);
        return;
    }

    const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
    const entry = SynergyState.data.find(s => String(s.id || '').trim().toLowerCase() === soopId);
    if (!entry) {
        statusEl.innerText = '데이터 없음';
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

// "전체 공지"/"멤버별 공지" 두 화면 다 이 하나의 상태로 통일해서 그린다.
const NewsState = {
    sidebarRendered: false,
    player: null,          // 선택된 멤버 객체 (null = 전체 공지)
    mode: 'all',           // 'all'(전체 공지) | 'member'(특정 멤버) - 더보기 때 어느 쪽 API를 더 부를지 결정
    items: [],             // 지금 화면에 로드되어 있는 { member, post } 목록
    featuredKey: null,     // 왼쪽 "최신 글" 자리에 올려둔 글의 식별자 - 리스트 클릭 시 이 값만 바뀐다
    hasMore: false,
    loading: false,        // "더 보기" 중복 클릭 방지
    memberPage: 1,         // 멤버 모드: 마지막으로 받은 페이지
    memberTotalPages: 1,
    allPool: [],           // 전체 모드: 멤버별로 모아 날짜순 정렬해둔 후보 풀
    allShownCount: 0,
    // 전체 모드에서 멤버별로 다음에 가져올 페이지 번호와 총 페이지 수.
    // Map<soopId, { nextPage, totalPages }> - 풀에 남은 게 부족하면 아직 페이지가 남은 멤버의 다음 페이지를 가져온다.
    allMemberState: new Map(),
    // 목록 API의 content.content(원본 HTML)는 이미 전체 본문이고 textContent만 잘린 미리보기다.
    // "더보기"를 위해 상세 API를 따로 부르지 않고, 카드를 그릴 때 받아온 전체 HTML을 titleNo로 기억해둔다.
    fullContent: {},
    // 요청 세대 번호: 새 목록 요청을 시작할 때마다 올린다. 응답이 돌아왔을 때 번호가 바뀌어
    // 있으면(그 사이 다른 멤버/전체를 선택함) 그 응답은 버린다. 예전엔 A 멤버 글을 불러오는
    // 도중 B를 누르면 B 요청은 무시되고, 뒤늦게 온 A의 글이 B 이름·사진으로 그려졌다.
    requestSeq: 0,
};

function renderNewsSidebar() {
    const html = [avatarSelectAllItemHtml('news-side-btn-all', 'showNewsAll()')];
    activeMembersWithSoopId().forEach(m => {
        html.push(avatarSelectItemHtml('news-side-player-', m['이름'], m['SOOP ID'], 'selectNewsPlayer'));
    });
    document.getElementById('news-avatar-list').innerHTML = html.join('');
}

// 아직 다음 페이지가 남아있는 멤버가 한 명이라도 있는지
function newsAnyMemberHasMorePages() {
    for (const st of NewsState.allMemberState.values()) {
        if (st.nextPage <= st.totalPages) return true;
    }
    return false;
}

// { member, post } 하나를 고유하게 식별하는 키
function newsItemKey(item) {
    const soopId = item.member ? item.member['SOOP ID'] : item.post.userId;
    return soopId + '_' + item.post.titleNo;
}

async function showNewsAll(skipHashUpdate) {
    setActiveAvatarItem('news-avatar-list', document.getElementById('news-side-btn-all'));
    document.getElementById('news-content-title').innerText = '전체 공지';
    NewsState.player = null;
    if (!skipHashUpdate) updateMembersHash();

    const content = document.getElementById('news-feed-content');
    content.innerHTML = emptyStateHtml('불러오는 중...');
    const token = ++NewsState.requestSeq;

    // 멤버별로 최근 글 후보를 모아서(공지+일반글 합친 것) 전체를 한 번에 날짜순으로 다시 정렬.
    // 주의: fetchMemberFeed(mergeOwnPosts)는 perPage=10짜리 일반글에 공지를 추가로 합치기
    // 때문에 10개보다 많이 돌아올 수 있다 - 자르면 넘치는 만큼 조용히 누락되므로 전부 담는다.
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
    NewsState.featuredKey = null; // 새로 들어왔으니 제일 최신 글을 다시 왼쪽에 올린다
    NewsState.allShownCount = NewsState.allPool.length; // 이미 멤버별로 가져온 건 처음부터 다 보여준다
    NewsState.items = NewsState.allPool.slice(0, NewsState.allShownCount);
    NewsState.hasMore = NewsState.allShownCount < NewsState.allPool.length || newsAnyMemberHasMorePages();
    renderNewsLayout(content);
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

    document.getElementById('news-feed-content').innerHTML = emptyStateHtml('불러오는 중...');
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
        NewsState.featuredKey = null; // 멤버를 새로 선택했으니 그 멤버의 가장 최신 글을 왼쪽에 올린다
        NewsState.items = posts.map(post => ({ member, post }));
        NewsState.hasMore = NewsState.memberPage < NewsState.memberTotalPages;
        renderNewsLayout(content);
    } catch (e) {
        if (token === NewsState.requestSeq) content.innerHTML = emptyStateHtml('글을 불러오지 못했습니다.');
    }
}

// 풀에 남은 게 한 페이지어치도 안 되면, 아직 다음 페이지가 남은 멤버들의 다음 페이지를
// 마저 받아와서 풀을 채운 뒤 10개를 더 보여준다.
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
        // 공지가 페이지마다 같이 딸려올 수 있어, 이미 풀에 있는 글은 다시 추가하지 않는다.
        const existingKeys = new Set(S.allPool.map(newsItemKey));
        const fetched = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
            .filter(item => !existingKeys.has(newsItemKey(item)));
        S.allPool = sortNewsByDateDesc(S.allPool.concat(fetched));
    }
    S.allShownCount = Math.min(S.allShownCount + NEWS_PAGE_SIZE, S.allPool.length);
    S.items = S.allPool.slice(0, S.allShownCount);
    S.hasMore = S.allShownCount < S.allPool.length || newsAnyMemberHasMorePages();
    return true;
}

// 특정 멤버의 다음 페이지를 서버에 추가로 요청한다.
async function loadMoreMemberNews(token) {
    const S = NewsState;
    const member = S.player;
    S.memberPage += 1;
    const { posts, totalPages } = await fetchMemberFeed(member['SOOP ID'], S.memberPage);
    if (token !== S.requestSeq) return false;
    S.memberTotalPages = totalPages;
    // 공지(noticeData)는 페이지가 넘어가도 고정으로 같이 딸려오는 경우가 있어, 이미 있는 글은
    // 다시 추가하지 않는다 (안 그러면 "더보기"를 누를 때마다 같은 공지가 중복으로 쌓임).
    const existingKeys = new Set(S.items.map(newsItemKey));
    S.items = S.items.concat(posts.map(post => ({ member, post })).filter(item => !existingKeys.has(newsItemKey(item))));
    S.hasMore = S.memberPage < S.memberTotalPages;
    return true;
}

// 더보기: "전체 공지"면 모아둔 풀에서 더 꺼내 보여주고, 특정 멤버면 다음 페이지를 요청한다.
async function loadMoreNewsFeed() {
    if (NewsState.loading) return;
    NewsState.loading = true;
    const token = NewsState.requestSeq;
    // 다시 그리면 #news-past-list가 새로 만들어지면서 스크롤이 0으로 초기화되니, 보던 위치를 저장해둔다.
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

// 오른쪽 "지난 글" 리스트(#news-past-list)의 내부 스크롤 위치를 저장하고, 다시 그린 뒤
// 복원하는 함수를 돌려준다(더보기/최신 글 교체 공용). 리스트가 없는 모바일 레이아웃에선 사실상 무동작.
function capturePastListScroll() {
    const before = document.getElementById('news-past-list');
    const saved = before ? before.scrollTop : 0;
    return () => {
        const after = document.getElementById('news-past-list');
        if (after) after.scrollTop = saved;
    };
}

// 리스트에서 글을 클릭했을 때 - 그 글을 왼쪽 "최신 글" 자리로 올린다(배열 순서/날짜는 그대로,
// 어떤 글을 큰 카드로 그릴지만 바꿔서 다시 그린다 - 오른쪽 리스트는 항상 날짜순 유지).
function setNewsFeatured(key) {
    const restoreScroll = capturePastListScroll();
    NewsState.featuredKey = key;
    renderNewsLayout(document.getElementById('news-feed-content'));
    restoreScroll();
}

// 고정 픽셀 기준 대신, CSS에서 두 컬럼에 준 min-width(.featured-post 300px + .past-posts
// 300px) + gap(28px)을 기준으로 삼아 "오른쪽 리스트가 폭이 부족해 아래로 떨어지려는 순간"에
// 정확히 모바일(단일 리스트) 모드로 전환한다.
const NEWS_TWO_COL_MIN_WIDTH = 300 + 28 + 300;

function isNewsMobileLayout() {
    const content = document.getElementById('news-feed-content');
    if (!content) return false;
    return content.clientWidth < NEWS_TWO_COL_MIN_WIDTH;
}

// 화면에 실제로 보이는 중인지(숨겨진 탭에서는 폭이 0으로 재져서 모바일로 오판된다)
function isNewsFeedShown(content) {
    return !!content && content.offsetParent !== null;
}

// 창 크기를 조절하다 모바일 기준선을 넘나들면 레이아웃 방식 자체가 바뀌어야 하므로
// 다시 그린다. 숨겨진 상태에서는 판단을 미루고, 다시 보일 때 맞춘다.
function refreshNewsLayoutIfNeeded() {
    const content = document.getElementById('news-feed-content');
    if (NewsState.items.length === 0 || !isNewsFeedShown(content)) return;
    const wasMobile = content.classList.contains('news-feed-mobile');
    if (wasMobile !== isNewsMobileLayout()) renderNewsLayout(content);
}

window.addEventListener('resize', rafThrottle(refreshNewsLayoutIfNeeded));

// 오늘/어제/이번 주/이번 달/이전 - 리스트를 메신저처럼 구간으로 나눠 스캔하기 쉽게 한다.
function newsDateGroupLabel(dateStr) {
    const d = parseSoopDate(dateStr);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = new Date();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((todayDay - day) / 86400000);
    if (diffDays <= 0) return '오늘';
    if (diffDays === 1) return '어제';
    if (diffDays <= 7) return '이번 주';
    if (diffDays <= 30) return '이번 달';
    return '이전';
}

// 이미 날짜순으로 정렬된 items를 렌더링하면서, 그룹 라벨이 바뀌는 지점마다 구분 라벨을 끼운다.
function renderNewsItemsWithDateGroups(items, renderItemFn) {
    let lastGroup = null;
    return items.map(item => {
        const group = newsDateGroupLabel(item.post.regDate);
        const groupHtml = group !== lastGroup ? `<div class="news-date-group-label">${group}</div>` : '';
        lastGroup = group;
        return groupHtml + renderItemFn(item);
    }).join('');
}

function featuredPostWrapHtml(item) {
    return `<div class="featured-post" data-news-key="${escapeHTML(newsItemKey(item))}">${renderFeaturedPostHtml(item)}</div>`;
}

// 모바일: 날짜순 단일 리스트에서 선택된 글만 그 자리에서 큰 카드로 확대한다
// (큰 글을 맨 위에 고정하면 리스트에서 누를 때마다 위로 스크롤해야 보이기 때문).
function newsMobileLayoutHtml(sorted, loadMoreHtml) {
    return renderNewsItemsWithDateGroups(sorted, item => (newsItemKey(item) === NewsState.featuredKey
        ? featuredPostWrapHtml(item)
        : renderPastNoticeHtml(item))) + loadMoreHtml;
}

// PC: 왼쪽 큰 카드(선택된 글) + 오른쪽 날짜순 "지난 글" 리스트
function newsDesktopLayoutHtml(sorted, loadMoreHtml) {
    const featuredItem = sorted.find(it => newsItemKey(it) === NewsState.featuredKey);
    const restItems = sorted.filter(it => newsItemKey(it) !== NewsState.featuredKey);
    const pastListHtml = restItems.length
        ? renderNewsItemsWithDateGroups(restItems, renderPastNoticeHtml)
        : emptyStateHtml('지난 글이 없습니다.');
    return `
                ${featuredPostWrapHtml(featuredItem)}
                <div class="past-posts">
                    <div id="news-past-list">${pastListHtml}</div>
                    ${loadMoreHtml}
                </div>`;
}

const NEWS_LOAD_MORE_HTML = `<div class="news-load-more-wrap" id="news-load-more-wrap"><button class="news-load-more" onclick="loadMoreNewsFeed()">더 보기 ${chevronDownSvg(9)}</button></div>`;

// "전체 공지"/"멤버별 공지" 공용 렌더러.
function renderNewsLayout(content) {
    if (NewsState.items.length === 0) {
        content.classList.remove('news-feed-mobile');
        content.innerHTML = emptyStateHtml('작성된 글이 없습니다.');
        return;
    }

    const sorted = sortNewsByDateDesc(NewsState.items);
    if (!NewsState.featuredKey || !sorted.some(it => newsItemKey(it) === NewsState.featuredKey)) {
        NewsState.featuredKey = newsItemKey(sorted[0]); // 기본값: 가장 최신 글
    }
    const loadMoreHtml = NewsState.hasMore ? NEWS_LOAD_MORE_HTML : '';

    const mobile = isNewsMobileLayout();
    content.classList.toggle('news-feed-mobile', mobile);
    content.innerHTML = mobile ? newsMobileLayoutHtml(sorted, loadMoreHtml) : newsDesktopLayoutHtml(sorted, loadMoreHtml);
    checkNewsClampButtons(content);
}

// ----- 공지 본문(외부 HTML) 정제 -----
// [보안] 공지 본문은 SOOP에서 받아온 외부 HTML이다. 예전엔 위험한 태그/속성을 직접 골라 지우는
// 차단 목록 방식이었는데, 새로운 우회 기법이 나올 때마다 뚫릴 수밖에 없다(실제로 원본에서 3종 우회
// 확인). 이제 검증된 라이브러리 DOMPurify(저장소에 포함, index.html에서 로드)로 "허용한 것만 남기는"
// 방식으로 정제한다. 서식(정렬/색/굵기/표/목록/링크)은 유지된다.
//   - class는 허용하지 않는다: 본문이 우리 사이트/부트스트랩 클래스(position-fixed 등)를 빌려 써서
//     화면을 덮는 가짜 UI를 만들 수 있기 때문(원본 SOOP 편집기 클래스는 우리 사이트에서 의미가 없다).
//   - style은 서식 때문에 허용하되, 화면 위에 떠서 사이트를 덮을 수 있는 위치 관련 속성은 뺀다.
//   - 결과를 문자열로 다시 직렬화해 innerHTML에 넣지 않고 DOM 조각 그대로 붙인다(파싱을 두 번
//     거치며 의미가 바뀌는 mutation XSS의 여지를 없앰).
//   - DOMPurify가 없으면(로드 실패 등) HTML을 쓰지 않고 순수 텍스트로만 보여준다(안전한 쪽으로 실패).
const NEWS_ALLOWED_TAGS = [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
    'small', 'mark', 'font', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'figure', 'figcaption', // 아래에서 통째로 지우기 위해 허용(허용 안 하면 안의 캡션 글자만 남는다)
];

const NEWS_ALLOWED_ATTR = ['href', 'target', 'title', 'style', 'align', 'color', 'size', 'face', 'colspan', 'rowspan', 'dir', 'lang'];

const NEWS_STRIPPED_STYLE_PROPS = ['position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index', 'transform'];

// DOMPurify를 쓸 수 없을 때: 문단/줄바꿈만 살린 순수 텍스트(.news-post-body가 pre-wrap이라 줄바꿈이 보인다)
function newsPlainTextFragment(html) {
    const withBreaks = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
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
    if (!purifier || !purifier.isSupported || typeof purifier.sanitize !== 'function') return newsPlainTextFragment(html);

    const frag = purifier.sanitize(String(html), {
        ALLOWED_TAGS: NEWS_ALLOWED_TAGS,
        ALLOWED_ATTR: NEWS_ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
        RETURN_DOM_FRAGMENT: true,
    });
    // 사진(figure)은 카드 하단 갤러리(post.photos)가 따로 보여주므로 본문에서는 캡션까지 통째로 뺀다.
    frag.querySelectorAll('figure').forEach(el => el.remove());
    frag.querySelectorAll('[style]').forEach(el => {
        NEWS_STRIPPED_STYLE_PROPS.forEach(prop => el.style.removeProperty(prop));
        if (!el.getAttribute('style').trim()) el.removeAttribute('style');
    });
    // 새 창으로 여는 링크가 원래 페이지(우리 사이트)를 조작하지 못하게 한다.
    frag.querySelectorAll('a[target]').forEach(a => a.setAttribute('rel', 'noopener noreferrer'));
    // 사진을 지우고 남은, 원래부터 비어있던 문단(<p></p>, <p>&nbsp;</p>, <p><br></p>)은 정리한다.
    frag.querySelectorAll('p').forEach(p => {
        const onlyBr = p.children.length === 1 && p.children[0].tagName === 'BR';
        if (!p.textContent.trim() && (p.children.length === 0 || onlyBr)) p.remove();
    });
    return frag;
}

// 문자열이 필요한 곳(테스트 등)을 위한 호환용. 화면에 넣을 때는 sanitizeNewsFragment를 쓴다.
function sanitizeNewsHtml(html) {
    const box = document.createElement('div');
    box.appendChild(sanitizeNewsFragment(html));
    return box.innerHTML;
}

// 렌더링 직후 "더보기"가 필요한지 판단한다: 1) 실제로 3줄 안에 다 안 들어가거나
// 2) 목록 API가 이미 "..."으로 잘라서 내려준 미리보기인 경우.
function checkNewsClampButtons(container) {
    container.querySelectorAll('.news-post-body-clamp:not([data-clamp-checked])').forEach(body => {
        body.setAttribute('data-clamp-checked', '1');
        const overflowed = body.scrollHeight > body.clientHeight + 1;
        const looksApiTruncated = /(\.\.\.|…)\s*$/.test((body.textContent || '').trim());
        if (overflowed || looksApiTruncated) {
            const btn = body.nextElementSibling;
            if (btn && btn.classList.contains('news-post-more-btn')) btn.style.display = 'inline-flex';
        }
    });
}

// "더보기" 클릭 - 이미 목록 API에서 받아 기억해둔 전체 본문(HTML)을 바로 꽂는다.
function expandNewsPost(btn, titleNo) {
    const body = btn.previousElementSibling;
    const fullHtml = NewsState.fullContent[String(titleNo)];
    if (!fullHtml || !body) return;
    body.replaceChildren(sanitizeNewsFragment(fullHtml));
    body.classList.remove('news-post-body-clamp');
    btn.remove();
}

// 공지 카드의 다중 사진 스와이프 - 스크롤 위치로 현재 몇 번째 사진인지 계산해서 인디케이터
// active 표시와 좌/우 화살표(첫 장에선 이전, 마지막 장에선 다음을 숨김)를 갱신한다.
// 스와이프 중 onscroll이 프레임당 여러 번 와도 갤러리마다 한 프레임에 한 번만 계산한다.
const updateNewsPhotoDots = rafThrottleByKey(scroller => {
    const wrap = scroller.parentElement;
    if (!wrap || !wrap.classList.contains('news-post-photos-wrap')) return;
    const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
    const total = scroller.children.length;

    wrap.querySelectorAll('.news-post-photos-dots .photo-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    const prevBtn = wrap.querySelector('.news-photo-nav-prev');
    const nextBtn = wrap.querySelector('.news-photo-nav-next');
    if (prevBtn) prevBtn.classList.toggle('is-hidden', idx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-hidden', idx >= total - 1);
});

// 화살표 클릭 시 사진 한 장 폭만큼 부드럽게 스크롤 이동 (좌: -1, 우: 1)
function scrollNewsPhotos(btn, dir) {
    const wrap = btn.closest('.news-post-photos-wrap');
    const scroller = wrap && wrap.querySelector('.news-post-photos');
    if (scroller) scroller.scrollBy({ left: dir * scroller.clientWidth, behavior: 'smooth' });
}

const HEART_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.2 1.4 6.9 4 5.3c2.2-1.3 4.7-.6 6 1.2l2 2.7 2-2.7c1.3-1.8 3.8-2.5 6-1.2 2.6 1.6 3 4.9 1.3 7.6C18.7 16.65 12 21 12 21z"/></svg>';

const EYE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// 사진이 2장 이상이면 인스타처럼 가로 스와이프(스크롤 스냅) + 하단 인디케이터. PC는 호버 시
// 좌우 화살표, 모바일은 스와이프만(화살표는 CSS @media (hover:none)에서 숨김). 첫 사진은
// 즉시 로드하고, 스와이프해야 보이는 두 번째 사진부터만 지연 로딩한다.
function newsPhotosHtml(photos) {
    if (!photos.length) return '';
    const multi = photos.length > 1;
    const dotsHtml = multi
        ? `<div class="news-post-photos-dots">${photos.map((_, i) => `<span class="photo-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
        : '';
    const navHtml = multi
        ? `<button type="button" class="news-photo-nav news-photo-nav-prev is-hidden" onclick="scrollNewsPhotos(this,-1)" aria-label="이전 사진">‹</button>
               <button type="button" class="news-photo-nav news-photo-nav-next" onclick="scrollNewsPhotos(this,1)" aria-label="다음 사진">›</button>`
        : '';
    return `<div class="news-post-photos-wrap">
                    <div class="news-post-photos"${multi ? ' onscroll="updateNewsPhotoDots(this)"' : ''}>${photos.map((p, i) => `<img src="${escapeHTML(p && p.url)}" alt=""${i > 0 ? ' loading="lazy"' : ''} onerror="this.remove();">`).join('')}</div>
                    ${navHtml}
                    ${dotsHtml}
               </div>`;
}

// 좋아요/조회수 - "원글 보기" 링크와 같은 줄에 나란히 배치한다.
function newsPostStatsHtml(post) {
    const likeCnt = post.count && post.count.likeCnt;
    const readCnt = post.count && post.count.readCnt;
    if (!likeCnt && !readCnt) return '<div class="news-post-stats"></div>';
    const stat = (icon, n) => `<span class="news-post-stat">${icon}${escapeHTML(Number(n).toLocaleString('ko-KR'))}</span>`;
    return `<div class="news-post-stats">
                    ${likeCnt ? stat(HEART_ICON, likeCnt) : ''}
                    ${readCnt ? stat(EYE_ICON, readCnt) : ''}
               </div>`;
}

// 왼쪽 "최신 글" 큰 카드 - 사진 캐러셀, 본문 더보기 등을 포함한 news-post-card.
function renderFeaturedPostHtml(item) {
    const { member, post } = item;
    const title = post.titleName || '';
    const snippet = (post.content && post.content.textContent) || '';
    const fullHtml = (post.content && post.content.content) || '';
    if (fullHtml) NewsState.fullContent[String(post.titleNo)] = fullHtml;
    const category = (post.display && post.display.bbsName) || '';
    const timeText = formatRelativeTime(post.regDate);
    const soopId = member ? member['SOOP ID'] : post.userId;
    const name = member ? member['이름'] : (post.userNick || '');
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
            ${snippet ? `<div class="news-post-body news-post-body-clamp">${formatNewsContent(snippet)}</div><button type="button" class="news-post-more-btn" onclick="expandNewsPost(this, '${jsAttr(post.titleNo)}')">더보기 ${chevronDownSvg(9)}</button>` : ''}
            ${newsPhotosHtml(asArray(post.photos))}
            <div class="news-post-link-row">
                ${newsPostStatsHtml(post)}
                <a class="news-post-link" href="${postUrl}" target="_blank" rel="noopener">
                    원글 보기 <span class="ext-arrow">↗</span>
                </a>
            </div>
        </div>`;
}

// 오른쪽 "지난 글" 리스트 - 홈 "최근 공지"와 같은 카드를 쓰되, 클릭하면 원글로 나가지 않고
// 그 글을 왼쪽 최신 글 자리로 올린다.
function renderPastNoticeHtml(item) {
    const key = newsItemKey(item);
    return homeNoticeCardHtml(noticeCardFields(item.member, item.post), {
        onclickAttr: `setNewsFeatured('${jsAttr(key)}')`,
        extraClass: 'news-past-item',
        dataAttr: `data-news-key="${escapeHTML(key)}"`,
    });
}

// 프로필 팝업의 "이번 달 방송 활동"용 데이터. 팝업이 이미 열려 있으면 도착하는 대로 다시 채운다.
function loadProfileActivityData() {
    const refresh = () => {
        const modal = document.getElementById('memberProfileModal');
        if (_profileMember && modal && modal.classList.contains('show')) renderMemberActivitySummary(_profileMember);
    };
    return fetchSynergyData().then(refresh, err => { console.error(err); refresh(); });
}

bootPage(() => {
    safeInit('멤버 페이지', renderMembersPage);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const view = params.get('view') === 'news' ? 'news' : 'status';
        switchMemberView(view);
        const member = params.get('member');
        if (view === 'news' && member) selectNewsPlayer(member);
        // 특정 멤버 공지를 보다가 뒤로가기로 "전체 공지" 주소로 돌아온 경우 화면도 전체로 되돌린다
        else if (view === 'news' && NewsState.player && NewsState.sidebarRendered) showNewsAll(true);
    }));
    safeInit('방송 활동 데이터', loadProfileActivityData);
});
