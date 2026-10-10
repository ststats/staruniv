// 문서 전체 이벤트 위임. <head>에서 core.js보다 먼저 싣는다.
// data-click="함수" data-args='[...]'로 전역 함수를 부른다. 인라인 핸들러가 없어야 CSP로 인라인 스크립트를 막을 수 있다.
const ACT = { el: { $: 'el' }, value: { $: 'value' } };

function act(fn, ...args) {
    return actOn('click', fn, ...args);
}
function actOn(type, fn, ...args) {
    const json = JSON.stringify(args).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    return ` data-${type}="${fn}"${args.length ? ` data-args="${json}"` : ''}`;
}

function actRun(e, type, bubbles) {
    for (let el = e.target; el instanceof Element; el = bubbles ? el.parentElement : null) {
        const fn = el.dataset[type];
        if (!fn) continue;
        const args = JSON.parse(el.dataset.args || '[]').map(a => (a && a.$ ? (a.$ === 'el' ? el : el.value) : a));
        window[fn](...args);
        if (e.cancelBubble) return;
    }
}
['click', 'input', 'change'].forEach(type => document.addEventListener(type, e => actRun(e, type, true)));
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.target instanceof Element) || !e.target.dataset.enter) return;
    e.preventDefault();
    actRun(e, 'enter', false);
});
// 네이티브 버튼이 아닌 role="button"/"tab" 요소도 Enter/Space로 누를 수 있게 한다.
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element) || !el.matches('[role="button"], [role="tab"]')) return;
    if (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    e.preventDefault();
    el.click();
});
// scroll · error · load는 버블링되지 않아 캡처 단계에서 받는다
['scroll', 'error', 'load'].forEach(type => document.addEventListener(type, e => actRun(e, type, false), true));

function imgRemove(img) {
    img.remove();
}
function imgHide(img) {
    img.style.display = 'none';
}
// 대신할 주소도 실패하면 투명 1px로 비운다(깨진 그림 표시와 재시도 반복을 막는다)
function imgSrc(img, src) {
    img.src = img.src === src ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : src;
}
function imgSwap(img, cls, text) {
    img.replaceWith(cls ? Object.assign(document.createElement('span'), { className: cls, textContent: text }) : text);
}

// 서브탭 깜빡임 방지: 탭이 바뀔 것 같으면 bootPage가 탭을 맞출 때까지 base.html CSS로 탭 영역을 가린다.
// htmlDefault는 각 페이지 HTML에서 켜져 있는 탭이다.
(() => {
    const htmlDefault = {
        members: 'status',
        schedule: 'calendar',
        tools: 'multiviewer',
        video: 'fantube',
        records: 'team',
        tier: 'list',
        stats: 'balloons',
    };
    let pending = new URLSearchParams(location.search).has('view');
    if (!pending) {
        try {
            const page = location.pathname.split('/').filter(Boolean).pop() || '';
            const nav = JSON.parse(localStorage.getItem('staruniv-nav-config') || 'null');
            const def = nav && nav.subtabs && nav.subtabs[page] && nav.subtabs[page].default;
            pending = Boolean(def && htmlDefault[page] && def !== htmlDefault[page]);
        } catch (_) {}
    }
    if (pending) document.documentElement.dataset.viewPending = '';
})();
