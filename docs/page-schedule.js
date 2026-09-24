/**
 * 일정 페이지: 월간 캘린더 + 오늘/선택한 날짜 일정, 연혁 탭. (core.js → calendar.js → history.js → 이 파일)
 * URL: /schedule/ (일정), /schedule/?view=history (연혁)
 * 캘린더 자체 로직은 관리자 페이지와 공용인 calendar.js에 있고, 여기서는 멤버 정보가 필요한
 * 훅(휴방 멤버 칩)만 채운다.
 */

// 캘린더 "오늘의 일정"/"선택한 날짜 일정" 카드 아래에 그 날 휴방하는 멤버를 프로필 사진 +
// 이름 칩으로 보여준다. calendar.js는 멤버 정보를 모르기 때문에 이 훅으로 내용을 채워 넣는다.
// 휴방자가 없는 날은 섹션 자체가 안 보이게 빈 문자열을 반환한다.
window.calOffAirExtra = (dateStr, type) => {
    const soopIds = calOffAirForDate(dateStr);
    if (!soopIds.length) return '';
    const chips = soopIds.map(soopId => {
        const m = findMemberBySoopId(soopId);
        const name = m ? m['이름'] : soopId;
        return `<div class="cal-offair-chip" data-offair-date="${escapeHTML(dateStr)}" data-soop-id="${escapeHTML(soopId)}">${avatarHtml(soopId, 'cal-offair-avatar')}<span class="cal-offair-name">${escapeHTML(name)}</span></div>`;
    }).join('');
    return `<div class="cal-offair-section"><div class="cal-offair-label">휴방</div><div class="cal-offair-chips">${chips}</div></div>`;
};

// 정적 캘린더 이미지 생성도 실제 페이지 DOM과 CSS를 그대로 사용한다.
// 캡처 전용 쿼리는 표시할 영역만 고정하며, capture.js가 런타임 스타일을 덮어쓰지 않게 한다.
if (new URLSearchParams(location.search).get('capture') === 'calendar') {
    document.body.classList.add('calendar-capture');
}

const SCHEDULE_TABS = { calendar: ['tab-calendar', 'view-calendar'], history: ['tab-history', 'view-history'] };
let historyRendered = false;

function switchScheduleView(view) {
    const key = view === 'history' ? 'history' : 'calendar';
    activateTabView(SCHEDULE_TABS, key);
    if (key === 'history' && !historyRendered) {
        historyRendered = true;
        safeInit('연혁', renderHistory);
    }
    PageState.update(key === 'history' ? { view: 'history' } : {});
}

async function renderHistory() {
    const root = document.getElementById('history-root');
    if (!root) return;
    if (document.body.dataset.adminPage === 'schedule' && window.StarUnivAdminHistory?.render) {
        await window.StarUnivAdminHistory.render();
        return;
    }
    const data = await histLoadData();
    historyItems = histMergeItems(data, SiteData.members, false);
    histRegisterItems(historyItems);
    drawHistory();
}

let historyItems = [];
let historyType = '';
function drawHistory() {
    const root = document.getElementById('history-root');
    const shown = historyType ? historyItems.filter(x => x.type === historyType) : historyItems;
    root.innerHTML = histHeadHtml(historyItems, historyType, 'pickHistoryType')
        + histTimelineHtml(shown, { members: SiteData.members, avatarUrl: getProfileImgUrl });
    if (typeof initEdgeFades === 'function') initEdgeFades(root);
}
function pickHistoryType(type) {
    historyType = HISTORY_TYPES[type] ? type : '';
    drawHistory();
}

bootPage(() => {
    safeInit('일정표', () => {
        calSelectedDateStr = calTodayStr();
        return calLoadPublicData();
    });
    safeInit('URL 상태 복원', () => PageState.bindRestore(params => {
        switchScheduleView(params.get('view') || runtimeDefaultSubtab('schedule','calendar'));
    }));
});
