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
        label: '스폰전적', url: 'sponsor',
        format: m => formatSponsorRecord(m.sponsor_wins, m.sponsor_losses),
        // 표시는 승패/승률이지만, 정렬은 판수(승+패)가 많은 순 - 승수 기준이 아니다.
        sortValue: m => (m.sponsor_wins || 0) + (m.sponsor_losses || 0),
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
        document.getElementById('synergy-updated').innerText = SynergyState.updatedAt ? `업데이트: ${SynergyState.updatedAt}` : '';
        renderSynergyTable();
    } catch (e) {
        console.error(e);
        const errRow = emptyRowHtml(3, '데이터를 불러오지 못했습니다.');
        document.getElementById('synergy-tbody-male').innerHTML = errRow;
        document.getElementById('synergy-tbody-female').innerHTML = errRow;
    }
}

function setSynergyMetric(metric) {
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

// [리디자인] 순위를 그냥 숫자로 두면 10명을 훑을 때 위아래 격차가 안 읽힌다.
// 1~3위는 각진 플레이트로 올리고(1위 잉크 / 2위 딥블루 / 3위 블루), 값에는 1위를
// 100%로 잡은 비율 바를 깔아서 숫자를 비교하지 않아도 격차가 보이게 한다.
// topValue는 renderSynergyTable이 정렬된 첫 행에서 구해 넘긴다.
function synergyRowHtml(m, idx, topValue) {
    const ours = m.ourMember;
    const name = ours['이름'] || m.nickname;
    // 알 수 없는 지표면(직접 호출된 경우) 예전처럼 스폰전적 형식으로 표시
    const config = synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor;
    const displayVal = config.format(m);

    const rank = idx + 1;
    const rankClass = rank <= 3 ? ` top r${rank}` : '';

    // 비율 바 - 스폰전적처럼 정렬 기준이 따로 있는 지표도 sortValue로 같이 처리된다.
    const readValue = config.sortValue ? config.sortValue : (row => row[SynergyState.metric] || 0);
    const value = Number(readValue(m)) || 0;
    const top = Number(topValue) || 0;
    // 0%면 바가 아예 안 보여서 "값이 없다"와 "아주 작다"가 구분되지 않는다 - 최소 2%는 남긴다.
    const pct = top > 0 && value > 0 ? Math.max(2, Math.round(value / top * 100)) : 0;

    return `
        <tr>
            <td class="text-center colw-20 text-nowrap"><span class="synergy-rank${rankClass}">${rank}</span></td>
            <td class="text-center colw-40">
                <span class="d-flex align-items-center justify-content-center gap-2 min-w-0">
                    ${avatarHtml(ours['SOOP ID'], 'player-avatar-sm')}
                    <span class="fw-bold ellipsis-text text-nowrap">${escapeHTML(name)}</span>
                </span>
            </td>
            <td class="text-center fw-bold colw-40 text-nowrap synergy-value">
                <span class="synergy-val-text">${escapeHTML(displayVal)}</span>
                <span class="synergy-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
            </td>
        </tr>`;
}

function sortSynergyRows(rows) {
    const metric = SynergyState.metric;
    const config = synergyMetricConfig(metric);
    const value = config && config.sortValue ? config.sortValue : (m => m[metric] || 0);
    return rows.slice().sort((a, b) => value(b) - value(a));
}

// [리디자인] 표 위 요약 타일 3개(합계 / 1위 / 집계 인원)를 채운다.
// 지표마다 단위가 달라서(개, 시간, 명, 전적) config.format을 그대로 쓴다.
// 스폰전적처럼 합계가 의미 없는 지표는 합계 칸을 비우고 라벨만 바꾼다.
function renderSynergySummary(rows) {
    const box = document.getElementById('synergy-summary');
    if (!box) return;
    const config = synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor;
    const readValue = config.sortValue ? config.sortValue : (row => row[SynergyState.metric] || 0);

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('synergy-sum-label', (config.label || 'TOTAL'));
    setText('synergy-sum-count', rows.length ? `${rows.length}명` : '-');

    if (!rows.length) {
        setText('synergy-sum-total', '-');
        setText('synergy-sum-top', '-');
        setText('synergy-sum-top-name', '1위');
        return;
    }

    // 합계 - 숫자 지표만. 스폰전적은 '12승 4패' 같은 문자열이라 더할 수 없다.
    const summable = SynergyState.metric !== 'sponsor';
    if (summable) {
        const total = rows.reduce((acc, m) => acc + (Number(readValue(m)) || 0), 0);
        // 합계도 각 행과 같은 서식으로 보여준다(시간이면 '421시간' 처럼).
        setText('synergy-sum-total', config.formatValue ? config.formatValue(total) : total.toLocaleString('ko-KR'));
    } else {
        setText('synergy-sum-total', '—');
    }

    const top = rows[0];
    setText('synergy-sum-top', config.format(top));
    setText('synergy-sum-top-name', (top.ourMember['이름'] || top.nickname || '1위'));
}

function renderSynergyTable() {
    if (!SynergyState.data) return;
    const active = SynergyState.data.filter(m => m.active);
    // 요약 타일은 남녀를 합친 전체 순위를 기준으로 한다.
    renderSynergySummary(sortSynergyRows(active));
    const noData = emptyRowHtml(3, '표시할 멤버가 없습니다.');
    [['synergy-tbody-male', '남자'], ['synergy-tbody-female', '여자']].forEach(([tbodyId, gender]) => {
        const rows = sortSynergyRows(active.filter(m => m.ourMember['성별'] === gender));
        // 비율 바의 기준값 = 이 표 1위의 값. 남녀 표가 따로라 각 표의 1위를 기준으로 잡는다.
        const config = synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor;
        const readValue = config.sortValue ? config.sortValue : (row => row[SynergyState.metric] || 0);
        const topValue = rows.length ? Number(readValue(rows[0])) || 0 : 0;
        document.getElementById(tbodyId).innerHTML = rows.length
            ? rows.map((m, i) => synergyRowHtml(m, i, topValue)).join('')
            : noData;
    });
}

bootPage(() => {
    safeInit('방송통계(시너지)', loadSynergyData);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        setSynergyMetric(synergyMetricFromUrl(params.get('view')));
    }));
});
