    // ===== 일정(캘린더) 페이지 로직 =====
    let calCurrentDate = new Date();
    let calSelectedDateStr = "";
    let calSchedules = {};
    // 장기 일정(예: 장기휴방)의 시작일~종료일 범위 목록. 하루짜리 일정(calSchedules)과는
    // 완전히 별도로 관리해서, 기존 하루 단위 로직은 전혀 안 건드리고 그대로 둔다.
    // 각 항목: { id, title, startDate, endDate, time(선택), color, detail(선택) }
    let calLongTerm = [];
    const CAL_DATA_URL = 'data/calendar.json';

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

    // 일정 배열을 시간순으로 정렬. 시간이 없는 일정은 항상 최상단에 오도록 한다.
    const calSortByTime = (items) => {
        return items.slice().sort((a, b) => {
            const aHas = !!a.time, bHas = !!b.time;
            if (aHas !== bHas) return aHas ? 1 : -1; // 시간 없는 쪽이 먼저
            if (!aHas) return 0; // 둘 다 시간 없음: 등록 순서 유지
            return a.time.localeCompare(b.time);
        });
    };

    // dateStr이 장기 일정 기간(startDate~endDate) 안에 포함되는지 확인
    const calLongTermCoversDate = (lt, dateStr) => dateStr >= lt.startDate && dateStr <= lt.endDate;

    // "오늘의 일정"/"선택한 날짜 일정" 목록에서 하루짜리 일정과 같은 모양으로 다루기 위해,
    // 장기 일정을 그 목록 카드 템플릿이 그대로 먹을 수 있는 형태(item)로 변환한다.
    // person 자리엔 제목을, desc 자리엔 전체 기간을 넣고, time 자리엔 "(입력한 시간 ·) 장기"를
    // 넣어서 하루짜리 일정과 한눈에 구분되게 한다. _longTerm/id는 편집·삭제 버튼(calCardExtra)이
    // "이 항목이 장기 일정인지 + 몇 번째 항목인지"를 알 수 있도록 붙여두는 표식이다.
    const calLongTermToItem = (lt) => ({
        id: lt.id,
        _longTerm: true,
        time: (lt.time ? `${lt.time} · ` : '') + '장기',
        person: lt.title,
        desc: `${lt.startDate} ~ ${lt.endDate}`,
        detail: lt.detail || '',
        color: lt.color || '#ffedd5',
    });

    const calLongTermItemsForDate = (dateStr) => calLongTerm.filter(lt => calLongTermCoversDate(lt, dateStr)).map(calLongTermToItem);
    
    const calLoadPublicData = async () => {
        try {
            const [scheduleRes] = await Promise.all([
                fetch(CAL_DATA_URL, { cache: 'no-store' }),
                loadPublicHolidays(),
            ]);
            if (scheduleRes.ok) {
                const parsed = await scheduleRes.json();
                calSchedules = parsed.schedules || parsed;
                calLongTerm = parsed.longTerm || [];
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

    // 장기 일정 막대 한 칸(하루치) - 여러 날짜에 걸쳐 이 함수가 반복 호출되면서
    // 옆 칸의 막대와 이어붙는다. 주(week)가 바뀌어도(달력이 다음 줄로 넘어가도)
    // 계속 이어지는 것처럼 보이도록, 그 주의 첫/마지막 칸(일/토)에서도 끝처럼
    // 둥글게 마감하지 않고 실제 시작일/종료일에서만 둥글게 마감한다.
    // isWeekStart/isWeekEnd는 "이번 줄의 맨 왼쪽/오른쪽 칸이라 옆 칸 막대와 이어붙일
    // 수 없는 경계"를 뜻하고, 그 경우에만 살짝 둥글게 마감해 시각적으로 자연스럽게 끊는다.
    const calGetLongTermBarHTML = (lt, dateStr, isWeekStart, isWeekEnd) => {
        const isTrueStart = dateStr === lt.startDate;
        const isTrueEnd = dateStr === lt.endDate;
        const roundLeft = isTrueStart || isWeekStart;
        const roundRight = isTrueEnd || isWeekEnd;
        const showLabel = isTrueStart || isWeekStart;
        const bleedLeft = roundLeft ? '0' : '-8px';
        const bleedRight = roundRight ? '0' : '-8px';
        const radius = `${roundLeft ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundLeft ? '6px' : '0'}`;
        return `<div class="cal-longterm-bar" style="margin-left:${bleedLeft}; margin-right:${bleedRight}; border-radius:${radius}; background-color:${lt.color || '#ffedd5'};">${showLabel ? `<span class="cal-longterm-bar-label">${calEscapeHTML(lt.title)}</span>` : ''}</div>`;
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

            // 장기 일정 막대는 항상 날짜 숫자 바로 아래(하루짜리 일정보다 위)에 고정해서,
            // 그 날 하루짜리 일정이 몇 개 있든 상관없이 같은 줄의 막대들이 수평으로 나란히 보이게 한다.
            const coveringLongTerm = calLongTerm.filter(lt => calLongTermCoversDate(lt, dateStr));
            coveringLongTerm.forEach(lt => {
                dayHTML += calGetLongTermBarHTML(lt, dateStr, dayOfWeek === 0, dayOfWeek === 6);
            });

            if (calSchedules[dateStr] && calSchedules[dateStr].length > 0) {
                calSortByTime(calSchedules[dateStr]).forEach(item => { dayHTML += calGetEventHTML(item); });
            }
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
                    <div class="cal-card-dot" style="background-color: ${item.color || '#eff6ff'};"></div>
                    ${item.time ? `<span class="cal-card-time">${calEscapeHTML(item.time)}</span>` : ''} 
                    ${item.person ? `<span class="cal-card-person">${calEscapeHTML(item.person)}</span>` : ''}
                    <span class="cal-card-desc">${calEscapeHTML(item.desc)}${item.detail ? ' ' + calEscapeHTML(item.detail) : ''}</span>
                    ${typeof window.calCardExtra === 'function' ? window.calCardExtra(item, dateStr, type) : ''}
                </div>
            </div>
        `;
    };
    
    const calRenderTodaySchedules = () => {
        const container = document.getElementById('todayList');
        const today = new Date();
        const curTodayStr = calGetFormatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
        // 장기 일정(있다면)을 먼저 보여주고, 그 다음 하루짜리 일정을 시간순으로 보여준다.
        const todayItems = [...calLongTermItemsForDate(curTodayStr), ...calSortByTime(calSchedules[curTodayStr] || [])];
        if (todayItems.length === 0) { 
            container.innerHTML = `<div class="cal-no-schedule">오늘 등록된 일정이 없습니다.</div>`; 
            return; 
        }
        container.innerHTML = todayItems.map(item => calEventCardHtml(item, curTodayStr, 'today')).join('');
    };
    
    const calRenderSelectedDateSchedules = () => {
        const container = document.getElementById('selectedDateList');
        if (!calSelectedDateStr) { 
            container.innerHTML = `<div class="cal-no-schedule">날짜를 클릭하세요.</div>`; 
            return; 
        }
        const daySchedules = [...calLongTermItemsForDate(calSelectedDateStr), ...calSortByTime(calSchedules[calSelectedDateStr] || [])];
        if (daySchedules.length === 0) { 
            container.innerHTML = `<div class="cal-no-schedule">등록된 일정이 없습니다.</div>`; 
            return; 
        }
        container.innerHTML = daySchedules.map(item => calEventCardHtml(item, calSelectedDateStr, 'selected')).join('');
    };

