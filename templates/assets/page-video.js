/**
 * 영상 페이지: 팬튜브(등록 채널 최신 영상) + 보자(어드민 추천). (core.js → media-lightbox.js → 이 파일)
 * URL: /video/ (팬튜브), /video/?view=pick (보자), 채널 필터는 ?ch=<채널 번호>
 *
 * 데이터는 data/videos.json 하나다. scripts/sync_videos.py가 GitHub Actions에서 주기적으로
 * 유튜브에서 받아 쌓는다(API 키가 있으면 과거 영상까지, 없으면 RSS 최신 15개). 형식은 그 파일 머리 주석 참고.
 * hidden이 붙은 영상은 어드민이 감춘 것이라 화면에서 뺀다. 카드에 영상 길이는 표시하지 않는다.
 */

const VIDEO_DATA_URL = 'data/videos.json';
const VIDEO_TABS = { fantube: ['tab-video-fantube', 'view-video-fantube'], pick: ['tab-video-pick', 'view-video-pick'] };
const VIDEO_PAGE_SIZE = 20;      // 최신 영상 한 번에 보여줄 개수
const VIDEO_TOP_COUNT = 3;       // 이번 달 인기
const VIDEO_TOP_DAYS = 30;
const VIDEO_SHORTS_MAX = 24;     // 쇼츠 선반에 올릴 최대 개수

const VideoState = {
    data: { channels: {}, videos: [], picks: [] },
    channelKeys: [],      // 등록 순서 그대로의 채널 키(등록 url)
    channel: '',          // 선택한 채널 키('' = 전체)
    shown: VIDEO_PAGE_SIZE,
    byId: new Map(),
};

function videoFormatViews(n) {
    n = Number(n) || 0;
    const trim = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString();
    if (n >= 1e8) return `${trim(n / 1e8)}억회`;
    if (n >= 1e4) return `${trim(n / 1e4)}만회`;
    if (n >= 1e3) return `${trim(n / 1e3)}천회`;
    return `${n}회`;
}

// RSS 시각은 UTC다('2026-09-17T08:00:00'). 끝에 Z를 붙여 UTC로 읽는다.
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

function videoChannel(key) {
    return (VideoState.data.channels || {})[key] || {};
}

function videoChannelName(ch) {
    return ch.name || ch.title || '채널';
}

// 썸네일은 i.ytimg.com만 쓴다(데이터 파일에 이상한 주소가 섞여도 따라가지 않는다).
function videoThumb(v) {
    const t = String(v.thumb || '');
    return /^https:\/\/i\d?\.ytimg\.com\//.test(t) ? t : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
}

function videoChannelAvatar(ch, cls) {
    const t = String(ch.thumb || '');
    const ok = /^https:\/\/(yt\d\.ggpht\.com|yt\d\.googleusercontent\.com|i\d?\.ytimg\.com)\//.test(t);
    const initial = escapeHTML(videoChannelName(ch).slice(0, 1));
    return ok
        ? `<img class="${cls}" src="${escapeHTML(t)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls}',textContent:'${initial}'}))">`
        : `<span class="${cls}">${initial}</span>`;
}

// ----- 카드 -----
function videoCardHtml(v, opts) {
    opts = opts || {};
    const ch = videoChannel(v.channel);
    const channelName = v.channel ? videoChannelName(ch) : (v.author || '');
    const meta = [
        v.views ? `조회수 ${videoFormatViews(v.views)}` : '',
        opts.pick ? (v.addedAt ? `${escapeHTML(v.addedAt.replace(/-/g, '.'))} 추가` : '') : videoAgo(v.published),
    ].filter(Boolean).join(' · ');
    const rank = opts.rank ? `<span class="video-rank">${opts.rank}</span>` : '';
    const avatar = v.channel ? videoChannelAvatar(ch, 'video-card-avatar') : '';
    return `
        <article class="video-card${opts.top ? ' is-top' : ''}">
            <button type="button" class="video-thumb" onclick="videoPlay('${escapeHTML(v.id)}')" aria-label="${escapeHTML(v.title)} 재생">
                <img src="${escapeHTML(videoThumb(v))}" alt="" loading="lazy">
                ${rank}
                ${v.short ? '<span class="video-badge">SHORTS</span>' : ''}
                <span class="video-play" aria-hidden="true"></span>
            </button>
            <div class="video-card-body">
                ${avatar}
                <div class="video-card-text">
                    <button type="button" class="video-card-title" onclick="videoPlay('${escapeHTML(v.id)}')">${escapeHTML(v.title)}</button>
                    <div class="video-card-channel">${escapeHTML(channelName)}</div>
                    ${meta ? `<div class="video-card-meta">${meta}</div>` : ''}
                    ${opts.pick && v.note ? `<p class="video-card-note">${escapeHTML(v.note)}</p>` : ''}
                </div>
            </div>
        </article>`;
}

function videoShortHtml(v) {
    return `
        <button type="button" class="video-short" onclick="videoPlay('${escapeHTML(v.id)}')" aria-label="${escapeHTML(v.title)} 재생">
            <span class="video-short-thumb"><img src="${escapeHTML(videoThumb(v))}" alt="" loading="lazy"></span>
            <span class="video-short-title">${escapeHTML(v.title)}</span>
            <span class="video-short-meta">${v.views ? `조회수 ${videoFormatViews(v.views)}` : escapeHTML(videoChannelName(videoChannel(v.channel)))}</span>
        </button>`;
}

function videoEmptyHtml(text) {
    return `<div class="video-empty">${escapeHTML(text)}</div>`;
}

function videoPlay(id) {
    const v = VideoState.byId.get(String(id));
    if (!v) return;
    const ch = v.channel ? videoChannelName(videoChannel(v.channel)) : (v.author || '');
    mediaLightboxOpen({ caption: ch ? `${ch} · ${v.title}` : v.title, youtubeId: v.id, vertical: !!v.short });
}

// ----- 팬튜브 -----
function videoFiltered() {
    const list = VideoState.data.videos || [];
    return VideoState.channel ? list.filter(v => v.channel === VideoState.channel) : list;
}

function renderVideoChannels() {
    const row = document.getElementById('video-channel-row');
    if (!row) return;
    const keys = VideoState.channelKeys;
    row.hidden = keys.length < 2;   // 채널이 하나뿐이면 거를 게 없다
    const chip = (key, label, avatar) => `
        <button type="button" class="video-channel-chip${VideoState.channel === key ? ' active' : ''}" aria-pressed="${VideoState.channel === key}" onclick="selectVideoChannel('${escapeHTML(key)}')">
            ${avatar}<span>${escapeHTML(label)}</span>
        </button>`;
    row.innerHTML = chip('', '전체', '') + keys.map(k => chip(k, videoChannelName(videoChannel(k)), videoChannelAvatar(videoChannel(k), 'video-chip-avatar'))).join('');
}

function renderFantube() {
    const all = videoFiltered();
    const normal = all.filter(v => !v.short);
    const shorts = all.filter(v => v.short);

    const since = Date.now() - VIDEO_TOP_DAYS * 86400000;
    const top = normal
        .filter(v => { const d = videoDate(v.published); return d && d.getTime() >= since; })
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, VIDEO_TOP_COUNT);
    const topWrap = document.getElementById('video-top-wrap');
    topWrap.hidden = !top.length;
    document.getElementById('video-top-grid').innerHTML = top.map((v, i) => videoCardHtml(v, { rank: i + 1, top: true })).join('');

    const shortsWrap = document.getElementById('video-shorts-wrap');
    shortsWrap.hidden = !shorts.length;
    document.getElementById('video-shorts-shelf').innerHTML = shorts.slice(0, VIDEO_SHORTS_MAX).map(videoShortHtml).join('');
    document.getElementById('video-shorts-count').textContent = shorts.length ? `${Math.min(shorts.length, VIDEO_SHORTS_MAX)}개` : '';

    const grid = document.getElementById('video-latest-grid');
    const shown = normal.slice(0, VideoState.shown);
    grid.innerHTML = shown.length
        ? shown.map(v => videoCardHtml(v)).join('')
        : videoEmptyHtml(VideoState.channelKeys.length ? '아직 불러온 영상이 없습니다.' : '등록된 채널이 없습니다.');
    document.getElementById('video-latest-count').textContent = normal.length ? `${normal.length}개` : '';
    document.getElementById('video-more-wrap').hidden = normal.length <= VideoState.shown;

    // 위 섹션이 비어 숨겨지면 처음 보이는 제목의 윗여백을 뺀다
    const titles = [...document.querySelectorAll('#view-video-fantube .section-title')];
    const first = titles.find(t => !t.closest('[hidden]'));
    titles.forEach(t => t.classList.toggle('is-first', t === first));

    // 가로 선반/칩 줄은 내용이 바뀌면 끝 페이드를 다시 맞춘다
    ['video-shorts-shelf', 'video-channel-row'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el._edgeFadeUpdate) el._edgeFadeUpdate();
    });
}

function selectVideoChannel(key) {
    VideoState.channel = VideoState.channelKeys.includes(key) ? key : '';
    VideoState.shown = VIDEO_PAGE_SIZE;
    renderVideoChannels();
    renderFantube();
    updateVideoUrl();
}

function videoShowMore() {
    VideoState.shown += VIDEO_PAGE_SIZE;
    renderFantube();
}

// ----- 보자 -----
function renderPicks() {
    const picks = VideoState.data.picks || [];
    document.getElementById('video-pick-count').textContent = picks.length ? `${picks.length}개` : '';
    document.getElementById('video-pick-grid').innerHTML = picks.length
        ? picks.map(v => videoCardHtml(v, { pick: true })).join('')
        : videoEmptyHtml('추천 영상이 아직 없습니다.');
}

// ----- 탭 · 주소 -----
function currentVideoView() {
    return isTabActive(VIDEO_TABS.pick[0]) ? 'pick' : 'fantube';
}

function updateVideoUrl() {
    const view = currentVideoView();
    const idx = VideoState.channelKeys.indexOf(VideoState.channel);
    PageState.update({ view: view === 'pick' ? 'pick' : '', ch: view === 'fantube' && idx >= 0 ? String(idx + 1) : '' });
}

function switchVideoView(view) {
    activateTabView(VIDEO_TABS, view === 'pick' ? 'pick' : 'fantube');
    updateVideoUrl();
}

async function loadVideoData() {
    try {
        const res = await fetch(VIDEO_DATA_URL, { cache: 'no-cache' });
        if (res.ok) return await res.json();
    } catch (e) {
        console.error('영상 목록을 불러오지 못했습니다:', e);
    }
    return { channels: {}, videos: [], picks: [] };
}

bootPage(async () => {
    const data = await loadVideoData();
    VideoState.data = {
        channels: data.channels || {},
        // hidden은 어드민이 감춘 영상이다(파일에는 남아 있고 화면에서만 뺀다)
        videos: (Array.isArray(data.videos) ? data.videos : []).filter(v => v && !v.hidden && /^[A-Za-z0-9_-]{11}$/.test(v.id))
            .sort((a, b) => String(b.published || '').localeCompare(String(a.published || ''))),
        picks: (Array.isArray(data.picks) ? data.picks : []).filter(v => v && !v.hidden && /^[A-Za-z0-9_-]{11}$/.test(v.id)),
    };
    VideoState.channelKeys = Object.keys(VideoState.data.channels);
    [...VideoState.data.videos, ...VideoState.data.picks].forEach(v => {
        if (!VideoState.byId.has(v.id)) VideoState.byId.set(v.id, v);
    });
    const updated = document.getElementById('video-updated');
    if (updated && data.updatedAt) updated.textContent = `${data.updatedAt} 기준 · 몇 시간마다 자동으로 갱신됩니다`;
    renderPicks();
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const idx = parseInt(params.get('ch'), 10);
        VideoState.channel = VideoState.channelKeys[idx - 1] || '';
        VideoState.shown = VIDEO_PAGE_SIZE;
        activateTabView(VIDEO_TABS, params.get('view') === 'pick' ? 'pick' : 'fantube');
        renderVideoChannels();
        renderFantube();
    }));
});
