/**
 * 멀티뷰어 공용 로직.
 *
 * app.js(도구 탭 - 누구를 볼지 설정만 담당)와 multiview.html(실제 방송 그리드,
 * 자체 창)이 "선택 목록(mvOrder)"에 관한 로직을 이름까지 똑같이 각자 구현하고
 * 있던 걸 여기로 뽑았다. 두 페이지 모두 <script src="mv-shared.js">로 이
 * 파일을 불러와 쓴다.
 *
 * 그리드를 실제로 유지·조작하는 부분(포커스 대상 전환, 순서 이동, 삭제 시
 * DOM을 어떻게 다시 그리는지)은 두 페이지의 역할이 근본적으로 달라서
 * (multiview.html은 재생 중인 iframe이 안 끊기게 DOM 위치만 바꾸고, app.js는
 * 그리드 자체가 없어 매번 목록만 다시 그리면 됨) 일부러 여기 담지 않고 각
 * 페이지에 그대로 남겨뒀다. 이 파일에는 "입력값을 보고 어떤 항목을 목록에
 * 추가할지" 같은, 두 페이지가 정말 한 글자도 다르지 않게 계산해야 하는
 * 순수 로직만 담는다.
 *
 * escapeHTML/jsStrEscape는 멀티뷰어만의 개념이 아니라 각 페이지가 이미 자체
 * 유틸로 갖고 있는 범용 함수라 여기서 다시 정의하지 않는다 - 대신 이 파일의
 * 함수들이 두 페이지 모두에 이미 전역으로 존재하는 그 함수들을 그대로
 * 호출하므로, 반드시 이 파일보다 먼저(또는 같은 <script> 태그 순서 안에서)
 * escapeHTML/jsStrEscape가 정의돼 있어야 한다.
 */

// 포커스 모드에서 크게 보여줄 대상의 soopId를 정한다. 명시적으로 지정한
// 대상(focusId)이 아직 목록에 있으면 그걸, 없으면(처음이거나 방금 지워진
// 경우) 목록 1번을 기본값으로 쓴다.
function mvFocusEntryId(order, focusId) {
    if (focusId && order.some(e => e.soopId === focusId)) return focusId;
    return order.length ? order[0].soopId : null;
}

// "선택된 목록" 한 줄(순번 + 위/아래 버튼 + 이름 + 빼기 버튼)의 마크업.
// 포커스 모드일 때만 행 자체가 클릭 가능(selectable)해지고, 지금 포커스
// 대상인 행에는 focus-target 클래스가 붙는다. 위/아래/빼기 버튼이 부르는
// mvMove(idx, dir)와 mvRemove(idx)는 페이지마다 구현이 다르므로(그리드 DOM을
// 직접 조작하는지 여부) 여기서 정의하지 않고 각 페이지가 같은 이름으로
// 반드시 정의해야 한다.
function mvOrderItemHtml(entry, idx, order, focus, focusEntryId) {
    const isFocusTarget = focus && focusEntryId === entry.soopId;
    const rowClick = focus ? ` onclick="mvSetFocusTarget('${jsStrEscape(entry.soopId)}')"` : '';
    return `
    <div class="mv-order-item${entry.isMember ? '' : ' custom'}${isFocusTarget ? ' focus-target' : ''}${focus ? ' selectable' : ''}"${rowClick}>
        <span class="mv-order-num">${idx + 1}.</span>
        <button type="button" title="위로" onclick="event.stopPropagation(); mvMove(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" title="아래로" onclick="event.stopPropagation(); mvMove(${idx}, 1)" ${idx === order.length - 1 ? 'disabled' : ''}>▼</button>
        <span class="mv-order-name">${escapeHTML(entry.name)}</span>
        <button type="button" class="mv-order-remove" title="빼기" onclick="event.stopPropagation(); mvRemove(${idx})">✕</button>
    </div>`;
}

// "이름 또는 숲아이디 직접 입력" 한 줄을 실제로 추가할 항목으로 바꾼다.
// alert()는 여기서 직접 하지 않고 { error } 로만 알려준다 - 호출하는 쪽이
// 알림 방식을 자유롭게 정할 수 있게 하기 위함이다.
//   1) 멤버 이름과 정확히 일치하면(대소문자 무시) 그 멤버를 추가한다.
//   2) 이름이 아니면 숲 아이디(영문/숫자/-/_)로 취급하고, 우리 멤버의
//      아이디와 일치하면 실제 이름으로, 아니면 익명 항목으로 추가한다.
// 반환값: 입력이 비어있으면 null, 문제가 있으면 { error }, 정상이면 { entry }.
function mvResolveCustomInput(raw, order, memberList) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;

    const byName = memberList.find(m => String(m['이름']).trim().toLowerCase() === trimmed.toLowerCase());
    if (byName) {
        if (order.some(e => e.soopId === byName['SOOP ID'])) return { error: '이미 선택된 목록에 있습니다.' };
        return { entry: { soopId: byName['SOOP ID'], name: byName['이름'], isMember: true } };
    }

    const id = trimmed.toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(id)) return { error: '멤버 이름이 아니면 숲 아이디 형식(영문/숫자/-/_)이어야 합니다.' };
    if (order.some(e => e.soopId === id)) return { error: '이미 추가된 아이디입니다.' };
    const knownMember = memberList.find(m => m['SOOP ID'] === id);
    const entry = knownMember ? { soopId: id, name: knownMember['이름'], isMember: true } : { soopId: id, name: id, isMember: false };
    return { entry };
}
