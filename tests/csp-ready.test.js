const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// CSP로 인라인 스크립트를 막으므로 화면 코드에 onclick="..."·<script>...</script>가 없어야 한다.
// 동작은 actions.js의 data-click="함수" 등으로 연결하고, 그 함수는 전역(function 선언 또는 window.이름)이어야 한다.
const root = path.join(__dirname, '..', 'templates');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
// 캄몬라이더(게임)는 외부 데이터를 그리지 않는 단독 파일이라 CSP 대상에서 뺀다. 관리자 JS는 addEventListener만 쓴다.
const files = walk(root).filter(f => /\.(html|js)$/.test(f) && !/purify\.min\.js$|calmmon-rider\.html$|[\\/]static[\\/]404\.html$/.test(f));
const rel = f => path.relative(root, f);

test('화면 코드에 인라인 이벤트 핸들러(on*="...")가 없다', () => {
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
    assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["'\\]/, rel(f));
  }
});

test('페이지 HTML에 인라인 <script>가 없다(모두 src로 싣는다)', () => {
  for (const f of files.filter(f => f.endsWith('.html'))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /<script(?![^>]*\bsrc=)[^>]*>/, rel(f));
  }
});

test('data-click 등이 이름으로 부르는 함수는 모두 전역 function으로 있다', () => {
  const js = files.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const declared = new Set([...js.matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(|^var\s+(\w+)\s*=|\bwindow\.(\w+)\s*=/gm)].map(m => m[1] || m[2] || m[3]));
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\sdata-(?:click|input|change|enter|scroll|error)="(\w+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bact\('(\w+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bactOn\('\w+', '(\w+)'/g)) used.add(m[1]);
    // 함수 이름을 인자로 넘겨 부품 안에서 act(handler, ...)로 붙이는 곳(페이지 버튼·형식 칩·선택 바)
    for (const m of src.matchAll(/(?:matchPaginationHtml|summaryFilterHtml|matchCategoryFilterHtml|avatarSelectItemHtml)\([^;]*?'(\w+)'\)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 50, `찾은 동작 수가 너무 적다: ${used.size}`);
  for (const fn of used) assert.ok(declared.has(fn), `전역 function ${fn} 없음`);
});

test('공개 페이지와 멀티뷰어는 같은 CSP를 싣고, 인라인 스크립트는 허용하지 않는다', () => {
  const csp = f => (fs.readFileSync(path.join(root, f), 'utf8').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  const base = csp('base.html');
  assert.ok(base, 'base.html에 CSP가 없다');
  assert.equal(csp('standalone/multiview.html'), base);
  const scriptSrc = base.match(/script-src ([^;]+)/)[1];
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
});
