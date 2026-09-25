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
  assert.match(core, /\.from\('site_config'\)/);
  assert.doesNotMatch(core, /fetch\('data\/nav\.json'/);
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
  assert.match(page, /\['입단 티어', joinTier \? tierLabel\(joinTier\) : ''\]/);
});

test('linked ELO accounts: name and race are editable in the player drawer', () => {
  const tier = read('templates/assets/admin-tier.js');
  assert.match(tier, /from\('tier_member_elo_links'\)\.update\(payload\)\.eq\('elo_id'/);
  assert.match(tier, /data-link-race/);
});
