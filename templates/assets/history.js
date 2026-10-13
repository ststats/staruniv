// 연혁 탭(관리자 편집은 admin-history.js가 얹는다).
// 자동 항목은 멤버 입단일/퇴단일에서 만들고 관리자 덧붙임은 overrides에, 수동 항목은 items에 있다.

// 키는 CSS .hist-type-*와 맞춘다
const HISTORY_TYPES = {
    founding: '창단',
    join: '입단',
    leave: '퇴단',
    match: '대회',
    event: '경기',
    broadcast: '방송',
    other: '기타',
};

function histYoutubeId(url) {
    const s = String(url || '').trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
}

// javascript: 같은 값을 막으려고 알려진 경로와 https만 받는다
function histSafeImage(path) {
    const s = String(path || '').trim();
    if (/^data\/history\/[\w.-]+\.(jpe?g|png|webp)$/i.test(s)) return s;
    if (/^history\/[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(s)) return storageMediaUrl(s);
    return /^https:\/\//i.test(s) ? s : '';
}

function histThumbUrl(item) {
    const img = histSafeImage(item.image);
    if (img) return img;
    const yt = histYoutubeId(item.youtube);
    return yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
}

function histAutoItems(members) {
    const groups = new Map();
    (members || []).forEach(m => {
        [
            ['join', m['입단일']],
            ['leave', m['퇴단일']],
        ].forEach(([type, date]) => {
            const d = String(date || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
            const id = `auto-${type}-${d}`;
            if (!groups.has(id)) groups.set(id, { id, auto: true, date: d, type, members: [] });
            groups.get(id).members.push(m['이름']);
        });
    });
    return [...groups.values()].map(item => ({
        ...item,
        title:
            item.members.length > 1
                ? `${item.members.length}명 ${HISTORY_TYPES[item.type]}`
                : `${item.members[0]} ${HISTORY_TYPES[item.type]}`,
        desc: '',
    }));
}

function histMergeItems(data, members, includeHidden) {
    const overrides = (data && data.overrides) || {};
    const auto = histAutoItems(members).map(item => {
        const o = overrides[item.id] || {};
        // 멤버는 DB가 정하고, 관리자 괄호 설명은 이름으로 맞춰 붙여 사람이 바뀌어도 어긋나지 않게 한다
        const notes = new Map(
            (Array.isArray(o.members) ? o.members : []).map(e => {
                const p = histParseMember(e);
                return [p.name, p.note];
            })
        );
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
    const manual = ((data && data.items) || []).map(item => ({
        ...item,
        auto: false,
        members: Array.isArray(item.members) ? item.members : [],
    }));
    return [...auto, ...manual]
        .filter(item => includeHidden || !item.hidden)
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')))
        .sort((a, b) => b.date.localeCompare(a.date) || histOrder(a) - histOrder(b));
}

// 같은 날 안의 순서. 관리자가 옮기지 않았으면 창단 → 입단 → 그 밖 → 퇴단 순이다.
function histOrder(item) {
    return Number.isFinite(item.ord) ? item.ord : 10 - histTypeOrder(item.type);
}

function histTypeOrder(type) {
    return { leave: 0, event: 1, broadcast: 1, match: 1, join: 2, founding: 3 }[type] ?? 1;
}

// "토마토(선수)" → { name, note }. 그날의 역할이 현재 직책과 다를 수 있어 note는 관리자만 적는다.
function histParseMember(entry) {
    const s = String(entry || '').trim();
    const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { name: m[1].trim(), note: m[2].trim() } : { name: s, note: '' };
}

function histFormatMember(name, note) {
    return note ? `${name}(${note})` : name;
}

// 단체 입단처럼 이름이 수십 개인 날이 있어 다섯 뒤로는 '+N명' 칸으로 접는다
const HIST_CHIP_VISIBLE = 5;
const HIST_STACK_FACES = 3;

function histAvatarSrc(entry, members, avatarUrlFn) {
    const name = typeof entry === 'string' ? entry : (entry && entry.name) || '';
    const m = (members || []).find(x => x['이름'] === name);
    return m && avatarUrlFn ? avatarUrlFn(m['SOOP ID']) : '';
}

function histMoreChipHtml(rest, members, avatarUrlFn, key) {
    const faces = rest
        .slice(0, HIST_STACK_FACES)
        .map(e => {
            const url = histAvatarSrc(e, members, avatarUrlFn);
            return url
                ? `<img class="hist-stack-face" src="${escapeHTML(url)}" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, 'hist-stack-face', '👤')}>`
                : `<span class="hist-stack-face">👤</span>`;
        })
        .join('');
    return `<button type="button" class="hist-chip hist-chip-more" data-hist-more="${key}"
                ${act('histToggleMembers', key)} aria-expanded="false">
                <span class="hist-stack">${faces}</span>
                <span class="hist-chip-name">+${rest.length}명</span>
            </button>`;
}

// 토글로 두면 잘못 눌러 닫히는 일이 잦아 한 번 펼치면 접지 않는다
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
        ? `<img class="hist-chip-ava" src="${escapeHTML(url)}" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, 'hist-chip-ava', '👤')}>`
        : `<span class="hist-chip-ava">👤</span>`;
    const noteHtml = note ? `<span class="hist-chip-role">${escapeHTML(note)}</span>` : '';
    return `<span class="hist-chip${m ? '' : ' is-unknown'}">${ava}<span class="hist-chip-name">${escapeHTML(name)}</span>${noteHtml}</span>`;
}

// 형식 필터. 공개·관리자 페이지가 각자 등록한 histRedraw로 다시 그린다.
let histTypeFilter = '';
function histFilterItems(items) {
    return histTypeFilter ? items.filter(x => x.type === histTypeFilter) : items;
}
function histRenderTypeBar(items) {
    const list = document.getElementById('history-type-list');
    if (!list || typeof renderAvatarBar !== 'function') return;
    const types = Object.keys(HISTORY_TYPES).filter(t => items.some(x => x.type === t));
    if (!types.includes(histTypeFilter)) histTypeFilter = '';
    renderAvatarBar(
        'history-type-list',
        avatarSelectAllItemHtml('history-type-all', act('histPickType', ''), `${items.length}`),
        types
            .map(
                t => `<div class="avatar-select-item hist-bar-item hist-type-${t}" id="history-type-${t}" role="button" tabindex="0"${act('histPickType', t)}>
                <span class="hist-bar-dot" aria-hidden="true"></span>
                <span class="avatar-select-name">${HISTORY_TYPES[t]}</span>
                <span class="avatar-select-tier">${items.filter(x => x.type === t).length}</span>
            </div>`
            )
            .join('')
    );
    setActiveAvatarItem(
        'history-type-list',
        document.getElementById(histTypeFilter ? `history-type-${histTypeFilter}` : 'history-type-all')
    );
}
function histPickType(type) {
    histTypeFilter = HISTORY_TYPES[type] ? type : '';
    if (typeof window.histRedraw === 'function') window.histRedraw();
}

const HIST_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const HIST_LOAD_FAILED_HTML =
    '<div class="content-state is-boxed">연혁을 불러오지 못했습니다. 잠시 후 다시 시도해주세요</div>';

// opts: { members, avatarUrl(soopId), admin }
function histTimelineHtml(items, opts) {
    opts = opts || {};
    if (!items.length) return '<div class="content-state is-boxed">등록된 연혁이 없습니다</div>';
    const byYear = new Map();
    items.forEach(item => {
        const y = item.date.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(item);
    });
    let html = '';
    byYear.forEach((list, year) => {
        html += `<div class="section-title hist-year" data-en="HISTORY"><span class="section-title-label">${escapeHTML(year)}</span><span class="title-count">${list.length}건</span></div>`;
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
    const key = escapeHTML(item.id);
    const media = thumb
        ? `
            <button type="button" class="hist-media${yt && !histSafeImage(item.image) ? ' is-video' : yt ? ' has-video' : ''}"${act('histOpenMedia', key)} aria-label="${yt ? '영상 보기' : '사진 크게 보기'}">
                <img src="${escapeHTML(thumb)}" alt="" loading="lazy">
                ${yt ? '<span class="hist-play" aria-hidden="true"></span>' : ''}
            </button>`
        : '';
    const members = (item.members || []).filter(Boolean);
    const chip = n => histMemberChipHtml(n, opts.members, opts.avatarUrl);
    let chips = '';
    // '+1명' 칸은 이름 칸만큼 자리를 먹으므로 한 명만 남을 때는 접지 않는다
    if (members.length && members.length <= HIST_CHIP_VISIBLE + 1) {
        chips = `<div class="hist-chips">${members.map(chip).join('')}</div>`;
    } else if (members.length) {
        const shown = members.slice(0, HIST_CHIP_VISIBLE);
        const rest = members.slice(HIST_CHIP_VISIBLE);
        chips =
            `<div class="hist-chips">${shown.map(chip).join('')}` +
            `<span class="hist-chips-rest" data-hist-rest="${key}" hidden>${rest.map(chip).join('')}</span>` +
            `${histMoreChipHtml(rest, opts.members, opts.avatarUrl, key)}</div>`;
    }
    const adminBar = opts.admin
        ? `
            <div class="hist-admin-bar">
                <span class="hist-move">
                    <button type="button" aria-label="위로" ${opts.firstOfDay ? 'disabled' : ''} ${act('histAdminMove', key, -1)}>▲</button>
                    <button type="button" aria-label="아래로" ${opts.lastOfDay ? 'disabled' : ''} ${act('histAdminMove', key, 1)}>▼</button>
                </span>
                ${item.auto ? '<span class="hist-auto">자동</span>' : ''}${item.hidden ? '<span class="hist-auto is-hidden">숨김</span>' : ''}
                <button type="button" class="edit-btn"${act('histAdminEdit', key)}>수정</button>
                <button type="button" class="delete-btn"${act('histAdminToggleHidden', key)}>${item.hidden ? '보이기' : '숨기기'}</button>
            </div>`
        : '';
    return `
        <li class="hist-item hist-type-${type}${item.hidden ? ' is-hidden' : ''}" data-hist-id="${key}">
          <div class="hist-card">
            <div class="hist-main">
                <div class="hist-meta">
                    <time class="hist-date" datetime="${escapeHTML(item.date)}">${dateText}<small>${weekday}</small></time>
                    <span class="hist-type">${HISTORY_TYPES[type]}</span>
                </div>
                <div class="hist-title">${escapeHTML(item.title || HISTORY_TYPES[type])}</div>
                ${item.desc ? `<div class="hist-desc">${escapeHTML(item.desc)}</div>` : ''}
                ${chips}
                ${adminBar}
            </div>
            ${media}
          </div>
        </li>`;
}

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

// 관리자는 숨긴 항목까지 주는 load를 넘긴다. 빈 목록으로 바꾸면 관리자가 그 위에 순서를 저장하게 되므로 실패는 그대로 던진다.
async function histLoadData(load) {
    const data = await (load ? load() : Api.history());
    const out = { items: [], overrides: {} };
    (data || []).forEach(r => {
        const value = {
            title: r.title || '',
            desc: r.description || '',
            members: Array.isArray(r.members) ? r.members : [],
            youtube: r.youtube_url || '',
            image: r.image_path || '',
            hidden: !!r.hidden,
        };
        if (Number.isFinite(r.sort_order)) value.ord = r.sort_order;
        if (r.entry_kind === 'override') out.overrides[r.id] = value;
        else out.items.push({ id: r.id, date: String(r.event_date || ''), type: r.event_type || 'event', ...value });
    });
    return out;
}
