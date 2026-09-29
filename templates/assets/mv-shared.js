/**
 * 멀티뷰어 공용 로직.
 *
 * page-tools.js(도구 탭 - 누구를 어떤 순서·배치로 볼지 고르고 새 창을 연다)와 multiview.html
 * (실제 방송 그리드, 자체 창)이 같이 쓰는 부품. 두 페이지 모두 <script src="mv-shared.js">로 불러온다.
 * 선택 목록(order: [{ soopId, name, isMember }])의 계산과 마크업만 여기에 두고, 목록이 바뀐 뒤
 * 화면을 어떻게 다시 그리고 저장하는지는 두 페이지가 각자 한다(도구 탭은 목록만 다시 그리면 되고,
 * 창은 재생 중인 iframe을 건드리지 않고 그리드를 맞춰야 한다).
 *
 * 마크업의 onclick이 부르는 mvToggleMember · mvMove · mvRemove · mvSetFocusTarget은 두 페이지가
 * 같은 이름으로 정의한다.
 */

const MV_MIN_COLS = 1, MV_MAX_COLS = 4;   // 그리드 모드 열 개수 범위
// 숲 아이디 형식(영문 소문자/숫자/-/_) - 직접 입력값은 소문자로 바꾼 뒤 이 형식인지 본다.
const MV_SHARED_SOOP_ID_PATTERN = /^[a-z0-9_-]+$/;

function mvSharedEscapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

// SOOP 프로필 사진(작은 WebP). 형식이 이상한 아이디나 사진이 없으면 사람 모양으로 대신한다.
function mvAvatarHtml(soopId) {
    const id = String(soopId || '').trim().toLowerCase();
    const fallback = '<span class="mv-chip-avatar d-flex align-items-center justify-content-center">👤</span>';
    if (!MV_SHARED_SOOP_ID_PATTERN.test(id)) return fallback;
    const url = `https://stimg.sooplive.com/LOGO/${id.substring(0, 2)}/${id}/m/${id}.webp`;
    return `<img src="${url}" class="mv-chip-avatar" alt="" loading="lazy"${actOn('error', 'imgSwap', ACT.el, 'mv-chip-avatar d-flex align-items-center justify-content-center', '👤')}>`;
}

// 멤버 고르기 칩 하나. m은 사이트 멤버 행({ '이름', 'SOOP ID' }).
function mvChipHtml(m, selected, isLive) {
    const soopId = m['SOOP ID'];
    return `
        <div class="mv-chip${selected ? ' selected' : ''}" role="button" tabindex="0" aria-pressed="${!!selected}"${act('mvToggleMember', soopId, m['이름'])}>
            ${mvAvatarHtml(soopId)}
            <span class="mv-chip-name">${mvSharedEscapeHTML(m['이름'])}</span>
            ${isLive ? '<span class="mv-chip-live" role="img" aria-label="방송 중" title="방송 중"></span>' : ''}
        </div>`;
}

// 목록에서 idx번을 dir(-1 위 / +1 아래)만큼 옮긴다. 옮겼으면 true.
function mvMoveEntry(order, idx, dir) {
    const target = idx + dir;
    if (idx < 0 || idx >= order.length || target < 0 || target >= order.length) return false;
    [order[idx], order[target]] = [order[target], order[idx]];
    return true;
}

// 포커스 모드에서 크게 보여줄 대상의 soopId를 정한다. 명시적으로 지정한 대상(focusId)이
// 아직 목록에 있으면 그걸, 없으면(처음이거나 방금 지워진 경우) 목록 1번을 기본값으로 쓴다.
function mvFocusEntryId(order, focusId) {
    if (focusId && order.some(e => e.soopId === focusId)) return focusId;
    return order.length ? order[0].soopId : null;
}

// "선택된 목록" 한 줄(순번 + 이름 + 메인 지정 + 위/아래/빼기)의 마크업.
// 포커스 모드일 때만 '메인으로' 버튼이 나오고, 지금 메인인 줄에는 focus-target 클래스가 붙는다.
function mvOrderItemHtml(entry, idx, order, focus, focusEntryId) {
    const isFocusTarget = focus && focusEntryId === entry.soopId;
    const isFirst = idx === 0, isLast = idx === order.length - 1;
    const name = mvSharedEscapeHTML(entry.name);
    return `<div class="mv-order-detail${isFocusTarget ? ' focus-target' : ''}">
        <span class="mv-order-position">${String(idx + 1).padStart(2, '0')}</span>
        <div class="mv-order-identity"><strong>${name}</strong></div>
        ${focus ? `<button type="button" class="mv-order-focus" aria-pressed="${isFocusTarget}" aria-label="${name} 메인 방송으로 선택"${act('mvSetFocusTarget', entry.soopId)}>${isFocusTarget ? '메인' : '메인으로'}</button>` : ''}
        <div class="mv-order-actions">
            <button type="button" aria-label="${name} 위로 이동"${act('mvMove', idx, -1)} ${isFirst ? 'disabled' : ''}>↑</button>
            <button type="button" aria-label="${name} 아래로 이동"${act('mvMove', idx, 1)} ${isLast ? 'disabled' : ''}>↓</button>
            <button type="button" class="mv-order-remove" aria-label="${name} 목록에서 제거"${act('mvRemove', idx)}>×</button>
        </div>
    </div>`;
}

// "이름 또는 숲아이디 직접 입력" 한 줄을 실제로 추가할 항목으로 바꾼다.
// alert()는 여기서 하지 않고 { error }로만 알려준다 - 알림 방식은 호출하는 쪽이 정한다.
//   1) 멤버 이름과 정확히 일치하면(대소문자 무시) 그 멤버를 추가한다.
//   2) 이름이 아니면 숲 아이디(영문/숫자/-/_)로 취급하고, 우리 멤버의 아이디와 일치하면
//      실제 이름으로, 아니면 익명 항목으로 추가한다.
// 반환값: 입력이 비어있으면 null, 문제가 있으면 { error }, 정상이면 { entry }.
function mvResolveCustomInput(raw, order, memberList) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const members = Array.isArray(memberList) ? memberList : [];
    const lowered = trimmed.toLowerCase();
    const isInOrder = soopId => order.some(e => e.soopId === soopId);

    const byName = members.find(m => m && m['이름'] != null && String(m['이름']).trim().toLowerCase() === lowered);
    if (byName) {
        if (isInOrder(byName['SOOP ID'])) return { error: '이미 선택된 목록에 있습니다' };
        return { entry: { soopId: byName['SOOP ID'], name: byName['이름'], isMember: true } };
    }

    const id = lowered;
    if (!MV_SHARED_SOOP_ID_PATTERN.test(id)) return { error: '멤버 이름이 아니면 숲 아이디 형식(영문/숫자/-/_)이어야 합니다' };
    if (isInOrder(id)) return { error: '이미 추가된 아이디입니다' };
    const knownMember = members.find(m => m && m['SOOP ID'] === id);
    return { entry: knownMember
        ? { soopId: id, name: knownMember['이름'], isMember: true }
        : { soopId: id, name: id, isMember: false } };
}
