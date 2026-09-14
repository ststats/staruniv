/* ==========================================================================
   staruniv - calendar.js
   Supports 17(color classes), 18(remove today blue bg), 19(multi-day span bar)
   ========================================================================== */

(function() {
  let currentDate = new Date(2026, 8, 1); // 2026년 9월
  let scheduleData = [];

  async function loadSchedule() {
    try {
      const res = await fetch('/data/calendar.json');
      if (res.ok) {
        scheduleData = await res.json();
      }
    } catch(e) {
      console.warn('Calendar data load failed, using demo data', e);
    }
    renderCalendar();
  }

  function renderCalendar() {
    const gridEl = document.getElementById('calendarGrid');
    const monthEl = document.getElementById('calCurrentMonth');
    if (!gridEl) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (monthEl) {
      monthEl.textContent = `${year}.${String(month + 1).padStart(2, '0')}`;
    }

    gridEl.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    // 이전 달 잔여 일수
    for (let i = firstDayIndex; i > 0; i--) {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell is-prev-month';
      cell.innerHTML = `<span class="cell-date-num">${prevLastDate - i + 1}</span>`;
      gridEl.appendChild(cell);
    }

    // 이번 달 일수
    for (let d = 1; d <= lastDate; d++) {
      const cell = document.createElement('div');
      const isTodayCell = isCurrentMonth && d === todayDate;

      // 18번: 오늘 날짜에 파란 배경색과 내용 파란박스 제거, 날짜 뱃지만 유지
      cell.className = `calendar-cell ${isTodayCell ? 'is-today' : ''}`;
      
      const badgeClass = isTodayCell ? 'cell-date-badge is-today-badge' : 'cell-date-num';
      cell.innerHTML = `<span class="${badgeClass}">${d}</span><div class="cell-events-container"></div>`;
      
      const eventContainer = cell.querySelector('.cell-events-container');
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // 해당 날짜의 이벤트 필터링
      const events = scheduleData.filter(e => {
        if (e.startDate && e.endDate) {
          return dateStr >= e.startDate && dateStr <= e.endDate;
        }
        return e.date === dateStr || e.startDate === dateStr;
      });

      events.forEach(ev => {
        const evEl = document.createElement('div');
        // 17번: 색상 클래스 적용 (빨주노초파남보회검)
        const colorClass = ev.color ? `event-${ev.color}` : 'event-blue';
        
        // 19번: 연속 일정(Multi-day) 여부에 따른 bar 스타일 적용
        const isMultiDay = ev.startDate && ev.endDate && ev.startDate !== ev.endDate;
        const spanClass = isMultiDay ? 'event-span-bar' : 'event-single';

        evEl.className = `cal-event-pill ${colorClass} ${spanClass}`;
        evEl.textContent = ev.title;
        evEl.title = `${ev.title} (${ev.startDate || ev.date})`;
        eventContainer.appendChild(evEl);
      });

      gridEl.appendChild(cell);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('calPrevBtn')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById('calNextBtn')?.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
    });
    document.getElementById('calTodayBtn')?.addEventListener('click', () => {
      currentDate = new Date();
      renderCalendar();
    });

    loadSchedule();
  });
})();
