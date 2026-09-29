// 멀티뷰어 창(multiview.html) 전용 스크립트. CSP로 인라인 스크립트를 막으므로 HTML 안이 아니라 파일로 둔다.
// ===== 상태 =====
// order: [{ soopId, name, isMember }] - 화면에 그려지는 순서 그대로.
// 칩·목록 마크업과 목록 계산은 도구 탭(page-tools.js)과 같이 쓰는 mv-shared.js에 있다.
const mvEsc = mvSharedEscapeHTML;
let mvOrder = [];
let mvCols = MV_AUTO_COLS;
let mvFocus = true;
let mvFocusId = null;  // 포커스 모드에서 크게 보여줄 대상(soopId) - 목록 순서와 무관하게 별도 지정
let mvMembers = [];    // 사이트 멤버(활동 중 + 숲 아이디 있음) - 사이트 데이터(data/site_shell.json)에서
let mvLiveMap = {};    // soopId(소문자) -> 방송 중

function mvSaveState() {
    try {
        localStorage.setItem('mv-order', JSON.stringify(mvOrder));
        localStorage.setItem('mv-grid-cols', String(mvCols));
        localStorage.setItem('mv-focus', mvFocus ? '1' : '0');
        localStorage.setItem('mv-focus-id', mvFocusId || '');
    } catch (e) { /* localStorage 접근 불가한 환경이면 그냥 무시 */ }
}

function mvInit() {
    const params = new URLSearchParams(location.search);
    let list = null;
    if (params.has('list')) {
        try { list = JSON.parse(params.get('list')); } catch (e) { list = null; }
    }
    if (Array.isArray(list) && list.length > 0) {
        mvOrder = list
            .filter(e => e && typeof e.id === 'string' && /^[a-z0-9_-]+$/i.test(e.id))
            .map(e => ({ soopId: e.id.toLowerCase(), name: e.name || e.id, isMember: !!e.isMember }))
            .filter((e, i, arr) => arr.findIndex(x => x.soopId === e.soopId) === i); // 같은 방송 중복 제거
        mvCols = mvParseCols(params.get('cols'));
        mvFocus = params.get('focus') === '1';
        mvFocusId = params.get('focusId') || null;
        // 도구 탭에서 명시적으로 넘긴 다크모드 설정이 있으면 그걸 우선한다
        // (없으면 아래에서 마지막으로 써둔 localStorage 값을 그대로 쓴다).
        if (params.get('theme') === 'dark' || params.get('theme') === 'light') {
            mvApplyTheme(params.get('theme'));
        }
    } else {
        // URL에 아무것도 없으면(직접 이 페이지를 열었거나 새로고침한 경우) 마지막으로
        // 저장해둔 상태를 이어서 보여준다.
        try {
            mvOrder = JSON.parse(localStorage.getItem('mv-order') || '[]')
                .filter((e, i, arr) => e && typeof e.soopId === 'string' && arr.findIndex(x => x && x.soopId === e.soopId) === i);
            // 예전 'mv-cols'(기본 2가 늘 저장됨)는 무시하고, 자동이 기본인 새 키만 읽는다.
            mvCols = mvParseCols(localStorage.getItem('mv-grid-cols'));
            mvFocus = localStorage.getItem('mv-focus') !== null ? localStorage.getItem('mv-focus') === '1' : true;
            mvFocusId = localStorage.getItem('mv-focus-id') || null;
        } catch (e) { mvOrder = []; mvCols = MV_AUTO_COLS; mvFocus = true; mvFocusId = null; }
    }
    mvApplyModeButtons();
}

// ===== 다크모드 (도구 탭과 같은 버튼형 스위치) =====
function mvApplyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('mv-theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', btn.classList.toggle('on', theme === 'dark'));
    localStorage.setItem('mv-theme', theme);
}
function mvToggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    mvApplyTheme(current === 'dark' ? 'light' : 'dark');
}

// ===== 설정 패널 여닫기 =====
function mvApplySettingsPanel(open) {
    document.getElementById('mv-settings-panel').classList.toggle('open', open);
    const fab = document.getElementById('mv-fab');
    fab.classList.toggle('on', open);
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? '설정 닫기' : '설정 열기');
}
function mvToggleSettingsPanel() {
    const isOpen = document.getElementById('mv-settings-panel').classList.contains('open');
    mvApplySettingsPanel(!isOpen);
}

// ===== 열 개수 =====
function mvCurrentAutoCols() {
    const area = document.getElementById('mv-grid-area');
    return mvAutoGridCols(Math.max(1, mvOrder.length), area.clientWidth, area.clientHeight);
}
function mvChangeCols(delta) {
    mvCols = mvStepCols(mvCols, delta, mvCurrentAutoCols());
    document.getElementById('mv-cols-value').innerText = mvColsLabel(mvCols);
    mvApplyGridColumns();
    mvSaveState();
}
function mvApplyGridColumns() {
    mvRelayoutGridDims();
}

// 포커스 모드: 메인은 늘 2×2칸, 나머지는 1칸씩인 균일 그리드. 방송 화면은 16:9라 칸 모양에 따라
// 위아래·좌우가 검은 띠로 버려지므로, 칸 안에 실제로 보이는 작은 화면이 가장 커지는 열·행 수를 고른다
// (메인은 작은 화면의 정확히 2배). 방송이 늘면 들어갈 수 있는 배치가 줄어들 뿐이라 메인·작은 화면이
// 커지는 일은 없다. 같은 크기면 빈 칸이 적은 쪽 → 칸 비율이 16:9에 가까운 쪽 → 화면 방향으로 긴 쪽.
// 배치는 CSS Grid 자동배치 - 메인이 왼쪽 위, 나머지는 목록 순서대로 오른쪽 → 아래를 채우고 남는 칸은 빈 칸.
function mvComputeFocusGridDims(totalW, totalH, restCount) {
    const W = totalW || 1, H = totalH || 1;
    let best = null;
    for (let cols = 2; cols <= 8; cols++) {
        for (let rows = 2; rows <= 8; rows++) {
            const empty = cols * rows - (4 + restCount);
            if (empty < 0) continue;
            const cw = W / cols, ch = H / rows;
            const key = [Math.round(Math.min(cw, ch * MV_VIDEO_AR)), -empty,
                -Math.round(Math.abs(Math.log(cw / ch / MV_VIDEO_AR)) * 100), W >= H ? cols : rows];
            const diff = best ? key.findIndex((v, i) => v !== best.key[i]) : 0;
            if (!best || (diff !== -1 && key[diff] > best.key[diff])) best = { key, cols, rows };
        }
    }
    return best || { cols: 2, rows: 2 + Math.ceil(restCount / 2) };
}

function mvApplyModeButtons() {
    const toggle = document.getElementById('mv-mode-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', toggle.classList.toggle('on', !mvFocus));
}
function mvSetFocusMode(isFocus) {
    if (isFocus === mvFocus) return;
    mvFocus = isFocus;
    mvApplyModeButtons();
    mvApplyColsGroupVisibility();
    mvRenderOrderRow();
    mvRenderGrid();
    mvSaveState();
}
// 포커스/그리드 pill에 붙은 새로고침 버튼: 누를 때마다 현재 모드의 반대로 전환한다.
function mvToggleFocusMode() {
    mvSetFocusMode(!mvFocus);
}
function mvApplyColsGroupVisibility() {
    // 포커스 모드에서는 열 개수가 화면 크기·인원 수 기준 자동 계산
    // (mvComputeFocusGridDims)으로 정해지고 이 스테퍼 값은 아예 안 쓰이므로,
    // 요소를 아예 숨기지 않고 흐릿하게 비활성화만 한다(보였다 안 보였다
    // 하면 레이아웃이 덜컹거려서 오히려 지저분해 보인다).
    document.getElementById('mv-col-tile').classList.toggle('disabled', mvFocus);
}

// ===== 멤버 선택 칩(도구 탭과 같은 칩 - mv-shared.js mvChipHtml) =====
function mvRenderMemberChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    container.innerHTML = mvMembers.length
        ? mvMembers.map(m => mvChipHtml(m, mvOrder.some(e => e.soopId === m['SOOP ID']), !!mvLiveMap[m['SOOP ID']])).join('')
        : '<div class="mv-chip-empty">멤버 목록을 불러오지 못했습니다</div>';
}
function mvToggleMember(soopId, name) {
    const idx = mvOrder.findIndex(e => e.soopId === soopId);
    if (idx !== -1) { mvRemove(idx); return; }
    mvOrder.push({ soopId, name, isMember: true });
    mvAfterOrderChange();
}
// 멤버는 사이트가 빌드 때 만들어 두는 공개 데이터에서 읽는다(도구 탭과 같은 목록·순서).
// members 표는 공개 조회가 막혀 있어 직접 읽을 수 없다.
async function mvLoadMembers() {
    try {
        const data = await Api.siteData('shell');
        mvMembers = (Array.isArray(data.members) ? data.members : [])
            .filter(m => m && !m['퇴단일'] && MV_SHARED_SOOP_ID_PATTERN.test(String(m['SOOP ID'] || '').trim().toLowerCase()))
            .map(m => ({ '이름': m['이름'] || '', 'SOOP ID': String(m['SOOP ID']).trim().toLowerCase() }));
    } catch (e) { mvMembers = []; }
    mvRenderMemberChips();
    mvCheckLiveMembers();
}
// 방송 중 여부: ststat live-status가 2분마다 채우는 live_broadcasts_current를 한 번만 읽는다
// (멤버마다 SOOP에 묻지 않는다).
async function mvCheckLiveMembers() {
    if (!mvMembers.length) return;
    try {
        const rows = await Api.liveSoopIds();
        mvLiveMap = {};
        rows.forEach(r => { if (r && r.soop_id) mvLiveMap[String(r.soop_id).toLowerCase()] = true; });
        mvRenderMemberChips();
    } catch (e) { /* 방송 중 표시만 빠진다 */ }
}

// ===== 순서 목록 =====
function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    const focusEntryId = mvFocusEntryId(mvOrder, mvFocusId);
    row.innerHTML = mvOrder.length
        ? mvOrder.map((entry, idx) => mvOrderItemHtml(entry, idx, mvOrder, mvFocus, focusEntryId)).join('')
        : '<div class="mv-order-empty"><strong>선택된 방송이 없습니다</strong></div>';
}

// 칸 요소는 한 번 만들면 절대 옮기지 않고, 화면상 위치는 CSS Grid의 order 값으로만 바꾼다
// (mvRenderGrid 참고). 브라우저는 iframe을 DOM에서 떼었다 붙이면 그 안의 페이지를 새로 불러오므로,
// 칸을 맞바꾸거나 그리드를 다시 그리면 재생 중인 방송이 끊긴다. 이렇게 하면 추가/삭제되는 칸 자신
// 말고는 어떤 iframe도 다시 로드되지 않는다.
function mvAfterOrderChange() {
    mvRenderGrid();
    mvRenderMemberChips();
    mvRenderOrderRow();
    mvSaveState();
}

function mvSetFocusTarget(soopId) {
    if (soopId === mvFocusEntryId(mvOrder, mvFocusId)) return; // 이미 메인인 사람을 다시 누른 경우
    mvFocusId = soopId;
    if (mvFocus) mvRenderGrid();
    mvRenderOrderRow();
    mvSaveState();
}

function mvMove(idx, dir) {
    if (!mvMoveEntry(mvOrder, idx, dir)) return;
    mvRenderGrid();
    mvRenderOrderRow();
    mvSaveState();
}

function mvRemove(idx) {
    const removed = mvOrder[idx];
    if (!removed) return;
    mvOrder.splice(idx, 1);
    // 메인으로 지정했던 사람을 지우면 기본값(목록 1번)이 새 메인이 된다.
    if (mvFocusId === removed.soopId) mvFocusId = null;
    mvAfterOrderChange();
}

// 인원 수·화면 비율에 맞춰 그리드 열/행 개수만 다시 계산한다 - 칸 내용(iframe)은 손대지 않는다.
function mvRelayoutGridDims() {
    const grid = document.getElementById('mv-grid');
    if (!grid) return;
    const count = grid.children.length;
    if (count === 0) return;
    const area = document.getElementById('mv-grid-area');
    let cols, rows;
    if (mvFocus && count > 1) {
        ({ cols, rows } = mvComputeFocusGridDims(area.clientWidth, area.clientHeight, count - 1));
    } else {
        // 남은 칸이 열 개수보다 적으면 그만큼만 컬럼을 써서 빈 칸이 오른쪽에 휑하게 남지 않게 하고,
        // 행 개수를 못박아 세로도 뷰포트 안에 딱 맞게 나눈다. (포커스 모드에 혼자면 1×1 = 화면 전체)
        const want = mvFocus ? 1 : (mvCols || mvAutoGridCols(count, area.clientWidth, area.clientHeight));
        cols = Math.max(1, Math.min(want, count));
        rows = Math.ceil(count / cols);
    }
    const colsValue = `repeat(${cols}, 1fr)`, rowsValue = `repeat(${rows}, 1fr)`;
    if (grid.style.gridTemplateColumns !== colsValue) grid.style.gridTemplateColumns = colsValue;
    if (grid.style.gridTemplateRows !== rowsValue) grid.style.gridTemplateRows = rowsValue;
}

function mvAddCustom() {
    const input = document.getElementById('mv-add-input');
    const result = mvResolveCustomInput(input.value, mvOrder, mvMembers);
    if (!result) return;
    if (result.error) { alert(result.error); return; }
    mvOrder.push(result.entry);
    mvAfterOrderChange();
    input.value = '';
}

// ===== 그리드: 실시간 영상은 SOOP의 공식 라이브 임베드 엔드포인트
// (play.sooplive.com/{아이디}/embed)를 iframe으로 그대로 삽입한다. 채팅은
// 요청대로 껐고(showChat=false), 자동재생을 켜뒀다(autoPlay=true).
// 화질을 1080p 등으로 강제 요청하면 SOOP이 "고화질 스트리머"라는 PC 전용
// 로컬 프로그램에 연결을 시도하는데, 이게 iframe 안에서는 막혀서 재생이
// 안 됐다 - 화질 파라미터를 아예 안 넘기고 기본(자동) 화질로 열면 그
// 로컬 프로그램을 거치지 않고 정상 재생됨을 실제 테스트로 확인함.
function mvEmbedUrl(soopId) {
    const params = new URLSearchParams({ showChat: 'false', autoPlay: 'true' });
    return `https://play.sooplive.com/${encodeURIComponent(soopId)}/embed?${params.toString()}`;
}

const MV_ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';

// 칸 하나의 영상만 다시 불러온다(다른 칸의 재생에는 영향 없음). 새 iframe으로 통째로 바꾸면
// 로드가 딱 한 번이라, 그 load 이벤트로 로딩 표시를 끈다(src를 about:blank로 비웠다가 다시 넣으면
// load 이벤트가 두 번 와서 "로딩 끝" 시점을 알 수 없다).
const MV_SPIN_MIN_MS = 500, MV_SPIN_MAX_MS = 10000;

// iframe에 넘기는 권한. local-network-access/loopback-network는 SOOP 플레이어가 PC의
// '고화질 스트리머' 로컬 프로그램에 접속할 때 쓰는 권한으로, 실제 방송 재생에 영향이 없는지
// 확인되지 않아 원래대로 유지한다(보안상으로는 빼는 편이 좋으니, 실제 방송으로 재생이
// 문제없음을 확인한 뒤 이 두 항목만 지우면 된다).
const MV_IFRAME_ALLOW = 'autoplay; encrypted-media; fullscreen; local-network-access; loopback-network';
function mvReloadCell(cell) {
    const oldFrame = cell && cell.querySelector('iframe');
    if (!oldFrame) return;
    const soopId = cell.dataset.soopId;
    const btn = cell.querySelector('.mv-cell-refresh');
    const startedAt = Date.now();
    const stopSpin = () => {
        const wait = Math.max(0, MV_SPIN_MIN_MS - (Date.now() - startedAt));
        setTimeout(() => btn && btn.classList.remove('is-loading'), wait);
    };
    if (btn) btn.classList.add('is-loading');

    const frame = oldFrame.cloneNode(false);
    frame.removeAttribute('loading'); // 지금 화면에 보이는 칸이니 지연 로딩할 이유가 없다
    frame.addEventListener('load', stopSpin, { once: true });
    setTimeout(stopSpin, MV_SPIN_MAX_MS); // 응답이 없어도 버튼이 영원히 돌지 않게
    frame.src = mvEmbedUrl(soopId);
    oldFrame.replaceWith(frame);
}
function mvRefreshCell(btn) {
    mvReloadCell(btn.closest('.mv-cell'));
}

// scrolling="no": SOOP 임베드 페이지가 자기 쪽에서 띄우는 스크롤바를 없앤다. 남의 문서라
// CSS(::-webkit-scrollbar 등)로는 못 건드리지만, 이 속성은 iframe을 넣는 우리 쪽 설정이라
// 크로스 오리진에도 그대로 먹는다. 명세상 deprecated지만 모든 브라우저가 지원하고,
// 영상 플레이어라 안에서 스크롤할 일도 없으니 잃는 게 없다.
// SOOP은 로그인된 브라우저 세션 하나에 동시 재생을 4개까지만 허용한다. 5번째 칸부터는 credentialless
// iframe(쿠키 없이 따로 여는 익명 세션)으로 열어 그 한도에 세지 않게 한다 - 크롬·엣지(110+)만 지원하고
// 사파리·파이어폭스는 이 속성을 무시해 그대로 4개까지다. 익명 칸은 로그인 혜택(화질·광고 등)이 없을 수 있다.
const MV_LOGGED_IN_LIMIT = 4;
function mvCellHtml(entry, isMain, anonymous = false) {
    return `
    <div class="mv-cell${isMain ? ' mv-cell-main' : ''}" data-soop-id="${mvEsc(entry.soopId)}">
        <div class="mv-cell-header">
            <span class="mv-cell-name">${mvEsc(entry.name)}</span>
            <div class="mv-cell-actions">
                <button type="button" class="mv-cell-btn mv-cell-refresh" title="새로고침" aria-label="새로고침" ${act('mvRefreshCell', ACT.el)}>${MV_ICON_REFRESH}</button>
            </div>
        </div>
        <div class="mv-cell-body">
            <div class="mv-cell-video-wrap">
                <iframe src="${mvEmbedUrl(entry.soopId)}" title="${mvEsc(entry.name)} 방송" scrolling="no" allowfullscreen loading="lazy" allow="${MV_IFRAME_ALLOW}"${anonymous ? ' credentialless' : ''}></iframe>
            </div>
        </div>
    </div>`;
}
// 화면에 보여줄 순서: 포커스 모드면 메인이 맨 앞(2×2), 나머지는 목록 순서 그대로.
function mvDisplaySequence() {
    if (!mvFocus) return mvOrder.slice();
    const focusId = mvFocusEntryId(mvOrder, mvFocusId);
    const main = mvOrder.find(e => e.soopId === focusId);
    return main ? [main, ...mvOrder.filter(e => e !== main)] : mvOrder.slice();
}

// 현재 상태(mvOrder/mvFocus/mvFocusId)에 맞게 그리드를 "동기화"한다. 몇 번을 불러도 같은 결과가
// 나오는 멱등 함수이고, 이미 있는 칸은 절대 새로 만들거나 옮기지 않는다:
//   - 목록에서 빠진 방송의 칸만 지우고, 새로 들어온 방송의 칸만 끝에 붙인다.
//   - 화면상 순서는 style.order, 메인(2×2) 표시는 mv-cell-main 클래스로만 바꾼다.
function mvRenderGrid() {
    const area = document.getElementById('mv-grid-area');
    if (mvOrder.length === 0) {
        area.innerHTML = '<div class="mv-empty">선택된 방송이 없습니다</div>';
        return;
    }
    let grid = document.getElementById('mv-grid');
    if (!grid) {
        area.innerHTML = '<div class="mv-grid" id="mv-grid"></div>';
        grid = document.getElementById('mv-grid');
    }

    const cellsById = new Map(Array.from(grid.children).map(cell => [cell.dataset.soopId, cell]));
    const wanted = new Set(mvOrder.map(e => e.soopId));
    cellsById.forEach((cell, soopId) => {
        if (!wanted.has(soopId)) { cell.remove(); cellsById.delete(soopId); }
    });

    const sequence = mvDisplaySequence();
    const showMainSpan = mvFocus && sequence.length > 1;
    sequence.forEach((entry, i) => {
        let cell = cellsById.get(entry.soopId);
        if (!cell) {
            // 로그인 세션으로 여는 칸이 이미 4개면 새 칸은 익명(credentialless)으로 연다
            const loggedIn = grid.querySelectorAll('iframe:not([credentialless])').length;
            grid.insertAdjacentHTML('beforeend', mvCellHtml(entry, false, loggedIn >= MV_LOGGED_IN_LIMIT));
            cell = grid.lastElementChild;
        }
        if (cell.style.order !== String(i)) cell.style.order = String(i);
        cell.classList.toggle('mv-cell-main', showMainSpan && i === 0);
    });
    mvRelayoutGridDims();
}

// 창 크기가 바뀌면 포커스 모드의 열/행 개수(화면 비율 기준)만 다시 계산한다.
// 칸 내용(iframe)은 건드리지 않는다 - 여기서 그리드를 다시 그리면 리사이즈 때마다 모든 방송이
// 처음부터 다시 로드된다. 모바일은 키보드가 열리고 닫힐 때, 화면을 돌릴 때, 주소창이 움직일 때마다
// resize가 와서 소리가 끊기거나(다시 로드된 플레이어는 브라우저가 음소거로 시작시키기도 한다)
// 방송마다 소리 상태가 달라진다. 칸 크기는 CSS가 맞추고, 일반 그리드는 열 개수가 인원 수 기준이라
// 다시 계산할 것이 없다.
let mvResizeScheduled = false;
window.addEventListener('resize', () => {
    if (mvResizeScheduled) return;
    mvResizeScheduled = true;
    requestAnimationFrame(() => {
        mvResizeScheduled = false;
        mvRelayoutGridDims();
        mvMarkCornerCell();
    });
});

// 화면 우상단(설정 버튼 자리)에 오는 칸을 찾아 표시한다. 칸 배치는 CSS Grid 자동배치라
// 코드상 순서로는 알 수 없어서, 실제 렌더링된 위치(가장 위 줄에서 가장 오른쪽)로 판단한다.
function mvMarkCornerCell() {
    const cells = Array.from(document.querySelectorAll('#mv-grid-area .mv-cell'));
    let corner = null, best = null;
    cells.forEach(cell => {
        const r = cell.getBoundingClientRect();
        if (!best || r.top < best.top - 1 || (Math.abs(r.top - best.top) <= 1 && r.right > best.right)) {
            best = r; corner = cell;
        }
    });
    const MV_CORNER_MIN_WIDTH = 115; // 이름(최소)+새로고침 버튼+설정 버튼 자리가 한 줄에 들어가는 폭
    cells.forEach(cell => {
        cell.classList.toggle('mv-cell-corner', cell === corner);
        cell.classList.toggle('mv-cell-corner-compact', cell === corner && best.width < MV_CORNER_MIN_WIDTH);
    });
}
// 칸이 추가/삭제/자리바꿈되거나 그리드 열·행이 바뀌면(style) 우상단 칸을 다시 계산한다.
// (한 번에 여러 변경이 와도 프레임당 한 번만 계산; 우리가 바꾸는 class는 관찰 대상이 아니라 무한 반복 없음)
let mvCornerScheduled = false;
new MutationObserver(() => {
    if (mvCornerScheduled) return;
    mvCornerScheduled = true;
    requestAnimationFrame(() => { mvCornerScheduled = false; mvMarkCornerCell(); });
}).observe(document.getElementById('mv-grid-area'), { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

// ===== 초기화 =====
mvApplyTheme(localStorage.getItem('mv-theme') || 'light');
mvInit();
document.getElementById('mv-cols-value').innerText = mvColsLabel(mvCols);
mvApplyColsGroupVisibility();
mvRenderOrderRow();
mvRenderGrid();
mvLoadMembers();
