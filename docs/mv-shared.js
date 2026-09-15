/**
 * 멀티뷰어 공용 로직.
 *
 * app.js(도구 탭 - 누구를 볼지 설정만 담당)와 multiview.html(실제 방송 그리드, 자체 창)이
 * "선택 목록(mvOrder)"에 관한 로직을 이름까지 똑같이 각자 구현하고 있던 걸 여기로 뽑았다.
 * 두 페이지 모두 <script src="mv-shared.js">로 이 파일을 불러와 쓴다.
 *
 * 그리드를 실제로 유지·조작하는 부분(포커스 대상 전환, 순서 이동, 삭제 시 DOM을 어떻게 다시
 * 그리는지)은 두 페이지의 역할이 근본적으로 달라서 각 페이지에 남겨뒀다. 이 파일에는 두 페이지가
 * 한 글자도 다르지 않게 계산해야 하는 순수 로직만 담는다.
 *
 * [전역 의존성] escapeHTML/jsStrEscape는 각 페이지(app.js, multiview.html)가 이미 전역으로
 * 갖고 있는 범용 유틸이라 여기서 다시 정의하지 않는다(정의하면 admin 등 다른 페이지의
 * const 선언과 이름이 부딪힐 수 있다). 대신 아래 mvShared* 래퍼를 거쳐서 호출하므로,
 * 혹시 로드 순서가 꼬여 전역 함수가 없더라도 예외로 멈추지 않고 같은 규칙의 내장
 * 대체 구현으로 동작한다(두 페이지의 escapeHTML/jsStrEscape와 결과가 동일).
 *
 * [보강] 행 클릭 핸들러 onclick="mvSetFocusTarget('...')"에 값을 넣을 때 예전엔
 * jsStrEscape만 거쳐서, 값에 큰따옴표가 섞이면 속성이 끊길 수 있었다. JS 이스케이프 후
 * HTML 이스케이프를 한 번 더 한다(평범한 숲 아이디는 결과가 예전과 같다).
 */

function mvSharedEscapeHTML(str) {
    if (typeof escapeHTML === 'function') return escapeHTML(str);
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

function mvSharedJsStrEscape(str) {
    if (typeof jsStrEscape === 'function') return jsStrEscape(str);
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// HTML 속성 안의 JS 문자열 리터럴용 (app.js의 jsAttr와 같은 규칙)
function mvSharedJsAttr(str) {
    return mvSharedEscapeHTML(mvSharedJsStrEscape(str));
}

// 숲 아이디 형식(영문 소문자/숫자/-/_) - 직접 입력값은 소문자로 바꾼 뒤 이 형식인지 본다.
const MV_SHARED_SOOP_ID_PATTERN = /^[a-z0-9_-]+$/;

// 포커스 모드에서 크게 보여줄 대상의 soopId를 정한다. 명시적으로 지정한 대상(focusId)이
// 아직 목록에 있으면 그걸, 없으면(처음이거나 방금 지워진 경우) 목록 1번을 기본값으로 쓴다.
function mvFocusEntryId(order, focusId) {
    if (focusId && order.some(e => e.soopId === focusId)) return focusId;
    return order.length ? order[0].soopId : null;
}

// "선택된 목록" 한 줄(순번 + 위/아래 버튼 + 이름 + 빼기 버튼)의 마크업.
// 포커스 모드일 때만 행 자체가 클릭 가능(selectable)해지고, 지금 포커스 대상인 행에는
// focus-target 클래스가 붙는다. 위/아래/빼기 버튼이 부르는 mvMove(idx, dir)와 mvRemove(idx),
// 행 클릭이 부르는 mvSetFocusTarget(soopId)는 페이지마다 구현이 다르므로(그리드 DOM을 직접
// 조작하는지 여부) 여기서 정의하지 않고 각 페이지가 같은 이름으로 반드시 정의해야 한다.
function mvOrderItemHtml(entry, idx, order, focus, focusEntryId) {
    const isFocusTarget = focus && focusEntryId === entry.soopId;
    const rowClick = focus ? ` onclick="mvSetFocusTarget('${mvSharedJsAttr(entry.soopId)}')"` : '';
    const isFirst = idx === 0, isLast = idx === order.length - 1;
    return `
    <div class="mv-order-item${entry.isMember ? '' : ' custom'}${isFocusTarget ? ' focus-target' : ''}${focus ? ' selectable' : ''}"${rowClick}>
        <span class="mv-order-num">${idx + 1}.</span>
        <button type="button" title="위로" aria-label="위로" onclick="event.stopPropagation(); mvMove(${idx}, -1)" ${isFirst ? 'disabled' : ''}>▲</button>
        <button type="button" title="아래로" aria-label="아래로" onclick="event.stopPropagation(); mvMove(${idx}, 1)" ${isLast ? 'disabled' : ''}>▼</button>
        <span class="mv-order-name">${mvSharedEscapeHTML(entry.name)}</span>
        <button type="button" class="mv-order-remove" title="빼기" aria-label="빼기" onclick="event.stopPropagation(); mvRemove(${idx})">✕</button>
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
        if (isInOrder(byName['SOOP ID'])) return { error: '이미 선택된 목록에 있습니다.' };
        return { entry: { soopId: byName['SOOP ID'], name: byName['이름'], isMember: true } };
    }

    const id = lowered;
    if (!MV_SHARED_SOOP_ID_PATTERN.test(id)) return { error: '멤버 이름이 아니면 숲 아이디 형식(영문/숫자/-/_)이어야 합니다.' };
    if (isInOrder(id)) return { error: '이미 추가된 아이디입니다.' };
    const knownMember = members.find(m => m && m['SOOP ID'] === id);
    return { entry: knownMember
        ? { soopId: id, name: knownMember['이름'], isMember: true }
        : { soopId: id, name: id, isMember: false } };
}
