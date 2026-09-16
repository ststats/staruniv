/**
 * 일정 페이지: 월간 캘린더 + 오늘/선택한 날짜 일정. (core.js → calendar.js → 이 파일)
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
        return `<div class="cal-offair-chip">${avatarHtml(soopId, 'cal-offair-avatar')}<span class="cal-offair-name">${escapeHTML(name)}</span></div>`;
    }).join('');
    return `<div class="cal-offair-section"><div class="cal-offair-label">휴방</div><div class="cal-offair-chips">${chips}</div></div>`;
};

bootPage(() => {
    safeInit('일정표', () => {
        calSelectedDateStr = calTodayStr();
        return calLoadPublicData();
    });
});
