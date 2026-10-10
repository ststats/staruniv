// 일정 페이지(캘린더 · 연혁 탭). 로드 순서: core.js → api.js → calendar.js → media-lightbox.js → history.js → 이 파일

// calendar.js는 멤버 정보를 모르므로 휴방 멤버 칩은 이 훅이 채운다.
// 휴방자가 없어도 줄은 남겨 날마다 레이아웃이 같게 한다.
window.calOffAirExtra = (dateStr, type) => {
    const soopIds = calOffAirForDate(dateStr);
    const chips = soopIds.length
        ? soopIds
              .map(soopId => {
                  const m = findMemberBySoopId(soopId);
                  const name = m ? m['이름'] : soopId;
                  return `<div class="cal-offair-chip" data-offair-date="${escapeHTML(dateStr)}" data-soop-id="${escapeHTML(soopId)}">${avatarHtml(soopId, 'cal-offair-avatar')}<span class="cal-offair-name">${escapeHTML(name)}</span></div>`;
              })
              .join('')
        : '<span class="cal-offair-none">없음</span>';
    return `<div class="cal-offair-section"><div class="cal-offair-label">휴방</div><div class="cal-offair-chips">${chips}</div></div>`;
};

// scripts/capture_calendar.mjs가 찍는 주소. 캡처는 늘 라이트 테마다.
if (new URLSearchParams(location.search).get('capture') === 'calendar') {
    document.body.classList.add('calendar-capture');
    if (typeof applyTheme === 'function') applyTheme('light');
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
