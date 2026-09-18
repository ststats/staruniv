/**
 * 티어표 · 분석 탭: 선수 개개인의 승률 추세와 티어내 순위를 보여준다.
 * (core.js → page-tier.js → 이 파일. 탭을 처음 열 때만 데이터를 읽는다)
 *
 * 데이터: docs/data/elo/ - scripts/generate_elo.py가 eloboard 아카이브로 계산한 자체 레이팅.
 *   index.json        { syncedAt, shardBounds, cats, catWeights,
 *                       players:{ 선수id: {n,tm,s,r,t?,g?,en?, m,w,l,
 *                                          streak:{t,n}, lw, ll, race:{T:[w,l],Z:[w,l],P:[w,l]},
 *                                          cat:[[w,l],...], rating, tierRank} } }
 *   p/<샤드시작id>.json { 선수id: [[날짜,상대id,이김(1/0),맵id,대회idx,경기후레이팅], ...], ... }
 *   (h2h와 반대로 오래된 경기가 앞이다 - 추세 그래프가 그대로 쓸 수 있게)
 *
 * rating은 티어내 순위(tierRank)를 매길 때만 쓰고 화면에는 숫자를 보여주지 않는다 - 승률이
 * 훨씬 직관적이고, 레이팅은 명칭 티어(프로급)/숫자 티어(일반)를 나눠 계산해도 절대값끼리
 * 비교하면 여전히 헷갈리기 때문(자세한 이유는 generate_elo.py 참고). 순위는 반드시 같은
 * 티어 안에서만 비교한다 - 티어가 다르면 실제로 거의 붙지 않는 경우가 많아 순위 비교 자체가
 * 의미가 약하다.
 */

const ANALYSIS_INDEX_URL = 'data/elo/index.json';
const ANALYSIS_PERIODS = [['all', '전체'], ['365', '최근 1년'], ['90', '최근 90일']];
const ANALYSIS_TREND_WINDOW = 20;      // 승률 추세: 최근 N경기 롤링 승률
const ANALYSIS_LIST_STEP = 20;         // 티어 그룹 하나당 한 번에 보여줄 인원
const ANALYSIS_SUGGEST_STEP = 40;
const ANALYSIS_MATCH_STEP = 10;

const AnalysisState = {
    index: null,
    loading: null,
    shardData: {},          // 샤드 시작id -> 받아온 원본
    shardLoading: {},
    rows: {},                // 선수id -> 경기 로그(오래된 경기가 앞)
    period: 'all',
    query: '',
    suggestOpen: false,
    suggestShown: ANALYSIS_SUGGEST_STEP,
    picked: null,             // 선수id (null이면 리더보드 화면)
    listShown: {},            // 티어 -> 지금까지 그린 인원수
    matchShown: ANALYSIS_MATCH_STEP,
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function analysisLoadIndex() {
    if (AnalysisState.index) return AnalysisState.index;
    if (!AnalysisState.loading) {
        AnalysisState.loading = fetch(ANALYSIS_INDEX_URL, { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => { AnalysisState.index = data; return data; })
            .finally(() => { AnalysisState.loading = null; });
    }
    return AnalysisState.loading;
}

// h2h(page-h2h.js)와 똑같은 방식 - 선수id보다 작거나 같은 것 중 가장 큰 경계가 그 샤드다.
function analysisShardOf(pid) {
    const bounds = (AnalysisState.index && AnalysisState.index.shardBounds) || [];
    const n = Number(pid);
    let found = bounds.length ? bounds[0] : pid;
    for (const b of bounds) {
        if (b > n) break;
        found = b;
    }
    return found;
}

async function analysisLoadShard(shard) {
    if (AnalysisState.shardData[shard]) return AnalysisState.shardData[shard];
    if (!AnalysisState.shardLoading[shard]) {
        AnalysisState.shardLoading[shard] = fetch(`data/elo/p/${encodeURIComponent(shard)}.json`, { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => { AnalysisState.shardData[shard] = data; return data; })
            .finally(() => { delete AnalysisState.shardLoading[shard]; });
    }
    return AnalysisState.shardLoading[shard];
}

async function analysisLoadPlayer(pid) {
    if (!pid) return [];
    if (AnalysisState.rows[pid]) return AnalysisState.rows[pid];
    let data;
    try {
        data = await analysisLoadShard(analysisShardOf(pid));
    } catch (e) {
        throw new Error(`선수 기록을 불러오지 못했습니다 (${e.message})`);
    }
    AnalysisState.rows[pid] = Array.isArray(data[pid]) ? data[pid] : [];
    return AnalysisState.rows[pid];
}

function analysisPlayer(pid) {
    return (AnalysisState.index && AnalysisState.index.players[pid]) || null;
}

function analysisAllPlayers() {
    if (!AnalysisState.index) return [];
    return Object.entries(AnalysisState.index.players).map(([pid, p]) => ({ pid, ...p }));
}

// 기간 자르는 날짜(YYYY-MM-DD). h2h와 동일하게 문자열 비교로 충분하다.
function analysisSince() {
    if (AnalysisState.period === 'all') return '';
    const d = new Date(Date.now() - Number(AnalysisState.period) * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function analysisRowsInPeriod(pid) {
    const since = analysisSince();
    const rows = AnalysisState.rows[pid] || [];
    return since ? rows.filter(r => String(r[0]) >= since) : rows;
}

// ---------------------------------------------------------------------------
// 리더보드 (티어별로 묶어서 보여준다)
// ---------------------------------------------------------------------------
function analysisGrouped() {
    const groups = new Map();
    analysisAllPlayers().forEach(p => {
        // 티어표 탭의 tierGroupKey()와 같은 기준 - '체크'(아직 티어 안 매김)도 미분류로 묶는다.
        const raw = (p.t !== undefined && p.t !== null) ? String(p.t).trim() : '';
        const key = (!raw || TIER_UNRANKED.has(raw)) ? '미분류' : raw;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    const tiers = Array.from(groups.keys()).sort((a, b) => tierIndex(a) - tierIndex(b));
    return tiers.map(t => ({
        tier: t,
        players: groups.get(t).sort((a, b) => (a.tierRank || 999) - (b.tierRank || 999)),
    }));
}

function analysisLeaderboardRowHtml(p) {
    const pct = p.w + p.l ? Math.round(p.w / (p.w + p.l) * 100) : 0;
    return `
        <tr class="stat-row analysis-row" onclick="analysisPick('${jsAttr(p.pid)}')">
            <td class="text-center">${p.tierRank || '-'}</td>
            <td class="stat-table-sticky-col cell-ellipsis"><span class="cell-clip">${escapeHTML(p.n)}</span></td>
            <td class="badge-cell">${p.r ? raceBadgeHtml(p.r) : ''}</td>
            <td class="cell-ellipsis cell-muted"><span class="cell-clip">${escapeHTML(p.tm || '')}</span></td>
            <td class="text-center">${(p.m || 0).toLocaleString('ko-KR')}전</td>
            <td class="text-center">${pct}%</td>
        </tr>`;
}

function analysisGroupHtml(g) {
    const shown = AnalysisState.listShown[g.tier] || ANALYSIS_LIST_STEP;
    const list = g.players.slice(0, shown);
    return `
        <div class="section-title section-title-spaced">
            <span class="section-title-label">${escapeHTML(tierDisplayName(g.tier))}</span>
            <span class="title-count">${g.players.length.toLocaleString('ko-KR')}명</span>
        </div>
        <div class="clean-card p-0 overflow-hidden">
            <div class="table-responsive scroll-area">
                <table class="table table-borderless table-hover mb-0 text-center stat-table table-fixed minw-520">
                    <thead><tr>
                        <th scope="col" class="colw-15">순위</th>
                        <th scope="col" class="stat-table-sticky-col colw-25">이름</th>
                        <th scope="col" class="colw-15">종족</th>
                        <th scope="col" class="colw-20">소속</th>
                        <th scope="col" class="colw-15">전적</th>
                        <th scope="col" class="colw-15">승률</th>
                    </tr></thead>
                    <tbody>${list.map(analysisLeaderboardRowHtml).join('')}</tbody>
                </table>
            </div>
        </div>
        ${g.players.length > shown ? `
        <div class="news-load-more-wrap">
            <button type="button" class="news-load-more" onclick="analysisShowMoreGroup('${jsAttr(g.tier)}')">
                ${escapeHTML(tierDisplayName(g.tier))} 더 보기 (${g.players.length - shown}명 남음)
            </button>
        </div>` : ''}`;
}

function analysisLeaderboardHtml() {
    const groups = analysisGrouped();
    if (!groups.length) return '<div class="tier-empty">순위표를 아직 모으는 중입니다.</div>';
    return groups.map(analysisGroupHtml).join('');
}

function analysisShowMoreGroup(tier) {
    AnalysisState.listShown[tier] = (AnalysisState.listShown[tier] || ANALYSIS_LIST_STEP) + ANALYSIS_LIST_STEP;
    renderAnalysisBody();
}

// ---------------------------------------------------------------------------
// 검색
// ---------------------------------------------------------------------------
function analysisSuggest(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return analysisAllPlayers()
        .filter(p => {
            const names = [p.n, p.en].filter(Boolean).map(x => String(x).toLowerCase());
            if (names.some(n => n.includes(q))) return true;
            return String(p.tm || '').toLowerCase().includes(q);
        })
        .sort((a, b) => tierIndex(a.t) - tierIndex(b.t) || (a.tierRank || 999) - (b.tierRank || 999));
}

function analysisSuggestItemsHtml(list) {
    return list.map(p => `
        <button type="button" class="h2h-suggest-item" onclick="analysisPick('${jsAttr(p.pid)}')">
            ${avatarHtml(p.s || '', 'h2h-suggest-avatar')}
            <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
            ${p.en ? `<span class="h2h-suggest-alt">${escapeHTML(p.en)}</span>` : ''}
            ${p.r ? raceBadgeHtml(p.r) : ''}
            <span class="h2h-suggest-team">${escapeHTML([p.t !== undefined && p.t !== '' ? tierLabel(p.t) : '', p.tm || ''].filter(Boolean).join(' · '))}</span>
            <span class="h2h-suggest-count">${(p.m || 0).toLocaleString('ko-KR')}판</span>
        </button>`).join('');
}

function analysisSuggestHtml() {
    if (!AnalysisState.query.trim()) return '';
    const list = analysisSuggest(AnalysisState.query);
    if (!list.length) return '<div class="h2h-suggest"><div class="h2h-suggest-empty">찾는 선수가 없습니다.</div></div>';
    const shown = Math.min(list.length, AnalysisState.suggestShown);
    return `<div class="h2h-suggest" onscroll="analysisSuggestScroll(this)">
        <div class="h2h-suggest-head">검색 결과 ${list.length.toLocaleString('ko-KR')}명</div>
        ${analysisSuggestItemsHtml(list.slice(0, shown))}
    </div>`;
}

function analysisSuggestScroll(el) {
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
    const list = analysisSuggest(AnalysisState.query);
    const from = AnalysisState.suggestShown;
    if (from >= list.length) return;
    AnalysisState.suggestShown = Math.min(list.length, from + ANALYSIS_SUGGEST_STEP);
    el.insertAdjacentHTML('beforeend', analysisSuggestItemsHtml(list.slice(from, AnalysisState.suggestShown)));
}

function analysisOnQuery(value) {
    AnalysisState.query = value;
    AnalysisState.suggestOpen = true;
    AnalysisState.suggestShown = ANALYSIS_SUGGEST_STEP;
    const box = document.getElementById('analysis-search');
    if (!box) return;
    const old = box.querySelector('.h2h-suggest');
    if (old) old.remove();
    box.insertAdjacentHTML('beforeend', analysisSuggestHtml());
}

document.addEventListener('click', e => {
    if (!AnalysisState.suggestOpen) return;
    if (e.target.closest && e.target.closest('#analysis-search')) return;
    AnalysisState.suggestOpen = false;
    const box = document.getElementById('analysis-search');
    const old = box && box.querySelector('.h2h-suggest');
    if (old) old.remove();
});

// ---------------------------------------------------------------------------
// 선수 카드
// ---------------------------------------------------------------------------
function analysisTierSize(t) {
    if (t === undefined || t === null || t === '') return 0;
    return analysisAllPlayers().filter(p => String(p.t) === String(t)).length;
}

function analysisCardHeaderHtml(p) {
    const pct = p.w + p.l ? Math.round(p.w / (p.w + p.l) * 100) : 0;
    const tierSize = analysisTierSize(p.t);
    return `
        <div class="h2h-card">
            <div class="h2h-card-avatar">${avatarHtml(p.s || '', 'h2h-card-avatar-img')}</div>
            <div class="h2h-card-body">
                <div class="h2h-card-nameline">
                    <span class="h2h-card-name">${escapeHTML(p.n)}</span>
                    ${p.r ? raceBadgeHtml(p.r) : ''}
                </div>
                <div class="h2h-card-sub">${escapeHTML([p.t !== undefined && p.t !== '' ? tierLabel(p.t) : '', p.tm || ''].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
                <div class="h2h-card-rec">
                    <strong>${(p.m || 0).toLocaleString('ko-KR')}전</strong>
                    <span class="h2h-win">${p.w}승</span>
                    <span class="h2h-lose">${p.l}패</span>
                    <span class="h2h-card-rate">${pct}%</span>
                </div>
            </div>
            <button type="button" class="h2h-card-clear" aria-label="목록으로" onclick="analysisBack()">✕</button>
        </div>
        <div class="analysis-summary-row">
            <span class="analysis-summary-item">
                <strong>${p.tierRank || '-'}위</strong>
                <span class="cell-muted"> / ${tierSize ? tierSize.toLocaleString('ko-KR') : '-'}명 중 (${p.t !== undefined && p.t !== '' ? escapeHTML(tierLabel(p.t)) : '미분류'} 내 순위)</span>
            </span>
            <span class="analysis-summary-item">
                최근 폼 ${p.streak && p.streak.n ? `<span class="tag-badge${p.streak.t === 'W' ? '' : ' race-badge race-Z'}">${escapeHTML(p.streak.t)}${p.streak.n}</span>` : '-'}
            </span>
            <span class="analysis-summary-item cell-muted">최장연승 ${p.lw || 0} · 최장연패 ${p.ll || 0}</span>
        </div>`;
}

// 최근 N(ANALYSIS_TREND_WINDOW)경기 롤링 승률을 경기 순번 기준 x축으로 그린다.
// 날짜 기준이 아니라 경기 순번 기준인 이유: 활동이 뜸했던 구간이 그래프에서 넓게
// 비어 보이는 대신, 다시 활동을 재개한 구간이 촘촘하게 나와야 최근 폼이 잘 드러난다.
function analysisTrendSvg(rows) {
    if (rows.length < 2) {
        return '<div class="h2h-empty">추세를 그리기엔 이 기간 경기 수가 부족합니다.</div>';
    }
    const win = Math.min(ANALYSIS_TREND_WINDOW, rows.length);
    const pts = [];
    let sum = 0;
    const queue = [];
    rows.forEach(r => {
        queue.push(r[2]);
        sum += r[2];
        if (queue.length > win) sum -= queue.shift();
        pts.push(sum / queue.length);
    });
    const W = 640, H = 160, PAD = 10;
    const stepX = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
    const toY = v => (H - PAD) - v * (H - PAD * 2);
    const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(PAD + i * stepX).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
    const midY = toY(0.5).toFixed(1);
    const lastPct = Math.round(pts[pts.length - 1] * 100);
    return `
        <svg viewBox="0 0 ${W} ${H}" class="analysis-trend-svg" role="img"
             aria-label="최근 ${win}경기 기준 롤링 승률 추세, 지금은 ${lastPct}%">
            <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}" class="analysis-trend-mid" />
            <path d="${path}" class="analysis-trend-line" fill="none" />
        </svg>
        <div class="analysis-trend-caption">최근 ${win}경기 기준 롤링 승률 · 지금 ${lastPct}%</div>`;
}

function analysisRaceHtml(race) {
    if (!race) return '';
    const RACE_LABELS = [['T', '테란전'], ['Z', '저그전'], ['P', '프로토스전']];
    const rows = RACE_LABELS.map(([code, label]) => {
        const [w, l] = race[code] || [0, 0];
        const total = w + l;
        const pct = total ? Math.round(w / total * 100) : 0;
        return `
            <div class="h2h-map">
                <span class="h2h-map-name">${label}</span>
                <span class="h2h-map-rec"><span class="h2h-win">${w}</span> · <span class="h2h-lose">${l}</span></span>
                <span class="h2h-map-bar"><span style="width:${pct}%"></span></span>
            </div>`;
    }).join('');
    return `<div class="h2h-maps">${rows}</div>`;
}

function analysisCatHtml(cat) {
    const idx = AnalysisState.index;
    if (!cat || !idx || !idx.cats) return '';
    const rows = idx.cats.map((label, i) => {
        const [w, l] = cat[i] || [0, 0];
        const total = w + l;
        if (!total) return '';
        const pct = Math.round(w / total * 100);
        const weight = idx.catWeights ? idx.catWeights[label] : null;
        return `
            <div class="h2h-map">
                <span class="h2h-map-name">${escapeHTML(label)}${weight ? ` <span class="cell-muted">×${weight}</span>` : ''}</span>
                <span class="h2h-map-rec"><span class="h2h-win">${w}</span> · <span class="h2h-lose">${l}</span> · ${pct}%</span>
                <span class="h2h-map-bar"><span style="width:${pct}%"></span></span>
            </div>`;
    }).join('');
    return `<div class="h2h-maps">${rows}</div>`;
}

function analysisMatchRowsHtml(rows) {
    return rows.map(([date, opp, win, mapId, catIdx]) => {
        const oppInfo = analysisPlayer(opp);
        const oppName = oppInfo ? oppInfo.n : (AnalysisState.index.others && AnalysisState.index.others[opp]) || '알 수 없음';
        const catLabel = (AnalysisState.index.cats && AnalysisState.index.cats[catIdx]) || '-';
        const mapLabel = (AnalysisState.index.maps && AnalysisState.index.maps[String(mapId)]) || '-';
        return `
            <tr class="stat-row">
                <td class="stat-table-sticky-col cell-ellipsis"><span class="cell-clip">${escapeHTML(oppName)}</span></td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(catLabel)}</span></td>
                <td class="cell-ellipsis cell-muted"><span class="cell-clip">${escapeHTML(mapLabel)}</span></td>
                <td class="badge-cell">${resultBadgeHtml(win ? '승' : '패')}</td>
                <td>${escapeHTML(shortMatchDate(date))}</td>
            </tr>`;
    }).join('');
}

function analysisMatchTableHtml(rows) {
    // 최근 경기가 위로 오게 보여준다(로그 자체는 오래된 게 앞이라 뒤집는다).
    const recent = [...rows].reverse();
    const shown = recent.slice(0, AnalysisState.matchShown);
    return `
        <div class="clean-card p-0 overflow-hidden">
            <div class="table-responsive scroll-area">
                <table class="table table-borderless table-hover mb-0 text-center stat-table table-fixed minw-520">
                    <thead><tr>
                        <th scope="col" class="stat-table-sticky-col colw-25">상대</th>
                        <th scope="col" class="colw-20">형식</th>
                        <th scope="col" class="colw-25">맵</th>
                        <th scope="col" class="colw-15">결과</th>
                        <th scope="col" class="colw-15">날짜</th>
                    </tr></thead>
                    <tbody>${shown.length ? analysisMatchRowsHtml(shown) : emptyRowHtml(5, '경기 기록이 없습니다.')}</tbody>
                </table>
            </div>
        </div>
        ${recent.length > shown.length ? `
        <div class="news-load-more-wrap">
            <button type="button" class="news-load-more" onclick="analysisShowMoreMatches()">경기 더 보기 (${(recent.length - shown.length).toLocaleString('ko-KR')}경기 남음)</button>
        </div>` : ''}`;
}

function analysisShowMoreMatches() {
    AnalysisState.matchShown += ANALYSIS_MATCH_STEP;
    renderAnalysisBody();
}

function analysisCardHtml(pid) {
    const p = analysisPlayer(pid);
    if (!p) return '<div class="h2h-empty">선수 정보를 찾을 수 없습니다.</div>';
    const rows = analysisRowsInPeriod(pid);
    return `
        ${analysisCardHeaderHtml({ ...p, pid })}
        <div class="section-title section-title-spaced" data-en="WIN RATE TREND"><span class="section-title-label">승률 추세</span></div>
        ${analysisTrendSvg(rows)}
        <div class="section-title section-title-spaced" data-en="BY RACE"><span class="section-title-label">종족전</span></div>
        ${analysisRaceHtml(p.race)}
        <div class="section-title section-title-spaced" data-en="BY FORMAT"><span class="section-title-label">형식별 성적</span></div>
        ${analysisCatHtml(p.cat)}
        <div class="section-title section-title-spaced" data-en="MATCHES"><span class="section-title-label">최근 경기</span>
            <span class="title-count">${rows.length.toLocaleString('ko-KR')}경기</span></div>
        ${analysisMatchTableHtml(rows)}`;
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------
function renderAnalysisPeriod() {
    const bar = document.getElementById('analysis-period');
    if (!bar) return;
    bar.hidden = !AnalysisState.picked;
    if (!AnalysisState.picked) return;
    bar.innerHTML = ANALYSIS_PERIODS.map(([key, label]) => `
        <button type="button" class="filter-item${AnalysisState.period === key ? ' active' : ''}"
                aria-pressed="${AnalysisState.period === key}" onclick="analysisSetPeriod('${key}')">${label}</button>`).join('');
}

function analysisSetPeriod(period) {
    AnalysisState.period = period;
    AnalysisState.matchShown = ANALYSIS_MATCH_STEP;
    renderAnalysisPeriod();
    renderAnalysisBody();
}

async function renderAnalysisBody() {
    const box = document.getElementById('analysis-body');
    if (!box) return;
    if (!AnalysisState.picked) {
        box.innerHTML = analysisLeaderboardHtml();
        return;
    }
    box.innerHTML = analysisCardHtml(AnalysisState.picked);
}

async function analysisPick(pid) {
    AnalysisState.picked = pid;
    AnalysisState.period = 'all';
    AnalysisState.matchShown = ANALYSIS_MATCH_STEP;
    AnalysisState.query = '';
    AnalysisState.suggestOpen = false;
    const search = document.getElementById('analysis-search-input');
    if (search) search.value = '';
    renderAnalysisPeriod();
    document.getElementById('analysis-body').innerHTML = '<div class="h2h-empty">불러오는 중...</div>';
    try {
        await analysisLoadPlayer(pid);
    } catch (e) {
        console.error(e);
        document.getElementById('analysis-body').innerHTML = `<div class="h2h-empty">${escapeHTML(e.message)}</div>`;
        return;
    }
    renderAnalysisPeriod();
    renderAnalysisBody();
    analysisSyncUrl();
}

function analysisBack() {
    AnalysisState.picked = null;
    renderAnalysisPeriod();
    renderAnalysisBody();
    analysisSyncUrl();
}

function analysisSyncUrl() {
    PageState.update({ view: 'analysis', p: AnalysisState.picked || '' });
}

// ---------------------------------------------------------------------------
// 탭 진입
// ---------------------------------------------------------------------------
let analysisStarted = false;

async function analysisEnter() {
    if (analysisStarted) { analysisSyncUrl(); return; }
    analysisStarted = true;
    renderAnalysisPeriod();
    try {
        await analysisLoadIndex();
    } catch (e) {
        console.error('분석 데이터를 불러오지 못했습니다:', e);
        document.getElementById('analysis-body').innerHTML =
            '<div class="h2h-empty">분석 데이터를 아직 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
        return;
    }
    if (!Object.keys(AnalysisState.index.players || {}).length) {
        document.getElementById('analysis-body').innerHTML =
            '<div class="h2h-empty">레이팅을 아직 모으는 중입니다. 조금 뒤에 다시 열어주세요.</div>';
        return;
    }
    const updated = document.getElementById('analysis-updated');
    if (updated && AnalysisState.index.syncedAt) {
        updated.textContent = `${String(AnalysisState.index.syncedAt).slice(0, 10).replace(/-/g, '.')} 기준`;
    }

    const params = new URLSearchParams(location.search);
    const wanted = params.get('p');
    if (wanted && analysisPlayer(wanted)) {
        await analysisPick(wanted);
        return;
    }
    renderAnalysisBody();
}
