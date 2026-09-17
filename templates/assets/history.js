/**
 * 연혁: 일정 페이지 '연혁' 탭과 관리자 페이지가 같이 쓴다. (core.js 없이도 돌아가야 한다 - admin.html은 core.js를 안 싣는다)
 *
 * 항목은 두 종류다.
 *   - 자동 항목: 멤버 시트의 입단일/퇴단일에서 날짜별로 묶어 만든다. 시트만 고치면 따라온다.
 *     관리자가 제목·설명·사진·유튜브를 덧붙이거나 숨길 수 있고, 그 값은 overrides[자동 id]에 저장된다.
 *   - 수동 항목: 관리자가 직접 추가한 창단·대회·방송 등. items 배열에 저장된다.
 *
 * docs/data/history.json
 *   { "items": [ { id, date:'YYYY-MM-DD', type, title, desc, members:['이름'], youtube, image } ],
 *     "overrides": { "auto-join-2025-08-04": { title, desc, youtube, image, hidden } } }
 *   image는 저장소 안 경로(data/history/xxx.jpg)다. 사진이 없고 유튜브 링크가 있으면 유튜브 썸네일을 쓴다.
 */

const HISTORY_DATA_URL = 'data/history.json';

// 종류: 라벨과 점/배지 색 이름(CSS .hist-type-*)
const HISTORY_TYPES = {
    founding: '창단',
    join: '입단',
    leave: '퇴단',
    match: '대회',
    broadcast: '방송',
    event: '이벤트',
};

function histEscape(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

// 유튜브 주소(watch · youtu.be · shorts · embed)에서 영상 id를 뽑는다. 아니면 ''.
function histYoutubeId(url) {
    const s = String(url || '').trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
}

// 사진 경로는 저장소 안 상대 경로만 받는다(외부 주소나 javascript: 같은 값이 섞여도 쓰지 않는다).
function histSafeImage(path) {
    const s = String(path || '').trim();
    return /^data\/history\/[\w.-]+\.(jpe?g|png|webp)$/i.test(s) ? s : '';
}

function histThumbUrl(item) {
    const img = histSafeImage(item.image);
    if (img) return img;
    const yt = histYoutubeId(item.youtube);
    return yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
}

// 멤버 시트에서 입단/퇴단 자동 항목을 만든다. 같은 날 같은 종류는 한 항목으로 묶는다.
function histAutoItems(members) {
    const groups = new Map();
    (members || []).forEach(m => {
        [['join', m['입단일']], ['leave', m['퇴단일']]].forEach(([type, date]) => {
            const d = String(date || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
            const id = `auto-${type}-${d}`;
            if (!groups.has(id)) groups.set(id, { id, auto: true, date: d, type, members: [] });
            groups.get(id).members.push(m['이름']);
        });
    });
    return [...groups.values()].map(item => ({
        ...item,
        title: item.members.length > 1 ? `${item.members.length}명 ${HISTORY_TYPES[item.type]}` : `${item.members[0]} ${HISTORY_TYPES[item.type]}`,
        desc: '',
    }));
}

// 자동 항목 + 덮어쓰기 + 수동 항목을 합쳐 최신순으로 돌려준다. includeHidden이면 숨긴 자동 항목도 남긴다(관리자용).
function histMergeItems(data, members, includeHidden) {
    const overrides = (data && data.overrides) || {};
    const auto = histAutoItems(members).map(item => {
        const o = overrides[item.id] || {};
        return {
            ...item,
            title: o.title || item.title,
            desc: o.desc || '',
            youtube: o.youtube || '',
            image: o.image || '',
            hidden: !!o.hidden,
        };
    });
    const manual = ((data && data.items) || []).map(item => ({ ...item, auto: false, members: Array.isArray(item.members) ? item.members : [] }));
    return [...auto, ...manual]
        .filter(item => includeHidden || !item.hidden)
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')))
        // 같은 날이면 창단 → 입단 → 그 밖 → 퇴단 순이 읽기 자연스럽다(최신순 목록이라 뒤집어서 정렬)
        .sort((a, b) => b.date.localeCompare(a.date) || histTypeOrder(b.type) - histTypeOrder(a.type));
}

function histTypeOrder(type) {
    return { leave: 0, event: 1, broadcast: 1, match: 1, join: 2, founding: 3 }[type] ?? 1;
}

// 멤버 칩: 이름이 멤버 시트에 있으면 프로필 사진과 직책을 붙인다.
function histMemberChipHtml(name, members, avatarUrlFn) {
    const m = (members || []).find(x => x['이름'] === String(name).trim());
    const url = m && avatarUrlFn ? avatarUrlFn(m['SOOP ID']) : '';
    const ava = url
        ? `<img class="hist-chip-ava" src="${histEscape(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hist-chip-ava',textContent:'👤'}))">`
        : `<span class="hist-chip-ava">👤</span>`;
    const role = m && m['직책'] ? `<span class="hist-chip-role">${histEscape(m['직책'])}</span>` : '';
    return `<span class="hist-chip${m ? '' : ' is-unknown'}">${ava}<span class="hist-chip-name">${histEscape(name)}</span>${role}</span>`;
}

const HIST_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 타임라인 HTML. opts: { members, avatarUrl(soopId), admin: true면 수정 버튼과 숨김 표시 }
function histTimelineHtml(items, opts) {
    opts = opts || {};
    if (!items.length) return '<div class="hist-empty">등록된 연혁이 없습니다.</div>';
    const byYear = new Map();
    items.forEach(item => {
        const y = item.date.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(item);
    });
    let html = '';
    byYear.forEach((list, year) => {
        html += `<div class="section-title hist-year" data-en="HISTORY"><span class="section-title-label">${histEscape(year)}</span><span class="title-count">${list.length}건</span></div>`;
        html += '<ol class="hist-list">';
        list.forEach(item => { html += histItemHtml(item, opts); });
        html += '</ol>';
    });
    return html;
}

function histItemHtml(item, opts) {
    const type = HISTORY_TYPES[item.type] ? item.type : 'event';
    const d = new Date(item.date + 'T00:00:00');
    const dateText = `${item.date.slice(5, 7)}.${item.date.slice(8, 10)}`;
    const weekday = isNaN(d) ? '' : HIST_WEEKDAYS[d.getDay()];
    const thumb = histThumbUrl(item);
    const yt = histYoutubeId(item.youtube);
    const key = histEscape(item.id);
    const media = thumb ? `
            <button type="button" class="hist-media${yt && !histSafeImage(item.image) ? ' is-video' : (yt ? ' has-video' : '')}" onclick="histOpenMedia('${key}')" aria-label="${yt ? '영상 보기' : '사진 크게 보기'}">
                <img src="${histEscape(thumb)}" alt="" loading="lazy">
                ${yt ? '<span class="hist-play" aria-hidden="true"></span>' : ''}
            </button>` : '';
    const members = (item.members || []).filter(Boolean);
    const chips = members.length
        ? `<div class="hist-chips">${members.map(n => histMemberChipHtml(n, opts.members, opts.avatarUrl)).join('')}</div>` : '';
    const adminBar = opts.admin ? `
            <div class="hist-admin-bar">
                ${item.auto ? '<span class="hist-auto">자동</span>' : ''}${item.hidden ? '<span class="hist-auto is-hidden">숨김</span>' : ''}
                <button type="button" class="edit-btn" onclick="histAdminEdit('${key}')">수정</button>
                <button type="button" class="delete-btn" onclick="histAdminRemove('${key}')">${item.auto ? (item.hidden ? '보이기' : '숨기기') : '삭제'}</button>
            </div>` : '';
    return `
        <li class="hist-item hist-type-${type}${item.hidden ? ' is-hidden' : ''}" data-hist-id="${key}">
          <div class="hist-card">
            <div class="hist-main">
                <div class="hist-meta">
                    <time class="hist-date" datetime="${histEscape(item.date)}">${dateText}<small>${weekday}</small></time>
                    <span class="hist-type">${HISTORY_TYPES[type]}</span>
                </div>
                <div class="hist-title">${histEscape(item.title || HISTORY_TYPES[type])}</div>
                ${item.desc ? `<div class="hist-desc">${histEscape(item.desc)}</div>` : ''}
                ${chips}
                ${adminBar}
            </div>
            ${media}
          </div>
        </li>`;
}

// 사진은 크게, 유튜브는 임베디드 플레이어로 띄운다. 사진과 유튜브가 둘 다 있으면 영상을 띄운다.
let _histItemsById = new Map();
function histRegisterItems(items) {
    _histItemsById = new Map(items.map(it => [String(it.id), it]));
}

function histOpenMedia(id) {
    const item = _histItemsById.get(String(id));
    if (!item) return;
    const yt = histYoutubeId(item.youtube);
    const img = histThumbUrl(item);
    if (!yt && !img) return;
    histCloseMedia();
    const layer = document.createElement('div');
    layer.className = 'hist-lightbox';
    layer.id = 'hist-lightbox';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', item.title || '연혁');
    const body = yt
        ? `<div class="hist-lightbox-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0" title="${histEscape(item.title || 'YouTube')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : `<img class="hist-lightbox-img" src="${histEscape(img)}" alt="${histEscape(item.title || '')}">`;
    layer.innerHTML = `
        <div class="hist-lightbox-inner">
            <div class="hist-lightbox-head">
                <span>${histEscape(item.date.replace(/-/g, '.'))} · ${histEscape(item.title || '')}</span>
                <button type="button" class="hist-lightbox-close" aria-label="닫기" onclick="histCloseMedia()">✕</button>
            </div>
            ${body}
        </div>`;
    layer.addEventListener('click', e => { if (e.target === layer) histCloseMedia(); });
    document.body.appendChild(layer);
    document.addEventListener('keydown', histLightboxKey);
    layer.querySelector('.hist-lightbox-close').focus();
}

function histCloseMedia() {
    const layer = document.getElementById('hist-lightbox');
    if (layer) layer.remove();   // iframe을 지워야 영상 소리도 멈춘다
    document.removeEventListener('keydown', histLightboxKey);
}

function histLightboxKey(e) {
    if (e.key === 'Escape') histCloseMedia();
}

async function histLoadData() {
    try {
        const res = await fetch(HISTORY_DATA_URL, { cache: 'no-cache' });
        if (res.ok) return await res.json();
    } catch (e) {
        console.error('연혁을 불러오지 못했습니다:', e);
    }
    return { items: [], overrides: {} };
}
