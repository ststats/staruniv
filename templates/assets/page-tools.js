/**
 * 도구 페이지: 멀티뷰어 설정(실행은 multiview.html 새 창) + 외부 도구/사이트 링크. (core.js → soop.js → 이 파일)
 * 멀티뷰어 선택 목록 공용 로직은 mv-shared.js(이 페이지와 multiview.html 공용)에 있다.
 * URL: /tools/[?view=external]
 */

const TOOLS_TABS = {
    multiviewer: ['tab-tools-multiviewer', 'view-tools-multiviewer'],
    rider: ['tab-tools-rider', 'view-tools-rider'],
    webp: ['tab-tools-webp', 'view-tools-webp'],
    external: ['tab-tools-external', 'view-tools-external'],
};
// 기본 탭(멀티뷰어)만 주소에 아무것도 안 붙이고, 나머지는 ?view=<탭>으로 남겨 새로고침/공유해도 유지된다.
const TOOLS_DEFAULT_VIEW = 'multiviewer';
const TOOLS_VIEW_IDS = Object.keys(TOOLS_TABS);

function toolsViewFromUrl(value) {
    return TOOLS_VIEW_IDS.includes(value) ? value : TOOLS_DEFAULT_VIEW;
}

// 엔트리는 티어표 페이지로 옮겼다. 예전 주소(/tools/?view=entry)로 들어오면 그쪽으로 보낸다.
if (new URLSearchParams(location.search).get('view') === 'entry') {
    location.replace(new URL('../tier/?view=entry', location.href).href);
}

function currentToolsView() {
    return TOOLS_VIEW_IDS.find(isToolsTabActive) || TOOLS_DEFAULT_VIEW;
}

function isToolsTabActive(view) {
    return isTabActive(TOOLS_TABS[view][0]);
}

function updateToolsHash() {
    const view = currentToolsView();
    PageState.update(view === TOOLS_DEFAULT_VIEW ? {} : { view });
}

// ----- 캄몬라이더 (자체 제작 레이싱 게임을 iframe으로 임베드) -----
// 게임 파일 하나가 1MB 가까이 돼서(글꼴·스프라이트가 파일 안에 들어있다) 페이지를 열자마자 불러오면
// 이 탭을 보지도 않는 사람까지 그 용량을 받게 된다. 그래서 이 탭을 처음 열 때 한 번만 src를 채운다.
// (두 번째부터는 이미 들어있는 iframe을 그대로 둬서 진행 중이던 게임이 초기화되지 않는다.)
// 빌드가 iframe의 data-src에 내용 해시가 붙은 주소(calmmon-rider.html?v=...)를 넣어 준다.
// 게임이 그대로면 재방문 때 1MB 가까운 파일을 서버에 다시 묻지 않고 브라우저 캐시에서 연다.
function riderPageUrl() {
    const frame = document.getElementById('rider-frame');
    return (frame && frame.dataset.src) || 'calmmon-rider.html';
}

function riderEnsureLoaded() {
    const frame = document.getElementById('rider-frame');
    if (frame && !frame.getAttribute('src')) frame.src = riderPageUrl();
}

// ----- 다른 탭으로 갔을 때 게임 멈추기 -----
// 탭을 바꿔도 iframe은 화면에서 숨겨질 뿐 그대로 살아 있어서, 그냥 두면 레이스가 계속 진행되고
// 음악도 계속 나온다. 게임 자체도 "브라우저 탭이 가려지면 일시정지"하는 기능이 있지만, 그건 브라우저
// 탭 전체가 가려질 때만 동작해서 사이트 안에서 하위 탭만 바꾸는 경우에는 걸리지 않는다.
//
// 게임은 우리 사이트와 같은 도메인의 파일이라(멀티뷰어의 SOOP 방송과 달리) 안쪽 버튼을 대신 눌러줄 수
// 있다. 그래서 게임 내부 코드를 건드리지 않고, 게임이 이미 갖고 있는 "일시 정지"·"소리" 버튼을 그대로
// 사용한다 - 나중에 게임을 새 버전으로 갈아끼워서 이 버튼들이 없어져도 아래 코드는 조용히 아무 일도
// 하지 않을 뿐 오류가 나지 않는다. 진행 중이던 레이스는 그대로 남아 돌아오면 이어서 볼 수 있다.
const riderPaused = { race: false, sound: false };

function riderDoc() {
    const frame = document.getElementById('rider-frame');
    if (!frame || !frame.getAttribute('src')) return null;
    try {
        return frame.contentDocument; // 같은 도메인이라 접근 가능(혹시 모를 예외는 아래에서 무시)
    } catch (e) {
        return null;
    }
}

// 게임이 지금 실제로 달리는 중인지(일시 정지 버튼이 보이고, 그 버튼이 "일시 정지"를 제안하는 상태인지)
function riderIsRunning(doc) {
    const btn = doc.getElementById('pause');
    return !!btn && !btn.hidden && btn.textContent.includes('일시 정지');
}
function riderSoundOn(doc) {
    const btn = doc.getElementById('soundToggle');
    return !!btn && btn.getAttribute('aria-pressed') === 'true';
}

// 캄몬라이더 탭을 떠날 때: 달리는 중이면 일시정지하고, 소리가 켜져 있으면 끈다(무엇을 껐는지 기억).
function riderSuspend() {
    const doc = riderDoc();
    if (!doc) return;
    riderPaused.race = riderIsRunning(doc);
    if (riderPaused.race) doc.getElementById('pause').click();
    riderPaused.sound = riderSoundOn(doc);
    if (riderPaused.sound) doc.getElementById('soundToggle').click();
}

// 돌아왔을 때: 우리가 껐던 것만 되돌린다(사용자가 직접 꺼둔 소리는 켜지 않는다).
function riderResume() {
    const doc = riderDoc();
    if (!doc) return;
    if (riderPaused.sound && !riderSoundOn(doc)) doc.getElementById('soundToggle').click();
    if (riderPaused.race && !riderIsRunning(doc)) {
        const btn = doc.getElementById('pause');
        if (btn && !btn.hidden) btn.click();
    }
    riderPaused.race = riderPaused.sound = false;
}

// 게임 화면만 전체화면으로. 게임 안의 레이아웃이 화면 높이에 맞춰 늘어나므로 그대로 커진다.
// (iframe 자체가 아니라 그것을 감싼 상자를 전체화면으로 만들어야 테두리/배경이 같이 따라간다)
function riderFullscreen() {
    const stage = document.getElementById('rider-stage');
    if (!stage) return;
    if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
    }
    if (!stage.requestFullscreen) {
        // iOS 사파리처럼 요소 전체화면을 지원하지 않는 환경에서는 새 창으로 여는 게 가장 크게 보는 방법이다
        riderOpenWindow();
        return;
    }
    const result = stage.requestFullscreen();
    if (result && typeof result.catch === 'function') result.catch(() => riderOpenWindow());
}

function riderOpenWindow() {
    window.open(riderPageUrl(), '_blank', 'noopener');
}

// ----- 움짤생성기 (단독 페이지 webp-maker.html을 iframe으로) -----
// 캄몬라이더처럼 이 탭을 처음 열 때 src를 채운다. 안쪽 높이가 설정 탭·결과에 따라 바뀌므로 iframe
// 높이를 내용에 맞춰 늘려 페이지 하나처럼 스크롤되게 하고, 사이트 테마(라이트/다크)도 안쪽에 넘겨 준다.
// 같은 도메인 파일이라 안쪽 문서를 직접 볼 수 있다.
function webpFrameDoc() {
    const frame = document.getElementById('webp-frame');
    try {
        return frame && frame.contentDocument;
    } catch (_) {
        return null;
    }
}

function webpFitHeight() {
    const frame = document.getElementById('webp-frame');
    const doc = webpFrameDoc();
    const main = doc && doc.querySelector('main');
    if (!frame || !main) return;
    // 문서 전체 높이(scrollHeight)는 iframe 자신의 높이보다 작아지지 않아서, 한 번 길어지면 내용이
    // 짧아져도 아래가 비어 있었다. 실제 내용(main)의 끝과 열려 있는 색 팔레트의 끝 중 아래쪽에 맞춘다.
    let bottom = main.getBoundingClientRect().bottom;
    doc.querySelectorAll('.swatches.open').forEach(pop => {
        bottom = Math.max(bottom, pop.getBoundingClientRect().bottom + 8);
    });
    frame.style.height = Math.ceil(bottom + (doc.defaultView ? doc.defaultView.scrollY : 0)) + 'px';
}

function webpSyncTheme() {
    const doc = webpFrameDoc();
    if (doc && doc.documentElement)
        doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
}

function webpEnsureLoaded() {
    const frame = document.getElementById('webp-frame');
    if (!frame || frame.getAttribute('src')) return;
    frame.addEventListener('load', () => {
        const doc = webpFrameDoc();
        if (!doc) return;
        webpSyncTheme();
        webpFitHeight();
        // 내용 크기가 바뀔 때(탭 전환·결과 표시)와 색 팔레트처럼 떠 있는 상자가 열릴 때 다시 맞춘다
        if (typeof ResizeObserver === 'function') new ResizeObserver(webpFitHeight).observe(doc.body);
        ['click', 'input', 'change'].forEach(type =>
            doc.addEventListener(type, () => requestAnimationFrame(webpFitHeight))
        );
    });
    frame.src = frame.dataset.src || 'webp-maker.html';
}

// 사이트에서 테마를 바꾸면(html data-theme) 열려 있는 움짤생성기에도 바로 넘긴다
if (typeof MutationObserver === 'function') {
    new MutationObserver(webpSyncTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
}

function switchToolsView(viewType, skipHashUpdate) {
    const wasRider = isToolsTabActive('rider');
    activateTabView(TOOLS_TABS, viewType);
    if (viewType === 'rider') {
        riderEnsureLoaded();
        if (!wasRider) riderResume();
    } else if (wasRider) {
        riderSuspend();
    }
    if (viewType === 'webp') webpEnsureLoaded();
    // 외부 도구·사이트 목록도 이 탭을 처음 열 때 받는다
    if (viewType === 'external' && !toolsExternalLoaded) {
        toolsExternalLoaded = true;
        safeInit('도구 목록', loadToolsData);
    }
    if (!skipHashUpdate) updateToolsHash();
}

// ----- 멀티뷰어 -----
// 이 탭은 "누구를 볼지 + 어떤 순서/배치로 볼지" 선택만 하고, 실제 영상 그리드는 새 창(multiview.html)이
// 맡는다. 새 창을 열 때 지금 상태를 URL로 넘긴다. 칩·목록 마크업과 목록 계산은 창과 같이 쓰는
// mv-shared.js에 있고, 이 탭엔 그리드가 없어서 목록이 바뀔 때마다 통째로 다시 그리면 된다.
const MvState = {
    order: [], // [{ soopId, name, isMember }] - 화면에 보여줄 순서 그대로
    cols: MV_AUTO_COLS, // 자동 - 새 창이 화면·인원 수에 맞춰 고른다
    dark: false,
    focus: true,
    focusId: null, // 포커스 모드에서 크게 보여줄 대상(soopId) - 목록 순서와 무관하게 별도 지정
    liveMap: {}, // soopId(소문자) -> 방송 중. 페이지를 열 때 한 번만 조회한다
};

function mvSetFocusTarget(soopId) {
    MvState.focusId = soopId;
    mvRenderOrderRow();
}

function mvIndexOf(soopId) {
    return MvState.order.findIndex(e => e.soopId === soopId);
}

function mvRenderChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.status === 'error') {
        container.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못했습니다');
        container.setAttribute('aria-busy', 'false');
        return;
    }
    const members = activeMembersWithSoopId();
    container.innerHTML = members.length
        ? members
              .map(m =>
                  mvChipHtml(m, mvIndexOf(m['SOOP ID']) !== -1, !!MvState.liveMap[String(m['SOOP ID']).toLowerCase()])
              )
              .join('')
        : emptyStateHtml('선택 가능한 멤버가 없습니다');
    container.setAttribute('aria-busy', 'false');
}

// 멤버 목록은 즉시 그려서 바로 선택할 수 있게 하고, 방송 중 여부(LIVE 뱃지)는 방송 중인 ID 목록(core.js
// fetchLiveIds, 한 번 조회)으로 확인해 나중에 덧입힌다.
async function mvCheckLiveAndRerenderChips() {
    if (activeMembersWithSoopId().length === 0) return;
    try {
        const live = await fetchLiveIds();
        MvState.liveMap = Object.fromEntries(Object.keys(live).map(id => [id, true]));
    } catch (e) {
        MvState.liveMap = {};
    }
    mvRenderChips();
}

function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    if (!row) return;
    const { order, focus } = MvState;
    const focusEntryId = mvFocusEntryId(order, MvState.focusId);
    const count = document.getElementById('mv-order-count');
    if (count) count.textContent = `${order.length}명`;
    row.innerHTML = order.length
        ? order.map((entry, idx) => mvOrderItemHtml(entry, idx, order, focus, focusEntryId)).join('')
        : `<div class="mv-order-empty"><strong>선택된 방송이 없습니다</strong></div>`;
}

function mvUpdateActionbar() {
    const btn = document.getElementById('mv-open-btn');
    if (btn) btn.disabled = MvState.order.length === 0;
}

function mvRenderAll() {
    mvRenderChips();
    mvRenderOrderRow();
    mvUpdateActionbar();
}

function mvToggleMember(soopId, name) {
    const idx = mvIndexOf(soopId);
    if (idx !== -1) MvState.order.splice(idx, 1);
    else MvState.order.push({ soopId, name, isMember: true });
    mvRenderAll();
}

function mvAddCustom() {
    const input = document.getElementById('mv-custom-id');
    const result = mvResolveCustomInput(input.value, MvState.order, activeMembersWithSoopId());
    if (!result) return;
    if (result.error) {
        alert(result.error);
        return;
    }
    MvState.order.push(result.entry);
    input.value = '';
    mvRenderAll();
}

function mvMove(idx, dir) {
    if (mvMoveEntry(MvState.order, idx, dir)) mvRenderAll();
}

function mvRemove(idx) {
    MvState.order.splice(idx, 1);
    mvRenderAll();
}

function mvChangeCols(delta) {
    // 자동에서 움직이면 이 모니터에 창을 꽉 채웠을 때의 자동 열 수에서 출발한다.
    const base = mvAutoGridCols(Math.max(1, MvState.order.length), screen.availWidth, screen.availHeight);
    MvState.cols = mvStepCols(MvState.cols, delta, base);
    document.getElementById('mv-cols-value').innerText = mvColsLabel(MvState.cols);
}

function mvToggleDarkSetting() {
    const toggle = document.getElementById('mv-theme-toggle');
    MvState.dark = toggle.classList.toggle('on');
    toggle.setAttribute('aria-pressed', String(MvState.dark));
}

function mvSetFocusMode(isFocus) {
    MvState.focus = isFocus;
    const toggle = document.getElementById('mv-mode-toggle');
    if (toggle) {
        toggle.classList.toggle('on', !isFocus);
        toggle.setAttribute('aria-pressed', String(!isFocus));
    }
    // 포커스 모드에서는 열 개수가 인원 수 기준으로 자동 계산돼서 이 스테퍼가 안 쓰이므로,
    // 요소를 숨기지 않고 흐릿하게 비활성화만 한다(레이아웃이 덜컹거리지 않게).
    document.getElementById('mv-col-tile').classList.toggle('disabled', isFocus);
    // 모드를 막 바꿨을 때 목록에 포커스 지정 표시가 보이거나 안 보이게 다시 그린다.
    mvRenderOrderRow();
}

// 그리드 토글 스위치: 누를 때마다 현재 모드의 반대로 전환한다.
function mvToggleFocusMode() {
    mvSetFocusMode(!MvState.focus);
}

function openMultiviewer() {
    const { order, cols, dark, focus, focusId } = MvState;
    if (order.length === 0) return;
    const list = order.map(e => ({ id: e.soopId, name: e.name, isMember: e.isMember }));
    const params = new URLSearchParams({
        list: JSON.stringify(list),
        cols: String(cols),
        theme: dark ? 'dark' : 'light',
        focus: focus ? '1' : '0',
        focusId: focus ? mvFocusEntryId(order, focusId) || '' : '',
    });
    window.open(`multiview.html?${params.toString()}`, '_blank', 'noopener');
}

// ----- 외부 도구 (Supabase external_tools - 어드민 '도구' 탭에서 편집) -----
// javascript: 같은 스킴이 섞여 들어와도 클릭 시 실행되지 않도록 http(s) 링크만 허용한다.
// 허용되지 않은 주소면 아예 href를 달지 않는다('#'으로 두면 페이지 <base>가 사이트 루트라
// 홈으로 이동하는 링크가 된다).
function safeHttpUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
}

function toolCardHtml(tool) {
    const url = (tool && tool.url) || '';
    let iconUrl;
    if (tool.favicon) {
        // favicon이 직접 지정돼 있으면(구글 캐시에 그 페이지가 없는 경우를 위한
        // 수동 지정) 구글을 거치지 않고 그 값을 그대로 쓴다.
        iconUrl = escapeHTML(tool.favicon);
    } else {
        // URL 안에 이미 퍼센트 인코딩된 문자가 있으면 encodeURIComponent가 '%'를 '%25'로 다시
        // 인코딩(이중 인코딩)해서 구글이 도메인을 못 알아본다. 한 번 풀었다가 다시 인코딩하면
        // 전부 한 번만 인코딩된 상태로 맞춰진다(인코딩 문자가 없는 링크는 결과가 그대로다).
        let normalizedUrl = url;
        try {
            normalizedUrl = decodeURIComponent(url);
        } catch (e) {
            /* 잘못된 인코딩이면 원본 사용 */
        }
        iconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(normalizedUrl)}`;
    }
    // 멤버 프로필 카드와 같은 틀: 위는 네이비 면(아이콘), 아래는 이름 + 주소 한 줄.
    let host = '';
    try {
        host = new URL(safeHttpUrl(url)).hostname.replace(/^www\./, '');
    } catch (e) {
        /* 주소가 없거나 잘못되면 비워 둔다 */
    }
    return `
        <a class="tool-card" data-tool-id="${escapeHTML(tool.id || '')}" data-tool-category="${escapeHTML(tool.category || '')}"${safeHttpUrl(url) ? ` href="${escapeHTML(safeHttpUrl(url))}"` : ''} target="_blank" rel="noopener">
            <div class="tool-card-media">
                <div class="tool-card-icon"><img loading="lazy" src="${iconUrl}" alt=""${actOn('error', 'imgHide', ACT.el)}></div>
            </div>
            <div class="tool-card-body">
                <div class="tool-card-name">${escapeHTML(tool.name)}</div>
                ${host ? `<div class="tool-card-host">${escapeHTML(host)}</div>` : ''}
            </div>
            ${typeof window.toolCardAdminExtra === 'function' ? window.toolCardAdminExtra(tool) : ''}
        </a>`;
}

function renderExternalTools(data) {
    ['extTools', 'extSites'].forEach(key => {
        const container = document.getElementById('tools-grid-' + key);
        if (!container) return;
        const items = asArray(data && data[key] && data[key].items);
        container.innerHTML = items.length
            ? items.map(toolCardHtml).join('')
            : `<div class="text-center text-muted py-3 fs-body grid-span-all">등록된 도구가 없습니다</div>`;
    });
}

let toolsExternalLoaded = false;
async function loadToolsData() {
    try {
        const data = await Api.tools();
        const grouped = { extTools: { items: [] }, extSites: { items: [] } };
        asArray(data).forEach(row => {
            if (!grouped[row.category]) return;
            grouped[row.category].items.push({
                id: row.id,
                category: row.category,
                name: row.name,
                url: row.url,
                favicon: row.favicon || '',
            });
        });
        renderExternalTools(grouped);
    } catch (e) {
        console.error('도구 목록을 불러오지 못했습니다:', e);
        renderExternalTools({});
    }
}

bootPage(
    () => {
        safeInit('멀티뷰어', () => {
            mvRenderAll();
            return mvCheckLiveAndRerenderChips();
        });
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                switchToolsView(
                    toolsViewFromUrl(params.get('view') || runtimeDefaultSubtab('tools', TOOLS_DEFAULT_VIEW)),
                    true
                );
            })
        );
    },
    {
        prefetch: () => fetchLiveIds().catch(() => {}), // 멀티뷰어 방송 중 표시
        view: params =>
            activateTabView(
                TOOLS_TABS,
                toolsViewFromUrl(params.get('view') || runtimeDefaultSubtab('tools', TOOLS_DEFAULT_VIEW))
            ),
    }
);
