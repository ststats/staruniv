/**
 * 전적 페이지: 팀(요약/상대 전적/최근 전적) + 개인(멤버별 통계/최근 전적). (core.js → 이 파일)
 * URL: /records/ (팀), /records/?view=solo[&member=이름] (개인)
 */

// 팀 매치 → 세트(라운드) 목록 조회 인덱스.
// 예전엔 매치 한 줄을 그릴 때마다 전체 라운드를 filter해서 O(매치 수 × 라운드 수)였다.
// 라운드를 한 번만 훑어 묶음으로 나눠두고 매치마다 그 묶음만 본다.
//   - 1순위: _match_key(시트의 매치 번호로 만들어진 키. match_link.py 참고)로 바로 찾는다.
//     번호로 연결된 경기는 날짜나 상대팀을 잘못 적어도 정확히 붙는다.
//   - 2순위: 번호가 없는 과거 데이터를 위해 (날짜, 상대팀) 묶음으로 대체한다.
//   - 내전 미러 라운드(_mirrored)는 개인 통계 전용이라 세트 상세에서는 뺀다.
let _roundIndex = { source: null, byMatchKey: new Map(), byDateTeam: new Map() };

// (===와 똑같이 구분되도록: 숫자 2024와 문자열 "2024", undefined와 null을 서로 다른 키로 만든다)
const _keyPart = v => (v === undefined ? 'u' : 'v' + JSON.stringify(v));
const dateTeamKey = (date, team) => _keyPart(date) + '|' + _keyPart(team);

function buildRoundIndex() {
    const byMatchKey = new Map(), byDateTeam = new Map();
    SiteData.rounds.forEach(r => {
        if (r['_mirrored']) return;
        const push = (map, key) => {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(r);
        };
        if (r['_match_key']) push(byMatchKey, r['_match_key']);
        push(byDateTeam, dateTeamKey(r['날짜'], r['상대팀']));
    });
    _roundIndex = { source: SiteData.rounds, byMatchKey, byDateTeam };
}

function roundsForMatch(m) {
    if (_roundIndex.source !== SiteData.rounds) buildRoundIndex();

    const key = m['_match_key'];
    if (key && _roundIndex.byMatchKey.has(key)) return _roundIndex.byMatchKey.get(key);

    // 매치 번호가 없던 시절 데이터: 날짜+상대팀으로 묶고, 키가 있는 라운드는 키까지 맞는 것만 고른다.
    const group = _roundIndex.byDateTeam.get(dateTeamKey(m['날짜'], m['상대팀'])) || [];
    if (!key) return group;
    return group.filter(r => !r['_match_key'] || r['_match_key'] === key);
}

const RecordsState = {
    player: '',          // 개인 전적에서 선택된 멤버 이름('' = 전체 요약)
    indivFilter: '전체', // 개인 최근 전적 형식 필터
};

const RECORD_TABS = { team: ['tab-team', 'view-team-stat'], individual: ['tab-individual', 'view-indiv-stat'] };

const FORMAT_KEYS = ['대회', '대학', '미니', 'CK'];

function updateStatsHash() {
    const params = {};
    if (isTabActive('tab-individual')) {
        params.view = 'solo';
        if (RecordsState.player) params.member = RecordsState.player;
    }
    PageState.update(params);
}

function switchStatView(viewType) {
    activateTabView(RECORD_TABS, viewType);
    if (viewType === 'individual') {
        renderIndividualSidebar();
        showIndivSummary();
        safeInit('사이드바 방송 상태', refreshSidebarLiveIndicators);
    }
    updateStatsHash();
}

function parseStat(statStr) {
    if (!statStr || statStr === "-") return { wins: 0, losses: 0, rate: 0, text: "-" };
    const match = String(statStr).match(/(\d+)승 (\d+)패/);
    if (match) {
        const w = parseInt(match[1], 10), l = parseInt(match[2], 10);
        return { wins: w, losses: l, rate: (w+l) > 0 ? (w/(w+l)*100) : 0, text: `${w}승 ${l}패` };
    }
    return { wins: 0, losses: 0, rate: 0, text: "-" };
}

function getRateText(w, l) { return (w+l) > 0 ? (w/(w+l)*100).toFixed(1) + "%" : "-"; }

// 50% 기준으로 승(파랑)/패(빨강) 색을 정한다.
const rateColor = rate => (rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)');

const donutBackground = (color, rate) => `conic-gradient(${color} ${rate}%, var(--color-donut-track) 0)`;

function updateDonut(elId, txtId, subId, stat, color) {
    const txtEl = document.getElementById(txtId);
    txtEl.innerText = stat.text === "-" ? "-" : stat.rate.toFixed(1) + "%";
    document.getElementById(subId).innerText = stat.text;
    // color === 'byRate'면 50% 기준으로 승(파랑)/패(빨강) 색을 자동으로 정한다.
    const ringColor = color === 'byRate' ? rateColor(stat.rate) : color;
    document.getElementById(elId).style.background = donutBackground(ringColor, stat.rate);
    if (color === 'byRate') txtEl.style.color = ringColor;
}

function calculateTeamSummaries() {
    const tStats = {};
    FORMAT_KEYS.forEach(fmt => { tStats[fmt] = { w: 0, l: 0 }; });
    SiteData.matches.forEach(m => {
        const bucket = tStats[m['형식']];
        if (!bucket || !m['최종 결과']) return;
        if (m['최종 결과'] === '승') bucket.w++;
        if (m['최종 결과'] === '패') bucket.l++;
    });
    FORMAT_KEYS.forEach(fmt => {
        const { w, l } = tStats[fmt];
        const rate = (w + l) > 0 ? (w / (w + l) * 100) : 0;
        const ringColor = rateColor(rate);
        // [리디자인] 승패를 비율 바로 보여준다. 폭을 실제 비율로 주고 숫자를 바 안에 넣는다
        // ('승'/'패' 글자를 바 밖에 두면 바 배경이 없어 흰 글자가 보이지 않는다).
        // 읽어주는 프로그램과 마우스오버용으로 원래 문구는 title/aria-label에 남긴다.
        const wlBox = document.getElementById(`t-sum-${fmt}-w`);
        const wlTotal = w + l;
        const wlText = document.getElementById(`t-sum-${fmt}-t`);
        if (wlText) {
            // 시안에서 승 수만 흰색이고 패 수는 회색이었다 - 이겼다는 쪽에 무게를 준다.
            wlText.innerHTML = wlTotal === 0
                ? '<small>기록 없음</small>'
                : `${w}<small>승</small> <i>${l}<small>패</small></i>`;
        }
        wlBox.setAttribute('title', `${w}승 ${l}패`);
        wlBox.setAttribute('aria-label', `${w}승 ${l}패`);
        wlBox.innerHTML = wlTotal === 0
            ? '<span class="wl-none">기록 없음</span>'
            : (w ? `<span class="wl-win" style="width:${(w / wlTotal * 100).toFixed(1)}%">${w}</span>` : '')
            + (l ? `<span class="wl-lose" style="width:${(l / wlTotal * 100).toFixed(1)}%">${l}</span>` : '');
        const rateEl = document.getElementById(`t-sum-${fmt}-r`);
        rateEl.innerText = getRateText(w, l);
        rateEl.style.color = ringColor;
        document.getElementById(`t-sum-${fmt}-donut`).style.background = donutBackground(ringColor, rate);
    });
    renderTeamMatchesList('team-recent-list', {format: '전체'}, 10, 'team-recent-pagination');
}

// 팀 매치 한 경기의 세트별 상세 행들
function teamSetDetailsHtml(m) {
    const teamRounds = roundsForMatch(m);
    if (teamRounds.length === 0) {
        return emptyRowHtml(6, '상세 세트 기록이 없습니다.', 'py-2 fs-body');
    }
    return teamRounds.map(r => {
        const isWin = r['결과'] === '승';
        const isDraw = r['결과'] === '무' || r['결과'] === '무승부';
        let resBadge = '<span class="text-danger fw-bold">패</span>';
        if (isWin) resBadge = '<span class="text-primary fw-bold">승</span>';
        if (isDraw) resBadge = '<span class="text-secondary fw-bold">무</span>';
        const winnerCls = 'fw-bold text-primary', otherCls = 'text-body';

        return `
                    <tr class="stat-row">
                        <td class="colw-18-8 set-detail-label">${escapeHTML(r['세트']) || ''} ${escapeHTML(r['라운드']) || ''}</td>
                        <td class="colw-18-8 ${isWin ? winnerCls : otherCls}">${escapeHTML(r['우리 선수'])||'-'}</td>
                        <td class="colw-18-8">${resBadge}</td>
                        <td class="colw-18-8 ${(!isWin && !isDraw) ? winnerCls : otherCls}">${escapeHTML(r['상대 선수'])||'-'}</td>
                        <td class="colw-18-8 set-detail-map">${escapeHTML(r['맵']) || '-'}</td>
                        <td class="colw-6 col-arrow"></td>
                    </tr>`;
    }).join('');
}

function teamMatchRowHtml(m, collapseId) {
    const resText = m['최종 결과'] || m['최근 결과'] || '';
    return `
            <tr class="match-row stat-row" role="button" tabindex="0" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <td class="stat-table-sticky-col cell-ellipsis">
                    ${teamCellInnerHtml(m['상대팀'])}
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${escapeHTML(m['세트 결과']) || '-'}</td>
                <td class="badge-cell">${resultBadgeHtml(resText)}</td>
                <td>${escapeHTML(shortMatchDate(m['날짜']))}</td>
                <td class="col-arrow"><span class="m-arrow">${chevronDownSvg(9)}</span></td>
            </tr>
            <tr>
                <td colspan="6" class="set-detail-host">
                    <div class="collapse" id="${collapseId}">
                        <div class="set-detail-panel">
                            <table class="table table-borderless mb-0 text-center set-detail-table">
                                <tbody>${teamSetDetailsHtml(m)}</tbody>
                            </table>
                        </div>
                    </div>
                </td>
            </tr>
            `;
}

// paginationId를 주면 그 자리에 페이지 넘김을 그리고 limit개씩 끊어 보여준다.
// 모달(팀 전체/상대별 전적)은 목록을 통째로 보여주므로 limit도 paginationId도 안 넘긴다.
function renderTeamMatchesList(containerId, filters, limit, paginationId) {
    filters = filters || {};
    const format = filters.format || '전체';
    const opponent = filters.opponent || null;

    let filtered = format === '전체' ? SiteData.matches : SiteData.matches.filter(m => m['형식'] === format);
    if (opponent) filtered = filtered.filter(m => m['상대팀'] === opponent);

    const page = paginationId ? (RecordsState.teamPage || 1) : 1;
    const sliced = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length
        ? sliced.map((m, idx) => teamMatchRowHtml(m, `collapse-${containerId}-${idx}`)).join('')
        : EMPTY_MATCH_ROW_HTML;
    if (paginationId) {
        document.getElementById(paginationId).innerHTML =
            matchPaginationHtml(filtered.length, page, limit, 'setTeamPage');
    }
}

function setTeamPage(page) {
    RecordsState.teamPage = page;
    renderTeamMatchesList('team-recent-list', { format: '전체' }, 10, 'team-recent-pagination');
}

function openTeamMatchModal(format) {
    document.getElementById('teamModalTitle').innerText = format === '전체' ? '팀 전체 전적' : `팀 ${format} 전적`;
    renderTeamMatchesList('team-modal-list', {format}, null);
    showModal('teamMatchesModal');
}

function openTeamOpponentModal(opponent) {
    document.getElementById('teamModalTitle').innerHTML = `${teamLogoHtml(opponent, 20)} vs ${escapeHTML(opponent)} 전체 전적`;
    renderTeamMatchesList('team-modal-list', {format: '전체', opponent}, null);
    showModal('teamMatchesModal');
}

// 상대 전적 표(서버에서 구운 행)는 행마다 onclick을 달지 않고 한 곳에서 위임 처리한다.
document.addEventListener('click', function(e) {
    const row = e.target.closest('.team-row-clickable');
    if (row) openTeamOpponentModal(row.dataset.team);
});

function renderIndividualSidebar() {
    // '전체'는 목록이 아니라 바의 고정 칸으로 들어간다(renderAvatarBar가 자리를 만든다).
    const html = [];
    const formerHtml = [];
    SiteData.members.forEach(m => {
        const item = avatarSelectItemHtml('side-player-', m['이름'], m['SOOP ID'], 'selectPlayer', m);
        (isActiveMember(m) ? html : formerHtml).push(item);
    });

    html.push(`<div class="avatar-select-item avatar-select-toggle" id="indiv-toggle-former" role="button" tabindex="0" onclick="toggleFormerMembers()">
                        <div class="avatar-select-fallback">
                            ${chevronDownSvg(10, ' id="indiv-toggle-chevron" class="chevron-rotatable"')}
                        </div>
                        <span class="avatar-select-name">이전 멤버</span>
                   </div>`);
    html.push(`<span id="indiv-former-wrap" class="d-none">${formerHtml.join('')}</span>`);

    renderAvatarBar('indiv-avatar-list',
        avatarSelectAllItemHtml('side-btn-summary', 'showIndivSummary()', `${SiteData.members.filter(isActiveMember).length}`),
        html.join(''));
}


function toggleFormerMembers() {
    toggleCollapsible('indiv-former-wrap', 'indiv-toggle-chevron');
}

function showIndivSummary() {
    RecordsState.player = '';
    setVisible(document.getElementById('statContent'), false);
    setVisible(document.getElementById('indiv-summary-content'), true);
    document.getElementById('indiv-content-title').innerText = '전체 전적';
    setActiveAvatarItem('indiv-avatar-list', document.getElementById('side-btn-summary'));

    setVisible(document.getElementById('indiv-summary-filters'), true);
    renderIndivSummaryTable();
    updateStatsHash();
}

// 개인 전적 프로필 도넛: [도넛 id 접미사, 통계 키, 색상]
const INDIV_DONUTS = [
    ['fmt-1', '대회 전적', 'byRate'],
    ['fmt-2', '대학 전적', 'byRate'],
    ['fmt-3', '미니 전적', 'byRate'],
    ['race-t', '테란전 전적', 'var(--color-race-t)'],
    ['race-z', '저그전 전적', 'var(--color-race-z)'],
    ['race-p', '프로토스전 전적', 'var(--color-race-p)'],
];

function selectPlayer(name) {
    setVisible(document.getElementById('indiv-summary-filters'), false);
    RecordsState.player = name;
    RecordsState.indivPage = 1;
    setVisible(document.getElementById('indiv-summary-content'), false);
    setVisible(document.getElementById('statContent'), true);
    document.getElementById('indiv-content-title').innerText = `${name}의 전적`;

    const sideItem = document.getElementById(`side-player-${name}`);
    setActiveAvatarItem('indiv-avatar-list', sideItem);
    // 이전 멤버가 접혀있는 상태에서 그 사람이 선택되면 자동으로 펼쳐준다
    const formerWrap = document.getElementById('indiv-former-wrap');
    if (sideItem && formerWrap && formerWrap.contains(sideItem) && !isVisible(formerWrap)) {
        toggleFormerMembers();
    }

    const pStat = findPlayerStats(name);
    const pDb = findMemberByName(name) || {};

    document.getElementById('p-name').innerText = name;
    applyBadge(document.getElementById('p-tier'), tierLabel(pDb['티어']), 'tag-badge tier-badge');
    // 상대전적·분석 카드의 티어랭킹 자리. 이 페이지는 랭킹을 따지지 않으므로 멤버 프로필
    // 팝업과 같은 활동기간을 대신 넣는다.
    const periodEl = document.getElementById('p-period');
    periodEl.className = 'tag-badge rank-badge';
    periodEl.innerHTML = memberPeriodBadgeHtml(pDb);
    applyBadge(document.getElementById('p-race'), raceShortLabel(pDb['종족']), 'tag-badge' + raceBadgeClass(pDb['종족']));
    document.getElementById('p-avatar').innerHTML = profileAvatarInnerHtml(pDb['SOOP ID']);

    INDIV_DONUTS.forEach(([suffix, key, color]) => {
        updateDonut(`d-${suffix}`, `dt-${suffix}`, `dw-${suffix}`, parseStat(pStat[key]), color);
    });

    // [리디자인] 머리 카드 오른쪽의 합계 - 대회 + 대학만 센다.
    // 미니·CK까지 한 숫자로 묶으면 "이 선수가 대회에서 얼마나 하는지"가 미니 경기 수에
    // 묻혀버린다(미니가 경기 수가 훨씬 많다).
    const official = ['대회 전적', '대학 전적'].reduce((acc, key) => {
        const st = parseStat(pStat[key]);
        return { wins: acc.wins + st.wins, losses: acc.losses + st.losses };
    }, { wins: 0, losses: 0 });
    const officialTotal = official.wins + official.losses;
    document.getElementById('p-total-label').innerText =
        `대학 · 대회 총 전적 ${officialTotal.toLocaleString('ko-KR')}전`;
    document.getElementById('p-total-wl').innerHTML = officialTotal
        ? `${official.wins}<small>승</small> ${official.losses}<small>패</small>`
        : '<small>기록 없음</small>';
    document.getElementById('p-total-rate').innerText =
        officialTotal ? (official.wins / officialTotal * 100).toFixed(1) + '%' : '-';

    renderIndivMatchesList('indiv-recent-list', RecordsState.indivFilter, 10);
    updateStatsHash();
}

// 필터 칩의 활성 표시를 현재 필터 값에 맞춘다.
function syncIndivFilterUI() {
    staticAll('#indiv-filters .filter-item').forEach(el => {
        el.classList.toggle('active', el.textContent.trim() === RecordsState.indivFilter);
    });
}

function setIndivFilter(format) {
    RecordsState.indivFilter = format;
    RecordsState.indivPage = 1;
    syncIndivFilterUI();
    renderIndivMatchesList('indiv-recent-list', format, 10);
}

// 좁은 화면에서는 '상대 팀' 칸을 숨기고(style.css의 .col-oppteam) 상대 선수 이름 밑
// 작은 줄(.cell-subline)로 같은 정보를 보여준다 - 6칸을 5칸으로 줄여 한 화면에 넣는다.
function setIndivPage(page) {
    RecordsState.indivPage = page;
    renderIndivMatchesList('indiv-recent-list', RecordsState.indivFilter, 10);
}
function renderIndivMatchesList(containerId, format, limit) {
    let filtered = SiteData.rounds.filter(m => m['우리 선수'] === RecordsState.player);
    if (format !== '전체') filtered = filtered.filter(m => m['형식'] === format);
    const page = RecordsState.indivPage || 1;
    const sliced = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;
    if (containerId === 'indiv-recent-list') document.getElementById('indiv-pagination').innerHTML = matchPaginationHtml(filtered.length, page, limit || 10, 'setIndivPage');

    document.getElementById(containerId).innerHTML = sliced.length ? sliced.map(m => `
            <tr class="stat-row">
                <td class="stat-table-sticky-col">
                    <span class="cell-clip">${escapeHTML(m['상대 선수']) || '-'}</span>
                    <span class="cell-subline">${teamCellInnerHtml(m['상대팀'])}</span>
                </td>
                <td class="cell-ellipsis col-oppteam">
                    ${teamCellInnerHtml(m['상대팀'])}
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td class="cell-ellipsis cell-muted"><span class="cell-clip">${escapeHTML(m['맵']) || '-'}</span></td>
                <td class="badge-cell">${resultBadgeHtml(m['결과'] || '')}</td>
                <td>${escapeHTML(shortMatchDate(m['날짜']))}</td>
            </tr>
            `).join('') : EMPTY_MATCH_ROW_HTML;
}


// "3승 1패 (75.0%)" 한 칸. 넓은 화면은 지금까지와 똑같이 그 문장 그대로,
// 상대 전적 · 개인 전체 전적 표는 둘 다 "상대(멤버) x 형식 4개"라 칸의 절반이 비어 있었다
// (실측 47%). 한 번에 형식 하나만 보여주고 제목줄의 칩으로 바꾸면 빈 칸이 사라지고,
// 남는 폭으로 승률 막대를 넣을 수 있다. 칩은 최근 전적 필터와 같은 부품(.filter-nav)이다.
const SUMMARY_FORMATS = ['합계', ...FORMAT_KEYS];

// 형식 칩 한 줄. 지금 고른 것만 active.
function summaryFilterHtml(current, handler) {
    return SUMMARY_FORMATS.map(f => `
        <div class="filter-item${f === current ? ' active' : ''}" role="tab" tabindex="0"
             aria-selected="${f === current}" onclick="${handler}('${jsAttr(f)}')">${escapeHTML(f)}</div>`).join('');
}

// 승률 막대. 표 칸에 들어가는 얇은 띠라 맵별 전적 막대와 같은 모양을 쓴다.
function wlBarHtml(wins, losses) {
    const total = wins + losses;
    if (!total) return '';
    return `<span class="wl-mini-bar"><span style="width:${(wins / total * 100).toFixed(1)}%"></span></span>`;
}

// 고른 형식의 전적. '합계'면 네 형식을 다 더한다.
function statFor(getText, format) {
    if (format !== '합계') return parseStat(getText(format));
    return FORMAT_KEYS.reduce((acc, f) => {
        const st = parseStat(getText(f));
        return { wins: acc.wins + st.wins, losses: acc.losses + st.losses };
    }, { wins: 0, losses: 0 });
}

function summaryCellsHtml(stat) {
    if (!stat.wins && !stat.losses) {
        return `<td class="text-nowrap colw-25"><span class="wl-empty" aria-hidden="true">—</span></td><td class="wl-bar-col"></td>`;
    }
    const text = `${stat.wins}승 ${stat.losses}패`;
    return `<td class="text-nowrap colw-25" title="${text} (${getRateText(stat.wins, stat.losses)})">`
        + `<span class="wl-short-num">${winLoseText(stat.wins, stat.losses, 'wl-w', 'wl-l')}</span>`
        + `<span class="wl-short-rate">${getRateText(stat.wins, stat.losses)}</span></td>`
        + `<td class="wl-bar-col">${wlBarHtml(stat.wins, stat.losses)}</td>`;
}

// ----- 팀: 상대 전적 -----
// 표는 build_html.py가 5칸으로 구워 둔다(JS가 죽어도 숫자가 남게). 여기서 그 숫자를
// 한 번 읽어 두고, 이후로는 고른 형식만 3칸으로 다시 그린다.
function readOpponentRows() {
    if (RecordsState.oppRows) return RecordsState.oppRows;
    RecordsState.oppRows = [...document.querySelectorAll('#view-team-stat tbody tr.team-row-clickable')]
        .map(tr => {
            const td = [...tr.querySelectorAll('td')];
            return {
                team: tr.dataset.team || '',
                stats: Object.fromEntries(FORMAT_KEYS.map((f, i) => [f, (td[i + 1] || {}).textContent || ''])),
            };
        });
    return RecordsState.oppRows;
}

function setTeamOppFormat(format) {
    RecordsState.oppFormat = format;
    renderOpponentTable();
}

function renderOpponentTable() {
    const table = document.querySelector('#view-team-stat .stat-table');
    if (!table) return;
    const rows = readOpponentRows();
    const format = RecordsState.oppFormat || '합계';

    document.getElementById('team-opp-filters').innerHTML =
        summaryFilterHtml(format, 'setTeamOppFormat');

    table.classList.remove('minw-520');
    table.classList.add('minw-320');
    table.querySelector('thead').innerHTML = `
        <tr>
            <th scope="col" class="text-center stat-table-sticky-col text-nowrap colw-25">상대</th>
            <th scope="col" class="text-center text-nowrap colw-25">전적</th>
            <th scope="col" class="text-center wl-bar-col" aria-label="승률"></th>
            <th scope="col" class="colw-6 col-arrow" aria-label="상세"></th>
        </tr>`;
    table.querySelector('tbody').innerHTML = rows.map(r => {
        const stat = statFor(f => r.stats[f], format);
        return `<tr class="team-row-clickable stat-row" role="button" tabindex="0" data-team="${escapeHTML(r.team)}">
            <td class="text-center stat-table-sticky-col text-nowrap colw-25">${teamCellInnerHtml(r.team)}</td>
            ${summaryCellsHtml(stat)}
            <td class="text-center colw-6 col-arrow"><span class="ext-arrow i-arrow" aria-hidden="true"></span></td>
        </tr>`;
    }).join('');
}

// ----- 개인: 전체 전적 -----
function setIndivSummaryFormat(format) {
    RecordsState.summaryFormat = format;
    renderIndivSummaryTable();
}

function renderIndivSummaryTable() {
    const body = document.getElementById('indiv-summary-tbody');
    if (!body) return;
    const format = RecordsState.summaryFormat || '합계';
    document.getElementById('indiv-summary-filters').innerHTML =
        summaryFilterHtml(format, 'setIndivSummaryFormat');

    body.innerHTML = SiteData.members.filter(isActiveMember).map(m => {
        const pStat = findPlayerStats(m['이름']);
        const name = m['이름'];
        const stat = statFor(f => pStat[`${f} 전적`], format);
        return `<tr class="stat-row clickable-row" role="button" tabindex="0" onclick="selectPlayer('${jsAttr(name)}')">
                <td class="text-center stat-table-sticky-col text-nowrap colw-25"><span class="d-flex align-items-center justify-content-center gap-2">${avatarHtml(m['SOOP ID'], 'player-avatar-sm')}<span class="ellipsis-text">${escapeHTML(name)}</span></span></td>
                ${summaryCellsHtml(stat)}
            </tr>`;
    }).join('');
}

function openIndivMatchModal() {
    const { player, indivFilter } = RecordsState;
    document.getElementById('indivModalTitle').innerText = indivFilter === '전체' ? `${player} 개인 전체 전적` : `${player} 전체 전적 (${indivFilter})`;
    renderIndivMatchesList('indiv-modal-list', indivFilter, null);
    showModal('indivMatchesModal');
}

bootPage(() => {
    safeInit('팀 요약 통계', calculateTeamSummaries);
    safeInit('상대 전적 표', renderOpponentTable);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const view = params.get('view') === 'solo' ? 'individual' : 'team';
        switchStatView(view);
        const member = params.get('member');
        if (view === 'individual' && member) selectPlayer(member);
    }));
});
