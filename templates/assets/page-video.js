/**
 * 영상 페이지: 팬채널(등록 채널 최신 영상) + 추천영상(어드민이 고름) + 멤버 다시보기(숲)·유튜브.
 * 로드 순서: core.js → api.js → media-lightbox.js → 이 파일
 * URL: /video/ (팬채널), /video/?view=pick (추천영상), /video/?view=replay|youtube&member=<멤버 이름> (멤버 영상), 채널 필터 ?ch=<채널 번호>
 * 영상은 ststat(GitHub Actions)가 Supabase에 갱신하고, 감춘 영상은 api_videos가 빼고 준다.
 * 추천영상·다시보기의 숲 VOD는 id 'soop:<번호>', kind 'soop'이며 숲 임베드 플레이어로 연다.
 */

const VIDEO_TABS = {
    fantube: ['tab-video-fantube', 'view-video-fantube'],
    pick: ['tab-video-pick', 'view-video-pick'],
    replay: ['tab-video-replay', 'view-video-replay'],
    youtube: ['tab-video-youtube', 'view-video-youtube'],
};
const VIDEO_PAGE_SIZE = 20;

const VideoState = {
    data: { channels: {}, videos: [], picks: [], top: [], shorts: [], total: 0 },
    channelKeys: [], // 등록 순서
    channel: '', // '' = 전체
    next: null,
    client: null,
    requestSeq: 0,
    loading: false,
    byId: new Map(),
    failed: false,
};

function videoFormatViews(n) {
    n = Number(n) || 0;
    const trim = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString();
    if (n >= 1e8) return `${trim(n / 1e8)}억회`;
    if (n >= 1e4) return `${trim(n / 1e4)}만회`;
    if (n >= 1e3) return `${trim(n / 1e3)}천회`;
    return `${n}회`;
}

// RSS 시각은 UTC라 끝에 Z를 붙여 읽는다.
function videoDate(published) {
    const d = new Date(String(published || '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(published || '') ? '' : 'Z'));
    return isNaN(d) ? null : d;
}

function videoAgo(published) {
    const d = videoDate(published);
    if (!d) return '';
    const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}분 전`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
    const days = Math.floor(sec / 86400);
    if (days < 7) return `${days}일 전`;
    if (days < 30) return `${Math.floor(days / 7)}주 전`;
    if (days < 365) return `${Math.floor(days / 30)}개월 전`;
    return `${Math.floor(days / 365)}년 전`;
}

// 1:02:03 / 4:05
function videoDuration(sec) {
    sec = Math.floor(Number(sec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// 다시보기는 언제 방송인지가 중요해 한국 시간으로 날짜·요일·시각을 적는다. 올해가 아니면 연도도.
function videoBroadcastTime(published) {
    const kst = formatKstDateTime(published, true); // YYYY-MM-DD HH:MM:SS KST
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(kst)) return '';
    const year = kst.slice(0, 4) === todayStr().slice(0, 4) ? '' : `${kst.slice(0, 4)}.`;
    const weekday = WEEKDAYS[new Date(`${kst.slice(0, 10)}T00:00:00`).getDay()];
    return `${year}${kst.slice(5, 7)}.${kst.slice(8, 10)}(${weekday}) ${kst.slice(11, 16)}`;
}

function videoChannel(key) {
    return (VideoState.data.channels || {})[key] || {};
}

function videoChannelName(ch) {
    return ch.name || ch.title || '채널';
}

// 데이터에 이상한 주소가 섞여도 따라가지 않게 유튜브·숲 이미지 서버만 쓴다.
// 숲 VOD 썸네일이 없으면 빈 값을 주고 카드가 글자 썸네일로 대신한다.
function videoThumb(v) {
    const t = String(v.thumb || '');
    if (videoIsSoop(v)) return /^https:\/\/[\w.-]+\.(afreecatv\.com|sooplive\.co\.kr|sooplive\.com)\//.test(t) ? t : '';
    return /^https:\/\/i\d?\.ytimg\.com\//.test(t) ? t : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
}

// kind가 없는 항목은 유튜브다.
function videoIsSoop(v) {
    return v.kind === 'soop' || /^soop:/.test(String(v.id || ''));
}

const soopVodNo = v => String(v.id || '').replace(/^soop:/, '');

function videoChannelAvatar(ch, cls) {
    const t = String(ch.thumb || '');
    const ok = /^https:\/\/(yt\d\.ggpht\.com|yt\d\.googleusercontent\.com|i\d?\.ytimg\.com)\//.test(t);
    const name1 = videoChannelName(ch).slice(0, 1);
    const initial = escapeHTML(name1);
    return ok
        ? `<img class="${cls}" src="${escapeHTML(t)}" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, cls, name1)}>`
        : `<span class="${cls}">${initial}</span>`;
}

// ----- 카드 -----
function videoCardHtml(v, opts) {
    opts = opts || {};
    const ch = videoChannel(v.channel);
    const channelName = v.channel ? videoChannelName(ch) : v.author || (videoIsSoop(v) ? '숲 VOD' : '');
    // 줄을 나눠 쓰면 카드가 길어져 한 줄에 점으로 잇는다.
    // 추천영상은 추가한 날짜를 보여주지 않는다(정렬에만 쓴다).
    const meta = [
        channelName,
        v.views ? `조회수 ${videoFormatViews(v.views)}` : '',
        opts.pick ? '' : v.dateText || videoAgo(v.published),
    ]
        .filter(Boolean)
        .map(escapeHTML)
        .join('<span class="video-meta-dot">·</span>');
    const rank = opts.rank ? `<span class="video-rank">${opts.rank}</span>` : '';
    const avatar = v.channel
        ? videoChannelAvatar(ch, 'video-card-avatar')
        : v.soopId
          ? avatarHtml(v.soopId, 'video-card-avatar')
          : '';
    return `
        <article class="video-card${opts.top ? ' is-top' : ''}${videoIsSoop(v) ? ' is-soop' : ''}${VideoState.client && v.hidden ? ' admin-config-hidden' : ''}" data-video-id="${escapeHTML(v.id)}" data-video-pick="${opts.pick ? '1' : '0'}">
            <button type="button" class="video-thumb"${act('videoPlay', v.id)} aria-label="${escapeHTML(v.title)} 재생">
                ${videoHiResThumbHtml(v, 'hq720.jpg')}
                ${rank}
                ${v.duration ? `<span class="video-badge">${videoDuration(v.duration)}</span>` : v.short ? '<span class="video-badge">SHORTS</span>' : ''}
                <span class="video-play" aria-hidden="true"></span>
            </button>
            <div class="video-card-body">
                ${avatar}
                <div class="video-card-text">
                    <button type="button" class="video-card-title"${act('videoPlay', v.id)}>${escapeHTML(v.title)}</button>
                    ${meta ? `<div class="video-card-meta">${meta}</div>` : ''}
                    ${opts.pick && v.note ? `<p class="video-card-note">${escapeHTML(v.note)}</p>` : ''}
                </div>
            </div>
            ${!opts.member && typeof window.videoCardAdminExtra === 'function' ? window.videoCardAdminExtra(v, opts) : ''}
        </article>`;
}

function videoShortHtml(v) {
    return `
        <button type="button" class="video-short"${act('videoPlay', v.id)} aria-label="${escapeHTML(v.title)} 재생">
            <span class="video-short-thumb">${videoHiResThumbHtml(v, 'oardefault.jpg')}</span>
            <span class="video-short-title">${escapeHTML(v.title)}</span>
            <span class="video-short-meta">${v.views ? `조회수 ${videoFormatViews(v.views)}` : escapeHTML(videoChannelName(videoChannel(v.channel)))}</span>
        </button>`;
}

function videoThumbInnerHtml(v) {
    const t = videoThumb(v);
    return t
        ? `<img src="${escapeHTML(t)}" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, 'media-thumb-blank', 'SOOP')}>`
        : '<span class="media-thumb-blank">SOOP</span>';
}

// hqdefault(480×360)는 큰 칸에서 흐릿해 더 큰 썸네일을 쓰고, 없으면(120px 이하 회색 그림이나 오류) 되돌린다.
// 카드(16:9): hq720. 쇼츠(9:16): oardefault - hqdefault는 가로 그림 안에 세로 화면이 있어 자르면 흐려진다.
function videoHiResThumbHtml(v, file) {
    if (videoIsSoop(v) || !/^[\w-]{6,}$/.test(String(v.id || ''))) return videoThumbInnerHtml(v);
    const fallback = videoThumb(v);
    return (
        `<img src="https://i.ytimg.com/vi/${v.id}/${file}" alt="" loading="lazy"` +
        `${actOn('error', 'imgSrc', ACT.el, fallback)} data-load="videoThumbCheck">`
    );
}
function videoThumbCheck(img, fallback) {
    if (img.naturalWidth && img.naturalWidth <= 120 && img.src !== fallback) img.src = fallback;
}

// ----- 쇼츠 선반 넘김(마우스용) -----
// PC에서는 가로 스크롤을 밀 방법이 없어 버튼으로 한 화면씩 넘긴다.
function videoShortsShelf() {
    return document.getElementById('video-shorts-shelf');
}

function videoShortsScroll(dir) {
    const shelf = videoShortsShelf();
    if (!shelf) return;
    shelf.scrollBy({ left: dir * Math.round(shelf.clientWidth * 0.9), behavior: 'smooth' });
}

function updateShortsNav() {
    const shelf = videoShortsShelf();
    const nav = document.getElementById('video-shorts-nav');
    if (!shelf || !nav) return;
    const max = shelf.scrollWidth - shelf.clientWidth;
    nav.hidden = max <= 1;
    const [prev, next] = nav.querySelectorAll('.shelf-nav-btn');
    if (prev) prev.disabled = shelf.scrollLeft <= 1;
    if (next) next.disabled = shelf.scrollLeft >= max - 1;
}

function bindShortsNav() {
    const shelf = videoShortsShelf();
    if (!shelf || shelf._shortsNavBound) return;
    shelf._shortsNavBound = true;
    shelf.addEventListener('scroll', updateShortsNav, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateShortsNav).observe(shelf);
    else window.addEventListener('resize', updateShortsNav);
}

const VIDEO_LOAD_FAILED = '영상 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요';
function videoEmptyHtml(text) {
    return emptyStateHtml(text, 'is-boxed video-empty');
}

// 더 보기 단추(팬채널·멤버 영상). 불러오는 동안 disabled로 두면 초점이 빠지므로 aria-disabled만 걸고 클릭은 각 ShowMore가 거른다.
function renderVideoMore(wrapId, s) {
    const wrap = document.getElementById(wrapId);
    const button = wrap.querySelector('button');
    wrap.hidden = !s.next;
    button.setAttribute('aria-disabled', String(s.loading));
    button.firstChild.textContent = s.failed ? '불러오기 실패 · 재시도 ' : '더 보기 ';
}

function videoPlay(id) {
    const v =
        VideoState.byId.get(String(id)) ||
        Object.values(MEMBER_VIDEOS)
            .map(t => t.byId.get(String(id)))
            .find(Boolean);
    if (!v) return;
    const ch = v.channel ? videoChannelName(videoChannel(v.channel)) : v.author || '';
    const caption = ch ? `${ch} · ${v.title}` : v.title;
    if (videoIsSoop(v)) {
        mediaLightboxOpen({ caption, soopVodNo: soopVodNo(v) });
        return;
    }
    mediaLightboxOpen({ caption, youtubeId: v.id, vertical: !!v.short });
}

// ----- 팬채널 -----
// 채널 칸은 목록·개수가 바뀔 때만 다시 그린다(누를 때마다 다시 그리면 키보드 초점이 빠진다)
let videoChannelBarHtml = '';
function renderVideoChannels() {
    const keys = VideoState.channelKeys;
    const count = keys.reduce((n, key) => n + Number(videoChannel(key).count || 0), 0);
    const allHtml = avatarSelectAllItemHtml('video-ch-all', act('selectVideoChannel', ''), `${count}`);
    const itemsHtml = keys
        .map(
            (
                k,
                i
            ) => `<div class="avatar-select-item" id="video-ch-${i}" role="button" tabindex="0"${act('selectVideoChannel', k)}>
                ${videoChannelAvatar(videoChannel(k), 'video-bar-avatar')}
                <span class="avatar-select-name">${escapeHTML(videoChannelName(videoChannel(k)))}</span>
                <span class="avatar-select-tier">${videoChannel(k).count || 0}</span>
            </div>`
        )
        .join('');
    if (allHtml + itemsHtml !== videoChannelBarHtml) {
        videoChannelBarHtml = allHtml + itemsHtml;
        renderAvatarBar('video-channel-row', allHtml, itemsHtml);
    }
    const bar = document.getElementById('video-channel-row').closest('.avatar-bar');
    if (bar) bar.hidden = keys.length < 2; // 채널이 하나뿐이면 거를 게 없다
    const idx = keys.indexOf(VideoState.channel);
    setActiveAvatarItem('video-channel-row', document.getElementById(idx >= 0 ? `video-ch-${idx}` : 'video-ch-all'));
}

function renderFantube(appendRows = null) {
    const { videos: shown, shorts, top, total } = VideoState.data;
    if (!appendRows) {
        const topWrap = document.getElementById('video-top-wrap');
        topWrap.hidden = !top.length;
        document.getElementById('video-top-grid').innerHTML = top
            .map((v, i) => videoCardHtml(v, { rank: i + 1, top: true }))
            .join('');

        const shortsWrap = document.getElementById('video-shorts-wrap');
        shortsWrap.hidden = !shorts.length;
        document.getElementById('video-shorts-shelf').innerHTML = shorts.map(videoShortHtml).join('');
        document.getElementById('video-shorts-count').textContent = shorts.length ? `${shorts.length}개` : '';
    }

    const grid = document.getElementById('video-latest-grid');
    if (appendRows) grid.insertAdjacentHTML('beforeend', appendRows.map(v => videoCardHtml(v)).join(''));
    else
        grid.innerHTML = shown.length
            ? shown.map(v => videoCardHtml(v)).join('')
            : videoEmptyHtml(
                  VideoState.loading
                      ? '불러오는 중'
                      : VideoState.failed
                        ? VIDEO_LOAD_FAILED
                        : VideoState.channelKeys.length
                          ? '아직 불러온 영상이 없습니다'
                          : '등록된 채널이 없습니다'
              );
    document.getElementById('video-loading')?.remove();
    document.getElementById('video-latest-wrap').hidden = false;
    document.getElementById('video-latest-count').textContent = total ? `${total}개` : '';
    renderVideoMore('video-more-wrap', VideoState);

    const titles = [...document.querySelectorAll('#view-video-fantube .section-title')];
    const first = titles.find(t => !t.closest('[hidden]'));
    titles.forEach(t => t.classList.toggle('section-title-spaced', t !== first));

    const shelf = document.getElementById('video-shorts-shelf');
    if (shelf && shelf._edgeFadeUpdate) shelf._edgeFadeUpdate();
    updateShortsNav();
}

function selectVideoChannel(key) {
    VideoState.channel = VideoState.channelKeys.includes(key) ? key : '';
    updateVideoUrl();
    return loadVideoData();
}

function videoShowMore() {
    if (VideoState.loading || !VideoState.next) return;
    return loadVideoData(VideoState.client, true);
}

// ----- 추천영상 -----
// 분류가 같은 영상끼리 제목줄 하나로 묶고, 순서는 어드민 목록 순서를 따른다.
function renderPicks() {
    const picks = VideoState.data.picks || [];
    const box = document.getElementById('video-pick-grid');
    if (!picks.length) {
        box.innerHTML = videoEmptyHtml(VideoState.failed ? VIDEO_LOAD_FAILED : '추천영상이 아직 없습니다');
        return;
    }
    const groups = []; // 처음 나온 순서대로
    picks.forEach(v => {
        const key = String(v.group || '').trim();
        const last = groups[groups.length - 1];
        if (last && last[0] === key) last[1].push(v);
        else groups.push([key, [v]]);
    });
    box.innerHTML = groups
        .map(([name, list], i) => {
            // 분류 뒤에 오는 무분류는 앞 묶음에 딸려 보이므로 '기타'를 붙인다.
            const label = name || (i ? '기타' : '');
            const labelEn = String((list.find(v => String(v.groupEn || '').trim()) || {}).groupEn || '').trim();
            const enAttr = labelEn ? ` data-en="${escapeHTML(labelEn)}"` : '';
            return `
        ${label ? `<div class="section-title${i ? ' section-title-spaced' : ''} video-pick-title"${enAttr}><span class="section-title-label">${escapeHTML(label)}</span><span class="title-count">${list.length}개</span></div>` : ''}
        <div class="video-grid">${list.map(v => videoCardHtml(v, { pick: true })).join('')}</div>`;
        })
        .join('');
}

// ----- 멤버 영상(다시보기·유튜브) -----
// 멤버마다 최근 20개만 모은다(ststat). 더 지난 것은 방송국·채널로 보낸다. 탭을 처음 열 때 명단과 목록을 받는다.
const MEMBER_VIDEOS = {
    replay: {
        kind: 'soop',
        label: '다시보기',
        parts: ['members'],
        members: () => activeMembersWithSoopId(),
        moreUrl: m => `https://www.sooplive.co.kr/station/${encodeURIComponent(m['SOOP ID'])}/vod/review`,
    },
    youtube: {
        kind: 'youtube',
        label: '유튜브',
        // 유튜브 주소는 프로필 쪽에 있다
        parts: ['members', 'profiles'],
        members: () => activeMembersWithSoopId().filter(m => memberYoutubeUrl(m['YouTube'])),
        moreUrl: m => memberYoutubeUrl(m['YouTube']),
    },
};
Object.values(MEMBER_VIDEOS).forEach(t =>
    Object.assign(t, {
        member: '',
        rows: [],
        byId: new Map(),
        next: null,
        total: 0,
        allTotal: null, // 전체 칸에 적는 수. 멤버를 고르지 않은 응답에서만 안다
        loading: false,
        failed: false,
        started: false,
        barRendered: false,
        seq: 0,
    })
);

const memberVideoDataFailed = t => t.parts.some(part => SiteDataLoad.errors.has(part));

function memberVideoTarget(tab) {
    return MEMBER_VIDEOS[tab].members().find(m => m['이름'] === MEMBER_VIDEOS[tab].member) || null;
}

// bySoopId: 응답마다 한 번 만든 소문자 SOOP ID → 멤버
function memberVideoRow(tab, r, bySoopId) {
    const m = bySoopId.get(String(r.soop_id || '').toLowerCase());
    const soop = MEMBER_VIDEOS[tab].kind === 'soop';
    return {
        id: soop ? `soop:${r.video_id}` : String(r.video_id),
        kind: soop ? 'soop' : 'youtube',
        title: r.title || '',
        thumb: r.thumb,
        views: Number(r.views) || 0,
        duration: Number(r.duration_sec) || 0,
        short: !!r.short,
        published: r.published || '',
        dateText: soop ? videoBroadcastTime(r.published) : '',
        author: m ? m['이름'] : r.soop_id,
        soopId: r.soop_id,
    };
}

// 바는 탭마다 한 번만 그리고(초점·방송 표시 유지) 그 뒤로는 고른 칸만 바꾼다.
// 칸 오른쪽은 팬채널처럼 영상 수 자리라, 수처럼 읽히는 멤버 티어는 지운다(멤버별 영상 수는 받지 않는다).
function renderMemberVideoBar(tab) {
    const t = MEMBER_VIDEOS[tab];
    const listId = `${tab}-member-row`;
    if (!t.barRendered) {
        renderAvatarBar(
            listId,
            avatarSelectAllItemHtml(`${tab}-m-all`, act('selectMemberVideos', tab, ''), ''),
            t
                .members()
                .map(m =>
                    avatarSelectItemHtml(`${tab}-m-`, m['이름'], m['SOOP ID'], ['selectMemberVideos', tab], m, '')
                )
                .join('')
        );
        // 명단을 못 받았으면 다음에 다시 그린다
        t.barRendered = !memberVideoDataFailed(t);
        safeInit('사이드바 방송 상태', refreshSidebarLiveIndicators);
    }
    const m = memberVideoTarget(tab);
    setActiveAvatarItem(listId, document.getElementById(m ? `${tab}-m-${m['이름']}` : `${tab}-m-all`));
}

function renderMemberVideos(tab, appendRows = null) {
    const t = MEMBER_VIDEOS[tab];
    const m = memberVideoTarget(tab);
    // 명단을 받기 전에는 고른 멤버를 몰라 '전체'라고 적지 않는다
    document.getElementById(`${tab}-title`).textContent = m
        ? `${m['이름']}의 ${t.label}`
        : t.member
          ? t.label
          : `전체 ${t.label}`;
    // 한 멤버는 모아 둔 최근 것만 있어 전부인 것처럼 읽히지 않게 한다
    document.getElementById(`${tab}-count`).textContent = t.total ? `${m ? '최근 ' : ''}${t.total}개` : '';
    const allCount = document.querySelector(`#${tab}-m-all .avatar-select-tier`);
    if (allCount) allCount.textContent = t.allTotal === null ? '' : `${t.allTotal}`;
    const grid = document.getElementById(`${tab}-grid`);
    if (appendRows)
        grid.insertAdjacentHTML('beforeend', appendRows.map(v => videoCardHtml(v, { member: true })).join(''));
    else
        grid.innerHTML = t.rows.length
            ? t.rows.map(v => videoCardHtml(v, { member: true })).join('')
            : videoEmptyHtml(
                  t.loading
                      ? '불러오는 중'
                      : t.failed
                        ? VIDEO_LOAD_FAILED
                        : memberVideoDataFailed(t)
                          ? `멤버 정보를 불러오지 못해 ${t.label}를 확인할 수 없습니다`
                          : `아직 불러온 ${t.label}가 없습니다`
              );
    renderVideoMore(`${tab}-next-wrap`, t);
    document.getElementById(`${tab}-more-wrap`).hidden = !m || t.loading;
    if (m) document.getElementById(`${tab}-more-link`).href = t.moreUrl(m);
}

async function loadMemberVideos(tab, more = false) {
    const t = MEMBER_VIDEOS[tab];
    const seq = ++t.seq;
    const cursor = more ? t.next : null;
    let added = [];
    Object.assign(t, { loading: true, failed: false });
    if (!more) {
        Object.assign(t, { rows: [], next: null, total: 0 });
        renderMemberVideos(tab);
    } else renderVideoMore(`${tab}-next-wrap`, t);
    try {
        await loadSiteData(t.parts);
        if (seq !== t.seq) return;
        if (t.member && !memberVideoTarget(tab)) {
            t.member = '';
            replaceVideoUrl();
        }
        if (!more) renderMemberVideoBar(tab);
        const m = memberVideoTarget(tab);
        const res = memberVideoDataFailed(t)
            ? { videos: [], total: 0 }
            : await Api.memberVideos(t.kind, m ? m['SOOP ID'] : null, cursor);
        if (seq !== t.seq) return;
        const bySoopId = new Map(activeMembersWithSoopId().map(x => [String(x['SOOP ID']).toLowerCase(), x]));
        added = res.videos.map(r => memberVideoRow(tab, r, bySoopId));
        t.rows = [...t.rows, ...added];
        t.byId = new Map(t.rows.map(v => [v.id, v]));
        t.total = Number(res.total) || 0;
        if (!m && !memberVideoDataFailed(t)) t.allTotal = t.total;
        const last = res.videos[res.videos.length - 1];
        t.next = t.rows.length < t.total && last ? { published: last.published, id: last.video_id } : null;
    } catch (error) {
        if (seq !== t.seq) return;
        t.failed = true;
        console.error(`${t.label}를 불러오지 못했습니다:`, error);
    } finally {
        if (seq === t.seq) {
            t.loading = false;
            renderMemberVideos(tab, more ? added : null);
        }
    }
}

function memberVideosShowMore(tab) {
    const t = MEMBER_VIDEOS[tab];
    if (t.loading || !t.next) return;
    return loadMemberVideos(tab, true);
}

function ensureMemberVideos(tab) {
    if (MEMBER_VIDEOS[tab].started) return;
    MEMBER_VIDEOS[tab].started = true;
    loadMemberVideos(tab);
}

function selectMemberVideos(tab, name) {
    MEMBER_VIDEOS[tab].member = name || '';
    updateVideoUrl();
    return loadMemberVideos(tab);
}

// ----- 탭 · 주소 -----
function videoViewOf(raw) {
    return VIDEO_TABS[raw] ? raw : 'fantube';
}

function currentVideoView() {
    return Object.keys(VIDEO_TABS).find(view => isTabActive(VIDEO_TABS[view][0])) || 'fantube';
}

function updateVideoUrl() {
    const view = currentVideoView();
    const idx = VideoState.channelKeys.indexOf(VideoState.channel);
    PageState.update({
        view: view === 'fantube' ? '' : view,
        ch: view === 'fantube' && idx >= 0 ? String(idx + 1) : '',
        member: MEMBER_VIDEOS[view] ? MEMBER_VIDEOS[view].member : '',
    });
}

// 없는 채널·멤버를 지울 때는 기록을 쌓지 않는다(뒤로가기가 같은 상태에 갇히지 않게).
function replaceVideoUrl() {
    PageState.restoring = true;
    try {
        updateVideoUrl();
    } finally {
        PageState.restoring = false;
    }
}

function showVideoView(view) {
    activateTabView(VIDEO_TABS, view);
    if (MEMBER_VIDEOS[view]) ensureMemberVideos(view);
}

function switchVideoView(view) {
    showVideoView(videoViewOf(view));
    updateVideoUrl();
}

// DB 행을 카드 계약으로 한 번만 변환한다. 편집 화면도 같은 행의 원래 열을 쓴다.
function videoRow(v) {
    return {
        ...v,
        channel: v.channel_url || '',
        group: v.group_name || '',
        groupEn: v.group_en || '',
        views: Number(v.views) || 0,
    };
}

async function loadVideoData(client = VideoState.client, more = false) {
    const seq = ++VideoState.requestSeq;
    VideoState.client = client;
    VideoState.loading = true;
    VideoState.failed = false;
    const cursor = more ? VideoState.next : null;
    let added = [];
    if (!more) {
        Object.assign(VideoState.data, { videos: [], top: [], shorts: [], total: 0 });
        VideoState.next = null;
        renderVideoChannels();
        renderFantube();
    } else renderVideoMore('video-more-wrap', VideoState);
    try {
        const res = await Api.videos(
            {
                p_channel: VideoState.channel || null,
                p_before: cursor?.published || null,
                p_before_id: cursor?.id || null,
                p_limit: VIDEO_PAGE_SIZE,
            },
            client
        );
        if (seq !== VideoState.requestSeq) return;
        if (res.summary) {
            const summary = res.summary;
            VideoState.data.channels = Object.fromEntries(
                summary.channels.map(ch => [
                    ch.channel_url,
                    {
                        ...ch,
                        name: ch.display_name || ch.title || '',
                    },
                ])
            );
            VideoState.channelKeys = Object.keys(VideoState.data.channels);
            if (VideoState.channel && !VideoState.channelKeys.includes(VideoState.channel)) {
                VideoState.channel = '';
                replaceVideoUrl();
                return loadVideoData(client);
            }
            Object.assign(VideoState.data, {
                top: summary.top.map(videoRow),
                shorts: summary.shorts.map(videoRow),
                picks: summary.picks.map(videoRow),
                total: summary.total,
            });
        }
        const rows = res.videos.map(videoRow);
        added = rows;
        VideoState.data.videos = more ? [...VideoState.data.videos, ...rows] : rows;
        VideoState.next = res.next;
        VideoState.byId = new Map(
            [
                ...VideoState.data.picks,
                ...VideoState.data.videos,
                ...VideoState.data.top,
                ...VideoState.data.shorts,
            ].map(v => [v.id, v])
        );
        document.dispatchEvent(new Event('video:data'));
        return true;
    } catch (error) {
        if (seq !== VideoState.requestSeq) return;
        VideoState.failed = true;
        console.error('영상 목록을 불러오지 못했습니다:', error);
        return false;
    } finally {
        if (seq === VideoState.requestSeq) {
            VideoState.loading = false;
            if (!more) {
                renderVideoChannels();
                renderPicks();
            }
            renderFantube(more ? added : null);
        }
    }
}

bootPage(
    async () => {
        // 멤버 영상 탭으로 바로 들어오면 팬채널를 기다리지 않는다
        const first = currentVideoView();
        if (MEMBER_VIDEOS[first]) {
            MEMBER_VIDEOS[first].member = new URLSearchParams(location.search).get('member') || '';
            ensureMemberVideos(first);
        }
        // 관리자 화면은 로그인 확인 뒤 숨긴 영상까지 받아 그리므로(admin-video.js) 공개 목록을 따로 받지 않는다
        if (document.body.dataset.adminPage !== 'video') await loadVideoData();
        bindShortsNav();
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                const idx = parseInt(params.get('ch'), 10);
                const channel = VideoState.channelKeys[idx - 1] || '';
                const view = videoViewOf(params.get('view') || runtimeDefaultSubtab('video', 'fantube'));
                const t = MEMBER_VIDEOS[view];
                const member = params.get('member') || '';
                if (t && t.member !== member) {
                    t.member = member;
                    if (t.started) loadMemberVideos(view);
                }
                showVideoView(view);
                if (VideoState.channel !== channel) {
                    VideoState.channel = channel;
                    loadVideoData();
                }
            })
        );
    },
    {
        siteData: false,
        view: params =>
            activateTabView(VIDEO_TABS, videoViewOf(params.get('view') || runtimeDefaultSubtab('video', 'fantube'))),
    }
);
