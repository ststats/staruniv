const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('admin pages reuse public page templates and modular admin scripts', () => {
  const build = read('scripts/build_html.py');
  const base = read('templates/base.html');
  assert.match(build, /get_template\(f'pages\/\{page_id\}\.html'\)/);
  assert.match(build, /admin_mode=True/);
  assert.doesNotMatch(base, /page-admin\.js/);
  for (const file of [
    'admin-core.js','admin-schedule.js','admin-history.js','admin-members.js',
    'admin-records.js','admin-tier.js','admin-video.js','admin-site.js','admin-tools.js'
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT,'templates/assets',file)), true, file);
  }
});

test('public users never receive admin editor markup', () => {
  const base = read('templates/base.html');
  assert.match(base, /\{% if admin_mode %\}\{% include 'partials\/admin-editor\.html' %\}\{% endif %\}/);
  assert.match(base, /body\{% if admin_mode %\} class="admin-mode"/);
});

test('schedule uses stable fixed palette and public renderer accepts keys', () => {
  const cal = read('templates/assets/calendar.js');
  for (const key of ['red','orange','yellow','green','blue','indigo','purple','light_gray']) {
    assert.match(cal, new RegExp(`${key}:`));
  }
  const admin = read('templates/assets/admin-schedule.js');
  assert.doesNotMatch(admin, /type="color"/);
  assert.match(admin, /schedule_color/);
  // 일정 제목은 멤버 이름만이 아니라 '중만컵'·'캄몬' 같은 값도 들어가므로 자유 입력이다
  assert.doesNotMatch(admin, /<select class="admin-input" id="as_person"/);
  assert.match(admin, /field\('제목', C\(\)\.input\('as_person'/);
  // 휴방은 체크 목록으로 여러 명을 한 번에 고르고, 퇴단한 이전 멤버는 뺀다
  assert.match(admin, /function offAirChecklist[\s\S]*?!m\.left_date/);
  assert.match(admin, /type="checkbox"/);
});

test('records use atomic match RPC and validate set results before save', () => {
  const admin = read('templates/assets/admin-records.js');
  assert.match(admin, /rpc\('admin_save_match'/);
  assert.match(admin, /validateScore\(p_match,p_rounds\)/);
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /create or replace function public\.admin_save_match/);
  assert.match(sql, /delete from public\.rounds where match_no = v_match_no/);
});

test('tier editor checks duplicate ELO IDs and bulk update is admin-only RPC', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /function duplicateElo/);
  assert.match(tier, /\.eq\('elo_id',elo\)/);
  assert.match(tier, /admin_bulk_update_tier_members/);
  const migration = read('supabase/staruniv.sql');
  assert.match(migration, /if not public\.is_admin\(\) then raise exception 'admin only'/);
  assert.match(migration, /admin_audit_log/);
});

test('inline domains call their public renderers after save', () => {
  assert.match(read('templates/assets/admin-schedule.js'), /calLoadPublicData/);
  assert.match(read('templates/assets/admin-history.js'), /histTimelineHtml/);
  assert.match(read('templates/assets/admin-members.js'), /renderMembersPage/);
  const video = read('templates/assets/admin-video.js');
  assert.match(video, /renderFantube\(\)/);
  assert.match(video, /renderPicks\(\)/);
  assert.match(read('templates/assets/admin-tools.js'), /renderExternalTools/);
});

test('public runtime site config comes from Supabase rather than raw nav json', () => {
  const core = read('templates/assets/core.js');
  assert.match(core, /await Api\.navConfig\(\)/);
  assert.match(read('templates/assets/api.js'), /\.from\('site_config'\)/);
  assert.doesNotMatch(core, /fetch\('data\/nav\.json'/);
});

test('api.js의 Api 함수와 API 규격(api/openapi.yaml)이 서로 맞다', () => {
  const api = read('templates/assets/api.js');
  const spec = read('api/openapi.yaml');
  const fns = [...api.slice(api.indexOf('const Api = {')).matchAll(/^    async (\w+)\(/gm)].map(m => m[1]).sort();
  const documented = [...new Set([...spec.matchAll(/Api\.(\w+)/g)].map(m => m[1]))].sort();
  assert.deepStrictEqual(documented, fns);
  for (const fn of fns) assert.match(api, new RegExp(`// GET /api/v1/[^\\n]*\\n(?: *//[^\\n]*\\n)*    async ${fn}\\(`), `${fn}: 위에 대응하는 주소 주석`);
});

test('공개 페이지의 데이터 조회는 api.js 한 곳에만 있다(나중에 서버 /api/v1로 바꿀 자리)', () => {
  const dir = path.join(ROOT, 'templates', 'assets');
  const pages = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'api.js' && !f.startsWith('admin-') && !f.endsWith('.min.js'));
  for (const f of pages) {
    const js = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(js, /\.from\(['"]\w+['"]\)|publicSupabaseClient\(|\/rest\/v1\//, `${f}: 표를 직접 읽지 말고 Api 함수를 쓴다`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'templates', 'pages'))) {
    const html = fs.readFileSync(path.join(ROOT, 'templates', 'pages', f), 'utf8');
    assert.match(html, /asset_url\('core\.js'\) \}\}"><\/script>\r?\n<script src="\{\{ asset_url\('api\.js'\)/, `${f}: core.js 다음에 api.js`);
  }
});

test('tier admin has a new-player (ELO candidates) view with add and ignore', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /\['candidates','신규 인원'\]/);
  assert.match(tier, /from\('tier_member_candidates'\)/);
  assert.match(tier, /setCandidateStatus\(find\(b\.dataset\.candIgnore\),'ignored'\)/);
  assert.match(tier, /from\('tier_member_candidates'\)\.delete\(\)\.eq\('id',c\.id\)/);
});

test('other-race ELO accounts are linked, and duplicate SOOP IDs are blocked in the DB', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /from\('tier_member_elo_links'\)\.insert/);
  assert.match(tier, /data-cand-link/);
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /create table if not exists public\.tier_member_elo_links/);
  assert.match(sql, /create trigger tier_members_guard_ids before insert or update of soop_id, elo_id on public\.tier_members/);
});

test('main ELO account can be switched, and dotted EloBoard names match existing players', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /rpc\('admin_set_main_elo'/);
  assert.match(tier, /replace\(\/\[\.\\s\]\+\/g,''\)/);
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /create or replace function public\.admin_set_main_elo\(p_member_id bigint, p_elo_id integer\)/);
});

test('tier date columns include demotions: no order warning, and tier update records demotion dates', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.doesNotMatch(tier, /승급일 순서가 티어 진행 방향과/);
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /강등으로 내려간 날도 그 티어 칸에 적는다/);
});

test('member rows link to tier players; person fields come from the tier table', () => {
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /add column if not exists tier_member_id bigint references public\.tier_members\(id\) on delete set null/);
  assert.match(sql, /create trigger members_fill_from_tier before insert or update on public\.members/);
  assert.match(sql, /create trigger tier_members_sync_members after update of soop_id, birth_date, gender, tier on public\.tier_members/);
  const admin = read('templates/assets/admin-members.js');
  assert.match(admin, /function linkStatus\(list,soop\)/);
  assert.match(sql, /where lower\(btrim\(soop_id\)\) = lower\(btrim\(new\.soop_id\)\) order by id limit 1/);
  assert.match(admin, /rows\.find\(r=>r\.nickname===name\)\|\|rows\.find\(r=>r\.name===name\)/);
  const page = read('templates/assets/page-members.js');
  assert.match(page, /getElementById\('mp-join-tier'\)\.textContent = joinTier \? tierLabel\(joinTier\) : '-'/);
});

test('linked ELO accounts: name and race are editable in the player drawer', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /from\('tier_member_elo_links'\)\.update\(payload\)\.eq\('elo_id'/);
  assert.match(tier, /data-link-race/);
});

test('admin shows members by nickname (same as the public site), not by the base name', () => {
  assert.match(read('templates/assets/admin-members.js'), /'이름':r\.nickname\|\|r\.name\|\|''/);
  assert.match(read('templates/assets/admin-history.js'), /m\.nickname\|\|m\.name/);
  assert.match(read('templates/assets/admin-records.js'), /m=>m\.nickname\|\|m\.name/);
});

test('site member data keeps join tier and ELO ID for the profile', () => {
  const s = read('scripts/write_site_data.py');
  assert.match(s, /"ELO ID"/);
  assert.match(s, /"입단 티어"/);
  assert.match(read('templates/partials/profile_modal.html'), /id="mp-join-tier"/);
});

test('tier section latin label adds TIER only once', () => {
  const src = read('templates/assets/page-tier.js');
  assert.match(src, /data-en="\$\{tierLatinLabel\(sec\.tier\)\}"/);
  const body = src.slice(src.indexOf('const TIER_EN'), src.indexOf('// 화면 밖 카드'));
  const tierLatinLabel = new Function(body + ';return tierLatinLabel;')();
  assert.deepEqual(['갓', '1', 0, '8티어', '미분류'].map(tierLatinLabel), ['GOD TIER', '1 TIER', '0 TIER', '8 TIER', 'UNRANKED TIER']);
});

test('stats TOP card uses repo media files (media/members/<SOOP ID>), no DB upload path', () => {
  const html = read('templates/pages/stats.html');
  assert.match(html, /id="synergy-top-photo"/);
  assert.match(html, /'synergy-sum-avg', 'AVERAGE'/);
  const js = read('templates/assets/page-stats.js');
  assert.match(js, /\^media\\\/members\\\//);
  assert.match(js, /muted: true, loop: true, autoplay: true, playsInline: true/);
  assert.match(read('scripts/write_site_data.py'), /MEMBER_MEDIA_DIR = ROOT \/ "templates" \/ "static" \/ "media" \/ "members"/);
  assert.match(js, /storageMediaUrl\(raw\)/);
  assert.match(read('scripts/write_site_data.py'), /row\.get\("대표 사진"\) or member_media_url/);
});

test('admin upload of feature photo/video stays: PC browser re-encodes video, no server encoding', () => {
  const js = read('templates/assets/admin-members.js');
  assert.match(js, /const CLIP=\{w:1280,h:720,fps:30,maxSec:6/);
  // 소프트웨어 H.264(Baseline)를 먼저, 안 되면 하드웨어 Main으로
  assert.match(js, /encoder:'avc1\.42001f',muxer:'avc',extra:\{avc:\{format:'avc'\},hardwareAcceleration:'prefer-software'\}/);
  assert.match(js, /encoder:'avc1\.4d401f',muxer:'avc'/);
  assert.doesNotMatch(js, /admin_request_member_video|members-photo-raw/);
  assert.match(read('templates/base.html'), /asset_url\('mp4-muxer\.js'\)/);
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /alter table public\.members add column if not exists photo_path text/);
  assert.match(sql, /'video\/mp4','video\/webm'\]/);
});

test('히어로 편집(설명·서브탭, 방송통계는 지표 탭)은 히어로 안, 추가 버튼은 그 서브탭에서만', () => {
  const js = read('templates/assets/admin-site.js');
  assert.match(js, /async function openHeroEditor\(\)/);
  assert.match(js, /addHeroTool\(\{id:'adminHeroEdit'/);
  assert.match(js, /cfg\.heroDescriptions\[page\]=desc/);
  assert.match(js, /cfg\.statsTabs=next/);            // 방송통계 지표 탭 표시도 같은 서랍
  const core = read('templates/assets/admin-core.js');
  assert.match(core, /function addPageTool\(\{id,label,icon='plus',onClick,scope=''\}\)/);
  assert.match(core, /function syncActionBars\(\)/);
  // 추가 버튼은 자기 서브탭 화면에 묶인다(일정 탭에서 '연혁 추가'가 보이지 않게)
  for (const [file, scope] of [['admin-history.js', '#view-history'], ['admin-members.js', '#view-member-status'],
    ['admin-tools.js', '#view-tools-external'], ['admin-video.js', '#view-video-pick']]) {
    assert.ok(read(`templates/assets/${file}`).includes(`scope:'${scope}'`), `${file}: ${scope}`);
  }
});

test('휴면 선수는 공개 티어 명단 조회(anon)에서 빠진다', () => {
  const sql = read('supabase/staruniv.sql');
  assert.match(sql, /create policy public_read_tier_members on public\.tier_members for select to anon\s+using \(coalesce\(affiliation, ''\) <> '휴면'\);/);
  assert.doesNotMatch(sql, /public_read_tier_members on public\.tier_members for select to anon using \(true\)/);
});

test('공개 조회(anon)는 화면에 나오는 것만: 멤버·전적 표는 막고, 숨긴 영상·연혁은 빼고, 어드민 연혁은 로그인 클라이언트로 읽는다', () => {
  const sql = read('supabase/staruniv.sql');
  for (const t of ['members', 'teams', 'matches', 'rounds']) {
    assert.doesNotMatch(sql, new RegExp(`grant select[^;]* on public\\.${t} to anon`), `${t}는 페이지가 조회하지 않는다`);
    assert.doesNotMatch(sql, new RegExp(`create policy public_read_${t} `));
  }
  assert.match(sql, /create policy public_read_videos on public\.videos for select to anon\s+using \(not hidden and exists \(select 1 from public\.video_channels c where c\.channel_url = videos\.channel_url\)\);/);
  assert.match(sql, /create policy university_logos_public_read on public\.university_logos for select to authenticated using \(true\);/);
  assert.match(sql, /create policy public_read_video_picks on public\.video_picks for select to anon using \(not hidden\);/);
  assert.match(sql, /create policy public_read_history_entries on public\.history_entries for select to anon using \(not hidden or entry_kind = 'override'\);/);
  const admin = read('templates/assets/admin-history.js');
  assert.doesNotMatch(admin, /histLoadData\(\)/, '어드민은 숨긴 연혁까지 받아야 한다');
});

test('대학 로고 목록은 로고를 그리는 페이지(전적·티어표)만 받는다', () => {
  const core = read('templates/assets/core.js');
  assert.match(core, /opts && opts\.logos \? loadTeamLogos\(\) : null/);
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'templates', 'assets');
  for (const file of fs.readdirSync(dir).filter(f => /^page-.*\.js$/.test(f))) {
    const js = read(`templates/assets/${file}`);
    const usesLogos = /teamLogoHtml|teamLogoSrc|teamCellInnerHtml/.test(js);
    const asksLogos = /bootPage\([\s\S]*logos: true/.test(js);
    assert.equal(asksLogos, usesLogos, `${file}: 로고를 쓰면 bootPage에 logos: true, 안 쓰면 빼기`);
  }
});
