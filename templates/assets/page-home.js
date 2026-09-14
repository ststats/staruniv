/* ==========================================================================
   staruniv - page-home.js
   Supports 10(today schedule), 13(uptime bottom-right)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 10번: 히어로 섹션 오늘의 일정 로드
  async function loadTodaySchedule() {
    const listEl = document.getElementById('heroTodayScheduleList');
    if (!listEl) return;

    try {
      const res = await fetch('/data/calendar.json');
      if (res.ok) {
        const data = await res.json();
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayEvents = data.filter(e => e.date === todayStr || (e.startDate <= todayStr && e.endDate >= todayStr));
        
        if (todayEvents.length === 0) {
          listEl.innerHTML = '<li class="empty-msg">오늘 예정된 매치 및 일정이 없습니다.</li>';
        } else {
          listEl.innerHTML = todayEvents.map(e => `
            <li class="schedule-item">
              <span class="schedule-time">${e.time || '종일'}</span>
              <span class="schedule-title">${e.title}</span>
            </li>
          `).join('');
        }
      }
    } catch(e) {
      listEl.innerHTML = '<li class="empty-msg">일정을 불러올 수 없습니다.</li>';
    }
  }

  // 13번 & 14번: 방송중 카드 렌더링 (라이브 뱃지 좌상단, 방송시간 우하단)
  function renderLiveCard(stream) {
    return `
      <div class="stream-card cut-box">
        <div class="stream-card-thumb">
          <!-- 13번: LIVE 뱃지 좌상단 -->
          <span class="badge-live">LIVE</span>
          <img src="${stream.thumbnailUrl}" alt="${stream.bjName}">
          <!-- 13번: 방송시간은 우측 하단으로 이동 -->
          <span class="stream-uptime">${stream.uptime || '00:00:00'}</span>
        </div>
        <!-- 14번: 상하여백 축소된 본문 -->
        <div class="stream-card-info">
          <h4 class="stream-title">${stream.title}</h4>
          <span class="stream-bj">${stream.bjName}</span>
        </div>
      </div>
    `;
  }

  loadTodaySchedule();
});
