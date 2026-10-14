// CSS 규칙 검사(속성 중복·토큰·!important·간격·상태 클래스 이름).
// 14-surfaces.css는 네이비 면·선택 표시의 색만 모아 두는 층이라 속성 중복 예외다.
// 허용 목록(css-guard-allow.json)에 이미 없어진 항목이 남아 있어도 실패한다 - 목록은 줄기만 한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'templates', 'assets');
const ALLOW = JSON.parse(fs.readFileSync(path.join(__dirname, 'css-guard-allow.json'), 'utf8'));

function sheets() {
    const dir = path.join(ASSETS, 'style');
    const out = fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.css'))
        .sort()
        .map(f => ['style/' + f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    out.push(['admin.css', fs.readFileSync(path.join(ASSETS, 'admin.css'), 'utf8')]);
    return out;
}

// 규칙마다 { file, sel, decls: [{ prop, value, important }] }. @keyframes 안은 건너뛴다
function parse(file, css) {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const stack = [];
    let buf = '';
    let depth = 0; // 괄호 안(:is(...), url(...))의 ; { } 는 구분자가 아니다
    for (const c of src) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (depth > 0) {
            buf += c;
            continue;
        }
        if (c === '{') {
            const head = buf.trim().replace(/\s+/g, ' ');
            const inKeyframes = stack.some(s => s.kind === 'keyframes');
            const isAt = head.startsWith('@');
            const node = {
                kind: isAt ? (/^@(-\w+-)?keyframes/.test(head) ? 'keyframes' : 'at') : 'rule',
                head,
                decls: [],
            };
            if (node.kind === 'rule' && !inKeyframes) out.push({ file, sel: head, decls: node.decls });
            stack.push(node);
            buf = '';
        } else if (c === '}' || c === ';') {
            const top = stack[stack.length - 1];
            const text = buf.trim();
            if (top && top.kind === 'rule' && text.includes(':')) {
                const i = text.indexOf(':');
                const value = text.slice(i + 1).trim();
                top.decls.push({
                    prop: text.slice(0, i).trim().toLowerCase(),
                    value: value.replace(/\s*!important$/i, ''),
                    important: /!important$/i.test(value),
                });
            }
            if (c === '}') stack.pop();
            buf = '';
        } else {
            buf += c;
        }
    }
    return out;
}

function splitTop(s, seps) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const c of s) {
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (depth === 0 && seps.includes(c)) {
            out.push(cur);
            cur = '';
        } else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
}

// 각 선택자가 꾸미는 클래스: 맨 오른쪽 덩어리의 첫 클래스(괄호 밖)
function subjects(sel) {
    const out = new Set();
    for (const one of splitTop(sel, [','])) {
        const last = splitTop(one, [' ', '>', '+', '~']).pop() || '';
        let depth = 0;
        let flat = '';
        for (const c of last) {
            if (c === '(' || c === '[') depth++;
            if (depth === 0) flat += c;
            if (c === ')' || c === ']') depth--;
        }
        const m = flat.match(/\.([A-Za-z_][\w-]*)/);
        // ::before · ::after는 따로 그려지는 상자라 클래스 이름 뒤에 붙여 따로 센다
        const pseudo = (flat.match(/::?(before|after|placeholder|marker)\b/) || [])[0] || '';
        if (m) out.add(m[1] + pseudo.replace(/^:(?!:)/, '::'));
    }
    return out;
}

const ALL = sheets().flatMap(([f, css]) => parse(f, css));
const SURFACE_PROPS = new Set([
    'color',
    'background',
    'background-color',
    'background-image',
    'border-color',
    'border-left-color',
]);

function compare(found, allow, what) {
    const allowed = new Set(Object.keys(allow));
    const extra = [...found].filter(k => !allowed.has(k)).sort();
    const stale = [...allowed].filter(k => !found.has(k)).sort();
    assert.deepStrictEqual(extra, [], `${what} - 새로 생긴 곳. 부품의 원래 규칙(한 파일)을 고치거나 토큰을 쓸 것`);
    assert.deepStrictEqual(
        stale,
        [],
        `${what} - 이미 고쳐진 곳이 허용 목록에 남아 있다. css-guard-allow.json에서 지울 것`
    );
}

test('한 클래스의 같은 속성을 두 파일에서 정하지 않는다', () => {
    const where = new Map(); // "클래스 | 속성" -> 파일 집합
    for (const r of ALL) {
        for (const cls of subjects(r.sel)) {
            for (const d of r.decls) {
                if (d.prop.startsWith('--')) continue;
                if (r.file === 'style/14-surfaces.css' && SURFACE_PROPS.has(d.prop)) continue;
                const k = `${cls} | ${d.prop}`;
                if (!where.has(k)) where.set(k, new Set());
                where.get(k).add(r.file);
            }
        }
    }
    const found = new Set([...where].filter(([, files]) => files.size > 1).map(([k]) => k));
    compare(found, ALLOW.redefine, '여러 파일에서 같은 클래스·속성');
});

test('글자 크기·색을 토큰과 같은 숫자로 쓰지 않는다', () => {
    const tokens = fs.readFileSync(path.join(ASSETS, 'style', '01-tokens.css'), 'utf8');
    const rootBlock = tokens.slice(0, tokens.indexOf('}'));
    const fsValues = new Set([...rootBlock.matchAll(/--fs-[\w-]+:\s*(\d+px)/g)].map(m => m[1]));
    const colors = new Set(
        [...rootBlock.matchAll(/--[\w-]+:\s*(#[0-9a-f]{3,8})\s*;/gi)]
            .map(m => m[1].toLowerCase())
            .filter(c => !/^#(fff|ffffff|000|000000)$/.test(c))
    );
    const found = new Set();
    for (const r of ALL) {
        if (r.file === 'style/01-tokens.css') continue;
        for (const d of r.decls) {
            if (d.prop.startsWith('--')) continue;
            if (d.prop === 'font-size' && fsValues.has(d.value))
                found.add(`${r.file} | ${r.sel} | font-size ${d.value}`);
            for (const m of d.value.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
                if (colors.has(m[0].toLowerCase())) found.add(`${r.file} | ${r.sel} | ${d.prop} ${m[0].toLowerCase()}`);
            }
        }
    }
    compare(found, ALLOW.rawValue, '토큰과 같은 숫자');
});

test('여백·간격은 간격 단계 토큰으로 쓴다(1~3px·음수 제외)', () => {
    const found = new Set();
    for (const r of ALL) {
        if (r.file === 'style/01-tokens.css') continue;
        for (const d of r.decls) {
            if (!/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(d.prop)) continue;
            for (const m of d.value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)) {
                if (Number(m[1]) >= 4) found.add(`${r.file} | ${r.sel} | ${d.prop} ${m[1]}px`);
            }
        }
    }
    compare(found, ALLOW.spacing, '숫자로 쓴 간격');
});

test('숫자 고정폭은 body 한 곳에서만 정한다', () => {
    const where = ALL.filter(r => r.decls.some(d => d.prop === 'font-variant-numeric' && d.value !== 'inherit')).map(
        r => `${r.file} | ${r.sel}`
    );
    assert.deepStrictEqual(
        where,
        ['style/02-base.css | body'],
        '숫자 고정폭은 02-base의 body에만(나머지는 물려받는다)'
    );
});

test('!important는 허용 목록에서만 쓴다', () => {
    const found = new Set();
    for (const r of ALL) for (const d of r.decls) if (d.important) found.add(`${r.file} | ${r.sel} | ${d.prop}`);
    compare(found, ALLOW.important, '!important');
});

test('상태 클래스는 .active · .is-open으로 쓴다', () => {
    const BAD = /\.(on|selected|show|open|is-on|is-active|is-selected|is-shown|opened)(?![\w-])/;
    const where = ALL.filter(r => BAD.test(r.sel)).map(r => `${r.file} | ${r.sel}`);
    // 단독 페이지는 HTML 안 <style>에 CSS가 있다
    for (const f of ['multiview.html', 'webp-maker.html']) {
        const html = fs.readFileSync(path.join(ROOT, 'templates', 'standalone', f), 'utf8');
        for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g))
            for (const r of parse(f, m[1])) if (BAD.test(r.sel)) where.push(`${f} | ${r.sel}`);
    }
    assert.deepStrictEqual(where, [], '고른 것은 .active, 열린 것은 .is-open');
});
