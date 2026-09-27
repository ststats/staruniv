const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('멀티뷰어 창은 공개 데이터로 멤버를 읽고, 방송 중 여부는 한 번만 조회한다', () => {
  const html = read('templates/standalone/multiview.html');
  assert.doesNotMatch(html, /supabase-js/);              // members 표는 공개 조회가 막혀 있다 - 쓰지 않는다
  assert.match(html, /await Api\.siteData\('shell'\)/);
  assert.match(html, /await Api\.liveSoopIds\(\)/);
  assert.doesNotMatch(html, /bjapi\.afreecatv\.com/);    // 멤버마다 SOOP에 묻지 않는다
});

test('5번째 칸부터는 credentialless(익명 세션)로 열어 SOOP 4개 한도에 세지 않는다', () => {
  const html = read('templates/standalone/multiview.html');
  assert.match(html, /const MV_LOGGED_IN_LIMIT = 4;/);
  assert.match(html, /iframe:not\(\[credentialless\]\)/);
});

test('칩·목록 부품은 mv-shared.js 하나, onclick이 부르는 함수는 두 페이지가 같은 이름으로 정의한다', () => {
  const shared = read('templates/assets/mv-shared.js');
  for (const fn of ['mvChipHtml', 'mvAvatarHtml', 'mvMoveEntry', 'mvOrderItemHtml', 'mvResolveCustomInput', 'mvFocusEntryId']) {
    assert.match(shared, new RegExp(`function ${fn}\\(`), fn);
  }
  const pages = [read('templates/assets/page-tools.js'), read('templates/standalone/multiview.html')];
  for (const src of pages) {
    for (const fn of ['mvToggleMember', 'mvMove', 'mvRemove', 'mvSetFocusTarget']) {
      assert.match(src, new RegExp(`function ${fn}\\(`), fn);
    }
    assert.doesNotMatch(src, /function mvChipHtml\(/);   // 칩 마크업을 따로 두지 않는다
  }
});
