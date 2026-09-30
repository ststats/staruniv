/**
 * 문서 전체에서 받는 화면 이벤트 (모든 페이지와 멀티뷰가 core.js보다 먼저 싣는다).
 *
 * 1) 동작 연결: HTML에 onclick="..." 같은 코드를 직접 쓰지 않고 data-click="함수이름" data-args='[인자...]'로
 *    적으면 여기서 그 전역 함수를 부른다. 인라인 코드가 없어야 CSP로 인라인 스크립트를 막을 수 있다.
 *    이벤트: data-click · data-input · data-change · data-enter(Enter 키) · data-scroll · data-error(이미지를 못 불러옴) · data-load(이미지를 불러옴)
 *    인자의 ACT.el은 그 요소, ACT.value는 그 요소의 값으로 바뀐다. JS에서는 act('함수', 인자...)로 속성을 만든다.
 *    클릭 · 입력은 인라인 핸들러처럼 바깥 요소로 올라가며 부르고, 함수가 stopPropagation()을 부르면 거기서 멈춘다.
 * 2) 노치 모서리 포커스 테두리(아래).
 * 3) 서브탭 깜빡임 방지(맨 아래). 이 파일은 <head>에서 실린다(base.html).
 */
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
        const args = JSON.parse(el.dataset.args || '[]').map(a => a && a.$ ? (a.$ === 'el' ? el : el.value) : a);
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
// role="button"/"tab"을 단 div/tr 등(네이티브 버튼이 아닌 클릭 요소)도 키보드 Enter/Space로 누를 수 있게 한다.
// 모든 페이지(멀티뷰어 포함)가 이 파일을 읽으므로 여기서 한 번만 처리한다.
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

// 이미지를 못 불러왔을 때(data-error): 지우기 · 숨기기 · 다른 주소로 바꾸기 · 글자(cls가 있으면 그 클래스의 <span>)로 바꾸기
function imgRemove(img) { img.remove(); }
function imgHide(img) { img.style.display = 'none'; }
// 대신할 주소도 안 되면 자리와 바탕색은 두고 투명한 1px 그림으로 비운다(깨진 그림 표시 없이, 다시 시도를 반복하지 않게)
function imgSrc(img, src) {
    img.src = img.src === src ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : src;
}
function imgSwap(img, cls, text) {
    img.replaceWith(cls ? Object.assign(document.createElement('span'), { className: cls, textContent: text }) : text);
}

// 서브탭 깜빡임 방지: HTML은 기본 탭이 켜진 채로 오고, 주소(?view=)나 저장된 기본 탭 설정대로 바꾸는 건 본문 끝의
// 페이지 스크립트(bootPage의 view)다. 그 사이 첫 화면에 기본 탭이 보이지 않도록, 바뀔 것 같으면 표시를 걸어 둔다
// (base.html의 CSS가 탭 영역을 잠깐 가리고, bootPage가 탭을 맞춘 뒤 푼다). 기본 탭 설정은 core.js가 저장해 둔 값
// (staruniv-nav-config)을 본다. 아래 기본값은 각 페이지 HTML에서 켜져 있는 탭이다.
(() => {
    const htmlDefault = { members: 'status', schedule: 'calendar', tools: 'multiviewer', video: 'fantube' };
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
