// SOOP 연동 공용 로직(방송 중 여부 · 게시판 글 · 공지 카드). 홈/멤버/도구 페이지가 core.js 다음에 싣는다.

// ststat live-status가 2분마다 채우는 방송 중 목록을 쓴다. 시청자 수는 최대 2분 전 값이다.
async function getLiveRealtimeStatus(soopId) {
    try {
        const row = (await fetchLiveBroadcasts())[
            String(soopId || '')
                .trim()
                .toLowerCase()
        ];
        const live = row
            ? {
                  broad: {
                      broad_no: row.broad_no,
                      broad_title: row.broad_title,
                      current_sum_viewer: row.current_sum_viewer,
                  },
                  broadStart: row.broad_start || null,
              }
            : null;
        return { ok: true, live };
    } catch (e) {
        return { ok: false, live: null, error: e };
    }
}

function noticeCardFields(member, post) {
    return {
        soopId: member ? member['SOOP ID'] : post.userId,
        name: member ? member['이름'] : post.userNick || '',
        title: post.titleName || '(제목 없음)',
        snippet: (post.content && post.content.textContent) || '',
        timeText: formatRelativeTime(post.regDate),
        thumbUrl: post.photos && post.photos[0] && post.photos[0].url,
    };
}

// 홈 '최근 공지'와 멤버 '지난 글' 공용 카드. 클릭 동작만 달라 href 또는 action을 받는다.
function homeNoticeCardHtml({ soopId, name, title, snippet, timeText, thumbUrl }, opts) {
    const { href, action, extraClass, dataAttr } = opts || {};
    const thumbHtml = thumbUrl
        ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy"${actOn('error', 'imgRemove', ACT.el)}>`
        : '';
    const cls = `home-notice-card${extraClass ? ' ' + extraClass : ''}`;
    // 다른 페이지로 가는 카드는 새 탭 열기가 되도록 진짜 링크로 둔다
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

const sortNewsByDateDesc = items =>
    items.slice().sort((a, b) => soopDateMs(b.post.regDate) - soopDateMs(a.post.regDate));

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

// 같은 글이 contents(일반글)와 noticeData(공지) 양쪽에 올 수 있다
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

// 활동 멤버 게시판 첫 페이지 모음(ststat live-status가 2분마다 채움). 멤버마다 SOOP API를 부르지 않으려고 쓴다.
// 못 읽거나 비면 null(호출 쪽이 SOOP에 직접 묻는다). 실패는 캐시하지 않는다.
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
    request.then(result => {
        if (!result && _storedPostsRequest === request) _storedPostsRequest = null;
    });
    return request;
}

// 홈 '최근 공지'용 최신 limit개. 못 읽거나 비면 null(홈은 fetchMemberFeed로 돌아간다).
async function fetchRecentStoredPosts(limit) {
    try {
        const data = await Api.recentPosts(limit);
        if (!Array.isArray(data) || !data.length) return null;
        // noticeCardFields가 읽는 모양으로 맞춘다
        return data
            .filter(r => r.regDate)
            .map(r => ({
                soopId: String(r.soop_id || '').toLowerCase(),
                post: {
                    titleName: r.titleName,
                    regDate: r.regDate,
                    content: { textContent: r.text || '' },
                    photos: r.thumb ? [{ url: r.thumb }] : [],
                },
            }));
    } catch (e) {
        return null;
    }
}

async function fetchMemberFeed(soopId, page) {
    // 모음에 없는 멤버(글이 없거나 막 들어온 멤버)는 SOOP에 직접 묻는다
    if (Number(page) === 1) {
        const stored = await fetchStoredMemberPosts();
        const hit = stored && stored.get(String(soopId || '').toLowerCase());
        if (hit)
            return {
                posts: hit.posts.slice().sort((a, b) => soopDateMs(b.regDate) - soopDateMs(a.regDate)),
                totalPages: hit.totalPages,
            };
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

// textContent의 줄바꿈이 <br>로 와서 \n으로 바꾼 뒤 이스케이프한다(pre-wrap으로 표시).
function formatNewsContent(text) {
    if (!text) return '';
    return escapeHTML(String(text).replace(/<br\s*\/?>/gi, '\n'));
}
