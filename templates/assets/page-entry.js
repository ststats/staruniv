/**
 * 도구 > 엔트리: 대학대전 엔트리를 짜 보고, 우리 레이팅으로 승부를 미리 굴려 본다.
 * (core.js -> page-tools.js -> 이 파일)
 *
 * [데이터]
 * 상대전적 index.json 하나면 명단이 다 나온다 - 이름·종족·티어·소속·숲ID·순위·레이팅에
 * 티어별 기준선(ranking.tierLevels)까지 들어 있다. 맞대결 기록만 고른 선수의 샤드를
 * 그때그때 더 받는다(상대전적 탭과 같은 파일을 읽되, 그 쪽 스크립트에 기대지는 않는다).
 *
 * [승률]
 * scripts/build_ranking.py가 로짓을 400/ln10 배율로 펴서 내보내므로, 화면에서는 그냥
 * 표준 Elo 식이 된다:
 *
 *     P(A가 이김) = 1 / (1 + 10^((Rb - Ra) / 400))
 *
 * 레이팅이 없는 선수(최근 1년 10판 미만 등)는 자기 티어의 기준선을 쓴다. 티어도 없으면
 * 사다리 한가운데로 둔다 - 없는 정보를 지어내느니 '평균'이라고 말하는 편이 낫다.
 *
 * [맞대결을 섞는 법]
 * 두 사이트(호사가·캄몬허브)는 맞대결 원본을 그대로 보여준다. 그러면 2승 0패가 20승 18패보다
 * 강해 보이는 함정에 그대로 걸린다. 여기서는 맞대결을 '레이팅 쪽으로 끌어당겨' 섞는다:
 * 판 수가 적으면 거의 레이팅 그대로, 많아질수록 맞대결 쪽으로 간다(H2H_PRIOR 참고).
 */

const ENTRY_INDEX_URL = 'data/h2h/index.json';
// 소속이 이 값이면 지금 쉬는 사람이라 명단에 안 올린다(build_ranking.py의 DORMANT_TEAM과 같다).
const ENTRY_DORMANT = '휴면';
// 맞대결을 레이팅과 섞을 때의 '가상 판 수'. 실제 맞대결이 이만큼 쌓여야 반반이 된다.
// 10으로 두면 3판짜리 맞대결은 23%만 반영되고, 30판이면 75%가 반영된다.
const ENTRY_H2H_PRIOR = 10;
// 맞대결 기간. 상대전적·분석 탭의 기간 칩과 같은 칸이다.
const ENTRY_PERIODS = [['all', '전체'], ['365', '최근 1년'], ['90', '최근 90일'], ['30', '최근 30일']];
const ENTRY_POSTER_W = 1200;      // 저장되는 포스터 가로(px)
// 대학대전은 경기 수가 정해져 있다(9경기 5선승이 흔하다). 동일 티어로 각자 한 번씩만
// 짝지으면 그 수가 안 채워지는 일이 잦은데, 그때는 채워진 만큼 두고 한 번 더 돌려
// 중복으로 나머지를 메운다.
const ENTRY_TARGET_DEFAULT = 9;
// 후보를 늘어놓는 차례. 티어 사다리 순서(갓이 맨 위)가 아니라 대학대전에서 경기를
// 올리는 차례를 따른다 - 숫자 티어가 앞이고, 카드 티어는 뒤에 붙는다.
const ENTRY_TIER_SEQ = ['1', '2', '3', '4', '5', '6', '7', '8',
    '갓', '킹', '잭', '조커', '스페이드', '0', '베이비'];

function entrySeqIndex(tier) {
    const i = ENTRY_TIER_SEQ.indexOf(String(tier));
    return i < 0 ? ENTRY_TIER_SEQ.length : i;
}

const EntryState = {
    index: null,
    loading: null,
    teams: [null, null],     // 소속 이름
    matches: [],             // [{a, b}]  a/b는 선수 id
    sel: [null, null],       // 지금 고른 선수(양쪽에서 하나씩 고르면 매치가 된다)
    query: ['', ''],         // 칸별 검색어. 비어 있으면 그 소속 명단을 보여 준다
    labels: ['', ''],        // 직접 적은 진영 이름(대학대전이 아닐 때 쓴다)
    note: '',                // 포스터 제목(예: '결승전 · 2026-09-21'). 비우면 오늘 날짜
    period: '90',            // 맞대결 기간(ENTRY_PERIODS). 기본은 최근 90일 - 옛날 천적
                             // 관계보다 지금 폼이 엔트리를 짜는 데 쓸모 있다.
    rows: {},                // 선수id -> 경기 행 [날짜, 상대id, 이김, 맵, 형식] (받아 온 것)
    h2hCache: {},            // "기간|a|b" -> {w, l}
    shards: {},              // 샤드 경계 -> 진행 중이거나 끝난 요청(같은 샤드 재요청 방지)
    target: ENTRY_TARGET_DEFAULT,   // 채워야 하는 경기 수
    // 포스터에는 예상 승률을 넣지 않는다 - 포스터는 '엔트리가 이렇게 나왔다'를 알리는
    // 물건이라 밖으로 돌아다닌다. 예측은 화면 안에서만 본다.
    posterProb: false,
    autoTiers: new Set(),       // 자동매칭에 포함할 티어
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function entryEnsureLoaded() {
    if (EntryState.index) return EntryState.index;
    if (!EntryState.loading) {
        ['a', 'b'].forEach(k => {
            const box = document.getElementById(`entry-body-${k}`);
            if (box) box.innerHTML = '<div class="h2h-suggest-empty">명단을 불러오는 중...</div>';
        });
        EntryState.loading = fetch(ENTRY_INDEX_URL, { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => { EntryState.index = data; return data; })
            .catch(e => { EntryState.index = null; throw e; })
            .finally(() => { EntryState.loading = null; });
    }
    try {
        await EntryState.loading;
        entryInitTeams();
        renderEntryPeriod();
        renderEntry();
    } catch (e) {
        ['a', 'b'].forEach(k => {
            const box = document.getElementById(`entry-body-${k}`);
            if (box) box.innerHTML = '<div class="h2h-suggest-empty">명단을 불러오지 못했습니다.</div>';
        });
    }
    return EntryState.index;
}

function entryPlayers() {
    return (EntryState.index && EntryState.index.players) || {};
}

// 소속 목록: 사람이 몇 명이라도 있는 소속만, 인원 많은 순서로.
function entryTeamList() {
    const count = {};
    const players = entryPlayers();
    Object.values(players).forEach(p => {
        const t = String(p.tm || '').trim();
        if (!t || t === ENTRY_DORMANT) return;
        count[t] = (count[t] || 0) + 1;
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b, 'ko'));
}

// 소속을 고르면 그 명단, 안 고르면 씬 전체. 소속 칩은 긴 명단을 줄이는 필터일 뿐이라
// 안 골랐다고 화면을 비워 두지 않는다.
function entryRoster(team) {
    const players = entryPlayers();
    return Object.entries(players)
        .filter(([, p]) => {
            const t = String(p.tm || '').trim();
            if (t === ENTRY_DORMANT) return false;
            return team ? t === team : true;
        })
        .map(([pid, p]) => ({ pid, ...p }))
        .sort((a, b) => entrySeqIndex(a.t) - entrySeqIndex(b.t) || (a.k || 99) - (b.k || 99)
            || String(a.n).localeCompare(String(b.n), 'ko'));
}

// ---------------------------------------------------------------------------
// 레이팅 · 승률
// ---------------------------------------------------------------------------
function entryTierLevels() {
    return (EntryState.index && EntryState.index.ranking && EntryState.index.ranking.tierLevels) || {};
}

// 선수 한 명의 레이팅. 없으면 티어 기준선 -> 그것도 없으면 사다리 한가운데.
function entryRating(p) {
    if (!p) return null;
    if (Number.isFinite(p.rawRating)) return { value: p.rawRating, exact: true };
    const levels = entryTierLevels();
    const byTier = levels[String(p.t)];
    if (Number.isFinite(byTier)) return { value: byTier, exact: false };
    const all = Object.values(levels).filter(Number.isFinite);
    if (!all.length) return null;
    return { value: all.reduce((s, x) => s + x, 0) / all.length, exact: false };
}

// 표준 Elo. build_ranking.py가 400/ln10 배율로 내보내서 그대로 맞아떨어진다.
function entryEloProb(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function entryH2hKey(a, b) { return `${a}|${b}`; }

// 맞대결을 레이팅 쪽으로 끌어당겨 섞는다. 판 수가 적으면 거의 레이팅 그대로 둔다.
// (맨 위 주석 참고 - 2승 0패를 그대로 믿으면 표본이 얇은 쪽이 과대평가된다)
function entryWinProb(aPid, bPid) {
    const players = entryPlayers();
    const ra = entryRating(players[aPid]);
    const rb = entryRating(players[bPid]);
    if (!ra || !rb) return null;
    const base = entryEloProb(ra.value, rb.value);
    const rec = entryH2hRec(aPid, bPid);
    const n = rec ? rec.w + rec.l : 0;
    if (!n) return { p: base, base, n: 0, w: 0, l: 0, exact: ra.exact && rb.exact };
    const obs = rec.w / n;
    const k = n / (n + ENTRY_H2H_PRIOR);            // 맞대결을 얼마나 믿을지
    return { p: base * (1 - k) + obs * k, base, n, w: rec.w, l: rec.l, exact: ra.exact && rb.exact };
}

// 경기 기록은 선수 id 구간별로 쪼개진 샤드에 들어 있다(docs/data/h2h/p/<경계>.json).
// 상대전적 탭과 같은 파일이지만 그 쪽 스크립트를 통째로 끌어오지 않으려고 여기서 직접 읽는다.
function entryShardOf(pid) {
    const bounds = (EntryState.index && EntryState.index.shardBounds) || [];
    const n = Number(pid);
    let found = bounds.length ? bounds[0] : pid;
    for (const b of bounds) {
        if (b > n) break;
        found = b;
    }
    return found;
}

function entryLoadShard(bound) {
    if (EntryState.shards[bound]) return EntryState.shards[bound];
    EntryState.shards[bound] = fetch(`data/h2h/p/${bound}.json`, { cache: 'no-cache' })
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .catch(() => ({}));            // 한 샤드가 없어도 나머지는 그대로 돌아간다
    return EntryState.shards[bound];
}

async function entryLoadPlayerRows(pid) {
    const data = await entryLoadShard(entryShardOf(pid));
    return Array.isArray(data[pid]) ? data[pid] : [];
}

// 고른 선수들의 경기 행을 받아 둔다. 맞대결은 기간이 바뀔 때마다 여기서 다시 센다.
async function entryLoadH2h(pids) {
    await Promise.all([...new Set(pids)].filter(pid => !EntryState.rows[pid]).map(async pid => {
        try { EntryState.rows[pid] = await entryLoadPlayerRows(pid); } catch (e) { EntryState.rows[pid] = []; }
    }));
}

// '최근 90일 전적'처럼 전적 위에 작게 적을 이름
function entryPeriodLabel() {
    if (EntryState.period === 'all') return '통산 전적';
    const found = ENTRY_PERIODS.find(([k]) => k === EntryState.period);
    return `${found ? found[1] : '최근'} 전적`;
}

function entrySinceKey(period) {
    const per = period || EntryState.period;
    if (per === 'all') return '';
    const d = new Date(Date.now() - Number(per) * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// a가 b를 상대로 고른 기간 안에 몇 승 몇 패인가. 한쪽 행만 있어도 뒤집어 센다.
function entryH2hRec(a, b, period) {
    const per = period || EntryState.period;
    const key = `${per}|${a}|${b}`;
    if (EntryState.h2hCache[key]) return EntryState.h2hCache[key];
    const since = per === 'all' ? '' : entrySinceKey(per);
    let w = 0; let l = 0;
    let rows = EntryState.rows[a];
    let flip = false;
    if (!rows) { rows = EntryState.rows[b]; flip = true; }
    if (!rows) return null;
    const opp = String(flip ? a : b);
    rows.forEach(r => {
        if (String(r[1]) !== opp || (since && String(r[0]) < since)) return;
        if (r[2]) w += 1; else l += 1;
    });
    const rec = flip ? { w: l, l: w } : { w, l };
    EntryState.h2hCache[key] = rec;
    return rec;
}

function entrySetPeriod(period) {
    EntryState.period = period;
    renderEntryPeriod();
    renderEntryResult();
}

function renderEntryPeriod() {
    const box = document.getElementById('entry-period');
    if (!box) return;
    box.innerHTML = `<div class="h2h-topbar"><div class="filter-nav h2h-period tab-scroll" role="group" aria-label="맞대결 기간">${ENTRY_PERIODS.map(([key, label]) => `<button type="button" class="filter-item${EntryState.period === key ? ' active' : ''}" aria-pressed="${EntryState.period === key}" onclick="entrySetPeriod('${key}')">${label}</button>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------------------
// 조작
// ---------------------------------------------------------------------------
function entryInitTeams() {
    // 처음 들어오면 캄몬스타즈를 왼쪽에 올려 둔다 - 우리 사이트니까.
    const list = entryTeamList();
    if (!EntryState.teams[0] && list.includes('캄몬스타즈')) EntryState.teams[0] = '캄몬스타즈';
    renderEntryTeamChips();
}

// 소속 고르기. 열네 개를 칩으로 늘어놓으면 줄이 옆으로 흘러 고르기 나쁘다 -
// 참고한 네 사이트가 전부 드롭다운을 쓰는 이유다. 반대쪽이 고른 소속은 막는다.
function renderEntryTeamChips() {
    const list = entryTeamList();
    [0, 1].forEach(side => {
        const el = document.getElementById(side === 0 ? 'entry-team-a' : 'entry-team-b');
        if (!el) return;
        el.innerHTML = '<option value="">전체</option>'
            + list.map(t => {
                const taken = EntryState.teams[1 - side] === t;
                return `<option value="${escapeHTML(t)}"${taken ? ' disabled' : ''}>${escapeHTML(t)}</option>`;
            }).join('');
        el.value = EntryState.teams[side] || '';
    });
}

// 소속을 바꿔도 이미 짠 대진은 지우지 않는다 - 소속 고르기는 아래 명단을 걸러 보는
// 필터일 뿐이고, 다른 대학 선수를 섞어 넣는 경우도 흔하다.
function entryPickTeam(side, team) {
    EntryState.teams[side] = team || null;
    EntryState.sel[side] = null;
    renderEntryTeamChips();
    renderEntry();
    if (!document.getElementById('entry-auto-tier-picker')?.classList.contains('d-none')) renderEntryAutoTierPicker();
}

function entrySwapTeams() {
    EntryState.teams.reverse();
    EntryState.matches = EntryState.matches.map(m => ({ a: m.b, b: m.a }));
    EntryState.sel.reverse();
    renderEntryTeamChips();
    renderEntry();
}

function entryReset() {
    EntryState.matches = [];
    EntryState.sel = [null, null];
    renderEntry();
}

// 선수 한 명 누르기. 양쪽에서 하나씩 고르면 대진이 하나 추가된다.
function entryTogglePlayer(side, pid) {
    EntryState.sel[side] = EntryState.sel[side] === pid ? null : pid;
    const [a, b] = EntryState.sel;
    if (a && b) {
        EntryState.matches.push({ a, b });
        EntryState.sel = [null, null];
    }
    renderEntry();
    entryRefreshProbs();
}

function entryRemoveMatch(i) {
    EntryState.matches.splice(i, 1);
    renderEntry();
}

// 같은 티어로 나올 수 있는 짝을 전부 올린다. 한쪽 잭이 1명이고 상대 잭이 2명이면
// 후보는 두 개다 - 하나만 골라 주면 그건 이미 남이 정한 편성이라, 다 올려두고
// 손으로 추려 내게 둔다. (수술대의 '동일티어전체'가 같은 생각이다)
function entrySameTierPairs() {
    const A = entryRoster(EntryState.teams[0]);
    const B = entryRoster(EntryState.teams[1]);
    if (!A.length || !B.length) return [];
    const byTier = {};
    B.forEach(b => (byTier[String(b.t)] || (byTier[String(b.t)] = [])).push(b));
    const out = [];
    A.forEach(a => (byTier[String(a.t)] || []).forEach(b => out.push({ a: a.pid, b: b.pid })));
    // 경기를 올리는 차례대로 세운다(ENTRY_TIER_SEQ). 같은 티어 안에서는 티어 안 순위 순.
    const players = entryPlayers();
    out.sort((x, y) => {
        const px = players[x.a]; const py = players[y.a];
        return entrySeqIndex(px.t) - entrySeqIndex(py.t)
            || (px.k || 99) - (py.k || 99)
            || (players[x.b].k || 99) - (players[y.b].k || 99);
    });
    return out;
}

// 후보를 뽑는다. 자르지 않는다 - 9경기짜리라고 아홉 개만 주면 그건 이미 남이 정한
// 편성이다. 상대 5티어가 셋이면 그 셋과 붙는 경우가 전부 올라와야 하고, 한 선수가
// 여러 줄에 있는 것도 그대로 둔다(9칸을 같은 티어로 다 못 채우면 그렇게 메운다).
// 여기서 사람이 × 로 추려 경기 수만큼 남기면 그게 곧 엔트리다.
function entryAutoTierChoices() {
    const a = new Set(entryRoster(EntryState.teams[0]).map(p => String(p.t || '')).filter(Boolean));
    const b = new Set(entryRoster(EntryState.teams[1]).map(p => String(p.t || '')).filter(Boolean));
    return ENTRY_TIER_SEQ.filter(t => a.has(t) && b.has(t));
}

function renderEntryAutoTierPicker() {
    const root = document.getElementById('entry-auto-tier-list');
    if (!root) return;
    const tiers = entryAutoTierChoices();
    for (const t of [...EntryState.autoTiers]) if (!tiers.includes(t)) EntryState.autoTiers.delete(t);
    root.innerHTML = tiers.length ? tiers.map(t => {
        const on = EntryState.autoTiers.has(t);
        return `<button type="button" class="entry-auto-tier-chip${on ? ' is-active' : ''}" aria-pressed="${on}" onclick="entryToggleAutoTier('${jsAttr(t)}')">${escapeHTML(tierLabel(t))}</button>`;
    }).join('') : '<span class="entry-auto-tier-empty">양쪽 소속에 공통으로 있는 티어가 없습니다.</span>';
}

function entryToggleAutoTierPicker() {
    if (!EntryState.teams[0] || !EntryState.teams[1]) {
        alert('자동매칭을 하려면 양쪽 소속을 먼저 골라 주세요.');
        return;
    }
    const box = document.getElementById('entry-auto-tier-picker');
    const btn = document.getElementById('entry-auto-btn');
    if (!box) return;
    const opening = box.classList.contains('d-none');
    box.classList.toggle('d-none', !opening);
    if (btn) btn.setAttribute('aria-expanded', String(opening));
    if (opening) renderEntryAutoTierPicker();
}

function entryToggleAutoTier(tier) {
    if (EntryState.autoTiers.has(tier)) EntryState.autoTiers.delete(tier);
    else EntryState.autoTiers.add(tier);
    renderEntryAutoTierPicker();
}

function entrySelectAllAutoTiers() {
    const tiers = entryAutoTierChoices();
    const allOn = tiers.length && tiers.every(t => EntryState.autoTiers.has(t));
    EntryState.autoTiers = new Set(allOn ? [] : tiers);
    renderEntryAutoTierPicker();
}

function entryAutoFillSelectedTiers() {
    if (!EntryState.autoTiers.size) {
        alert('자동매칭에 사용할 티어를 하나 이상 선택해 주세요.');
        return;
    }
    const players = entryPlayers();
    const all = entrySameTierPairs().filter(m => {
        const tier = players[m.a] && String(players[m.a].t || '');
        return EntryState.autoTiers.has(tier);
    });
    if (!all.length) {
        alert('선택한 티어에서 만들 수 있는 대진이 없습니다.');
        return;
    }
    EntryState.matches = all;
    EntryState.sel = [null, null];
    document.getElementById('entry-auto-tier-picker')?.classList.add('d-none');
    document.getElementById('entry-auto-btn')?.setAttribute('aria-expanded', 'false');
    renderEntry();
    entryRefreshProbs();
}

// 기존 외부 호출 호환: 이제 자동매칭 버튼은 티어 선택창을 먼저 연다.
function entryAutoFill() { entryToggleAutoTierPicker(); }

function entrySetTarget(n) {
    EntryState.target = Math.max(1, Math.min(31, Number(n) || ENTRY_TARGET_DEFAULT));
    const el = document.getElementById('entry-target');
    if (el && Number(el.value) !== EntryState.target) el.value = EntryState.target;
    renderEntryResult();
}

// 화면에 올라온 선수들의 맞대결을 받아 온 뒤 확률만 다시 그린다.
async function entryRefreshProbs() {
    const pids = EntryState.matches.flatMap(m => [m.a, m.b]);
    if (!pids.length) return;
    await entryLoadH2h(pids);
    renderEntryResult();
}

// ---------------------------------------------------------------------------
// 시뮬레이션
// ---------------------------------------------------------------------------
// N경기 선승제(9경기면 5선승)를 순서대로 굴린다. 한쪽이 선승 수에 닿으면 거기서 끝이라
// 결과는 5:0 ~ 5:4 꼴로 나온다. 골라 둔 대진이 경기 수보다 적으면(9경기에 7개) 남은
// 자리는 핀볼로 기존 대진 중 하나가 다시 나온다고 보고, 그 자리 승률은 골라 둔 대진의
// 평균으로 둔다.
function entrySeriesSim(ps, games) {
    const need = Math.floor(games / 2) + 1;
    const avg = ps.length ? ps.reduce((sum, p) => sum + p, 0) / ps.length : 0.5;
    const seq = Array.from({ length: games }, (_, i) => (i < ps.length ? ps[i] : avg));
    let live = new Map([['0|0', 1]]);
    const done = new Map();
    seq.forEach(p => {
        const next = new Map();
        live.forEach((v, key) => {
            const [a, b] = key.split('|').map(Number);
            [[a + 1, b, v * p], [a, b + 1, v * (1 - p)]].forEach(([x, y, q]) => {
                const k = `${x}|${y}`;
                const bag = (x >= need || y >= need) ? done : next;
                bag.set(k, (bag.get(k) || 0) + q);
            });
        });
        live = next;
    });
    live.forEach((v, k) => done.set(k, (done.get(k) || 0) + v));   // 짝수 경기에서 비긴 경우
    let pA = 0; let pB = 0; let eA = 0; let eB = 0;
    const scores = [];
    done.forEach((v, k) => {
        const [a, b] = k.split('|').map(Number);
        if (a >= need) pA += v; else if (b >= need) pB += v;
        eA += a * v; eB += b * v;
        scores.push([a, b, v]);
    });
    scores.sort((x, y) => y[2] - x[2]);
    return { need, pA, pB, eA, eB, top: scores.slice(0, 3), filled: games - Math.min(ps.length, games) };
}

// 검색은 소속 안이 아니라 씬 전체를 뒤진다. 여기서 짜는 게 늘 대학대전인 것도 아니고
// (개인대회·이벤트전·용병전도 있다) 엔트리에는 소속 밖 선수도 들어간다. 무엇보다
// 엔트리를 짤 땐 이미 누굴 넣을지 알고 있어서 찍는 게 빠르다. 그래서 소속 칩은
// 명단을 빨리 불러오는 지름길일 뿐, 반드시 골라야 하는 게 아니다.
// 별명(en)도 같이 본다 - 본명과 방송 닉네임이 갈리는 선수가 많다.
const ENTRY_SEARCH_MAX = 40;

function entrySearch(q) {
    const key = String(q || '').trim().toLowerCase();
    if (!key) return [];
    const players = entryPlayers();
    return Object.entries(players)
        .filter(([, p]) => {
            if (String(p.tm || '').trim() === ENTRY_DORMANT) return false;
            return [p.n, p.en, p.tm].filter(Boolean)
                .some(v => String(v).toLowerCase().includes(key));
        })
        .map(([pid, p]) => ({ pid, ...p }))
        .sort((a, b) => entrySeqIndex(a.t) - entrySeqIndex(b.t) || (a.k || 99) - (b.k || 99)
            || String(a.n).localeCompare(String(b.n), 'ko'))
        .slice(0, ENTRY_SEARCH_MAX);
}

// 검색어가 바뀌어도 칸을 통째로 다시 그리지 않는다. 그리면 <input>이 새로 만들어져
// 한글 조합이 그 자리에서 끊긴다('ㅇ'만 남고 사라지는 증상). 목록과 머릿수만 갈아 끼운다.
function entrySetQuery(side, value) {
    EntryState.query[side] = value;
    renderEntryColBody(side);
}

// ---------------------------------------------------------------------------
// 그리기
// 엔트리 전용 크기를 따로 두지 않는다. 사이트에 이미 같은 역할의 부품이 있어서
// 그 클래스를 그대로 쓴다 - 검색창·소속 고르기는 분석 탭 검색(.h2h-input), 선수
// 목록은 상대전적 검색 추천(.h2h-suggest-item), 대진 카드는 동티어 맞대결 카드
// (.h2h-rival)의 치수, 시뮬 결과는 상대전적 머리 스코어판(.h2h-score)이다.
// ---------------------------------------------------------------------------

// 종족·티어 뱃지는 사이트 공용(.tag-badge)을 그대로 쓴다.
function entryRaceBadgeHtml(p) { return p.r ? raceBadgeHtml(p.r) : ''; }

function entryTierBadgeHtml(p) {
    return (p.t !== undefined && p.t !== '')
        ? `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(p.t))}</span>` : '';
}

function entryBadgesHtml(p) { return entryRaceBadgeHtml(p) + entryTierBadgeHtml(p); }

// 선수 한 줄. 프로필 사진은 넣지 않는다 - 이름 길이가 제각각이라 사진까지 붙이면
// 뱃지 줄이 들쭉날쭉해진다. 종족은 이름 왼쪽에, 티어는 줄 오른쪽 끝에 맞춘다.
function entryPlayerItemHtml(side, p, showTeam) {
    const picked = EntryState.sel[side] === p.pid;
    const team = showTeam && p.tm ? `<span class="h2h-suggest-team">${escapeHTML(p.tm)}</span>` : '';
    return `<button type="button" class="h2h-suggest-item${picked ? ' is-picked' : ''}" aria-pressed="${picked}"
            onclick="entryTogglePlayer(${side},'${jsAttr(p.pid)}')">
        ${entryRaceBadgeHtml(p)}
        <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
        ${team}
        ${entryTierBadgeHtml(p)}
    </button>`;
}

// 한쪽 목록만 갈아 끼운다. 검색창·소속 고르기는 tools.html에 고정으로 있어서 절대
// 다시 그리지 않는다 - 다시 그리면 <input>이 새로 생겨 한글 조합이 끊긴다.
function renderEntryColBody(side) {
    const key = side === 0 ? 'a' : 'b';
    const body = document.getElementById(`entry-body-${key}`);
    if (!body) return;
    const team = EntryState.teams[side];
    const q = EntryState.query[side];
    const searching = !!String(q || '').trim();
    const list = searching ? entrySearch(q) : entryRoster(team);
    const label = searching ? '검색 결과' : (team || '전체');
    body.innerHTML = `<div class="h2h-suggest-head">${escapeHTML(label)} ${list.length.toLocaleString('ko-KR')}명</div>`
        + (list.length
            ? list.map(p => entryPlayerItemHtml(side, p, searching || !team)).join('')
            : `<div class="h2h-suggest-empty">${searching ? '찾는 선수가 없습니다.' : '명단이 비어 있습니다.'}</div>`);
}

function renderEntryRosters() {
    [0, 1].forEach(renderEntryColBody);
}

// 대진 카드 한 장. 동티어 맞대결 카드(.h2h-rival)와 같은 치수를 쓴다.
// 가운데 주인공은 맞대결 전적이고, 막대도 그 전적의 승률이다. 예상 승률은
// '시뮬 돌리기'를 눌렀을 때만 맨 아래 한 줄로 붙는다.
function entryMatchRowHtml(m, i) {
    const players = entryPlayers();
    const a = players[m.a]; const b = players[m.b];
    if (!a || !b) return '';
    const wp = entryWinProb(m.a, m.b);
    const has = !!(wp && wp.n);
    const pct = has ? (wp.w / wp.n) * 100 : 0;
    // 상대전적 스코어판과 같은 규칙으로 왼쪽 수는 승리 색, 오른쪽 수는 패배 색
    const rec = `<span class="entry-rec-label">${escapeHTML(entryPeriodLabel())}</span>`
        + (has
            ? `<span class="entry-rec-nums"><span class="entry-vs-num is-a">${wp.w}</span><span class="entry-vs">VS</span><span class="entry-vs-num is-b">${wp.l}</span></span>`
            : '<span class="entry-match-none">맞대결 없음</span>');
    const sim = wp
        ? `<div class="entry-match-sim">예상 승률 <b>${(wp.p * 100).toFixed(1)}%</b> : ${((1 - wp.p) * 100).toFixed(1)}%</div>`
        : '';
    return `<div class="entry-match">
        <div class="entry-match-top">
            <span class="entry-match-no">${i + 1}경기</span>
            <button type="button" class="entry-match-del" onclick="entryRemoveMatch(${i})" aria-label="${i + 1}경기 빼기">✕</button>
        </div>
        <div class="entry-match-row">
            <div class="entry-match-side">
                ${avatarHtml(a.s || '', 'h2h-rival-avatar')}
                <span class="entry-match-who">
                    <span class="h2h-rival-name">${escapeHTML(a.n)}</span>
                    <span class="entry-match-badges">${entryBadgesHtml(a)}</span>
                </span>
            </div>
            <div class="h2h-rival-rec entry-match-rec">${rec}</div>
            <div class="entry-match-side is-b">
                <span class="entry-match-who">
                    <span class="h2h-rival-name">${escapeHTML(b.n)}</span>
                    <span class="entry-match-badges">${entryBadgesHtml(b)}</span>
                </span>
                ${avatarHtml(b.s || '', 'h2h-rival-avatar')}
            </div>
        </div>
        <span class="h2h-rival-bar${has ? '' : ' is-empty'}"><span style="width:${pct}%"></span></span>
        ${sim}
    </div>`;
}

// 한쪽의 이름. 직접 적은 게 있으면 그것, 없으면 고른 소속, 그것도 없으면 그 칸에
// 올라온 선수들의 소속 중 가장 많은 것을 쓴다(용병 한둘이 섞여도 팀 이름은 그대로).
// 양쪽이 같은 이름으로 떨어지면(둘 다 FA인 개인전 같은 경우) A팀/B팀으로 돌린다.
function entryDerivedName(side) {
    // 소속 고르기는 명단 필터라, 대진이 있으면 거기 올라간 선수들의 소속을 먼저 본다
    // (케이대로 짜 둔 뒤 필터를 JSA로 바꿔도 이름이 'JSA'가 되면 안 된다)
    const players = entryPlayers();
    const count = {};
    EntryState.matches.forEach(m => {
        const p = players[side === 0 ? m.a : m.b];
        const t = p && String(p.tm || '').trim();
        if (t) count[t] = (count[t] || 0) + 1;
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || EntryState.teams[side] || '';
}

function entrySideName(side) {
    const typed = String(EntryState.labels[side] || '').trim();
    if (typed) return typed;
    const mine = entryDerivedName(side);
    if (mine && mine !== entryDerivedName(1 - side)) return mine;
    return side === 0 ? 'A팀' : 'B팀';
}

function entrySetNote(value) {
    EntryState.note = value;
}

// 포스터 머리에 적을 한 줄. 안 적었으면 오늘 날짜만 적는다.
function entryPosterNote() {
    const typed = String(EntryState.note || '').trim();
    if (typed) return typed;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function entrySetLabel(side, value) {
    EntryState.labels[side] = value;
    renderEntryResult();
}

// 대진표 위의 네이비 박스. 상대전적 빈 화면(.h2h-empty)과 같은 크기·바탕이고,
// 어떤 상태에서도 이 박스 하나가 뜬다(빈 대진 / 후보가 많음 / 매치 예상).
function entrySummaryHtml(ps) {
    const n = EntryState.matches.length;
    const target = EntryState.target;
    if (!n) {
        return `<div class="h2h-empty entry-summary">
            <div class="h2h-empty-title">아직 대진이 없습니다</div>
            <div class="h2h-empty-sub">양쪽에서 선수를 하나씩 누르거나 자동매칭을 누르세요</div>
        </div>`;
    }
    if (n > target) {
        return `<div class="h2h-empty entry-summary">
            <div class="h2h-empty-title">후보 ${n}개</div>
            <div class="h2h-empty-sub">${target}경기에 맞추려면 ${n - target}개를 빼세요</div>
        </div>`;
    }
    const sim = entrySeriesSim(ps, target);
    const pa = Math.round(sim.pA * 1000) / 10;
    const pb = Math.round(sim.pB * 1000) / 10;
    const bar = sim.pA + sim.pB ? (sim.pA / (sim.pA + sim.pB)) * 100 : 50;
    return `<div class="h2h-empty entry-summary is-score">
        <div class="entry-sum-side">
            <div class="entry-sum-name">${escapeHTML(entrySideName(0))}</div>
            <div class="entry-sum-num is-a">${pa.toFixed(1)}%</div>
        </div>
        <div class="entry-sum-mid">
            <div class="entry-sum-rate">${target}경기 ${sim.need}선승 · 예상 ${sim.eA.toFixed(1)} : ${sim.eB.toFixed(1)}</div>
            <div class="h2h-score-bar"><span style="width:${bar}%"></span></div>
            <div class="entry-sum-sub">자주 나올 결과 ${sim.top.map(([a, b, v]) => `${a}:${b} ${(v * 100).toFixed(0)}%`).join(' · ')}</div>
            ${sim.filled ? `<div class="entry-sum-sub">남은 ${sim.filled}경기는 핀볼로 채운다고 보고 계산</div>` : ''}
        </div>
        <div class="entry-sum-side">
            <div class="entry-sum-name">${escapeHTML(entrySideName(1))}</div>
            <div class="entry-sum-num is-b">${pb.toFixed(1)}%</div>
        </div>
    </div>`;
}

function renderEntryResult() {
    const n = EntryState.matches.length;
    const count = document.getElementById('entry-count');
    if (count) count.textContent = `${n}경기`;
    const ps = EntryState.matches.map(m => { const w = entryWinProb(m.a, m.b); return w ? w.p : 0.5; });
    const sum = document.getElementById('entry-summary');
    if (sum) sum.innerHTML = entrySummaryHtml(ps);
    const box = document.getElementById('entry-result');
    if (box) box.innerHTML = n
        ? `<div class="entry-matches">${EntryState.matches.map(entryMatchRowHtml).join('')}</div>`
        : '';
}

function renderEntry() {
    renderEntryRosters();
    renderEntryResult();
}

// ---------------------------------------------------------------------------
// 포스터 저장 (canvas -> PNG)
// ---------------------------------------------------------------------------
// html2canvas 같은 라이브러리를 끌어오지 않고 캔버스에 직접 그린다 - 포스터는 줄 세우기가
// 전부라 직접 그리는 편이 가볍고, 글꼴/여백을 화면과 따로 잡을 수 있다.
//
// 프로필 사진은 다른 도메인(stimg.sooplive.com)이다. crossOrigin='anonymous'로 받아지면
// 그대로 쓰고, 그 서버가 CORS 헤더를 안 주면 이미지 로드가 실패한다 - 그때는 캔버스를
// 더럽히지 않도록 이름 첫 글자를 넣은 원으로 대신 그린다(저장 자체가 막히는 것보다 낫다).
function entryLoadImage(url) {
    return new Promise(resolve => {
        if (!url) { resolve(null); return; }
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url;
    });
}

// 뱃지 색. style.css의 --color-race-* / --color-tier-badge 와 같은 값이다.
const ENTRY_RACE_COLOR = { T: '#1976d2', Z: '#7b1fa2', P: '#f57f17' };
const ENTRY_RACE_TEXT = { T: '#ffffff', Z: '#ffffff', P: '#141821' };
const ENTRY_TIER_BG = '#1c3563';

// 사이트의 .tag-badge를 캔버스로 옮긴 것 - 노치 깎은 바탕에 글자를 가운데 둔다.
// 반환값은 그린 뱃지의 폭(다음 뱃지를 이어 붙일 때 쓴다).
function entryDrawBadge(ctx, text, x, y, h, bg, fg, fixedW) {
    const label = String(text || '');
    if (!label) return 0;
    const fontSize = Math.round(h * 0.6);
    ctx.save();
    ctx.font = `800 ${fontSize}px Pretendard, sans-serif`;
    const w = fixedW || Math.max(h, Math.ceil(ctx.measureText(label).width) + h * 0.7);
    const cut = Math.round(h * 0.25);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    return w;
}

// 종족 뱃지는 사이트에서 정사각형이다(글자 한 자).
function entryDrawRaceBadge(ctx, letter, x, y, size) {
    const bg = ENTRY_RACE_COLOR[letter];
    if (!bg) return 0;
    return entryDrawBadge(ctx, letter, x, y, size, bg, ENTRY_RACE_TEXT[letter] || '#fff', size);
}

function entryDrawTierBadge(ctx, label, x, y, h) {
    return entryDrawBadge(ctx, label, x, y, h, ENTRY_TIER_BG, '#ffffff');
}

// 종족 + 티어 뱃지를 나란히. align이 'right'면 오른쪽 끝(x)에 맞춰 왼쪽으로 쌓는다.
function entryDrawBadgeRow(ctx, p, x, y, h, align) {
    const gap = 6;
    const raceW = ENTRY_RACE_COLOR[p.r] ? h : 0;
    ctx.save();
    ctx.font = `800 ${Math.round(h * 0.6)}px Pretendard, sans-serif`;
    const tierW = p.t ? Math.max(h, Math.ceil(ctx.measureText(p.t).width) + h * 0.7) : 0;
    ctx.restore();
    const total = raceW + (raceW && tierW ? gap : 0) + tierW;
    let cur = align === 'right' ? x - total : x;
    if (raceW) { entryDrawRaceBadge(ctx, p.r, cur, y, h); cur += raceW + gap; }
    if (tierW) entryDrawTierBadge(ctx, p.t, cur, y, h);
    return total;
}

function entryInitialColor(name) {
    let h = 0;
    String(name || '?').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; });
    return `hsl(${h} 45% 42%)`;
}

function entryDrawAvatar(ctx, img, name, x, y, d) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
        ctx.drawImage(img, x, y, d, d);
    } else {
        ctx.fillStyle = entryInitialColor(name);
        ctx.fillRect(x, y, d, d);
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(d * 0.42)}px Pretendard, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(name || '?').slice(0, 1), x + d / 2, y + d / 2 + 1);
    }
    ctx.restore();
}

function entryPosterRows() {
    const players = entryPlayers();
    const withProb = EntryState.posterProb;
    return EntryState.matches.map(m => {
        const wp = entryWinProb(m.a, m.b);
        const face = p => (p ? {
            n: p.n,
            s: p.s || '',
            r: raceShortLabel(p.r),          // 'T' / 'Z' / 'P'
            t: tierLabel(p.t),
        } : null);
        return {
            a: face(players[m.a]),
            b: face(players[m.b]),
            p: (withProb && wp) ? wp.p : null,
            h2h: (wp && wp.n) ? [wp.w, wp.l] : null,
            // 고른 기간에 맞대결이 없을 수 있어서 통산도 같이 싣는다(참고용)
            all: (() => { const r = entryH2hRec(m.a, m.b, 'all'); return (r && r.w + r.l) ? [r.w, r.l] : null; })(),
        };
    });
}


async function entrySavePoster() {
    const ta = entrySideName(0); const tb = entrySideName(1);
    const rows = entryPosterRows();
    if (!rows.length) { alert('대진을 먼저 만들어 주세요.'); return; }
    // 맞대결을 아직 안 받았으면 먼저 받는다(포스터의 가운데 칸이 그 값이다)
    await entryLoadH2h(EntryState.matches.flatMap(m => [m.a, m.b]));

    const W = ENTRY_POSTER_W;
    // 공유해서 보는 그림이라 휴대폰에서 줄어들어도 읽혀야 한다 - 글자를 넉넉히 키운다
    const PAD = 64, HEAD = 246, FOOT = 86;
    const ROW = EntryState.posterProb ? 172 : 148;
    const H = HEAD + rows.length * ROW + FOOT;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    // 사진을 먼저 다 받아 둔다(캔버스는 동기로 그린다)
    const imgs = await Promise.all(rows.flatMap(r => [r.a, r.b])
        .map(p => entryLoadImage(p ? getProfileImgUrl(p.s || '') : null)));

    const NAVY = '#14264a', GOLD = '#f0b429', TEXT = '#0f172a', SUB = '#64748b';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, HEAD);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '700 22px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STARUNIV · ENTRY', PAD, 70);
    ctx.fillStyle = '#fff';
    ctx.font = '800 64px Pretendard, sans-serif';
    ctx.fillText(ta, PAD, 152);
    ctx.textAlign = 'right';
    ctx.fillText(tb, W - PAD, 152);
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = '800 46px Pretendard, sans-serif';
    ctx.fillText('VS', W / 2, 146);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '700 24px Pretendard, sans-serif';
    ctx.fillText(entryPosterNote(), W / 2, 196);

    rows.forEach((r, i) => {
        const y = HEAD + i * ROW;
        if (i % 2 === 1) { ctx.fillStyle = '#f5f7fb'; ctx.fillRect(0, y, W, ROW); }
        const cy = y + ROW / 2;
        const D = 68;
        entryDrawAvatar(ctx, imgs[i * 2], r.a && r.a.n, PAD, cy - D / 2, D);
        entryDrawAvatar(ctx, imgs[i * 2 + 1], r.b && r.b.n, W - PAD - D, cy - D / 2, D);

        const BADGE = 26;
        const nameX = PAD + D + 20;
        const nameXb = W - PAD - D - 20;

        // 왼쪽: 이름 / 그 아래 종족 뱃지 + 티어
        ctx.textAlign = 'left';
        ctx.fillStyle = TEXT;
        ctx.font = '700 34px Pretendard, sans-serif';
        ctx.fillText(r.a ? r.a.n : '-', nameX, cy - 6);
        if (r.a) entryDrawBadgeRow(ctx, r.a, nameX, cy + 8, BADGE, 'left');

        // 오른쪽: 거울 배치
        ctx.textAlign = 'right';
        ctx.fillStyle = TEXT;
        ctx.font = '700 34px Pretendard, sans-serif';
        ctx.fillText(r.b ? r.b.n : '-', nameXb, cy - 6);
        if (r.b) entryDrawBadgeRow(ctx, r.b, nameXb, cy + 8, BADGE, 'right');

        // 가운데: 맞대결 스코어(크게) / 통산 / 예상 승률
        ctx.textAlign = 'center';
        if (r.h2h) {
            const [hw, hl] = r.h2h;
            ctx.font = '700 22px Pretendard, sans-serif';
            const wV = ctx.measureText('vs').width;
            const gap = 18;
            ctx.font = '800 58px Pretendard, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillStyle = '#1f6fff';
            ctx.fillText(String(hw), W / 2 - wV / 2 - gap, cy + 10);
            ctx.textAlign = 'left';
            ctx.fillStyle = '#f03e3e';
            ctx.fillText(String(hl), W / 2 + wV / 2 + gap, cy + 10);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#9aa5b4';
            ctx.font = '700 22px Pretendard, sans-serif';
            ctx.fillText('vs', W / 2, cy + 2);
        } else {
            ctx.fillStyle = '#c3ccd8';
            ctx.font = '700 28px Pretendard, sans-serif';
            ctx.fillText('맞대결 없음', W / 2, cy + 4);
        }

        if (r.all && EntryState.period !== 'all') {
            ctx.fillStyle = '#9aa5b4';
            ctx.font = '700 19px Pretendard, sans-serif';
            ctx.fillText(`통산 ${r.all[0]} : ${r.all[1]}`, W / 2, cy + 38);
        }

        if (r.p !== null) {
            const pa = Math.round(r.p * 1000) / 10;
            ctx.fillStyle = SUB;
            ctx.font = '700 19px Pretendard, sans-serif';
            ctx.fillText(`예상 ${pa.toFixed(0)}% : ${(100 - pa).toFixed(0)}%`, W / 2, cy + 64);
        }
    });

    const fy = HEAD + rows.length * ROW;
    ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, fy, W, FOOT);
    ctx.fillStyle = SUB;
    ctx.font = '700 21px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`스타대학 · ${entryPeriodLabel()} 기준${EntryState.posterProb ? ' · 예상 승률은 참고용' : ''}`, PAD, fy + 52);
    ctx.textAlign = 'right';
    ctx.fillText(`${rows.length}경기`, W - PAD, fy + 52);

    let url;
    try { url = cv.toDataURL('image/png'); }
    catch (e) { alert('포스터를 만들지 못했습니다. 프로필 사진을 불러올 수 없는 환경일 수 있습니다.'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = `엔트리_${ta}_vs_${tb}.png`;
    a.click();
}
