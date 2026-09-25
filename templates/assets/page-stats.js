/**
 * 방송통계 페이지: 남/여 멤버별 방송 지표 순위표. (core.js → 이 파일)
 * URL: /stats/[?view=hours|viewers|sponsor]
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
        format: m => formatSponsorRecord(m.sponsor_wins, m.sponsor_losses),
        // 표시는 승패/승률이지만, 정렬과 합계는 판수(승+패) 기준이다 - 승수 기준이 아니다.
        sortValue: m => (m.sponsor_wins || 0) + (m.sponsor_losses || 0),
        formatValue: v => formatCount(v, '판'),
    },
};

// URL의 view 값 -> 내부 지표 키. 모르는 값(또는 'constructor' 같은 프로토타입 이름)은 기본값.
function synergyMetricFromUrl(urlValue) {
    const found = Object.keys(SYNERGY_METRICS).find(key => SYNERGY_METRICS[key].url === urlValue);
    return found || 'balloons';
}

function synergyMetricConfig(metric) {
    return hasOwn(SYNERGY_METRICS, metric) ? SYNERGY_METRICS[metric] : null;
}

async function loadSynergyData() {
    try {
        await fetchSynergyData();
        // [리디자인] 머리 오른쪽 UPDATED 칸에 들어간다 - 라벨이 이미 'UPDATED'라 접두어를 뺀다.
        document.getElementById('synergy-updated').innerText = formatKstDateTime(SynergyState.updatedAt, false) || '-';
        renderSynergyTable();
    } catch (e) {
        console.error(e);
        const errRow = emptyRowHtml(3, '데이터를 불러오지 못했습니다');
        document.getElementById('synergy-tbody-male').innerHTML = errRow;
        document.getElementById('synergy-tbody-female').innerHTML = errRow;
    }
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
    const urlValue = config ? config.url : metric;
    PageState.update(urlValue !== 'balloons' ? { view: urlValue } : {});
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
    // 대표 사진(움짤 WebP 등) → 없으면 SOOP 프로필 사진 → 그것도 없으면 빈 칸
    const photo = (ours && storageMediaUrl(ours['대표 사진'])) || '';
    const avatar = (ours && getProfileImgUrl(ours['SOOP ID'])) || '';
    const key = photo || avatar || 'none';
    if (box.dataset.src === key) return;          // 같은 사진이면 다시 그리지 않는다(움짤이 처음부터 다시 돌지 않게)
    box.dataset.src = key;
    box.innerHTML = '';
    const alt = (ours && ours['이름']) || '';
    const show = (src, fallback) => {
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

    const total = rows.reduce((acc, m) => acc + (Number(readValue(m)) || 0), 0);
    setText('synergy-sum-total', fmt(total));
    setText('synergy-sum-avg', fmt(Math.round(total / rows.length)));

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
    safeInit('방송통계(시너지)', loadSynergyData);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        setSynergyMetric(synergyMetricFromUrl(params.get('view')));
    }));
});
