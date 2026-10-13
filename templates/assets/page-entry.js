/**
 * 티어표 > 엔트리: 대학대전 엔트리를 짜 보고, 우리 레이팅으로 승부를 미리 굴려 본다.
 * (core.js → api.js → page-h2h.js → page-analysis.js → 이 파일 → page-tier.js)
 *
 * 승률 중심값: P(A 승) = 1 / (1 + 10^(-(Ra - Rb + 종족상성) / 400)). ststat가 400/ln10 배율로 저장한다.
 * 맞대결·종족전·맵은 원본 전적(2승 0패가 20승 18패보다 강해 보이는 함정) 대신 레이팅이 설명하지 못한
 * '실제 - 기대' 잔차만 표본이 적을수록 0으로 당겨 로짓에 더한다. 시리즈는 entrySeriesSim 참고.
 */

// 소속 목록에는 안 올리고 검색으로만 찾는다.
const ENTRY_DORMANT = '휴면';
// 소속 고르기에서 맨 끝에 둔다.
const ENTRY_FA = 'FA';

const entryPaging = label => ({ wrap: q => withTimeout(q, label) });
const ENTRY_PERIODS = [
    ['all', '전체'],
    ['365', '최근 1년'],
    ['90', '최근 90일'],
    ['30', '최근 30일'],
];
const ENTRY_POSTER_W = 1200;
// 대학대전은 9경기 5선승이 흔하다.
const ENTRY_TARGET_DEFAULT = 9;
// 티어 순 → 티어 안 순위 → 이름
function entryCompare(a, b) {
    return tierIndex(a.t) - tierIndex(b.t) || (a.k || 99) - (b.k || 99) || String(a.n).localeCompare(String(b.n), 'ko');
}

const EntryState = {
    index: null,
    loading: null,
    ratingMetaLoading: null,
    ratingMetaLoaded: new Set(),
    teams: [null, null],
    matches: [], // [{a, b, map}]  a/b는 선수 id
    sel: [null, null], // 양쪽에서 하나씩 고르면 매치가 된다
    query: ['', ''],
    labels: ['', ''], // 직접 적은 진영 이름(대학대전이 아닐 때)
    title: '',
    date: entryToday(),
    dateMonth: '',
    period: '90', // 옛날 천적 관계보다 지금 폼이 엔트리 짜는 데 쓸모 있다
    rows: {}, // 선수id -> [날짜, 상대id, 이김, 맵, 형식][] (통산)
    rowsLoaded: {},
    rowLoads: {}, // 선수id -> 진행 중 요청(중복 조회 방지)
    refreshToken: 0,
    h2hCache: {}, // "기간|a|b" -> {w, l}
    probCache: new Map(), // "a|b|맵" -> 예상승률. entryProbsChanged()가 비운다
    target: ENTRY_TARGET_DEFAULT,
    autoTiers: new Set(),
    analysisOpen: {},
    mapPickerOpen: null,
    mapPickerAll: {},
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function entryLoadIndexFromSupabase() {
    // 랭킹·메타는 기다리지 않는다(보조 쿼리 하나가 느리면 탭 전체가 묶인다). 소속 순서는 작아서 같이 받는다.
    const [playersData, teamOrder] = await Promise.all([
        Api.eloPlayers(entryPaging('선수 목록')),
        Api.teamOrder().catch(() => []),
    ]);

    const players = {};
    playersData.forEach(row => {
        const pid = String(row.elo_id || '');
        if (!pid || !row.nickname) return;
        const nickname = String(row.nickname || row.elo_name || '');
        const eloName = String(row.elo_name || '');
        players[pid] = {
            n: nickname,
            en: eloName && eloName !== nickname ? eloName : '',
            r: raceCode(row.race),
            m: Number(row.total_games || 0),
            tm: String(row.affiliation || ''),
            t: String(row.tier || ''),
            s: String(row.soop_id || ''),
            k: null,
            rawRating: null,
            theta: null,
            thetaSE: null,
        };
    });

    return {
        syncedAt: '',
        players,
        teamOrder,
        maps: {},
        recentMaps: [],
        ranking: { asOf: '', tierCounts: {}, tierLevels: {}, raceMatchup: {} },
    };
}

async function entryLoadRatingMetaInBackground() {
    if (!EntryState.index) return;
    if (EntryState.ratingMetaLoading) return EntryState.ratingMetaLoading;
    const requests = [
        [
            'rankings',
            () => Api.eloRankings(entryPaging('레이팅')),
            rows => {
                const syncedAt = rows.find(row => EntryState.index.players[String(row.elo_id)] && row.as_of)?.as_of;
                if (syncedAt) EntryState.index.syncedAt = String(syncedAt);
                rows.forEach(row => {
                    const player = EntryState.index.players[String(row.elo_id)];
                    if (!player) return;
                    if (!player.t && row.tier) player.t = String(row.tier);
                    player.k = row.tier_rank == null ? null : Number(row.tier_rank);
                    player.rawRating = row.raw_rating == null ? null : Number(row.raw_rating);
                });
            },
        ],
        [
            'meta',
            () => Api.eloRankingMeta({ wrap: q => withTimeout(q, '랭킹 기준선') }),
            meta => {
                EntryState.index.ranking = {
                    asOf: meta.as_of ? String(meta.as_of) : '',
                    tierCounts: meta.tier_counts || {},
                    tierLevels: meta.tier_levels || {},
                    raceMatchup: meta.race_matchup || {},
                };
                if (!EntryState.index.syncedAt && meta.as_of) EntryState.index.syncedAt = String(meta.as_of);
            },
        ],
        [
            'ratings',
            () => Api.eloPlayerRatings(entryPaging('전 선수 레이팅')),
            rows => {
                rows.forEach(row => {
                    const player = EntryState.index.players[String(row.elo_id)];
                    if (!player || row.rating == null) return;
                    player.theta = Number(row.rating);
                    player.thetaSE = row.rating_se == null ? null : Number(row.rating_se);
                });
            },
        ],
    ].filter(([key]) => !EntryState.ratingMetaLoaded.has(key));
    if (!requests.length) return;
    // 서로 독립이라 성공한 것만 적용하고 기억한다. 실패한 종류는 재진입 때 다시 받는다.
    EntryState.ratingMetaLoading = Promise.all(
        requests.map(async ([key, load, apply]) => {
            try {
                apply(await load());
                EntryState.ratingMetaLoaded.add(key);
                entryProbsChanged();
                return true;
            } catch (error) {
                console.warn(`엔트리 보조 데이터(${key})를 불러오지 못했습니다:`, error);
                return false;
            }
        })
    )
        .then(changed => {
            if (!changed.some(Boolean)) return;
            if (TierState.view === 'entry') renderEntry();
        })
        .finally(() => {
            EntryState.ratingMetaLoading = null;
        });
    return EntryState.ratingMetaLoading;
}

async function entryEnsureLoaded() {
    entryRenderDate();
    const isCurrent = tierViewRequest('entry');
    if (!EntryState.index && !EntryState.loading) {
        ['a', 'b'].forEach(k => {
            const box = document.getElementById(`entry-body-${k}`);
            if (box) box.innerHTML = '<div class="content-state">명단을 불러오는 중</div>';
        });

        EntryState.loading = entryLoadIndexFromSupabase()
            .then(data => {
                EntryState.index = data;
                entryInitTeams();
                entryProbsChanged();
                return data;
            })
            .catch(e => {
                EntryState.index = null;
                entryProbsChanged();
                throw e;
            })
            .finally(() => {
                EntryState.loading = null;
            });
    }

    try {
        if (!EntryState.index) await EntryState.loading;
        if (!isCurrent()) return EntryState.index;
        renderEntryTeamChips();
        renderEntryMapDatalist();
        renderEntryPeriod();
        renderEntry();
        entryLoadRatingMetaInBackground();
    } catch (e) {
        if (!isCurrent()) return EntryState.index;
        console.error('엔트리 데이터를 불러오지 못했습니다:', e);
        ['a', 'b'].forEach(k => {
            const box = document.getElementById(`entry-body-${k}`);
            if (box)
                box.innerHTML = `<div class="content-state">명단을 불러오지 못했습니다<br><small>${escapeHTML(e.message || String(e))}</small></div>`;
        });
    }
    return EntryState.index;
}

function entryPlayers() {
    return (EntryState.index && EntryState.index.players) || {};
}

// 창단일 순(api_team_order), 표에 없는 소속은 인원 순, FA는 맨 끝.
function entryTeamList() {
    const count = {};
    const players = entryPlayers();
    Object.values(players).forEach(p => {
        const t = String(p.tm || '').trim();
        if (!t || t === ENTRY_DORMANT) return;
        count[t] = (count[t] || 0) + 1;
    });
    const order = (EntryState.index && EntryState.index.teamOrder) || [];
    const group = t => (t === ENTRY_FA ? 2 : order.includes(t) ? 0 : 1);
    return Object.keys(count).sort(
        (a, b) =>
            group(a) - group(b) ||
            order.indexOf(a) - order.indexOf(b) ||
            count[b] - count[a] ||
            a.localeCompare(b, 'ko')
    );
}

// 소속을 안 골랐으면 비운다. 씬 전체는 수백 명이라 검색이 맡는다.
function entryRoster(team) {
    if (!team) return [];
    const players = entryPlayers();
    return Object.entries(players)
        .filter(([, p]) => String(p.tm || '').trim() === team)
        .map(([pid, p]) => ({ pid, ...p }))
        .sort(entryCompare);
}

// ---------------------------------------------------------------------------
// 레이팅 · 승률
// ---------------------------------------------------------------------------
function entryTierLevels() {
    return (EntryState.index && EntryState.index.ranking && EntryState.index.ranking.tierLevels) || {};
}

function entryMapDict() {
    return (EntryState.index && EntryState.index.maps) || {};
}

function entryMapName(idOrName) {
    const maps = entryMapDict();
    if (idOrName === undefined || idOrName === null || idOrName === '') return '';
    if (Object.prototype.hasOwnProperty.call(maps, String(idOrName)))
        return String(maps[String(idOrName)] || '').trim();
    return String(idOrName || '').trim();
}

function entryNormalizeMapName(value) {
    return entryMapName(value).replace(/\s+/g, '').trim().toLowerCase();
}

function entryMapList() {
    const names = Object.values(entryMapDict())
        .map(v => String(v || '').trim())
        .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko'));
}

function entryRecentMapList() {
    const maps = entryMapDict();
    const raw = (EntryState.index && EntryState.index.recentMaps) || [];
    const names = raw
        .map(item => {
            const id = Array.isArray(item) ? item[0] : item;
            return entryMapName(id);
        })
        .filter(Boolean);
    if (names.length) return [...new Set(names)];
    return entryMapList();
}

function renderEntryMapDatalist() {
    const list = document.getElementById('entry-map-options');
    if (!list) return;
    list.innerHTML = entryMapList()
        .map(name => `<option value="${escapeHTML(name)}"></option>`)
        .join('');
}

// 전 선수 θ → 순위 선수 rawRating → 티어 기준선 → 사다리 한가운데. 없는 정보는 지어내지 않고 평균으로 둔다.
function entryRating(p) {
    if (!p) return null;
    if (Number.isFinite(p.theta)) return { value: p.theta, exact: true };
    if (Number.isFinite(p.rawRating)) return { value: p.rawRating, exact: true };
    const levels = entryTierLevels();
    const byTier = levels[String(p.t)];
    if (Number.isFinite(byTier)) return { value: byTier, exact: false };
    const all = Object.values(levels).filter(Number.isFinite);
    if (!all.length) return null;
    return { value: all.reduce((s, x) => s + x, 0) / all.length, exact: false };
}

const ENTRY_ELO_TO_LOGIT = Math.LN10 / 400;
function entrySigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// raceMatchup은 {TZ, ZP, PT}만 있어 반대 방향은 부호를 바꾼다.
function entryRaceEdge(xRace, yRace) {
    const table = (EntryState.index && EntryState.index.ranking && EntryState.index.ranking.raceMatchup) || {};
    const x = raceCode(xRace),
        y = raceCode(yRace);
    if (!x || !y || x === y) return 0;
    const direct = Number(table[x + y]);
    if (Number.isFinite(direct)) return direct;
    const reverse = Number(table[y + x]);
    return Number.isFinite(reverse) ? -reverse : 0;
}

function entryModelLogit(aPid, bPid) {
    const players = entryPlayers();
    const a = players[aPid],
        b = players[bPid];
    const ra = entryRating(a),
        rb = entryRating(b);
    if (!ra || !rb) return null;
    return (ra.value - rb.value + entryRaceEdge(a && a.r, b && b.r)) * ENTRY_ELO_TO_LOGIT;
}

// 보정은 '결과 - 모델 기대 p̂' 잔차로 잰다(가우스 prior를 둔 로지스틱 오프셋의 한 걸음 추정):
//     보정(로짓) = Σ w·(결과 - p̂) / (Σ w·p̂(1-p̂) + τ)
// 원본 승률 차로 재면 상대 강도가 빠지고, 레이팅에 이미 든 경기를 또 더하게 된다.
// 확률(%p)이 아니라 로짓에서 더해야 자르지 않아도 0~1 안에 머문다.
const ENTRY_FORM_HALF_LIFE = 90;
// 예측은 기간 탭과 무관하게 통산 + 반감기다(탭을 누를 때마다 확률이 바뀌지 않게).
const ENTRY_PREDICTION_PERIOD = 'all';
// 한 판의 정보량이 p̂(1-p̂)≈0.25라 τ=2.5면 가중 10판에서 보정이 절반 반영된다(종족 14 · 맵 18판).
const ENTRY_H2H_TAU = 2.5;
const ENTRY_RACE_TAU = 3.5;
const ENTRY_MAP_TAU = 4.5;
// 데이터 이상치 대비 보정별 상한(로짓). 50% 근처에서 약 ±15%p.
const ENTRY_MAX_ADJ_LOGIT = 0.6;
// ststat staruniv_ranking.CAT_WEIGHT와 같은 값이어야 보정이 레이팅과 같은 기준으로 센다.
const ENTRY_CATEGORY_WEIGHT = {
    solo_event: 1.0,
    college_event: 1.0,
    college_war: 0.9,
    college_mini: 0.8,
    pro_league: 0.7,
    team_event: 0.7,
    sponsored: 0.6,
};
const ENTRY_DEFAULT_CATEGORY_WEIGHT = 0.6;
const ENTRY_ANALYSIS_SMALL_SAMPLE = 5;
const ENTRY_ANALYSIS_GOOD_SAMPLE = 12;

function entryClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
function entryAdjLabel(v) {
    const pp = v * 100;
    return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}%p`;
}
function entryRowAgeDays(dateText) {
    const d = new Date(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return 0;
    const modelDate = String(EntryState.index?.ranking?.asOf || '').slice(0, 10);
    const today = modelDate
        ? new Date(`${modelDate}T00:00:00Z`)
        : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    return Math.max(0, (today.getTime() - d.getTime()) / 86400000);
}
function entryRecentWeight(dateText) {
    return Math.pow(0.5, entryRowAgeDays(dateText) / ENTRY_FORM_HALF_LIFE);
}

// 상대 레이팅이 없는 경기는 기대를 못 세우니 뺀다.
function entryResidualEdge(pid, predicate, tau) {
    const rows = entryRowsInPeriod(EntryState.rows[pid] || [], ENTRY_PREDICTION_PERIOD);
    let num = 0,
        info = 0,
        rawW = 0,
        rawL = 0;
    rows.forEach(r => {
        if (predicate && !predicate(r)) return;
        const logit = entryModelLogit(pid, String(r[1]));
        if (logit === null) return;
        const p = entrySigmoid(logit);
        const w = entryRecentWeight(r[0]) * (ENTRY_CATEGORY_WEIGHT[r[4]] ?? ENTRY_DEFAULT_CATEGORY_WEIGHT);
        const won = Number(r[2]) === 1;
        num += w * ((won ? 1 : 0) - p);
        info += w * p * (1 - p);
        if (won) rawW += 1;
        else rawL += 1;
    });
    const edge = entryClamp(num / (info + tau), -ENTRY_MAX_ADJ_LOGIT, ENTRY_MAX_ADJ_LOGIT);
    return { edge, info, rawW, rawL, rawM: rawW + rawL };
}

function entrySampleLabel(n) {
    const count = Number(n) || 0;
    if (!count) return '표본 없음';
    if (count < ENTRY_ANALYSIS_SMALL_SAMPLE) return '표본 적음';
    if (count < ENTRY_ANALYSIS_GOOD_SAMPLE) return '표본 보통';
    return '표본 충분';
}

function entryRaceLabel(code) {
    const key = raceCode(code);
    return RACE_NAMES[key] || key || '미상';
}

// 예상승률은 비싸서 캐시한다. 입력(전적·레이팅·명단)이 바뀌면 비운다. h2hCache도 같이 비워
// 받기에 실패해 센 '0승 0패'가 다시 받은 뒤 남지 않게 한다.
function entryProbsChanged() {
    EntryState.probCache.clear();
    EntryState.h2hCache = {};
}

function entryWinProb(aPid, bPid, mapName) {
    const key = `${aPid}|${bPid}|${String(mapName || '')}`;
    if (!EntryState.probCache.has(key)) EntryState.probCache.set(key, entryComputeWinProb(aPid, bPid, mapName));
    return EntryState.probCache.get(key);
}

function entryComputeWinProb(aPid, bPid, mapName) {
    const players = entryPlayers();
    const a = players[aPid],
        b = players[bPid];
    const ra = entryRating(a);
    const rb = entryRating(b);
    if (!ra || !rb) return null;

    const baseLogit = entryModelLogit(aPid, bPid);
    const base = entrySigmoid(baseLogit);
    // 화면의 '+x%p'는 각 보정을 기본 승률에 혼자 얹었을 때의 변화량이다.
    const asPp = adj => entrySigmoid(baseLogit + adj) - base;

    // 지금 상대와의 경기는 맞대결에서만 센다(종족전·맵에 또 넣으면 두 번 들어간다).
    const h2h = entryResidualEdge(aPid, r => String(r[1]) === String(bPid), ENTRY_H2H_TAU);
    const h2hLogit = h2h.edge;

    let raceLogit = 0,
        raceA = null,
        raceB = null;
    if (a && b && a.r && b.r) {
        raceA = entryResidualEdge(
            aPid,
            row => {
                const opp = players[row[1]];
                return opp && raceCode(opp.r) === raceCode(b.r) && String(row[1]) !== String(bPid);
            },
            ENTRY_RACE_TAU
        );
        raceB = entryResidualEdge(
            bPid,
            row => {
                const opp = players[row[1]];
                return opp && raceCode(opp.r) === raceCode(a.r) && String(row[1]) !== String(aPid);
            },
            ENTRY_RACE_TAU
        );
        raceLogit = entryClamp(raceA.edge - raceB.edge, -ENTRY_MAX_ADJ_LOGIT, ENTRY_MAX_ADJ_LOGIT);
    }

    const normalizedMap = entryNormalizeMapName(mapName);
    let mapLogit = 0,
        mapA = null,
        mapB = null;
    if (normalizedMap) {
        const onMap = opponent => row =>
            entryNormalizeMapName(row[3]) === normalizedMap && String(row[1]) !== String(opponent);
        mapA = entryResidualEdge(aPid, onMap(bPid), ENTRY_MAP_TAU);
        mapB = entryResidualEdge(bPid, onMap(aPid), ENTRY_MAP_TAU);
        mapLogit = entryClamp(mapA.edge - mapB.edge, -ENTRY_MAX_ADJ_LOGIT, ENTRY_MAX_ADJ_LOGIT);
    }

    const p = entrySigmoid(baseLogit + h2hLogit + raceLogit + mapLogit);
    const h2hAdj = asPp(h2hLogit),
        raceAdj = asPp(raceLogit),
        mapAdj = asPp(mapLogit);
    const factors = [
        { key: 'h2h', adj: h2hAdj, logit: h2hLogit, n: h2h.rawM, rawW: h2h.rawW, rawL: h2h.rawL, rawM: h2h.rawM },
        { key: 'race', adj: raceAdj, logit: raceLogit, a: raceA, b: raceB },
        { key: 'map', adj: mapAdj, logit: mapLogit, a: mapA, b: mapB, map: entryMapName(mapName) },
    ];
    return {
        p,
        base,
        n: h2h.rawM,
        w: h2h.rawW,
        l: h2h.rawL,
        exact: ra.exact && rb.exact,
        factors,
        h2hAdj,
        raceAdj,
        mapAdj,
        raceEdge: entryRaceEdge(a && a.r, b && b.r),
    };
}

// 통산을 받아 두고 기간 탭은 화면에서 걸러 쓰므로 선수마다 한 번만 받는다.
async function entryLoadPlayerRows(pid) {
    const rows = await Api.eloPlayerMatches(pid, entryPaging('선수 전적'));

    const out = [];
    const maps = (EntryState.index && EntryState.index.maps) || {};
    const recent = [];

    rows.forEach(r => {
        const mapName = String(r.map_name || '').trim();
        if (r.map_id != null && mapName) maps[String(r.map_id)] = mapName;
        if (mapName && !recent.includes(mapName)) recent.push(mapName);

        out.push([
            String(r.match_date || ''),
            Number(r.opponent_elo_id),
            r.won ? 1 : 0,
            mapName || (r.map_id == null ? '' : String(r.map_id)),
            String(r.category_name || ''),
        ]);
    });

    if (EntryState.index) {
        EntryState.index.maps = maps;
        EntryState.index.recentMaps = [...recent, ...(EntryState.index.recentMaps || [])]
            .filter((v, i, a) => v && a.indexOf(v) === i)
            .slice(0, 30);
    }

    return out;
}

// 실패한 선수는 다음 호출에서 다시 받는다. 받은(기다린) 선수가 없으면 false.
async function entryLoadH2h(pids) {
    const unique = [...new Set(pids)].filter(Boolean);
    let changed = false;

    await Promise.all(
        unique.map(async pid => {
            if (EntryState.rowsLoaded[pid]) return;
            changed = true;

            const loading = EntryState.rowLoads[pid];
            if (loading) {
                await loading;
                return;
            }

            const promise = entryLoadPlayerRows(pid)
                .then(rows => {
                    EntryState.rows[pid] = rows;
                    EntryState.rowsLoaded[pid] = true;
                    entryProbsChanged();
                    renderEntryMapDatalist();
                })
                .catch(e => {
                    console.warn(`엔트리 선수 ${pid} 전적 조회 실패:`, e);
                    if (!EntryState.rows[pid]) {
                        EntryState.rows[pid] = [];
                        entryProbsChanged();
                    }
                })
                .finally(() => {
                    if (EntryState.rowLoads[pid] === promise) delete EntryState.rowLoads[pid];
                });

            EntryState.rowLoads[pid] = promise;
            await promise;
        })
    );
    return changed;
}

function entryPeriodLabel() {
    if (EntryState.period === 'all') return '통산 전적';
    const found = ENTRY_PERIODS.find(([k]) => k === EntryState.period);
    return `${found ? found[1] : '최근'} 전적`;
}

// 한쪽 행만 있어도 뒤집어 센다.
function entryH2hRec(a, b, period) {
    const per = period || EntryState.period;
    const key = `${per}|${a}|${b}`;
    if (EntryState.h2hCache[key]) return EntryState.h2hCache[key];
    const since = h2hSince(per);
    let w = 0;
    let l = 0;
    let rows = EntryState.rows[a];
    let flip = false;
    if (!rows) {
        rows = EntryState.rows[b];
        flip = true;
    }
    if (!rows) return null;
    const opp = String(flip ? a : b);
    rows.forEach(r => {
        if (String(r[1]) !== opp || (since && String(r[0]) < since)) return;
        if (r[2]) w += 1;
        else l += 1;
    });
    const rec = flip ? { w: l, l: w } : { w, l };
    EntryState.h2hCache[key] = rec;
    return rec;
}

// 통산이면 복사하지 않고 그대로 돌려준다(부르는 곳은 읽기만 한다)
function entryRowsInPeriod(rows, period) {
    const since = h2hSince(period || EntryState.period);
    if (!since) return rows || [];
    return (rows || []).filter(r => String(r[0]) >= since);
}

function entryRecordText(w, l) {
    const n = w + l;
    return n ? `${w}승 ${l}패 · ${((w / n) * 100).toFixed(1)}%` : '전적 없음';
}

// 종족전·맵 전적은 보정과 같이 지금 상대와의 경기(exceptPid)를 빼고 센다.
function entryRaceRecord(pid, oppRace, period, exceptPid) {
    const targetRace = raceCode(oppRace);
    const rows = entryRowsInPeriod(EntryState.rows[pid] || [], period);
    let w = 0;
    let l = 0;
    rows.forEach(r => {
        const opp = entryPlayers()[String(r[1])];
        if (!opp || raceCode(opp.r) !== targetRace || String(r[1]) === String(exceptPid)) return;
        if (Number(r[2]) === 1) w += 1;
        else l += 1;
    });
    return { w, l, m: w + l };
}

function entryMapRecord(pid, mapName, period, exceptPid) {
    const key = entryNormalizeMapName(mapName);
    if (!key) return { w: 0, l: 0, m: 0 };
    const rows = entryRowsInPeriod(EntryState.rows[pid] || [], period);
    let w = 0;
    let l = 0;
    rows.forEach(r => {
        if (entryNormalizeMapName(r[3]) !== key || String(r[1]) === String(exceptPid)) return;
        if (Number(r[2]) === 1) w += 1;
        else l += 1;
    });
    return { w, l, m: w + l };
}

function entryAnalysisStat(label, adj, detail, sampleClass) {
    const cls = adj > 0.0005 ? ' is-a' : adj < -0.0005 ? ' is-b' : '';
    return `<div class="entry-analysis-stat${sampleClass ? ` ${sampleClass}` : ''}">
        <div class="entry-analysis-stat-head"><span>${label}</span><strong class="entry-analysis-adj${cls}">${entryAdjLabel(adj || 0)}</strong></div>
        <div class="entry-analysis-stat-detail">${detail}</div>
    </div>`;
}

function entryAnalysisHtml(match, wp) {
    const players = entryPlayers();
    const a = players[match.a];
    const b = players[match.b];
    if (!a || !b || !wp) return '';
    const ra = entryRating(a);
    const rb = entryRating(b);
    const base = wp.base ?? 0.5;
    const mapName = entryMapName(match.map);
    const raceA = entryRaceRecord(match.a, b.r, EntryState.period, match.b);
    const raceB = entryRaceRecord(match.b, a.r, EntryState.period, match.a);
    const raceN = Math.min(raceA.m, raceB.m);
    const mapA = mapName ? entryMapRecord(match.a, mapName, EntryState.period, match.b) : { w: 0, l: 0, m: 0 };
    const mapB = mapName ? entryMapRecord(match.b, mapName, EntryState.period, match.a) : { w: 0, l: 0, m: 0 };
    const mapN = Math.min(mapA.m, mapB.m);
    const displayH2h = entryH2hRec(match.a, match.b, EntryState.period) || { w: 0, l: 0 };
    const h2hN = displayH2h.w + displayH2h.l;
    const totalAdj = wp.p - base;
    const strongest = [
        ['맞대결', wp.h2hAdj || 0],
        ['종족전', wp.raceAdj || 0],
        ['맵', wp.mapAdj || 0],
    ].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0];
    let summary = '레이팅 차이가 예측의 중심입니다';
    if (strongest && Math.abs(strongest[1]) >= 0.008) {
        const side = strongest[1] > 0 ? a.n : b.n;
        summary = `${strongest[0]} 데이터가 ${side} 쪽으로 가장 크게 보정했습니다`;
    }
    const raceDetail = `${escapeHTML(a.n)} vs ${entryRaceLabel(b.r)} ${entryRecordText(raceA.w, raceA.l)} · ${escapeHTML(b.n)} vs ${entryRaceLabel(a.r)} ${entryRecordText(raceB.w, raceB.l)} · ${entrySampleLabel(raceN)}`;
    const mapDetail = mapName
        ? `${escapeHTML(mapName)} · ${escapeHTML(a.n)} ${entryRecordText(mapA.w, mapA.l)} · ${escapeHTML(b.n)} ${entryRecordText(mapB.w, mapB.l)} · ${entrySampleLabel(mapN)}`
        : '세트 맵을 선택하면 맵 성적을 반영합니다';
    const h2hDetail = h2hN
        ? `${entryPeriodLabel()} ${displayH2h.w}승 ${displayH2h.l}패 · ${entrySampleLabel(h2hN)}`
        : '맞대결 표본 없음';
    const raceEdge = Number(wp.raceEdge) || 0;
    const raceEdgeText =
        Math.abs(raceEdge) >= 0.5
            ? ` · 종족 상성 ${raceEdge > 0 ? escapeHTML(a.n) : escapeHTML(b.n)} +${Math.abs(raceEdge).toFixed(0)}점`
            : '';
    const ratingDetail = `${escapeHTML(a.n)} ${ra ? ra.value.toFixed(0) : '—'} · ${escapeHTML(b.n)} ${rb ? rb.value.toFixed(0) : '—'}${raceEdgeText} · 최근 90일 가중`;
    return `<div class="entry-analysis-panel">
        <div class="entry-analysis-head">
            <div><span class="entry-analysis-eyebrow">WIN PROBABILITY</span><strong>${escapeHTML(a.n)} ${(wp.p * 100).toFixed(1)}%</strong><span class="entry-analysis-vs">${escapeHTML(b.n)} ${((1 - wp.p) * 100).toFixed(1)}%</span></div>
            <span class="entry-analysis-total">기본 ${(base * 100).toFixed(1)}% → ${entryAdjLabel(totalAdj)}</span>
        </div>
        <p class="entry-analysis-summary">${summary}</p>
        <div class="entry-analysis-grid">
            ${entryAnalysisStat('기본 레이팅', 0, ratingDetail)}
            ${entryAnalysisStat('맞대결', wp.h2hAdj || 0, h2hDetail, h2hN && h2hN < ENTRY_ANALYSIS_SMALL_SAMPLE ? 'is-low-sample' : '')}
            ${entryAnalysisStat('종족전', wp.raceAdj || 0, raceDetail, raceN && raceN < ENTRY_ANALYSIS_SMALL_SAMPLE ? 'is-low-sample' : '')}
            ${entryAnalysisStat('선택 맵', wp.mapAdj || 0, mapDetail, mapN && mapN < ENTRY_ANALYSIS_SMALL_SAMPLE ? 'is-low-sample' : '')}
        </div>
        <div class="entry-analysis-foot">보정은 레이팅이 설명하지 못한 '실제 − 기대' 차이만 반영합니다. 승률은 기간 탭과 무관하게 통산 데이터에 90일 반감기를 적용하고, 기간 탭은 위 전적 설명만 바꿉니다. 종족전·맵 전적은 맞대결 경기를 빼고 셉니다</div>
    </div>`;
}

function entrySetPeriod(period) {
    EntryState.period = period;
    EntryState.h2hCache = {};
    renderEntryPeriod();

    // 기간은 표시 전적만 바꾸므로 예상승률 캐시는 그대로 쓴다.
    renderEntryResult();
}

function renderEntryPeriod() {
    const box = document.getElementById('entry-period');
    if (!box) return;
    box.innerHTML = `<div class="h2h-topbar"><div class="filter-nav h2h-period tab-scroll" role="group" aria-label="맞대결 기간">${ENTRY_PERIODS.map(([key, label]) => `<button type="button" class="filter-item${EntryState.period === key ? ' active' : ''}" aria-pressed="${EntryState.period === key}"${act('entrySetPeriod', key)}>${label}</button>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------------------
// 조작
// ---------------------------------------------------------------------------
function entryInitTeams() {
    const list = entryTeamList();
    if (!EntryState.teams[0] && list.includes('캄몬스타즈')) EntryState.teams[0] = '캄몬스타즈';
}

// 소속이 열네 개라 칩보다 드롭다운이 고르기 좋다.
function renderEntryTeamChips() {
    const list = entryTeamList();
    [0, 1].forEach(side => {
        const el = document.getElementById(side === 0 ? 'entry-team-a' : 'entry-team-b');
        if (!el) return;
        el.innerHTML =
            '<option value="">소속 선택</option>' +
            list
                .map(t => {
                    const taken = EntryState.teams[1 - side] === t;
                    return `<option value="${escapeHTML(t)}"${taken ? ' disabled' : ''}>${escapeHTML(t)}</option>`;
                })
                .join('');
        el.value = EntryState.teams[side] || '';
    });
}

// 소속은 명단 필터일 뿐이라 짠 대진은 지우지 않는다(다른 대학 선수를 섞는 경우도 흔하다).
function entryPickTeam(side, team) {
    EntryState.teams[side] = team || null;
    EntryState.sel[side] = null;
    renderEntryTeamChips();
    renderEntry();
    if (!document.getElementById('entry-auto-tier-picker')?.classList.contains('d-none')) renderEntryAutoTierPicker();
}

function entrySwapTeams() {
    EntryState.teams.reverse();
    EntryState.matches = EntryState.matches.map(m => ({ ...m, a: m.b, b: m.a }));
    EntryState.sel.reverse();
    renderEntryTeamChips();
    renderEntry();
}

function entryReset() {
    EntryState.matches = [];
    EntryState.sel = [null, null];
    EntryState.analysisOpen = {};
    EntryState.mapPickerOpen = null;
    EntryState.mapPickerAll = {};
    renderEntry();
}

function entryTogglePlayer(side, pid) {
    EntryState.sel[side] = EntryState.sel[side] === pid ? null : pid;
    const [a, b] = EntryState.sel;
    if (a && b) {
        EntryState.matches.push({ a, b, map: '' });
        EntryState.sel = [null, null];
    }

    // 클릭 결과를 먼저 그린 뒤 네트워크/분석을 시작한다.
    renderEntry();
    requestAnimationFrame(() => entryRefreshProbs());
}

function entryRemoveMatch(i) {
    const prev = EntryState.analysisOpen || {};
    EntryState.matches.splice(i, 1);
    const next = {};
    EntryState.matches.forEach((m, idx) => {
        const oldIdx = idx >= i ? idx + 1 : idx;
        if (prev[oldIdx]) next[idx] = true;
    });
    EntryState.analysisOpen = next;
    renderEntry();
}

// 펼쳐 둔 분석·맵 선택창도 경기를 따라 옮긴다.
function entryMoveMatch(i, step) {
    const j = i + step;
    const list = EntryState.matches;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const open = EntryState.analysisOpen;
    [open[i], open[j]] = [open[j], open[i]];
    if (EntryState.mapPickerOpen === i) EntryState.mapPickerOpen = j;
    else if (EntryState.mapPickerOpen === j) EntryState.mapPickerOpen = i;
    renderEntryResult();
}

function entrySwapMatch(i) {
    const m = EntryState.matches[i];
    if (!m) return;
    EntryState.matches[i] = { ...m, a: m.b, b: m.a };
    renderEntryResult();
}

// 같은 티어로 나올 수 있는 짝을 전부 올리고 사람이 ×로 추린다. 하나만 고르면 이미 남이 정한 편성이다.
function entrySameTierPairs() {
    const A = entryRoster(EntryState.teams[0]);
    const B = entryRoster(EntryState.teams[1]);
    if (!A.length || !B.length) return [];
    const byTier = {};
    B.forEach(b => (byTier[String(b.t)] || (byTier[String(b.t)] = [])).push(b));
    const out = [];
    A.forEach(a => (byTier[String(a.t)] || []).forEach(b => out.push({ a: a.pid, b: b.pid, map: '' })));
    const players = entryPlayers();
    out.sort((x, y) => {
        const px = players[x.a];
        const py = players[y.a];
        return (
            tierIndex(px.t) - tierIndex(py.t) ||
            (px.k || 99) - (py.k || 99) ||
            (players[x.b].k || 99) - (players[y.b].k || 99)
        );
    });
    return out;
}

function entryAutoTierChoices() {
    const a = new Set(
        entryRoster(EntryState.teams[0])
            .map(p => String(p.t || ''))
            .filter(Boolean)
    );
    const b = new Set(
        entryRoster(EntryState.teams[1])
            .map(p => String(p.t || ''))
            .filter(Boolean)
    );
    return TIER_ORDER.filter(t => a.has(t) && b.has(t));
}

function renderEntryAutoTierPicker() {
    const root = document.getElementById('entry-auto-tier-list');
    if (!root) return;
    const tiers = entryAutoTierChoices();
    for (const t of [...EntryState.autoTiers]) if (!tiers.includes(t)) EntryState.autoTiers.delete(t);
    root.innerHTML = tiers.length
        ? tiers
              .map(t => {
                  const on = EntryState.autoTiers.has(t);
                  return `<button type="button" class="entry-auto-tier-chip${on ? ' active' : ''}" aria-pressed="${on}"${act('entryToggleAutoTier', t)}>${escapeHTML(tierLabel(t))}</button>`;
              })
              .join('')
        : '<span class="entry-auto-tier-empty">양쪽 소속에 공통으로 있는 티어가 없습니다</span>';
}

function entryToggleAutoTierPicker() {
    if (!EntryState.teams[0] || !EntryState.teams[1]) {
        alert('자동매칭을 하려면 양쪽 소속을 먼저 골라 주세요');
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
        alert('자동매칭에 사용할 티어를 하나 이상 선택해 주세요');
        return;
    }
    const players = entryPlayers();
    const all = entrySameTierPairs().filter(m => {
        const tier = players[m.a] && String(players[m.a].t || '');
        return EntryState.autoTiers.has(tier);
    });
    if (!all.length) {
        alert('선택한 티어에서 만들 수 있는 대진이 없습니다');
        return;
    }
    EntryState.matches = all.map(m => ({ ...m, map: m.map || '' }));
    EntryState.sel = [null, null];
    document.getElementById('entry-auto-tier-picker')?.classList.add('d-none');
    document.getElementById('entry-auto-btn')?.setAttribute('aria-expanded', 'false');
    renderEntry();
    entryRefreshProbs();
}

function entrySetTarget(n) {
    EntryState.target = Math.max(1, Math.min(31, Number(n) || ENTRY_TARGET_DEFAULT));
    const el = document.getElementById('entry-target');
    if (el && Number(el.value) !== EntryState.target) el.value = EntryState.target;
    renderEntryResult();
}

async function entryRefreshProbs() {
    const pids = EntryState.matches.flatMap(m => [m.a, m.b]);
    if (!pids.length) return;

    const token = ++EntryState.refreshToken;
    // 부르는 곳이 먼저 그리므로 받은 전적이 없으면 다시 그리지 않는다
    const changed = await entryLoadH2h(pids);

    if (!changed || token !== EntryState.refreshToken) return;
    renderEntryResult();
}

// ---------------------------------------------------------------------------
// 시뮬레이션
// ---------------------------------------------------------------------------
// 남은 자리(대진이 경기 수보다 적을 때)는 핀볼로 보고 골라 둔 대진의 평균 승률을 쓴다.
// 세트를 독립으로 굴리면 시리즈 승률이 한쪽으로 쏠려서, 같은 날 팀 컨디션 같은 공통 요인을
// 모든 세트에 더해지는 로짓 흔들림 s ~ N(0, σ²)로 보고 평균을 낸다. σ는 데이터로 맞춘 값이 아닌
// 작게 잡은 가정이다(0.25 로짓 ≈ 50% 근처 ±6%p).
const ENTRY_SERIES_FORM_SIGMA = 0.25;
// 표준정규 N(0,1) 기대값용 5점 가우스-에르미트 마디와 가중치
const ENTRY_GH_NODES = [-2.0201828705, -0.9585724646, 0, 0.9585724646, 2.0201828705];
const ENTRY_GH_WEIGHTS = [0.0112574113, 0.222075922, 0.5333333333, 0.222075922, 0.0112574113];

function entrySeriesSim(ps, games) {
    const logit = p => Math.log(entryClamp(p, 1e-6, 1 - 1e-6) / (1 - entryClamp(p, 1e-6, 1 - 1e-6)));
    const mixed = { pA: 0, pB: 0, eA: 0, eB: 0 };
    const scores = new Map();
    let first = null;
    ENTRY_GH_NODES.forEach((z, i) => {
        const shift = z * ENTRY_SERIES_FORM_SIGMA;
        const run = entrySeriesSimIndependent(
            ps.map(p => entrySigmoid(logit(p) + shift)),
            games
        );
        const w = ENTRY_GH_WEIGHTS[i];
        if (!first) first = run;
        mixed.pA += w * run.pA;
        mixed.pB += w * run.pB;
        mixed.eA += w * run.eA;
        mixed.eB += w * run.eB;
        run.all.forEach(([a, b, v]) => {
            const k = `${a}|${b}`;
            scores.set(k, (scores.get(k) || 0) + w * v);
        });
    });
    const all = [...scores.entries()]
        .map(([k, v]) => {
            const [a, b] = k.split('|').map(Number);
            return [a, b, v];
        })
        .sort((x, y) => y[2] - x[2]);
    return { need: first.need, ...mixed, top: all.slice(0, 2), filled: first.filled };
}

function entryWinsNeeded(games) {
    return Math.floor(games / 2) + 1;
}

function entrySeriesSimIndependent(ps, games) {
    const need = entryWinsNeeded(games);
    const avg = ps.length ? ps.reduce((sum, p) => sum + p, 0) / ps.length : 0.5;
    const seq = Array.from({ length: games }, (_, i) => (i < ps.length ? ps[i] : avg));
    let live = new Map([['0|0', 1]]);
    const done = new Map();
    seq.forEach(p => {
        const next = new Map();
        live.forEach((v, key) => {
            const [a, b] = key.split('|').map(Number);
            [
                [a + 1, b, v * p],
                [a, b + 1, v * (1 - p)],
            ].forEach(([x, y, q]) => {
                const k = `${x}|${y}`;
                const bag = x >= need || y >= need ? done : next;
                bag.set(k, (bag.get(k) || 0) + q);
            });
        });
        live = next;
    });
    live.forEach((v, k) => done.set(k, (done.get(k) || 0) + v)); // 짝수 경기에서 비긴 경우
    let pA = 0;
    let pB = 0;
    let eA = 0;
    let eB = 0;
    const scores = [];
    done.forEach((v, k) => {
        const [a, b] = k.split('|').map(Number);
        if (a >= need) pA += v;
        else if (b >= need) pB += v;
        eA += a * v;
        eB += b * v;
        scores.push([a, b, v]);
    });
    scores.sort((x, y) => y[2] - x[2]);
    return { need, pA, pB, eA, eB, all: scores, top: scores.slice(0, 2), filled: games - Math.min(ps.length, games) };
}

// 검색은 씬 전체(휴면 포함)를 뒤진다. 엔트리에는 소속 밖 선수(용병전·이벤트전)도 들어간다.
const ENTRY_SEARCH_MAX = 40;

function entrySearch(q) {
    const key = String(q || '')
        .trim()
        .toLowerCase();
    if (!key) return [];
    const players = entryPlayers();
    return Object.entries(players)
        .filter(([, p]) => [p.n, p.en, p.tm].filter(Boolean).some(v => String(v).toLowerCase().includes(key)))
        .map(([pid, p]) => ({ pid, ...p }))
        .sort(entryCompare)
        .slice(0, ENTRY_SEARCH_MAX);
}

function entrySetQuery(side, value) {
    EntryState.query[side] = value;
    renderEntryColBody(side);
}

// ---------------------------------------------------------------------------
// 그리기 (상대전적·분석 탭의 부품 클래스를 그대로 쓴다)
// ---------------------------------------------------------------------------

function entryRaceBadgeHtml(p) {
    return p.r ? raceBadgeHtml(p.r) : '';
}

function entryTierBadgeHtml(p) {
    return p.t !== undefined && p.t !== ''
        ? `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(p.t))}</span>`
        : '';
}

function entryBadgesHtml(p) {
    return entryRaceBadgeHtml(p) + entryTierBadgeHtml(p);
}

// 프로필 사진은 넣지 않는다. 이름 길이가 제각각이라 뱃지 줄이 들쭉날쭉해진다.
function entryPlayerItemHtml(side, p, showTeam) {
    const picked = EntryState.sel[side] === p.pid;
    const team = showTeam && p.tm ? `<span class="h2h-suggest-team">${escapeHTML(p.tm)}</span>` : '';
    return `<button type="button" class="h2h-suggest-item${picked ? ' is-picked' : ''}" aria-pressed="${picked}"
            ${act('entryTogglePlayer', side, p.pid)}>
        ${entryRaceBadgeHtml(p)}
        <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
        ${team}
        ${entryTierBadgeHtml(p)}
    </button>`;
}

function entrySetMatchMap(index, value, commit) {
    const m = EntryState.matches[index];
    if (!m) return;
    m.map = String(value || '').trim();
    if (commit) {
        EntryState.mapPickerOpen = null;
        renderEntryResult();
        entryRefreshProbs();
    }
}

function entryToggleAnalysis(index) {
    if (!EntryState.matches[index]) return;
    EntryState.analysisOpen[index] = !EntryState.analysisOpen[index];
    EntryState.mapPickerOpen = null;
    renderEntryResult();
}

function entryToggleMapPicker(index) {
    if (!EntryState.matches[index]) return;
    EntryState.mapPickerOpen = EntryState.mapPickerOpen === index ? null : index;
    renderEntryResult();
}

function entryToggleAllMaps(index) {
    EntryState.mapPickerAll[index] = !EntryState.mapPickerAll[index];
    renderEntryResult();
}

function entryChooseMap(index, value) {
    entrySetMatchMap(index, value, true);
}

function entryChooseCustomMap(index) {
    const current = entryMapName(EntryState.matches[index]?.map || '');
    const custom = window.prompt('맵 이름을 입력하세요', current) || '';
    if (!custom.trim()) return;
    entrySetMatchMap(index, custom.trim(), true);
}

function entryMapPickerHtml(index, current) {
    const recent = entryRecentMapList();
    const all = entryMapList();
    const showAll = Boolean(EntryState.mapPickerAll[index]);
    const primary = recent.slice(0, 8);
    const chosen = entryMapName(current);
    const list = showAll ? all : primary;
    const buttons = list
        .map(name => {
            const picked = chosen && entryNormalizeMapName(chosen) === entryNormalizeMapName(name);
            return `<button type="button" class="entry-map-option${picked ? ' is-picked' : ''}"${act('entryChooseMap', index, name)}>${escapeHTML(name)}</button>`;
        })
        .join('');
    return `<div class="entry-map-popover">
        <div class="entry-map-popover-head"><strong>${showAll ? '전체 맵' : '최근 많이 하는 맵'}</strong><span>${showAll ? all.length : Math.min(primary.length, all.length)}개</span></div>
        <div class="entry-map-options">${buttons || '<span class="entry-map-empty">맵 정보가 없습니다</span>'}</div>
        <div class="entry-map-popover-actions">
            <button type="button"${act('entryToggleAllMaps', index)}>${showAll ? '최근 맵만' : '전체 맵 보기'}</button>
            <button type="button"${act('entryChooseCustomMap', index)}>직접 입력</button>
        </div>
    </div>`;
}

// 목록만 갈아 끼운다. 검색 <input>을 다시 만들면 한글 조합이 끊긴다.
function renderEntryColBody(side) {
    const key = side === 0 ? 'a' : 'b';
    const body = document.getElementById(`entry-body-${key}`);
    if (!body) return;
    const team = EntryState.teams[side];
    const q = EntryState.query[side];
    const searching = !!String(q || '').trim();
    const list = searching ? entrySearch(q) : entryRoster(team);
    if (!searching && !team) {
        body.innerHTML = '<div class="content-state">소속을 고르거나 검색하세요</div>';
        return;
    }
    const label = searching ? '검색 결과' : team;
    body.innerHTML =
        `<div class="h2h-suggest-head">${escapeHTML(label)} ${formatNum(list.length)}명</div>` +
        (list.length
            ? list.map(p => entryPlayerItemHtml(side, p, searching)).join('')
            : `<div class="content-state">${searching ? '찾는 선수가 없습니다' : '명단이 비어 있습니다'}</div>`);
}

function renderEntryRosters() {
    [0, 1].forEach(renderEntryColBody);
}

const ENTRY_SWAP_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg>';

function entryMatchRowHtml(m, i, wp) {
    const players = entryPlayers();
    const a = players[m.a];
    const b = players[m.b];
    if (!a || !b) return '';

    // 표시 전적은 기간 탭을 따르고, 예상승률(wp)은 통산 + 반감기다.
    const displayRec = entryH2hRec(m.a, m.b, EntryState.period) || { w: 0, l: 0 };
    const rawTotal = Number(displayRec.w || 0) + Number(displayRec.l || 0);
    const has = rawTotal > 0;
    const pct = has ? (Number(displayRec.w || 0) / rawTotal) * 100 : 0;
    const rec =
        `<span class="entry-rec-label">${escapeHTML(entryPeriodLabel())}</span>` +
        (has
            ? `<span class="entry-rec-nums"><span class="entry-vs-num is-a">${displayRec.w}</span><span class="entry-vs">VS</span><span class="entry-vs-num is-b">${displayRec.l}</span></span>`
            : '<span class="entry-match-none">맞대결 없음</span>');
    const probText = wp
        ? `<span class="entry-match-probval">예상 승률 <b>${(wp.p * 100).toFixed(1)}%</b> : ${((1 - wp.p) * 100).toFixed(1)}%</span>`
        : '<span class="entry-match-probval">예상 승률을 계산할 수 없습니다</span>';
    const mapValue = entryMapName(m.map);
    const isOpen = Boolean(EntryState.analysisOpen[i]);
    const analysis = wp && isOpen ? entryAnalysisHtml(m, wp) : '';
    return `<div class="entry-match${isOpen ? ' is-open' : ''}">
        <div class="entry-match-top">
            <span class="entry-match-no">${i + 1}경기</span>
            <span class="entry-match-tools">
                <button type="button" class="entry-match-tool is-up"${act('entryMoveMatch', i, -1)} aria-label="${i + 1}경기 위로"${i === 0 ? ' disabled' : ''}>${chevronDownSvg(11)}</button>
                <button type="button" class="entry-match-tool"${act('entryMoveMatch', i, 1)} aria-label="${i + 1}경기 아래로"${i === EntryState.matches.length - 1 ? ' disabled' : ''}>${chevronDownSvg(11)}</button>
                <button type="button" class="entry-match-tool"${act('entrySwapMatch', i)} aria-label="${i + 1}경기 진영 교체">${ENTRY_SWAP_SVG}</button>
                <button type="button" class="entry-match-tool is-del"${act('entryRemoveMatch', i)} aria-label="${i + 1}경기 빼기">✕</button>
            </span>
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
        <div class="entry-match-footer">
            <div class="entry-map-control${EntryState.mapPickerOpen === i ? ' is-open' : ''}">
                <button type="button" class="entry-map-trigger" aria-expanded="${EntryState.mapPickerOpen === i ? 'true' : 'false'}"${act('entryToggleMapPicker', i)}>
                    <span>${escapeHTML(mapValue || '맵 선택')}</span>${chevronDownSvg(9, ` class="chevron-rotatable${EntryState.mapPickerOpen === i ? ' is-open' : ''}"`)}
                </button>
            </div>
            <div class="entry-match-sim">${probText}</div>
            <button type="button" class="entry-analysis-toggle" aria-expanded="${isOpen ? 'true' : 'false'}"${act('entryToggleAnalysis', i)}>
                <span>${isOpen ? '접기' : '분석'}</span>${chevronDownSvg(9, ` class="chevron-rotatable${isOpen ? ' is-open' : ''}"`)}
            </button>
        </div>
        ${EntryState.mapPickerOpen === i ? entryMapPickerHtml(i, mapValue) : ''}
        ${analysis}
    </div>`;
}

// 양쪽이 같은 이름이 되면(둘 다 FA 등) A팀/B팀으로 둔다.
function entryDerivedName(side) {
    // 소속 고르기는 명단 필터라 대진에 올라간 선수들의 최다 소속을 먼저 본다(용병 한둘은 무시된다)
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

function entrySetTitle(value) {
    EntryState.title = value;
}

function entryToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// type=date는 언어 설정에 따라 '10/10/2026'처럼 보여서 YYYY-MM-DD 달력을 직접 그린다.
function entryRenderDate() {
    const text = document.getElementById('entry-date-text');
    if (text) text.textContent = EntryState.date;
}

function entryDatePickerOpen() {
    const box = document.getElementById('entry-date-popover');
    return Boolean(box && !box.classList.contains('d-none'));
}

function entryToggleDatePicker() {
    const box = document.getElementById('entry-date-popover');
    if (!box) return;
    if (entryDatePickerOpen()) {
        entryCloseDatePicker();
        return;
    }
    EntryState.dateMonth = EntryState.date.slice(0, 7);
    renderEntryDatePicker();
    box.classList.remove('d-none');
    document.getElementById('entry-date')?.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', entryDateOutsideClick);
    document.addEventListener('keydown', entryDateKey);
}

function entryCloseDatePicker() {
    document.getElementById('entry-date-popover')?.classList.add('d-none');
    document.getElementById('entry-date')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', entryDateOutsideClick);
    document.removeEventListener('keydown', entryDateKey);
}

function entryShiftDateMonth(step) {
    const [y, m] = EntryState.dateMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + step, 1);
    EntryState.dateMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renderEntryDatePicker();
}

function entryPickDate(value) {
    EntryState.date = value;
    entryRenderDate();
    entryCloseDatePicker();
    document.getElementById('entry-date')?.focus();
}

function renderEntryDatePicker() {
    const box = document.getElementById('entry-date-popover');
    if (!box) return;
    const month = EntryState.dateMonth;
    const [y, m] = month.split('-').map(Number);
    const today = entryToday();
    let cells = '<span></span>'.repeat(new Date(y, m - 1, 1).getDay());
    for (let day = 1, days = new Date(y, m, 0).getDate(); day <= days; day++) {
        const d = `${month}-${String(day).padStart(2, '0')}`;
        const cls = `entry-cal-day${d === today ? ' is-today' : ''}${d === EntryState.date ? ' active' : ''}`;
        cells += `<button type="button" class="${cls}" aria-pressed="${d === EntryState.date}"${act('entryPickDate', d)}>${day}</button>`;
    }
    box.innerHTML = `<div class="entry-cal-head">
            <button type="button" class="entry-cal-nav is-prev" aria-label="이전 달"${act('entryShiftDateMonth', -1)}>${chevronDownSvg(11)}</button>
            <span class="entry-cal-title">${y}년 ${m}월</span>
            <button type="button" class="entry-cal-nav is-next" aria-label="다음 달"${act('entryShiftDateMonth', 1)}>${chevronDownSvg(11)}</button>
        </div>
        <div class="entry-cal-grid">${['일', '월', '화', '수', '목', '금', '토'].map(w => `<span class="entry-cal-weekday">${w}</span>`).join('')}${cells}</div>
        <div class="entry-cal-foot">
            <button type="button" class="text-action"${act('entryPickDate', today)}>오늘</button>
        </div>`;
}

// 달을 넘기면 누른 버튼이 다시 그려져 문서에서 빠지므로 composedPath로 바깥인지 본다.
function entryDateOutsideClick(e) {
    if (!e.composedPath().some(el => el.classList?.contains('entry-date-field'))) entryCloseDatePicker();
}
function entryDateKey(e) {
    if (e.key !== 'Escape') return;
    entryCloseDatePicker();
    document.getElementById('entry-date')?.focus();
}

function entrySetLabel(side, value) {
    EntryState.labels[side] = value;
    renderEntryResult();
}

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
            <div class="entry-sum-sub">예상 결과 ${sim.top.map(([a, b, v]) => `${a}:${b} ${(v * 100).toFixed(0)}%`).join(' · ')}</div>
            ${sim.filled ? `<div class="entry-sum-sub">남은 경기는 핀볼로 채우고 계산</div>` : ''}
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
    const wps = EntryState.matches.map(m => entryWinProb(m.a, m.b, m.map));
    const ps = wps.map(w => (w ? w.p : 0.5));
    const sum = document.getElementById('entry-summary');
    if (sum) sum.innerHTML = entrySummaryHtml(ps);
    const box = document.getElementById('entry-result');
    if (box)
        box.innerHTML = n
            ? `<div class="entry-matches">${EntryState.matches.map((m, i) => entryMatchRowHtml(m, i, wps[i])).join('')}</div>`
            : '';
}

function renderEntry() {
    renderEntryRosters();
    renderEntryResult();
}

// ---------------------------------------------------------------------------
// 포스터 저장 (canvas -> PNG)
// ---------------------------------------------------------------------------
// 프로필 사진은 다른 도메인이라 CORS가 막히면 null을 돌려 캔버스를 더럽히지 않는다(이니셜 원으로 대신).
function entryLoadImage(url) {
    return new Promise(resolve => {
        if (!url) {
            resolve(null);
            return;
        }
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url;
    });
}

// 포스터는 테마와 상관없이 흰 바탕이라 지금 테마가 아니라 :root(라이트) 토큰 값을 읽는다.
let entryPaletteCache = null;
function entryPalette() {
    if (entryPaletteCache) return entryPaletteCache;
    const vars = {};
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (e) {
            continue;
        }
        for (const r of rules) {
            if (r.selectorText !== ':root') continue;
            for (const p of r.style) if (p.startsWith('--')) vars[p] = r.style.getPropertyValue(p).trim();
        }
    }
    const tok = (name, depth = 0) => {
        const v = vars[name] || '';
        const ref = v.match(/^var\((--[\w-]+)\)$/);
        return ref && depth < 5 ? tok(ref[1], depth + 1) : v;
    };
    entryPaletteCache = {
        race: { T: tok('--color-race-t'), Z: tok('--color-race-z'), P: tok('--color-race-p') },
        raceText: { T: '#fff', Z: '#fff', P: tok('--color-race-p-text') },
        tier: tok('--color-tier-badge'),
        bg: tok('--color-card'),
        navy: tok('--navy'),
        navyText: tok('--navy-on-text'),
        navyMuted: tok('--navy-on-muted'),
        gold: tok('--color-accent-gold'),
        text: tok('--color-text-main'),
        sub: tok('--color-text-sub'),
        faint: tok('--color-text-faint'),
        empty: tok('--color-icon-faint'),
        stripe: tok('--color-bg-subtle'),
        foot: tok('--color-bg'),
        win: tok('--color-win'),
        lose: tok('--color-lose'),
    };
    return entryPaletteCache;
}

// .tag-badge를 캔버스로 옮긴 것. 그린 폭을 돌려준다.
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

function entryDrawRaceBadge(ctx, letter, x, y, size) {
    const pal = entryPalette();
    const bg = pal.race[letter];
    if (!bg) return 0;
    return entryDrawBadge(ctx, letter, x, y, size, bg, pal.raceText[letter] || '#fff', size);
}

function entryDrawTierBadge(ctx, label, x, y, h) {
    return entryDrawBadge(ctx, label, x, y, h, entryPalette().tier, '#fff');
}

// align이 'right'면 x에 오른쪽 끝을 맞춘다.
function entryDrawBadgeRow(ctx, p, x, y, h, align) {
    const gap = 6;
    const raceW = entryPalette().race[p.r] ? h : 0;
    ctx.save();
    ctx.font = `800 ${Math.round(h * 0.6)}px Pretendard, sans-serif`;
    const tierW = p.t ? Math.max(h, Math.ceil(ctx.measureText(p.t).width) + h * 0.7) : 0;
    ctx.restore();
    const total = raceW + (raceW && tierW ? gap : 0) + tierW;
    let cur = align === 'right' ? x - total : x;
    if (raceW) {
        entryDrawRaceBadge(ctx, p.r, cur, y, h);
        cur += raceW + gap;
    }
    if (tierW) entryDrawTierBadge(ctx, p.t, cur, y, h);
    return total;
}

function entryInitialColor(name) {
    let h = 0;
    String(name || '?')
        .split('')
        .forEach(c => {
            h = (h * 31 + c.charCodeAt(0)) % 360;
        });
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

function entryDrawLogo(ctx, img, x, y, size) {
    const k = Math.min(size / img.width, size / img.height);
    const w = img.width * k;
    const h = img.height * k;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
}

function entryPosterRows() {
    const players = entryPlayers();
    return EntryState.matches.map(m => {
        const h2h = entryH2hRec(m.a, m.b, EntryState.period);
        const face = p =>
            p
                ? {
                      n: p.n,
                      s: p.s || '',
                      r: raceShortLabel(p.r),
                      t: tierLabel(p.t),
                  }
                : null;
        return {
            a: face(players[m.a]),
            b: face(players[m.b]),
            h2h: h2h && h2h.w + h2h.l ? [h2h.w, h2h.l] : null,
            map: entryMapName(m.map),
            // 고른 기간에 맞대결이 없을 수 있어 통산도 싣는다
            all: (() => {
                const r = entryH2hRec(m.a, m.b, 'all');
                return r && r.w + r.l ? [r.w, r.l] : null;
            })(),
        };
    });
}

async function entrySavePoster() {
    const ta = entrySideName(0);
    const tb = entrySideName(1);
    const rows = entryPosterRows();
    if (!rows.length) {
        alert('대진을 먼저 만들어 주세요');
        return;
    }
    await entryLoadH2h(EntryState.matches.flatMap(m => [m.a, m.b]));

    const W = ENTRY_POSTER_W;
    // 휴대폰에서 줄어들어도 읽히게 글자를 넉넉히 키운다
    const PAD = 64,
        HEAD = 246,
        FOOT = 86;
    const ROW = 164;
    const H = HEAD + rows.length * ROW + FOOT;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    // 캔버스는 동기로 그리므로 사진·로고를 먼저 다 받아 둔다
    await loadTeamLogos([ta, tb]);
    const [imgs, logos] = await Promise.all([
        Promise.all(rows.flatMap(r => [r.a, r.b]).map(p => entryLoadImage(p ? getProfileImgUrl(p.s || '') : null))),
        Promise.all([ta, tb].map(name => entryLoadImage(teamLogoSrc(name)))),
    ]);

    const pal = entryPalette();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = pal.navy;
    ctx.fillRect(0, 0, W, HEAD);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = pal.navyMuted;
    ctx.font = '700 22px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STARUNIV · ENTRY', PAD, 70);
    // 제목이 길면 줄여서 왼쪽 'STARUNIV · ENTRY'에 닿지 않게 한다
    const title = String(EntryState.title || '').trim();
    if (title) {
        const titleMaxW = W - 2 * (PAD + ctx.measureText('STARUNIV · ENTRY').width + 32);
        ctx.textAlign = 'center';
        ctx.fillStyle = pal.navyText;
        for (let size = 28; size >= 18; size -= 2) {
            ctx.font = `800 ${size}px Pretendard, sans-serif`;
            if (ctx.measureText(title).width <= titleMaxW) break;
        }
        ctx.fillText(title, W / 2, 72);
        ctx.textAlign = 'left';
    }
    const LOGO = 64;
    const logoGap = LOGO + 16;
    if (logos[0]) entryDrawLogo(ctx, logos[0], PAD, 96, LOGO);
    if (logos[1]) entryDrawLogo(ctx, logos[1], W - PAD - LOGO, 96, LOGO);
    ctx.fillStyle = pal.navyText;
    // 팀 이름이 길면 VS에 닿지 않게 줄인다(최소 36px)
    const fitTeamFont = (name, maxW) => {
        for (let size = 64; size >= 36; size -= 2) {
            ctx.font = `800 ${size}px Pretendard, sans-serif`;
            if (ctx.measureText(name).width <= maxW) return;
        }
    };
    const nameMaxW = W / 2 - 70 - PAD;
    fitTeamFont(ta, nameMaxW - (logos[0] ? logoGap : 0));
    ctx.fillText(ta, PAD + (logos[0] ? logoGap : 0), 152);
    ctx.textAlign = 'right';
    fitTeamFont(tb, nameMaxW - (logos[1] ? logoGap : 0));
    ctx.fillText(tb, W - PAD - (logos[1] ? logoGap : 0), 152);
    ctx.textAlign = 'center';
    ctx.fillStyle = pal.gold;
    ctx.font = '800 46px Pretendard, sans-serif';
    ctx.fillText('VS', W / 2, 146);
    ctx.fillStyle = pal.navyMuted;
    ctx.font = '700 24px Pretendard, sans-serif';
    ctx.fillText(EntryState.date, W / 2, 196);

    rows.forEach((r, i) => {
        const y = HEAD + i * ROW;
        if (i % 2 === 1) {
            ctx.fillStyle = pal.stripe;
            ctx.fillRect(0, y, W, ROW);
        }
        const cy = y + ROW / 2;
        const D = 68;
        entryDrawAvatar(ctx, imgs[i * 2], r.a && r.a.n, PAD, cy - D / 2, D);
        entryDrawAvatar(ctx, imgs[i * 2 + 1], r.b && r.b.n, W - PAD - D, cy - D / 2, D);

        const BADGE = 26;
        const nameX = PAD + D + 20;
        const nameXb = W - PAD - D - 20;

        ctx.textAlign = 'left';
        ctx.fillStyle = pal.text;
        ctx.font = '700 34px Pretendard, sans-serif';
        ctx.fillText(r.a ? r.a.n : '-', nameX, cy - 6);
        if (r.a) entryDrawBadgeRow(ctx, r.a, nameX, cy + 8, BADGE, 'left');

        ctx.textAlign = 'right';
        ctx.fillStyle = pal.text;
        ctx.font = '700 34px Pretendard, sans-serif';
        ctx.fillText(r.b ? r.b.n : '-', nameXb, cy - 6);
        if (r.b) entryDrawBadgeRow(ctx, r.b, nameXb, cy + 8, BADGE, 'right');

        // middle baseline + 대칭 좌표로 위아래 여백을 맞춘다.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const mapY = cy - 48;
        const scoreY = cy;
        const allY = cy + 48;

        if (r.map) {
            ctx.fillStyle = pal.sub;
            ctx.font = '700 18px Pretendard, sans-serif';
            ctx.fillText(String(r.map), W / 2, mapY);
        }
        if (r.h2h) {
            const [hw, hl] = r.h2h;
            ctx.font = '700 22px Pretendard, sans-serif';
            const wV = ctx.measureText('vs').width;
            const gap = 18;
            ctx.font = '800 58px Pretendard, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillStyle = pal.win;
            ctx.fillText(String(hw), W / 2 - wV / 2 - gap, scoreY);
            ctx.textAlign = 'left';
            ctx.fillStyle = pal.lose;
            ctx.fillText(String(hl), W / 2 + wV / 2 + gap, scoreY);
            ctx.textAlign = 'center';
            ctx.fillStyle = pal.faint;
            ctx.font = '700 22px Pretendard, sans-serif';
            ctx.fillText('vs', W / 2, scoreY);
        } else {
            ctx.fillStyle = pal.empty;
            ctx.font = '700 28px Pretendard, sans-serif';
            ctx.fillText('맞대결 없음', W / 2, scoreY);
        }

        if (r.all && EntryState.period !== 'all') {
            ctx.fillStyle = pal.faint;
            ctx.font = '700 19px Pretendard, sans-serif';
            ctx.fillText(`통산 ${r.all[0]} : ${r.all[1]}`, W / 2, allY);
        }

        ctx.textBaseline = 'alphabetic';
    });

    const fy = HEAD + rows.length * ROW;
    ctx.fillStyle = pal.foot;
    ctx.fillRect(0, fy, W, FOOT);
    ctx.fillStyle = pal.sub;
    ctx.font = '700 21px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${entryPeriodLabel()} 기준`, PAD, fy + 52);
    ctx.textAlign = 'right';
    ctx.fillText(`${EntryState.target}경기 ${entryWinsNeeded(EntryState.target)}선승`, W - PAD, fy + 52);

    let url;
    try {
        url = cv.toDataURL('image/png');
    } catch (e) {
        alert('포스터를 만들지 못했습니다. 프로필 사진을 불러올 수 없는 환경일 수 있습니다');
        return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `엔트리_${ta}_vs_${tb}.png`;
    a.click();
}
