/**
 * 티어표 · 상대전적 탭: 선수 두 명을 고르면 맞대결 전적과 경기 목록을 보여준다.
 * (core.js → page-tier.js → 이 파일. 탭을 처음 열 때만 데이터를 읽는다)
 *
 * 데이터: docs/data/h2h/ - scripts/build_h2h.py가 eloboard 아카이브를 선수별로 잘라 둔 것.
 *   index.json      { syncedAt, cats:[대회 이름], maps:{맵id:이름},
 *                     players:{ 선수id: {n:이름(티어표 닉네임), en:eloboard 이름(다를 때만),
 *                                        r:종족, m:판수, w:승, d:최근 경기일, tm:대학, t:티어, s:숲아이디} },
 *                     others: { 선수id: 이름 } }        // 티어표 밖 상대 이름
 *   p/<선수id>.json { id, rows:[[날짜, 상대id, 이김(1/0), 맵id, 대회 인덱스], ...] }   // 최신순
 * 한 명 파일이 30~60KB라 고를 때 하나씩 받는다(원본 아카이브는 14MB라 통째로 못 준다).
 */

const H2H_INDEX_URL = 'data/h2h/index.json';
const H2H_PERIODS = [['all', '전체'], ['365', '최근 1년'], ['90', '최근 90일'], ['30', '최근 30일']];
const H2H_LIST_STEP = 10;          // 경기 목록 한 번에 보여줄 개수
const H2H_RIVAL_STEP = 10;         // '자주 만난 상대' 한 번에 보여줄 명수
const H2H_MAP_STEP = 10;           // '맵별 전적' 한 번에 보여줄 개수
const H2H_SUGGEST_MAX = 12;

const H2hState = {
    index: null,
    loading: null,        // 진행 중인 index 요청(중복 요청 방지)
    period: '90',
    picks: [null, null],  // 선수 id
    rows: {},             // 선수 id -> 경기 행
    shown: H2H_LIST_STEP,
    rivalShown: H2H_RIVAL_STEP,
    mapShown: H2H_MAP_STEP,
    suggestSlot: -1,      // 추천 목록이 열려 있는 칸
    query: ['', ''],
};

// ---------------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------------
async function h2hLoadIndex() {
    if (H2hState.index) return H2hState.index;
    if (!H2hState.loading) {
        H2hState.loading = fetch(H2H_INDEX_URL, { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => { H2hState.index = data; return data; })
            .finally(() => { H2hState.loading = null; });
    }
    return H2hState.loading;
}

async function h2hLoadPlayer(pid) {
    if (!pid) return [];
    if (H2hState.rows[pid]) return H2hState.rows[pid];
    const res = await fetch(`data/h2h/p/${encodeURIComponent(pid)}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`선수 전적을 불러오지 못했습니다 (HTTP ${res.status})`);
    const data = await res.json();
    H2hState.rows[pid] = Array.isArray(data.rows) ? data.rows : [];
    return H2hState.rows[pid];
}

function h2hPlayer(pid) {
    return (H2hState.index && H2hState.index.players[pid]) || null;
}

function h2hName(pid) {
    const p = h2hPlayer(pid);
    if (p) return p.n;
    const other = H2hState.index && H2hState.index.others && H2hState.index.others[pid];
    return other || '알 수 없음';
}

function h2hMapName(id) {
    return (H2hState.index && H2hState.index.maps[String(id)]) || '';
}

function h2hCatName(idx) {
    const cats = (H2hState.index && H2hState.index.cats) || [];
    return cats[idx] || '';
}

// 기간 자르는 날짜(YYYY-MM-DD). 날짜는 문자열 비교로 충분하다.
function h2hSince() {
    if (H2hState.period === 'all') return '';
    const d = new Date(Date.now() - Number(H2hState.period) * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function h2hRowsInPeriod(pid) {
    const since = h2hSince();
    const rows = H2hState.rows[pid] || [];
    return since ? rows.filter(r => String(r[0]) >= since) : rows;
}

function h2hRecord(rows) {
    const win = rows.filter(r => r[2]).length;
    return { win, lose: rows.length - win, total: rows.length };
}

function h2hRateText(win, lose) {
    const total = win + lose;
    return total ? `${Math.round((win / total) * 1000) / 10}%` : '-';
}

// ---------------------------------------------------------------------------
// 선수 고르기 (이름 · 대학으로 검색)
// ---------------------------------------------------------------------------
function h2hSuggest(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q || !H2hState.index) return [];
    const entries = Object.entries(H2hState.index.players);
    const byName = [];
    const byTeam = [];
    entries.forEach(([pid, p]) => {
        // 티어표 닉네임으로도, eloboard 이름(본명 등)으로도 찾을 수 있게 둘 다 본다
        const names = [p.n, p.en].filter(Boolean).map(x => String(x).toLowerCase());
        if (names.some(n => n.includes(q))) byName.push([pid, p]);
        else if (String(p.tm || '').toLowerCase().includes(q)) byTeam.push([pid, p]);   // 대학으로 찾으면 소속 전원
    });
    const sort = list => list.sort((a, b) =>
        tierIndex(a[1].t) - tierIndex(b[1].t) || (b[1].m || 0) - (a[1].m || 0) || String(a[1].n).localeCompare(b[1].n, 'ko'));
    return [...sort(byName), ...sort(byTeam)].slice(0, H2H_SUGGEST_MAX);
}

function h2hSuggestHtml(slot) {
    const list = h2hSuggest(H2hState.query[slot]);
    if (!H2hState.query[slot].trim()) return '';
    if (!list.length) return '<div class="h2h-suggest"><div class="h2h-suggest-empty">찾는 선수가 없습니다.</div></div>';
    return `<div class="h2h-suggest">${list.map(([pid, p]) => `
        <button type="button" class="h2h-suggest-item" onclick="h2hPick(${slot}, '${escapeHTML(pid)}')">
            ${avatarHtml(p.s || '', 'h2h-suggest-avatar')}
            <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
            ${p.en ? `<span class="h2h-suggest-alt">${escapeHTML(p.en)}</span>` : ''}
            ${p.r ? raceBadgeHtml(p.r) : ''}
            <span class="h2h-suggest-team">${escapeHTML([p.t !== undefined && p.t !== '' ? tierLabel(p.t) : '', p.tm || ''].filter(Boolean).join(' · '))}</span>
            <span class="h2h-suggest-count">${(p.m || 0).toLocaleString('ko-KR')}판</span>
        </button>`).join('')}</div>`;
}

function h2hSlotHtml(slot) {
    const pid = H2hState.picks[slot];
    const label = slot === 0 ? '선수 1' : '선수 2';
    if (!pid) {
        return `
            <div class="h2h-slot-inner is-empty">
                <label class="h2h-slot-label" for="h2h-input-${slot}">${label}</label>
                <input type="search" class="h2h-input" id="h2h-input-${slot}" autocomplete="off"
                       placeholder="이름 또는 대학으로 검색" value="${escapeHTML(H2hState.query[slot])}"
                       oninput="h2hOnQuery(${slot}, this.value)">
                ${H2hState.suggestSlot === slot ? h2hSuggestHtml(slot) : ''}
            </div>`;
    }
    const p = h2hPlayer(pid) || { n: h2hName(pid) };
    const rec = h2hRecord(h2hRowsInPeriod(pid));
    return `
        <div class="h2h-slot-inner">
            <div class="h2h-slot-label">${label}</div>
            <div class="h2h-card">
                <div class="h2h-card-avatar">${avatarHtml(p.s || '', 'h2h-card-avatar-img')}</div>
                <div class="h2h-card-body">
                    <div class="h2h-card-nameline">
                        <span class="h2h-card-name">${escapeHTML(p.n)}</span>
                        ${p.r ? raceBadgeHtml(p.r) : ''}
                    </div>
                    <div class="h2h-card-sub">${escapeHTML([p.t !== undefined && p.t !== '' ? tierLabel(p.t) : '', p.tm || ''].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
                    <div class="h2h-card-rec">
                        <strong>${rec.total.toLocaleString('ko-KR')}전</strong>
                        <span class="h2h-win">${rec.win}승</span>
                        <span class="h2h-lose">${rec.lose}패</span>
                        <span class="h2h-card-rate">${h2hRateText(rec.win, rec.lose)}</span>
                    </div>
                </div>
                <button type="button" class="h2h-card-clear" aria-label="선수 지우기" onclick="h2hClear(${slot})">✕</button>
            </div>
        </div>`;
}

function h2hOnQuery(slot, value) {
    H2hState.query[slot] = value;
    H2hState.suggestSlot = slot;
    const box = document.getElementById(`h2h-slot-${slot}`);
    const old = box.querySelector('.h2h-suggest');
    if (old) old.remove();
    box.querySelector('.h2h-slot-inner').insertAdjacentHTML('beforeend', h2hSuggestHtml(slot));
}

async function h2hPick(slot, pid) {
    H2hState.picks[slot] = pid;
    H2hState.query[slot] = '';
    H2hState.suggestSlot = -1;
    H2hState.shown = H2H_LIST_STEP;
    H2hState.rivalShown = H2H_RIVAL_STEP;
    H2hState.mapShown = H2H_MAP_STEP;
    renderH2hSlots();
    document.getElementById('h2h-result').innerHTML = '<div class="h2h-empty">전적을 불러오는 중...</div>';
    try {
        await h2hLoadPlayer(pid);
    } catch (e) {
        console.error(e);
        document.getElementById('h2h-result').innerHTML = `<div class="h2h-empty">${escapeHTML(e.message)}</div>`;
        return;
    }
    renderH2hSlots();
    renderH2hResult();
    h2hSyncUrl();
}

function h2hClear(slot) {
    H2hState.picks[slot] = null;
    H2hState.shown = H2H_LIST_STEP;
    H2hState.rivalShown = H2H_RIVAL_STEP;
    H2hState.mapShown = H2H_MAP_STEP;
    renderH2hSlots();
    renderH2hResult();
    h2hSyncUrl();
}

function h2hSetPeriod(period) {
    H2hState.period = period;
    H2hState.shown = H2H_LIST_STEP;
    H2hState.rivalShown = H2H_RIVAL_STEP;
    H2hState.mapShown = H2H_MAP_STEP;
    renderH2hPeriod();
    renderH2hSlots();
    renderH2hResult();
}

function h2hShowMore() {
    H2hState.shown += H2H_LIST_STEP;
    renderH2hResult();
}

function h2hShowMoreRivals() {
    H2hState.rivalShown += H2H_RIVAL_STEP;
    renderH2hResult();
}

function h2hShowMoreMaps() {
    H2hState.mapShown += H2H_MAP_STEP;
    renderH2hResult();
}

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------
// 경기 목록: 전적 페이지의 '최근 전적' 표와 같은 틀·같은 부품을 쓴다
// (stat-table + tag-badge + resultBadgeHtml + shortMatchDate). 표가 페이지마다 달라 보이지 않게.
function h2hMatchRowsHtml(rows, showOpponent) {
    return rows.map(([date, opp, win, mapId, cat]) => `
            <tr class="stat-row">
                ${showOpponent ? `<td class="stat-table-sticky-col cell-ellipsis">${escapeHTML(h2hName(String(opp)))}</td>` : ''}
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(h2hCatName(cat) || '-')}</span></td>
                <td class="cell-ellipsis cell-muted">${escapeHTML(h2hMapName(mapId) || '-')}</td>
                <td class="badge-cell">${resultBadgeHtml(win ? '승' : '패')}</td>
                <td>${escapeHTML(shortMatchDate(date))}</td>
            </tr>`).join('');
}

function h2hTableHtml(rows, showOpponent) {
    const shown = rows.slice(0, H2hState.shown);
    const colw = showOpponent ? 'colw-20' : 'colw-25';
    const head = (label, sticky) =>
        `<th scope="col" class="text-center ${sticky ? 'stat-table-sticky-col ' : ''}${colw}">${label}</th>`;
    return `
        <div class="clean-card p-0 overflow-hidden">
            <div class="table-responsive scroll-area">
                <table class="table table-borderless table-hover mb-0 text-center stat-table table-fixed minw-520">
                    <thead>
                        <tr>
                            ${showOpponent ? head('상대', true) : ''}
                            ${head('형식', !showOpponent)}
                            ${head('맵')}
                            ${head('결과')}
                            ${head('날짜')}
                        </tr>
                    </thead>
                    <tbody>${shown.length ? h2hMatchRowsHtml(shown, showOpponent)
                        : emptyRowHtml(showOpponent ? 5 : 4, '경기 기록이 없습니다.')}</tbody>
                </table>
            </div>
        </div>
        ${rows.length > shown.length ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" onclick="h2hShowMore()">경기 더 보기 (${(rows.length - shown.length).toLocaleString('ko-KR')}경기 남음)</button>
        </div>` : ''}`;
}

// 맵별 전적: 많이 한 순으로
function h2hMapTableHtml(rows, limited) {
    const byMap = new Map();
    rows.forEach(r => {
        const key = String(r[3]);
        if (!byMap.has(key)) byMap.set(key, [0, 0]);
        byMap.get(key)[r[2] ? 0 : 1] += 1;
    });
    const all = [...byMap.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = limited ? all.slice(0, H2hState.mapShown) : all;
    return `
        <div class="h2h-maps">
            ${list.map(([mapId, [win, lose]]) => `
                <div class="h2h-map">
                    <span class="h2h-map-name">${escapeHTML(h2hMapName(mapId) || '맵 정보 없음')}</span>
                    <span class="h2h-map-rec"><span class="h2h-win">${win}</span> · <span class="h2h-lose">${lose}</span></span>
                    <span class="h2h-map-bar"><span style="width:${win + lose ? (win / (win + lose)) * 100 : 0}%"></span></span>
                </div>`).join('')}
        </div>
        ${all.length > list.length ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" onclick="h2hShowMoreMaps()">맵 더 보기 (${all.length - list.length}개 남음)</button>
        </div>` : ''}`;
}

function h2hScoreHtml(a, b, winA, winB) {
    const total = winA + winB;
    const pct = total ? (winA / total) * 100 : 50;
    return `
        <div class="h2h-score">
            <div class="h2h-score-side">
                <div class="h2h-score-name">${escapeHTML(a)}</div>
                <div class="h2h-score-num is-a">${winA}</div>
            </div>
            <div class="h2h-score-mid">
                <div class="h2h-score-rate">${h2hRateText(winA, winB)}</div>
                <div class="h2h-score-bar"><span style="width:${pct}%"></span></div>
                <div class="h2h-score-total">${total.toLocaleString('ko-KR')}전</div>
            </div>
            <div class="h2h-score-side">
                <div class="h2h-score-name">${escapeHTML(b)}</div>
                <div class="h2h-score-num is-b">${winB}</div>
            </div>
        </div>`;
}

// 한 명만 골랐을 때: 자주 만난 상대와 최근 경기
function h2hTopOpponentsHtml(rows) {
    const byOpp = new Map();
    rows.forEach(r => {
        const key = String(r[1]);
        if (!byOpp.has(key)) byOpp.set(key, [0, 0]);
        byOpp.get(key)[r[2] ? 0 : 1] += 1;
    });
    const all = [...byOpp.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = all.slice(0, H2hState.rivalShown);
    return `
        <div class="section-title" data-en="RIVALS"><span class="section-title-label">자주 만난 상대</span>
            <span class="title-count">${all.length.toLocaleString('ko-KR')}명</span></div>
        <div class="h2h-rivals">
            ${list.map(([pid, [win, lose]]) => {
                const known = h2hPlayer(pid);
                return `
                <button type="button" class="h2h-rival" ${known ? `onclick="h2hPick(1, '${escapeHTML(pid)}')"` : 'disabled'}>
                    ${avatarHtml(known ? (known.s || '') : '', 'h2h-rival-avatar')}
                    <span class="h2h-rival-name">${escapeHTML(h2hName(pid))}</span>
                    <span class="h2h-rival-rec"><span class="h2h-win">${win}</span>-<span class="h2h-lose">${lose}</span></span>
                </button>`;
            }).join('')}
        </div>
        ${all.length > list.length ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" onclick="h2hShowMoreRivals()">상대 더 보기 (${(all.length - list.length).toLocaleString('ko-KR')}명 남음)</button>
        </div>` : ''}`;
}

function renderH2hResult() {
    const box = document.getElementById('h2h-result');
    if (!box) return;
    const [a, b] = H2hState.picks;
    if (!a && !b) {
        box.innerHTML = '<div class="h2h-empty">선수를 골라주세요. 대학 이름으로 검색하면 그 대학 선수들이 모두 나옵니다.</div>';
        return;
    }
    // 한 명만 골랐을 때: 자주 만난 상대 → 맵별 전적 → 경기 목록 (셋 다 10개씩 + 더 보기)
    if (!a || !b) {
        const pid = a || b;
        const rows = h2hRowsInPeriod(pid);
        if (!rows.length) {
            box.innerHTML = '<div class="h2h-empty">이 기간에 경기가 없습니다.</div>';
            return;
        }
        box.innerHTML = `
            ${h2hTopOpponentsHtml(rows)}
            <div class="section-title section-title-spaced" data-en="BY MAP"><span class="section-title-label">맵별 전적</span></div>
            ${h2hMapTableHtml(rows, true)}
            <div class="section-title section-title-spaced" data-en="MATCHES"><span class="section-title-label">경기 목록</span>
                <span class="title-count">${rows.length.toLocaleString('ko-KR')}경기</span></div>
            ${h2hTableHtml(rows, true)}`;
        return;
    }
    const rows = h2hRowsInPeriod(a).filter(r => String(r[1]) === String(b));
    const rec = h2hRecord(rows);
    box.innerHTML = `
        ${h2hScoreHtml(h2hName(a), h2hName(b), rec.win, rec.lose)}
        ${rows.length ? `
            <div class="section-title section-title-spaced" data-en="BY MAP"><span class="section-title-label">맵별 전적</span>
                <span class="title-count">${escapeHTML(h2hName(a))} 기준</span></div>
            ${h2hMapTableHtml(rows)}
            <div class="section-title section-title-spaced" data-en="MATCHES"><span class="section-title-label">경기 목록</span>
                <span class="title-count">${rows.length.toLocaleString('ko-KR')}경기</span></div>
            ${h2hTableHtml(rows, false)}`
        : '<div class="h2h-empty">이 기간에 맞대결이 없습니다. 기간을 넓혀보세요.</div>'}`;
}

function renderH2hPeriod() {
    const bar = document.getElementById('h2h-period');
    if (!bar) return;
    bar.innerHTML = H2H_PERIODS.map(([key, label]) => `
        <button type="button" class="filter-item${H2hState.period === key ? ' active' : ''}"
                aria-pressed="${H2hState.period === key}" onclick="h2hSetPeriod('${key}')">${label}</button>`).join('');
}

function renderH2hSlots() {
    [0, 1].forEach(slot => {
        const box = document.getElementById(`h2h-slot-${slot}`);
        if (box) box.innerHTML = h2hSlotHtml(slot);
    });
}

function h2hSyncUrl() {
    const [a, b] = H2hState.picks;
    PageState.update({ view: 'h2h', p1: a || '', p2: b || '' });
}

// ---------------------------------------------------------------------------
// 탭 진입
// ---------------------------------------------------------------------------
let h2hStarted = false;

async function h2hEnter() {
    if (h2hStarted) { h2hSyncUrl(); return; }
    h2hStarted = true;
    renderH2hPeriod();
    renderH2hSlots();
    try {
        await h2hLoadIndex();
    } catch (e) {
        console.error('상대전적 데이터를 불러오지 못했습니다:', e);
        document.getElementById('h2h-result').innerHTML =
            '<div class="h2h-empty">전적 데이터를 아직 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
        return;
    }
    if (!Object.keys(H2hState.index.players || {}).length) {
        // 아직 아카이브를 한 번도 모으지 않은 상태(빈 index.json)
        document.getElementById('h2h-result').innerHTML =
            '<div class="h2h-empty">전적 아카이브를 아직 모으는 중입니다. 조금 뒤에 다시 열어주세요.</div>';
        return;
    }
    const updated = document.getElementById('h2h-updated');
    if (updated && H2hState.index.syncedAt) {
        updated.textContent = `${String(H2hState.index.syncedAt).slice(0, 10).replace(/-/g, '.')} 기준 · ${(H2hState.index.count || 0).toLocaleString('ko-KR')}경기`;
    }
    renderH2hSlots();
    renderH2hResult();

    // 주소에 선수가 적혀 있으면(공유 링크) 그대로 되살린다
    const params = new URLSearchParams(location.search);
    const wanted = [params.get('p1'), params.get('p2')].map(v => (v && h2hPlayer(v) ? v : null));
    for (let slot = 0; slot < 2; slot++) {
        if (wanted[slot]) await h2hPick(slot, wanted[slot]);
    }
}

// 추천 목록 밖을 누르면 닫는다
document.addEventListener('click', e => {
    if (H2hState.suggestSlot < 0) return;
    if (e.target.closest && e.target.closest('.h2h-slot-inner')) return;
    H2hState.suggestSlot = -1;
    renderH2hSlots();
});
