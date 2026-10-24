/**
 * 홈 페이지: 넘기는 히어로 + 기념일 + 방송 중 카드 + 최근 공지. 로드 순서: core.js → api.js → soop.js → 이 파일
 */

// /?/records&view=solo 꼴 공유 링크를 실제 페이지 주소(records/?view=solo)로 보낸다.
(function (l) {
    if (l.search[1] !== '/') return;
    var decoded = l.search
        .slice(1)
        .split('&')
        .map(function (s) {
            return s.replace(/~and~/g, '&');
        })
        .join('?');
    var path = decoded.slice(1),
        q = path.indexOf('?');
    var page = (q === -1 ? path : path.slice(0, q)).replace(/\/+$/, '');
    l.replace(l.pathname + (page ? page + '/' : '') + (q === -1 ? '' : path.slice(q)) + l.hash);
})(window.location);

// <base>가 사이트 루트라 상대 경로가 GitHub Pages(/staruniv/)와 루트 배포 양쪽에서 맞는다.
function newsPageHref(memberName) {
    const qs = new URLSearchParams({ view: 'news' });
    if (memberName) qs.set('member', memberName);
    return `members/?${qs.toString()}`;
}

let homeCarouselIndex = 0;

// 안의 줄들은 읽기 전용이라 칸 전체를 투명한 링크 하나로 덮는다(영상 장은 재생 아이콘이 대신한다).
function homePreviewLinkHtml(href, label) {
    return `<a class="home-preview-link" href="${href}" aria-label="${escapeHTML(label)}"></a>`;
}

// SiteData는 이미 받아 둔 값을 재사용한다.
function renderHomeRecordsPreview(box) {
    const rows = [
        // 이름을 바꿔 다시 들어오면 멤버 행이 둘이라 SOOP ID로 센다
        ['누적 인원', new Set((SiteData.members || []).map(m => m['SOOP ID'] || m['이름'])).size, '명'],
        ['누적 매치', Number(SiteData.matchCount || 0), '경기'],
        ['누적 세트', Number(SiteData.roundCount || 0), '세트'],
    ];
    box.innerHTML =
        '<div class="home-preview-label">RECORDS</div>' +
        rows
            .map(
                ([label, count, unit]) =>
                    `<div class="home-preview-row"><span>${label}</span><b>${formatNum(count)}${unit}</b></div>`
            )
            .join('') +
        homePreviewLinkHtml('records/', '전적 보기');
}

function renderHomeVideoPreview(box) {
    box.innerHTML =
        '<a class="home-video-preview" href="video/" aria-label="캄몬플레이 영상 보기"><span class="home-video-play" aria-hidden="true"></span></a>';
}

// 오늘 일정은 명단·메뉴 설정이 필요 없어 bootPage prefetch에서 먼저 받아 둔다(한 번만 쓴다)
let todaySchedulePrefetch = null;
function prefetchTodaySchedule() {
    const date = todayStr();
    todaySchedulePrefetch = { date, request: Api.scheduleOn(date) };
    todaySchedulePrefetch.request.catch(() => {}); // 실패는 renderTodaySchedulePreview가 처리한다
}

async function renderTodaySchedulePreview(box) {
    if (!box) return;
    box.innerHTML =
        '<div class="home-preview-label">TODAY SCHEDULE</div><div class="home-preview-loading">오늘 일정을 불러오는 중</div>';
    try {
        const today = todayStr();
        const prefetched =
            todaySchedulePrefetch && todaySchedulePrefetch.date === today && todaySchedulePrefetch.request;
        todaySchedulePrefetch = null;
        const events = ((await (prefetched || Api.scheduleOn(today))) || []).map(r => ({
            startDate: r.start_date,
            endDate: r.end_date || r.start_date,
            time: r.event_time || '',
            person: r.person || '',
            title: r.title || '',
        }));
        const todayEvents = events.filter(
            ev => ev && ev.startDate && today >= ev.startDate && today <= (ev.endDate || ev.startDate)
        );
        todayEvents.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
        box.innerHTML =
            '<div class="home-preview-label">TODAY SCHEDULE</div>' +
            (todayEvents.length
                ? todayEvents
                      .slice(0, 4)
                      .map(
                          ev =>
                              `<div class="home-preview-row"><span>${escapeHTML(ev.time || '')}</span><b>${escapeHTML(ev.person || ev.title || '-')}</b><span>${escapeHTML(ev.title)}</span></div>`
                      )
                      .join('')
                : '<div class="home-preview-loading">오늘 등록된 일정이 없습니다</div>') +
            homePreviewLinkHtml('schedule/', '일정 보기');
    } catch (e) {
        box.innerHTML =
            '<div class="home-preview-label">TODAY SCHEDULE</div><div class="home-preview-loading">오늘 일정을 불러오지 못했습니다</div>';
    }
}

// 미리보기 칸은 장 안에 들어 있어야 트랙이 밀릴 때 글과 같이 움직인다. 처음에 전부 채운다.
function renderHomePreviewPanes() {
    document.querySelectorAll('.home-carousel-preview[data-preview]').forEach(box => {
        const index = Number(box.dataset.preview);
        if (index === 0) {
            renderTodaySchedulePreview(box);
            return;
        }
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
    // 보이지 않는 장의 링크에 Tab으로 들어가면 브라우저가 히어로 상자를 옆으로 스크롤해 장이 틀어진다.
    track.querySelectorAll('.home-carousel-slide').forEach((slide, i) => {
        slide.inert = i !== homeCarouselIndex;
    });
    playHomeBrandMedia();
}

// 배경 영상(첫 장 얼굴 띠, 기념일 장 대표 영상)은 보이는 장에서만 돈다. '동작 줄이기' 설정이면 멈춘 그림만 둔다.
function playHomeBrandMedia() {
    const still = document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll(':is(.home-brand-media, .home-anniv-media) video').forEach(video => {
        const off = video.closest('.home-carousel-slide').inert || !video.matches('.is-brand video, .active');
        if (still || off) video.pause();
        else video.play()?.catch(() => {});
    });
}

// 자동 넘김. 마우스가 올라가 있거나 초점이 안에 있으면 멈춘다.
// mouseenter가 없을 수 있어(열 때 이미 마우스가 위에 있음) 다시 시작할 때마다 상태를 직접 확인한다.
// 터치 화면은 누른 뒤에도 :hover가 남아 마우스가 있는 화면에서만 본다.
// 얼굴 띠 장은 처음 온 사람이 다 볼 수 있게 길게 머문다. '동작 줄이기'면 자동으로 넘기지 않는다.
let homeCarouselTimer = null;
const HOME_CAROUSEL_FIRST_MS = 12000;
const HOME_CAROUSEL_MS = 8000;
function homeCarouselHeld(car) {
    return (
        (window.matchMedia('(hover: hover)').matches && car.matches(':hover')) ||
        Boolean(car.querySelector(':focus-visible'))
    );
}
function startHomeCarouselAuto() {
    stopHomeCarouselAuto();
    const car = document.querySelector('.home-carousel');
    const dots = document.querySelectorAll('#home-carousel-dots button');
    if (!car || dots.length < 2 || document.hidden || homeCarouselHeld(car)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    homeCarouselTimer = setTimeout(
        () => {
            goHomeCarousel(homeCarouselIndex + 1);
            startHomeCarouselAuto();
        },
        car.querySelectorAll('.home-carousel-slide')[homeCarouselIndex]?.matches('.is-brand')
            ? HOME_CAROUSEL_FIRST_MS
            : HOME_CAROUSEL_MS
    );
}
function stopHomeCarouselAuto() {
    if (homeCarouselTimer) {
        clearTimeout(homeCarouselTimer);
        homeCarouselTimer = null;
    }
}

function initHomeCarouselSwipe(car) {
    let gesture = null;
    let suppressClickUntil = 0;
    car.addEventListener(
        'touchstart',
        event => {
            if (!window.matchMedia('(max-width: 767.98px)').matches) return;
            stopHomeCarouselAuto();
            suppressClickUntil = 0;
            if (event.touches.length !== 1) {
                gesture = null;
                return;
            }
            const touch = event.touches[0];
            gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null };
        },
        { passive: true }
    );
    car.addEventListener(
        'touchmove',
        event => {
            if (!gesture) return;
            if (event.touches.length !== 1) {
                gesture = null;
                return;
            }
            const touch = event.touches[0];
            const dx = Math.abs(touch.clientX - gesture.x);
            const dy = Math.abs(touch.clientY - gesture.y);
            if (!gesture.axis && Math.max(dx, dy) >= 12) {
                gesture.axis = dx > dy ? 'horizontal' : 'vertical';
            }
            // 세로 스크롤과 확대는 브라우저에 맡긴다.
            if (gesture.axis === 'horizontal' && event.cancelable) event.preventDefault();
        },
        { passive: false }
    );
    car.addEventListener(
        'touchend',
        event => {
            if (gesture) {
                const touch = Array.from(event.changedTouches).find(t => t.identifier === gesture.id);
                if (touch) {
                    const dx = touch.clientX - gesture.x;
                    const dy = touch.clientY - gesture.y;
                    if (gesture.axis !== 'vertical' && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
                        // 이동 거리와 상관없이 한 장만 넘긴다.
                        moveHomeCarousel(dx < 0 ? 1 : -1);
                        suppressClickUntil = Date.now() + 500;
                    }
                }
            }
            gesture = null;
            if (!event.touches.length) startHomeCarouselAuto();
        },
        { passive: true }
    );
    car.addEventListener(
        'touchcancel',
        () => {
            gesture = null;
            startHomeCarouselAuto();
        },
        { passive: true }
    );
    car.addEventListener(
        'click',
        event => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        },
        true
    );
}

function initHomeCarousel() {
    const car = document.querySelector('.home-carousel');
    if (!car) return;
    goHomeCarousel(homeCarouselIndex);
    // 찾기(Ctrl+F) 등으로 상자 자체가 스크롤되면 되돌린다(장 이동은 transform으로만 한다)
    car.addEventListener('scroll', () => {
        if (car.scrollLeft) car.scrollLeft = 0;
    });
    initHomeCarouselSwipe(car);
    car.addEventListener('mouseenter', stopHomeCarouselAuto);
    car.addEventListener('mouseleave', startHomeCarouselAuto);
    car.addEventListener('focusin', stopHomeCarouselAuto);
    // focusout 시점에는 아직 초점이 안에 있어 이동이 끝난 다음에 확인한다.
    car.addEventListener('focusout', () => setTimeout(startHomeCarouselAuto));
    document.addEventListener('visibilitychange', () => {
        startHomeCarouselAuto();
        playHomeBrandMedia();
    });
    startHomeCarouselAuto();
}
function moveHomeCarousel(direction) {
    goHomeCarousel(homeCarouselIndex + direction);
    if (homeCarouselTimer) startHomeCarouselAuto(); // 누른 직후 바로 또 넘어가지 않게
}

function liveCardHtml({ member: m, live }) {
    const { broad, broadStart } = live;
    const soopId = m['SOOP ID'];
    const viewerText = broad.current_sum_viewer != null ? formatNum(broad.current_sum_viewer) + '명' : '-';
    const elapsedText = formatLiveElapsed(broadStart) || '-';
    return `
            <a class="live-broadcast-card${raceEdgeClass(m['종족'])}" href="https://play.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
                <div class="live-thumb-wrap">
                    <img class="live-thumb" src="https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broad.broad_no)}" alt="방송 화면"${actOn('error', 'imgHide', ACT.el)}>
                    <div class="live-thumb-overlay">
                        <span>${escapeHTML(viewerText)}</span><span>${escapeHTML(elapsedText)}</span>
                    </div>
                </div>
                <div class="live-card-body">
                    <span class="live-card-avatar-ring">${avatarHtml(soopId, 'live-card-avatar')}</span>
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

    setState('loading', '방송 상태 확인 중');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.errors.has('members')) {
        setState('error', '멤버 정보를 불러오지 못해 방송 상태를 확인할 수 없습니다');
        return;
    }

    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        setState('empty', '현재 방송 중인 멤버가 없습니다');
        return;
    }

    const settled = await Promise.allSettled(
        activeMembers.map(m => getLiveRealtimeStatus(m['SOOP ID']).then(result => ({ member: m, ...result })))
    );
    const results = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    const successCount = results.filter(r => r.ok).length;
    const failedCount = activeMembers.length - successCount;
    // 같으면 멤버 순서, 시청자 수를 모르면 뒤로
    const viewers = r => Number(r.live.broad?.current_sum_viewer ?? -1);
    const liveList = results.filter(r => r.ok && r.live).sort((a, b) => viewers(b) - viewers(a));

    if (successCount === 0) {
        setState('error', '방송 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요');
        return;
    }
    if (liveList.length) {
        const note = failedCount ? `일부 멤버(${failedCount}명)의 방송 상태를 확인하지 못했습니다` : '';
        setState(failedCount ? 'partial' : 'live', note, liveList.map(liveCardHtml).join(''));
        return;
    }
    setState(
        failedCount ? 'partial' : 'empty',
        failedCount
            ? `확인된 방송은 없습니다. 일부 멤버(${failedCount}명)의 상태를 확인하지 못했습니다`
            : '현재 방송 중인 멤버가 없습니다'
    );
}

// 한 명이 몰아 쓴 글이 목록을 다 차지하지 않게 멤버당 3개까지
const HOME_NOTICES_PER_MEMBER = 3;
const HOME_NOTICES_SHOWN = 5;
const HOME_NOTICES_FETCH = 30;

// 모아 둔 표(member_posts)에서 최신 글 몇 개만 받아 고른다.
// 걸러서 5개가 안 찼는데 받은 수 = 요청 수라 뒤에 글이 더 있을 수 있으면 null을 돌려 멤버별 조회로 넘긴다.
// 받기는 명단을 기다리지 않고 prefetch에서 시작한다(한 번만 쓴다). 실패하면 null이라 멤버별 조회로 넘어간다.
let recentPostsPrefetch = null;
async function recentNoticesFromStore(activeMembers) {
    const rows = await (recentPostsPrefetch || fetchRecentStoredPosts(HOME_NOTICES_FETCH));
    recentPostsPrefetch = null;
    if (!rows) return null;
    const bySoop = new Map(activeMembers.map(m => [String(m['SOOP ID']).toLowerCase(), m]));
    const perMember = new Map();
    const picked = [];
    sortNewsByDateDesc(rows).forEach(({ soopId, post }) => {
        const m = bySoop.get(soopId);
        const n = perMember.get(soopId) || 0;
        if (!m || n >= HOME_NOTICES_PER_MEMBER) return;
        perMember.set(soopId, n + 1);
        picked.push({ member: m, post });
    });
    if (picked.length < HOME_NOTICES_SHOWN && rows.length >= HOME_NOTICES_FETCH) return null;
    return picked;
}

// 표를 못 읽을 때: 멤버마다 첫 페이지를 받아 섞는다.
async function recentNoticesPerMember(activeMembers) {
    const stored = await fetchStoredMemberPosts();
    const settled = await Promise.allSettled(
        activeMembers.map(async m => {
            const { posts } = await fetchMemberFeed(m['SOOP ID'], 1, stored);
            return posts.slice(0, HOME_NOTICES_PER_MEMBER).map(post => ({ member: m, post }));
        })
    );
    return sortNewsByDateDesc(settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value));
}

// 먼저 모아 둔 표에서, 안 되면 멤버별 조회로.
async function renderLatestNotices() {
    const container = document.getElementById('home-notice-list');
    if (!container) return;
    container.setAttribute('aria-busy', 'true');
    const noNoticeHtml = emptyStateHtml('최근 공지가 없습니다', 'clean-card');
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.errors.has('members')) {
        container.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못해 최근 공지를 확인할 수 없습니다', 'clean-card');
        container.setAttribute('aria-busy', 'false');
        return;
    }
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noNoticeHtml;
        container.setAttribute('aria-busy', 'false');
        return;
    }

    const latest = (await recentNoticesFromStore(activeMembers)) || (await recentNoticesPerMember(activeMembers));

    container.innerHTML = latest.length
        ? latest
              .slice(0, HOME_NOTICES_SHOWN)
              .map(({ member: m, post }) =>
                  homeNoticeCardHtml(noticeCardFields(m, post), { href: newsPageHref(m['이름']) })
              )
              .join('')
        : noNoticeHtml;
    container.setAttribute('aria-busy', 'false');
}

// ----- 기념일(생일·입단) -----
// 활동 멤버의 생일과 입단 100일 단위·주년. 오늘부터 7일 안의 것은 카드로, 오늘 것은 맨 앞 슬라이드로 띄운다.
// 입단 일수는 프로필과 같은 daysBetween(입단일이 1일째). 날짜는 보는 사람의 달력 날짜다.
const ANNIV_DAYS = 7;
const ANNIV_SWAP_MS = 4000;

function annivDate(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// 그해의 같은 달·일. 2월 29일은 평년에 2월 28일로 친다.
function sameDayIn(date, year) {
    const d = new Date(year, date.getMonth(), date.getDate());
    return d.getMonth() === date.getMonth() ? d : new Date(year, date.getMonth() + 1, 0);
}

function memberAnniversaries(today) {
    const out = [];
    activeMembersWithSoopId().forEach(m => {
        const birth = annivDate(m['생년월일']);
        const join = annivDate(m['입단일']);
        for (let i = 0; i < ANNIV_DAYS; i++) {
            const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
            const at = { m, i, date: todayStr(d) };
            if (birth && sameDayIn(birth, d.getFullYear()).getTime() === d.getTime())
                out.push({ ...at, kind: '생일', text: '' });
            if (!join || d <= join) continue;
            const years = d.getFullYear() - join.getFullYear();
            const days = daysBetween(m['입단일'], at.date);
            // 주년과 100일 단위가 같은 날이면 주년만
            if (sameDayIn(join, d.getFullYear()).getTime() === d.getTime())
                out.push({ ...at, kind: '입단', text: `${years}주년` });
            else if (days % 100 === 0) out.push({ ...at, kind: '입단', text: `${formatNum(days)}일` });
        }
    });
    return out.sort((a, b) => a.i - b.i || (a.kind === '생일' ? -1 : 1) - (b.kind === '생일' ? -1 : 1));
}

const annivProfileHref = m => `members/?profile=${encodeURIComponent(m['이름'])}`;
const annivLabel = e => (e.kind === '생일' ? '생일' : `입단 ${e.text}`);

function annivCardHtml(e) {
    const m = e.m;
    return `
        <a class="home-anniv-card${raceEdgeClass(m['종족'])}${e.i ? '' : ' is-today'}" href="${annivProfileHref(m)}">
            ${avatarHtml(m['SOOP ID'], 'home-anniv-avatar')}
            <span class="home-anniv-name">${m['종족'] ? raceBadgeHtml(m['종족']) : ''}<span class="home-anniv-name-text">${escapeHTML(m['이름'])}</span></span>
            <span class="home-anniv-dday">${e.i ? `D-${e.i}` : '오늘'}</span>
            <span class="home-anniv-what"><span class="tag-badge">${e.kind}</span>${escapeHTML(e.text)}</span>
            <span class="home-anniv-date">${dayLabel(e.date)}</span>
        </a>`;
}

// 첫 장처럼 주인공 대표 사진·영상을 배경에 깐다. 대표 사진이 없으면 남색 바탕만.
function annivMedia(people) {
    const box = document.createElement('div');
    box.className = 'home-anniv-media';
    box.setAttribute('aria-hidden', 'true');
    people.forEach(m => {
        const src = memberPhotoUrl(m);
        if (!src) return;
        const el = document.createElement(isVideoUrl(src) ? 'video' : 'img');
        if (el.tagName === 'VIDEO')
            Object.assign(el, { muted: true, loop: true, playsInline: true, preload: 'metadata' });
        else el.alt = '';
        el.src = src;
        el.classList.toggle('active', !box.children.length);
        box.append(el);
    });
    return box;
}

// 여러 명이면 장이 보이는 동안 번갈아 보인다
function swapAnnivMedia() {
    const slide = document.querySelector('.home-carousel-slide.is-anniv');
    if (!slide || slide.inert || document.hidden) return;
    const items = [...slide.querySelectorAll('.home-anniv-media > *')];
    if (items.length < 2) return;
    const on = items.findIndex(el => el.classList.contains('active'));
    items[on].classList.remove('active');
    items[(on + 1) % items.length].classList.add('active');
    playHomeBrandMedia();
}

// 오늘 기념일이 있으면 맨 앞에 한 장을 끼운다. 다른 장을 보고 있었으면 그 장에 머문다.
function addAnnivSlide(todays) {
    const track = document.getElementById('home-carousel-track');
    if (!track || !todays.length) return;
    const people = [...new Map(todays.map(e => [e.m['이름'], e.m])).values()];
    const names = people.map(m => m['이름']);
    const birthdays = todays.every(e => e.kind === '생일');
    const one = todays.length === 1 ? todays[0] : null;
    const title =
        birthdays && names.length <= 2
            ? `<i>${escapeHTML(names.join('·'))}</i> 생일`
            : one
              ? `<i>${escapeHTML(one.m['이름'])}</i> 입단 ${escapeHTML(one.text)}`
              : '오늘의 <i>기념일</i>';
    const subtitle =
        birthdays && names.length <= 2
            ? `오늘은 ${names.join('·')}의 생일이에요`
            : one
              ? `오늘은 ${one.m['이름']}의 입단 ${one.text}이에요`
              : todays.map(e => `${e.m['이름']} ${annivLabel(e)}`).join(' · ');
    const link =
        people.length === 1
            ? `<a href="${annivProfileHref(people[0])}">프로필 보기 <span class="i-arrow" aria-hidden="true"></span></a>`
            : '<a href="members/">멤버 보기 <span class="i-arrow" aria-hidden="true"></span></a>';
    const slide = document.createElement('article');
    slide.className = 'home-carousel-slide page-header is-anniv';
    slide.innerHTML = `
        <div class="home-anniv-confetti" aria-hidden="true">${'<i></i>'.repeat(18)}</div>
        <div class="page-header-main" data-label="${birthdays ? 'HAPPY BIRTHDAY' : 'ANNIVERSARY'}">
            <h2 class="page-header-title">${title}</h2>
            <p class="page-header-subtitle">${escapeHTML(subtitle)}</p>
        </div>
        <div class="home-hero-links">${link}</div>`;
    slide.prepend(annivMedia(people));
    // 색종이 자리·떨어지는 때를 조각마다 다르게
    slide.querySelectorAll('.home-anniv-confetti i').forEach((c, i) => {
        c.style.left = `${(i * 37) % 100}%`;
        c.style.animationDelay = `${-i * 0.37}s`;
    });
    // 보던 장에 그대로 머물도록 끼우는 동안은 미끄러지지 않게 한다
    track.style.transition = 'none';
    track.prepend(slide);
    document.getElementById('home-carousel-dots').innerHTML = [...track.children]
        .map(
            (_, i) =>
                `<button type="button" aria-label="${i + 1}번 안내"${act('goHomeCarousel', i)}${i ? '' : ' class="active"'}></button>`
        )
        .join('');
    if (homeCarouselIndex) homeCarouselIndex += 1;
    goHomeCarousel(homeCarouselIndex);
    void track.offsetWidth;
    track.style.transition = '';
    if (homeCarouselTimer) startHomeCarouselAuto();
    if (people.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        setInterval(swapAnnivMedia, ANNIV_SWAP_MS);
}

// 생년월일은 프로필 묶음에 있다. 명단만으로 다른 구역을 먼저 그리고, 못 받으면 기념일만 조용히 뺀다.
async function renderAnniversaries() {
    await loadSiteData(['profiles']);
    if (SiteDataLoad.errors.has('profiles')) return;
    const events = memberAnniversaries(annivDate(todayStr()));
    if (!events.length) return;
    document.getElementById('home-anniv-count').textContent = `${events.length}개`;
    document.getElementById('home-anniv-grid').innerHTML = events.map(annivCardHtml).join('');
    document.getElementById('home-anniv').hidden = false;
    addAnnivSlide(events.filter(e => !e.i));
}

// 넘기기·첫 장 영상은 데이터가 필요 없어 명단을 기다리지 않는다(기다리면 첫 화면이 1~2초 멈춘다).
safeInit('홈 캐러셀', initHomeCarousel);
bootPage(
    () => {
        safeInit('홈 미리보기', renderHomePreviewPanes);
        renderAnniversaries().catch(e => console.error('기념일 표시 실패:', e));
        safeInit('방송중 카드', renderLiveBroadcasts);
        safeInit('최근 공지', renderLatestNotices);
    },
    {
        prefetch: () => {
            prefetchTodaySchedule();
            recentPostsPrefetch = fetchRecentStoredPosts(HOME_NOTICES_FETCH);
            fetchLiveBroadcasts().catch(() => {});
            loadSiteData(['profiles']);
        },
    }
); // 명단을 기다리지 않고 받아 둔다
