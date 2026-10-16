/**
 * 전적 페이지: 팀(요약/상대 전적/최근 전적) + 개인(멤버별 통계/최근 전적). 로드 순서: core.js → api.js → 이 파일
 * URL: /records/ (팀), /records/?view=solo[&member=이름] (개인)
 */

// 팀 매치 → 세트 목록 인덱스. 매치마다 전체 라운드를 filter하면 O(매치 × 라운드)라 한 번만 묶어 둔다.
// - _match_key(원본 매치 번호, match_link.py가 검증)로 찾으므로 날짜·상대팀 오기에도 정확히 붙는다.
// - 내전 미러 라운드(_mirrored)는 개인 통계 전용이라 뺀다.
let _roundIndex = { source: null, byMatchKey: new Map() };

function buildRoundIndex() {
    const byMatchKey = new Map();
    SiteData.rounds.forEach(r => {
        if (r['_mirrored']) return;
        const key = r['_match_key'];
        if (!byMatchKey.has(key)) byMatchKey.set(key, []);
        byMatchKey.get(key).push(r);
    });
    _roundIndex = { source: SiteData.rounds, byMatchKey };
}

function roundsForMatch(m) {
    if (_roundIndex.source !== SiteData.rounds) buildRoundIndex();

    return _roundIndex.byMatchKey.get(m['_match_key']) || [];
}

const RecordsState = {
    player: '', // '' = 전체 요약
    teamFilter: '전체',
    indivFilter: '전체',
};

const RECORD_TABS = { team: ['tab-team', 'view-team-stat'], individual: ['tab-individual', 'view-indiv-stat'] };
function recordViewFromParams(params) {
    const view = params.get('view') || runtimeDefaultSubtab('records', 'team');
    return view === 'solo' || view === 'individual' ? 'individual' : 'team';
}

const FORMAT_KEYS = ['대회', '대학', '미니', 'CK'];

function updateStatsHash() {
    const params = {};
    if (isTabActive('tab-individual')) {
        params.view = 'solo';
        if (RecordsState.player) params.member = RecordsState.player;
    } else if (runtimeDefaultSubtab('records', 'team') !== 'team') params.view = 'team';
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

function recordStat(counts) {
    const wins = counts?.wins || 0,
        losses = counts?.losses || 0;
    const total = wins + losses;
    return { wins, losses, rate: total ? (wins / total) * 100 : 0, text: total ? `${wins}승 ${losses}패` : '-' };
}

function getRateText(w, l) {
    return w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) + '%' : '-';
}

const rateColor = rate => (rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)');

const donutBackground = (color, rate) => `conic-gradient(${color} ${rate}%, var(--color-donut-track) 0)`;

function updateDonut(elId, txtId, subId, stat, color) {
    const txtEl = document.getElementById(txtId);
    txtEl.innerText = stat.text === '-' ? '-' : stat.rate.toFixed(1) + '%';
    document.getElementById(subId).innerText = stat.text;
    const ringColor = color === 'byRate' ? rateColor(stat.rate) : color;
    document.getElementById(elId).style.background = donutBackground(ringColor, stat.rate);
    if (color === 'byRate') txtEl.style.color = ringColor;
}

function calculateTeamSummaries() {
    const tStats = {};
    FORMAT_KEYS.forEach(fmt => {
        tStats[fmt] = { w: 0, l: 0 };
    });
    SiteData.matches.forEach(m => {
        const bucket = tStats[m['형식']];
        if (!bucket || !m['최종 결과']) return;
        if (m['최종 결과'] === '승') bucket.w++;
        if (m['최종 결과'] === '패') bucket.l++;
    });
    FORMAT_KEYS.forEach(fmt => {
        const { w, l } = tStats[fmt];
        const rate = w + l > 0 ? (w / (w + l)) * 100 : 0;
        const ringColor = rateColor(rate);
        // 숫자는 바 배경 위에서만 보이므로 바 안에 넣고, 'N승 N패' 문구는 title/aria-label에 둔다.
        const wlBox = document.getElementById(`t-sum-${fmt}-w`);
        const wlTotal = w + l;
        const wlText = document.getElementById(`t-sum-${fmt}-t`);
        if (wlText) {
            // 승 쪽에 무게를 주려고 패 수는 회색으로 둔다.
            wlText.innerHTML =
                wlTotal === 0 ? '<small>기록 없음</small>' : `${w}<small>승</small> <i>${l}<small>패</small></i>`;
        }
        wlBox.setAttribute('title', `${w}승 ${l}패`);
        wlBox.setAttribute('aria-label', `${w}승 ${l}패`);
        wlBox.innerHTML =
            wlTotal === 0
                ? '<span class="wl-none">기록 없음</span>'
                : (w ? `<span class="wl-win" style="width:${((w / wlTotal) * 100).toFixed(1)}%">${w}</span>` : '') +
                  (l ? `<span class="wl-lose" style="width:${((l / wlTotal) * 100).toFixed(1)}%">${l}</span>` : '');
        const rateEl = document.getElementById(`t-sum-${fmt}-r`);
        rateEl.innerText = getRateText(w, l);
        rateEl.style.color = ringColor;
        document.getElementById(`t-sum-${fmt}-donut`).style.background = donutBackground(ringColor, rate);
    });
    renderTeamRecentMatches();
}

function teamSetDetailsHtml(m) {
    const teamRounds = roundsForMatch(m);
    if (teamRounds.length === 0) {
        return emptyRowHtml(6, '상세 세트 기록이 없습니다', 'py-2 fs-body');
    }
    return teamRounds
        .map(r => {
            const isWin = r['결과'] === '승';
            const isDraw = r['결과'] === '무' || r['결과'] === '무승부';
            let resBadge = '<span class="set-res is-lose">패</span>';
            if (isWin) resBadge = '<span class="set-res is-win">승</span>';
            if (isDraw) resBadge = '<span class="set-res is-draw">무</span>';
            const winnerCls = 'set-res is-win',
                otherCls = '';

            return `
                    <tr>
                        <td class="colw-18-8 set-detail-label">${escapeHTML(r['세트']) || ''} ${escapeHTML(r['라운드']) || ''}</td>
                        <td class="colw-18-8 ${isWin ? winnerCls : otherCls}">${escapeHTML(r['우리 선수']) || '-'}</td>
                        <td class="colw-18-8">${resBadge}</td>
                        <td class="colw-18-8 ${!isWin && !isDraw ? winnerCls : otherCls}">${escapeHTML(r['상대 선수']) || '-'}</td>
                        <td class="colw-18-8 set-detail-map">${escapeHTML(r['맵']) || '-'}</td>
                        <td class="colw-6 col-arrow"></td>
                    </tr>`;
        })
        .join('');
}

function teamMatchRowHtml(m, collapseId) {
    const resText = m['최종 결과'] || m['최근 결과'] || '';
    return `
            <tr class="match-row" role="button" tabindex="0" data-toggle="collapse" data-target="#${collapseId}">
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
                            <table class="table mb-0 text-center set-detail-table">
                                <tbody>${teamSetDetailsHtml(m)}</tbody>
                            </table>
                        </div>
                    </div>
                </td>
            </tr>
            `;
}

// 모달은 목록을 통째로 보여주므로 limit도 paginationId도 안 넘긴다.
function renderTeamMatchesList(containerId, filters, limit, paginationId) {
    filters = filters || {};
    const format = filters.format || '전체';
    const opponent = filters.opponent || null;

    let filtered = format === '전체' ? SiteData.matches : SiteData.matches.filter(m => m['형식'] === format);
    if (opponent) filtered = filtered.filter(m => m['상대팀'] === opponent);

    const page = paginationId ? RecordsState.teamPage || 1 : 1;
    const sliced = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length
        ? sliced.map((m, idx) => teamMatchRowHtml(m, `collapse-${containerId}-${idx}`)).join('')
        : EMPTY_MATCH_ROW_HTML;
    if (paginationId) {
        document.getElementById(paginationId).innerHTML = matchPaginationHtml(
            filtered.length,
            page,
            limit,
            'setTeamPage'
        );
    }
}

function renderTeamRecentMatches() {
    document.getElementById('team-recent-filters').innerHTML = summaryFilterHtml(
        RecordsState.teamFilter,
        'setTeamFilter'
    );
    renderTeamMatchesList('team-recent-list', { format: RecordsState.teamFilter }, 10, 'team-recent-pagination');
}

function setTeamFilter(format) {
    RecordsState.teamFilter = format;
    RecordsState.teamPage = 1;
    renderTeamRecentMatches();
}

function setTeamPage(page) {
    RecordsState.teamPage = page;
    renderTeamRecentMatches();
}

function openTeamMatchModal(format) {
    document.getElementById('teamModalTitle').innerText = format === '전체' ? '팀 전체 전적' : `팀 ${format} 전적`;
    renderTeamMatchesList('team-modal-list', { format }, null);
    showModal('teamMatchesModal');
}

// 카드에서 열면 지금 고른 형식만 보여준다.
function openTeamOpponentModal(opponent, format) {
    const fmt = format || '전체';
    document.getElementById('teamModalTitle').innerHTML =
        `<span class="modal-title-vs">vs${teamLogoHtml(opponent, 20)}${escapeHTML(opponent)} ${fmt === '전체' ? '전체 전적' : `${escapeHTML(fmt)} 전적`}</span>`;
    renderTeamMatchesList('team-modal-list', { format: fmt, opponent }, null);
    showModal('teamMatchesModal');
}

function renderIndividualSidebar() {
    // '전체'는 renderAvatarBar가 만드는 고정 칸으로 들어간다.
    const html = [];
    const formerHtml = [];
    SiteData.members.forEach(m => {
        const item = avatarSelectItemHtml('side-player-', m['이름'], m['SOOP ID'], 'selectPlayer', m);
        (isActiveMember(m) ? html : formerHtml).push(item);
    });

    html.push(`<div class="avatar-select-item avatar-select-toggle" id="indiv-toggle-former" role="button" tabindex="0" data-click="toggleFormerMembers">
                        <div class="avatar-select-fallback">
                            ${chevronDownSvg(10, ' id="indiv-toggle-chevron" class="chevron-rotatable"')}
                        </div>
                        <span class="avatar-select-name">이전 멤버</span>
                   </div>`);
    html.push(`<span id="indiv-former-wrap" class="d-none">${formerHtml.join('')}</span>`);

    renderAvatarBar(
        'indiv-avatar-list',
        avatarSelectAllItemHtml(
            'side-btn-summary',
            act('showIndivSummary'),
            `${SiteData.members.filter(isActiveMember).length}`
        ),
        html.join('')
    );
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
    const formerWrap = document.getElementById('indiv-former-wrap');
    if (sideItem && formerWrap && formerWrap.contains(sideItem) && !isVisible(formerWrap)) {
        toggleFormerMembers();
    }

    const pStat = findPlayerStats(name);
    const pDb = findMemberByName(name) || {};

    document.getElementById('p-name').innerText = name;
    applyBadge(document.getElementById('p-tier'), tierLabel(pDb['티어']), 'tag-badge tier-badge');
    // 이 페이지는 랭킹을 따지지 않으므로 티어랭킹 자리에 활동기간을 넣는다.
    const periodEl = document.getElementById('p-period');
    periodEl.className = 'tag-badge rank-badge';
    periodEl.innerHTML = memberPeriodBadgeHtml(pDb);
    applyBadge(
        document.getElementById('p-race'),
        raceShortLabel(pDb['종족']),
        'tag-badge' + raceBadgeClass(pDb['종족'])
    );
    document.getElementById('p-avatar').innerHTML = profileAvatarInnerHtml(pDb['SOOP ID']);

    INDIV_DONUTS.forEach(([suffix, key, color]) => {
        updateDonut(`d-${suffix}`, `dt-${suffix}`, `dw-${suffix}`, recordStat(pStat[key]), color);
    });

    // 합계는 대회 + 대학만 센다. 경기 수가 훨씬 많은 미니·CK를 섞으면 대회 성적이 묻힌다.
    const official = ['대회 전적', '대학 전적'].reduce(
        (acc, key) => {
            const st = recordStat(pStat[key]);
            return { wins: acc.wins + st.wins, losses: acc.losses + st.losses };
        },
        { wins: 0, losses: 0 }
    );
    const officialTotal = official.wins + official.losses;
    document.getElementById('p-total-label').innerText = `대학 · 대회 총 전적 ${formatNum(officialTotal)}전`;
    document.getElementById('p-total-wl').innerHTML = officialTotal
        ? `${official.wins}<small>승</small> ${official.losses}<small>패</small>`
        : '<small>기록 없음</small>';
    document.getElementById('p-total-rate').innerText = officialTotal
        ? ((official.wins / officialTotal) * 100).toFixed(1) + '%'
        : '-';

    renderIndivMatchesList('indiv-recent-list', RecordsState.indivFilter, 10);
    updateStatsHash();
}

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

function setIndivPage(page) {
    RecordsState.indivPage = page;
    renderIndivMatchesList('indiv-recent-list', RecordsState.indivFilter, 10);
}

// 좁은 화면: '상대 팀' 칸을 숨기고 상대 선수 이름 밑 작은 줄로 보여준다.
function renderIndivMatchesList(containerId, format, limit) {
    let filtered = SiteData.rounds.filter(m => m['우리 선수'] === RecordsState.player);
    if (format !== '전체') filtered = filtered.filter(m => m['형식'] === format);
    const page = RecordsState.indivPage || 1;
    const sliced = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;
    if (containerId === 'indiv-recent-list')
        document.getElementById('indiv-pagination').innerHTML = matchPaginationHtml(
            filtered.length,
            page,
            limit || 10,
            'setIndivPage'
        );

    document.getElementById(containerId).innerHTML = sliced.length
        ? sliced
              .map(
                  m => `
            <tr>
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
            `
              )
              .join('')
        : EMPTY_MATCH_ROW_HTML;
}

// 상대(멤버) × 형식 4개를 표로 그리면 칸의 절반이 비므로 형식 하나만 칩으로 골라 보여준다.
const SUMMARY_FORMATS = ['전체', ...FORMAT_KEYS];

function summaryFilterHtml(current, handler) {
    return SUMMARY_FORMATS.map(
        f => `
        <div class="filter-item${f === current ? ' active' : ''}" role="tab" tabindex="0"
             aria-selected="${f === current}"${act(handler, f)}>${escapeHTML(f)}</div>`
    ).join('');
}

// '전체'면 네 형식을 다 더한다.
function statFor(getCounts, format) {
    if (format !== '전체') return getCounts(format);
    return FORMAT_KEYS.reduce(
        (acc, f) => {
            const st = getCounts(f);
            return { wins: acc.wins + st.wins, losses: acc.losses + st.losses };
        },
        { wins: 0, losses: 0 }
    );
}

// ----- 팀: 상대 전적 -----
// 카드는 '자주 만난 상대'와 같은 부품(.h2h-rival)이고 사진 자리에 팀 로고가 들어간다.
function readOpponentRows() {
    const byTeam = new Map();
    SiteData.matches.forEach(m => {
        const team = String(m['상대팀'] || '').trim();
        const fmt = String(m['형식'] || '').trim();
        const result = String(m['최종 결과'] || '').trim();
        if (!team || !FORMAT_KEYS.includes(fmt) || (result !== '승' && result !== '패')) return;
        if (!byTeam.has(team)) byTeam.set(team, Object.fromEntries(FORMAT_KEYS.map(f => [f, { wins: 0, losses: 0 }])));
        const rec = byTeam.get(team)[fmt];
        result === '승' ? rec.wins++ : rec.losses++;
    });
    return [...byTeam.entries()].map(([team, counts]) => ({
        team,
        stats: counts,
    }));
}
function setTeamOppFormat(format) {
    RecordsState.oppFormat = format;
    renderOpponentTable();
}

function renderOpponentTable() {
    const wrap = document.getElementById('team-opp-wrap');
    if (!wrap) return;
    const rows = readOpponentRows();
    const format = RecordsState.oppFormat || '전체';

    document.getElementById('team-opp-filters').innerHTML = summaryFilterHtml(format, 'setTeamOppFormat');

    // '—'만 찍힌 줄을 만들지 않는다.
    const cards = rows
        .map(r => ({ team: r.team, stat: statFor(f => r.stats[f], format) }))
        .filter(x => x.stat.wins + x.stat.losses > 0)
        .sort((a, b) => b.stat.wins + b.stat.losses - (a.stat.wins + a.stat.losses));

    if (!cards.length) {
        wrap.innerHTML = '<div class="h2h-empty">이 형식의 전적이 없습니다</div>';
        return;
    }
    wrap.innerHTML = `<div class="h2h-rivals">${cards
        .map(({ team, stat }) => {
            const total = stat.wins + stat.losses;
            return `
        <button type="button" class="h2h-rival team-row-clickable"${act('openTeamOpponentModal', team, format)}>
            <span class="h2h-rival-avatar is-logo">${teamLogoHtml(team, 26)}</span>
            <span class="h2h-rival-name">${escapeHTML(team)}</span>
            <span class="h2h-rival-rec">${winLoseText(stat.wins, stat.losses)}<span class="h2h-rate-sub"> · ${getRateText(stat.wins, stat.losses)}</span></span>
            <span class="h2h-rival-bar"><span style="width:${((stat.wins / total) * 100).toFixed(1)}%"></span></span>
        </button>`;
        })
        .join('')}</div>`;
}

// ----- 개인: 전체 전적 -----
function setIndivSummaryFormat(format) {
    RecordsState.summaryFormat = format;
    renderIndivSummaryTable();
}

// 명단이라 기록 없는 멤버도 '기록 없음'으로 남기고 로스터 순서를 따른다(상대 전적은 붙어 본 팀만).
function renderIndivSummaryTable() {
    const grid = document.getElementById('indiv-summary-grid');
    if (!grid) return;
    const format = RecordsState.summaryFormat || '전체';
    document.getElementById('indiv-summary-filters').innerHTML = summaryFilterHtml(format, 'setIndivSummaryFormat');

    grid.innerHTML = `<div class="h2h-rivals">${SiteData.members
        .filter(isActiveMember)
        .map(m => {
            const pStat = findPlayerStats(m['이름']);
            const name = m['이름'];
            const stat = statFor(f => recordStat(pStat[`${f} 전적`]), format);
            const total = stat.wins + stat.losses;
            const rec = total
                ? `${winLoseText(stat.wins, stat.losses)}<span class="h2h-rate-sub"> · ${getRateText(stat.wins, stat.losses)}</span>`
                : '<span class="wl-empty">기록 없음</span>';
            return `
        <button type="button" class="h2h-rival"${act('selectPlayer', name)}>
            ${avatarHtml(m['SOOP ID'], 'h2h-rival-avatar')}
            <span class="h2h-rival-name">${escapeHTML(name)}</span>
            <span class="h2h-rival-rec">${rec}</span>
            ${total ? `<span class="h2h-rival-bar"><span style="width:${((stat.wins / total) * 100).toFixed(1)}%"></span></span>` : '<span class="h2h-rival-bar is-empty"></span>'}
        </button>`;
        })
        .join('')}</div>`;
}

bootPage(
    () => {
        safeInit('팀 요약 통계', calculateTeamSummaries);
        safeInit('상대 전적 표', renderOpponentTable);
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                const view = recordViewFromParams(params);
                switchStatView(view);
                const member = params.get('member');
                if (view === 'individual' && member) selectPlayer(member);
            })
        );
    },
    {
        siteData: ['members', 'records'],
        logos: () => [...SiteData.matches.map(m => m['상대팀']), '캄몬스타즈'], // '내전'은 캄몬스타즈 로고
        view: params => activateTabView(RECORD_TABS, recordViewFromParams(params)),
    }
);
