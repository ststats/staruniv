/**
 * 영상 페이지: 팬튜브(등록 채널 최신 영상) + 보자(어드민 추천). (core.js → media-lightbox.js → 이 파일)
 * URL: /video/ (팬튜브), /video/?view=pick (보자), 채널 필터는 ?ch=<채널 번호>
 *
 * 운영 데이터는 Supabase(video_channels/videos/video_picks)에서 직접 읽는다.
 * ststat가 GitHub Actions에서 유튜브 영상을 Supabase에 주기적으로 갱신한다.
 * hidden이 붙은 영상은 어드민이 감춘 것이라 화면에서 뺀다. 카드에 영상 길이는 표시하지 않는다.
 *
 * '보자'에는 유튜브 말고 숲(SOOP) VOD도 올릴 수 있다. 그런 항목은 id가 'soop:<번호>'이고
 * kind가 'soop'이며, 재생은 숲 임베드 플레이어로 연다(유튜브는 유튜브 플레이어로).
 */

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

// 썸네일은 유튜브(i.ytimg.com)와 숲 이미지 서버만 쓴다(데이터 파일에 이상한 주소가 섞여도 따라가지 않는다).
// 숲 VOD는 썸네일을 못 받아올 수 있어서, 그때는 빈 값을 주고 카드 쪽에서 글자 썸네일로 대신한다.
function videoThumb(v) {
    const t = String(v.thumb || '');
    if (videoIsSoop(v)) return /^https:\/\/[\w.-]+\.(afreecatv\.com|sooplive\.co\.kr|sooplive\.com)\//.test(t) ? t : '';
    return /^https:\/\/i\d?\.ytimg\.com\//.test(t) ? t : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
}

// 숲 VOD 항목인지. 예전 데이터(유튜브만 있던 시절)에는 kind가 없다.
function videoIsSoop(v) {
    return v.kind === 'soop' || /^soop:/.test(String(v.id || ''));
}

const soopVodNo = v => String(v.id || '').replace(/^soop:/, '');

function videoChannelAvatar(ch, cls) {
    const t = String(ch.thumb || '');
    const ok = /^https:\/\/(yt\d\.ggpht\.com|yt\d\.googleusercontent\.com|i\d?\.ytimg\.com)\//.test(t);
    const name1 = videoChannelName(ch).slice(0, 1);
    const initial = escapeHTML(name1);          // HTML 글자 자리
    const initialJs = jsAttr(name1);            // onerror 안 JS 문자열 자리
    return ok
        ? `<img class="${cls}" src="${escapeHTML(t)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls}',textContent:'${initialJs}'}))">`
        : `<span class="${cls}">${initial}</span>`;
}

// ----- 카드 -----
function videoCardHtml(v, opts) {
    opts = opts || {};
    const ch = videoChannel(v.channel);
    const channelName = v.channel ? videoChannelName(ch) : (v.author || (videoIsSoop(v) ? '숲 VOD' : ''));
    // 채널 이름 · 조회수 · 올린 때를 한 줄에 점으로 잇는다(줄을 나눠 쓰면 카드가 길어진다).
    // '보자'는 어드민이 고른 영상이라 추가한 날짜는 보여주지 않는다(정렬에만 쓴다).
    const meta = [
        channelName,
        v.views ? `조회수 ${videoFormatViews(v.views)}` : '',
        opts.pick ? '' : videoAgo(v.published),
    ].filter(Boolean).map(escapeHTML).join('<span class="video-meta-dot">·</span>');
    const rank = opts.rank ? `<span class="video-rank">${opts.rank}</span>` : '';
    const avatar = v.channel ? videoChannelAvatar(ch, 'video-card-avatar') : '';
    return `
        <article class="video-card${opts.top ? ' is-top' : ''}" data-video-id="${escapeHTML(v.id)}" data-video-pick="${opts.pick ? '1' : '0'}">
            <button type="button" class="video-thumb" onclick="videoPlay('${escapeHTML(v.id)}')" aria-label="${escapeHTML(v.title)} 재생">
                ${videoThumbInnerHtml(v)}
                ${rank}
                ${v.short ? '<span class="video-badge">SHORTS</span>' : ''}
                <span class="video-play" aria-hidden="true"></span>
            </button>
            <div class="video-card-body">
                ${avatar}
                <div class="video-card-text">
                    <button type="button" class="video-card-title" onclick="videoPlay('${escapeHTML(v.id)}')">${escapeHTML(v.title)}</button>
                    ${meta ? `<div class="video-card-meta">${meta}</div>` : ''}
                    ${opts.pick && v.note ? `<p class="video-card-note">${escapeHTML(v.note)}</p>` : ''}
                </div>
            </div>
            ${typeof window.videoCardAdminExtra === 'function' ? window.videoCardAdminExtra(v, opts) : ''}
        </article>`;
}

function videoShortHtml(v) {
    return `
        <button type="button" class="video-short" onclick="videoPlay('${escapeHTML(v.id)}')" aria-label="${escapeHTML(v.title)} 재생">
            <span class="video-short-thumb">${videoThumbInnerHtml(v)}</span>
            <span class="video-short-title">${escapeHTML(v.title)}</span>
            <span class="video-short-meta">${v.views ? `조회수 ${videoFormatViews(v.views)}` : escapeHTML(videoChannelName(videoChannel(v.channel)))}</span>
        </button>`;
}

// 썸네일 이미지가 없을 때(숲 VOD 등)는 글자 썸네일로 대신한다.
function videoThumbInnerHtml(v) {
    const t = videoThumb(v);
    return t
        ? `<img src="${escapeHTML(t)}" alt="" loading="lazy">`
        : '<span class="video-thumb-blank">SOOP</span>';
}

// ----- 쇼츠 선반 넘김(마우스용) -----
// 선반은 원래 손가락으로 미는 가로 스크롤이다. PC에서는 밀 방법이 없어서 제목줄 오른쪽
// 버튼으로 한 화면씩 넘긴다. 끝에 닿으면 그 방향 버튼을 꺼서 더 갈 데가 없다는 걸 알린다.
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
    nav.hidden = max <= 1;                       // 다 보이면 버튼 자체를 숨긴다
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

function videoEmptyHtml(text) {
    return emptyStateHtml(text, 'video-empty');
}

function videoPlay(id) {
    const v = VideoState.byId.get(String(id));
    if (!v) return;
    const ch = v.channel ? videoChannelName(videoChannel(v.channel)) : (v.author || '');
    const caption = ch ? `${ch} · ${v.title}` : v.title;
    if (videoIsSoop(v)) {
        mediaLightboxOpen({ caption, soopVodNo: soopVodNo(v) });
        return;
    }
    mediaLightboxOpen({ caption, youtubeId: v.id, vertical: !!v.short });
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
        <button type="button" class="video-channel-chip${VideoState.channel === key ? ' active' : ''}" aria-pressed="${VideoState.channel === key}" onclick="selectVideoChannel('${jsAttr(key)}')">
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
    grid.setAttribute('aria-busy', 'false');
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
    updateShortsNav();
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
// 분류(group)가 적힌 영상은 같은 분류끼리 묶여 제목줄이 하나 생긴다. 분류가 없으면 제목줄 없이
// 맨 위에 그냥 놓인다(예전과 같은 모습). 순서는 어드민에서 정한 목록 순서를 그대로 따른다.
function renderPicks() {
    const picks = VideoState.data.picks || [];
    const box = document.getElementById('video-pick-grid');
    if (!picks.length) {
        box.innerHTML = videoEmptyHtml('추천 영상이 아직 없습니다.');
        return;
    }
    const groups = [];                       // [[분류 이름, [영상...]], ...] - 처음 나온 순서대로
    picks.forEach(v => {
        const key = String(v.group || '').trim();
        const last = groups[groups.length - 1];
        if (last && last[0] === key) last[1].push(v);
        else groups.push([key, [v]]);
    });
    box.innerHTML = groups.map(([name, list], i) => {
        // 맨 위 묶음만 제목 없이 둘 수 있다. 분류 뒤에 오는 무분류는 앞 묶음에 딸려 보이므로 '기타'를 붙인다.
        const label = name || (i ? '기타' : '');
        // 제목줄 위 작은 영문 라벨. 어드민에서 분류마다 적을 수 있고, 비우면 예전처럼 라벨 없이 나온다.
        const labelEn = String((list.find(v => String(v.groupEn || '').trim()) || {}).groupEn || '').trim();
        const enAttr = labelEn ? ` data-en="${escapeHTML(labelEn)}"` : '';
        return `
        ${label ? `<div class="section-title${i ? ' section-title-spaced' : ''} video-pick-title"${enAttr}><span class="section-title-label">${escapeHTML(label)}</span><span class="title-count">${list.length}개</span></div>` : ''}
        <div class="video-grid video-pick-grid">${list.map(v => videoCardHtml(v, { pick: true })).join('')}</div>`;
    }).join('');
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

async function loadVideoDataFromSupabase() {
    const client = publicSupabaseClient();
    if (!client) return null;
    const [chRes, videoRes, pickRes] = await Promise.all([
        client.from('video_channels').select('channel_url,channel_id,title,display_name,thumb,uploads,source_order,active').eq('active', true).order('source_order'),
        client.from('videos').select('id,channel_url,title,published,thumb,views,short,hidden').order('published', {ascending:false}).limit(3000),
        client.from('video_picks').select('id,kind,title,note,group_name,group_en,added_at,author,thumb,short,hidden,source_order').order('source_order')
    ]);
    const error = chRes.error || videoRes.error || pickRes.error;
    if (error) throw error;
    const channels = {};
    (chRes.data || []).forEach(ch => {
        channels[ch.channel_url] = {
            id: ch.channel_id || '', title: ch.title || '', name: ch.display_name || ch.title || '',
            thumb: ch.thumb || '', url: ch.channel_url, uploads: ch.uploads || ''
        };
    });
    return {
        updatedAt: '',
        channels,
        videos: (videoRes.data || []).filter(v => !!channels[v.channel_url]).map(v => ({
            id:v.id, channel:v.channel_url, title:v.title, published:v.published, thumb:v.thumb,
            views:Number(v.views)||0, short:!!v.short, hidden:!!v.hidden
        })),
        picks: (pickRes.data || []).map(v => ({
            id:v.id, kind:v.kind, title:v.title, note:v.note || '', group:v.group_name || '', groupEn:v.group_en || '',
            addedAt:v.added_at || '', author:v.author || '', thumb:v.thumb || '', short:!!v.short, hidden:!!v.hidden
        }))
    };
}

async function loadVideoData() {
    try {
        return await loadVideoDataFromSupabase();
    } catch (e) {
        console.error('영상 목록을 불러오지 못했습니다:', e);
        return { channels: {}, videos: [], picks: [] };
    }
}

// 영상 페이지는 Supabase에서 운영 데이터를 직접 읽는다.
bootPage(async () => {
    const data = await loadVideoData();
    VideoState.data = {
        channels: data.channels || {},
        // hidden은 어드민이 감춘 영상이다(파일에는 남아 있고 화면에서만 뺀다)
        videos: (Array.isArray(data.videos) ? data.videos : []).filter(v => v && !v.hidden && /^[A-Za-z0-9_-]{11}$/.test(v.id))
            .sort((a, b) => String(b.published || '').localeCompare(String(a.published || ''))),
        // 보자에는 유튜브 영상(11자 id)과 숲 VOD('soop:<번호>')가 같이 올 수 있다.
        picks: (Array.isArray(data.picks) ? data.picks : []).filter(v => v && !v.hidden && /^([A-Za-z0-9_-]{11}|soop:\d{1,20})$/.test(v.id)),
    };
    VideoState.channelKeys = Object.keys(VideoState.data.channels);
    [...VideoState.data.videos, ...VideoState.data.picks].forEach(v => {
        if (!VideoState.byId.has(v.id)) VideoState.byId.set(v.id, v);
    });
    renderPicks();
    bindShortsNav();
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const idx = parseInt(params.get('ch'), 10);
        VideoState.channel = VideoState.channelKeys[idx - 1] || '';
        VideoState.shown = VIDEO_PAGE_SIZE;
        const rawView = params.get('view') || runtimeDefaultSubtab('video','fantube');
        activateTabView(VIDEO_TABS, rawView === 'pick' ? 'pick' : 'fantube');
        renderVideoChannels();
        renderFantube();
    }));
}, { siteData: false });
