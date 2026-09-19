const ANALYSIS_PAGE_SIZE = 10;         // 최근 전적 한 페이지에 보여줄 경기 수
const ANALYSIS_SUGGEST_STEP = 40;
const ANALYSIS_FORM_COUNT = 10;        // '최근 10경기'
const ANALYSIS_CHART_MONTHS = 18;      // 월별 그래프에 보여줄 최근 개월 수
const ANALYSIS_RATE_MIN = 5;           // 월별 승률 선을 그릴 최소 표본(이 미만인 달은 선을 끊는다)
const ANALYSIS_MAP_STEP = 8;           // '맵별 전적' 한 번에 보여줄 개수(4열 x 2줄)
const ANALYSIS_RIVAL_STEP = 8;         // '동티어 전적' 한 번에 보여줄 상대 수
const ANALYSIS_CAT_PER_PAGE = 3;       // '형식별 전적' 한 화면에 보여줄 도넛 수


const AnalysisState = {
    rows: {},              // 선수id -> 경기 로그(최신순)
    period: 'all',
    picked: null,          // 선수id (null이면 검색 안내 화면)
    query: '',
    suggestOpen: false,
    suggestShown: ANALYSIS_SUGGEST_STEP,
    matchPage: 1,           // 최근 전적 페이지(10경기씩)
    matchFilter: '전체',    // 최근 전적 형식 필터(H2H_CAT_GROUPS의 이름 또는 '전체')
    catPage: 0,             // 형식별 전적에서 보고 있는 묶음(0: 개인·대회·대학, 1: 미니·리그·스폰)
    mapShown: ANALYSIS_MAP_STEP,
    rivalShown: ANALYSIS_RIVAL_STEP,
    rating: null,           // 레이팅 변화 데이터(한 번만 받는다)
    ratingLoading: null,
};

// 선수를 바꾸거나 기간을 바꾸면 '더 보기'로 펼쳐둔 것들과 페이지를 처음으로 되돌린다.
function analysisResetLists() {
    AnalysisState.matchPage = 1;
    AnalysisState.mapShown = ANALYSIS_MAP_STEP;
    AnalysisState.rivalShown = ANALYSIS_RIVAL_STEP;
}

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function analysisLoadData() { return h2hLoadIndex(); }

// 레이팅 변화(월별 스냅샷)는 scripts/build_ranking.py가 따로 구워둔 파일이다.
// 분석 탭에서만 쓰므로 여기서 한 번만 받는다 - 티어표나 상대전적만 보는 사람은 안 받는다.
const ANALYSIS_RATING_URL = 'data/h2h/rating.json';

async function analysisLoadRating() {
    if (AnalysisState.rating) return AnalysisState.rating;
    if (!AnalysisState.ratingLoading) {
        AnalysisState.ratingLoading = fetch(ANALYSIS_RATING_URL, { cache: 'no-cache' })
            .then(res => (res.ok ? res.json() : null))
            .catch(() => null)                 // 없으면 그래프만 빠지고 나머지는 그대로 나온다
            .then(data => { AnalysisState.rating = data || { months: [], players: {} }; return AnalysisState.rating; });
    }
    return AnalysisState.ratingLoading;
}

// 경기 로그는 상대전적 탭의 샤드를 그대로 쓴다.
async function analysisLoadPlayer(pid) {
    if (!pid) return [];
    if (AnalysisState.rows[pid]) return AnalysisState.rows[pid];
    const rows = await h2hLoadPlayer(pid);
    AnalysisState.rows[pid] = rows;
    return rows;
}

function analysisRows(pid) {
    const rows = AnalysisState.rows[pid] || [];
    if (AnalysisState.period === 'all') return rows;
    const d = new Date(Date.now() - Number(AnalysisState.period) * 86400000);
    const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return rows.filter(r => String(r[0]) >= since);
}
function analysisSummary(rows) {
    const e = {m: rows.length, w: 0, l: 0, cat: {}, race: {}};
    rows.forEach(r => {
        const i = r[2] ? 0 : 1;
        e[r[2] ? 'w' : 'l']++;
        (e.cat[r[4]] ||= [0, 0])[i]++;
        const race = (h2hPlayer(String(r[1])) || {}).r || (H2hState.index.otherRaces || {})[r[1]];
        if (race) (e.race[race] ||= [0, 0])[i]++;
    });
    if (rows.length) {
        const win = rows[0][2];
        let n = 0;
        while (n < rows.length && rows[n][2] === win) n++;
        e.st = {t: win ? 'W' : 'L', n};
    }
    return e;
}
function analysisSetPeriod(period) {
    AnalysisState.period = period;
    analysisResetLists();
    renderAnalysisBody();
}
function analysisPeriodHtml() {
    return `<div class="h2h-topbar"><div class="filter-nav h2h-period tab-scroll" role="group" aria-label="기간 선택">${H2H_PERIODS.map(([key, label]) => `<button type="button" class="filter-item${AnalysisState.period === key ? ' active' : ''}" aria-pressed="${AnalysisState.period === key}" onclick="analysisSetPeriod('${key}')">${label}</button>`).join('')}</div></div>`;
}

// 이름·티어·소속·종족은 상대전적 index(h2h)에서 가져온다.
function analysisInfo(pid) {
    return h2hPlayer(pid);
}

function analysisAllPlayers() {
    const idx = H2hState.index;
    if (!idx) return [];
    return Object.entries(idx.players).map(([pid, p]) => ({ pid, ...p }));
}

function analysisRate(w, l) {
    const total = w + l;
    return total ? Math.round((w / total) * 1000) / 10 : null;
}

function analysisRateColor(rate) {
    return rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)';
}

function analysisWlText(w, l) {
    return (w + l) ? `${w.toLocaleString('ko-KR')}승 ${l.toLocaleString('ko-KR')}패` : '-';
}

// 전적 페이지와 같은 도넛(conic-gradient). page-records.js의 donutBackground와 같은 규칙이다.
// ringColor를 주면 그 색으로(종족전은 종족색), 안 주면 50% 기준 승/패 색으로 칠한다.
function analysisDonutHtml(label, w, l, opts) {
    const o = opts || {};
    const rate = analysisRate(w, l);
    const pct = rate === null ? 0 : rate;
    const color = rate === null ? 'var(--color-donut-track)' : (o.ringColor || analysisRateColor(rate));
    return `
        <div class="donut-box">
            <div class="donut" style="background:conic-gradient(${color} ${pct}%, var(--color-donut-track) 0)">
                <span class="donut-text" style="${rate === null ? '' : `color:${color}`}">${rate === null ? '-' : `${rate}%`}</span>
            </div>
            <div class="donut-label${o.labelClass ? ` ${o.labelClass}` : ''}">${escapeHTML(label)}</div>
            <div class="donut-sub">${analysisWlText(w, l)}</div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 검색 (상대전적 탭과 같은 입력 · 추천 목록 부품을 쓴다)
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
        .sort((a, b) => tierIndex(a.t) - tierIndex(b.t) || (b.m || 0) - (a.m || 0));
}

function analysisSuggestItemsHtml(list) {
    return list.map(p => {
        return `
        <button type="button" class="h2h-suggest-item" onclick="analysisPick('${jsAttr(p.pid)}')">
            ${avatarHtml(p.s || '', 'h2h-suggest-avatar')}
            <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
            ${p.en ? `<span class="h2h-suggest-alt">${escapeHTML(p.en)}</span>` : ''}
            ${p.r ? raceBadgeHtml(p.r) : ''}
            ${playerBadgesHtml({...p, r: ""})}
            <span class="h2h-suggest-count">${(p.m || 0).toLocaleString("ko-KR")}판</span>
        </button>`;
    }).join('');
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
// 머리 카드 (전적 페이지의 .profile-head와 같은 틀)
// ---------------------------------------------------------------------------
function analysisHeadHtml(pid, p, e) {
    return playerSummaryHtml(p, {total: e.m, win: e.w, lose: e.l},
        '<button type="button" class="h2h-card-clear" aria-label="선수 선택 지우기" onclick="analysisBack()">✕</button>',
        h2hRankInfo(p));
}

// ---------------------------------------------------------------------------
// 형식별 전적 · 종족전 전적 (도넛)
// ---------------------------------------------------------------------------
function analysisCatTotals(e) {
    const cats = (H2hState.index && H2hState.index.cats) || [];
    const totals = new Map();
    H2H_CAT_GROUPS.forEach(([label]) => totals.set(label, [0, 0]));
    cats.forEach((name, i) => {
        const pair = (e.cat && e.cat[i]) || [0, 0];
        const group = H2H_CAT_GROUPS.find(([, , members]) => members.includes(name));
        if (!group) return;
        const acc = totals.get(group[0]);
        acc[0] += pair[0];
        acc[1] += pair[1];
    });
    return totals;
}

function analysisCatPages() {
    return Math.max(1, Math.ceil(H2H_CAT_GROUPS.length / ANALYSIS_CAT_PER_PAGE));
}

function analysisSetCatPage(page) {
    const pages = analysisCatPages();
    AnalysisState.catPage = ((page % pages) + pages) % pages;   // 끝에서 누르면 처음으로 돈다
    renderAnalysisBody();
}

// 형식은 6가지인데 한 줄에 6개를 늘어놓으면 도넛이 너무 작아진다.
// 3개씩 한 화면에 보여주고 오른쪽 화살표로 나머지(미니대전 · CK · 리그 · 스폰)를 넘겨 본다.
function analysisCatHtml(e) {
    const totals = analysisCatTotals(e);
    const pages = analysisCatPages();
    const from = AnalysisState.catPage * ANALYSIS_CAT_PER_PAGE;
    const boxes = H2H_CAT_GROUPS.slice(from, from + ANALYSIS_CAT_PER_PAGE).map(([label]) => {
        const [w, l] = totals.get(label) || [0, 0];
        return analysisDonutHtml(label, w, l);
    }).join('');
    return `
        <div class="section-title has-shelf-nav" data-en="BY FORMAT">
            <span class="section-title-label">형식별 전적</span>
            <span class="shelf-nav is-always">
                <button type="button" class="shelf-nav-btn" aria-label="이전 형식" onclick="analysisSetCatPage(${AnalysisState.catPage - 1})">&lsaquo;</button>
                <button type="button" class="shelf-nav-btn" aria-label="다음 형식" onclick="analysisSetCatPage(${AnalysisState.catPage + 1})">&rsaquo;</button>
            </span>
            <span class="title-count">${AnalysisState.catPage + 1} / ${pages}</span>
        </div>
        <div class="clean-card analysis-panel p-3">
            <div class="donut-wrap analysis-donut-wrap">${boxes}</div>
        </div>`;
}

// 종족전 도넛은 승/패 색이 아니라 종족색으로 칠한다(전적 페이지와 같은 규칙).
function analysisRaceHtml(e) {
    const race = e.race || {};
    const boxes = [
        ['T', 'vs T', 'donut-label-t', 'var(--color-race-t)'],
        ['Z', 'vs Z', 'donut-label-z', 'var(--color-race-z)'],
        ['P', 'vs P', 'donut-label-p', 'var(--color-race-p)'],
    ].map(([code, label, cls, color]) => {
        const [w, l] = race[code] || [0, 0];
        return analysisDonutHtml(label, w, l, { labelClass: cls, ringColor: color });
    }).join('');
    return `
        <div class="section-title" data-en="BY MATCHUP">
            <span class="section-title-label">종족전 전적</span>
        </div>
        <div class="clean-card analysis-panel p-3">
            <div class="donut-wrap analysis-donut-wrap">${boxes}</div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 최근 10경기 (폼)
// ---------------------------------------------------------------------------
// 최근 10경기: 한 줄짜리 W/L 배지 띠. 표 하나를 더 두는 것보다 이 쪽이 한눈에 들어온다.
// 배지는 사이트 공용 .match-badge(노치 사각형)를 그대로 쓴다.
// 오른쪽에 요약 글(몇승 몇패 · 연승)을 붙이면 휴대폰에서 줄이 두 줄로 접혀서 뺐다.
function analysisFormHtml(rows) {
    if (!rows.length) return '';
    const recent = rows.slice(0, ANALYSIS_FORM_COUNT).reverse();   // 로그가 최신순이다
    return `
        <div class="analysis-formline">
            <span class="analysis-formline-label">최근 ${recent.length}경기</span>
            <span class="analysis-formline-badges">
                ${recent.map(([date, opp, win]) => `
                    <span class="match-badge ${win ? 'badge-win' : 'badge-lose'}"
                          title="${escapeHTML(shortMatchDate(date))} vs ${escapeHTML(h2hName(String(opp)))}">${win ? 'W' : 'L'}</span>`).join('')}
            </span>
        </div>`;
}

// ---------------------------------------------------------------------------
// 월별 전적
// ---------------------------------------------------------------------------
function analysisMonthlyHtml(rows) {
    if (rows.length < 2) return '';
    const byMonth = new Map();
    rows.forEach(r => {
        const key = String(r[0]).slice(0, 7);
        if (!byMonth.has(key)) byMonth.set(key, [0, 0]);
        byMonth.get(key)[r[2] ? 0 : 1] += 1;
    });
    const keys = [...byMonth.keys()].sort();
    // 사이에 낀 빈 달도 자리를 남긴다 - 쉬었던 구간이 그래프에서 그대로 보이게.
    const months = [];
    const [sy, sm] = keys[0].split('-').map(Number);
    const [ey, em] = keys[keys.length - 1].split('-').map(Number);
    for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? (y++, m = 1) : m++) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    const data = months.slice(-ANALYSIS_CHART_MONTHS).map(key => {
        const [w, l] = byMonth.get(key) || [0, 0];
        return { key, w, l, total: w + l };
    });
    if (!data.length) return '';

    // 왼쪽에 경기 수, 오른쪽에 승률(%) 축을 따로 둔다. 예전엔 눈금이 하나도 없어서
    // 막대 높이도 승률 선 높이도 눈대중으로만 읽어야 했다.
    const W = 660, H = 220, PAD_T = 12, PAD_B = 26, PAD_L = 30, PAD_R = 34;
    const plotH = H - PAD_T - PAD_B;
    const plotW = W - PAD_L - PAD_R;
    const maxTotal = Math.max(...data.map(d => d.total), 1);
    const slot = plotW / data.length;
    const barW = Math.min(26, Math.max(5, slot * 0.56));
    const yOf = ratio => PAD_T + plotH - ratio * plotH;

    // 가로 눈금 다섯 줄(0 · 25 · 50 · 75 · 100%). 왼쪽 숫자는 경기 수, 오른쪽은 승률.
    const grid = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const y = yOf(ratio);
        return `<line class="analysis-chart-grid${ratio === 0.5 ? ' is-mid' : ''}" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"></line>`
             + `<text class="analysis-chart-axis" x="${PAD_L - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${Math.round(maxTotal * ratio)}</text>`
             + `<text class="analysis-chart-axis" x="${W - PAD_R + 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="start">${Math.round(ratio * 100)}%</text>`;
    }).join('');

    const bars = data.map((d, i) => {
        if (!d.total) return '';
        const x = PAD_L + slot * i + (slot - barW) / 2;
        const h = (d.total / maxTotal) * plotH;
        const y = PAD_T + (plotH - h);
        const winH = (d.w / d.total) * h;
        const tip = `<title>${d.key} · ${d.total}전 ${d.w}승 ${d.l}패 (${Math.round((d.w / d.total) * 100)}%)</title>`;
        return `<g class="analysis-bar">`
             + `<rect class="analysis-bar-win" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${winH.toFixed(1)}">${tip}</rect>`
             + `<rect class="analysis-bar-lose" x="${x.toFixed(1)}" y="${(y + winH).toFixed(1)}" width="${barW.toFixed(1)}" height="${(h - winH).toFixed(1)}">${tip}</rect>`
             + `</g>`;
    }).join('');

    // 표본이 적은 달(ANALYSIS_RATE_MIN 미만)은 승률 선을 끊는다 - 1~2경기짜리 달이 0%/100%로
    // 튀면서 추세를 못 읽게 만들기 때문. 점을 같이 찍어 어느 달이 이어진 건지 보이게 한다.
    let path = '';
    let open = false;
    const dots = [];
    data.forEach((d, i) => {
        if (d.total < ANALYSIS_RATE_MIN) { open = false; return; }
        const x = PAD_L + slot * i + slot / 2;
        const y = yOf(d.w / d.total);
        path += `${open ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `;
        open = true;
        dots.push(`<circle class="analysis-rate-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"><title>${d.key} 승률 ${Math.round((d.w / d.total) * 100)}%</title></circle>`);
    });

    const step = Math.max(1, Math.ceil(data.length / 12));
    const labels = data.map((d, i) => {
        if (i % step !== 0) return '';
        const [y, m] = d.key.split('-');
        const x = PAD_L + slot * i + slot / 2;
        return `<text class="analysis-chart-label" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${m === '01' ? `${y.slice(2)}.${m}` : m}</text>`;
    }).join('');

    const sum = data.reduce((acc, d) => ({ w: acc.w + d.w, l: acc.l + d.l }), { w: 0, l: 0 });
    return `
        <div class="section-title section-title-spaced" data-en="BY MONTH">
            <span class="section-title-label">월별 전적</span>
            <span class="title-count">${data.length}개월 · ${analysisWlText(sum.w, sum.l)}</span>
        </div>
        <div class="clean-card p-3">
            <svg viewBox="0 0 ${W} ${H}" class="analysis-chart-svg" role="img" aria-label="월별 전적과 승률 추세">
                ${grid}
                ${bars}
                ${path ? `<path class="analysis-rate-line" d="${path.trim()}" fill="none"></path>` : ''}
                ${dots.join('')}
                ${labels}
            </svg>
            <div class="analysis-chart-legend">
                <span><i class="analysis-legend-dot is-win"></i>승</span>
                <span><i class="analysis-legend-dot is-lose"></i>패</span>
                <span><i class="analysis-legend-line"></i>승률 (${ANALYSIS_RATE_MIN}경기 이상인 달)</span>
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 레이팅
// ---------------------------------------------------------------------------
// 달마다 '그 시점까지의 경기'로 다시 맞춘 점수다(scripts/build_ranking.py).
// 같은 선수의 오르내림을 보는 값이라, 티어가 다른 선수끼리 점수를 맞대 보면 안 된다.
// 기간 칩에 따라 보여줄 개월 수. 점수 자체는 늘 같은 방식(반감기 12개월)으로 계산하고,
// 여기서는 가로축 구간만 자른다. 최근 30일은 한 달이라 점이 하나뿐인데, 그러면 선이
// 안 그려지므로 직전 달 한 점만 붙여 줄을 잇는다.
const RATING_WINDOW = { all: 18, 365: 12, 90: 3, 30: 2 };
// 30일은 점이 둘뿐이라 선이 왼쪽에 몰려 보인다. 오른쪽에 다음 달 자리를 한 칸 비워 둬서
// 이번 달이 가운데 오게 한다(예: 08 · 09 · 10, 값은 08과 09에만).
const RATING_PAD_RIGHT = { 30: 1 };

function nextMonthKey(key) {
    const [y, m] = String(key).split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

const RATING_HELP = '스타대학이 경기 형식·최근성·기록의 불확실성을 반영한 자체 레이팅입니다. 같은 티어 안에서 순위를 매기는 기준입니다.\n\n'
    + '달마다 그때까지의 경기만으로 다시 계산합니다.\n'
    + '한 선수의 오르내림을 보는 값이라, 티어가 다른 선수끼리 점수를 맞대 보면 안 됩니다.\n'
    + '해당 시점에 최근 1년 경기 기록이 없으면 선이 끊깁니다.\n\n'
    + '보여주는 구간 — 전체 18개월 · 1년 12개월 · 90일 3개월 · 30일 1개월\n'
    + '(점수 계산 방식은 기간과 무관하게 늘 같습니다.)';

function analysisRatingTitleHtml(count) {
    return `
        <div class="section-title section-title-spaced" data-en="RATING">
            <span class="section-title-label">레이팅</span>
            ${helpBadgeHtml(RATING_HELP)}
            ${count}
        </div>`;
}

function analysisRatingHtml(pid) {
    const data = AnalysisState.rating;
    const all = data && data.players && data.players[String(pid)];
    const allMonths = (data && data.months) || [];
    if (!all || !allMonths.length) return '';

    // 기간 칩에 맞춰 가로축을 자른다(점수 자체는 다시 계산하지 않는다 - 맨 위 주석 참고).
    const want = RATING_WINDOW[AnalysisState.period] || RATING_WINDOW.all;
    const from = Math.max(0, allMonths.length - want);
    const months = allMonths.slice(from);
    const series = all.slice(from);
    for (let k = RATING_PAD_RIGHT[AnalysisState.period] || 0; k > 0; k--) {
        months.push(nextMonthKey(months[months.length - 1]));
        series.push(null);
    }

    const pts = series.map((v, i) => (v === null || v === undefined ? null : { i, v, key: months[i] }));
    const have = pts.filter(Boolean);
    // 점이 하나뿐이면 선을 못 그린다. 칸을 비우면 옆의 월별 전적과 높이가 어긋나므로
    // 제목과 안내만 남긴다.
    if (have.length < 2) {
        return analysisRatingTitleHtml('')
            + '<div class="clean-card p-3 analysis-rating-empty">이 기간에는 그릴 만한 기록이 없습니다.</div>';
    }

    // 월별 전적 그래프와 같은 틀(660x220)이어야 두 카드가 같은 크기로 나란히 선다.
    const W = 660, H = 220, PAD_T = 12, PAD_B = 26, PAD_L = 42, PAD_R = 14;
    const plotH = H - PAD_T - PAD_B;
    const plotW = W - PAD_L - PAD_R;
    const vals = have.map(p => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }   // 평평한 선이 납작해 보이지 않게
    const pad = (hi - lo) * 0.15;
    lo -= pad; hi += pad;
    const x = i => PAD_L + (months.length === 1 ? plotW / 2 : (plotW * i) / (months.length - 1));
    const y = v => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;

    // 가로 눈금 3줄. 점수는 정수로 읽히는 게 편하다.
    const grid = [0, 0.5, 1].map(r => {
        const v = lo + (hi - lo) * r;
        return `<line class="analysis-chart-grid" x1="${PAD_L}" y1="${y(v).toFixed(1)}" x2="${W - PAD_R}" y2="${y(v).toFixed(1)}"></line>`
             + `<text class="analysis-chart-axis" x="${PAD_L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`;
    }).join('');

    // 쉰 달은 선을 잇지 않고 끊는다
    let path = '';
    let open = false;
    pts.forEach(p => {
        if (!p) { open = false; return; }
        path += `${open ? 'L' : 'M'} ${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)} `;
        open = true;
    });
    const dots = have.map(p =>
        `<circle class="analysis-rate-dot" cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6"><title>${escapeHTML(p.key)} ${p.v}점</title></circle>`).join('');

    const step = Math.max(1, Math.ceil(months.length / 6));
    const labels = months.map((k, i) => {
        if (i % step !== 0) return '';
        const [yy, mm] = k.split('-');
        return `<text class="analysis-chart-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${mm === '01' ? `${yy.slice(2)}.${mm}` : mm}</text>`;
    }).join('');

    const first = have[0].v, last = have[have.length - 1].v;
    const diff = Number((last - first).toFixed(1));
    const sign = diff > 0 ? 'h2h-win' : (diff < 0 ? 'h2h-lose' : '');
    const top = Math.max(...vals), bottom = Math.min(...vals);
    return analysisRatingTitleHtml(
        `<span class="title-count">${have.length}개월 · ${last}점 <span class="${sign}">${diff > 0 ? '+' : ''}${diff}</span></span>`) + `
        <div class="clean-card p-3">
            <svg viewBox="0 0 ${W} ${H}" class="analysis-chart-svg" role="img" aria-label="월별 레이팅">
                ${grid}
                <path class="analysis-rate-line" d="${path.trim()}" fill="none"></path>
                ${dots}
                ${labels}
            </svg>
            <div class="analysis-chart-legend">
                <span><i class="analysis-legend-line"></i>레이팅 (달 말일 기준)</span>
                <span>최고 ${top}점 · 최저 ${bottom}점</span>
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 맵별 전적 · 동티어 전적 (둘 다 8개씩 + 더 보기)
// ---------------------------------------------------------------------------
function analysisShowMoreMaps() {
    AnalysisState.mapShown += ANALYSIS_MAP_STEP;
    renderAnalysisBody();
}

function analysisShowMoreRivals() {
    AnalysisState.rivalShown += ANALYSIS_RIVAL_STEP;
    renderAnalysisBody();
}

function analysisMapHtml(rows) {
    const byMap = new Map();
    rows.forEach(([, , win, mapId]) => {
        const key = String(mapId);
        if (!h2hMapName(key)) return;
        if (!byMap.has(key)) byMap.set(key, [0, 0]);
        byMap.get(key)[win ? 0 : 1] += 1;
    });
    const all = [...byMap.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = all.slice(0, AnalysisState.mapShown);
    // 상대전적 탭의 '맵별 전적'과 같은 부품(.h2h-maps)을 쓴다.
    return `
        <div class="section-title section-title-spaced" data-en="BY MAP">
            <span class="section-title-label">맵별 전적</span>
            <span class="title-count">${all.length}개</span>
        </div>
        <div class="h2h-maps">
            ${list.map(([mapId, [w, l]]) => `
                <div class="h2h-map">
                    <span class="h2h-map-name">${escapeHTML(h2hMapName(mapId))}</span>
                    <span class="h2h-map-rec">${winLoseText(w, l)}<span class="h2h-rate-sub"> · ${h2hRateText(w, l)}</span></span>
                    <span class="h2h-map-bar"><span style="width:${w + l ? (w / (w + l)) * 100 : 0}%"></span></span>
                </div>`).join('')}
        </div>
        ${all.length > list.length ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" onclick="analysisShowMoreMaps()">더 보기 ${chevronDownSvg(9)}</button>
        </div>` : ''}`;
}

function analysisRivalHtml(rows, myTier) {
    if (myTier === undefined || myTier === '') return '';
    const byOpp = new Map();
    rows.forEach(([, opp, win]) => {
        const key = String(opp);
        const info = h2hPlayer(key);
        if (!info || String(info.t) !== String(myTier)) return;    // 같은 티어만
        if (!byOpp.has(key)) byOpp.set(key, [0, 0]);
        byOpp.get(key)[win ? 0 : 1] += 1;
    });
    const all = [...byOpp.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = all.slice(0, AnalysisState.rivalShown);
    // 상대전적 탭의 '자주 만난 상대'와 같은 부품(.h2h-rivals)을 쓴다 - 누르면 그 선수로 넘어간다.
    return `
        <div class="section-title section-title-spaced" data-en="SAME TIER">
            <span class="section-title-label">동티어 전적</span>
            <span class="title-count">${escapeHTML(tierLabel(myTier))} · ${all.length}명</span>
        </div>
        <div class="h2h-rivals">
            ${list.map(([pid, [w, l]]) => h2hRivalCardHtml(pid, w, l, `analysisPick('${jsAttr(pid)}')`)).join('')}
        </div>
        ${all.length > list.length ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" onclick="analysisShowMoreRivals()">더 보기 ${chevronDownSvg(9)}</button>
        </div>` : ''}`;
}

// ---------------------------------------------------------------------------
// 최근 전적 (형식 필터)
// ---------------------------------------------------------------------------
function analysisFilterRows(rows) {
    return h2hFilterRowsByCategory(rows, AnalysisState.matchFilter);
}

function analysisSetFilter(label) {
    AnalysisState.matchFilter = label;
    AnalysisState.matchPage = 1;
    renderAnalysisBody();
}

function analysisSetPage(page) {
    AnalysisState.matchPage = page;
    renderAnalysisBody();
}

function analysisMatchesHtml(rows) {
    const filtered = analysisFilterRows(rows);
    const page = Math.min(Math.max(1, AnalysisState.matchPage), Math.max(1, Math.ceil(filtered.length / ANALYSIS_PAGE_SIZE)));
    const shown = filtered.slice((page - 1) * ANALYSIS_PAGE_SIZE, page * ANALYSIS_PAGE_SIZE);
    const chips = ['전체', ...H2H_CAT_GROUPS.map(([, short]) => short)].map(label => `
        <div class="filter-item${AnalysisState.matchFilter === label ? ' active' : ''}" role="tab" tabindex="0"
             onclick="analysisSetFilter('${jsAttr(label)}')">${escapeHTML(label)}</div>`).join('');
    return `
        <div class="section-title record-recent-header section-title-spaced" data-en="RECENT">
            <span class="record-recent-title section-title-label">최근 전적</span>
            <div class="filter-nav tab-scroll" role="tablist">${chips}</div>
        </div>
        <div class="clean-card p-0 overflow-hidden">
            <div class="table-responsive scroll-area">
                <table class="table table-borderless table-hover mb-0 text-center stat-table table-fixed minw-520">
                    <thead><tr>
                        <th scope="col" class="stat-table-sticky-col colw-25">상대</th>
                        <th scope="col" class="colw-15">형식</th>
                        <th scope="col" class="colw-25">맵</th>
                        <th scope="col" class="colw-15">결과</th>
                        <th scope="col" class="colw-20">날짜</th>
                    </tr></thead>
                    <tbody>${shown.length ? shown.map(([date, opp, win, mapId, catIdx]) => `
                        <tr class="stat-row">
                            <td class="stat-table-sticky-col cell-ellipsis"><span class="cell-clip">${escapeHTML(h2hName(String(opp)))}</span></td>
                            <td class="badge-cell"><span class="tag-badge">${escapeHTML(h2hCatName(catIdx) || '-')}</span></td>
                            <td class="cell-ellipsis cell-muted"><span class="cell-clip">${escapeHTML(h2hMapName(mapId) || '-')}</span></td>
                            <td class="badge-cell">${resultBadgeHtml(win ? '승' : '패')}</td>
                            <td>${escapeHTML(shortMatchDate(date))}</td>
                        </tr>`).join('') : emptyRowHtml(5, '이 형식의 경기가 없습니다.')}</tbody>
                </table>
            </div>
        </div>
        ${matchPaginationHtml(filtered.length, page, ANALYSIS_PAGE_SIZE, 'analysisSetPage')}`;
}

// ---------------------------------------------------------------------------
// 전체 조립
// ---------------------------------------------------------------------------
function analysisProfileHtml(pid) {
    const p = analysisInfo(pid);
    const rows = analysisRows(pid);
    const e = analysisSummary(rows);
    if (!p || !e) return '<div class="h2h-empty">이 선수의 분석 데이터가 아직 없습니다.</div>';
    return `
        ${analysisHeadHtml(pid, p, e)}
        ${analysisFormHtml(rows)}
        <div class="row g-3 mb-block">
            <div class="col-lg-6">${analysisCatHtml(e)}</div>
            <div class="col-lg-6">${analysisRaceHtml(e)}</div>
        </div>
        <div class="row g-3">
            <div class="col-lg-6">${analysisMonthlyHtml(rows)}</div>
            <div class="col-lg-6">${analysisRatingHtml(pid)}</div>
        </div>
        ${analysisMapHtml(rows)}
        ${analysisRivalHtml(rows, p.t)}
        ${analysisMatchesHtml(rows)}`;
}

function analysisEmptyHtml() {
    return `
        <div class="h2h-empty">
            <span class="h2h-empty-title">선수를 검색해주세요</span>
            <span class="h2h-empty-sub">이름 · 대학으로 검색</span>
        </div>`;
}

function renderAnalysisBody() {
    const box = document.getElementById('analysis-body');
    if (!box) return;
    const period = document.getElementById('analysis-period');
    if (period) period.innerHTML = analysisPeriodHtml();
    box.innerHTML = AnalysisState.picked ? analysisProfileHtml(AnalysisState.picked) : analysisEmptyHtml();
}

async function analysisPick(pid) {
    AnalysisState.picked = pid;
    analysisResetLists();
    AnalysisState.matchFilter = '전체';
    AnalysisState.catPage = 0;
    AnalysisState.query = '';
    AnalysisState.suggestOpen = false;
    const input = document.getElementById('analysis-search-input');
    if (input) input.value = '';
    const box = document.getElementById('analysis-search');
    const old = box && box.querySelector('.h2h-suggest');
    if (old) old.remove();

    document.getElementById('analysis-body').innerHTML = '<div class="h2h-empty">불러오는 중...</div>';
    try {
        // 레이팅 변화는 없어도 나머지가 나와야 하므로, 실패해도 멈추지 않는다(위에서 잡는다).
        await Promise.all([analysisLoadPlayer(pid), analysisLoadRating()]);
    } catch (err) {
        console.error(err);
        document.getElementById('analysis-body').innerHTML =
            `<div class="h2h-empty">${escapeHTML(err.message || '경기 기록을 불러오지 못했습니다.')}</div>`;
        return;
    }
    renderAnalysisBody();
    analysisSyncUrl();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function analysisBack() {
    AnalysisState.picked = null;
    renderAnalysisBody();
    analysisSyncUrl();
    const input = document.getElementById('analysis-search-input');
    if (input) input.focus();
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
    try {
        await analysisLoadData();
    } catch (e) {
        console.error('분석 데이터를 불러오지 못했습니다:', e);
        document.getElementById('analysis-body').innerHTML =
            '<div class="h2h-empty">분석 데이터를 아직 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
        return;
    }
    const updated = document.getElementById('analysis-updated');
    if (updated && H2hState.index.syncedAt) {
        updated.textContent = `${String(H2hState.index.syncedAt).slice(0, 10).replace(/-/g, '.')} 기준`;
    }

    const params = new URLSearchParams(location.search);
    const wanted = params.get('p');
    if (wanted && analysisInfo(wanted)) {
        await analysisPick(wanted);
        return;
    }
    renderAnalysisBody();
}
