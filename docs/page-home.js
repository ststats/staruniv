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

// 미리보기 칸을 통째로 누르면 그 페이지로 간다. 안의 줄들은 읽기 전용이라
// 투명한 링크 하나로 덮는 게 가장 간단하다(영상 장은 재생 아이콘이 그 역할을 한다).
function homePreviewLinkHtml(href, label) {
    return `<a class="home-preview-link" href="${href}" aria-label="${escapeHTML(label)}"></a>`;
}

async function fetchHomePreviewData(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`미리보기 데이터를 불러오지 못했습니다: ${path}`);
    return res.json();
}

// 캄몬스타즈 전적만 센다. 스타대학 전체 집계를 보여주려고 tier_members.json과
// h2h/index.json(125KB)을 따로 받던 것을 걷어냈다 - SiteData는 어차피 받아둔 것이라
// 홈이 추가로 받는 파일이 없어진다.
function renderHomeRecordsPreview(box) {
    const rows = [
        ['누적 인원', (SiteData.members || []).length, '명'],
        ['누적 매치', (SiteData.matches || []).length, '경기'],
        ['누적 세트', (SiteData.rounds || []).length, '세트'],
    ];
    box.innerHTML = '<div class="home-preview-label">RECORDS</div>'
        + rows.map(([label, count, unit]) =>
            `<div class="home-preview-row"><span>${label}</span><b>${count.toLocaleString('ko-KR')}${unit}</b></div>`).join('')
        + homePreviewLinkHtml('records/', '전적 보기');
}

function renderHomeVideoPreview(box) {
    box.innerHTML = '<a class="home-video-preview" href="video/" aria-label="캄몬플레이 영상 보기"><span class="home-video-play" aria-hidden="true"></span></a>';
}

async function renderTodaySchedulePreview(box) {
    if (!box) return;
    box.innerHTML = '<div class="home-preview-label">TODAY SCHEDULE</div><div class="home-preview-loading">오늘 일정을 불러오는 중...</div>';
    try {
        let events = [];
        const client = typeof publicSupabaseClient === 'function' ? publicSupabaseClient() : null;
        if (client) {
            const { data, error } = await client.from('calendar_events').select('start_date,end_date,event_time,person,description').order('source_order');
            if (error) throw error;
            events = (data || []).map(r => ({ startDate:r.start_date, endDate:r.end_date || r.start_date, time:r.event_time || '', person:r.person || '', desc:r.description || '' }));
        } else {
            const res = await fetch('data/calendar.json', { cache: 'no-cache' });
            const data = res.ok ? await res.json() : {};
            events = Array.isArray(data.events) ? data.events : [];
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayEvents = events.filter(ev => ev && ev.startDate && today >= ev.startDate && today <= (ev.endDate || ev.startDate));
        todayEvents.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
        box.innerHTML = '<div class="home-preview-label">TODAY SCHEDULE</div>' +
            (todayEvents.length
                ? todayEvents.slice(0, 4).map(ev => `<div class="home-preview-row"><span>${escapeHTML(ev.time || '')}</span><b>${escapeHTML(ev.person || ev.desc || '-')}</b><span class="home-preview-description">${escapeHTML(ev.desc || '')}</span></div>`).join('')
                : '<div class="home-preview-loading">오늘 등록된 일정이 없습니다.</div>')
            + homePreviewLinkHtml('schedule/', '일정 보기');
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
        if (index === 1) renderHomeRecordsPreview(box);
        if (index === 2) renderHomeVideoPreview(box);
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

function initHomeCarouselSwipe(car) {
    let gesture = null;
    let suppressClickUntil = 0;
    car.addEventListener('touchstart', event => {
        if (!window.matchMedia('(max-width: 767.98px)').matches) return;
        stopHomeCarouselAuto();
        suppressClickUntil = 0;
        if (event.touches.length !== 1) { gesture = null; return; }
        const touch = event.touches[0];
        gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null };
    }, { passive: true });
    car.addEventListener('touchmove', event => {
        if (!gesture) return;
        if (event.touches.length !== 1) { gesture = null; return; }
        const touch = event.touches[0];
        const dx = Math.abs(touch.clientX - gesture.x);
        const dy = Math.abs(touch.clientY - gesture.y);
        if (!gesture.axis && Math.max(dx, dy) >= 12) {
            gesture.axis = dx > dy ? 'horizontal' : 'vertical';
        }
        // 가로 제스처만 처리한다. 세로 스크롤과 확대 동작은 브라우저에 맡긴다.
        if (gesture.axis === 'horizontal' && event.cancelable) event.preventDefault();
    }, { passive: false });
    car.addEventListener('touchend', event => {
        if (gesture) {
            const touch = Array.from(event.changedTouches).find(t => t.identifier === gesture.id);
            if (touch) {
                const dx = touch.clientX - gesture.x;
                const dy = touch.clientY - gesture.y;
                if (gesture.axis !== 'vertical' && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
                    // 이동 거리에 관계없이 손을 뗄 때 딱 한 장만 넘긴다.
                    moveHomeCarousel(dx < 0 ? 1 : -1);
                    suppressClickUntil = Date.now() + 500;
                }
            }
        }
        gesture = null;
        if (!event.touches.length && !document.hidden) startHomeCarouselAuto();
    }, { passive: true });
    car.addEventListener('touchcancel', () => {
        gesture = null;
        if (!document.hidden) startHomeCarouselAuto();
    }, { passive: true });
    car.addEventListener('click', event => {
        if (Date.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
}

function initHomeCarousel() {
    const car = document.querySelector('.home-carousel');
    if (!car) return;
    renderHomePreviewPanes();
    initHomeCarouselSwipe(car);
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
    const state = document.getElementById('home-live-state');
    const stateText = document.getElementById('home-live-state-text');
    const grid = document.getElementById('home-live-grid');
    if (!container || !state || !stateText || !grid) return;

    const setState = (name, text, liveHtml) => {
        const hasLive = typeof liveHtml === 'string';
        container.dataset.state = name;
        container.setAttribute('aria-busy', name === 'loading' ? 'true' : 'false');
        stateText.textContent = text || '';
        state.hidden = hasLive && !text;
        grid.hidden = !hasLive;
        if (hasLive) grid.innerHTML = liveHtml;
        else if (grid.childElementCount) grid.replaceChildren();
    };

    setState('loading', '방송 상태 확인 중...');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.status === 'error') {
        setState('error', '멤버 정보를 불러오지 못해 방송 상태를 확인할 수 없습니다.');
        return;
    }

    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        setState('empty', '현재 방송 중인 멤버가 없습니다.');
        return;
    }

    const settled = await Promise.allSettled(
        activeMembers.map(m => getLiveRealtimeStatus(m['SOOP ID']).then(result => ({ member: m, ...result })))
    );
    const results = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    const successCount = results.filter(r => r.ok).length;
    const failedCount = activeMembers.length - successCount;
    const liveList = results.filter(r => r.ok && r.live);

    if (successCount === 0) {
        setState('error', '방송 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
    }
    if (liveList.length) {
        const note = failedCount ? `일부 멤버(${failedCount}명)의 방송 상태를 확인하지 못했습니다.` : '';
        setState(failedCount ? 'partial' : 'live', note, liveList.map(liveCardHtml).join(''));
        return;
    }
    setState(
        failedCount ? 'partial' : 'empty',
        failedCount
            ? `확인된 방송은 없습니다. 일부 멤버(${failedCount}명)의 상태를 확인하지 못했습니다.`
            : '현재 방송 중인 멤버가 없습니다.'
    );
}

// SOOP 채널 게시판 API를 브라우저에서 직접 fetch한다 (방송중 체크와 같은 방식).
// 공지만이 아니라 일반글도 같이 긁어와서(fetchMemberFeed는 공지+일반글을 합쳐 최신순 반환) 섞는다.
async function renderLatestNotices() {
    const container = document.getElementById('home-notice-list');
    if (!container) return;
    container.setAttribute('aria-busy', 'true');
    const noNoticeHtml = emptyStateHtml('최근 공지가 없습니다.', 'clean-card');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.status === 'error') {
        container.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못해 최근 공지를 확인할 수 없습니다.', 'clean-card');
        container.setAttribute('aria-busy', 'false');
        return;
    }
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noNoticeHtml;
        container.setAttribute('aria-busy', 'false');
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
    container.setAttribute('aria-busy', 'false');
}

bootPage(() => {
    safeInit('홈 캐러셀', initHomeCarousel);
    safeInit('방송중 카드', renderLiveBroadcasts);
    safeInit('최근 공지', renderLatestNotices);
});
