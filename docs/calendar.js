    // ===== 일정(캘린더) 페이지 로직 =====
    let calCurrentDate = new Date();
    let calSelectedDateStr = "";
    // 하루짜리 일정과 기간(장기) 일정을 완전히 통합한 단일 배열.
    // 각 항목: { id, startDate, endDate, time(선택), person(타이틀), desc(간략내용),
    //           detail(상세내용, 선택), color }
    // 하루짜리 일정은 startDate === endDate 인 항목일 뿐, 기간 일정과 데이터/렌더링
    // 방식이 완전히 동일하다 (캘린더 칸에 표시되는 방식도, 오늘의 일정/선택한 날짜
    // 목록에 표시되는 방식도 전부 동일한 코드 경로를 탄다).
    let calEvents = [];
    const CAL_DATA_URL = 'data/calendar.json';

    // 날짜별 휴방 멤버 목록 - { "YYYY-MM-DD": ["soopId1", "soopId2"] } 형태.
    // events와 별개로 관리한다(휴방은 시간/제목이 있는 "일정"이 아니라 그날의 멤버
    // 상태에 가까워서, calEvents 배열에 억지로 끼워넣기보다 날짜->멤버ID 맵이 더 자연스럽다).
    let calOffAir = {};
    const calOffAirForDate = (dateStr) => calOffAir[dateStr] || [];

    // 공휴일 목록은 해마다 바뀌므로 코드에 박아두지 않고 별도 JSON(holidays.json)에서
    // fetch해온다 - 새해 공휴일을 추가할 때 코드를 안 건드리고 그 파일만 갱신하면 된다.
    let calPublicHolidays = {};
    const loadPublicHolidays = async () => {
        try {
            const res = await fetch('holidays.json', { cache: 'no-store' });
            if (res.ok) calPublicHolidays = await res.json();
        } catch (e) {
            console.error('공휴일 데이터를 불러오지 못했습니다:', e);
        }
    };

    const calEscapeHTML = (str) => {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag]));
    };

    const calGetFormatDate = (year, month, day) => {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    // "YYYY-MM-DD" -> "YY-MM-DD" ("선택한 날짜 일정" 타이틀에 짧게 표시할 때 사용)
    const calFormatShortDate = (dateStr) => dateStr ? dateStr.slice(2) : '';

    // 일정 배열을 시간순으로 정렬. 시간이 없는 일정은 항상 최상단에 오도록 한다.
    const calSortByTime = (items) => {
        return items.slice().sort((a, b) => {
            const aHas = !!a.time, bHas = !!b.time;
            if (aHas !== bHas) return aHas ? 1 : -1; // 시간 없는 쪽이 먼저
            if (!aHas) return 0; // 둘 다 시간 없음: 등록 순서 유지
            return a.time.localeCompare(b.time);
        });
    };

    // dateStr이 이 일정의 기간(startDate~endDate) 안에 포함되는지 확인.
    // endDate가 없으면(과거 데이터 호환용) startDate와 같은 것으로 취급.
    const calEventCoversDate = (ev, dateStr) => dateStr >= ev.startDate && dateStr <= (ev.endDate || ev.startDate);

    // 특정 날짜에 걸리는 일정들을 시간순으로 반환 - 캘린더 칸/오늘의 일정/선택한 날짜
    // 목록이 전부 이 함수 하나만 사용해서, 하루짜리든 기간이든 완전히 같은 방식으로 다뤄진다.
    const calEventsForDate = (dateStr) => calSortByTime(calEvents.filter(ev => calEventCoversDate(ev, dateStr)));

    // 예전 데이터 형식(schedules: {날짜: [...]}, longTerm: [...])을 새 통합 형식(단일 배열)으로
    // 변환한다. 이미 새 형식(events 배열)으로 저장된 데이터면 그대로 통과시킨다.
    // - 새로 저장할 때는 항상 이 통합 형식(events)만 사용한다.
    const calMigrateData = (parsed) => {
        if (!parsed) return [];
        if (Array.isArray(parsed.events)) return parsed.events;

        const migrated = [];
        const oldSchedules = parsed.schedules || {};
        Object.keys(oldSchedules).forEach(dateStr => {
            (oldSchedules[dateStr] || []).forEach(item => {
                migrated.push({
                    id: item.id, startDate: dateStr, endDate: dateStr,
                    time: item.time || '', person: item.person || '',
                    desc: item.desc || '', detail: item.detail || '', color: item.color,
                });
            });
        });
        (parsed.longTerm || []).forEach(lt => {
            migrated.push({
                id: lt.id, startDate: lt.startDate, endDate: lt.endDate,
                time: lt.time || '', person: lt.title || '',
                desc: lt.desc || '', detail: lt.detail || '', color: lt.color,
            });
        });
        return migrated;
    };

    const calLoadPublicData = async () => {
        try {
            const [scheduleRes] = await Promise.all([
                fetch(CAL_DATA_URL, { cache: 'no-store' }),
                loadPublicHolidays(),
            ]);
            if (scheduleRes.ok) {
                const parsed = await scheduleRes.json();
                calEvents = calMigrateData(parsed);
                calOffAir = (parsed && parsed.offAir) || {};
            }
        } catch (e) {
            console.error(e);
        }
        calRenderCalendar();
    };

    const calGetEventHTML = (item) => {
        const timeHtml = item.time ? `<span class="cal-event-time">${calEscapeHTML(item.time)}</span>` : '';
        const personText = item.person ? `<span class="cal-event-person">${calEscapeHTML(item.person)}</span>` : '';
        return `
            <div class="cal-cell-event" style="background-color: ${item.color || '#eff6ff'};">
                <div class="cal-cell-top">${timeHtml}${personText}</div>
                <div class="cal-event-desc">${calEscapeHTML(item.desc)}</div>
            </div>
        `;
    };

    // 기간(장기) 일정 막대 한 칸(하루치) - 하루짜리 일정 카드(cal-cell-event)와 완전히 같은
    // 2줄 레이아웃(시간·타이틀 / 간략내용)을 매일 그대로 찍어서, 여러 날짜에 걸쳐 이 함수가
    // 반복 호출되며 옆 칸과 이어붙는다. 주(week)가 바뀌어도(달력이 다음 줄로 넘어가도) 계속
    // 이어지는 것처럼 보이도록, 그 주의 첫/마지막 칸(일/토)에서도 끝처럼 둥글게 마감하지
    // 않고 실제 시작일/종료일에서만 둥글게 마감한다.
    const calGetLongTermBarHTML = (ev, dateStr, isWeekStart, isWeekEnd) => {
        const isTrueStart = dateStr === ev.startDate;
        const isTrueEnd = dateStr === ev.endDate;
        const roundLeft = isTrueStart || isWeekStart;
        const roundRight = isTrueEnd || isWeekEnd;
        const bleedLeft = roundLeft ? '0' : '-8px';
        const bleedRight = roundRight ? '0' : '-8px';
        // bleed(음수 마진)만큼 박스가 실제 칸 경계 밖으로 튀어나가는데, 기본 padding(4px)을
        // 그대로 두면 안쪽 텍스트도 그만큼 같이 밀려나가 칸 경계에 딱 붙어버린다(장기 일정을
        // 오른쪽 정렬했을 때 스치듯 붙는 문제). bleed 나가는 쪽만 padding을 8px만큼 더 줘서
        // (4px+8px=12px) 상쇄하면, 텍스트는 항상 "실제 칸 경계에서 4px" 위치를 유지하고,
        // bleed가 없는 하루짜리 일정 카드(패딩 4px)와도 오른쪽/왼쪽 정렬 위치가 정확히 맞는다.
        const padLeft = roundLeft ? '4px' : '12px';
        const padRight = roundRight ? '4px' : '12px';
        const radius = `${roundLeft ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundLeft ? '6px' : '0'}`;
        const timeHtml = ev.time ? `<span class="cal-event-time">${calEscapeHTML(ev.time)}</span>` : '';
        const personHtml = ev.person ? `<span class="cal-event-person">${calEscapeHTML(ev.person)}</span>` : '';
        return `
            <div class="cal-cell-event cal-longterm-bar" style="margin-left:${bleedLeft}; margin-right:${bleedRight}; padding-left:${padLeft}; padding-right:${padRight}; border-radius:${radius}; background-color: ${ev.color || '#ffedd5'};">
                <div class="cal-cell-top">${timeHtml}${personHtml}</div>
                <div class="cal-event-desc">${calEscapeHTML(ev.desc)}</div>
            </div>
        `;
    };

    const calRenderCalendar = () => {
        const year = calCurrentDate.getFullYear();
        const month = calCurrentDate.getMonth();
        document.getElementById('monthTitle').innerText = `${year}년 ${month + 1}월`;

        const firstDayIndex = new Date(year, month, 1).getDay();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const prevLastDay = new Date(year, month, 0).getDate();
        const daysGrid = document.getElementById('daysGrid');
        daysGrid.innerHTML = "";
        const actualToday = new Date();
        const curTodayStr = calGetFormatDate(actualToday.getFullYear(), actualToday.getMonth() + 1, actualToday.getDate());

        for (let i = firstDayIndex; i > 0; i--) {
            daysGrid.insertAdjacentHTML('beforeend', `<div class="cal-day-cell other-month"><span class="cal-day-number">${prevLastDay - i + 1}</span></div>`);
        }

        for (let i = 1; i <= lastDay; i++) {
            const dateStr = calGetFormatDate(year, month + 1, i);
            const dayOfWeek = (firstDayIndex + i - 1) % 7; // 0=일 ... 6=토 (이번 달 1일 앞의 빈 칸까지 포함해 계산)
            const dayDiv = document.createElement('div');
            dayDiv.className = 'cal-day-cell';
            if (dateStr === curTodayStr) dayDiv.classList.add('today');
            if (calPublicHolidays[dateStr]) dayDiv.classList.add('holiday');
            let dayHTML = `<span class="cal-day-number">${i}</span>`;

            // 기간(장기)에 걸친 일정은 날짜 숫자 바로 아래(하루짜리 일정보다 위)에 이어지는
            // 막대로, 하루짜리 일정은 그 아래에 기존과 동일한 카드로 표시한다.
            const dayEvents = calEventsForDate(dateStr);
            const multiDayEvents = dayEvents.filter(ev => ev.endDate && ev.endDate !== ev.startDate);
            const singleDayEvents = dayEvents.filter(ev => !ev.endDate || ev.endDate === ev.startDate);
            multiDayEvents.forEach(ev => { dayHTML += calGetLongTermBarHTML(ev, dateStr, dayOfWeek === 0, dayOfWeek === 6); });
            singleDayEvents.forEach(item => { dayHTML += calGetEventHTML(item); });

            dayDiv.innerHTML = dayHTML;
            dayDiv.onclick = () => calSelectDate(dateStr);
            daysGrid.appendChild(dayDiv);
        }

        const totalCellsCount = firstDayIndex + lastDay;
        const nextDaysCount = totalCellsCount % 7 === 0 ? 0 : 7 - (totalCellsCount % 7);
        for (let i = 1; i <= nextDaysCount; i++) {
            daysGrid.insertAdjacentHTML('beforeend', `<div class="cal-day-cell other-month"><span class="cal-day-number">${i}</span></div>`);
        }

        calRenderTodaySchedules();
        calRenderSelectedDateSchedules();
    };

    const changeMonth = (direction) => {
        calCurrentDate.setMonth(calCurrentDate.getMonth() + direction);
        calRenderCalendar();
    };

    const calSelectDate = (dateStr) => {
        calSelectedDateStr = dateStr;
        // "선택한 날짜 일정" 섹션 제목을 클릭한 날짜에 맞춰 유동적으로 바꾼다 (예: [26-09-09] 일정)
        const titleEl = document.getElementById('selectedListTitle');
        if (titleEl) titleEl.innerText = `[${calFormatShortDate(dateStr)}] 일정`;
        calRenderSelectedDateSchedules();
        if (typeof window.calOnDateSelect === 'function') window.calOnDateSelect(dateStr);
    };

    // "오늘의 일정"/"선택한 날짜 일정" 카드 한 장의 마크업 - 두 목록이 문구(없을 때 안내)만
    // 다르고 완전히 같은 모양이라 공용 함수로 뺐다. type으로 today/selected 각각의
    // CSS 클래스(cal-today-card/cal-selected-card)를 그대로 유지한다.
    const calEventCardHtml = (item, dateStr, type) => {
        const cardClass = type === 'today' ? 'cal-today-card' : 'cal-selected-card';
        return `
            <div class="${cardClass}">
                <div class="cal-card-main">
                    ${item.time ? `<span class="cal-card-time">${calEscapeHTML(item.time)}</span>` : ''} 
                    ${item.person ? `<span class="cal-card-person">${calEscapeHTML(item.person)}</span>` : ''}
                    <span class="cal-card-desc">${calEscapeHTML(item.desc)}${item.detail ? ` <span class="cal-card-detail">${calEscapeHTML(item.detail)}</span>` : ''}</span>
                    ${typeof window.calCardExtra === 'function' ? window.calCardExtra(item, dateStr, type) : ''}
                </div>
            </div>
        `;
    };

    // 휴방자 섹션은 window.calOffAirExtra가 정의돼 있을 때만(사이트/어드민 쪽에서
    // 멤버 사진·이름을 알고 있을 때만) 렌더링한다 - calendar.js 자체는 멤버 정보를
    // 모르기 때문에 calCardExtra와 같은 훅 패턴을 그대로 따른다.
    const calOffAirExtraHtml = (dateStr, type) =>
        typeof window.calOffAirExtra === 'function' ? window.calOffAirExtra(dateStr, type) : '';

    const calRenderTodaySchedules = () => {
        const container = document.getElementById('todayList');
        const today = new Date();
        const curTodayStr = calGetFormatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
        const todayItems = calEventsForDate(curTodayStr);
        const eventsHtml = todayItems.length
            ? todayItems.map(item => calEventCardHtml(item, curTodayStr, 'today')).join('')
            : `<div class="cal-no-schedule">오늘 등록된 일정이 없습니다.</div>`;
        // 휴방자 섹션은 일정 유무와 무관하게 항상 목록 아래에 붙는다.
        container.innerHTML = eventsHtml + calOffAirExtraHtml(curTodayStr, 'today');
    };

    const calRenderSelectedDateSchedules = () => {
        const container = document.getElementById('selectedDateList');
        if (!calSelectedDateStr) {
            container.innerHTML = `<div class="cal-no-schedule">날짜를 클릭하세요.</div>`;
            return;
        }
        const daySchedules = calEventsForDate(calSelectedDateStr);
        const eventsHtml = daySchedules.length
            ? daySchedules.map(item => calEventCardHtml(item, calSelectedDateStr, 'selected')).join('')
            : `<div class="cal-no-schedule">등록된 일정이 없습니다.</div>`;
        container.innerHTML = eventsHtml + calOffAirExtraHtml(calSelectedDateStr, 'selected');
    };
