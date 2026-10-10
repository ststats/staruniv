// 멀티뷰어 공용 로직(page-tools.js와 multiview.html). 선택 목록 계산과 마크업만 두고 다시 그리기·저장은 각 페이지가 한다.
// act가 부르는 mvToggleMember · mvMove · mvRemove · mvSetFocusTarget은 두 페이지가 같은 이름으로 정의한다.

const MV_MIN_COLS = 1,
    MV_MAX_COLS = 4;
const MV_AUTO_COLS = 0;
const MV_VIDEO_AR = 16 / 9;

function mvParseCols(value) {
    const n = parseInt(value, 10);
    return n >= MV_MIN_COLS && n <= MV_MAX_COLS ? n : MV_AUTO_COLS;
}
function mvColsLabel(cols) {
    return cols ? String(cols) : '자동';
}
// 자동이면 지금 잡힌 열 수(base)에서 출발하고, 1에서 더 줄이면 자동으로 돌아간다.
function mvStepCols(cols, delta, base) {
    if (!cols) return Math.min(MV_MAX_COLS, Math.max(MV_MIN_COLS, base + delta));
    const next = cols + delta;
    return next < MV_MIN_COLS ? MV_AUTO_COLS : Math.min(MV_MAX_COLS, next);
}

// 검은 띠를 뺀 실제 화면 넓이
function mvShownArea(w, h) {
    const vw = Math.min(w, h * MV_VIDEO_AR);
    return (vw * vw) / MV_VIDEO_AR;
}
// 보이는 넓이 합 → 빈 칸 수 → 가로 화면이면 열 많은 쪽, 세로면 적은 쪽 순으로 고른다.
function mvAutoGridCols(count, width, height) {
    let best = null;
    for (let cols = 1; cols <= Math.min(MV_MAX_COLS, count); cols++) {
        const rows = Math.ceil(count / cols);
        const key = [
            Math.round((count * mvShownArea(width / cols, height / rows)) / 100),
            -(cols * rows - count),
            width >= height ? cols : -cols,
        ];
        const diff = best ? key.findIndex((v, i) => v !== best.key[i]) : 0;
        if (!best || (diff !== -1 && key[diff] > best.key[diff])) best = { key, cols };
    }
    return best ? best.cols : 1;
}
const MV_SHARED_SOOP_ID_PATTERN = /^[a-z0-9_-]+$/;

function mvSharedEscapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(
        /[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[tag]
    );
}

function mvAvatarHtml(soopId) {
    const id = String(soopId || '')
        .trim()
        .toLowerCase();
    const fallback = '<span class="mv-chip-avatar d-flex align-items-center justify-content-center">👤</span>';
    if (!MV_SHARED_SOOP_ID_PATTERN.test(id)) return fallback;
    const url = `https://stimg.sooplive.com/LOGO/${id.substring(0, 2)}/${id}/m/${id}.webp`;
    return `<img src="${url}" class="mv-chip-avatar" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, 'mv-chip-avatar d-flex align-items-center justify-content-center', '👤')}>`;
}

// 공개 읽기 함수는 숫자뿐인 아이디를 숫자로 준다. 창은 소문자 문자열만 받으므로 맞추지 않으면 멤버가 빠진다.
const mvSoopKey = id =>
    String(id ?? '')
        .trim()
        .toLowerCase();

function mvChipHtml(m, selected, isLive) {
    const soopId = mvSoopKey(m['SOOP ID']);
    return `
        <div class="mv-chip${selected ? ' active' : ''}" role="button" tabindex="0" aria-pressed="${!!selected}"${act('mvToggleMember', soopId, m['이름'])}>
            ${mvAvatarHtml(soopId)}
            <span class="mv-chip-name">${mvSharedEscapeHTML(m['이름'])}</span>
            ${isLive ? '<span class="mv-chip-live" role="img" aria-label="방송 중" title="방송 중"></span>' : ''}
        </div>`;
}

function mvMoveEntry(order, idx, dir) {
    const target = idx + dir;
    if (idx < 0 || idx >= order.length || target < 0 || target >= order.length) return false;
    [order[idx], order[target]] = [order[target], order[idx]];
    return true;
}

// 지정한 메인이 목록에서 빠졌으면 1번을 메인으로 쓴다
function mvFocusEntryId(order, focusId) {
    if (focusId && order.some(e => e.soopId === focusId)) return focusId;
    return order.length ? order[0].soopId : null;
}

function mvOrderItemHtml(entry, idx, order, focus, focusEntryId) {
    const isFocusTarget = focus && focusEntryId === entry.soopId;
    const isFirst = idx === 0,
        isLast = idx === order.length - 1;
    const name = mvSharedEscapeHTML(entry.name);
    return `<div class="mv-order-detail${isFocusTarget ? ' focus-target' : ''}">
        <span class="mv-order-position">${String(idx + 1).padStart(2, '0')}</span>
        ${mvAvatarHtml(entry.soopId)}
        <div class="mv-order-identity"><strong>${name}</strong></div>
        ${focus ? `<button type="button" class="mv-order-focus" aria-pressed="${isFocusTarget}" aria-label="${name} 메인 방송으로 선택"${act('mvSetFocusTarget', entry.soopId)}>${isFocusTarget ? '메인' : '메인으로'}</button>` : ''}
        <div class="mv-order-actions">
            <button type="button" aria-label="${name} 위로 이동"${act('mvMove', idx, -1)} ${isFirst ? 'disabled' : ''}>↑</button>
            <button type="button" aria-label="${name} 아래로 이동"${act('mvMove', idx, 1)} ${isLast ? 'disabled' : ''}>↓</button>
            <button type="button" class="mv-order-remove" aria-label="${name} 목록에서 제거"${act('mvRemove', idx)}>×</button>
        </div>
    </div>`;
}

// 멤버 이름이 우선이고, 아니면 숲 아이디로 본다. 알림 방식은 호출 쪽이 정하도록 { error }만 돌려준다.
function mvResolveCustomInput(raw, order, memberList) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const members = Array.isArray(memberList) ? memberList : [];
    const lowered = trimmed.toLowerCase();
    const isInOrder = soopId => order.some(e => e.soopId === soopId);

    const byName = members.find(m => m && m['이름'] != null && String(m['이름']).trim().toLowerCase() === lowered);
    if (byName) {
        const soopId = mvSoopKey(byName['SOOP ID']);
        if (isInOrder(soopId)) return { error: '이미 선택된 목록에 있습니다' };
        return { entry: { soopId, name: byName['이름'], isMember: true } };
    }

    const id = lowered;
    if (!MV_SHARED_SOOP_ID_PATTERN.test(id))
        return { error: '멤버 이름이 아니면 숲 아이디 형식(영문/숫자/-/_)이어야 합니다' };
    if (isInOrder(id)) return { error: '이미 추가된 아이디입니다' };
    const knownMember = members.find(m => m && mvSoopKey(m['SOOP ID']) === id);
    return {
        entry: knownMember
            ? { soopId: id, name: knownMember['이름'], isMember: true }
            : { soopId: id, name: id, isMember: false },
    };
}
