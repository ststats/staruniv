/**
 * 티어표 > 상대전적 탭. 분석·엔트리 탭도 선수 목록(h2hLoadIndex)과 경기 기록(h2hLoadPlayer)을 같이 쓴다.
 * (core.js → api.js → 이 파일 → page-analysis.js → page-entry.js → page-tier.js)
 * 데이터는 ststat가 EloBoard에서 모아 Supabase에 둔 것이다.
 */

const H2H_PERIODS = [
    ['all', '전체'],
    ['365', '최근 1년'],
    ['90', '최근 90일'],
    ['30', '최근 30일'],
];
const H2H_LIST_STEP = 10;
const H2H_RIVAL_STEP = 8;
const H2H_MAP_STEP = 8;
const H2H_SUGGEST_STEP = 40;

// 경기 형식: DB의 category_name → 화면 이름(필터 칩도 이 순서). 표에 없는 값은 받은 그대로 보여준다.
const H2H_CATS = {
    solo_event: '개인',
    college_event: '대회',
    college_war: '대학',
    college_mini: '미니',
    pro_league: '리그',
    team_event: 'CK',
    sponsored: '스폰',
};
const H2H_CAT_LABELS = Object.values(H2H_CATS);

const H2hState = {
    index: null,
    loading: null,
    period: '90',
    picks: [null, null],
    rows: {},
    page: 1,
    matchFilter: '전체',
    rivalShown: H2H_RIVAL_STEP,
    mapShown: H2H_MAP_STEP,
    suggestSlot: -1,
    suggestShown: H2H_SUGGEST_STEP,
    query: ['', ''],
};

async function h2hLoadIndexFromSupabase() {
    const playersData = await Api.eloPlayers({ ranked: true, wrap: q => withTimeout(q, '선수 목록') });
    if (!playersData.length) throw new Error('Elo public player view is empty');

    const players = {};
    const others = {};
    const otherRaces = {};
    const tierCounts = {};
    let syncedAt = '';

    for (const row of playersData) {
        const pid = String(row.elo_id);
        const eloName = String(row.elo_name || '');
        syncedAt = syncedAt || String(row.as_of || '');
        if (row.nickname) {
            const nickname = String(row.nickname || eloName);
            players[pid] = {
                n: nickname,
                en: eloName && eloName !== nickname ? eloName : '',
                r: raceCode(row.race),
                m: Number(row.total_games || 0),
                tm: String(row.affiliation || ''),
                t: String(row.tier || ''),
                s: String(row.soop_id || ''),
                k: row.tier_rank == null ? null : Number(row.tier_rank),
            };
            if (row.tier && row.tier_count != null) tierCounts[String(row.tier)] = Number(row.tier_count);
        } else {
            others[pid] = eloName || '알 수 없음';
            if (row.race) otherRaces[pid] = raceCode(row.race);
        }
    }

    return {
        syncedAt,
        cats: [],
        maps: {},
        players,
        others,
        otherRaces,
        ranking: { tierCounts },
        _catIndexByName: {},
    };
}

async function h2hLoadIndex() {
    if (H2hState.index) return H2hState.index;
    if (!H2hState.loading) {
        H2hState.loading = h2hLoadIndexFromSupabase()
            .then(data => {
                H2hState.index = data;
                return data;
            })
            .finally(() => {
                H2hState.loading = null;
            });
    }
    return H2hState.loading;
}

// 경기 행 [날짜, 상대 id, 이김, 맵 id, 형식]의 형식 칸에는 index.cats의 번호를 넣는다(처음 보는 형식은 뒤에 붙인다).
function h2hCategoryIndex(raw) {
    const name = hasOwn(H2H_CATS, raw) ? H2H_CATS[raw] : String(raw || '').trim();
    if (!name) return -1;
    const state = H2hState.index;
    if (hasOwn(state._catIndexByName, name)) return state._catIndexByName[name];
    const idx = state.cats.length;
    state.cats.push(name);
    state._catIndexByName[name] = idx;
    return idx;
}

async function h2hLoadPlayerFromSupabase(pid) {
    const data = await Api.eloPlayerMatches(pid, { wrap: q => withTimeout(q, '선수 전적') });
    return data.map(r => {
        if (r.map_id != null && r.map_name) H2hState.index.maps[String(r.map_id)] = String(r.map_name);
        return [
            String(r.match_date || ''),
            Number(r.opponent_elo_id),
            r.won ? 1 : 0,
            r.map_id == null ? '' : Number(r.map_id),
            h2hCategoryIndex(r.category_name),
        ];
    });
}

// 받는 중인 선수는 떠 있는 요청을 같이 기다린다. 실패하면 비워서 다음에 다시 받는다.
const h2hPlayerPending = {};
async function h2hLoadPlayer(pid) {
    if (!pid) return [];
    if (H2hState.rows[pid]) return H2hState.rows[pid];
    if (!h2hPlayerPending[pid]) {
        h2hPlayerPending[pid] = h2hLoadPlayerFromSupabase(pid)
            .then(rows => {
                H2hState.rows[pid] = rows;
                return rows;
            })
            .finally(() => {
                delete h2hPlayerPending[pid];
            });
    }
    try {
        return await h2hPlayerPending[pid];
    } catch (e) {
        throw new Error(`선수 전적을 불러오지 못했습니다 (${e.message})`);
    }
}

// 순위와 티어 인원은 직접 세지 않고 ststat가 Supabase에 저장한 값을 쓴다.
function h2hRankInfo(p) {
    const counts = (H2hState.index && H2hState.index.ranking && H2hState.index.ranking.tierCounts) || {};
    return { rank: p.k, tierTotal: counts[String(p.t)] };
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

// 기간 시작 날짜(YYYY-MM-DD). 문자열 비교로 충분하다.
function h2hSince(period = H2hState.period) {
    if (period === 'all') return '';
    const d = new Date(Date.now() - Number(period) * 86400000);
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
    const q = String(query || '')
        .trim()
        .toLowerCase();
    if (!q || !H2hState.index) return [];
    const entries = Object.entries(H2hState.index.players);
    const byName = [];
    const byTeam = [];
    entries.forEach(([pid, p]) => {
        // 티어표 닉네임으로도, eloboard 이름(본명 등)으로도 찾을 수 있게 둘 다 본다
        const names = [p.n, p.en].filter(Boolean).map(x => String(x).toLowerCase());
        if (names.some(n => n.includes(q))) byName.push([pid, p]);
        else if (
            String(p.tm || '')
                .toLowerCase()
                .includes(q)
        )
            byTeam.push([pid, p]); // 대학으로 찾으면 소속 전원
    });
    const sort = list =>
        list.sort(
            (a, b) =>
                tierIndex(a[1].t) - tierIndex(b[1].t) ||
                (b[1].m || 0) - (a[1].m || 0) ||
                String(a[1].n).localeCompare(b[1].n, 'ko')
        );
    return [...sort(byName), ...sort(byTeam)];
}

// 상대전적과 선수 분석이 같이 쓴다. 다른 것은 선택 callback뿐이다.
function playerSuggestItemsHtml(list, pickCall) {
    return list
        .map(
            ([pid, p]) => `
        <button type="button" class="h2h-suggest-item"${pickCall(pid)}>
            ${avatarHtml(p.s || '', 'h2h-suggest-avatar')}
            <span class="h2h-suggest-name">${escapeHTML(p.n)}</span>
            ${p.en ? `<span class="h2h-suggest-alt">${escapeHTML(p.en)}</span>` : ''}
            ${p.r ? raceBadgeHtml(p.r) : ''}
            ${playerBadgesHtml({ ...p, r: '' })}
            <span class="h2h-suggest-count">${formatNum(p.m || 0)}판</span>
        </button>`
        )
        .join('');
}

function h2hSuggestHtml(slot) {
    const list = h2hSuggest(H2hState.query[slot]);
    if (!H2hState.query[slot].trim()) return '';
    if (!list.length) return '<div class="h2h-suggest"><div class="content-state">찾는 선수가 없습니다</div></div>';
    const shown = Math.min(list.length, H2hState.suggestShown);
    return `<div class="h2h-suggest"${actOn('scroll', 'h2hSuggestScroll', slot, ACT.el)}>
        <div class="h2h-suggest-head">검색 결과 ${formatNum(list.length)}명</div>
        ${playerSuggestItemsHtml(list.slice(0, shown), pid => act('h2hPick', slot, pid))}
    </div>`;
}

// 이미 그린 줄은 두고 다음 묶음만 붙인다. 전체를 다시 그리면 200줄쯤부터 스크롤이 걸린다.
function h2hSuggestScroll(slot, el) {
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
    const list = h2hSuggest(H2hState.query[slot]);
    const from = H2hState.suggestShown;
    if (from >= list.length) return;
    H2hState.suggestShown = Math.min(list.length, from + H2H_SUGGEST_STEP);
    el.insertAdjacentHTML(
        'beforeend',
        playerSuggestItemsHtml(list.slice(from, H2hState.suggestShown), pid => act('h2hPick', slot, pid))
    );
}

function h2hSlotHtml(slot) {
    const pid = H2hState.picks[slot];
    const label = slot === 0 ? 'PLAYER 1' : 'PLAYER 2';
    if (!pid) {
        return `
            <div class="h2h-slot-inner is-empty">
                <label class="h2h-slot-label" for="h2h-input-${slot}">${label}</label>
                <input type="search" class="h2h-input" id="h2h-input-${slot}" autocomplete="off"
                       placeholder="이름 또는 대학으로 검색" value="${escapeHTML(H2hState.query[slot])}"
                       ${actOn('input', 'h2hOnQuery', slot, ACT.value)}>
                ${H2hState.suggestSlot === slot ? h2hSuggestHtml(slot) : ''}
            </div>`;
    }
    const p = h2hPlayer(pid) || { n: h2hName(pid) };
    const rec = h2hRecord(h2hRowsInPeriod(pid));
    return `<div class="h2h-slot-inner"><div class="h2h-slot-label">${label}</div>
        ${playerSummaryHtml(p, rec, `<button type="button" class="h2h-card-clear" aria-label="선수 지우기"${act('h2hClear', slot)}>✕</button>`, h2hRankInfo(p))}</div>`;
}

function h2hOnQuery(slot, value) {
    H2hState.query[slot] = value;
    H2hState.suggestSlot = slot;
    H2hState.suggestShown = H2H_SUGGEST_STEP;
    const box = document.getElementById(`h2h-slot-${slot}`);
    const old = box.querySelector('.h2h-suggest');
    if (old) old.remove();
    box.querySelector('.h2h-slot-inner').insertAdjacentHTML('beforeend', h2hSuggestHtml(slot));
}

function h2hPick(slot, pid) {
    const picks = [...H2hState.picks];
    picks[slot] = pid;
    h2hSetPicks(picks, true);
    h2hSyncUrl();
    return h2hRenderSelection();
}

function h2hSetPicks(picks, userSelection = false) {
    if (!userSelection && picks.every((pid, slot) => pid === H2hState.picks[slot])) return;
    H2hState.picks = picks;
    H2hState.query = ['', ''];
    H2hState.suggestSlot = -1;
    H2hState.suggestShown = H2H_SUGGEST_STEP;
    H2hState.page = 1;
    H2hState.rivalShown = H2H_RIVAL_STEP;
    H2hState.mapShown = H2H_MAP_STEP;
}

async function h2hRenderSelection(isCurrent = tierViewRequest('h2h')) {
    renderH2hSlots();
    document.getElementById('h2h-result').innerHTML = '<div class="h2h-empty">전적을 불러오는 중</div>';
    try {
        await Promise.all(H2hState.picks.filter(Boolean).map(h2hLoadPlayer));
    } catch (e) {
        if (!isCurrent()) return;
        console.error(e);
        document.getElementById('h2h-result').innerHTML = `<div class="h2h-empty">${escapeHTML(e.message)}</div>`;
        return;
    }
    if (!isCurrent()) return;
    renderH2hSlots();
    renderH2hResult();
}

function h2hClear(slot) {
    return h2hPick(slot, null);
}

function h2hSetPeriod(period) {
    H2hState.period = period;
    H2hState.page = 1;
    H2hState.rivalShown = H2H_RIVAL_STEP;
    H2hState.mapShown = H2H_MAP_STEP;
    renderH2hPeriod();
    renderH2hSlots();
    renderH2hResult();
}

function h2hSetPage(page) {
    H2hState.page = page;
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
// 전적 페이지 '최근 전적' 표와 같은 부품을 써서 페이지마다 달라 보이지 않게 한다.
function h2hMatchRowsHtml(rows, showOpponent) {
    return rows
        .map(
            ([date, opp, win, mapId, cat]) => `
            <tr>
                ${showOpponent ? `<td class="stat-table-sticky-col cell-ellipsis"><span class="cell-clip">${escapeHTML(h2hName(String(opp)))}</span></td>` : ''}
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(h2hCatName(cat) || '-')}</span></td>
                <td class="cell-ellipsis cell-muted"><span class="cell-clip">${escapeHTML(h2hMapName(mapId) || '-')}</span></td>
                <td class="badge-cell">${resultBadgeHtml(win ? '승' : '패')}</td>
                <td>${escapeHTML(shortMatchDate(date))}</td>
            </tr>`
        )
        .join('');
}

// 분석과 상대전적이 같이 쓴다. 요약·맵 통계에는 적용하지 않는다.
function h2hFilterRowsByCategory(rows, label) {
    if (!H2H_CAT_LABELS.includes(label)) return rows;
    const idx = ((H2hState.index && H2hState.index.cats) || []).indexOf(label);
    return rows.filter(r => r[4] === idx);
}

function matchCategoryFilterHtml(activeLabel, handler) {
    return ['전체', ...H2H_CAT_LABELS]
        .map(
            label => `
        <button type="button" class="filter-item${activeLabel === label ? ' active' : ''}"
            aria-pressed="${activeLabel === label}"${act(handler, label)}>${escapeHTML(label)}</button>`
        )
        .join('');
}

function h2hSetFilter(label) {
    H2hState.matchFilter = label;
    H2hState.page = 1;
    renderH2hResult();
}

function h2hMatchesHtml(rows, showOpponent) {
    const filtered = h2hFilterRowsByCategory(rows, H2hState.matchFilter);
    H2hState.page = Math.min(Math.max(1, H2hState.page), Math.max(1, Math.ceil(filtered.length / H2H_LIST_STEP)));
    const chips = matchCategoryFilterHtml(H2hState.matchFilter, 'h2hSetFilter');
    return `<div class="section-title record-recent-header section-title-spaced" data-en="RECENT">
        <span class="record-recent-title section-title-label">최근 전적</span>
        <div class="filter-nav tab-scroll" role="group" aria-label="최근 전적 형식">${chips}</div>
    </div>${h2hTableHtml(filtered, showOpponent)}`;
}

function h2hTableHtml(rows, showOpponent) {
    const shown = rows.slice((H2hState.page - 1) * H2H_LIST_STEP, H2hState.page * H2H_LIST_STEP);
    const colw = showOpponent ? 'colw-20' : 'colw-25';
    const head = (label, sticky) =>
        `<th scope="col" class="text-center ${sticky ? 'stat-table-sticky-col ' : ''}${colw}">${label}</th>`;
    return `
        <div class="clean-card p-0 overflow-hidden">
            <div class="table-responsive scroll-area">
                <table class="table mb-0 text-center stat-table table-fixed">
                    <thead>
                        <tr>
                            ${showOpponent ? head('상대', true) : ''}
                            ${head('형식', !showOpponent)}
                            ${head('맵')}
                            ${head('결과')}
                            ${head('날짜')}
                        </tr>
                    </thead>
                    <tbody>${
                        shown.length
                            ? h2hMatchRowsHtml(shown, showOpponent)
                            : emptyRowHtml(showOpponent ? 5 : 4, '이 형식의 경기가 없습니다')
                    }</tbody>
                </table>
            </div>
        </div>
        ${matchPaginationHtml(rows.length, H2hState.page, H2H_LIST_STEP, 'h2hSetPage')}`;
}

function h2hMapTableHtml(rows) {
    const byMap = new Map();
    rows.forEach(r => {
        const key = String(r[3]);
        if (!byMap.has(key)) byMap.set(key, [0, 0]);
        byMap.get(key)[r[2] ? 0 : 1] += 1;
    });
    const all = [...byMap.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = all.slice(0, H2hState.mapShown);
    return `
        <div class="h2h-maps">
            ${list
                .map(
                    ([mapId, [win, lose]]) => `
                <div class="h2h-map">
                    <span class="h2h-map-name">${escapeHTML(h2hMapName(mapId) || '맵 정보 없음')}</span>
                    <span class="h2h-map-rec">${winLoseText(win, lose)}<span class="h2h-rate-sub"> · ${h2hRateText(win, lose)}</span></span>
                    <span class="h2h-map-bar"><span style="width:${win + lose ? (win / (win + lose)) * 100 : 0}%"></span></span>
                </div>`
                )
                .join('')}
        </div>
        ${
            all.length > list.length
                ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" data-click="h2hShowMoreMaps">더 보기 ${chevronDownSvg(9)}</button>
        </div>`
                : ''
        }`;
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
                <div class="h2h-score-total">${formatNum(total)}전</div>
            </div>
            <div class="h2h-score-side">
                <div class="h2h-score-name">${escapeHTML(b)}</div>
                <div class="h2h-score-num is-b">${winB}</div>
            </div>
        </div>`;
}

// targetSlot은 빈 칸이다. PLAYER 2만 골랐으면 상대가 PLAYER 1로 들어가야 맞대결이 된다.
function h2hTopOpponentsHtml(rows, targetSlot) {
    const byOpp = new Map();
    rows.forEach(r => {
        const key = String(r[1]);
        if (!byOpp.has(key)) byOpp.set(key, [0, 0]);
        byOpp.get(key)[r[2] ? 0 : 1] += 1;
    });
    const all = [...byOpp.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]));
    if (!all.length) return '';
    const list = all.slice(0, H2hState.rivalShown);
    return `
        <div class="section-title" data-en="RIVALS"><span class="section-title-label">자주 만난 상대</span>
            <span class="title-count">${formatNum(all.length)}명</span></div>
        <div class="h2h-rivals">
            ${list.map(([pid, [win, lose]]) => h2hRivalCardHtml(pid, win, lose, act('h2hPick', targetSlot, pid), !h2hPlayer(pid))).join('')}
        </div>
        ${
            all.length > list.length
                ? `
        <div class="news-load-more-wrap h2h-more-wrap">
            <button type="button" class="news-load-more" data-click="h2hShowMoreRivals">더 보기 ${chevronDownSvg(9)}</button>
        </div>`
                : ''
        }`;
}

function h2hRivalCardHtml(pid, win, lose, action, disabled) {
    const known = h2hPlayer(pid);
    const total = win + lose;
    const pct = total ? (win / total) * 100 : 0;
    return `
        <button type="button" class="h2h-rival"${disabled ? ' disabled' : action}>
            ${avatarHtml(known ? known.s || '' : '', 'h2h-rival-avatar')}
            <span class="h2h-rival-name">${escapeHTML(h2hName(pid))}</span>
            <span class="h2h-rival-rec">${winLoseText(win, lose)}<span class="h2h-rate-sub"> · ${h2hRateText(win, lose)}</span></span>
            <span class="h2h-rival-bar"><span style="width:${pct}%"></span></span>
        </button>`;
}

function renderH2hResult() {
    const box = document.getElementById('h2h-result');
    if (!box) return;
    const [a, b] = H2hState.picks;
    if (!a && !b) {
        box.innerHTML = `
            <div class="h2h-empty">
                <span class="h2h-empty-title">선수를 검색해주세요</span>
                <span class="h2h-empty-sub">이름 · 대학으로 검색</span>
            </div>`;
        return;
    }
    if (!a || !b) {
        const pid = a || b;
        const targetSlot = a ? 1 : 0;
        const rows = h2hRowsInPeriod(pid);
        if (!rows.length) {
            box.innerHTML = '<div class="h2h-empty">이 기간에 경기가 없습니다</div>';
            return;
        }
        box.innerHTML = `
            ${h2hTopOpponentsHtml(rows, targetSlot)}
            <div class="section-title section-title-spaced" data-en="BY MAP"><span class="section-title-label">맵별 전적</span></div>
            ${h2hMapTableHtml(rows)}
            ${h2hMatchesHtml(rows, true)}`;
        return;
    }
    const rows = h2hRowsInPeriod(a).filter(r => String(r[1]) === String(b));
    const rec = h2hRecord(rows);
    box.innerHTML = `
        ${h2hScoreHtml(h2hName(a), h2hName(b), rec.win, rec.lose)}
        ${
            rows.length
                ? `
            <div class="section-title section-title-spaced" data-en="BY MAP"><span class="section-title-label">맵별 전적</span>
                <span class="title-count">${escapeHTML(h2hName(a))} 기준</span></div>
            ${h2hMapTableHtml(rows)}
            ${h2hMatchesHtml(rows, false)}`
                : '<div class="h2h-empty h2h-empty-spaced">이 기간에 맞대결이 없습니다. 기간을 넓혀보세요</div>'
        }`;
}

function renderH2hPeriod() {
    const bar = document.getElementById('h2h-period');
    if (!bar) return;
    bar.innerHTML = H2H_PERIODS.map(
        ([key, label]) => `
        <button type="button" class="filter-item${H2hState.period === key ? ' active' : ''}"
                aria-pressed="${H2hState.period === key}"${act('h2hSetPeriod', key)}>${label}</button>`
    ).join('');
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
async function h2hEnter(params = new URLSearchParams(location.search)) {
    const isCurrent = tierViewRequest('h2h');
    const wanted = params ? [params.get('p1'), params.get('p2')] : [...H2hState.picks];
    renderH2hPeriod();
    renderH2hSlots();
    const resultBox = document.getElementById('h2h-result');
    if (resultBox) resultBox.innerHTML = '<div class="h2h-empty">전적 데이터를 불러오는 중</div>';

    try {
        await h2hLoadIndex();
    } catch (e) {
        if (!isCurrent()) return;
        console.error('상대전적 데이터를 불러오지 못했습니다:', e);
        if (resultBox) {
            resultBox.innerHTML = `<div class="h2h-empty">전적 데이터를 불러오지 못했습니다<br><small>${escapeHTML(e.message || String(e))}</small><br><button type="button" class="news-load-more" data-click="h2hEnter">다시 시도</button></div>`;
        }
        return;
    }
    if (!isCurrent()) return;
    h2hSetPicks(wanted.map(pid => (pid && h2hPlayer(pid) ? pid : null)));
    if (!Object.keys(H2hState.index.players || {}).length) {
        // 아카이브를 아직 한 번도 모으지 않은 상태
        document.getElementById('h2h-result').innerHTML =
            '<div class="h2h-empty">전적 아카이브를 아직 모으는 중입니다. 조금 뒤에 다시 열어주세요</div>';
        return;
    }
    const updated = document.getElementById('h2h-updated');
    if (updated && H2hState.index.syncedAt) {
        updated.textContent = `${String(H2hState.index.syncedAt).slice(0, 10).replace(/-/g, '.')} 기준`;
    }
    await h2hRenderSelection(isCurrent);
}

document.addEventListener('click', e => {
    if (H2hState.suggestSlot < 0) return;
    if (e.target.closest && e.target.closest('.h2h-slot-inner')) return;
    H2hState.suggestSlot = -1;
    renderH2hSlots();
});
