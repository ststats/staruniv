// 캘린더 로직. page-schedule.js와 admin-schedule.js가 같이 쓰며, 전역 이름(cal*, changeMonth, 훅 calCardExtra·calOffAirExtra)을 직접 쓰므로 바꾸면 깨진다.
let calCurrentDate = new Date();
let calSelectedDateStr = '';
// 하루짜리 일정은 startDate === endDate인 기간 일정으로 다룬다
let calEvents = [];
const calLoadState = { status: 'idle', hasData: false, pending: null };

// { "YYYY-MM-DD": [soopId…] }. 휴방은 일정이 아니라 그날의 멤버 상태라 따로 둔다.
let calOffAir = {};
const calOffAirForDate = dateStr => (calOffAir && Array.isArray(calOffAir[dateStr]) ? calOffAir[dateStr] : []);

const CAL_COLOR_PALETTE = {
    red: '#ff2538',
    orange: '#ff8a00',
    yellow: '#ffd43b',
    green: '#16c75b',
    blue: '#1677ff',
    indigo: '#3346b5',
    purple: '#7c3aed',
    light_gray: '#e5e7eb',
};
const CAL_DEFAULT_EVENT_COLOR = CAL_COLOR_PALETTE.blue;
const CAL_DEFAULT_LONGTERM_COLOR = CAL_COLOR_PALETTE.orange;

const calGetFormatDate = (year, month, day) => {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const calDateToStr = d => calGetFormatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
const calTodayStr = () => calDateToStr(new Date());

// 색은 팔레트 키로 저장된다(DB가 그 8가지만 받는다)
const calSafeColor = (color, fallback) => (hasOwn(CAL_COLOR_PALETTE, color) ? CAL_COLOR_PALETTE[color] : fallback);

// 이어지는 쪽은 칸 밖으로 번져 옆 칸 막대와 붙는다. 오른쪽은 경계선 1px까지 덮어야 해서 -9px이다.
const calBarEdgeStyle = (endLeft, endRight) => ({
    contLeft: !endLeft,
    contRight: !endRight,
    bleedLeft: endLeft ? '0' : '-8px',
    bleedRight: endRight ? '0' : '-9px',
    // 글자를 하루짜리 칩(색 막대 3px + 여백 6px)과 맞춘다: 이어지는 쪽은 3+6+8 = 17px.
    padLeft: endLeft ? '6px' : '17px',
    padRight: endRight ? '6px' : '15px',
});

// 기준색은 style.css 토큰과 같아야 한다(라이트 #0b1220/#ffffff, 다크 #eef2f8/#10131a).
const CAL_EV_THEME = {
    l: { text: [11, 18, 32], card: [255, 255, 255], sub: [93, 104, 122], bg: 0.14, hover: 0.24 },
    d: { text: [238, 242, 248], card: [16, 19, 26], sub: [143, 152, 166], bg: 0.22, hover: 0.32 },
};
const calColorCache = new Map();
const calToRgb = color => {
    if (!calColorCache.has(color))
        calColorCache.set(
            color,
            [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
        );
    return calColorCache.get(color);
};
const calMix = (a, b, t) =>
    '#' +
    a
        .map((v, i) =>
            Math.round(v * t + b[i] * (1 - t))
                .toString(16)
                .padStart(2, '0')
        )
        .join('');
// 노랑처럼 밝은 색도 있어 글자는 평소·호버 바탕 모두와 4.5:1(WCAG)이 될 때까지 글자색 쪽으로 섞는다.
const calLum = rgb => {
    const c = rgb.map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const calContrast = (a, b) => {
    const x = calLum(a),
        y = calLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const calReadable = (rgb, towards, bgs) => {
    for (let t = 1; t > 0; t -= 0.05) {
        const hex = calMix(rgb, towards, t);
        if (bgs.every(bg => calContrast(calToRgb(hex), bg) >= 4.5)) return hex;
    }
    return calMix(towards, towards, 1);
};
const calEventColorVars = color => {
    const base = calToRgb(color);
    return Object.entries(CAL_EV_THEME)
        .map(([k, th]) => {
            const accentHex = calMix(base, th.text, 0.78);
            const accent = calToRgb(accentHex);
            const bgHex = calMix(accent, th.card, th.bg),
                hoverHex = calMix(accent, th.card, th.hover);
            const bgs = [calToRgb(bgHex), calToRgb(hoverHex)];
            return (
                `--ev-accent-${k}:${accentHex};--ev-bg-${k}:${bgHex};--ev-hover-${k}:${hoverHex};` +
                `--ev-text-${k}:${calReadable(accent, th.text, bgs)};--ev-sub-${k}:${calReadable(th.sub, th.text, bgs)};`
            );
        })
        .join('');
};

const calCellEventHtml = ({ timeText, personText, descText, color, bar }) => {
    const timeHtml = timeText ? `<span class="cal-event-time">${escapeHTML(timeText)}</span>` : '';
    const personHtml = personText ? `<span class="cal-event-person">${escapeHTML(personText)}</span>` : '';
    const descHtml = descText ? `<div class="cal-event-desc">${escapeHTML(descText)}</div>` : '';
    const barStyle = bar
        ? `--bar-bleed-left:${bar.bleedLeft}; --bar-bleed-right:${bar.bleedRight}; --bar-pad-left:${bar.padLeft}; --bar-pad-right:${bar.padRight}; `
        : '';
    return `
            <div class="cal-cell-event${bar ? ' cal-longterm-bar' : ''}${bar && bar.contLeft ? ' is-cont-left' : ''}${bar && bar.contRight ? ' is-cont-right' : ''}" style="${barStyle}${calEventColorVars(color)}">
                <div class="cal-cell-top">${timeHtml}${personHtml}</div>
                ${descHtml}
            </div>
        `;
};

let calPublicHolidays = {};
const loadPublicHolidays = async () => {
    try {
        const data = await Api.holidays();
        calPublicHolidays = data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.error('공휴일 데이터를 불러오지 못했습니다:', e);
    }
};

const calSortByTime = items => {
    return items.slice().sort((a, b) => {
        const aHas = !!a.time,
            bHas = !!b.time;
        if (aHas !== bHas) return aHas ? 1 : -1;
        if (!aHas) return 0;
        return String(a.time).localeCompare(String(b.time));
    });
};

// endDate는 calLoadPublicData가 늘 채운다
const calEventCoversDate = (ev, dateStr) => dateStr >= ev.startDate && dateStr <= ev.endDate;
const calIsMultiDay = ev => ev.endDate !== ev.startDate;

const calEventsForDate = (dateStr, source) =>
    calSortByTime((source || calEvents).filter(ev => ev && calEventCoversDate(ev, dateStr)));

// 미리 받은 결과는 한 번만 쓴다(관리자가 편집 뒤 다시 부르면 다시 받는다)
let calPublicPrefetch = null;
const calPrefetchPublicData = () => {
    if (calPublicPrefetch) return;
    calPublicPrefetch = Promise.all([loadPublicHolidays(), Api.schedule()]);
    calPublicPrefetch.catch(() => {}); // 실패는 calLoadPublicData가 처리한다
};
const calLoadPublicData = () => {
    if (calLoadState.pending) return calLoadState.pending;
    const request = calPublicPrefetch || Promise.all([loadPublicHolidays(), Api.schedule()]);
    calPublicPrefetch = null;
    calLoadState.status = 'loading';
    calRenderCalendar();
    calLoadState.pending = request
        .then(([, { events, offAir }]) => {
            const nextEvents = (events || []).map(r => ({
                id: r.id,
                startDate: r.start_date,
                endDate: r.end_date || r.start_date,
                time: r.event_time || '',
                person: r.person || '',
                desc: r.description || '',
                title: r.title || r.description || (r.event_time === '비방연습' ? '비방연습' : ''),
                detail: r.detail || '',
                subjectType: r.subject_type || 'other',
                participants: Array.isArray(r.participants) ? r.participants : [],
                color: r.color || '',
            }));
            const nextOffAir = {};
            (offAir || []).forEach(r => {
                (nextOffAir[r.off_date] ||= []).push(r.soop_id);
            });
            calEvents = nextEvents;
            calOffAir = nextOffAir;
            calLoadState.hasData = true;
            calLoadState.status = 'ready';
        })
        .catch(e => {
            console.error('Supabase 일정 조회 실패:', e);
            calLoadState.status = 'error';
            throw e;
        })
        .finally(() => {
            calLoadState.pending = null;
            calRenderCalendar();
        });
    return calLoadState.pending;
};

// 개인은 자신을 제외하고, 단체와 대회는 등록된 참가자 전원을 센다.
const calParticipants = item => {
    if (!Array.isArray(item.participants)) return [];
    const seen = new Set();
    return item.participants.filter(p => {
        if (!p || typeof p !== 'object') return false;
        const key = String(p.soop_id || p.name || '')
            .trim()
            .toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
const calMember = (name, soopId) => {
    const members = typeof SiteData !== 'undefined' && Array.isArray(SiteData.members) ? SiteData.members : [];
    const value = String(name || '').trim();
    return (
        (soopId && members.find(m => m['SOOP ID'] === soopId)) ||
        members.find(m => m['이름'] === value || m['SOOP ID'] === value) ||
        (value.length === 2 ? members.find(m => String(m['이름'] || '').slice(-2) === value) : null)
    );
};
const calName = (name, soopId) => {
    const member = calMember(name, soopId);
    return member ? String(member['이름'] || name).slice(-2) : String(name || '').trim();
};
const calSubjectLabel = item => {
    const participants = calParticipants(item);
    const subject = calName(item.person);
    if (!participants.length) return subject;
    if (item.subjectType === 'person') {
        const owner = calMember(item.person);
        const ownerIndex = participants.findIndex(p =>
            owner && p.soop_id ? p.soop_id === owner['SOOP ID'] : calName(p.name || p.soop_id, p.soop_id) === subject
        );
        const extras = participants.length - (ownerIndex < 0 ? 0 : 1);
        return extras ? `${subject} 외 ${extras}인` : subject;
    }
    return `${subject} · ${participants.length}인`;
};
const calEventTitle = item => item.title || item.desc || (item.time === '비방연습' ? '비방연습' : item.person);
// 미입력 시간은 표시하지 않는다. '미정'은 관리자가 입력한 경우에만 표시한다.
const calDisplayTime = item => (item.time === '비방연습' ? '' : String(item.time || '').trim());

const calGetEventHTML = item =>
    calCellEventHtml({
        timeText: calDisplayTime(item),
        personText: calSubjectLabel(item),
        descText: calEventTitle(item),
        color: calSafeColor(item.color, CAL_DEFAULT_EVENT_COLOR),
    });

const calGetLongTermBarHTML = (ev, dateStr, isWeekStart, isWeekEnd) =>
    calCellEventHtml({
        timeText: calDisplayTime(ev),
        personText: calSubjectLabel(ev),
        descText: calEventTitle(ev),
        color: calSafeColor(ev.color, CAL_DEFAULT_LONGTERM_COLOR),
        bar: calBarEdgeStyle(dateStr === ev.startDate || isWeekStart, dateStr === ev.endDate || isWeekEnd),
    });

const CAL_DOTS_PER_ROW = 4; // style/07-schedule.css와 맞춘다

const calDayCellHtml = (dateStr, dayNum, dayOfWeek, todayStr, monthEvents) => {
    const classes = ['cal-day-cell'];
    if (dateStr === todayStr) classes.push('today');
    if (dateStr === calSelectedDateStr) classes.push('active');
    if (calPublicHolidays[dateStr]) classes.push('holiday');
    const isWeekStart = dayOfWeek === 0,
        isWeekEnd = dayOfWeek === 6;

    const todayAttr = dateStr === todayStr ? ` aria-current="date" aria-label="오늘, ${dateStr}"` : '';
    let html = `<span class="cal-day-number"${todayAttr}>${dayNum}</span>`;
    // 칸마다 순서가 같아야 기간 막대가 옆 칸과 이어진다
    const dayEvents = calEventsForDate(dateStr, monthEvents);
    const items = [
        ...dayEvents.filter(calIsMultiDay).map(ev => calGetLongTermBarHTML(ev, dateStr, isWeekStart, isWeekEnd)),
        ...dayEvents.filter(ev => !calIsMultiDay(ev)).map(calGetEventHTML),
    ];
    // 좁은 화면 점 달력의 줄바꿈 칸(PC에서는 숨김)
    items.forEach((item, i) => {
        if (i === CAL_DOTS_PER_ROW) html += '<span class="cal-cell-break" aria-hidden="true"></span>';
        html += item;
    });

    return `<div class="${classes.join(' ')}" data-date="${dateStr}">${html}</div>`;
};

let calGridClickBound = false;
const calBindGridClick = daysGrid => {
    if (calGridClickBound) return;
    calGridClickBound = true;
    daysGrid.addEventListener('click', e => {
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
    const failed = calLoadState.status === 'error';
    daysGrid.dataset.loadState = calLoadState.status;
    titleEl.innerText = `${year}. ${String(month + 1).padStart(2, '0')}`;
    const YEAR_EL = document.getElementById('monthYear');
    const NAME_EL = document.getElementById('monthName');
    if (YEAR_EL) YEAR_EL.innerText = year;
    if (NAME_EL) {
        const MONTH_EN = [
            'JANUARY',
            'FEBRUARY',
            'MARCH',
            'APRIL',
            'MAY',
            'JUNE',
            'JULY',
            'AUGUST',
            'SEPTEMBER',
            'OCTOBER',
            'NOVEMBER',
            'DECEMBER',
        ];
        NAME_EL.innerText = MONTH_EN[month];
    }

    if (!calLoadState.hasData) {
        daysGrid.setAttribute('aria-busy', String(!failed));
        daysGrid.innerHTML = `<div class="cal-days-loading">${failed ? '일정을 확인할 수 없습니다' : '달력을 불러오는 중'}</div>`;
        calRenderTodaySchedules();
        calRenderSelectedDateSchedules();
        return;
    }

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();
    const todayStr = calTodayStr();

    const monthStart = calGetFormatDate(year, month + 1, 1);
    const monthEnd = calGetFormatDate(year, month + 1, lastDay);
    const monthEvents = calEvents.filter(ev => ev && ev.startDate <= monthEnd && ev.endDate >= monthStart);

    const cells = [];
    for (let i = firstDayIndex; i > 0; i--) {
        cells.push(
            `<div class="cal-day-cell other-month"><span class="cal-day-number">${prevLastDay - i + 1}</span></div>`
        );
    }
    for (let i = 1; i <= lastDay; i++) {
        const dayOfWeek = (firstDayIndex + i - 1) % 7;
        cells.push(calDayCellHtml(calGetFormatDate(year, month + 1, i), i, dayOfWeek, todayStr, monthEvents));
    }
    const totalCellsCount = firstDayIndex + lastDay;
    const nextDaysCount = totalCellsCount % 7 === 0 ? 0 : 7 - (totalCellsCount % 7);
    for (let i = 1; i <= nextDaysCount; i++) {
        cells.push(`<div class="cal-day-cell other-month"><span class="cal-day-number">${i}</span></div>`);
    }
    daysGrid.innerHTML = cells.join('');
    daysGrid.setAttribute('aria-busy', 'false');
    calBindGridClick(daysGrid);

    calRenderTodaySchedules();
    calRenderSelectedDateSchedules();
};

// data-click이 이름으로 부르므로 전역 function이어야 한다
function changeMonth(direction) {
    // 31일에 setMonth(+1)하면 한 달을 건너뛴다
    calCurrentDate.setDate(1);
    calCurrentDate.setMonth(calCurrentDate.getMonth() + direction);
    calRenderCalendar();
}

const calSelectDate = dateStr => {
    calSelectedDateStr = dateStr;
    document.querySelectorAll('.cal-day-cell.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.cal-day-cell[data-date="${dateStr}"]`).forEach(el => el.classList.add('active'));
    calRenderSelectedDateSchedules();
};

const calEventCardHtml = (item, dateStr, type) => {
    const cardClass = type === 'today' ? 'cal-today-card' : 'cal-selected-card';
    const participants = calParticipants(item);
    const key = `schedule-${type}-${item.id}`;
    const badges = participants.length
        ? `<div class="hist-chips">
            <span class="hist-chips-rest" data-hist-rest="${escapeHTML(key)}" hidden>${participants
                .map(p => {
                    const name = calName(p.name || p.soop_id, p.soop_id);
                    const member = calMember(p.name, p.soop_id);
                    const avatarUrl = member && typeof getProfileImgUrl === 'function'
                        ? getProfileImgUrl(member['SOOP ID'])
                        : '';
                    const avatar = avatarUrl
                        ? `<img class="hist-chip-ava" src="${escapeHTML(avatarUrl)}" alt="" loading="lazy">`
                        : '<span class="hist-chip-ava">👤</span>';
                    const role = p.role ? `<span class="hist-chip-role">${escapeHTML(p.role)}</span>` : '';
                    return `<span class="hist-chip">${avatar}<span class="hist-chip-name">${escapeHTML(name)}</span>${role}</span>`;
                })
                .join('')}</span>
            <button type="button" class="hist-chip hist-chip-more" data-hist-more="${escapeHTML(key)}"
                ${act('histToggleMembers', key)} aria-expanded="false"
                title="${escapeHTML(participants.map(p => calName(p.name || p.soop_id, p.soop_id)).join(', '))}">
                <span class="hist-stack">${participants
                    .slice(0, 3)
                    .map(p => {
                        const member = calMember(p.name, p.soop_id);
                        const url = member && typeof getProfileImgUrl === 'function'
                            ? getProfileImgUrl(member['SOOP ID'])
                            : '';
                        return url
                            ? `<img class="hist-stack-face" src="${escapeHTML(url)}" alt="" loading="lazy">`
                            : '<span class="hist-stack-face">👤</span>';
                    })
                    .join('')}</span>
                <span class="hist-chip-name">참가 ${participants.length}인</span>
            </button>
        </div>`
        : '';
    return `
            <div class="${cardClass}" data-event-id="${escapeHTML(item.id)}">
                <div class="cal-card-main">
                    ${calDisplayTime(item) ? `<span class="cal-card-time">${escapeHTML(calDisplayTime(item))}</span>` : ''}
                    ${item.person ? `<span class="cal-card-person">${escapeHTML(calSubjectLabel(item))}</span>` : ''}
                    <span class="cal-card-desc">${escapeHTML(calEventTitle(item))}${item.detail ? `<span class="cal-card-detail">${escapeHTML(item.detail)}</span>` : ''}</span>
                    ${typeof window.calCardExtra === 'function' ? window.calCardExtra(item, dateStr, type) : ''}
                </div>
                ${badges}
            </div>
        `;
};

// 멤버 정보를 아는 페이지만 훅을 정의한다
const calOffAirExtraHtml = (dateStr, type) =>
    typeof window.calOffAirExtra === 'function' ? window.calOffAirExtra(dateStr, type) : '';

const calRenderScheduleList = (containerId, dateStr, type, emptyText) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!calLoadState.hasData) {
        const failed = calLoadState.status === 'error';
        container.classList.add('is-empty');
        container.setAttribute('aria-busy', String(!failed));
        container.innerHTML = `<div class="cal-no-schedule">${failed ? '일정을 확인할 수 없습니다' : '일정을 불러오는 중'}</div>`;
        return;
    }
    const items = calEventsForDate(dateStr);
    container.classList.toggle('is-empty', items.length === 0);
    container.setAttribute('aria-busy', 'false');
    const eventsHtml = items.length
        ? items.map(item => calEventCardHtml(item, dateStr, type)).join('')
        : `<div class="cal-no-schedule">${emptyText}</div>`;
    container.innerHTML = eventsHtml + calOffAirExtraHtml(dateStr, type);
};

const calDayLabel = dateStr => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} ${DOW[new Date(y, m - 1, d).getDay()]}`;
};
const calSetDayLabel = (id, dateStr) => {
    const el = document.getElementById(id);
    if (el) el.textContent = calDayLabel(dateStr);
};

const calRenderTodaySchedules = () => {
    calSetDayLabel('todayDateLabel', calTodayStr());
    calRenderScheduleList('todayList', calTodayStr(), 'today', '오늘 등록된 일정이 없습니다');
};

const calRenderSelectedDateSchedules = () => {
    if (!calSelectedDateStr) {
        const container = document.getElementById('selectedDateList');
        if (container) {
            container.classList.add('is-empty');
            container.innerHTML = `<div class="cal-no-schedule">날짜를 클릭하세요</div>`;
        }
        return;
    }
    calSetDayLabel('selectedDateLabel', calSelectedDateStr);
    calRenderScheduleList('selectedDateList', calSelectedDateStr, 'selected', '등록된 일정이 없습니다');
};
