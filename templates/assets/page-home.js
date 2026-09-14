/**
 * 홈 페이지: 방송 중 카드 + 최근 공지. (core.js → soop.js → 이 파일)
 */

// 홈 공지 카드/"전체 보기" → 멤버 페이지의 공지 탭(해당 멤버). 페이지 <base>가 사이트 루트라
// 상대 경로가 GitHub Pages(/staruniv/)와 루트 배포 양쪽에서 똑같이 맞는다.
function newsPageHref(memberName) {
    const qs = new URLSearchParams({ view: 'news' });
    if (memberName) qs.set('member', memberName);
    return `members/?${qs.toString()}`;
}

function formatLiveElapsed(broadStart) {
    if (!broadStart) return '';
    const startDate = parseSoopDate(broadStart);
    if (isNaN(startDate.getTime())) return '';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
    const eh = Math.floor(elapsedSec / 3600);
    const em = Math.floor((elapsedSec % 3600) / 60);
    return (eh > 0 ? `${eh}시간 ${em}분` : `${em}분`) + ' 방송 중';
}

let homeCarouselIndex = 0;
function goHomeCarousel(index) {
    const track = document.getElementById('home-carousel-track');
    const dots = document.querySelectorAll('#home-carousel-dots button');
    if (!track || !dots.length) return;
    homeCarouselIndex = (index + dots.length) % dots.length;
    track.style.transform = `translateX(-${homeCarouselIndex * 100}%)`;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === homeCarouselIndex));
}
function moveHomeCarousel(direction) { goHomeCarousel(homeCarouselIndex + direction); }

function renderHeroMatchPreview() {
    const box = document.getElementById('home-carousel-preview');
    if (!box) return;
    const match = SiteData.matches[0];
    if (!match) { box.innerHTML = '<div class="home-preview-label">LATEST MATCH</div><div class="home-preview-loading">경기 기록이 없습니다.</div>'; return; }
    const result = match['최종 결과'] || match['최근 결과'] || '-';
    const resultClass = result === '승' ? 'win' : result === '패' ? 'lose' : 'draw';
    box.innerHTML = `<div class="home-preview-label">LATEST MATCH</div><div class="home-preview-teams"><b>캄몬스타즈</b><span class="home-preview-result ${resultClass}">${escapeHTML(result)}</span><b>${escapeHTML(match['상대팀'] || '-')}</b></div><div class="home-preview-meta"><span>${escapeHTML(match['형식'] || '-')}</span><span>${escapeHTML(match['세트 결과'] || '-')}</span><time>${escapeHTML(shortMatchDate(match['날짜']))}</time></div>`;
}

function liveCardHtml({ member: m, live }) {
    const { broad, broadStart } = live;
    const soopId = m['SOOP ID'];
    const viewerText = broad.current_sum_viewer != null ? broad.current_sum_viewer.toLocaleString('ko-KR') + '명' : '-';
    const elapsedText = formatLiveElapsed(broadStart) || '-';
    // 아바타 링 색: 여자는 기존 그대로(빨강 계열 그라디언트), 남자만 파란 원테두리로.
    const avatarRingClass = m['성별'] === '남자' ? 'live-card-avatar-ring live-card-avatar-ring--male' : 'live-card-avatar-ring';

    return `
            <a class="live-broadcast-card" href="https://play.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
                <div class="live-thumb-wrap">
                    <img class="live-thumb" src="https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broad.broad_no)}" alt="방송 화면" onerror="this.style.display='none';">
                    <span class="live-badge">LIVE</span>
                    <div class="live-thumb-overlay">
                        <span>${escapeHTML(viewerText)}</span><span>${escapeHTML(elapsedText)}</span>
                    </div>
                </div>
                <div class="live-card-body">
                    <div class="live-card-title">${escapeHTML(broad.broad_title || '')}</div>
                    <div class="live-card-meta-row">
                        <div class="live-card-who">
                            <span class="${avatarRingClass}">${avatarHtml(soopId, 'live-card-avatar')}</span>
                            <span class="live-card-name">${escapeHTML(m['이름'])}</span>
                        </div>
                    </div>
                </div>
            </a>`;
}

async function renderLiveBroadcasts() {
    const container = document.getElementById('home-live-broadcast');
    if (!container) return;
    const noLiveHtml = emptyStateHtml('현재 방송 중인 멤버가 없습니다.');
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noLiveHtml;
        return;
    }
    container.innerHTML = emptyStateHtml('방송 상태 확인 중...');

    const settled = await Promise.allSettled(
        activeMembers.map(m => checkIsLiveRealtime(m['SOOP ID']).then(live => ({ member: m, live })))
    );
    const liveList = settled.filter(r => r.status === 'fulfilled' && r.value.live).map(r => r.value);

    container.innerHTML = liveList.length
        ? `<div class="live-broadcast-grid">${liveList.map(liveCardHtml).join('')}</div>`
        : noLiveHtml;
}

// SOOP 채널 게시판 API를 브라우저에서 직접 fetch한다 (방송중 체크와 같은 방식).
// 공지만이 아니라 일반글도 같이 긁어와서(fetchMemberFeed는 공지+일반글을 합쳐 최신순 반환) 섞는다.
async function renderLatestNotices() {
    const container = document.getElementById('home-notice-list');
    if (!container) return;
    const noNoticeHtml = emptyStateHtml('최근 공지가 없습니다.', 'clean-card');
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noNoticeHtml;
        return;
    }

    const settled = await Promise.allSettled(
        activeMembers.map(async m => {
            const { posts } = await fetchMemberFeed(m['SOOP ID'], 1);
            return posts.slice(0, 3).map(post => ({ member: m, post }));
        })
    );
    const latest = sortNewsByDateDesc(settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value));

    container.innerHTML = latest.length
        ? latest.slice(0, 5).map(({ member: m, post }) =>
            homeNoticeCardHtml(noticeCardFields(m, post), { href: newsPageHref(m['이름']) })).join('')
        : noNoticeHtml;
}

bootPage(() => {
    renderHeroMatchPreview();
    safeInit('방송중 카드', renderLiveBroadcasts);
    safeInit('최근 공지', renderLatestNotices);
});
