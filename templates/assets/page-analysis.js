/**
 * 티어표 · 분석 탭: 선수 한 명을 골라 그 선수의 전적을 여러 각도로 뜯어본다.
 * (core.js → page-tier.js → page-h2h.js → 이 파일. 탭을 처음 열 때만 데이터를 읽는다)
 *
 * 화면 구성은 전적 페이지의 개인 프로필(templates/pages/records.html)을 따른다 -
 * 같은 사이트 안에서 "선수 한 명을 보는 화면"은 같은 모양이어야 한다.
 *   큰 프로필 + 티어/종족/소속 + 티어 내 순위 · 자체 레이팅(한 줄)
 *   → 총 전적 → 형식별 승률(도넛) → 종족별 승률(도넛) → 최근 10경기
 *   → 월별 승률 추세 → 맵별 승률 → 동티어 맞대결 → 최근 전적(형식 필터)
 *
 * [데이터] 두 파일을 같이 쓴다. 경기 로그는 상대전적 탭이 쓰는 것을 그대로 재사용한다 -
 * 같은 내용을 두 벌 두면 저장소만 커지고 서로 어긋날 여지가 생긴다.
 *   docs/data/h2h/index.json   - 선수 이름·티어·소속·맵/형식 사전 + 샤드 경계 (page-h2h.js와 공유)
 *   docs/data/h2h/p/<샤드>.json - 선수별 경기 [[날짜, 상대id, 이김(1/0), 맵id, 형식idx], ...] (최신순)
 *   docs/data/elo/index.json   - scripts/generate_elo.py가 계산한 요약
 *                                 { rt:레이팅, tr:티어내순위, ts:티어인원, g:동티어경기수,
 *                                   m,w,l, race, cat, st:연승/연패, lw, ll, last, dm:휴면, up:🚀 }
 * 상대 종족·형식별 집계는 elo/index.json 것을 쓴다(티어표 밖 상대의 종족까지 계산해 둔 값이라
 * 브라우저에서 다시 세면 그만큼 빠진다). 맵·동티어 맞대결·최근 폼은 경기 로그에서 바로 센다.
 */

const ANALYSIS_ELO_URL = 'data/elo/index.json';
const ANALYSIS_MATCH_STEP = 15;        // 최근 전적 한 번에 보여줄 경기 수
const ANALYSIS_SUGGEST_STEP = 40;
const ANALYSIS_FORM_COUNT = 10;        // '최근 10경기'
const ANALYSIS_CHART_MONTHS = 18;      // 월별 그래프에 보여줄 최근 개월 수
const ANALYSIS_RATE_MIN = 5;           // 월별 승률 선을 그릴 최소 표본(이 미만인 달은 선을 끊는다)
const ANALYSIS_MAP_MIN = 10;           // 맵별 승률에 올릴 최소 경기 수
const ANALYSIS_MAP_COUNT = 8;
const ANALYSIS_RIVAL_COUNT = 8;        // 동티어 맞대결에 보여줄 상대 수

// 형식 묶음: eloboard 형식(스폰·리그·개인·CK·대회·미니·대학·기타)을 화면용으로 묶는다.
// CK와 리그는 둘 다 팀 단위 경기라 하나로 본다.
const ANALYSIS_CAT_GROUPS = [
    ['개인대회', ['개인']],
    ['대학대회', ['대회']],
    ['대학대전', ['대학']],
    ['미니대전', ['미니']],
    ['CK+리그', ['CK', '리그']],
    ['스폰', ['스폰', '기타']],
];

const AnalysisState = {
    elo: null,
    loading: null,
    rows: {},              // 선수id -> 경기 로그(최신순)
    picked: null,          // 선수id (null이면 검색 안내 화면)
    query: '',
    suggestOpen: false,
    suggestShown: ANALYSIS_SUGGEST_STEP,
    matchShown: ANALYSIS_MATCH_STEP,
    matchFilter: '전체',    // 최근 전적 형식 필터(ANALYSIS_CAT_GROUPS의 이름 또는 '전체')
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function analysisLoadData() {
    if (AnalysisState.elo) return AnalysisState.elo;
    if (!AnalysisState.loading) {
        // 선수 이름·티어·맵 사전은 상대전적 탭과 같은 파일을 쓴다(h2hLoadIndex가 캐시까지 해준다).
        AnalysisState.loading = Promise.all([
            h2hLoadIndex(),
            fetch(ANALYSIS_ELO_URL, { cache: 'no-cache' })
                .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }),
        ]).then(([, elo]) => { AnalysisState.elo = elo; return elo; })
          .finally(() => { AnalysisState.loading = null; });
    }
    return AnalysisState.loading;
}

// 경기 로그는 상대전적 탭의 샤드를 그대로 쓴다.
async function analysisLoadPlayer(pid) {
    if (!pid) return [];
    if (AnalysisState.rows[pid]) return AnalysisState.rows[pid];
    const rows = await h2hLoadPlayer(pid);
    AnalysisState.rows[pid] = rows;
    return rows;
}

function analysisElo(pid) {
    return (AnalysisState.elo && AnalysisState.elo.players[pid]) || null;
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
function analysisDonutHtml(label, w, l, labelClass) {
    const rate = analysisRate(w, l);
    const pct = rate === null ? 0 : rate;
    const color = rate === null ? 'var(--color-donut-track)' : analysisRateColor(rate);
    return `
        <div class="donut-box">
            <div class="donut" style="background:conic-gradient(${color} ${pct}%, var(--color-donut-track) 0)">
                <span class="donut-text" style="${rate === null ? '' : `color:${color}`}">${rate === null ? '-' : `${rate}%`}</span>
            </div>
            <div class="donut-label${labelClass ? ` ${labelClass}` : ''}">${escapeHTML(label)}</div>
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
        const e = analysisElo(p.pid);
        return `
        <button type="button" class="h2h-suggest-item" onclick="analysisPick('${jsAttr(p.pid)}')">
            ${avatarHtml(p.s || '', 'h2h-suggest-avatar')}
            <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
            ${p.en ? `<span class="h2h-suggest-alt">${escapeHTML(p.en)}</span>` : ''}
            ${p.r ? raceBadgeHtml(p.r) : ''}
            <span class="h2h-suggest-team">${escapeHTML([p.t !== undefined && p.t !== '' ? tierLabel(p.t) : '', p.tm || ''].filter(Boolean).join(' · '))}</span>
            <span class="h2h-suggest-count">${e && e.tr ? `티어 ${e.tr}위` : `${(p.m || 0).toLocaleString('ko-KR')}판`}</span>
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
    const rate = analysisRate(e.w, e.l);
    const tierName = (p.t !== undefined && p.t !== '') ? tierLabel(p.t) : '미분류';
    const rankText = e.tr
        ? `<strong>${e.tr}위</strong><small> / ${e.ts}명</small>`
        : '<small>순위 없음</small>';
    return `
        <div class="clean-card profile-head analysis-head p-4 mb-block">
            <div class="profile-avatar analysis-avatar">${avatarHtml(p.s || '', 'analysis-avatar-img')}</div>
            <div class="profile-head-id">
                <h3 class="fw-bold m-0 mb-2 profile-name">${escapeHTML(p.n)}${e.up ? '<span class="analysis-rise" title="최근 폼이 눈에 띄게 올라왔습니다">🚀</span>' : ''}</h3>
                <div class="d-flex gap-2 flex-wrap align-items-center">
                    ${p.t !== undefined && p.t !== '' ? `<span class="tag-badge tier-badge">${escapeHTML(tierName)}</span>` : ''}
                    ${p.r ? raceBadgeHtml(p.r) : ''}
                    ${p.tm ? `<span class="tag-badge">${escapeHTML(p.tm)}</span>` : ''}
                    ${e.dm ? '<span class="tag-badge analysis-dormant-badge">휴면</span>' : ''}
                </div>
                <div class="analysis-rating-line">
                    자체 레이팅 <strong>${e.rt.toLocaleString('ko-KR')}점</strong>
                    <span class="analysis-rating-note">${e.g
                        ? `· 같은 ${escapeHTML(tierName)} 상대 ${e.g.toLocaleString('ko-KR')}경기 기준`
                        : '· 같은 티어 상대 경기가 없어 기본 점수입니다'}</span>
                    <button type="button" class="analysis-help" onclick="analysisToggleHelp()" aria-label="레이팅 설명">?</button>
                </div>
            </div>
            <div class="profile-head-stats">
                <div class="profile-head-stat">
                    <div class="profile-head-label">${escapeHTML(tierName)} 순위</div>
                    <div class="profile-head-value">${rankText}</div>
                </div>
                <div class="profile-head-stat">
                    <div class="profile-head-label">총 전적</div>
                    <div class="profile-head-value">${(e.m || 0).toLocaleString('ko-KR')}<small>전</small></div>
                </div>
                <div class="profile-head-stat">
                    <div class="profile-head-label">WIN RATE</div>
                    <div class="profile-head-value profile-head-rate">${rate === null ? '-' : `${rate}%`}</div>
                </div>
            </div>
        </div>
        <div class="analysis-help-box" id="analysis-help" hidden>
            <p>같은 티어끼리 붙은 경기만으로 계산합니다. 대회·대학대전 같은 중요 경기는 시간이 지나도 값이 그대로지만,
            스폰(연습)은 ${(AnalysisState.elo.halfLifeDays || 90)}일 반감기로 오래될수록 완만하게 값이 줄어듭니다.</p>
            <p>같은 날 같은 상대와 여러 판을 한 경우는 다전제 한 경기로 환산하고, 표본(동티어 경기)이 적으면
            기준점 ${(AnalysisState.elo.initialRating || 1500).toLocaleString('ko-KR')}점 쪽으로 점수를 끌어당깁니다.
            최근 ${(AnalysisState.elo.dormantDays || 50)}일간 경기가 없으면 휴면으로 보고 순위 모집단에서 뺍니다.</p>
        </div>`;
}

function analysisToggleHelp() {
    const box = document.getElementById('analysis-help');
    if (box) box.hidden = !box.hidden;
}

// ---------------------------------------------------------------------------
// 형식별 · 종족별 승률 (도넛)
// ---------------------------------------------------------------------------
function analysisCatTotals(e) {
    const cats = (H2hState.index && H2hState.index.cats) || [];
    const totals = new Map();
    ANALYSIS_CAT_GROUPS.forEach(([label]) => totals.set(label, [0, 0]));
    cats.forEach((name, i) => {
        const pair = (e.cat && e.cat[i]) || [0, 0];
        const group = ANALYSIS_CAT_GROUPS.find(([, members]) => members.includes(name));
        if (!group) return;
        const acc = totals.get(group[0]);
        acc[0] += pair[0];
        acc[1] += pair[1];
    });
    return totals;
}

function analysisCatHtml(e) {
    const totals = analysisCatTotals(e);
    const boxes = ANALYSIS_CAT_GROUPS.map(([label]) => {
        const [w, l] = totals.get(label) || [0, 0];
        return analysisDonutHtml(label, w, l);
    }).join('');
    return `
        <div class="clean-card h-100 p-3">
            <div class="section-title-sm" data-en="BY FORMAT">형식별 승률</div>
            <div class="donut-wrap analysis-donut-wrap">${boxes}</div>
        </div>`;
}

function analysisRaceHtml(e) {
    const race = e.race || {};
    const boxes = [['T', 'vs T', 'donut-label-t'], ['Z', 'vs Z', 'donut-label-z'], ['P', 'vs P', 'donut-label-p']]
        .map(([code, label, cls]) => {
            const [w, l] = race[code] || [0, 0];
            return analysisDonutHtml(label, w, l, cls);
        }).join('');
    return `
        <div class="clean-card h-100 p-3">
            <div class="section-title-sm" data-en="BY MATCHUP">종족별 승률</div>
            <div class="donut-wrap">${boxes}</div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 최근 10경기
// ---------------------------------------------------------------------------
function analysisFormHtml(rows, e) {
    if (!rows.length) return '';
    const recent = rows.slice(0, ANALYSIS_FORM_COUNT);   // 로그가 최신순이다
    const w = recent.filter(r => r[2]).length;
    const streak = e.st && e.st.n
        ? `<span class="${e.st.t === 'W' ? 'h2h-win' : 'h2h-lose'}">${e.st.t === 'W' ? `${e.st.n}연승 중` : `${e.st.n}연패 중`}</span>`
        : '';
    return `
        <div class="clean-card p-3 analysis-form-card">
            <div class="section-title-sm" data-en="LAST 10">최근 ${recent.length}경기
                <span class="title-count">${w}승 ${recent.length - w}패 ${streak ? `· ${streak}` : ''}</span>
            </div>
            <div class="analysis-form">
                ${recent.map(([date, opp, win]) => `
                    <div class="analysis-form-item ${win ? 'is-win' : 'is-lose'}" title="${escapeHTML(String(date))} vs ${escapeHTML(h2hName(String(opp)))}">
                        <span class="analysis-form-res">${win ? '승' : '패'}</span>
                        <span class="analysis-form-opp">${escapeHTML(h2hName(String(opp)))}</span>
                        <span class="analysis-form-date">${escapeHTML(shortMatchDate(date))}</span>
                    </div>`).join('')}
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 월별 전적 · 승률 추세
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

    const W = 640, H = 190, PAD_T = 14, PAD_B = 24, PAD_X = 6;
    const plotH = H - PAD_T - PAD_B;
    const maxTotal = Math.max(...data.map(d => d.total), 1);
    const slot = (W - PAD_X * 2) / data.length;
    const barW = Math.min(24, Math.max(4, slot * 0.6));

    const bars = data.map((d, i) => {
        if (!d.total) return '';
        const x = PAD_X + slot * i + (slot - barW) / 2;
        const h = (d.total / maxTotal) * plotH;
        const y = PAD_T + (plotH - h);
        const winH = (d.w / d.total) * h;
        return `<rect class="analysis-bar-win" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${winH.toFixed(1)}"><title>${d.key} ${d.w}승 ${d.l}패</title></rect>`
             + `<rect class="analysis-bar-lose" x="${x.toFixed(1)}" y="${(y + winH).toFixed(1)}" width="${barW.toFixed(1)}" height="${(h - winH).toFixed(1)}"></rect>`;
    }).join('');

    // 표본이 적은 달(ANALYSIS_RATE_MIN 미만)은 승률 선을 끊는다 - 1~2경기짜리 달이 0%/100%로
    // 튀면서 추세를 못 읽게 만들기 때문.
    let path = '';
    let open = false;
    data.forEach((d, i) => {
        if (d.total < ANALYSIS_RATE_MIN) { open = false; return; }
        const x = PAD_X + slot * i + slot / 2;
        const y = PAD_T + plotH - (d.w / d.total) * plotH;
        path += `${open ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `;
        open = true;
    });

    const step = Math.max(1, Math.ceil(data.length / 12));
    const labels = data.map((d, i) => {
        if (i % step !== 0) return '';
        const [y, m] = d.key.split('-');
        const x = PAD_X + slot * i + slot / 2;
        return `<text class="analysis-chart-label" x="${x.toFixed(1)}" y="${H - 7}" text-anchor="middle">${m === '01' ? `${y.slice(2)}.${m}` : m}</text>`;
    }).join('');

    const mid = PAD_T + plotH / 2;
    return `
        <div class="clean-card p-3">
            <div class="section-title-sm" data-en="TREND">월별 전적 · 승률</div>
            <svg viewBox="0 0 ${W} ${H}" class="analysis-chart-svg" role="img" aria-label="월별 전적과 승률 추세">
                <line class="analysis-chart-mid" x1="${PAD_X}" y1="${mid.toFixed(1)}" x2="${W - PAD_X}" y2="${mid.toFixed(1)}"></line>
                ${bars}
                ${path ? `<path class="analysis-rate-line" d="${path.trim()}" fill="none"></path>` : ''}
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
// 맵별 승률 · 동티어 맞대결
// ---------------------------------------------------------------------------
function analysisMapHtml(rows) {
    const byMap = new Map();
    rows.forEach(([, , win, mapId]) => {
        const key = String(mapId);
        if (!byMap.has(key)) byMap.set(key, [0, 0]);
        byMap.get(key)[win ? 0 : 1] += 1;
    });
    const list = [...byMap.entries()]
        .filter(([mapId, [w, l]]) => w + l >= ANALYSIS_MAP_MIN && h2hMapName(mapId))
        .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))
        .slice(0, ANALYSIS_MAP_COUNT);
    if (!list.length) return '';
    return `
        <div class="clean-card h-100 p-3">
            <div class="section-title-sm" data-en="BY MAP">맵별 승률
                <span class="title-count">${ANALYSIS_MAP_MIN}경기 이상</span>
            </div>
            <div class="analysis-bars">
                ${list.map(([mapId, [w, l]]) => {
                    const rate = analysisRate(w, l);
                    return `
                    <div class="analysis-bar-row">
                        <span class="analysis-bar-name">${escapeHTML(h2hMapName(mapId))}</span>
                        <span class="analysis-bar-rate" style="color:${analysisRateColor(rate)}">${rate}%</span>
                        <span class="analysis-bar-rec">${w}승 ${l}패</span>
                        <span class="h2h-map-bar"><span style="width:${rate}%"></span></span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
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
    const list = [...byOpp.entries()]
        .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))
        .slice(0, ANALYSIS_RIVAL_COUNT);
    if (!list.length) return '';
    return `
        <div class="clean-card h-100 p-3">
            <div class="section-title-sm" data-en="SAME TIER">동티어 맞대결
                <span class="title-count">${escapeHTML(tierLabel(myTier))}</span>
            </div>
            <div class="analysis-bars">
                ${list.map(([pid, [w, l]]) => {
                    const rate = analysisRate(w, l);
                    const info = h2hPlayer(pid);
                    return `
                    <button type="button" class="analysis-bar-row analysis-bar-link" onclick="analysisPick('${jsAttr(pid)}')">
                        <span class="analysis-bar-name">${escapeHTML(info ? info.n : h2hName(pid))}</span>
                        <span class="analysis-bar-rate" style="color:${analysisRateColor(rate)}">${rate}%</span>
                        <span class="analysis-bar-rec">${w}승 ${l}패</span>
                        <span class="h2h-map-bar"><span style="width:${rate}%"></span></span>
                    </button>`;
                }).join('')}
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// 최근 전적 (형식 필터)
// ---------------------------------------------------------------------------
function analysisFilterRows(rows) {
    if (AnalysisState.matchFilter === '전체') return rows;
    const group = ANALYSIS_CAT_GROUPS.find(([label]) => label === AnalysisState.matchFilter);
    if (!group) return rows;
    const cats = (H2hState.index && H2hState.index.cats) || [];
    const wanted = new Set(group[1].map(name => cats.indexOf(name)).filter(i => i >= 0));
    return rows.filter(r => wanted.has(r[4]));
}

function analysisSetFilter(label) {
    AnalysisState.matchFilter = label;
    AnalysisState.matchShown = ANALYSIS_MATCH_STEP;
    renderAnalysisBody();
}

function analysisShowMoreMatches() {
    AnalysisState.matchShown += ANALYSIS_MATCH_STEP;
    renderAnalysisBody();
}

function analysisMatchesHtml(rows) {
    const filtered = analysisFilterRows(rows);
    const shown = filtered.slice(0, AnalysisState.matchShown);
    const chips = ['전체', ...ANALYSIS_CAT_GROUPS.map(([label]) => label)].map(label => `
        <div class="filter-item${AnalysisState.matchFilter === label ? ' active' : ''}" role="tab" tabindex="0"
             onclick="analysisSetFilter('${jsAttr(label)}')">${escapeHTML(label)}</div>`).join('');
    return `
        <div class="section-title record-recent-header section-title-spaced" data-en="RECENT">
            <span class="record-recent-title section-title-label">최근 전적</span>
            <div class="filter-nav tab-scroll" role="tablist">${chips}</div>
            <span class="title-count">${filtered.length.toLocaleString('ko-KR')}경기</span>
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
        ${filtered.length > shown.length ? `
        <div class="news-load-more-wrap">
            <button type="button" class="news-load-more" onclick="analysisShowMoreMatches()">더 보기 (${(filtered.length - shown.length).toLocaleString('ko-KR')}경기 남음)</button>
        </div>` : ''}`;
}

// ---------------------------------------------------------------------------
// 전체 조립
// ---------------------------------------------------------------------------
function analysisProfileHtml(pid) {
    const p = analysisInfo(pid);
    const e = analysisElo(pid);
    if (!p || !e) return '<div class="h2h-empty">이 선수의 분석 데이터가 아직 없습니다.</div>';
    const rows = AnalysisState.rows[pid] || [];
    return `
        <div class="analysis-toolbar">
            <button type="button" class="analysis-back" onclick="analysisBack()"><span aria-hidden="true">←</span> 다른 선수 찾기</button>
        </div>
        ${analysisHeadHtml(pid, p, e)}
        <div class="row g-3 mb-block">
            <div class="col-lg-7">${analysisCatHtml(e)}</div>
            <div class="col-lg-5">${analysisRaceHtml(e)}</div>
        </div>
        <div class="row g-3 mb-block">
            <div class="col-12">${analysisFormHtml(rows, e)}</div>
        </div>
        <div class="row g-3 mb-block">
            <div class="col-12">${analysisMonthlyHtml(rows)}</div>
        </div>
        <div class="row g-3 mb-block">
            <div class="col-lg-6">${analysisMapHtml(rows)}</div>
            <div class="col-lg-6">${analysisRivalHtml(rows, p.t)}</div>
        </div>
        ${analysisMatchesHtml(rows)}`;
}

function analysisEmptyHtml() {
    return `
        <div class="h2h-empty">
            <span class="h2h-empty-title">선수를 검색해주세요</span>
            <span class="h2h-empty-sub">이름 · 대학으로 찾으면 그 선수의 전적을 자세히 보여줍니다</span>
        </div>`;
}

function renderAnalysisBody() {
    const box = document.getElementById('analysis-body');
    if (!box) return;
    box.innerHTML = AnalysisState.picked ? analysisProfileHtml(AnalysisState.picked) : analysisEmptyHtml();
}

async function analysisPick(pid) {
    AnalysisState.picked = pid;
    AnalysisState.matchShown = ANALYSIS_MATCH_STEP;
    AnalysisState.matchFilter = '전체';
    AnalysisState.query = '';
    AnalysisState.suggestOpen = false;
    const input = document.getElementById('analysis-search-input');
    if (input) input.value = '';
    const box = document.getElementById('analysis-search');
    const old = box && box.querySelector('.h2h-suggest');
    if (old) old.remove();

    document.getElementById('analysis-body').innerHTML = '<div class="h2h-empty">불러오는 중...</div>';
    try {
        await analysisLoadPlayer(pid);
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
    if (updated && AnalysisState.elo.syncedAt) {
        updated.textContent = `${String(AnalysisState.elo.syncedAt).slice(0, 10).replace(/-/g, '.')} 기준`;
    }

    const params = new URLSearchParams(location.search);
    const wanted = params.get('p');
    if (wanted && analysisElo(wanted)) {
        await analysisPick(wanted);
        return;
    }
    renderAnalysisBody();
}
