/**
 * SOOP(방송 플랫폼) 연동 공용 로직 - 홈/멤버/도구 페이지가 core.js 다음에 불러온다.
 * 방송 중 여부(bjapi), 방송국 게시판 글(api-channel), 공지 카드 마크업.
 */

// 방송 중 여부. 멤버마다 SOOP API를 부르지 않고, ststat live-status가 2분마다 명단 전원을 훑어 둔
// live_broadcasts_current를 core.js fetchLiveBroadcasts로 한 번만 받아(20초 캐시) 여럿이 나눠 쓴다.
// 돌려주는 모양: { broad: { broad_no, broad_title, current_sum_viewer }, broadStart }. 시청자 수는 최대 2분 전 값이다.
async function getLiveRealtimeStatus(soopId) {
    try {
        const row = (await fetchLiveBroadcasts())[String(soopId || '').trim().toLowerCase()];
        const live = row ? {
            broad: { broad_no: row.broad_no, broad_title: row.broad_title, current_sum_viewer: row.current_sum_viewer },
            broadStart: row.broad_start || null,
        } : null;
        return { ok: true, live };
    } catch (e) {
        return { ok: false, live: null, error: e };
    }
}

// 기존 홈 외 호출부는 방송 객체/null 규약을 그대로 사용한다.
async function checkIsLiveRealtime(soopId) {
    const result = await getLiveRealtimeStatus(soopId);
    return result.ok ? result.live : null;
}

// 공지 카드에 필요한 표시용 필드를 게시글 한 개에서 뽑는다(홈 최근 공지/지난 글 리스트 공용).
function noticeCardFields(member, post) {
    return {
        soopId: member ? member['SOOP ID'] : post.userId,
        name: member ? member['이름'] : (post.userNick || ''),
        title: post.titleName || '(제목 없음)',
        snippet: (post.content && post.content.textContent) || '',
        timeText: formatRelativeTime(post.regDate),
        thumbUrl: post.photos && post.photos[0] && post.photos[0].url,
    };
}

// "최근 공지"/"지난 글" 카드 한 장의 마크업 - 홈 화면 목록과 멤버 공지 탭의
// "지난 글" 리스트가 완전히 같은 모양이라 공용 함수로 뺐다. 클릭했을 때 동작만
// 서로 달라서 링크 주소(href) 또는 동작 속성(act(...)의 결과)을 받는다.
function homeNoticeCardHtml({ soopId, name, title, snippet, timeText, thumbUrl }, opts) {
    const { href, action, extraClass, dataAttr } = opts || {};
    const thumbHtml = thumbUrl ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy"${actOn('error', 'imgRemove', ACT.el)}>` : '';
    const cls = `home-notice-card${extraClass ? ' ' + extraClass : ''}`;
    // 다른 페이지로 가는 카드(홈 → 멤버 공지)는 진짜 링크(<a href>)라 새 탭 열기/Ctrl+클릭이 된다.
    // 같은 페이지 안에서 동작만 하는 카드(지난 글 → 최신 글로 올리기)는 버튼 역할로 둔다.
    const [open, close] = href
        ? [`<a class="${cls}" href="${escapeHTML(href)}"${dataAttr ? ' ' + dataAttr : ''}>`, '</a>']
        : [`<div class="${cls}" role="button" tabindex="0"${action}${dataAttr ? ' ' + dataAttr : ''}>`, '</div>'];
    return `
        ${open}
            <div class="home-notice-main">
                <div class="home-notice-top">
                    ${avatarHtml(soopId, 'home-notice-avatar')}
                    <div class="home-notice-toptext">
                        <div class="home-notice-name">${escapeHTML(name)}</div>
                        <div class="home-notice-title-row">
                            <span class="home-notice-title">${escapeHTML(title)}</span>
                            <span class="home-notice-dot">·</span>
                            <span class="home-notice-meta">${escapeHTML(timeText)}</span>
                        </div>
                    </div>
                </div>
                ${snippet ? `<div class="home-notice-snippet">${formatNewsContent(snippet)}</div>` : ''}
            </div>
            ${thumbHtml}
        ${close}`;
}

const NEWS_PAGE_SIZE = 10;

const sortNewsByDateDesc = items => items.slice().sort((a, b) => soopDateMs(b.post.regDate) - soopDateMs(a.post.regDate));

// SOOP 게시판 API의 regDate("YYYY-MM-DD HH:MM:SS")를 "N분 전" 식으로 변환
function formatRelativeTime(dateStr) {
    const date = parseSoopDate(dateStr);
    if (isNaN(date.getTime())) return '';
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay}일 전`;
    return String(dateStr).split(' ')[0];
}

// 게시판 응답의 contents(일반글)와 noticeData(공지)를 합쳐서, 본인이 쓴 글만 남기고
// 최신순으로 정렬한다. (같은 글이 양쪽에 겹치는 경우는 titleNo로 중복 제거)
function mergeOwnPosts(data, soopId) {
    const owner = String(soopId).toLowerCase();
    const isOwn = p => !!p && String(p.userId || '').toLowerCase() === owner;
    const merged = [...asArray(data && data.contents).filter(isOwn), ...asArray(data && data.noticeData).filter(isOwn)];
    const seen = new Set();
    const unique = merged.filter(p => {
        if (seen.has(p.titleNo)) return false;
        seen.add(p.titleNo);
        return true;
    });
    return unique.sort((a, b) => soopDateMs(b.regDate) - soopDateMs(a.regDate));
}

// 활동 멤버 게시판 첫 페이지 모음(member_posts). ststat live-status가 2분마다 채운다(ststat.sql 13번).
// 홈 '최근 공지'·멤버 '전체 공지'가 멤버마다 SOOP API를 부르던 것(17번)을 이 조회 한 번으로 바꾼다.
// 표를 못 읽거나 비어 있으면 null - 그러면 SOOP에 직접 묻는다. 결과는 1분만 재사용하고,
// 실패(null)는 기억하지 않아 다음 호출이 다시 시도한다.
const STORED_POSTS_TTL_MS = 60 * 1000;
let _storedPostsRequest = null;
let _storedPostsAt = 0;
function fetchStoredMemberPosts() {
    if (_storedPostsRequest && Date.now() - _storedPostsAt < STORED_POSTS_TTL_MS) return _storedPostsRequest;
    _storedPostsAt = Date.now();
    const request = (async () => {
        const data = await Api.memberPosts();
        if (!Array.isArray(data) || !data.length) return null;
        const bySoop = new Map();
        data.forEach(r => {
            const key = String(r.soop_id || '').toLowerCase();
            if (!bySoop.has(key)) bySoop.set(key, { posts: [], totalPages: Number(r.total_pages) || 1 });
            if (r.post) bySoop.get(key).posts.push(r.post);
        });
        return bySoop;
    })().catch(() => null);
    _storedPostsRequest = request;
    request.then(result => { if (!result && _storedPostsRequest === request) _storedPostsRequest = null; });
    return request;
}

// 홈 '최근 공지'용: 전체 멤버 글 중 최신 limit개만 받는다(정렬은 DB가 한다). 모음 전체(~160개, 본문 포함)를
// 받던 것을 줄인다. 표를 못 읽거나 비어 있으면 null - 그러면 홈은 멤버별 조회(fetchMemberFeed)로 돌아간다.
async function fetchRecentStoredPosts(limit) {
    try {
        const data = await Api.recentPosts(limit);
        if (!Array.isArray(data) || !data.length) return null;
        // 카드가 쓰는 모양(noticeCardFields)으로 되돌린다
        return data.filter(r => r.regDate).map(r => ({
            soopId: String(r.soop_id || '').toLowerCase(),
            post: { titleName: r.titleName, regDate: r.regDate, content: { textContent: r.text || '' }, photos: r.thumb ? [{ url: r.thumb }] : [] },
        }));
    } catch (e) {
        return null;
    }
}

async function fetchMemberFeed(soopId, page) {
    // 첫 페이지는 모아 둔 표에서(없는 멤버 - 글이 없거나 새로 들어온 멤버 - 는 아래처럼 SOOP에 직접)
    if (Number(page) === 1) {
        const stored = await fetchStoredMemberPosts();
        const hit = stored && stored.get(String(soopId || '').toLowerCase());
        if (hit) return { posts: hit.posts.slice().sort((a, b) => soopDateMs(b.regDate) - soopDateMs(a.regDate)), totalPages: hit.totalPages };
    }
    try {
        const url = `https://api-channel.sooplive.com/v1.1/channel/${encodeURIComponent(soopId)}/board?perPage=${NEWS_PAGE_SIZE}&page=${page}`;
        const data = await cachedFetchJson(url, 120000); // 2분
        return {
            posts: mergeOwnPosts(data, soopId),
            totalPages: (data && data.meta && data.meta.totalPages) || 1,
        };
    } catch (e) {
        return { posts: [], totalPages: 1 };
    }
}

// 게시판 API의 textContent는 줄바꿈이 <br> 태그로 남아있는 형태라, <br> 계열만 실제 줄바꿈으로
// 바꾸고 나머지는 이스케이프해서 news-post-body(white-space: pre-wrap)에 안전하게 꽂는다.
function formatNewsContent(text) {
    if (!text) return '';
    return escapeHTML(String(text).replace(/<br\s*\/?>/gi, '\n'));
}
