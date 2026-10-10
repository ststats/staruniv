const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { code } = require('./code-pattern');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('관리자 화면은 공개 페이지 템플릿을 그대로 쓰고, 관리자 스크립트는 기능별 파일로 나뉜다', () => {
    const build = read('scripts/build_html.py');
    const base = read('templates/base.html');
    assert.match(build, /get_template\(f'pages\/\{page_id\}\.html'\)/);
    assert.match(build, /admin_mode=True/);
    assert.doesNotMatch(base, /page-admin\.js/);
    for (const file of [
        'admin-core.js',
        'admin-schedule.js',
        'admin-history.js',
        'admin-members.js',
        'admin-records.js',
        'admin-tier.js',
        'admin-video.js',
        'admin-site.js',
        'admin-tools.js',
    ]) {
        assert.equal(fs.existsSync(path.join(ROOT, 'templates/assets', file)), true, file);
    }
});

test('공개 페이지에는 관리자 편집 마크업이 들어가지 않는다', () => {
    const base = read('templates/base.html');
    assert.match(base, /\{% if admin_mode %\}\{% include 'partials\/admin-editor\.html' %\}\{% endif %\}/);
    assert.match(base, /body\{% if admin_mode %\} class="admin-mode"/);
});

test('일정 색은 정해진 팔레트 키로 저장하고, 공개 달력이 그 키를 그린다', () => {
    const cal = read('templates/assets/calendar.js');
    for (const key of ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple', 'light_gray']) {
        assert.match(cal, new RegExp(`${key}:`));
    }
    const admin = read('templates/assets/admin-schedule.js');
    assert.doesNotMatch(admin, /type="color"/);
    assert.match(admin, /schedule_color/);
    // 일정 제목엔 '중만컵' 같은 멤버 이름 아닌 값도 들어가 자유 입력이다
    assert.doesNotMatch(admin, /<select class="admin-input" id="as_person"/);
    assert.match(admin, /field\('제목', C\(\)\.input\('as_person'/);
    assert.match(admin, /function offAirChecklist[\s\S]*?!m\.left_date/);
    assert.match(admin, /type="checkbox"/);
});

test('전적은 한 번에 저장하는 함수(RPC)로 저장하고, 저장 전에 세트 결과를 검사한다', () => {
    const admin = read('templates/assets/admin-records.js');
    assert.match(admin, /AdminApi\.matches\.save\(p_match, p_rounds\)/);
    assert.match(read('templates/assets/admin-api.js'), /rpc\('admin_save_match'/);
    assert.match(admin, code('validateScore(p_match,p_rounds)'));
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /create or replace function public\.admin_save_match/);
    assert.match(sql, /delete from public\.rounds where match_no = v_match_no/);
});

test('티어표 편집은 ELO ID 중복을 막고, 일괄 수정은 관리자만 부를 수 있는 함수다', () => {
    const tier = read('templates/assets/admin-tier.js');
    assert.match(tier, /function duplicateElo/);
    assert.match(tier, code('AdminApi.tierMembers.withElo(elo,id)'));
    const api = read('templates/assets/admin-api.js');
    assert.match(api, code(".eq('elo_id',eloId)"));
    assert.match(api, /admin_bulk_update_tier_members/);
    const migration = read('supabase/staruniv.sql');
    assert.match(migration, /if not public\.is_admin\(\) then raise exception 'admin only'/);
    assert.match(migration, /admin_audit_log/);
});

test('관리자가 저장하면 그 화면의 공개 그리기 함수로 바로 다시 그린다', () => {
    assert.match(read('templates/assets/admin-schedule.js'), /calLoadPublicData/);
    assert.match(read('templates/assets/admin-history.js'), /histTimelineHtml/);
    assert.match(read('templates/assets/admin-members.js'), /renderMembersPage/);
    const video = read('templates/assets/admin-video.js');
    assert.match(video, /loadVideoData\(C\(\)\.state\.client\)/);
    assert.doesNotMatch(video, /AdminApi\.video\.(channels|videos|picks)\(/);
    assert.match(read('templates/assets/admin-tools.js'), /renderExternalTools/);
});

test('메뉴 설정은 nav.json 파일이 아니라 Supabase에서 받는다', () => {
    const core = read('templates/assets/core.js');
    assert.match(core, /await Api\.navConfig\(\)/);
    assert.match(read('templates/assets/api.js'), /apiCall\('api_site_nav'\)/);
    assert.doesNotMatch(core, /fetch\('data\/nav\.json'/);
});

test('api.js의 Api 함수와 API 규격(api/openapi.yaml)이 서로 맞다', () => {
    const api = read('templates/assets/api.js');
    const spec = read('api/openapi.yaml');
    const fns = [...api.slice(api.indexOf('const Api = {')).matchAll(/^    async (\w+)\(/gm)].map(m => m[1]).sort();
    const documented = [...new Set([...spec.matchAll(/Api\.(\w+)/g)].map(m => m[1]))].sort();
    assert.deepStrictEqual(documented, fns);
    for (const fn of fns)
        assert.match(
            api,
            new RegExp(`// GET /api/v1/[^\\n]*\\n(?: *//[^\\n]*\\n)*    async ${fn}\\(`),
            `${fn}: 위에 대응하는 주소 주석`
        );

    const called = [...new Set([...api.matchAll(/apiCall\('(\w+)'/g)].map(m => m[1]))].sort();
    const listed = new Set([...spec.matchAll(/x-db-function[\w-]*: (\w+)/g)].map(m => m[1]));
    assert.deepStrictEqual(
        called.filter(fn => !listed.has(fn)),
        [],
        'openapi.yaml에 x-db-function이 없는 함수'
    );
});

test('API 규격의 설명 글에 따옴표 없는 ": "가 없다(YAML이 키로 읽어 파일 전체가 깨진다)', () => {
    const bad = read('api/openapi.yaml')
        .split('\n')
        .map((l, i) => [i + 1, l])
        .filter(
            ([, l]) =>
                /^\s+(summary|description): (?!['"{|>])/.test(l) &&
                /: /.test(l.replace(/^\s+(summary|description): /, ''))
        );
    assert.deepStrictEqual(bad, []);
});

test('공개 페이지의 데이터 조회는 api.js 한 곳에만 있다(나중에 서버 /api/v1로 바꿀 자리)', () => {
    const dir = path.join(ROOT, 'templates', 'assets');
    const pages = fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.js') && f !== 'api.js' && !f.startsWith('admin-') && !f.endsWith('.min.js'));
    for (const f of pages) {
        const js = fs.readFileSync(path.join(dir, f), 'utf8');
        assert.doesNotMatch(
            js,
            /\.from\(['"]\w+['"]\)|publicSupabaseClient\(|\/rest\/v1\//,
            `${f}: 표를 직접 읽지 말고 Api 함수를 쓴다`
        );
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'templates', 'pages'))) {
        const html = fs.readFileSync(path.join(ROOT, 'templates', 'pages', f), 'utf8');
        assert.match(
            html,
            /asset_url\('core\.js'\) \}\}"><\/script>\r?\n<script src="\{\{ asset_url\('api\.js'\)/,
            `${f}: core.js 다음에 api.js`
        );
    }
});

test('공개 페이지는 표를 읽지 않고 공개 읽기 함수(api_*)만 부른다(나중에 서버가 같은 함수를 부르면 된다)', () => {
    const api = read('templates/assets/api.js');
    const sql = read('supabase/staruniv.sql');
    const body = api.slice(api.indexOf('const Api = {'));
    assert.match(body, /async history\(\) \{\n        return apiCall\('api_history'\);/);
    assert.doesNotMatch(api, /from: table =>/);
    // 나머지 api_*는 ststat.sql 14번에 있다
    const called = [...new Set([...api.matchAll(/apiCall\('(api_\w+)'/g)].map(m => m[1]))];
    const own = called.filter(fn => sql.includes(`function public.${fn}(`));
    assert.ok(own.length >= 7, own.join(','));
    for (const fn of own) {
        const def = sql.slice(sql.indexOf(`function public.${fn}(`));
        assert.match(
            def.slice(0, def.indexOf('$$;')),
            /security definer set search_path = public/,
            `${fn}: 정의자 권한·경로 고정`
        );
    }
    const grant = sql.slice(sql.indexOf('grant execute on function public.api_site_nav()'));
    for (const fn of own)
        assert.match(grant.slice(0, grant.indexOf(';')), new RegExp(`public\\.${fn}\\(`), `${fn}: anon 실행 권한`);
    assert.match(sql, /from public\.history_entries where not hidden or entry_kind = 'override';/);
    assert.match(sql, /from public\.tier_members where coalesce\(affiliation, ''\) <> '휴면';/);
    assert.match(sql, /if p_admin and not coalesce\(public\.is_admin\(\),false\)/);
    assert.match(sql, /from public\.video_channels where p_admin or active/);
    assert.match(sql, /where \(p_admin or not v\.hidden\)/);
    assert.match(sql, /from public\.video_picks where \(p_admin or not hidden\)/);
    assert.match(sql, /from public\.external_tools where active;/);
    assert.match(sql, /from public\.site_config where config_key = 'nav'/);
    assert.doesNotMatch(sql, /grant select[^;]* to anon/);
    assert.doesNotMatch(body, /\.from\('/);
    assert.match(read('templates/assets/history.js'), code('await (load?load():Api.history())'));
});

test('관리자 화면의 DB·파일·로그인은 admin-api.js(AdminApi) 한 곳에서만 한다(나중에 서버 /api/v1/admin으로 바꿀 자리)', () => {
    const dir = path.join(ROOT, 'templates', 'assets');
    for (const f of fs.readdirSync(dir).filter(f => /^admin-.*\.js$/.test(f) && f !== 'admin-api.js')) {
        const js = fs.readFileSync(path.join(dir, f), 'utf8');
        assert.doesNotMatch(
            js,
            /(?<!Array)\.(from|rpc)\(['"`a-z]|\.storage\b|(?<!AdminApi)\.auth\.(getUser|sign|onAuth)|\bsb\(\)/,
            `${f}: AdminApi를 쓴다`
        );
        assert.doesNotMatch(
            js.replace(/state\.client = window\.supabase\.createClient/, ''),
            /state\.client\./,
            `${f}: 클라이언트를 직접 쓰지 않는다`
        );
    }
    const api = read('templates/assets/admin-api.js');
    const fns = [...api.matchAll(/^ {12}(\w+): (?:async )?\(?[\w, {}=']*\)? =>/gm)].map(m => m[1]);
    assert.ok(fns.length > 50, String(fns.length));
    assert.match(
        read('templates/base.html'),
        /asset_url\('admin-core\.js'\) \}\}"><\/script>\r?\n<script src="\{\{ asset_url\('admin-api\.js'\)/
    );
});

test('멤버 목록 함수의 정렬 순서는 core.js SITE_ORDER와 같다, 공휴일은 DB(자동 맞춤 + 관리자)', () => {
    const core = read('templates/assets/core.js');
    const order = JSON.parse(core.match(/const SITE_ORDER = (\{[\s\S]*?\n\});/)[1]);
    const sql = read('supabase/staruniv.sql');
    const fn = sql.slice(sql.indexOf('create or replace function public.api_site_members'));
    const arr = name =>
        JSON.parse(
            fn
                .match(new RegExp(`array\\[([^\\]]*)\\] as ${name}`))[1]
                .replace(/'/g, '"')
                .replace(/^/, '[')
                .replace(/$/, ']')
        );
    assert.deepStrictEqual(arr('roles'), order.roles);
    assert.deepStrictEqual(arr('tiers'), order.tiers);
    assert.ok(!fs.existsSync(path.join(ROOT, 'templates/assets/holidays.json')));
    assert.match(read('templates/assets/calendar.js'), /await Api\.holidays\(\)/);
    assert.match(read('.github/workflows/build.yml'), /python scripts\/sync_holidays\.py/);
    const sync = read('scripts/sync_holidays.py');
    assert.match(sync, /where public\.holidays\.source = 'auto'/);
    assert.match(sync, /where source = 'auto' and extract\(year from day\)/);
});

test('티어표 관리에 신규 인원(ELO 후보) 화면이 있고, 추가·무시를 할 수 있다', () => {
    const tier = read('templates/assets/admin-tier.js');
    const page = read('templates/pages/tier.html');
    assert.match(page, /id="adminTierMembersBody"[\s\S]*?신규 인원[\s\S]*?id="candBody"/);
    assert.doesNotMatch(tier, /\['candidates',/);
    assert.match(tier, code("setCandidateStatus(find(b.dataset.candIgnore),'ignored')"));
    assert.match(tier, code('AdminApi.candidates.remove(c.id)'));
    const api = read('templates/assets/admin-api.js');
    assert.match(api, /from\('tier_member_candidates'\)/);
    assert.match(api, code("from('tier_member_candidates').delete().eq('id',id)"));
});

test('다른 종족 ELO 계정은 연결해 두고, SOOP ID 중복은 DB가 막는다', () => {
    const tier = read('templates/assets/admin-tier.js');
    assert.match(tier, code('AdminApi.eloLinks.insert({'));
    assert.match(read('templates/assets/admin-api.js'), code("from('tier_member_elo_links').insert"));
    assert.match(tier, /data-cand-link/);
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /create table if not exists public\.tier_member_elo_links/);
    assert.match(
        sql,
        /create trigger tier_members_guard_ids before insert or update of soop_id, elo_id on public\.tier_members/
    );
});

test('대표 ELO 계정을 바꿀 수 있고, 점이 들어간 EloBoard 이름도 기존 선수와 맞춘다', () => {
    const tier = read('templates/assets/admin-tier.js');
    assert.match(tier, code('AdminApi.tierMembers.setMainElo(memberId,elo)'));
    assert.match(read('templates/assets/admin-api.js'), /rpc\('admin_set_main_elo'/);
    assert.match(tier, code("replace(/[.\\s]+/g,'')"));
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /create or replace function public\.admin_set_main_elo\(p_member_id bigint, p_elo_id integer\)/);
});

test('티어 날짜 칸에 강등도 적는다 - 순서 경고는 없고, 티어표 갱신이 강등일을 기록한다', () => {
    const tier = read('templates/assets/admin-tier.js');
    assert.doesNotMatch(tier, /승급일 순서가 티어 진행 방향과/);
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /강등으로 내려간 날도 그 티어 칸에 적는다/);
});

test('멤버 줄은 티어표 선수와 이어지고, 인적 사항은 티어표 값을 쓴다', () => {
    const sql = read('supabase/staruniv.sql');
    assert.match(
        sql,
        /add column if not exists tier_member_id bigint references public\.tier_members\(id\) on delete set null/
    );
    assert.match(sql, /create trigger members_fill_from_tier before insert or update on public\.members/);
    assert.match(
        sql,
        /create trigger tier_members_sync_members after update of soop_id, birth_date, gender, tier on public\.tier_members/
    );
    const admin = read('templates/assets/admin-members.js');
    assert.match(admin, code('function linkStatus(list,soop)'));
    assert.match(sql, /where lower\(btrim\(soop_id\)\) = lower\(btrim\(new\.soop_id\)\) order by id limit 1/);
    assert.match(admin, code('rows.find(r=>r.nickname===name)||rows.find(r=>r.name===name)'));
    const page = read('templates/assets/page-members.js');
    assert.match(page, /getElementById\('mp-join-tier'\)\.textContent = joinTier \? tierLabel\(joinTier\) : '-'/);
});

test('연결된 ELO 계정의 이름·종족은 선수 편집 창에서 고칠 수 있다', () => {
    const tier = read('templates/assets/admin-tier.js');
    assert.match(tier, code('AdminApi.eloLinks.update(Number(b.dataset.linkSave),payload)'));
    assert.match(
        read('templates/assets/admin-api.js'),
        code("from('tier_member_elo_links').update(row).eq('elo_id',eloId)")
    );
    assert.match(tier, /data-link-race/);
});

test('관리자 화면도 공개 사이트처럼 본명이 아니라 활동명으로 보여 준다', () => {
    assert.match(read('supabase/staruniv.sql'), /'이름', coalesce\(m\.nickname, ''\)/);
    const members = read('templates/assets/admin-members.js');
    assert.match(members, code("await loadSiteData(['members','profiles']);"));
    assert.doesNotMatch(members, /toPublic/);
    assert.match(read('templates/assets/admin-history.js'), code('m.nickname||m.name'));
    assert.match(read('templates/assets/admin-records.js'), code('m=>m.nickname||m.name'));
});

test('멤버 데이터에 프로필용 입단 티어와 ELO ID가 들어 있다', () => {
    const sql = read('supabase/staruniv.sql');
    const fn = sql.slice(sql.indexOf('create or replace function public.api_member_profiles'));
    assert.match(fn.slice(0, fn.indexOf('$$;')), /'ELO ID'[\s\S]*'입단 티어'/);
    // 같은 이름 재입단이 섞이지 않게 이름 대신 _id로 붙인다
    assert.match(read('templates/assets/core.js'), code('Object.assign(m,SiteData.profiles[m._id]||{})'));
    assert.match(read('templates/partials/profile_modal.html'), /id="mp-join-tier"/);
});

test('티어 섹션 영문 라벨에 TIER가 한 번만 붙는다', () => {
    const src = read('templates/assets/page-tier.js');
    assert.match(src, /data-en="\$\{tierLatinLabel\(sec\.tier\)\}"/);
    const body = src.slice(src.indexOf('const TIER_EN'), src.indexOf('// 화면 밖 카드'));
    const tierLatinLabel = new Function(body + ';return tierLatinLabel;')();
    assert.deepEqual(['갓', '1', 0, '8티어', '미분류'].map(tierLatinLabel), [
        'GOD TIER',
        '1 TIER',
        '0 TIER',
        '8 TIER',
        'UNRANKED TIER',
    ]);
});

test('방송통계 TOP 카드는 저장소 미디어 파일(media/members/<SOOP ID>)을 쓰고, DB 업로드 경로는 없다', () => {
    const html = read('templates/pages/stats.html');
    assert.match(html, /id="synergy-top-photo"/);
    assert.match(html, /'synergy-sum-avg', 'AVERAGE'/);
    const js = read('templates/assets/page-stats.js');
    assert.match(js, /\^media\\\/members\\\//);
    assert.match(js, /muted: true, loop: true, autoplay: true, playsInline: true/);
    assert.match(js, /storageMediaUrl\(raw\)/);
    assert.match(read('supabase/staruniv.sql'), /'대표 사진', coalesce\(m\.photo_path, ''\)/);
    assert.match(read('templates/assets/admin-core.js'), /\^media\\\/members\\\//);
});

test('대표 사진·영상 올리기는 PC 브라우저가 영상을 다시 인코딩하고, 서버 인코딩은 없다', () => {
    const js = read('templates/assets/admin-members.js');
    assert.match(js, code('const CLIP={w:1280,h:720,fps:30,maxSec:6'));
    assert.match(
        js,
        code("encoder:'avc1.42001f',muxer:'avc',extra:{avc:{format:'avc'},hardwareAcceleration:'prefer-software'}")
    );
    assert.match(js, code("encoder:'avc1.4d401f',muxer:'avc'"));
    assert.doesNotMatch(js, /admin_request_member_video|members-photo-raw/);
    assert.match(read('templates/base.html'), /asset_url\('mp4-muxer\.js'\)/);
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /create table if not exists public\.members \([^;]*\bphoto_path text\n\);/);
    assert.match(sql, /'video\/mp4','video\/webm'\]/);
});

test('히어로 편집(설명·서브탭)은 히어로 안, 추가 버튼은 그 서브탭에서만', () => {
    const js = read('templates/assets/admin-site.js');
    assert.match(js, /async function openHeroEditor\(\)/);
    assert.match(js, code("addHeroTool({id:'adminHeroEdit'"));
    assert.match(js, code('cfg.heroDescriptions[page]=desc'));
    assert.match(js, code('cfg.subtabs[page]=sub'));
    const core = read('templates/assets/admin-core.js');
    assert.match(core, code("function addPageTool({id,label,icon='plus',onClick,scope=''})"));
    assert.match(core, /function syncActionBars\(\)/);
    for (const [file, scope] of [
        ['admin-history.js', '#view-history'],
        ['admin-members.js', '#view-member-status'],
        ['admin-tools.js', '#view-tools-external'],
        ['admin-video.js', '#view-video-pick'],
    ]) {
        assert.match(read(`templates/assets/${file}`), code(`scope:'${scope}'`), `${file}: ${scope}`);
    }
});

test('anon에게는 표 권한도 표 정책도 없다: 공개 범위는 공개 읽기 함수의 거르기 조건 한 곳에서 정한다', () => {
    const sql = read('supabase/staruniv.sql');
    // 표 권한이 없으면 anon 정책은 걸리지 않아 같은 조건을 두 곳에 적는 셈이 된다
    assert.doesNotMatch(sql, /create policy [^;]* to anon\b/);
    const revoked = sql.match(/revoke all on (public\.members,[^;]*) from anon;/);
    assert.ok(revoked, '공개 사이트 표 권한 회수');
    for (const t of [
        'members',
        'teams',
        'matches',
        'rounds',
        'tier_members',
        'calendar_events',
        'calendar_off_air',
        'site_config',
        'history_entries',
        'video_channels',
        'videos',
        'video_picks',
        'external_tools',
    ]) {
        assert.match(revoked[1], new RegExp(`public\\.${t}\\b`), `${t}: anon 권한 회수`);
        assert.doesNotMatch(sql, new RegExp(`grant select[^;]* on public\\.${t} to anon`), `${t}: anon 읽기 권한 없음`);
    }
    assert.match(
        sql,
        /create policy university_logos_admin_read on public\.university_logos for select to authenticated using \(true\);/
    );
    const admin = read('templates/assets/admin-history.js');
    assert.doesNotMatch(admin, /histLoadData\(\)/, '어드민은 숨긴 연혁까지 받아야 한다');
});

test('대학 로고는 로고를 그리는 페이지(전적·티어표)가 화면에 나오는 대학 것만 받는다', () => {
    const core = read('templates/assets/core.js');
    assert.match(core, /typeof opts\.logos === 'function' \? loadTeamLogos\(opts\.logos\(\)\)/);
    assert.match(read('templates/assets/api.js'), /apiCall\('api_university_logos', \{ p_names: JSON\.stringify\(/);
    const dir = path.join(ROOT, 'templates', 'assets');
    for (const file of fs.readdirSync(dir).filter(f => /^page-.*\.js$/.test(f))) {
        const js = read(`templates/assets/${file}`);
        const usesLogos = /teamLogoHtml|teamLogoSrc|teamCellInnerHtml/.test(js);
        const asksLogos = /loadTeamLogos\(|bootPage\([\s\S]*logos: \(\) =>/.test(js);
        assert.equal(asksLogos, usesLogos, `${file}: 로고를 쓰면 그 화면의 대학으로 로고를 받고, 안 쓰면 받지 않는다`);
    }
});

test('현황판에 아직 없는 대학(teams.off_board)은 티어표 갱신이 소속을 FA·휴면으로 바꾸지 않는다', () => {
    const py = read('scripts/tiertable/compare.py');
    assert.match(py, /kept_teams = set\(off_board\) - shown/);
    assert.match(py, /- shown - kept_teams\)/);
    for (const file of ['scripts/tiertable/job.py', 'scripts/tier_table.py'])
        assert.match(read(file), /compare\(sections, fa, db, load_candidates\(conn\), load_off_board\(conn\)\)/, file);
    assert.match(
        read('supabase/staruniv.sql'),
        /create table if not exists public\.teams \([^;]*\boff_board boolean not null default false\n\);/
    );
    const teams = read('templates/assets/admin-teams.js');
    assert.match(teams, /checkbox\('tm_off_board'/);
    assert.match(teams, code("off_board:!!document.getElementById('tm_off_board')?.checked"));
    assert.match(read('templates/assets/admin-tier-update.js'), /현황판에 없는 대학 소속\(소속 유지\)/);
});

test('종족은 DB가 테란·저그·프로토스로 맞춰 저장하고, 종족전 통계는 두 표기를 다 센다', () => {
    const sql = read('supabase/staruniv.sql');
    assert.match(sql, /create or replace function public\.normalize_race\(v text\)/);
    for (const table of ['tier_members', 'members', 'rounds', 'tier_member_elo_links', 'elo_players']) {
        assert.match(
            sql,
            new RegExp(
                `create trigger ${table}_normalize_race before insert or update of [a-z_, ]+ on public\\.${table}`
            ),
            table
        );
    }
    assert.match(read('scripts/write_site_data.py'), /race_code\(row\.get\("상대 종족"\)\)/);
    assert.match(sql, /create or replace function public\.normalize_tier\(v text\)/);
    for (const table of ['tier_members', 'members', 'rounds']) {
        assert.match(
            sql,
            new RegExp(
                `create trigger ${table}_normalize_tier before insert or update of [a-z_, ]+ on public\\.${table}`
            ),
            table
        );
    }
    const core = read('templates/assets/core.js');
    assert.match(core, /if \(race\.includes\('랜덤'\)\) return 'R';/);
    assert.match(read('templates/assets/admin-records.js'), code("raceField('종족','our_race')"));
    assert.match(read('templates/assets/admin-tier.js'), code("field('종족',raceSelect(r.race))"));
});

test('보기만 하는 서랍이 저장 버튼을 숨겨도 다음 서랍에 남지 않는다(열 때마다 정한다)', () => {
    const core = read('templates/assets/admin-core.js');
    assert.match(core, code("$('adminDrawerSave').hidden=!opts.onSubmit;"));
    const dir = path.join(ROOT, 'templates', 'assets');
    for (const f of fs.readdirSync(dir).filter(f => /^admin-.*\.js$/.test(f) && f !== 'admin-core.js'))
        assert.doesNotMatch(read(`templates/assets/${f}`), /adminDrawerSave'\)\.hidden/, `${f}: 서랍 함수에 맡긴다`);
});

test('연혁 카드 버튼은 숨기기/보이기만 한다(삭제는 수정 창에서만, 확인을 거쳐)', () => {
    const hist = read('templates/assets/history.js');
    assert.match(hist, code("act('histAdminToggleHidden',key)}>${item.hidden?'보이기':'숨기기'}</button>"));
    assert.doesNotMatch(hist, /histAdminRemove/);
});

test('전적 관리 표를 새로 그리면 펼친 세트 기록도 비운다(옆 경기 줄이 지워지지 않게)', () => {
    const rec = read('templates/assets/admin-records.js');
    const render = rec.slice(rec.indexOf('function render()'));
    assert.match(render.slice(0, 400), code('S.expanded.clear();'));
});

test('관리자 검색어는 .or() 조건을 깨는 쉼표·괄호를 API 한 곳에서 뺀다', () => {
    const api = read('templates/assets/admin-api.js');
    assert.match(api, code("const orTerm=v=>String(v??'').replace(/[%_,()]/g,'');"));
    assert.match(api, code('search=orTerm(search).trim();'));
    assert.match(api, code('const p=orTerm(player);'));
});
