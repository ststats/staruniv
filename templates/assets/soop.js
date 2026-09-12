/**
 * SOOP(방송 플랫폼) 연동 공용 로직 - 홈/멤버/도구 페이지가 core.js 다음에 불러온다.
 * 방송 중 여부(bjapi), 방송국 게시판 글(api-channel), 공지 카드 마크업.
 */

// 참고 프로젝트(ststats)의 개인페이지 패턴 그대로: bjapi.afreecatv.com을
// 브라우저에서 직접 fetch한다 (CORS 허용됨). 활성 멤버가 소수라 페이지 로드
// 시점에 병렬로 바로 체크한다 - 그래서 워크플로를 몇 분마다 돌릴 필요가 없다.
async function checkIsLiveRealtime(soopId) {
    try {
        const data = await cachedFetchJson(`https://bjapi.afreecatv.com/api/${soopId}/station`, 30000); // 30초 (실시간성 유지 위해 짧게)
        if (!data || !data.broad) return null;
        return {
            broad: data.broad,
            broadStart: (data.station && data.station.broad_start) || null,
        };
    } catch (e) {
        return null;
    }
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
// 서로 달라서 링크 주소(href) 또는 onclick 속성 문자열(호출부에서 jsAttr로 이스케이프 완료)을 받는다.
function homeNoticeCardHtml({ soopId, name, title, snippet, timeText, thumbUrl }, opts) {
    const { href, onclickAttr, extraClass, dataAttr } = opts || {};
    const thumbHtml = thumbUrl ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy" onerror="this.remove();">` : '';
    const cls = `home-notice-card${extraClass ? ' ' + extraClass : ''}`;
    // 다른 페이지로 가는 카드(홈 → 멤버 공지)는 진짜 링크(<a href>)라 새 탭 열기/Ctrl+클릭이 된다.
    // 같은 페이지 안에서 동작만 하는 카드(지난 글 → 최신 글로 올리기)는 버튼 역할로 둔다.
    const [open, close] = href
        ? [`<a class="${cls}" href="${escapeHTML(href)}"${dataAttr ? ' ' + dataAttr : ''}>`, '</a>']
        : [`<div class="${cls}" role="button" tabindex="0" onclick="${onclickAttr}"${dataAttr ? ' ' + dataAttr : ''}>`, '</div>'];
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

async function fetchMemberFeed(soopId, page) {
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
