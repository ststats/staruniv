/**
 * 도구 페이지: 멀티뷰어 설정(실행은 multiview.html 새 창) + 외부 도구/사이트 링크. (core.js → soop.js → 이 파일)
 * 멀티뷰어 선택 목록 공용 로직은 mv-shared.js(이 페이지와 multiview.html 공용)에 있다.
 * URL: /tools/[?view=external]
 */

const TOOLS_TABS = {
    multiviewer: ['tab-tools-multiviewer', 'view-tools-multiviewer'],
    rider: ['tab-tools-rider', 'view-tools-rider'],
    external: ['tab-tools-external', 'view-tools-external'],
};
// 기본 탭(멀티뷰어)만 주소에 아무것도 안 붙이고, 나머지는 ?view=<탭>으로 남겨 새로고침/공유해도 유지된다.
const TOOLS_DEFAULT_VIEW = 'multiviewer';
const TOOLS_VIEW_IDS = Object.keys(TOOLS_TABS);

function toolsViewFromUrl(value) {
    return TOOLS_VIEW_IDS.includes(value) ? value : TOOLS_DEFAULT_VIEW;
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
// 게임 파일 하나가 4MB에 가까워서(스프라이트가 파일 안에 들어있다) 페이지를 열자마자 불러오면
// 이 탭을 보지도 않는 사람까지 그 용량을 받게 된다. 그래서 이 탭을 처음 열 때 한 번만 src를 채운다.
// (두 번째부터는 이미 들어있는 iframe을 그대로 둬서 진행 중이던 게임이 초기화되지 않는다.)
const RIDER_PAGE_URL = 'calmmon-rider.html';

function riderEnsureLoaded() {
    const frame = document.getElementById('rider-frame');
    if (frame && !frame.getAttribute('src')) frame.src = RIDER_PAGE_URL;
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
    window.open(RIDER_PAGE_URL, '_blank', 'noopener');
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
    if (!skipHashUpdate) updateToolsHash();
}

// ----- 멀티뷰어 -----
// 우리 사이트는 "누구를 볼지 + 어떤 순서/열 개수로 볼지" 선택만 담당하고, 실제 영상 그리드/
// 다크모드/설정 열고닫기는 자체 제작한 새 창(multiview.html)에서 처리한다. 새 창을 열 때
// 현재 상태를 그대로 URL로 넘긴다. "선택 목록"에 관한 순수 로직(mvFocusEntryId/
// mvOrderItemHtml/mvResolveCustomInput)은 multiview.html과 공유하는 mv-shared.js에 있다.
// 이 페이지엔 그리드가 없어서 목록이 바뀔 때마다 통째로 다시 그리면 된다.
const MvState = {
    order: [],       // [{ soopId, name, isMember }] - 화면에 보여줄 순서 그대로
    cols: 2,
    dark: false,
    focus: true,
    focusId: null,   // 포커스 모드에서 크게 보여줄 대상(soopId) - 목록 순서와 무관하게 별도 지정
    liveMap: {},     // soopId -> live 여부. 최초 한 번만 조회해서 캐시(선택할 때마다 API를 다시 부르지 않음)
};

const MV_MIN_COLS = 1, MV_MAX_COLS = 4;

function mvSetFocusTarget(soopId) {
    MvState.focusId = soopId;
    mvRenderOrderRow();
}

function mvIndexOf(soopId) {
    return MvState.order.findIndex(e => e.soopId === soopId);
}

function mvChipHtml(m, isLive) {
    const soopId = m['SOOP ID'];
    const selected = mvIndexOf(soopId) !== -1;
    return `
        <div class="mv-chip${selected ? ' selected' : ''}" role="button" tabindex="0" aria-pressed="${selected}" onclick="mvToggleMember('${jsAttr(soopId)}', '${jsAttr(m['이름'])}')">
            ${avatarHtml(soopId, 'mv-chip-avatar')}
            ${isLive ? '<span class="mv-chip-live">LIVE</span>' : ''}
            <span class="mv-chip-name">${escapeHTML(m['이름'])}</span>
            <span class="mv-chip-check">✓</span>
        </div>`;
}

function mvRenderChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    const members = activeMembersWithSoopId();
    container.innerHTML = members.length
        ? members.map(m => mvChipHtml(m, !!MvState.liveMap[m['SOOP ID']])).join('')
        : `<div class="text-muted fs-body">선택 가능한 멤버가 없습니다.</div>`;
}

// 멤버 목록은 즉시 그려서 바로 선택할 수 있게 하고, 방송중 여부(LIVE 뱃지)는 비동기로
// 확인해 나중에 덧입힌다. (페이지 로드 시 한 번만 부른다 - 홈 "방송 중"과 같은 URL이라
// cachedFetchJson이 진행 중인 요청을 공유해서 실제 네트워크 요청은 한 번만 나간다.)
async function mvCheckLiveAndRerenderChips() {
    const members = activeMembersWithSoopId();
    if (members.length === 0) return;
    const settled = await Promise.allSettled(
        members.map(m => checkIsLiveRealtime(m['SOOP ID']).then(live => ({ soopId: m['SOOP ID'], live: !!live })))
    );
    MvState.liveMap = {};
    settled.forEach(r => { if (r.status === 'fulfilled') MvState.liveMap[r.value.soopId] = r.value.live; });
    mvRenderChips();
}

function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    if (!row) return;
    const { order, focus } = MvState;
    const focusEntryId = mvFocusEntryId(order, MvState.focusId);
    row.innerHTML = order.length
        ? order.map((entry, idx) => mvOrderItemHtml(entry, idx, order, focus, focusEntryId)).join('')
        : `<span class="mv-order-empty">위에서 멤버를 선택하거나 숲 아이디를 직접 추가해보세요.</span>`;
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
    if (result.error) { alert(result.error); return; }
    MvState.order.push(result.entry);
    input.value = '';
    mvRenderAll();
}

function mvMove(idx, dir) {
    const order = MvState.order;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    mvRenderAll();
}

function mvRemove(idx) {
    MvState.order.splice(idx, 1);
    mvRenderAll();
}

function mvChangeCols(delta) {
    MvState.cols = Math.min(MV_MAX_COLS, Math.max(MV_MIN_COLS, MvState.cols + delta));
    document.getElementById('mv-cols-value').innerText = MvState.cols;
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
        focusId: focus ? (mvFocusEntryId(order, focusId) || '') : '',
    });
    window.open(`multiview.html?${params.toString()}`, '_blank', 'noopener');
}

// ----- 외부 도구 (docs/data/tools.json - 어드민 '도구' 탭에서 편집) -----
// javascript: 같은 스킴이 섞여 들어와도 클릭 시 실행되지 않도록 http(s) 링크만 허용한다.
// (예전엔 '#'으로 대체했는데, 페이지 <base>가 사이트 루트라 '#'이 홈으로 이동하는 링크가 된다 -
//  허용되지 않은 주소면 아예 href를 달지 않는다)
function safeHttpUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
}

function toolCardHtml(tool) {
    const url = (tool && tool.url) || '';
    let iconUrl;
    if (tool.favicon) {
        // tools.json에 favicon이 직접 지정돼 있으면(구글 캐시에 그 페이지가 없는 경우를 위한
        // 수동 지정) 구글을 거치지 않고 그 값을 그대로 쓴다.
        iconUrl = escapeHTML(tool.favicon);
    } else {
        // URL 안에 이미 퍼센트 인코딩된 문자가 있으면 encodeURIComponent가 '%'를 '%25'로 다시
        // 인코딩(이중 인코딩)해서 구글이 도메인을 못 알아본다. 한 번 풀었다가 다시 인코딩하면
        // 전부 한 번만 인코딩된 상태로 맞춰진다(인코딩 문자가 없는 링크는 결과가 그대로다).
        let normalizedUrl = url;
        try { normalizedUrl = decodeURIComponent(url); } catch (e) { /* 잘못된 인코딩이면 원본 사용 */ }
        iconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(normalizedUrl)}`;
    }
    return `
        <a class="tool-card"${safeHttpUrl(url) ? ` href="${escapeHTML(safeHttpUrl(url))}"` : ''} target="_blank" rel="noopener">
            <span class="tool-card-ext">↗</span>
            <div class="tool-card-icon"><img loading="lazy" src="${iconUrl}" alt="" onerror="this.style.display='none';"></div>
            <div class="tool-card-name">${escapeHTML(tool.name)}</div>
        </a>`;
}

async function loadToolsData() {
    try {
        const res = await fetch('data/tools.json', { cache: 'no-cache' });
        if (!res.ok) return;
        const data = await res.json();
        ['extTools', 'extSites'].forEach(key => {
            const container = document.getElementById('tools-grid-' + key);
            if (!container) return;
            const items = asArray(data && data[key] && data[key].items);
            container.innerHTML = items.length
                ? items.map(toolCardHtml).join('')
                : `<div class="text-center text-muted py-3 fs-body grid-span-all">등록된 도구가 없습니다.</div>`;
        });
    } catch (e) {
        console.error('도구 목록을 불러오지 못했습니다:', e);
    }
}

bootPage(() => {
    safeInit('도구 목록', loadToolsData);
    safeInit('멀티뷰어', () => { mvRenderAll(); return mvCheckLiveAndRerenderChips(); });
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        switchToolsView(toolsViewFromUrl(params.get('view')), true);
    }));
});
