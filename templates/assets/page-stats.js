/**
 * 방송통계 페이지: 남/여 멤버별 방송 지표 순위표. (core.js → 이 파일)
 * URL: /stats/[?view=hours|viewers|sponsor|winrate][&month=YYYY-MM]  (month가 없으면 가장 최근 달)
 */

// 지표별 설정을 한 곳에 모았다: 탭 라벨 / URL에 노출되는 짧은 값 / 표시 형식 / 정렬 기준.
// (예전엔 라벨·URL 변환표 2개·표시 if문·정렬 if문이 4군데에 흩어져 있었다)
// [리디자인] formatValue는 요약 타일의 '합계'용이다. format은 행 하나(멤버 객체)를 받지만
// 합계는 숫자 하나를 받으므로 서식 함수가 따로 필요하다.
const SYNERGY_METRICS = {
    balloons: {
        label: '별풍선', url: 'balloons',
        format: m => formatCount(m.balloons, '개'),
        formatValue: v => formatCount(v, '개'),
    },
    broadcast_seconds: {
        label: '방송시간', url: 'hours',
        format: m => formatSecondsToHM(m.broadcast_seconds),
        formatValue: v => formatSecondsToHM(v),
    },
    cumulative_viewers: {
        label: '누적시청자', url: 'viewers',
        format: m => formatCount(m.cumulative_viewers, '명'),
        formatValue: v => formatCount(v, '명'),
    },
    sponsor: {
        label: '스폰판수', url: 'sponsor',
        format: m => formatCount(sponsorGames(m), '판'),
        sortValue: sponsorGames,
        formatValue: v => formatCount(v, '판'),
    },
    // 승패·승률. 판수가 적으면 승률이 튀므로(1전 1승 = 100%) SPONSOR_RATE_MIN판 이상인 멤버를 승률순으로
    // 먼저 세우고, 그보다 적은 멤버는 그 뒤에 판수순으로 둔다. 합계·평균 칸은 전체 승률·평균 승률이다.
    sponsor_rate: {
        label: '스폰승률', url: 'winrate',
        format: m => (sponsorGames(m) ? formatSponsorRecord(m.sponsor_wins, m.sponsor_losses) : '-'),
        sortValue: m => {
            const games = sponsorGames(m);
            if (games >= SPONSOR_RATE_MIN) return 2 + (m.sponsor_wins || 0) / games + games * 1e-9;
            return games * 1e-6;
        },
        tiles: { total: ['전체 승률', '승률'], avg: ['평균 승률', '평균'] },
        summarize: rows => {
            const wins = rows.reduce((n, m) => n + (m.sponsor_wins || 0), 0);
            const games = rows.reduce((n, m) => n + sponsorGames(m), 0);
            const rated = rows.filter(m => sponsorGames(m) >= SPONSOR_RATE_MIN);
            const avg = rated.reduce((n, m) => n + (m.sponsor_wins || 0) / sponsorGames(m), 0) / (rated.length || 1);
            return {
                total: games ? `${(wins / games * 100).toFixed(1)}%` : '-',
                avg: rated.length ? `${(avg * 100).toFixed(1)}%` : '-',
            };
        },
    },
};
// 스폰승률 순위에 올리는 최소 판수(이보다 적으면 승률 순위 뒤로)
const SPONSOR_RATE_MIN = 10;
// 합계·평균 칸 이름표 기본값: [긴 이름(앞에 '이번 달'·'8월'이 붙음), 좁은 화면용]
const SYNERGY_TILE_LABELS = { total: ['합계', '합계'], avg: ['평균', '평균'] };

function sponsorGames(m) {
    return (m.sponsor_wins || 0) + (m.sponsor_losses || 0);
}

// URL의 view 값 -> 내부 지표 키. 모르는 값(또는 'constructor' 같은 프로토타입 이름)은 기본값.
function synergyMetricFromUrl(urlValue) {
    const found = Object.keys(SYNERGY_METRICS).find(key => SYNERGY_METRICS[key].url === urlValue);
    return found || 'balloons';
}

function synergyMetricConfig(metric) {
    return hasOwn(SYNERGY_METRICS, metric) ? SYNERGY_METRICS[metric] : null;
}

// 달 이동에 쓰는 목록(최신순, fetchSynergyMonths). 받기 전이나 실패하면 빈 목록 - 달 이동을 숨긴다.
let SynergyMonths = [];
// 요청이 겹칠 때(달을 빨리 여러 번 누름) 마지막으로 고른 달의 결과만 그린다.
let _synergyLoadSeq = 0;

async function loadSynergyData(month = SynergyState.month) {
    const seq = ++_synergyLoadSeq;
    try {
        await fetchSynergyData(month);
        if (seq !== _synergyLoadSeq) return;
        // [리디자인] 머리 오른쪽 UPDATED 칸에 들어간다 - 라벨이 이미 'UPDATED'라 접두어를 뺀다.
        document.getElementById('synergy-updated').innerText = formatKstDateTime(SynergyState.updatedAt, false) || '-';
        renderSynergyMonthText();
        renderSynergyMonthNav();
        renderSynergyTable();
    } catch (e) {
        if (seq !== _synergyLoadSeq) return;
        console.error(e);
        const errRow = emptyRowHtml(3, '데이터를 불러오지 못했습니다');
        document.getElementById('synergy-tbody-male').innerHTML = errRow;
        document.getElementById('synergy-tbody-female').innerHTML = errRow;
    }
}

function loadSynergyMonths() {
    return fetchSynergyMonths().then(months => {
        SynergyMonths = months;
        renderSynergyMonthNav();
    }, err => console.error(err));
}

// 최근 달은 month 값을 비운다(주소에 안 남고, 새 달이 되면 자연히 그 달을 보게).
function synergyMonthKey(month) {
    return SynergyMonths.length && month === SynergyMonths[0].month ? '' : (month || '');
}

function synergyMonthLabel(month) {
    const [y, m] = String(month).split('-').map(Number);
    return `${y}년 ${m}월`;
}

// 제목 줄의 달 이동(◀ 2026년 9월 ▶): 방송통계가 있는 달이 둘 이상일 때만 보인다.
// SynergyMonths는 최신순이라 '이전 달'은 목록의 다음 칸이다. 끝 달에서는 그쪽 버튼을 끈다.
function synergyMonthIndex() {
    const current = SynergyState.month || (SynergyMonths[0] && SynergyMonths[0].month);
    return SynergyMonths.findIndex(m => m.month === current);
}

function renderSynergyMonthNav() {
    const box = document.getElementById('synergy-month-nav');
    if (!box) return;
    box.hidden = SynergyMonths.length < 2;
    const idx = synergyMonthIndex();
    const title = document.getElementById('synergy-month-title');
    if (title) title.innerText = idx >= 0 ? synergyMonthLabel(SynergyMonths[idx].month) : '';
    const prev = document.getElementById('synergy-month-prev');
    const next = document.getElementById('synergy-month-next');
    if (prev) prev.disabled = idx < 0 || idx >= SynergyMonths.length - 1;
    if (next) next.disabled = idx <= 0;
}

function stepSynergyMonth(delta) {
    const idx = synergyMonthIndex();
    const target = SynergyMonths[idx - delta];
    if (idx >= 0 && target) setSynergyMonth(target.month);
}

// 머리 설명과 합계·평균 이름표: 이번 달이면 '이번 달', 지난 달이면 'N월'
function renderSynergyMonthText() {
    const month = SynergyState.month;
    const monthNum = month ? Number(month.split('-')[1]) : 0;
    const sub = document.getElementById('synergy-subtitle');
    if (sub) {
        // 지난 달은 그달 마지막 집계일까지의 누적이다(보통 말일)
        const [, mm, dd] = String(SynergyState.statDate).split('-').map(Number);
        sub.innerText = month
            ? `캄몬스타즈 멤버들의 ${synergyMonthLabel(month)} 방송 통계입니다 (${mm}월 ${dd}일까지)`
            : '캄몬스타즈 멤버들의 이번 달 방송 통계입니다';
    }
    renderSynergyTileLabels();
}

// 합계·평균 칸 이름표: '이번 달 합계' / '8월 합계', 스폰승률은 '이번 달 전체 승률' 등(지표의 tiles)
function renderSynergyTileLabels() {
    const month = SynergyState.month;
    const prefix = month ? `${Number(month.split('-')[1])}월` : '이번 달';
    const config = synergyMetricConfig(SynergyState.metric) || {};
    staticAll('.synergy-tile[data-tile]').forEach(tile => {
        const [long, short] = (config.tiles || SYNERGY_TILE_LABELS)[tile.dataset.tile] || ['', ''];
        const longEl = tile.querySelector('.synergy-tile-ko-long');
        const shortEl = tile.querySelector('.synergy-tile-ko-short');
        if (longEl) longEl.innerText = `${prefix} ${long}`;
        if (shortEl) shortEl.innerText = short;
    });
}

function setSynergyMonth(month) {
    const key = synergyMonthKey(month);
    if (key === SynergyState.month && SynergyState.data) return;
    SynergyState.month = key;
    renderSynergyMonthNav();
    syncSynergyUrl();
    loadSynergyData(key);
}

// 주소를 처음 읽기 전(core.js가 숨긴 지표 탭을 먼저 옮기는 경우 등)에는 주소를 건드리지 않는다 -
// 그러면 주소에 있던 month가 읽히기도 전에 지워진다.
let synergyUrlRestored = false;
function syncSynergyUrl() {
    if (!synergyUrlRestored) return;
    const config = synergyMetricConfig(SynergyState.metric);
    const view = config ? config.url : SynergyState.metric;
    PageState.update({ view: view !== 'balloons' ? view : '', month: SynergyState.month });
}

// 어드민에서 끈 지표 탭은 고를 수 없다. 숨긴 탭이 요청되면(주소에 남아 있거나 기본값이거나)
// 보이는 탭 중 첫 번째로 옮긴다.
function firstVisibleMetric() {
    const el = staticAll('#synergy-metric-filter .sub-tab').find(x => !x.hidden);
    return el ? el.dataset.metric : '';
}

// core.js가 Supabase의 메뉴 설정을 읽어 탭을 숨긴 뒤 불러준다(이 페이지에 있을 때만).
function syncStatsMetricVisibility() {
    if (typeof isStatsTabHidden !== 'function' || !isStatsTabHidden(SynergyState.metric)) return;
    const next = firstVisibleMetric();
    if (next && next !== SynergyState.metric) setSynergyMetric(next);
}

function setSynergyMetric(metric) {
    if (typeof isStatsTabHidden === 'function' && isStatsTabHidden(metric)) {
        metric = firstVisibleMetric() || metric;
    }
    SynergyState.metric = metric;
    const config = synergyMetricConfig(metric);
    staticAll('#synergy-metric-filter .sub-tab').forEach(el => {
        const on = el.dataset.metric === metric;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    staticAll('.synergy-metric-label').forEach(el => {
        el.innerText = config ? config.label : '';
    });
    renderSynergyTable();
    syncSynergyUrl();
}

// 순위·이름·값만 담백하게 보여준다(1~3위 색 플레이트와 비율 막대는 조잡해 보여 뺐다).
function synergyRowHtml(m, idx) {
    const ours = m.ourMember;
    const name = ours['이름'] || m.nickname;
    // 알 수 없는 지표면(직접 호출된 경우) 스폰판수 형식(승패·승률)으로 표시
    const config = synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor;
    const displayVal = config.format(m);

    const rank = idx + 1;

    return `
        <tr>
            <td class="text-center colw-20 text-nowrap"><span class="synergy-rank">${rank}</span></td>
            <td class="text-center colw-40">
                <span class="team-cell min-w-0">
                    ${avatarHtml(ours['SOOP ID'], 'player-avatar-sm')}
                    <span class="fw-bold ellipsis-text text-nowrap">${escapeHTML(name)}</span>
                </span>
            </td>
            <td class="text-center fw-bold colw-40 text-nowrap synergy-value">
                <span class="synergy-val-text">${escapeHTML(displayVal)}</span>
            </td>
        </tr>`;
}

function sortSynergyRows(rows) {
    const metric = SynergyState.metric;
    const config = synergyMetricConfig(metric);
    const value = config && config.sortValue ? config.sortValue : (m => m[metric] || 0);
    return rows.slice().sort((a, b) => value(b) - value(a));
}

// 맨 위 TOP 칸(1위 대표 사진·이름·값)과 요약 타일 3개(합계 / 평균 / 멤버수)를 채운다.
// 지표마다 단위가 달라서(개, 시간, 명, 판) config.formatValue로 같은 서식을 쓴다.
// 합계·평균은 정렬 기준값(readValue)으로 센다 - 스폰판수는 승+패 판수다.
function renderSynergyTopPhoto(top) {
    const box = document.getElementById('synergy-top-photo');
    if (!box) return;
    const ours = top ? top.ourMember : null;
    // 대표 영상·사진: 어드민에서 올린 것(Storage 경로) 또는 저장소 파일(media/members/<SOOP ID>, 빌드가 채움) → 없으면 SOOP 사진
    const raw = String((ours && ours['대표 사진']) || '');
    const photo = /^media\/members\/[a-z0-9_-]+\.[a-z0-9]+(\?v=[0-9a-f]+)?$/.test(raw) ? raw : storageMediaUrl(raw);
    const avatar = (ours && getProfileImgUrl(ours['SOOP ID'])) || '';
    const key = photo || avatar || 'none';
    if (box.dataset.src === key) return;          // 같은 사진이면 다시 그리지 않는다(움짤이 처음부터 다시 돌지 않게)
    box.dataset.src = key;
    box.innerHTML = '';
    const alt = (ours && ours['이름']) || '';
    const show = (src, fallback) => {
        // 영상(mp4·webm): 소리 없이 자동 반복. 끊김 없이 재생할 만큼 받은 뒤(canplaythrough) 붙인다.
        if (/\.(mp4|webm)(\?|$)/i.test(src)) {
            const video = document.createElement('video');
            Object.assign(video, { muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto' });
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            video.setAttribute('aria-label', alt);
            let done = false;
            const ready = () => {
                if (done || box.dataset.src !== key) return;
                done = true;
                box.classList.remove('is-fallback');
                box.replaceChildren(video);
                video.play().catch(() => {});     // 저전력 모드 등 자동 재생이 막히면 첫 장면이 멈춘 채로 보인다
                requestAnimationFrame(() => video.classList.add('is-in'));
            };
            video.addEventListener('canplaythrough', ready, { once: true });
            video.addEventListener('loadeddata', () => setTimeout(ready, 1500), { once: true });  // canplaythrough가 안 오는 브라우저 대비
            video.addEventListener('error', () => {
                if (box.dataset.src === key && avatar) show(avatar, true);
            }, { once: true });
            video.src = src;
            video.load();
            return;
        }
        // 움짤은 1~2MB라 받는 중에 붙이면 끊기며 그려진다. 다 받고 풀어 둔 뒤(decode) 붙여서 부드럽게 나타나게 한다.
        const img = new Image();
        img.alt = alt;
        img.decoding = 'async';
        img.src = src;
        const ready = img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; });
        ready.then(() => {
            if (box.dataset.src !== key) return;       // 그사이 다른 지표·1위로 바뀌었으면 버린다
            box.classList.toggle('is-fallback', fallback);
            box.replaceChildren(img);
            requestAnimationFrame(() => img.classList.add('is-in'));
        }).catch(() => {
            if (box.dataset.src === key && !fallback && avatar) show(avatar, true);   // 대표 사진이 깨지면 SOOP 사진
        });
    };
    box.classList.remove('is-fallback');
    if (photo) show(photo, false);
    else if (avatar) show(avatar, true);
}

function renderSynergySummary(rows) {
    const box = document.getElementById('synergy-summary');
    if (!box) return;
    const config = synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor;
    renderSynergyTileLabels();
    const readValue = config.sortValue ? config.sortValue : (row => row[SynergyState.metric] || 0);
    const fmt = v => (config.formatValue ? config.formatValue(v) : Number(v).toLocaleString('ko-KR'));

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('synergy-top-metric', config.label || '');
    setText('synergy-sum-count', rows.length ? `${rows.length}명` : '-');

    if (!rows.length) {
        ['synergy-sum-total', 'synergy-sum-avg', 'synergy-sum-top', 'synergy-sum-top-value'].forEach(id => setText(id, '-'));
        renderSynergyTopPhoto(null);
        return;
    }

    if (config.summarize) {
        const sum = config.summarize(rows);
        setText('synergy-sum-total', sum.total);
        setText('synergy-sum-avg', sum.avg);
    } else {
        const total = rows.reduce((acc, m) => acc + (Number(readValue(m)) || 0), 0);
        setText('synergy-sum-total', fmt(total));
        setText('synergy-sum-avg', fmt(Math.round(total / rows.length)));
    }

    const top = rows[0];
    setText('synergy-sum-top', top.ourMember['이름'] || top.nickname || '-');
    setText('synergy-sum-top-value', config.format(top));
    renderSynergyTopPhoto(top);
}

function renderSynergyTable() {
    if (!SynergyState.data) return;
    const active = SynergyState.data.filter(m => m.active);
    // 요약 타일은 남녀를 합친 전체 순위를 기준으로 한다.
    renderSynergySummary(sortSynergyRows(active));
    const noData = emptyRowHtml(3, '표시할 멤버가 없습니다');
    [['synergy-tbody-male', '남자'], ['synergy-tbody-female', '여자']].forEach(([tbodyId, gender]) => {
        const rows = sortSynergyRows(active.filter(m => m.ourMember['성별'] === gender));
        document.getElementById(tbodyId).innerHTML = rows.length
            ? rows.map((m, i) => synergyRowHtml(m, i)).join('')
            : noData;
    });
}

bootPage(() => {
    // 주소의 달을 먼저 읽고 그 달을 받는다(뒤로·앞으로 갈 때도 같은 순서)
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : '';
        const changed = month !== SynergyState.month;
        SynergyState.month = month;
        synergyUrlRestored = true;
        setSynergyMetric(synergyMetricFromUrl(params.get('view')));
        if (changed) { renderSynergyMonthNav(); loadSynergyData(month); }
    }));
    safeInit('방송통계(시너지)', () => { if (!SynergyState.data) loadSynergyData(); });
    safeInit('방송통계 달 목록', loadSynergyMonths);
});
