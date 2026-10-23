/**
 * 티어표 > 현황판 - 대학마다 머리(로고·창단일·총원·우승·직책 인원)와 선수 카드를 창단일 순(api_team_order)으로 보여준다.
 * 명단·카드·바로가기 바는 티어표(page-tier.js)와 같고, 카드를 누르면 멤버 페이지와 같은 프로필 창(core.js openProfileModal)을 연다.
 */

const BoardState = {
    init: null,
    byKey: {}, // soopId(소문자) -> 선수
};
const boardBar = new SectionBar('board-bar', '대학 바로가기');

// 다시 들어오면 바 높이·강조만 맞춘다(숨은 탭에서는 재지 않는다)
function boardEnter() {
    boardBar.ensurePick();
    if (BoardState.init) {
        boardBar.syncHeight();
        boardBar.highlight();
        return BoardState.init;
    }
    BoardState.init = boardInit();
    return BoardState.init;
}

async function boardInit() {
    const root = document.getElementById('board-root');
    let members, teams;
    try {
        [members, teams] = await Promise.all([fetchTierMembers(), Api.teamOrder()]);
        if (!members) throw new Error('티어 명단이 비어 있습니다');
    } catch (e) {
        console.error('현황판을 불러오지 못했습니다:', e);
        root.innerHTML =
            '<div class="content-state is-boxed">현황판을 불러오지 못했습니다. 잠시 후 다시 시도해주세요</div>';
        BoardState.init = null;
        return;
    }
    members.forEach(m => {
        BoardState.byKey[tierIdKey(m)] = m;
    });

    // 표에 있는 대학만, 창단일 순. 대학 안에서는 티어 순(같은 티어는 명단 순서)
    const byTeam = new Map();
    members.forEach(m => {
        if (!byTeam.has(m.team)) byTeam.set(m.team, []);
        byTeam.get(m.team).push(m);
    });
    const shown = teams.filter(t => byTeam.has(t.name));
    const sections = shown.map((t, i) => ({ id: `board-sec-${i}`, label: t.name, count: byTeam.get(t.name).length }));
    root.innerHTML = shown.length
        ? shown
              .map((t, i) =>
                  boardTeamHtml(
                      t,
                      sections[i].id,
                      byTeam.get(t.name).sort((a, b) => tierIndex(tierGroupKey(a)) - tierIndex(tierGroupKey(b)))
                  )
              )
              .join('')
        : '<div class="content-state is-boxed">표시할 대학이 없습니다</div>';
    loadTeamLogos(shown.map(t => t.name)).then(() => swapTeamLogoFallbacks(root));

    boardBar.render(sections);
    boardBar.watch();
    boardBar.highlight();
    boardBar.syncPickLabel();
}

// 직책이 없는 사람은 선수다. 직책은 적은 순(이사장·총장처럼 한두 명인 자리가 앞), 선수는 맨 끝
function boardRoleCounts(list) {
    const count = new Map();
    list.forEach(m => {
        const role = m.role || '선수';
        count.set(role, (count.get(role) || 0) + 1);
    });
    return [...count].sort(([a, x], [b, y]) => (a === '선수') - (b === '선수') || x - y || a.localeCompare(b, 'ko'));
}

function boardTeamHtml(team, id, list) {
    const since = String(team.founded || '').replace(/-/g, '.');
    const stats = [
        ['총원', `${list.length}명`],
        ['우승', `${team.wins || 0}회`],
        ...boardRoleCounts(list).map(([r, n]) => [r, `${n}명`]),
    ];
    return `
    <section class="tier-row board-team" id="${id}" aria-labelledby="${id}-name">
        <div class="clean-card head-plate board-team-head">
            <div class="board-team-id">
                ${teamLogoHtml(team.name, 48)}
                <div class="board-team-title">
                    ${since ? `<div class="head-plate-label">SINCE ${escapeHTML(since)}</div>` : ''}
                    <h2 class="head-plate-value" id="${id}-name">${escapeHTML(team.name)}</h2>
                </div>
            </div>
            <dl class="board-team-stats">
                ${stats.map(([k, v]) => `<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`).join('')}
            </dl>
        </div>
        <div class="tier-grid">
            ${list.map(m => tierCardHtml(m, null, { open: act('boardOpenProfile', tierIdKey(m)), note: m.role || '선수' })).join('')}
        </div>
    </section>`;
}

// 티어표 명단에는 성별·생일이 없다(staruniv.sql 2번 운영 결정). 기본 정보는 소속과 SOOP ID로 채운다.
function boardOpenProfile(key) {
    const m = BoardState.byKey[key];
    if (!m) return;
    openProfileModal(
        {
            name: m.nickname,
            soopId: m.id,
            role: m.role || '선수',
            tier: m.tier,
            race: m.race,
            facts: [
                ['소속', m.team],
                ['직책', m.role || '선수'],
                ['SOOP ID', m.id],
            ],
            eloId: m.eloId,
        },
        () =>
            Api.statsLatest([m.id]).then(rows => rows.find(r => String(r.soop_id || '').toLowerCase() === key) || null)
    );
}
