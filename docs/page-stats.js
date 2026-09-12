/**
 * 방송통계 페이지: 남/여 멤버별 방송 지표 순위표. (core.js → 이 파일)
 * URL: /stats/[?view=hours|viewers|sponsor]
 */

// 지표별 설정을 한 곳에 모았다: 탭 라벨 / URL에 노출되는 짧은 값 / 표시 형식 / 정렬 기준.
// (예전엔 라벨·URL 변환표 2개·표시 if문·정렬 if문이 4군데에 흩어져 있었다)
const SYNERGY_METRICS = {
    balloons: {
        label: '별풍선', url: 'balloons',
        format: m => formatCount(m.balloons, '개'),
    },
    broadcast_seconds: {
        label: '방송시간', url: 'hours',
        format: m => formatSecondsToHM(m.broadcast_seconds),
    },
    cumulative_viewers: {
        label: '누적시청자', url: 'viewers',
        format: m => formatCount(m.cumulative_viewers, '명'),
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

function synergyRowHtml(m, idx) {
    const ours = m.ourMember;
    const name = ours['이름'] || m.nickname;
    // 알 수 없는 지표면(직접 호출된 경우) 예전처럼 스폰전적 형식으로 표시
    const displayVal = (synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor).format(m);

    return `
        <tr>
            <td class="text-center text-secondary fw-bold colw-20 text-nowrap">${idx + 1}</td>
            <td class="text-center colw-40">
                <span class="d-flex align-items-center justify-content-center gap-2 min-w-0">
                    ${avatarHtml(ours['SOOP ID'], 'player-avatar-sm')}
                    <span class="fw-bold ellipsis-text text-nowrap">${escapeHTML(name)}</span>
                </span>
            </td>
            <td class="text-center fw-bold colw-40 text-nowrap synergy-value">${escapeHTML(displayVal)}</td>
        </tr>`;
}

function sortSynergyRows(rows) {
    const metric = SynergyState.metric;
    const config = synergyMetricConfig(metric);
    const value = config && config.sortValue ? config.sortValue : (m => m[metric] || 0);
    return rows.slice().sort((a, b) => value(b) - value(a));
}

function renderSynergyTable() {
    if (!SynergyState.data) return;
    const active = SynergyState.data.filter(m => m.active);
    const noData = emptyRowHtml(3, '표시할 멤버가 없습니다.');
    [['synergy-tbody-male', '남자'], ['synergy-tbody-female', '여자']].forEach(([tbodyId, gender]) => {
        const rows = sortSynergyRows(active.filter(m => m.ourMember['성별'] === gender));
        document.getElementById(tbodyId).innerHTML = rows.length ? rows.map(synergyRowHtml).join('') : noData;
    });
}

bootPage(() => {
    safeInit('방송통계(시너지)', loadSynergyData);
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        setSynergyMetric(synergyMetricFromUrl(params.get('view')));
    }));
});
