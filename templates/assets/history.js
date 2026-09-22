/**
 * 연혁: 일정 페이지 '연혁' 탭과 관리자 페이지가 같이 쓴다. (core.js 없이도 돌아가야 한다 - admin.html은 core.js를 안 싣는다. 팝업은 media-lightbox.js)
 *
 * 항목은 두 종류다.
 *   - 자동 항목: 멤버 데이터의 입단일/퇴단일에서 날짜별로 묶어 만든다. Supabase 멤버 데이터를 고치면 따라온다.
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
    event: '경기',
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

// 멤버 데이터에서 입단/퇴단 자동 항목을 만든다. 같은 날 같은 종류는 한 항목으로 묶는다.
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
        // 멤버는 DB가 정한다. 관리자가 붙인 괄호 설명만 이름을 맞춰 다시 붙인다
        // (DB에서 사람이 늘거나 빠져도 설명이 엉뚱한 사람에게 붙지 않는다).
        const notes = new Map((Array.isArray(o.members) ? o.members : []).map(e => {
            const p = histParseMember(e);
            return [p.name, p.note];
        }));
        return {
            ...item,
            members: item.members.map(name => histFormatMember(name, notes.get(name) || '')),
            title: o.title || item.title,
            desc: o.desc || '',
            youtube: o.youtube || '',
            image: o.image || '',
            ord: o.ord,
            hidden: !!o.hidden,
        };
    });
    const manual = ((data && data.items) || []).map(item => ({ ...item, auto: false, members: Array.isArray(item.members) ? item.members : [] }));
    return [...auto, ...manual]
        .filter(item => includeHidden || !item.hidden)
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')))
        .sort((a, b) => b.date.localeCompare(a.date) || histOrder(a) - histOrder(b));
}

// 같은 날 안에서의 자리. 관리자가 ▲▼로 옮겼으면 그 값(0,1,2...)을, 아니면 종류 기본 순서를 쓴다.
// 기본은 창단 → 입단 → 그 밖 → 퇴단 순이 읽기 자연스럽다.
function histOrder(item) {
    return Number.isFinite(item.ord) ? item.ord : 10 - histTypeOrder(item.type);
}

function histTypeOrder(type) {
    return { leave: 0, event: 1, broadcast: 1, match: 1, join: 2, founding: 3 }[type] ?? 1;
}

// "토마토(선수)" → { name: '토마토', note: '선수' }. 괄호가 없으면 설명은 빈 값이다.
// 설명은 관리자가 직접 적는 값이다(예전처럼 멤버 데이터의 직책을 자동으로 붙이지 않는다 - 그 날의
// 역할이 DB의 현재 직책과 다를 수 있어서 자동으로 붙이면 오히려 틀린 말이 된다).
function histParseMember(entry) {
    const s = String(entry || '').trim();
    const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { name: m[1].trim(), note: m[2].trim() } : { name: s, note: '' };
}

// 이름 + 설명을 다시 한 줄로. 설명이 비면 괄호를 붙이지 않는다.
function histFormatMember(name, note) {
    return note ? `${name}(${note})` : name;
}

// 멤버 칩: 이름이 멤버 데이터에 있으면 프로필 사진을 붙이고, 괄호 설명이 있으면 이름 뒤에 같이 보여준다.
// 한 항목에 이름이 수십 개 붙는 날이 있다(단체 입단 등). 다섯까지만 펼쳐 두고
// 나머지는 겹친 프로필 사진 + '+N명' 한 칸으로 접는다 - 누르면 펼쳐진다.
const HIST_CHIP_VISIBLE = 5;
const HIST_STACK_FACES = 3;      // '+N명' 칸에 겹쳐 보일 사진 수

function histAvatarSrc(entry, members, avatarUrlFn) {
    const name = typeof entry === 'string' ? entry : (entry && entry.name) || '';
    const m = (members || []).find(x => x['이름'] === name);
    return m && avatarUrlFn ? avatarUrlFn(m['SOOP ID']) : '';
}

function histMoreChipHtml(rest, members, avatarUrlFn, key) {
    const faces = rest.slice(0, HIST_STACK_FACES).map(e => {
        const url = histAvatarSrc(e, members, avatarUrlFn);
        return url
            ? `<img class="hist-stack-face" src="${histEscape(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hist-stack-face',textContent:'👤'}))">`
            : `<span class="hist-stack-face">👤</span>`;
    }).join('');
    return `<button type="button" class="hist-chip hist-chip-more" data-hist-more="${key}"
                onclick="histToggleMembers('${key}')" aria-expanded="false">
                <span class="hist-stack">${faces}</span>
                <span class="hist-chip-name">+${rest.length}명</span>
            </button>`;
}

// 접어둔 이름을 펼친다. 한 번 펼치면 다시 접지 않는다 - 접을 일이 거의 없고,
// 토글로 두면 눌렀다 닫히는 실수가 잦다.
function histToggleMembers(key) {
    const rest = document.querySelector(`[data-hist-rest="${key}"]`);
    const btn = document.querySelector(`[data-hist-more="${key}"]`);
    if (rest) rest.hidden = false;
    if (btn) btn.remove();
}

function histMemberChipHtml(entry, members, avatarUrlFn) {
    const { name, note } = histParseMember(entry);
    const m = (members || []).find(x => x['이름'] === name);
    const url = m && avatarUrlFn ? avatarUrlFn(m['SOOP ID']) : '';
    const ava = url
        ? `<img class="hist-chip-ava" src="${histEscape(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hist-chip-ava',textContent:'👤'}))">`
        : `<span class="hist-chip-ava">👤</span>`;
    const noteHtml = note ? `<span class="hist-chip-role">${histEscape(note)}</span>` : '';
    return `<span class="hist-chip${m ? '' : ' is-unknown'}">${ava}<span class="hist-chip-name">${histEscape(name)}</span>${noteHtml}</span>`;
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
        list.forEach((item, i) => {
            html += histItemHtml(item, {
                ...opts,
                firstOfDay: !list[i - 1] || list[i - 1].date !== item.date,
                lastOfDay: !list[i + 1] || list[i + 1].date !== item.date,
            });
        });
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
    const chip = n => histMemberChipHtml(n, opts.members, opts.avatarUrl);
    let chips = '';
    // 한 명만 숨기는 접기는 손해다 - '+1명' 칸이 이름 칸만큼 자리를 먹으면서 클릭만 늘어난다.
    if (members.length && members.length <= HIST_CHIP_VISIBLE + 1) {
        chips = `<div class="hist-chips">${members.map(chip).join('')}</div>`;
    } else if (members.length) {
        const shown = members.slice(0, HIST_CHIP_VISIBLE);
        const rest = members.slice(HIST_CHIP_VISIBLE);
        chips = `<div class="hist-chips">${shown.map(chip).join('')}`
            + `<span class="hist-chips-rest" data-hist-rest="${key}" hidden>${rest.map(chip).join('')}</span>`
            + `${histMoreChipHtml(rest, opts.members, opts.avatarUrl, key)}</div>`;
    }
    const adminBar = opts.admin ? `
            <div class="hist-admin-bar">
                <span class="hist-move">
                    <button type="button" aria-label="위로" ${opts.firstOfDay ? 'disabled' : ''} onclick="histAdminMove('${key}', -1)">▲</button>
                    <button type="button" aria-label="아래로" ${opts.lastOfDay ? 'disabled' : ''} onclick="histAdminMove('${key}', 1)">▼</button>
                </span>
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

// 사진은 크게, 유튜브는 임베디드 플레이어로 띄운다(media-lightbox.js). 사진과 유튜브가 둘 다 있으면 영상을 띄운다.
let _histItemsById = new Map();
function histRegisterItems(items) {
    _histItemsById = new Map(items.map(it => [String(it.id), it]));
}

function histOpenMedia(id) {
    const item = _histItemsById.get(String(id));
    if (!item) return;
    mediaLightboxOpen({
        caption: `${item.date.replace(/-/g, '.')} · ${item.title || ''}`,
        youtubeId: histYoutubeId(item.youtube),
        image: histThumbUrl(item),
    });
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
