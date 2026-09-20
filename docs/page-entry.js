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

const EntryState = {
    index: null,
    loading: null,
    teams: [null, null],     // 소속 이름
    mode: 'normal',          // 'normal'(1:1 대진) | 'glad'(검투사)
    matches: [],             // normal: [{a, b}]  a/b는 선수 id
    orders: [[], []],        // glad: 팀별 출전 순서(선수 id 배열)
    sel: [null, null],       // 지금 고른 선수(양쪽에서 하나씩 고르면 매치가 된다)
    h2h: {},                 // "a|b" -> {w, l}  (받아온 맞대결)
    shards: {},              // 샤드 경계 -> 진행 중이거나 끝난 요청(같은 샤드 재요청 방지)
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
    const list = entryTeamList();
    [0, 1].forEach(side => {
        const el = document.getElementById(side === 0 ? 'entry-team-a' : 'entry-team-b');
        if (!el) return;
        el.innerHTML = `<option value="">소속 선택</option>`
            + list.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
        if (EntryState.teams[side]) el.value = EntryState.teams[side];
    });
    // 처음 들어오면 캄몬스타즈를 왼쪽에 올려 둔다 - 우리 사이트니까.
    if (!EntryState.teams[0] && list.includes('캄몬스타즈')) entryPickTeam(0, '캄몬스타즈');
}

function entryPickTeam(side, team) {
    EntryState.teams[side] = team || null;
    EntryState.sel = [null, null];
    EntryState.matches = [];
    EntryState.orders = [[], []];
    const el = document.getElementById(side === 0 ? 'entry-team-a' : 'entry-team-b');
    if (el && el.value !== (team || '')) el.value = team || '';
    renderEntry();
}

function entrySwapTeams() {
    EntryState.teams.reverse();
    EntryState.orders.reverse();
    EntryState.matches = EntryState.matches.map(m => ({ a: m.b, b: m.a }));
    EntryState.sel.reverse();
    entryInitTeams();
    [0, 1].forEach(side => {
        const el = document.getElementById(side === 0 ? 'entry-team-a' : 'entry-team-b');
        if (el) el.value = EntryState.teams[side] || '';
    });
    renderEntry();
}

function entrySetMode(mode) {
    EntryState.mode = mode === 'glad' ? 'glad' : 'normal';
    EntryState.sel = [null, null];
    ['normal', 'glad'].forEach(m => {
        const el = document.getElementById(m === 'normal' ? 'entry-mode-normal' : 'entry-mode-glad');
        if (!el) return;
        const on = EntryState.mode === m;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', String(on));
    });
    const lab = document.getElementById('entry-auto-label');
    if (lab) lab.textContent = EntryState.mode === 'glad' ? '순서 자동' : '자동 매치';
    renderEntry();
}

function entryReset() {
    EntryState.matches = [];
    EntryState.orders = [[], []];
    EntryState.sel = [null, null];
    renderEntry();
}

// 선수 한 명 누르기. 1:1 대진에서는 양쪽에서 하나씩 고르면 매치가 되고,
// 검투사에서는 누른 순서가 곧 출전 순서다.
function entryTogglePlayer(side, pid) {
    if (EntryState.mode === 'glad') {
        const order = EntryState.orders[side];
        const at = order.indexOf(pid);
        if (at >= 0) order.splice(at, 1);
        else order.push(pid);
        renderEntry();
        entryRefreshProbs();
        return;
    }
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

function entryMoveOrder(side, i, d) {
    const order = EntryState.orders[side];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    renderEntry();
}

// 자동 채우기. 1:1은 같은 티어끼리 짝지어 주고, 검투사는 약한 순서(티어 아래쪽)부터
// 내보내는 흔한 편성을 기본값으로 깐다 - 어차피 손으로 바꿀 수 있는 출발점이다.
function entryAutoFill() {
    const A = entryRoster(EntryState.teams[0]);
    const B = entryRoster(EntryState.teams[1]);
    if (!A.length || !B.length) return;
    if (EntryState.mode === 'glad') {
        EntryState.orders = [A.slice().reverse().map(p => p.pid), B.slice().reverse().map(p => p.pid)];
        renderEntry();
        entryRefreshProbs();
        return;
    }
    const used = new Set();
    const out = [];
    A.forEach(a => {
        // 같은 티어 우선, 없으면 티어 거리가 가장 가까운 사람
        const cands = B.filter(b => !used.has(b.pid));
        if (!cands.length) return;
        cands.sort((x, y) => Math.abs(tierIndex(x.t) - tierIndex(a.t)) - Math.abs(tierIndex(y.t) - tierIndex(a.t)));
        const pick = cands[0];
        used.add(pick.pid);
        out.push({ a: a.pid, b: pick.pid });
    });
    EntryState.matches = out;
    EntryState.sel = [null, null];
    renderEntry();
    entryRefreshProbs();
}

// 화면에 올라온 선수들의 맞대결을 받아 온 뒤 확률만 다시 그린다.
async function entryRefreshProbs() {
    const pids = EntryState.mode === 'glad'
        ? [...EntryState.orders[0], ...EntryState.orders[1]]
        : EntryState.matches.flatMap(m => [m.a, m.b]);
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

// 검투사: 이긴 사람이 남고 진 팀이 다음 선수를 낸다. 한쪽이 선수를 다 쓰면 끝.
// 상태 (i, j, who) = A의 다음 주자 i, B의 다음 주자 j, 지금 무대에 선 쪽.
// 재귀가 겹치므로 메모로 접는다. 반환: A가 최종 승리할 확률 + 예상 진행.
function entryGladSim(aOrder, bOrder) {
    const memo = new Map();
    function win(i, j, stageSide, stagePid) {
        if (i >= aOrder.length) return 0;      // A가 더 낼 사람이 없다
        if (j >= bOrder.length) return 1;
        const key = `${i}|${j}|${stageSide}|${stagePid}`;
        if (memo.has(key)) return memo.get(key);
        const aPid = stageSide === 0 ? stagePid : aOrder[i];
        const bPid = stageSide === 1 ? stagePid : bOrder[j];
        const wp = entryWinProb(aPid, bPid);
        const p = wp ? wp.p : 0.5;
        // A가 이기면 B가 다음 사람을 내고(j+1), A는 무대에 남는다
        const v = p * win(i, j + 1, 0, aPid) + (1 - p) * win(i + 1, j, 1, bPid);
        memo.set(key, v);
        return v;
    }
    if (!aOrder.length || !bOrder.length) return null;
    const first = entryWinProb(aOrder[0], bOrder[0]);
    const p0 = first ? first.p : 0.5;
    const pa = p0 * win(0, 1, 0, aOrder[0]) + (1 - p0) * win(1, 0, 1, bOrder[0]);
    return { a: pa, b: 1 - pa };
}

// ---------------------------------------------------------------------------
// 그리기
// ---------------------------------------------------------------------------
function entryPlayerChipHtml(side, p, opts) {
    const o = opts || {};
    const sel = EntryState.sel[side] === p.pid;
    const order = EntryState.orders[side].indexOf(p.pid);
    const picked = EntryState.mode === 'glad' ? order >= 0 : sel;
    const badge = EntryState.mode === 'glad' && order >= 0
        ? `<span class="entry-chip-order">${order + 1}</span>` : '';
    return `<button type="button" class="entry-chip${picked ? ' picked' : ''}"
            onclick="entryTogglePlayer(${side},'${jsAttr(p.pid)}')">
        ${badge}
        ${avatarHtml(p.s || '', 'entry-chip-avatar')}
        <span class="entry-chip-name">${escapeHTML(p.n)}</span>
        ${p.r ? raceBadgeHtml(p.r) : ''}
        <span class="entry-chip-tier">${escapeHTML(tierLabel(p.t))}</span>
    </button>`;
}

function renderEntryRosters() {
    const box = document.getElementById('entry-rosters');
    if (!box) return;
    if (!EntryState.index) { box.innerHTML = '<div class="entry-empty">명단을 불러오는 중...</div>'; return; }
    box.innerHTML = [0, 1].map(side => {
        const team = EntryState.teams[side];
        const list = entryRoster(team);
        return `<div class="entry-col">
            <div class="entry-col-head"><span class="entry-col-name">${escapeHTML(team || '소속을 고르세요')}</span><span class="entry-col-count">${list.length}명</span></div>
            <div class="entry-col-body">${list.length
                ? list.map(p => entryPlayerChipHtml(side, p)).join('')
                : '<div class="entry-empty">위에서 소속을 고르면 명단이 나옵니다.</div>'}</div>
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

function entryGladRowHtml(side, pid, i) {
    const p = entryPlayers()[pid];
    if (!p) return '';
    return `<div class="entry-order-row">
        <span class="entry-order-no">${i + 1}</span>
        ${avatarHtml(p.s || '', 'entry-match-avatar')}
        <span class="entry-match-name">${escapeHTML(p.n)}</span>
        ${p.r ? raceBadgeHtml(p.r) : ''}
        <span class="entry-chip-tier">${escapeHTML(tierLabel(p.t))}</span>
        <span class="entry-order-move">
            <button type="button" onclick="entryMoveOrder(${side},${i},-1)" aria-label="위로">▲</button>
            <button type="button" onclick="entryMoveOrder(${side},${i},1)" aria-label="아래로">▼</button>
        </span>
    </div>`;
}

function renderEntryResult() {
    const box = document.getElementById('entry-result');
    if (!box) return;
    const [ta, tb] = EntryState.teams;
    if (!ta || !tb) { box.innerHTML = '<div class="entry-empty">양쪽 소속을 고르면 결과가 나옵니다.</div>'; return; }

    if (EntryState.mode === 'glad') {
        const [oa, ob] = EntryState.orders;
        if (!oa.length || !ob.length) {
            box.innerHTML = '<div class="entry-empty">양쪽에서 선수를 눌러 출전 순서를 정하세요.<br>또는 <b>순서 자동</b>으로 한 번에 채웁니다.</div>';
            return;
        }
        const sim = entryGladSim(oa, ob);
        box.innerHTML = `
            <div class="entry-summary">
                <div class="entry-summary-head">검투사 승리 확률</div>
                ${sim ? entryProbBarHtml(sim.a) : ''}
                <div class="entry-summary-names"><span>${escapeHTML(ta)}</span><span>${escapeHTML(tb)}</span></div>
                <div class="entry-summary-note">이긴 선수가 무대에 남고 진 팀이 다음 주자를 냅니다. 한쪽이 선수를 다 쓰면 끝납니다.</div>
            </div>
            <div class="entry-orders">
                ${[0, 1].map(side => `<div class="entry-order-col">
                    <div class="entry-order-head">${escapeHTML(EntryState.teams[side])} · ${EntryState.orders[side].length}명</div>
                    ${EntryState.orders[side].map((pid, i) => entryGladRowHtml(side, pid, i)).join('')}
                </div>`).join('')}
            </div>`;
        return;
    }

    if (!EntryState.matches.length) {
        box.innerHTML = '<div class="entry-empty">양쪽에서 선수를 하나씩 누르면 대진이 추가됩니다.<br>또는 <b>자동 매치</b>로 한 번에 채웁니다.</div>';
        return;
    }
    const ps = EntryState.matches.map(m => { const w = entryWinProb(m.a, m.b); return w ? w.p : 0.5; });
    const dist = entryScoreDist(ps);
    const n = ps.length;
    const expected = ps.reduce((s, p) => s + p, 0);
    const pWin = dist.reduce((s, v, k) => s + (k > n - k ? v : 0), 0);
    const top = dist.map((v, k) => [k, v]).sort((x, y) => y[1] - x[1]).slice(0, 3);
    box.innerHTML = `
        <div class="entry-summary">
            <div class="entry-summary-head">매치 승리 확률</div>
            ${entryProbBarHtml(pWin)}
            <div class="entry-summary-names"><span>${escapeHTML(ta)}</span><span>${escapeHTML(tb)}</span></div>
            <div class="entry-summary-note">예상 스코어 ${expected.toFixed(1)} : ${(n - expected).toFixed(1)} · 가장 잦은 결과 ${top.map(([k, v]) => `<b>${k}:${n - k}</b> ${(v * 100).toFixed(0)}%`).join(' · ')}</div>
        </div>
        <div class="entry-matches">${EntryState.matches.map(entryMatchRowHtml).join('')}</div>`;
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
    if (EntryState.mode === 'glad') {
        const [oa, ob] = EntryState.orders;
        const n = Math.max(oa.length, ob.length);
        return Array.from({ length: n }, (_, i) => ({
            a: players[oa[i]] || null, b: players[ob[i]] || null, p: null,
        }));
    }
    return EntryState.matches.map(m => {
        const wp = withProb ? entryWinProb(m.a, m.b) : null;
        return { a: players[m.a] || null, b: players[m.b] || null, p: wp ? wp.p : null };
    });
}

function entryTogglePosterProb() {
    EntryState.posterProb = !EntryState.posterProb;
    const el = document.getElementById('entry-poster-prob');
    if (el) {
        el.classList.toggle('on', EntryState.posterProb);
        el.setAttribute('aria-pressed', String(EntryState.posterProb));
    }
}

async function entrySavePoster() {
    const [ta, tb] = EntryState.teams;
    const rows = entryPosterRows();
    if (!ta || !tb || !rows.length) { alert('양쪽 소속을 고르고 대진을 먼저 채워 주세요.'); return; }

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
    ctx.fillText(EntryState.mode === 'glad' ? '검투사 · 출전 순서' : `1:1 대진 · ${rows.length}경기`, W / 2, 170);

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
