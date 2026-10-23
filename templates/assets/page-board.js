/**
 * 티어표 > 현황판 - 대학마다 머리(로고·창단일·우승 횟수, 총원·직책 인원)와 선수 카드를 창단일 순(api_team_order)으로 보여준다.
 * 명단·바로가기 바는 티어표(page-tier.js)와 같고, 선수 카드를 누르면 멤버 페이지와 같은 프로필 창(core.js openProfileModal)을 연다.
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
    return `
    <section class="tier-row board-team" id="${id}" aria-labelledby="${id}-name">
        <div class="board-team-head${boardColorClass(team.color)}"${boardColorStyle(team.color)}>
            <div class="board-team-id">
                ${teamLogoHtml(team.name, 60)}
                <div class="board-team-title">
                    <h2 class="head-plate-value" id="${id}-name">${escapeHTML(team.name)}</h2>
                    <div class="board-team-meta">
                        ${since ? `<span>SINCE ${escapeHTML(since)}</span>` : ''}
                        <span class="board-team-wins"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>우승 ${team.wins || 0}회</span>
                    </div>
                </div>
            </div>
            <dl class="board-team-stats">
                ${[['총원', list.length], ...boardRoleCounts(list)]
                    .map(([role, n]) => `<div><dt>${escapeHTML(role)}</dt><dd>${n}명</dd></div>`)
                    .join('')}
            </dl>
        </div>
        <div class="board-grid">${list.map(boardCardHtml).join('')}</div>
    </section>`;
}

// 대학 머리는 펨코 티어표의 그 대학 구역 색(teams.board_color)으로 칠한다. 없으면 네이비.
// 흰 글씨와 네이비 글씨 중 대비가 큰 쪽을 쓴다(노랑·분홍 같은 밝은 색은 네이비 글씨).
function boardColor(hex) {
    return /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : '';
}
function boardColorStyle(hex) {
    return boardColor(hex) ? ` style="--board-color:${hex}"` : '';
}
function boardColorClass(hex) {
    const color = boardColor(hex);
    if (!color) return '';
    const lum = c => {
        const v = parseInt(c, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = [1, 3, 5].map(i => lum(color.slice(i, i + 2)));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // 흰 글씨 대비 (1.05)/(l+0.05), 네이비(#14264a, 휘도 약 0.02) 글씨 대비 (l+0.05)/0.07
    return 1.05 / (l + 0.05) >= (l + 0.05) / 0.07 ? '' : ' is-light';
}

// 선수 카드: 사진 옆에 이름, 그 아래 티어·종족 뱃지. 누르면 프로필 창
function boardCardHtml(m) {
    const race = raceShortLabel(m.race || '');
    return `
            <button type="button" class="board-card${['T', 'Z', 'P'].includes(race) ? ` edge-${race}` : ''}"${act('boardOpenProfile', tierIdKey(m))}>
                ${avatarHtml(m.id, 'board-card-av')}
                <span class="board-card-body">
                    <span class="board-card-name">${escapeHTML(m.nickname)}</span>
                    <span class="board-card-badges">${tierBadgeHtml(m.tier)}${m.race ? raceBadgeHtml(m.race) : ''}</span>
                </span>
            </button>`;
}

// 멤버 페이지와 같은 프로필 창. 입단 티어·활동기간은 캄몬 입단 기록이라 없고, 소속 전적은 캄몬 멤버만 있다.
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
                ['성별', m.gender],
                ['생년월일', m.birthDate],
                ['MBTI', m.mbti],
            ],
            eloId: m.eloId,
            recordsUrl: m.memberName ? 'records/?view=solo&member=' + encodeURIComponent(m.memberName) : '',
            youtube: m.youtube,
        },
        () =>
            Api.statsLatest([m.id]).then(rows => rows.find(r => String(r.soop_id || '').toLowerCase() === key) || null)
    );
}
