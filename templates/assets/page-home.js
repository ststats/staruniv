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
    return eh > 0 ? `${eh}시간 ${em}분` : `${em}분`;
}

let homeCarouselIndex = 0;

// [리디자인] 오른쪽 칸은 장마다 다른 걸 보여준다. 예전엔 최근 경기 하나가 모든 장에 그대로
// 붙어 있어서, 2·3번째 장(전적 / 멤버 안내)에서도 같은 경기 결과가 떠 있었다.
// 장별 내용은 SiteData에서 뽑고, 못 뽑으면 그 칸을 비운다.
const HOME_PREVIEWS = [
    { label: 'TODAY SCHEDULE', rows: () => [] },
    { label: 'RECORDS', rows: () => [
        ['상대 팀', `${new Set((SiteData.matches || []).map(m => m['상대팀'])).size}팀`],
        ['누적 경기', `${(SiteData.matches || []).length}경기`],
        ['누적 세트', `${(SiteData.rounds || []).length}세트`],
    ] },
    { label: 'ROSTER', rows: () => {
        const active = (SiteData.members || []).filter(isActiveMember);
        const byRole = role => active.filter(m => (m['직책'] || '') === role).length;
        return [['감독', `${byRole('감독')}명`], ['코치', `${byRole('코치')}명`], ['선수', `${byRole('선수')}명`]];
    } },
];

async function renderTodaySchedulePreview(box) {
    if (!box) return;
    box.innerHTML = '<div class="home-preview-label">TODAY SCHEDULE</div><div class="home-preview-loading">오늘 일정을 불러오는 중...</div>';
    try {
        const res = await fetch('data/calendar.json', { cache: 'no-cache' });
        const data = res.ok ? await res.json() : {};
        const events = Array.isArray(data.events) ? data.events : [];
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayEvents = events.filter(ev => ev && ev.startDate && today >= ev.startDate && today <= (ev.endDate || ev.startDate));
        todayEvents.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
        box.innerHTML = '<div class="home-preview-label">TODAY SCHEDULE</div>' +
            (todayEvents.length
                ? todayEvents.slice(0, 4).map(ev => `<div class="home-preview-row"><span>${escapeHTML(ev.time || '')}</span><b>${escapeHTML(ev.person || ev.desc || '-')}</b><span class="home-preview-description">${escapeHTML(ev.desc || '')}</span></div>`).join('')
                : '<div class="home-preview-loading">오늘 등록된 일정이 없습니다.</div>');
    } catch (e) {
        box.innerHTML = '<div class="home-preview-label">TODAY SCHEDULE</div><div class="home-preview-loading">오늘 일정을 불러오지 못했습니다.</div>';
    }
}


// 미리보기 칸은 장 안에 하나씩 들어 있다(data-preview="0|1|2"). 그래서 트랙이 밀릴 때
// 글과 같이 따라 움직인다 - 예전엔 캐러셀 기준 절대배치라 칸만 제자리에 남아 있었다.
// 넘길 때마다 다시 그리지 않고 처음에 전부 채운다.
function renderHomePreviewPanes() {
    document.querySelectorAll('.home-carousel-preview[data-preview]').forEach(box => {
        const index = Number(box.dataset.preview);
        if (index === 0) { renderTodaySchedulePreview(box); return; }
        const cfg = HOME_PREVIEWS[index];
        if (!cfg) { box.innerHTML = ''; return; }
        let rows = [];
        try { rows = cfg.rows(); } catch (e) { rows = []; }
        box.innerHTML = `<div class="home-preview-label">${escapeHTML(cfg.label)}</div>`
            + rows.map(([k, v]) => `<div class="home-preview-row"><span>${escapeHTML(k)}</span>`
                + `<b>${escapeHTML(String(v))}</b></div>`).join('');
    });
}

function goHomeCarousel(index) {
    const track = document.getElementById('home-carousel-track');
    const dots = document.querySelectorAll('#home-carousel-dots button');
    if (!track || !dots.length) return;
    homeCarouselIndex = (index + dots.length) % dots.length;
    track.style.transform = `translateX(-${homeCarouselIndex * 100}%)`;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === homeCarouselIndex));
}

// 자동 넘김. 마우스를 올리거나 키보드 초점이 들어오면 멈춘다(읽는 중에 넘어가면 성가시다).
// 사용자가 직접 넘기면 타이머를 처음부터 다시 센다 - 누른 직후 곧바로 넘어가지 않게.
let homeCarouselTimer = null;
const HOME_CAROUSEL_MS = 6000;
function startHomeCarouselAuto() {
    stopHomeCarouselAuto();
    const dots = document.querySelectorAll('#home-carousel-dots button');
    if (dots.length < 2) return;
    homeCarouselTimer = setInterval(() => goHomeCarousel(homeCarouselIndex + 1), HOME_CAROUSEL_MS);
}
function stopHomeCarouselAuto() {
    if (homeCarouselTimer) { clearInterval(homeCarouselTimer); homeCarouselTimer = null; }
}
function initHomeCarousel() {
    const car = document.querySelector('.home-carousel');
    if (!car) return;
    renderHomePreviewPanes();
    car.addEventListener('mouseenter', stopHomeCarouselAuto);
    car.addEventListener('mouseleave', startHomeCarouselAuto);
    car.addEventListener('focusin', stopHomeCarouselAuto);
    car.addEventListener('focusout', startHomeCarouselAuto);
    // 다른 탭을 보고 있을 때는 돌리지 않는다.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopHomeCarouselAuto(); else startHomeCarouselAuto();
    });
    startHomeCarouselAuto();
}
function moveHomeCarousel(direction) {
    goHomeCarousel(homeCarouselIndex + direction);
    if (homeCarouselTimer) startHomeCarouselAuto();   // 누른 직후 바로 또 넘어가지 않게 다시 센다
}

function renderHeroMatchPreview(target) {
    const box = target || document.querySelector('.home-carousel-preview[data-preview="0"]');
    if (!box) return;
    const match = SiteData.matches[0];
    if (!match) { box.innerHTML = '<div class="home-preview-label">LATEST MATCH</div><div class="home-preview-loading">경기 기록이 없습니다.</div>'; return; }
    const result = match['최종 결과'] || match['최근 결과'] || '-';
    const resultClass = result === '승' ? 'win' : result === '패' ? 'lose' : 'draw';
    box.innerHTML = `<div class="home-preview-label">LATEST MATCH</div><div class="home-preview-teams"><b>캄몬스타즈</b><span class="home-preview-result ${resultClass}">${escapeHTML(result)}</span><b>${escapeHTML(match['상대팀'] || '-')}</b></div><div class="home-preview-meta"><span>${escapeHTML(match['형식'] || '-')}</span><span>${escapeHTML(match['세트 결과'] || '-')}</span><time>${escapeHTML(shortMatchDate(match['날짜']))}</time></div>`;
}

// [리디자인] 방송중 카드도 멤버 카드와 같은 규칙 - 왼쪽 3px 엣지에 종족 색.
function liveRaceEdgeClass(m) {
    const letter = raceShortLabel(m['종족'] || '');
    return ['T', 'Z', 'P'].includes(letter) ? ` edge-${letter}` : '';
}

function liveCardHtml({ member: m, live }) {
    const { broad, broadStart } = live;
    const soopId = m['SOOP ID'];
    const viewerText = broad.current_sum_viewer != null ? broad.current_sum_viewer.toLocaleString('ko-KR') + '명' : '-';
    const elapsedText = formatLiveElapsed(broadStart) || '-';
    // 아바타 링 색: 여자는 기존 그대로(빨강 계열 그라디언트), 남자만 파란 원테두리로.
    const avatarRingClass = m['성별'] === '남자' ? 'live-card-avatar-ring live-card-avatar-ring--male' : 'live-card-avatar-ring';

    return `
            <a class="live-broadcast-card${liveRaceEdgeClass(m)}" href="https://play.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
                <div class="live-thumb-wrap">
                    <img class="live-thumb" src="https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broad.broad_no)}" alt="방송 화면" onerror="this.style.display='none';">
                    <div class="live-thumb-overlay">
                        <span>${escapeHTML(viewerText)}</span><span>${escapeHTML(elapsedText)}</span>
                    </div>
                </div>
                <div class="live-card-body">
                    <span class="${avatarRingClass}">${avatarHtml(soopId, 'live-card-avatar')}</span>
                    <span class="live-card-name">${escapeHTML(m['이름'])}</span>
                    <div class="live-card-title">${escapeHTML(broad.broad_title || '')}</div>
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
    safeInit('홈 캐러셀', initHomeCarousel);
    safeInit('방송중 카드', renderLiveBroadcasts);
    safeInit('최근 공지', renderLatestNotices);
});
