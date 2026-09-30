// 첫 화면: 부가 데이터(메뉴 설정·대학 로고)가 본문을 막지 않고, 사이트 데이터 파일은 내용 해시로 캐시한다
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('빌드가 사이트 데이터 파일마다 내용 해시를 페이지에 넣고, api.js가 그 파일의 해시를 주소에 붙인다', () => {
  const build = read('scripts/build_html.py');
  assert.match(build, /env\.globals\['site_data_version'\] = site_data_version\(\)/);
  assert.match(read('templates/base.html'), /<meta name="site-data-version" content="\{\{ site_data_version \}\}">/);
  assert.match(read('templates/assets/api.js'), /find\(\(\[k\]\) => k === part\)/);
  const wf = read('.github/workflows/build.yml');
  assert.ok(wf.indexOf('python scripts/write_site_data.py') < wf.indexOf('python scripts/build_html.py'), '데이터를 먼저 만든다');
  const vercel = JSON.parse(read('docs/vercel.json'));
  const route = vercel.routes.find(r => r.src === '^/data/site_[a-z]+\\.json$');
  assert.ok(route && route.has[0].key === 'v' && /immutable/.test(route.headers['Cache-Control']));
});

test('메뉴 설정은 빌드 기본값(또는 기억해 둔 값)으로 바로 그리고, 로고는 본문을 기다리게 하지 않는다', () => {
  const core = read('templates/assets/core.js');
  assert.match(core, /document\.querySelector\('meta\[name="nav-config"\]'\)/);
  assert.match(read('templates/base.html'), /\{\{ nav_config_default\|e \}\}/);
  const boot = core.slice(core.indexOf('function bootPage('), core.indexOf('function bootPage(') + 3000);
  assert.doesNotMatch(boot, /await[^;]*loadTeamLogos/);
  assert.match(boot, /logosReady\.then\(\(\) => swapTeamLogoFallbacks\(\)\)/);
});

test('상대전적: 같은 선수를 동시에 불러도 요청은 하나', async () => {
  const src = read('templates/assets/page-h2h.js');
  const start = src.indexOf('const h2hPlayerPending');
  const code = src.slice(start, src.indexOf('\n}\n', start) + 3);
  let calls = 0;
  const H2hState = { rows: {} };
  const fn = new Function('H2hState', 'h2hLoadPlayerFromSupabase', code + '; return h2hLoadPlayer;')(
    H2hState, async () => { calls++; await new Promise(r => setTimeout(r, 10)); return [[1]]; });
  const results = await Promise.all([fn('7'), fn('7'), fn('7')]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], [[1]]);
  await fn('7');
  assert.equal(calls, 1, '받은 뒤에는 캐시');
});
