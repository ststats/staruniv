// CSS가 다시 '덧붙이기'로 쌓이지 않게 막는 검사.
//  1) 같은 @media 안에서 선택자 목록이 똑같은 규칙은 한 번만 - 고칠 때는 원래 규칙을 고친다.
//  2) HTML·JS·빌드 스크립트 어디에서도 쓰지 않는 클래스의 규칙은 남기지 않는다(00-vendor 포함).
//  3) 어디서도 읽지 않는 CSS 변수(--이름)는 선언하지 않는다(00-vendor 포함).
// 공개 CSS는 templates/assets/style/NN-*.css(빌드가 이름 순서대로 합쳐 style.css로 낸다), 어드민은 admin.css.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'templates', 'assets');

function cssSources(withVendor = false) {
    const dir = path.join(ASSETS, 'style');
    // 00-vendor-*.css는 외부 라이브러리에서 뽑아 온 것이라 중복 규칙 검사에서는 뺀다
    const parts = fs.readdirSync(dir).filter(f => f.endsWith('.css') && (withVendor || !f.startsWith('00-vendor'))).sort()
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
    return { 'style.css': parts.join(''), 'admin.css': fs.readFileSync(path.join(ASSETS, 'admin.css'), 'utf8') };
}

// 규칙을 [맥락(@media 등), 선택자 목록] 으로 모은다. @keyframes·@font-face 안은 건너뛴다.
function rules(css) {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const stack = [];
    let buf = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '{') {
            const pre = buf.trim().replace(/\s+/g, ' ');
            stack.push(pre);
            if (!pre.startsWith('@')) {
                const ctx = stack.slice(0, -1).join(' | ');
                if (!/@(keyframes|font-face)/.test(ctx)) out.push({ ctx, sel: pre });
            }
            buf = '';
        } else if (c === '}') {
            stack.pop();
            buf = '';
        } else if (c === ';' && stack.length && !stack[stack.length - 1].startsWith('@media') && !stack[stack.length - 1].startsWith('@supports')) {
            buf = '';
        } else {
            buf += c;
        }
    }
    return out;
}

test('같은 @media 안에 선택자 목록이 똑같은 규칙이 두 번 나오지 않는다', () => {
    for (const [name, css] of Object.entries(cssSources())) {
        const seen = new Map();
        const dup = [];
        for (const r of rules(css)) {
            const key = r.ctx + ' :: ' + r.sel.split(',').map(s => s.trim()).join(',');
            if (seen.has(key)) dup.push(key);
            seen.set(key, true);
        }
        assert.deepStrictEqual(dup, [], `${name}: 같은 규칙이 여러 곳에 있다 - 원래 규칙 한 곳을 고칠 것`);
    }
});

test('쓰이지 않는 클래스의 CSS 규칙이 없다', () => {
    const files = [];
    const walk = dir => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name);
            if (f.isDirectory()) walk(p);
            else if (/\.(html|js)$/.test(f.name)) files.push(p);
        }
    };
    walk(path.join(ROOT, 'templates'));
    for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) if (f.endsWith('.py')) files.push(path.join(ROOT, 'scripts', f));
    const corpus = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const tokens = new Set(corpus.match(/[A-Za-z_][\w-]*/g));
    // 코드에서 조합해 만드는 이름: prefix-${...}, prefix-{{ }}, 'prefix-' +
    const dynamic = [...corpus.matchAll(/([A-Za-z][\w-]*-)(?:\$\{|\{\{|["']\s*\+)/g)].map(m => m[1]);
    for (const [name, css] of Object.entries(cssSources(true))) {
        const classes = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));
        const dead = [...classes].filter(c => !tokens.has(c) && !dynamic.some(p => c.startsWith(p))).sort();
        assert.deepStrictEqual(dead, [], `${name}: 어디서도 쓰지 않는 클래스 - 규칙을 지울 것`);
    }
});

test('선언만 하고 읽지 않는 CSS 변수가 없다', () => {
    const texts = [];
    const walk = dir => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name);
            if (f.isDirectory()) walk(p);
            // 주석(/* */)은 CSS·JS에서만 뺀다. HTML에서는 CSP 줄의 https://*.도메인 같은 글자가 주석 시작으로 잘못 읽힌다.
            else if (/\.(html|js|css)$/.test(f.name)) {
                const text = fs.readFileSync(p, 'utf8');
                texts.push(f.name.endsWith('.html') ? text : text.replace(/\/\*[\s\S]*?\*\//g, ''));
            }
        }
    };
    walk(path.join(ROOT, 'templates'));
    const corpus = texts.join('\n');
    // var(--x) 로 읽거나, JS가 '--x' 이름으로 직접 읽고 쓰는 것
    const read = new Set([...corpus.matchAll(/var\(\s*(--[\w-]+)|['"`](--[\w-]+)['"`]/g)].map(m => m[1] || m[2]));
    for (const [name, css] of Object.entries(cssSources(true))) {
        const declared = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
        assert.deepStrictEqual([...declared].filter(v => !read.has(v)).sort(), [], `${name}: 읽지 않는 CSS 변수 - 선언을 지울 것`);
    }
});
