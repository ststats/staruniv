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
// 맞대결을 셀 때 이 날짜 이후만 본다(너무 옛날 천적 관계까지 끌고 오지 않게).
const ENTRY_H2H_DAYS = 730;
const ENTRY_POSTER_W = 1080;      // 저장되는 포스터 가로(px)
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
    h2h: {},                 // "a|b" -> {w, l}  (받아온 맞대결)
    shards: {},              // 샤드 경계 -> 진행 중이거나 끝난 요청(같은 샤드 재요청 방지)
    target: ENTRY_TARGET_DEFAULT,   // 채워야 하는 경기 수
    // 포스터에 승률을 찍을지. 기본은 끔 - 포스터는 '엔트리가 이렇게 나왔다'를 알리는
    // 물건이라 밖으로 돌아다닌다. 거기에 실제 선수 승부 예측을 박아 두면 성격이
    // 달라지므로, 예측은 화면 안에서만 보고 포스터에는 일부러 안 넣는다.
    posterProb: false,
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function entryEnsureLoaded() {
    if (EntryState.index) return EntryState.index;
    if (!EntryState.loading) {
        const box = document.getElementById('entry-rosters');
        if (box) box.innerHTML = '<div class="entry-empty">명단을 불러오는 중...</div>';
        EntryState.loading = fetch(ENTRY_INDEX_URL, { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => { EntryState.index = data; return data; })
            .catch(e => { EntryState.index = null; throw e; })
            .finally(() => { EntryState.loading = null; });
    }
    try {
        await EntryState.loading;
        entryInitTeams();
        renderEntry();
    } catch (e) {
        const box = document.getElementById('entry-rosters');
        if (box) box.innerHTML = '<div class="entry-empty">명단을 불러오지 못했습니다.</div>';
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

function entryRoster(team) {
    if (!team) return [];
    const players = entryPlayers();
    return Object.entries(players)
        .filter(([, p]) => String(p.tm || '').trim() === team)
        .map(([pid, p]) => ({ pid, ...p }))
        .sort((a, b) => tierIndex(a.t) - tierIndex(b.t) || (a.k || 99) - (b.k || 99)
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
    const rec = EntryState.h2h[entryH2hKey(aPid, bPid)];
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

// 고른 선수들의 맞대결을 한 번에 받아 EntryState.h2h에 채운다.
async function entryLoadH2h(pids) {
    const since = new Date(Date.now() - ENTRY_H2H_DAYS * 86400000);
    const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    await Promise.all([...new Set(pids)].map(async pid => {
        let rows;
        try { rows = await entryLoadPlayerRows(pid); } catch (e) { return; }
        const tally = {};
        (rows || []).forEach(r => {
            if (String(r[0]) < sinceKey) return;
            const opp = String(r[1]);
            (tally[opp] || (tally[opp] = [0, 0]))[r[2] ? 0 : 1] += 1;
        });
        Object.entries(tally).forEach(([opp, [w, l]]) => {
            EntryState.h2h[entryH2hKey(pid, opp)] = { w, l };
            EntryState.h2h[entryH2hKey(opp, pid)] = { w: l, l: w };
        });
    }));
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

// 소속 칩 두 줄. 반대쪽이 이미 고른 소속은 눌러도 소용없으니 흐리게 두고 막는다.
function renderEntryTeamChips() {
    const list = entryTeamList();
    [0, 1].forEach(side => {
        const box = document.getElementById(side === 0 ? 'entry-chips-a' : 'entry-chips-b');
        if (!box) return;
        box.innerHTML = list.map(t => {
            const on = EntryState.teams[side] === t;
            const taken = EntryState.teams[1 - side] === t;
            return `<button type="button" class="entry-team-chip${on ? ' active' : ''}"
                ${taken ? 'disabled' : ''} aria-pressed="${on}"
                onclick="entryPickTeam(${side},'${jsAttr(t)}')">${escapeHTML(t)}</button>`;
        }).join('');
        // 고른 칩이 줄 밖으로 밀려 있으면(소속이 열네 개라 휴대폰에서는 흔하다) 끌어와 보여준다
        const on = box.querySelector('.entry-team-chip.active');
        if (on) box.scrollTo({ left: Math.max(0, on.offsetLeft - 12), behavior: 'smooth' });
    });
}

function entryPickTeam(side, team) {
    // 이미 고른 칩을 또 누르면 해제
    EntryState.teams[side] = (EntryState.teams[side] === team) ? null : (team || null);
    EntryState.sel = [null, null];
    EntryState.matches = [];
    renderEntryTeamChips();
    renderEntry();
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

function entryAllCandidates() {
    EntryState.matches = entrySameTierPairs();
    EntryState.sel = [null, null];
    renderEntry();
    entryRefreshProbs();
}

// 경기 수에 맞춰 엔트리를 짠다.
// 1차 - 같은 티어끼리, 양쪽 모두 한 번씩만. 9경기짜리인데 여기서 4개밖에 안 나오는
//       일이 흔하다. 그래도 그 4개는 그대로 간다.
// 2차 - 모자란 자리를 한 번 더 돌려 채운다. 이번엔 중복을 허용하되, 지금까지 적게
//       나온 선수부터 뽑아 한 사람에게 몰리지 않게 한다(실제로는 핀볼로 뽑는 자리다).
function entryAutoFill() {
    const all = entrySameTierPairs();
    if (!all.length) return;
    const target = EntryState.target;
    const usedA = new Set(); const usedB = new Set();
    const out = [];
    all.forEach(m => {
        if (out.length >= target || usedA.has(m.a) || usedB.has(m.b)) return;
        usedA.add(m.a); usedB.add(m.b);
        out.push(m);
    });
    // 2차: 남은 자리를 중복으로 메운다
    const taken = new Set(out.map(m => `${m.a}|${m.b}`));
    const count = {};
    out.forEach(m => { count[m.a] = (count[m.a] || 0) + 1; count[m.b] = (count[m.b] || 0) + 1; });
    while (out.length < target) {
        const rest = all.filter(m => !taken.has(`${m.a}|${m.b}`));
        if (!rest.length) break;                 // 같은 티어로 더 만들 짝이 없다
        rest.sort((x, y) => ((count[x.a] || 0) + (count[x.b] || 0)) - ((count[y.a] || 0) + (count[y.b] || 0)));
        const pick = rest[0];
        taken.add(`${pick.a}|${pick.b}`);
        count[pick.a] = (count[pick.a] || 0) + 1;
        count[pick.b] = (count[pick.b] || 0) + 1;
        out.push(pick);
    }
    const order = new Map(all.map((m, i) => [`${m.a}|${m.b}`, i]));
    out.sort((x, y) => order.get(`${x.a}|${x.b}`) - order.get(`${y.a}|${y.b}`));
    EntryState.matches = out;
    EntryState.sel = [null, null];
    renderEntry();
    entryRefreshProbs();
}

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
// 1:1 대진: 세트가 서로 독립이라고 보고 이긴 판 수의 분포를 접는다(푸아송 이항).
function entryScoreDist(ps) {
    let dist = [1];
    ps.forEach(p => {
        const next = new Array(dist.length + 1).fill(0);
        dist.forEach((v, k) => { next[k] += v * (1 - p); next[k + 1] += v * p; });
        dist = next;
    });
    return dist;
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

function entrySetQuery(side, value) {
    EntryState.query[side] = value;
    renderEntryRosters();
}

function entryClearQuery(side) {
    EntryState.query[side] = '';
    renderEntryRosters();
    const el = document.getElementById(side === 0 ? 'entry-q-a' : 'entry-q-b');
    if (el) { el.value = ''; el.focus(); }
}

// ---------------------------------------------------------------------------
// 그리기
// ---------------------------------------------------------------------------
// 명단 칩. 대진에 이미 몇 번 올라간 선수인지 숫자로 보여 준다 - 한 선수가 여러 판
// 뛰는 게 정상이라(대학대전이 그렇다) '중복'이 아니라 '몇 경기'로 읽혀야 한다.
function entryPlayerChipHtml(side, p, showTeam) {
    const sel = EntryState.sel[side] === p.pid;
    const used = EntryState.matches.filter(m => (side === 0 ? m.a : m.b) === p.pid).length;
    const badge = used ? `<span class="entry-chip-order">${used}</span>` : '';
    // 검색 결과에서는 소속도 같이 보여 준다 - 씬 전체를 뒤지므로 어느 대학인지가 중요하다
    const team = showTeam && p.tm ? `<span class="entry-chip-team">${escapeHTML(p.tm)}</span>` : '';
    return `<button type="button" class="entry-chip${sel ? ' picked' : ''}"
            onclick="entryTogglePlayer(${side},'${jsAttr(p.pid)}')">
        ${badge}
        ${avatarHtml(p.s || '', 'entry-chip-avatar')}
        <span class="entry-chip-name">${escapeHTML(p.n)}</span>
        ${p.r ? raceBadgeHtml(p.r) : ''}
        ${team}
        <span class="entry-chip-tier">${escapeHTML(tierLabel(p.t))}</span>
    </button>`;
}

function renderEntryRosters() {
    const box = document.getElementById('entry-rosters');
    if (!box) return;
    if (!EntryState.index) { box.innerHTML = '<div class="entry-empty">명단을 불러오는 중...</div>'; return; }
    box.innerHTML = [0, 1].map(side => {
        const team = EntryState.teams[side];
        const q = EntryState.query[side];
        const searching = !!String(q || '').trim();
        const list = searching ? entrySearch(q) : entryRoster(team);
        const head = searching
            ? `검색 결과` : escapeHTML(team || '소속을 고르세요');
        const empty = searching
            ? '찾는 선수가 없습니다.'
            : '위에서 소속을 고르거나 이름으로 찾으세요.';
        return `<div class="entry-col">
            <div class="entry-col-head"><span class="entry-col-name">${head}</span><span class="entry-col-count">${list.length}명</span></div>
            <div class="entry-col-search">
                <input type="search" id="entry-q-${side === 0 ? 'a' : 'b'}" class="entry-search-input"
                    placeholder="이름·대학으로 검색" aria-label="${side === 0 ? '왼쪽' : '오른쪽'} 선수 검색"
                    value="${escapeHTML(q || '')}" oninput="entrySetQuery(${side}, this.value)">
                ${searching ? `<button type="button" class="entry-search-clear" onclick="entryClearQuery(${side})" aria-label="검색어 지우기">×</button>` : ''}
            </div>
            <div class="entry-col-body">${list.length
                ? list.map(p => entryPlayerChipHtml(side, p, searching)).join('')
                : `<div class="entry-empty">${empty}</div>`}</div>
        </div>`;
    }).join('');
}

function entryProbBarHtml(pa) {
    const a = Math.round(pa * 1000) / 10;
    return `<div class="entry-prob">
        <span class="entry-prob-num entry-prob-a">${a.toFixed(1)}%</span>
        <span class="entry-prob-bar"><i style="width:${a}%"></i></span>
        <span class="entry-prob-num entry-prob-b">${(100 - a).toFixed(1)}%</span>
    </div>`;
}

function entryMatchRowHtml(m, i) {
    const players = entryPlayers();
    const a = players[m.a]; const b = players[m.b];
    if (!a || !b) return '';
    const wp = entryWinProb(m.a, m.b);
    const h2h = wp && wp.n
        ? `<span class="entry-h2h">${winLoseText(wp.w, wp.l)}</span>`
        : '<span class="entry-h2h entry-h2h-none">맞대결 없음</span>';
    return `<div class="entry-match">
        <button type="button" class="entry-match-del" onclick="entryRemoveMatch(${i})" aria-label="이 대진 빼기">×</button>
        <div class="entry-match-no">${i + 1}경기</div>
        <div class="entry-match-side">
            ${avatarHtml(a.s || '', 'entry-match-avatar')}
            <span class="entry-match-name">${escapeHTML(a.n)}</span>
            ${a.r ? raceBadgeHtml(a.r) : ''}
        </div>
        <div class="entry-match-mid">${wp ? entryProbBarHtml(wp.p) : ''}${h2h}</div>
        <div class="entry-match-side entry-match-side-b">
            ${b.r ? raceBadgeHtml(b.r) : ''}
            <span class="entry-match-name">${escapeHTML(b.n)}</span>
            ${avatarHtml(b.s || '', 'entry-match-avatar')}
        </div>
    </div>`;
}

// 한쪽의 이름. 직접 적은 게 있으면 그것, 없으면 고른 소속, 그것도 없으면 그 칸에
// 올라온 선수들의 소속 중 가장 많은 것을 쓴다(용병 한둘이 섞여도 팀 이름은 그대로).
// 양쪽이 같은 이름으로 떨어지면(둘 다 FA인 개인전 같은 경우) A팀/B팀으로 돌린다.
function entryDerivedName(side) {
    if (EntryState.teams[side]) return EntryState.teams[side];
    const players = entryPlayers();
    const count = {};
    EntryState.matches.forEach(m => {
        const p = players[side === 0 ? m.a : m.b];
        const t = p && String(p.tm || '').trim();
        if (t) count[t] = (count[t] || 0) + 1;
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
}

function entrySideName(side) {
    const typed = String(EntryState.labels[side] || '').trim();
    if (typed) return typed;
    const mine = entryDerivedName(side);
    if (mine && mine !== entryDerivedName(1 - side)) return mine;
    return mine && !EntryState.teams[side] ? (side === 0 ? 'A팀' : 'B팀') : (mine || (side === 0 ? 'A팀' : 'B팀'));
}

function entrySetLabel(side, value) {
    EntryState.labels[side] = value;
    renderEntryResult();
}

function renderEntryResult() {
    const box = document.getElementById('entry-result');
    if (!box) return;
    if (!EntryState.matches.length) {
        box.innerHTML = '<div class="entry-empty">양쪽에서 선수를 하나씩 누르면 대진이 추가됩니다.<br>소속을 고르면 명단이 한 번에 뜨고, 아니면 이름으로 찾아 넣으면 됩니다.</div>';
        return;
    }
    // 경기 수를 넘어가면 아직 '후보를 늘어놓은' 상태로 본다. 그 수로 스코어 분포를
    // 내 봐야 뜻이 없다. 경기 수 안으로 추려지면 그때부터 엔트리로 보고 확률을 낸다.
    // (중복으로 채운 자리는 정상이다 - 9경기를 같은 티어로 다 못 채우면 그렇게 메운다)
    const ps = EntryState.matches.map(m => { const w = entryWinProb(m.a, m.b); return w ? w.p : 0.5; });
    const n = ps.length;
    const target = EntryState.target;
    let head;
    if (n <= target) {
        const dist = entryScoreDist(ps);
        const expected = ps.reduce((sum, p) => sum + p, 0);
        const pWin = dist.reduce((sum, v, k) => sum + (k > n - k ? v : 0), 0);
        const top = dist.map((v, k) => [k, v]).sort((x, y) => y[1] - x[1]).slice(0, 3);
        head = `<div class="entry-summary">
            <div class="entry-summary-head">매치 승리 확률</div>
            ${entryProbBarHtml(pWin)}
            <div class="entry-summary-names"><span>${escapeHTML(entrySideName(0))}</span><span>${escapeHTML(entrySideName(1))}</span></div>
            <div class="entry-summary-note">${n}경기${n < target ? ` <b>(${target}경기 중 ${target - n}칸 빔)</b>` : ''} · 예상 스코어 ${expected.toFixed(1)} : ${(n - expected).toFixed(1)} · 가장 잦은 결과 ${top.map(([k, v]) => `<b>${k}:${n - k}</b> ${(v * 100).toFixed(0)}%`).join(' · ')}</div>
        </div>`;
    } else {
        head = `<div class="entry-summary">
            <div class="entry-summary-head">후보 ${n}개</div>
            <div class="entry-summary-note">같은 티어로 나올 수 있는 조합을 모두 올렸습니다. × 로 ${target}경기 안으로 추리면 매치 승리 확률과 예상 스코어가 나옵니다.</div>
        </div>`;
    }
    box.innerHTML = head
        + `<div class="entry-matches">${EntryState.matches.map(entryMatchRowHtml).join('')}</div>`;
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
        const wp = withProb ? entryWinProb(m.a, m.b) : null;
        return { a: players[m.a] || null, b: players[m.b] || null, p: wp ? wp.p : null };
    });
}

function entryTogglePosterProb() {
    EntryState.posterProb = !EntryState.posterProb;
    const el = document.getElementById('entry-poster-prob');
    if (el) el.setAttribute('aria-pressed', String(EntryState.posterProb));
}

async function entrySavePoster() {
    const ta = entrySideName(0); const tb = entrySideName(1);
    const rows = entryPosterRows();
    if (!rows.length) { alert('대진을 먼저 만들어 주세요.'); return; }

    const W = ENTRY_POSTER_W;
    const PAD = 56, HEAD = 210, ROW = 108, FOOT = 74;
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
    ctx.font = '700 20px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STARUNIV · ENTRY', PAD, 62);
    ctx.fillStyle = '#fff';
    ctx.font = '800 54px Pretendard, sans-serif';
    ctx.fillText(ta, PAD, 130);
    ctx.textAlign = 'right';
    ctx.fillText(tb, W - PAD, 130);
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = '800 40px Pretendard, sans-serif';
    ctx.fillText('VS', W / 2, 126);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = '600 20px Pretendard, sans-serif';
    ctx.fillText(`${rows.length}경기`, W / 2, 170);

    rows.forEach((r, i) => {
        const y = HEAD + i * ROW;
        if (i % 2 === 1) { ctx.fillStyle = '#f5f7fb'; ctx.fillRect(0, y, W, ROW); }
        const cy = y + ROW / 2;
        const D = 56;
        entryDrawAvatar(ctx, imgs[i * 2], r.a && r.a.n, PAD, cy - D / 2, D);
        entryDrawAvatar(ctx, imgs[i * 2 + 1], r.b && r.b.n, W - PAD - D, cy - D / 2, D);

        ctx.fillStyle = TEXT;
        ctx.font = '700 28px Pretendard, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(r.a ? r.a.n : '-', PAD + D + 18, cy + 10);
        ctx.textAlign = 'right';
        ctx.fillText(r.b ? r.b.n : '-', W - PAD - D - 18, cy + 10);

        ctx.textAlign = 'center';
        if (r.p === null) {
            // 승률을 안 찍을 때는 티어를 가운데 둔다. 양쪽 티어가 같으면 한 번만 적는다.
            const ta2 = r.a ? tierLabel(r.a.t) : '';
            const tb2 = r.b ? tierLabel(r.b.t) : '';
            ctx.fillStyle = SUB;
            ctx.font = '700 22px Pretendard, sans-serif';
            ctx.fillText(ta2 && ta2 === tb2 ? ta2 : [ta2, tb2].filter(Boolean).join('  ·  ') || `${i + 1}`, W / 2, cy + 9);
        } else {
            const pa = Math.round(r.p * 1000) / 10;
            const BW = 210, BH = 12, bx = W / 2 - BW / 2, by = cy + 8;
            ctx.fillStyle = '#e2e8f0'; ctx.fillRect(bx, by, BW, BH);
            ctx.fillStyle = '#1f6fff'; ctx.fillRect(bx, by, BW * (pa / 100), BH);
            ctx.fillStyle = TEXT;
            ctx.font = '700 22px Pretendard, sans-serif';
            ctx.fillText(`${pa.toFixed(0)}%  :  ${(100 - pa).toFixed(0)}%`, W / 2, cy - 8);
        }
    });

    const fy = HEAD + rows.length * ROW;
    ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, fy, W, FOOT);
    ctx.fillStyle = SUB;
    ctx.font = '600 19px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(EntryState.posterProb ? '스타대학 자체 레이팅 기준 예측 · 참고용' : '스타대학 · STARUNIV', PAD, fy + 44);
    ctx.textAlign = 'right';
    const asOf = (EntryState.index && EntryState.index.ranking && EntryState.index.ranking.asOf) || '';
    ctx.fillText(asOf, W - PAD, fy + 44);

    let url;
    try { url = cv.toDataURL('image/png'); }
    catch (e) { alert('포스터를 만들지 못했습니다. 프로필 사진을 불러올 수 없는 환경일 수 있습니다.'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = `엔트리_${ta}_vs_${tb}.png`;
    a.click();
}
