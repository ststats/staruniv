// 일정 페이지(캘린더 · 연혁 탭). 로드 순서: core.js → api.js → calendar.js → media-lightbox.js → history.js → 이 파일

// calendar.js는 멤버 정보를 모르므로 휴방 멤버 줄은 이 훅이 채운다(참가자와 같은 사람 줄).
// 휴방자가 없어도 줄은 남겨 날마다 레이아웃이 같게 한다. 관리자는 이 줄을 눌러 그날 휴방을 고친다(data-offair-date).
window.calOffAirExtra = dateStr => {
    const soopIds = calOffAirForDate(dateStr);
    const people = soopIds.length
        ? histPeopleRowHtml(
              soopIds.map(soopId => ({ name: findMemberBySoopId(soopId)?.['이름'] || soopId, soop_id: soopId })),
              SiteData.members,
              getProfileImgUrl
          )
        : '<span class="cal-offair-none">없음</span>';
    const editable = soopIds.length ? ` data-offair-date="${escapeHTML(dateStr)}"` : '';
    return `<div class="cal-offair-section"><div class="cal-offair-label">휴방</div><div class="cal-offair-chips"${editable}>${people}</div></div>`;
};

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
    let data;
    try {
        data = await histLoadData();
    } catch (e) {
        console.error('연혁 조회 실패:', e);
        root.innerHTML = HIST_LOAD_FAILED_HTML;
        historyRendered = false; // 탭을 다시 열면 다시 받는다
        return;
    }
    const items = histMergeItems(data, SiteData.members, false);
    histRegisterItems(items);
    window.histRedraw = () => {
        histRenderTypeBar(items);
        root.innerHTML = histTimelineHtml(histFilterItems(items), {
            members: SiteData.members,
            avatarUrl: getProfileImgUrl,
        });
    };
    window.histRedraw();
}

bootPage(
    () => {
        safeInit('일정표', () => {
            calSelectedDateStr = calTodayStr();
            return calLoadPublicData();
        });
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                switchScheduleView(params.get('view') || runtimeDefaultSubtab('schedule', 'calendar'));
            })
        );
    },
    {
        prefetch: calPrefetchPublicData,
        view: params =>
            activateTabView(
                SCHEDULE_TABS,
                (params.get('view') || runtimeDefaultSubtab('schedule', 'calendar')) === 'history'
                    ? 'history'
                    : 'calendar'
            ),
    }
);
