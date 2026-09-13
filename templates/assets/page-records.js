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
        document.getElementById(`t-sum-${fmt}-w`).innerHTML = `<span class="wl-win">${w}</span>승 <span class="wl-lose">${l}</span>패`;
        const rateEl = document.getElementById(`t-sum-${fmt}-r`);
        rateEl.innerText = getRateText(w, l);
        rateEl.style.color = ringColor;
        document.getElementById(`t-sum-${fmt}-donut`).style.background = donutBackground(ringColor, rate);
    });
    renderTeamMatchesList('team-recent-list', {format: '전체'}, 10);
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
        const winnerCls = 'fw-bold text-primary', otherCls = 'text-dark';

        return `
                    <tr class="stat-row">
                        <td class="colw-18-8 set-detail-label">${escapeHTML(r['세트']) || ''} ${escapeHTML(r['라운드']) || ''}</td>
                        <td class="colw-18-8 ${isWin ? winnerCls : otherCls}">${escapeHTML(r['우리 선수'])||'-'}</td>
                        <td class="colw-18-8">${resBadge}</td>
                        <td class="colw-18-8 ${(!isWin && !isDraw) ? winnerCls : otherCls}">${escapeHTML(r['상대 선수'])||'-'}</td>
                        <td class="colw-18-8 set-detail-map">${escapeHTML(r['맵']) || '-'}</td>
                        <td class="colw-6"></td>
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
                <td><span class="m-arrow">${chevronDownSvg(9)}</span></td>
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

function renderTeamMatchesList(containerId, filters, limit) {
    filters = filters || {};
    const format = filters.format || '전체';
    const opponent = filters.opponent || null;

    let filtered = format === '전체' ? SiteData.matches : SiteData.matches.filter(m => m['형식'] === format);
    if (opponent) filtered = filtered.filter(m => m['상대팀'] === opponent);
    const sliced = limit ? filtered.slice(0, limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length
        ? sliced.map((m, idx) => teamMatchRowHtml(m, `collapse-${containerId}-${idx}`)).join('')
        : EMPTY_MATCH_ROW_HTML;
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
    const html = [avatarSelectAllItemHtml('side-btn-summary', 'showIndivSummary()')];
    const formerHtml = [];
    SiteData.members.forEach(m => {
        const item = avatarSelectItemHtml('side-player-', m['이름'], m['SOOP ID'], 'selectPlayer');
        (isActiveMember(m) ? html : formerHtml).push(item);
    });

    html.push(`<div class="avatar-select-item avatar-select-toggle" id="indiv-toggle-former" role="button" tabindex="0" onclick="toggleFormerMembers()">
                        <div class="avatar-select-fallback">
                            ${chevronDownSvg(10, ' id="indiv-toggle-chevron" class="chevron-rotatable"')}
                        </div>
                        <span class="avatar-select-name">이전 멤버</span>
                   </div>`);
    html.push(`<span id="indiv-former-wrap" class="d-none">${formerHtml.join('')}</span>`);

    document.getElementById('indiv-avatar-list').innerHTML = html.join('');
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

    document.getElementById('indiv-summary-tbody').innerHTML = SiteData.members.filter(isActiveMember).map(m => {
        const pStat = findPlayerStats(m['이름']);
        const name = m['이름'];
        return `<tr class="stat-row clickable-row" role="button" tabindex="0" onclick="selectPlayer('${jsAttr(name)}')">
                <td class="fw-bold text-dark text-center stat-table-sticky-col text-nowrap colw-20"><span class="d-flex align-items-center justify-content-center gap-2">${avatarHtml(m['SOOP ID'], 'player-avatar-sm')}<span class="ellipsis-text">${escapeHTML(name)}</span></span></td>
                ${FORMAT_KEYS.map(fmt => `<td class="text-nowrap colw-20">${escapeHTML(pStat[`${fmt} 전적`]) || '-'}</td>`).join('\n                ')}
            </tr>`;
    }).join('');
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
    RecordsState.player = name;
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
    applyBadge(document.getElementById('p-race'), raceShortLabel(pDb['종족']), 'tag-badge' + raceBadgeClass(pDb['종족']));
    document.getElementById('p-avatar').innerHTML = profileAvatarInnerHtml(pDb['SOOP ID']);

    INDIV_DONUTS.forEach(([suffix, key, color]) => {
        updateDonut(`d-${suffix}`, `dt-${suffix}`, `dw-${suffix}`, parseStat(pStat[key]), color);
    });

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
    syncIndivFilterUI();
    renderIndivMatchesList('indiv-recent-list', format, 10);
}

function renderIndivMatchesList(containerId, format, limit) {
    let filtered = SiteData.rounds.filter(m => m['우리 선수'] === RecordsState.player);
    if (format !== '전체') filtered = filtered.filter(m => m['형식'] === format);
    const sliced = limit ? filtered.slice(0, limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length ? sliced.map(m => `
            <tr class="stat-row">
                <td class="stat-table-sticky-col cell-ellipsis">${escapeHTML(m['상대 선수']) || '-'}</td>
                <td class="cell-ellipsis">
                    ${teamCellInnerHtml(m['상대팀'])}
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${escapeHTML(m['맵']) || '-'}</td>
                <td class="badge-cell">${resultBadgeHtml(m['결과'] || '')}</td>
                <td>${escapeHTML(shortMatchDate(m['날짜']))}</td>
            </tr>
            `).join('') : EMPTY_MATCH_ROW_HTML;
}

function openIndivMatchModal() {
    const { player, indivFilter } = RecordsState;
    document.getElementById('indivModalTitle').innerText = indivFilter === '전체' ? `${player} 개인 전체 전적` : `${player} 전체 전적 (${indivFilter})`;
    renderIndivMatchesList('indiv-modal-list', indivFilter, null);
    showModal('indivMatchesModal');
}

bootPage(() => {
    safeInit('팀 요약 통계', calculateTeamSummaries);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const view = params.get('view') === 'solo' ? 'individual' : 'team';
        switchStatView(view);
        const member = params.get('member');
        if (view === 'individual' && member) selectPlayer(member);
    }));
});
