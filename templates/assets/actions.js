/**
 * 문서 전체에서 받는 화면 이벤트 (모든 페이지와 멀티뷰가 core.js보다 먼저 싣는다).
 *
 * 1) 동작 연결: HTML에 onclick="..." 같은 코드를 직접 쓰지 않고 data-click="함수이름" data-args='[인자...]'로
 *    적으면 여기서 그 전역 함수를 부른다. 인라인 코드가 없어야 CSP로 인라인 스크립트를 막을 수 있다.
 *    이벤트: data-click · data-input · data-change · data-enter(Enter 키) · data-scroll · data-error(이미지를 못 불러옴)
 *    인자의 ACT.el은 그 요소, ACT.value는 그 요소의 값으로 바뀐다. JS에서는 act('함수', 인자...)로 속성을 만든다.
 *    클릭 · 입력은 인라인 핸들러처럼 바깥 요소로 올라가며 부르고, 함수가 stopPropagation()을 부르면 거기서 멈춘다.
 * 2) 노치 모서리 포커스 테두리(아래).
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
// scroll · error는 버블링되지 않아 캡처 단계에서 받는다
['scroll', 'error'].forEach(type => document.addEventListener(type, e => actRun(e, type, false), true));

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

// 노치(clip-path)로 잘린 모서리에서는 사각 포커스 테두리의 사선 구간이 비므로 style.css(02-base)의 ::before가 사선까지 그린다.
// 그 크기(--cut: 요소 자신 또는 모서리를 같이 쓰는 조상의 노치에서 테두리 두께를 뺀 값)를 포커스 때 넣는다.
document.addEventListener('focusin', ({ target: el }) => {
    if (!(el instanceof Element)) return;
    for (let a = el, i = 0; a && i < 3; a = a.parentElement, i++) {
        const m = /calc\(100% - ([\d.]+)px\)/.exec(getComputedStyle(a).clipPath);
        if (!m) continue;
        const r = el.getBoundingClientRect(), p = a.getBoundingClientRect(), s = getComputedStyle(el);
        const cut = m[1] - (p.right - r.right) - (r.top - p.top) - parseFloat(s.borderTopWidth) - parseFloat(s.borderRightWidth);
        if (cut > 0) el.style.setProperty('--cut', cut + 'px');
        return;
    }
});
document.addEventListener('focusout', e => e.target.style?.removeProperty('--cut'));
