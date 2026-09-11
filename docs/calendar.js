    // ===== 일정(캘린더) 페이지 로직 =====
    // 사이트 본편(index.html + app.js)과 관리자 페이지(admin.html) 양쪽이 이 파일을 그대로 쓴다.
    //
    // [공개 인터페이스 - 이름을 바꾸면 admin.html/app.js가 깨진다]
    //   상태: calEvents, calOffAir(admin이 직접 재할당/수정), calSelectedDateStr(app.js가 대입)
    //   함수: calEscapeHTML, calGetFormatDate, calTodayStr, calMigrateData, loadPublicHolidays,
    //         calLoadPublicData, calRenderCalendar, changeMonth, calSelectDate, calOffAirForDate,
    //         calRenderTodaySchedules, calRenderSelectedDateSchedules
    //   훅(window): calCardExtra, calOnDateSelect, calOffAirExtra, calOffAirMemberName
    // admin.html은 이 파일의 let 변수들을 전역 이름으로 직접 대입하므로(calEvents = ...),
    // 상태 객체로 감싸지 않고 전역 let 바인딩을 그대로 유지한다.
    //
    // [리팩토링 메모]
    // - 월 이동 버그 수정: 오늘이 31일이면 setMonth(+1)이 30일까지인 달을 건너뛰었다
    //   (예: 8/31 → "9/31" = 10/1 → 10월 표시). 이동 전에 날짜를 1일로 맞춘다.
    // - 달력 칸을 칸마다 insertAdjacentHTML/appendChild(최대 42번 DOM 조작 + 칸마다 클로저)
    //   하던 것을 문자열 하나로 모아 innerHTML 한 번으로 그리고, 클릭은 그리드에 이벤트 위임.
    // - 이번 달에 걸치는 일정만 먼저 추려두고 날짜별로는 그 안에서만 찾는다(칸마다 전체 일정 스캔 제거).
    // - 일정 색상(color)을 style 속성에 이스케이프 없이 넣던 부분을 검증 후 넣도록 수정.
    // - "오늘 날짜 문자열" 계산이 여러 곳(캘린더/오늘의 일정/app.js/admin)에 복붙돼 있던 것을 calTodayStr로 통일.
    let calCurrentDate = new Date();
    let calSelectedDateStr = "";
    // 하루짜리 일정과 기간(장기) 일정을 완전히 통합한 단일 배열.
    // 각 항목: { id, startDate, endDate, time(선택), person(타이틀), desc(간략내용),
    //           detail(상세내용, 선택), color }
    // 하루짜리 일정은 startDate === endDate 인 항목일 뿐, 기간 일정과 데이터/렌더링 방식이 동일하다.
    let calEvents = [];
    const CAL_DATA_URL = 'data/calendar.json';

    // 날짜별 휴방 멤버 목록 - { "YYYY-MM-DD": ["soopId1", "soopId2"] } 형태.
    // 휴방은 시간/제목이 있는 "일정"이 아니라 그날의 멤버 상태라 calEvents와 별개로 관리한다.
    let calOffAir = {};
    const calOffAirForDate = (dateStr) => (calOffAir && Array.isArray(calOffAir[dateStr])) ? calOffAir[dateStr] : [];

    // '김윤환'이 휴방으로 등록된 날은 달력 칸 맨 위(다른 일정보다 위)에 노란 "휴방" 표시를
    // 붙여준다 - 달력 칸 자체에만 표시되고, 연속으로 휴방이면 장기 일정 막대처럼 이어붙인다.
    const CAL_YOUNHWAN_NAME = '김윤환';
    const CAL_YOUNHWAN_SHORT = '윤환';
    const CAL_YOUNHWAN_COLOR = '#fff3b0';
    const CAL_DEFAULT_EVENT_COLOR = '#eff6ff';
    const CAL_DEFAULT_LONGTERM_COLOR = '#ffedd5';

    // HTML 이스케이프 (admin.html이 escapeHTML이라는 이름으로 재사용한다).
    // app.js의 escapeHTML과 달리 falsy 값(0 포함)은 빈 문자열이 되는데, 일정 필드는 항상
    // 문자열이라 차이가 없고 admin.html 동작을 바꾸지 않기 위해 그대로 둔다.
    const calEscapeHTML = (str) => {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag]));
    };

    const calGetFormatDate = (year, month, day) => {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    const calDateToStr = (d) => calGetFormatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    // 오늘 날짜(로컬 기준) "YYYY-MM-DD"
    const calTodayStr = () => calDateToStr(new Date());

    const calShiftDate = (dateStr, delta) => {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        return calDateToStr(d);
    };

    // 일정 색상은 style 속성에 들어가므로, 색상 형식(#hex / rgb()·hsl() / 영문 색 이름)만 허용한다.
    // 어드민의 <input type="color">는 항상 #rrggbb라 정상 데이터는 그대로 통과한다.
    const CAL_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([\w\s.,%\/]+\)|[a-zA-Z]+)$/;
    const calSafeColor = (color, fallback) => {
        const c = String(color || '').trim();
        return c && CAL_COLOR_PATTERN.test(c) ? c : fallback;
    };

    // calendar.js는 멤버 정보를 모르고 soopId만 다루므로, soopId -> 이름 변환은 app.js/admin이
    // 걸어둔 훅(window.calOffAirMemberName)에 맡긴다. 훅이 없는 페이지에서는 false.
    const calIsYounhwanOffAir = (dateStr) => {
        if (typeof window.calOffAirMemberName !== 'function') return false;
        return calOffAirForDate(dateStr).some(soopId => window.calOffAirMemberName(soopId) === CAL_YOUNHWAN_NAME);
    };

    // 이어붙는 막대(장기 일정/김윤환 휴방)의 좌우 모서리 스타일. 옆 칸과 이어지는 쪽은 각지게 하고
    // 칸 경계 밖으로 살짝 튀어나가게(bleed) 해서 끊김 없이 이어진 것처럼 보이게 하고, 끊기는 쪽은
    // 둥글게 마감한다. bleed(-8px)만큼 padding을 8px 더 줘서(4px+8px=12px) 텍스트는 항상
    // "칸 경계에서 4px" 위치를 유지한다 - 하루짜리 일정 카드(패딩 4px)와도 정렬이 맞는다.
    const calBarEdgeStyle = (roundLeft, roundRight) => ({
        bleedLeft: roundLeft ? '0' : '-8px',
        bleedRight: roundRight ? '0' : '-8px',
        padLeft: roundLeft ? '4px' : '12px',
        padRight: roundRight ? '4px' : '12px',
        radius: `${roundLeft ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundRight ? '6px' : '0'} ${roundLeft ? '6px' : '0'}`,
    });

    // 달력 칸 안의 일정 카드/막대 공용 마크업. bar가 있으면 이어붙는 막대 스타일을 적용한다.
    const calCellEventHtml = ({ timeText, personText, descText, color, bar }) => {
        const timeHtml = timeText ? `<span class="cal-event-time">${calEscapeHTML(timeText)}</span>` : '';
        const personHtml = personText ? `<span class="cal-event-person">${calEscapeHTML(personText)}</span>` : '';
        const descHtml = descText ? `<div class="cal-event-desc">${calEscapeHTML(descText)}</div>` : '';
        const barStyle = bar
            ? `margin-left:${bar.bleedLeft}; margin-right:${bar.bleedRight}; padding-left:${bar.padLeft}; padding-right:${bar.padRight}; border-radius:${bar.radius}; `
            : '';
        return `
            <div class="cal-cell-event${bar ? ' cal-longterm-bar' : ''}" style="${barStyle}background-color: ${color};">
                <div class="cal-cell-top">${timeHtml}${personHtml}</div>
                ${descHtml}
            </div>
        `;
    };

    // 장기 일정 막대와 같은 이어붙이기 방식이지만, 진짜 시작/종료일 대신
    // "어제/내일도 김윤환 휴방인가"로 연결 여부를 판단한다.
    const calGetYounhwanBarHTML = (dateStr, isWeekStart, isWeekEnd) => {
        const connectsLeft = !isWeekStart && calIsYounhwanOffAir(calShiftDate(dateStr, -1));
        const connectsRight = !isWeekEnd && calIsYounhwanOffAir(calShiftDate(dateStr, 1));
        return calCellEventHtml({
            timeText: '휴방', personText: CAL_YOUNHWAN_SHORT, descText: '',
            color: CAL_YOUNHWAN_COLOR, bar: calBarEdgeStyle(!connectsLeft, !connectsRight),
        });
    };

    // 공휴일 목록은 해마다 바뀌므로 별도 JSON(holidays.json)에서 fetch해온다.
    let calPublicHolidays = {};
    const loadPublicHolidays = async () => {
        try {
            const res = await fetch('holidays.json', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                calPublicHolidays = (data && typeof data === 'object') ? data : {};
            }
        } catch (e) {
            console.error('공휴일 데이터를 불러오지 못했습니다:', e);
        }
    };

    // "YYYY-MM-DD" -> "YY-MM-DD" ("선택한 날짜 일정" 타이틀에 짧게 표시할 때 사용)
    const calFormatShortDate = (dateStr) => dateStr ? dateStr.slice(2) : '';

    // 일정 배열을 시간순으로 정렬. 시간이 없는 일정은 항상 최상단(등록 순서 유지).
    const calSortByTime = (items) => {
        return items.slice().sort((a, b) => {
            const aHas = !!a.time, bHas = !!b.time;
            if (aHas !== bHas) return aHas ? 1 : -1; // 시간 없는 쪽이 먼저
            if (!aHas) return 0; // 둘 다 시간 없음: 등록 순서 유지
            return String(a.time).localeCompare(String(b.time));
        });
    };

    // 이 일정의 마지막 날. endDate가 없으면(과거 데이터 호환용) startDate와 같은 것으로 취급.
    const calEventEnd = (ev) => ev.endDate || ev.startDate;
    const calEventCoversDate = (ev, dateStr) => dateStr >= ev.startDate && dateStr <= calEventEnd(ev);
    const calIsMultiDay = (ev) => !!ev.endDate && ev.endDate !== ev.startDate;

    // 특정 날짜에 걸리는 일정들을 시간순으로 반환 - 캘린더 칸/오늘의 일정/선택한 날짜 목록이
    // 전부 이 함수를 써서, 하루짜리든 기간이든 같은 방식으로 다뤄진다. (source: 미리 추린 후보, 선택)
    const calEventsForDate = (dateStr, source) =>
        calSortByTime((source || calEvents).filter(ev => ev && calEventCoversDate(ev, dateStr)));

    // 예전 데이터 형식(schedules: {날짜: [...]}, longTerm: [...])을 새 통합 형식(단일 배열)으로
    // 변환한다. 이미 새 형식(events 배열)이면 그대로 통과. 새로 저장할 때는 항상 통합 형식만 쓴다.
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

    const calGetEventHTML = (item) => calCellEventHtml({
        timeText: item.time, personText: item.person, descText: item.desc,
        color: calSafeColor(item.color, CAL_DEFAULT_EVENT_COLOR),
    });

    // 기간(장기) 일정 막대 한 칸(하루치) - 하루짜리 카드와 같은 2줄 레이아웃을 매일 찍어서 옆 칸과
    // 이어붙인다. 주가 바뀌어도 이어지는 것처럼 보이도록, 그 주의 첫/마지막 칸(일/토)에서도
    // 끝처럼 둥글게 마감하지 않고 실제 시작일/종료일에서만 둥글게 마감한다.
    const calGetLongTermBarHTML = (ev, dateStr, isWeekStart, isWeekEnd) => calCellEventHtml({
        timeText: ev.time, personText: ev.person, descText: ev.desc,
        color: calSafeColor(ev.color, CAL_DEFAULT_LONGTERM_COLOR),
        bar: calBarEdgeStyle(dateStr === ev.startDate || isWeekStart, dateStr === ev.endDate || isWeekEnd),
    });

    // 이번 달 칸 하나(날짜 숫자 + 김윤환 휴방 띠 + 장기 일정 막대 + 하루짜리 일정 카드)
    const calDayCellHtml = (dateStr, dayNum, dayOfWeek, todayStr, monthEvents) => {
        const classes = ['cal-day-cell'];
        if (dateStr === todayStr) classes.push('today');
        if (calPublicHolidays[dateStr]) classes.push('holiday');
        const isWeekStart = dayOfWeek === 0, isWeekEnd = dayOfWeek === 6;

        let html = `<span class="cal-day-number">${dayNum}</span>`;
        // '김윤환' 휴방 표시는 가장 상단(다른 일정보다 위)에 붙인다.
        if (calIsYounhwanOffAir(dateStr)) html += calGetYounhwanBarHTML(dateStr, isWeekStart, isWeekEnd);
        // 기간 일정은 날짜 숫자 바로 아래(하루짜리 일정보다 위)에 이어지는 막대로, 하루짜리 일정은 그 아래 카드로.
        const dayEvents = calEventsForDate(dateStr, monthEvents);
        dayEvents.filter(calIsMultiDay).forEach(ev => { html += calGetLongTermBarHTML(ev, dateStr, isWeekStart, isWeekEnd); });
        dayEvents.filter(ev => !calIsMultiDay(ev)).forEach(item => { html += calGetEventHTML(item); });

        return `<div class="${classes.join(' ')}" data-date="${dateStr}">${html}</div>`;
    };

    // 날짜 칸 클릭은 칸마다 핸들러를 달지 않고 그리드 하나에 위임한다(한 번만 등록).
    let calGridClickBound = false;
    const calBindGridClick = (daysGrid) => {
        if (calGridClickBound) return;
        calGridClickBound = true;
        daysGrid.addEventListener('click', (e) => {
            const cell = e.target.closest('.cal-day-cell[data-date]');
            if (cell && daysGrid.contains(cell)) calSelectDate(cell.dataset.date);
        });
    };

    const calRenderCalendar = () => {
        const year = calCurrentDate.getFullYear();
        const month = calCurrentDate.getMonth();
        const titleEl = document.getElementById('monthTitle');
        const daysGrid = document.getElementById('daysGrid');
        if (!titleEl || !daysGrid) return;
        titleEl.innerText = `${year}년 ${month + 1}월`;

        const firstDayIndex = new Date(year, month, 1).getDay();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const prevLastDay = new Date(year, month, 0).getDate();
        const todayStr = calTodayStr();

        // 이번 달에 한 칸이라도 걸치는 일정만 먼저 추린다(날짜 칸마다 전체 일정을 훑지 않도록).
        const monthStart = calGetFormatDate(year, month + 1, 1);
        const monthEnd = calGetFormatDate(year, month + 1, lastDay);
        const monthEvents = calEvents.filter(ev => ev && ev.startDate <= monthEnd && calEventEnd(ev) >= monthStart);

        const cells = [];
        for (let i = firstDayIndex; i > 0; i--) {
            cells.push(`<div class="cal-day-cell other-month"><span class="cal-day-number">${prevLastDay - i + 1}</span></div>`);
        }
        for (let i = 1; i <= lastDay; i++) {
            const dayOfWeek = (firstDayIndex + i - 1) % 7; // 0=일 ... 6=토
            cells.push(calDayCellHtml(calGetFormatDate(year, month + 1, i), i, dayOfWeek, todayStr, monthEvents));
        }
        const totalCellsCount = firstDayIndex + lastDay;
        const nextDaysCount = totalCellsCount % 7 === 0 ? 0 : 7 - (totalCellsCount % 7);
        for (let i = 1; i <= nextDaysCount; i++) {
            cells.push(`<div class="cal-day-cell other-month"><span class="cal-day-number">${i}</span></div>`);
        }
        daysGrid.innerHTML = cells.join('');
        calBindGridClick(daysGrid);

        calRenderTodaySchedules();
        calRenderSelectedDateSchedules();
    };

    const changeMonth = (direction) => {
        // 날짜를 1일로 먼저 맞춰야 31일에 다음 달(30일까지) 이동 시 한 달을 건너뛰지 않는다.
        calCurrentDate.setDate(1);
        calCurrentDate.setMonth(calCurrentDate.getMonth() + direction);
        calRenderCalendar();
    };

    const calSelectDate = (dateStr) => {
        calSelectedDateStr = dateStr;
        // "선택한 날짜 일정" 섹션 제목을 클릭한 날짜에 맞춰 바꾼다 (예: [26-09-09] 일정)
        const titleEl = document.getElementById('selectedListTitle');
        if (titleEl) titleEl.innerText = `[${calFormatShortDate(dateStr)}] 일정`;
        calRenderSelectedDateSchedules();
        if (typeof window.calOnDateSelect === 'function') window.calOnDateSelect(dateStr);
    };

    // "오늘의 일정"/"선택한 날짜 일정" 카드 한 장의 마크업 - type으로 today/selected 각각의
    // CSS 클래스(cal-today-card/cal-selected-card)를 유지한다.
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

    // 휴방자 섹션은 window.calOffAirExtra가 정의돼 있을 때만(멤버 사진·이름을 아는 쪽) 렌더링한다.
    const calOffAirExtraHtml = (dateStr, type) =>
        typeof window.calOffAirExtra === 'function' ? window.calOffAirExtra(dateStr, type) : '';

    // 일정 목록 + (항상 아래에 붙는) 휴방자 섹션을 그린다. 오늘/선택한 날짜 공용.
    const calRenderScheduleList = (containerId, dateStr, type, emptyText) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        const items = calEventsForDate(dateStr);
        const eventsHtml = items.length
            ? items.map(item => calEventCardHtml(item, dateStr, type)).join('')
            : `<div class="cal-no-schedule">${emptyText}</div>`;
        container.innerHTML = eventsHtml + calOffAirExtraHtml(dateStr, type);
    };

    const calRenderTodaySchedules = () => {
        calRenderScheduleList('todayList', calTodayStr(), 'today', '오늘 등록된 일정이 없습니다.');
    };

    const calRenderSelectedDateSchedules = () => {
        if (!calSelectedDateStr) {
            const container = document.getElementById('selectedDateList');
            if (container) container.innerHTML = `<div class="cal-no-schedule">날짜를 클릭하세요.</div>`;
            return;
        }
        calRenderScheduleList('selectedDateList', calSelectedDateStr, 'selected', '등록된 일정이 없습니다.');
    };
