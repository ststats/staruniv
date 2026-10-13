const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// CSP가 인라인 스크립트를 막아 동작은 data-click="함수"로 잇고, 그 함수는 전역이어야 한다.
const root = path.join(__dirname, '..', 'templates');
const walk = dir =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// 캄몬라이더는 외부 데이터를 그리지 않는 단독 파일이라 뺀다.
const files = walk(root).filter(
    f => /\.(html|js)$/.test(f) && !/purify\.min\.js$|calmmon-rider\.html$|[\\/]static[\\/]404\.html$/.test(f)
);
const rel = f => path.relative(root, f);

test('화면 코드에 인라인 이벤트 핸들러(on*="...")가 없다', () => {
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
        assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["'\\]/, rel(f));
    }
});

test('페이지 HTML에 인라인 <script>가 없다(모두 src로 싣는다, 검색엔진용 JSON-LD 데이터만 예외)', () => {
    for (const f of files.filter(f => f.endsWith('.html'))) {
        assert.doesNotMatch(
            fs.readFileSync(f, 'utf8'),
            /<script(?![^>]*\b(?:src=|type="application\/ld\+json"))[^>]*>/,
            rel(f)
        );
    }
});

test('data-click 등이 이름으로 부르는 함수는 모두 전역 function으로 있다', () => {
    const js = files
        .filter(f => f.endsWith('.js'))
        .map(f => fs.readFileSync(f, 'utf8'))
        .join('\n');
    const declared = new Set(
        [...js.matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(|^var\s+(\w+)\s*=|\bwindow\.(\w+)\s*=/gm)].map(
            m => m[1] || m[2] || m[3]
        )
    );
    const used = new Set();
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\sdata-(?:click|input|change|enter|scroll|error)="(\w+)"/g)) used.add(m[1]);
        for (const m of src.matchAll(/\bact\('(\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/\bactOn\('\w+', '(\w+)'/g)) used.add(m[1]);
        // 함수 이름을 인자로 넘겨 부품 안에서 act(handler, ...)로 붙이는 곳
        for (const m of src.matchAll(
            /(?:matchPaginationHtml|summaryFilterHtml|matchCategoryFilterHtml|avatarSelectItemHtml)\([^;]*?'(\w+)'\)/g
        ))
            used.add(m[1]);
    }
    assert.ok(used.size > 50, `찾은 동작 수가 너무 적다: ${used.size}`);
    for (const fn of used) assert.ok(declared.has(fn), `전역 function ${fn} 없음`);
});

// CSP를 <meta>로 두면 Chrome이 preload scanner를 꺼 첫 화면이 약 2배 늦어져 응답 헤더로 보낸다.
test('템플릿에 CSP <meta>가 없다(미리 읽기가 꺼진다)', () => {
    for (const f of files.filter(f => f.endsWith('.html'))) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /http-equiv=["']Content-Security-Policy/i, rel(f));
    }
});

test('모든 페이지 주소가 CSP 헤더를 받고, 인라인 스크립트는 허용하지 않는다', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, '..', 'docs', 'vercel.json'), 'utf8'));
    const routes = vercel.routes.filter(
        r => r.headers && /script-src/.test(r.headers['Content-Security-Policy'] || '')
    );
    assert.equal(routes.length, 1, 'CSP 헤더 규칙은 하나여야 한다');
    const [route] = routes;
    const policy = route.headers['Content-Security-Policy'];
    assert.doesNotMatch(policy.match(/script-src ([^;]+)/)[1], /unsafe-inline|unsafe-eval/);
    assert.match(policy, /frame-ancestors 'self'/);
    const src = new RegExp(route.src);
    const pages = fs.readdirSync(path.join(root, 'pages')).map(f => f.replace(/\.html$/, ''));
    const urls = ['/', '/index.html', '/multiview.html', '/webp-maker.html', '/admin.html'];
    for (const p of pages.filter(p => p !== 'home')) urls.push(`/${p}/`, `/${p}/index.html`, `/admin-${p}.html`);
    for (const u of urls) assert.match(u, src, `${u}에 CSP 헤더가 안 붙는다`);
    for (const u of ['/calmmon-rider.html', '/404.html', '/nope/', '/style.css', '/core.js'])
        assert.doesNotMatch(u, src, u);
});
