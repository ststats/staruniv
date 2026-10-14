// 멀티뷰어 창(multiview.html) 스크립트. CSP가 인라인 스크립트를 막아 파일로 둔다.
// ===== 상태 =====
// order: [{ soopId, name, isMember }] - 화면 순서 그대로. 공용 마크업·계산은 mv-shared.js에 있다.
const mvEsc = mvSharedEscapeHTML;
let mvOrder = [];
let mvCols = MV_AUTO_COLS;
let mvFocus = true;
let mvFocusId = null; // 포커스 모드에서 크게 볼 soopId(목록 순서와 무관)
let mvMembers = []; // 활동 중이고 숲 아이디가 있는 멤버
let mvLiveMap = {}; // soopId(소문자) -> 방송 중

function mvSaveState() {
    try {
        localStorage.setItem('mv-order', JSON.stringify(mvOrder));
        localStorage.setItem('mv-grid-cols', String(mvCols));
        localStorage.setItem('mv-focus', mvFocus ? '1' : '0');
        localStorage.setItem('mv-focus-id', mvFocusId || '');
    } catch (e) {}
}

function mvInit() {
    const params = new URLSearchParams(location.search);
    let list = null;
    if (params.has('list')) {
        try {
            list = JSON.parse(params.get('list'));
        } catch (e) {
            list = null;
        }
    }
    if (Array.isArray(list) && list.length > 0) {
        mvOrder = list
            .filter(e => e && typeof e.id === 'string' && /^[a-z0-9_-]+$/i.test(e.id))
            .map(e => ({ soopId: e.id.toLowerCase(), name: e.name || e.id, isMember: !!e.isMember }))
            .filter((e, i, arr) => arr.findIndex(x => x.soopId === e.soopId) === i);
        mvCols = mvParseCols(params.get('cols'));
        mvFocus = params.get('focus') === '1';
        mvFocusId = params.get('focusId') || null;
        // 도구 탭이 넘긴 테마가 있으면 저장된 값보다 우선한다
        if (params.get('theme') === 'dark' || params.get('theme') === 'light') {
            mvApplyTheme(params.get('theme'));
        }
    } else {
        // URL이 비었으면(직접 열기·새로고침) 마지막 저장 상태를 잇는다.
        try {
            mvOrder = JSON.parse(localStorage.getItem('mv-order') || '[]').filter(
                (e, i, arr) => e && typeof e.soopId === 'string' && arr.findIndex(x => x && x.soopId === e.soopId) === i
            );
            mvCols = mvParseCols(localStorage.getItem('mv-grid-cols'));
            mvFocus = localStorage.getItem('mv-focus') !== null ? localStorage.getItem('mv-focus') === '1' : true;
            mvFocusId = localStorage.getItem('mv-focus-id') || null;
        } catch (e) {
            mvOrder = [];
            mvCols = MV_AUTO_COLS;
            mvFocus = true;
            mvFocusId = null;
        }
    }
    mvApplyModeButtons();
}

// ===== 다크모드 (도구 탭과 같은 버튼형 스위치) =====
function mvApplyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('mv-theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', btn.classList.toggle('active', theme === 'dark'));
    try {
        localStorage.setItem('mv-theme', theme);
    } catch (e) {}
}
// 저장소가 막힌 브라우저에선 읽기도 오류를 내 창 전체가 멈추므로 감싼다
function mvStoredTheme() {
    try {
        return localStorage.getItem('mv-theme') || 'light';
    } catch (e) {
        return 'light';
    }
}
function mvToggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    mvApplyTheme(current === 'dark' ? 'light' : 'dark');
}

// ===== 설정 패널 여닫기 =====
function mvApplySettingsPanel(open) {
    document.getElementById('mv-settings-panel').classList.toggle('is-open', open);
    const fab = document.getElementById('mv-fab');
    fab.classList.toggle('active', open);
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? '설정 닫기' : '설정 열기');
}
function mvToggleSettingsPanel() {
    const isOpen = document.getElementById('mv-settings-panel').classList.contains('is-open');
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
    mvRelayoutGridDims();
    mvSaveState();
}

// 포커스 모드: 메인 2×2칸 + 나머지 1칸씩. 16:9 화면이 칸 안에서 가장 크게 보이는 열·행 수를 고른다.
// 같으면 빈 칸이 적은 쪽 → 칸 비율이 16:9에 가까운 쪽 → 화면 방향으로 긴 쪽.
function mvComputeFocusGridDims(totalW, totalH, restCount) {
    const W = totalW || 1,
        H = totalH || 1;
    let best = null;
    for (let cols = 2; cols <= 8; cols++) {
        for (let rows = 2; rows <= 8; rows++) {
            const empty = cols * rows - (4 + restCount);
            if (empty < 0) continue;
            const cw = W / cols,
                ch = H / rows;
            const key = [
                Math.round(Math.min(cw, ch * MV_VIDEO_AR)),
                -empty,
                -Math.round(Math.abs(Math.log(cw / ch / MV_VIDEO_AR)) * 100),
                W >= H ? cols : rows,
            ];
            const diff = best ? key.findIndex((v, i) => v !== best.key[i]) : 0;
            if (!best || (diff !== -1 && key[diff] > best.key[diff])) best = { key, cols, rows };
        }
    }
    return best || { cols: 2, rows: 2 + Math.ceil(restCount / 2) };
}

function mvApplyModeButtons() {
    const toggle = document.getElementById('mv-mode-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', toggle.classList.toggle('active', !mvFocus));
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
function mvToggleFocusMode() {
    mvSetFocusMode(!mvFocus);
}
function mvApplyColsGroupVisibility() {
    // 레이아웃이 흔들리지 않게 숨기지 않고 비활성화만 한다(포커스 모드에선 쓰이지 않는다).
    document.getElementById('mv-col-tile').classList.toggle('disabled', mvFocus);
}

// ===== 멤버 선택 칩 =====
function mvRenderMemberChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    container.innerHTML = mvMembers.length
        ? mvMembers
              .map(m =>
                  mvChipHtml(
                      m,
                      mvOrder.some(e => e.soopId === m['SOOP ID']),
                      !!mvLiveMap[m['SOOP ID']]
                  )
              )
              .join('')
        : '<div class="content-state">멤버 목록을 불러오지 못했습니다</div>';
}
function mvToggleMember(soopId, name) {
    const idx = mvOrder.findIndex(e => e.soopId === soopId);
    if (idx !== -1) {
        mvRemove(idx);
        return;
    }
    mvOrder.push({ soopId, name, isMember: true });
    mvAfterOrderChange();
}
async function mvLoadMembers() {
    try {
        const data = await Api.members();
        mvMembers = (Array.isArray(data.members) ? data.members : [])
            .filter(
                m =>
                    m &&
                    !m['퇴단일'] &&
                    MV_SHARED_SOOP_ID_PATTERN.test(
                        String(m['SOOP ID'] || '')
                            .trim()
                            .toLowerCase()
                    )
            )
            .map(m => ({ '이름': m['이름'] || '', 'SOOP ID': String(m['SOOP ID']).trim().toLowerCase() }));
    } catch (e) {
        mvMembers = [];
    }
    mvRenderMemberChips();
    mvCheckLiveMembers();
}
// 멤버마다 SOOP에 묻지 않고 ststat가 2분마다 채우는 방송 중 목록을 한 번 받는다.
async function mvCheckLiveMembers() {
    if (!mvMembers.length) return;
    try {
        const rows = await Api.liveSoopIds();
        mvLiveMap = {};
        rows.forEach(r => {
            if (r && r.soop_id) mvLiveMap[String(r.soop_id).toLowerCase()] = true;
        });
        mvRenderMemberChips();
    } catch (e) {}
}

// ===== 순서 목록 =====
function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    const focusEntryId = mvFocusEntryId(mvOrder, mvFocusId);
    row.innerHTML = mvOrder.length
        ? mvOrder.map((entry, idx) => mvOrderItemHtml(entry, idx, mvOrder, mvFocus, focusEntryId)).join('')
        : '<div class="content-state">선택된 방송이 없습니다</div>';
}

// 칸 요소는 옮기지 않고 위치는 CSS order로만 바꾼다. iframe을 DOM에서 떼었다 붙이면 방송이 다시 로드된다.
function mvAfterOrderChange() {
    mvRenderGrid();
    mvRenderMemberChips();
    mvRenderOrderRow();
    mvSaveState();
}

function mvSetFocusTarget(soopId) {
    if (soopId === mvFocusEntryId(mvOrder, mvFocusId)) return;
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
    // 메인을 지우면 목록 1번이 메인이 된다.
    if (mvFocusId === removed.soopId) mvFocusId = null;
    mvAfterOrderChange();
}

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
        // 칸이 열 수보다 적으면 그만큼만 열을 쓰고, 행 수를 고정해 세로도 뷰포트에 맞춘다.
        const want = mvFocus ? 1 : mvCols || mvAutoGridCols(count, area.clientWidth, area.clientHeight);
        cols = Math.max(1, Math.min(want, count));
        rows = Math.ceil(count / cols);
    }
    const colsValue = `repeat(${cols}, 1fr)`,
        rowsValue = `repeat(${rows}, 1fr)`;
    if (grid.style.gridTemplateColumns !== colsValue) grid.style.gridTemplateColumns = colsValue;
    if (grid.style.gridTemplateRows !== rowsValue) grid.style.gridTemplateRows = rowsValue;
}

function mvAddCustom() {
    const input = document.getElementById('mv-add-input');
    const result = mvResolveCustomInput(input.value, mvOrder, mvMembers);
    if (!result) return;
    if (result.error) {
        alert(result.error);
        return;
    }
    mvOrder.push(result.entry);
    mvAfterOrderChange();
    input.value = '';
}

// ===== 그리드 =====
// 화질을 강제하면 SOOP이 '고화질 스트리머' 로컬 프로그램에 연결하려다 iframe 안에서 막히므로 화질은 넘기지 않는다.
function mvEmbedUrl(soopId) {
    const params = new URLSearchParams({ showChat: 'false', autoPlay: 'true' });
    return `https://play.sooplive.com/${encodeURIComponent(soopId)}/embed?${params.toString()}`;
}

const MV_ICON_REFRESH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';

// 새 iframe으로 통째로 바꾼다. src를 비웠다 다시 넣으면 load가 두 번 와서 로딩 끝을 알 수 없다.
const MV_SPIN_MIN_MS = 500,
    MV_SPIN_MAX_MS = 10000;

// local-network-access/loopback-network는 SOOP의 '고화질 스트리머' 접속용 권한이다.
// 재생 영향이 확인되지 않아 남겨 둔다(확인되면 빼는 편이 보안상 낫다).
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
    frame.removeAttribute('loading'); // 보이는 칸이라 지연 로딩할 이유가 없다
    frame.addEventListener('load', stopSpin, { once: true });
    setTimeout(stopSpin, MV_SPIN_MAX_MS);
    frame.src = mvEmbedUrl(soopId);
    oldFrame.replaceWith(frame);
}
function mvRefreshCell(btn) {
    mvReloadCell(btn.closest('.mv-cell'));
}

// scrolling="no": 크로스 오리진 임베드의 스크롤바를 CSS로는 못 없애서 쓴다(deprecated지만 모두 지원).
// SOOP은 로그인 세션당 동시 재생을 4개로 제한해 5번째부터 credentialless로 연다(크롬·엣지만 지원).
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
function mvDisplaySequence() {
    if (!mvFocus) return mvOrder.slice();
    const focusId = mvFocusEntryId(mvOrder, mvFocusId);
    const main = mvOrder.find(e => e.soopId === focusId);
    return main ? [main, ...mvOrder.filter(e => e !== main)] : mvOrder.slice();
}

// 멱등. 빠진 칸만 지우고 새 칸만 끝에 붙이며, 순서는 style.order, 메인은 클래스로만 바꾼다.
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
        if (!wanted.has(soopId)) {
            cell.remove();
            cellsById.delete(soopId);
        }
    });

    const sequence = mvDisplaySequence();
    const showMainSpan = mvFocus && sequence.length > 1;
    sequence.forEach((entry, i) => {
        let cell = cellsById.get(entry.soopId);
        if (!cell) {
            const loggedIn = grid.querySelectorAll('iframe:not([credentialless])').length;
            grid.insertAdjacentHTML('beforeend', mvCellHtml(entry, false, loggedIn >= MV_LOGGED_IN_LIMIT));
            cell = grid.lastElementChild;
        }
        if (cell.style.order !== String(i)) cell.style.order = String(i);
        cell.classList.toggle('mv-cell-main', showMainSpan && i === 0);
    });
    mvRelayoutGridDims();
}

// 열/행 수만 다시 계산한다. 그리드를 다시 그리면 모바일에서 resize가 잦아 방송이 계속 다시 로드된다.
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

// 설정 버튼 자리에 오는 칸을 표시한다. 자동배치라 실제 렌더링 위치(맨 윗줄 가장 오른쪽)로 판단한다.
function mvMarkCornerCell() {
    const cells = Array.from(document.querySelectorAll('#mv-grid-area .mv-cell'));
    let corner = null,
        best = null;
    cells.forEach(cell => {
        const r = cell.getBoundingClientRect();
        if (!best || r.top < best.top - 1 || (Math.abs(r.top - best.top) <= 1 && r.right > best.right)) {
            best = r;
            corner = cell;
        }
    });
    const MV_CORNER_MIN_WIDTH = 115; // 이름+새로고침+설정 버튼이 한 줄에 들어가는 폭
    cells.forEach(cell => {
        cell.classList.toggle('mv-cell-corner', cell === corner);
        cell.classList.toggle('mv-cell-corner-compact', cell === corner && best.width < MV_CORNER_MIN_WIDTH);
    });
}
// 칸이나 그리드 style이 바뀌면 다시 계산한다(class는 관찰하지 않아 무한 반복이 없다).
let mvCornerScheduled = false;
new MutationObserver(() => {
    if (mvCornerScheduled) return;
    mvCornerScheduled = true;
    requestAnimationFrame(() => {
        mvCornerScheduled = false;
        mvMarkCornerCell();
    });
}).observe(document.getElementById('mv-grid-area'), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
});

// ===== 초기화 =====
mvApplyTheme(mvStoredTheme());
mvInit();
document.getElementById('mv-cols-value').innerText = mvColsLabel(mvCols);
mvApplyColsGroupVisibility();
mvRenderOrderRow();
mvRenderGrid();
mvLoadMembers();
