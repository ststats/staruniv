const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../templates/assets/calendar.js'), 'utf8');
const historySource = fs.readFileSync(path.join(__dirname, '../templates/assets/history.js'), 'utf8');
const members = [
    { '이름': '김윤환', 'SOOP ID': 'brainzerg7' },
    { '이름': '김민철', 'SOOP ID': 'minchul' },
];

test('휴방은 얼굴 넷까지와 두 이름 + 외 N명 한 줄로, 셋부터 눌러서 전체를 편다', () => {
    const page = fs.readFileSync(path.join(__dirname, '../templates/assets/page-schedule.js'), 'utf8');
    sandbox.findMemberBySoopId = id => members.find(m => String(m['SOOP ID']) === String(id));
    sandbox.bootPage = () => {};
    vm.runInContext(page, sandbox);
    for (const count of [0, 1, 2, 3, 17]) {
        evaluate(`calOffAir = { '2026-10-14': ${JSON.stringify(Array.from({ length: count }, (_, i) => 'id' + i))} }`);
        const html = evaluate("window.calOffAirExtra('2026-10-14')");
        if (!count) {
            assert.match(html, /없음/);
            assert.doesNotMatch(html, /data-offair-date/);
            continue;
        }
        assert.match(html, /data-offair-date="2026-10-14"/);
        assert.equal((html.match(/class="people-face"/g) || []).length, Math.min(4, count));
        if (count > 2) {
            assert.match(html, new RegExp('외 ' + (count - 2) + '명'));
            assert.match(html, /<button type="button" class="people-row"/);
        } else assert.doesNotMatch(html, /외 \d+명|<button/);
    }
});
const sandbox = {
    SiteData: { members },
    escapeHTML: value =>
        String(value).replace(
            /[&<>"]/g,
            ch =>
                ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                })[ch]
        ),
    Date,
    Map,
    window: {},
    act: () => 'data-action="histToggleMembers"',
    actOn: () => '',
    ACT: { el: {} },
    getProfileImgUrl: id => `/profiles/${id}.webp`,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
vm.runInContext(historySource, sandbox);

function evaluate(expression) {
    return vm.runInContext(expression, sandbox);
}

test('휴방 훅은 어느 칸(오늘·선택한 날)인지 받는다(관리자 휴방 관리 버튼이 선택한 날에 붙는다)', () => {
    const saved = sandbox.window.calOffAirExtra;
    sandbox.window.calOffAirExtra = (date, type) => `${date}|${type}`;
    try {
        assert.equal(evaluate("calOffAirExtraHtml('2026-10-14', 'selected')"), '2026-10-14|selected');
    } finally {
        sandbox.window.calOffAirExtra = saved;
    }
});

test('개인 주체는 본인을 제외한 인원만 세고 이름을 두 글자로 표시한다', () => {
    assert.equal(
        evaluate(
            "calSubjectLabel({ person: '김윤환', subjectType: 'person', participants: [{ soop_id: 'brainzerg7', name: '김윤환' }, { soop_id: 'minchul', name: '김민철' }] })"
        ),
        '윤환 외 1인'
    );
    assert.equal(
        evaluate(
            "calSubjectLabel({ person: '김윤환', subjectType: 'person', participants: [{ soop_id: 'brainzerg7', name: '김윤환' }] })"
        ),
        '윤환'
    );
});

test('단체와 대회는 전체 참가자 수를 인으로 표시한다', () => {
    const participants = "[{ soop_id: 'brainzerg7', name: '김윤환' }, { soop_id: 'minchul', name: '김민철' }]";
    assert.equal(
        evaluate(`calSubjectLabel({ person: 'ASL22', subjectType: 'competition', participants: ${participants} })`),
        'ASL22 · 2인'
    );
    assert.equal(
        evaluate(
            "calSubjectLabel({ person: 'ASL22', subjectType: 'competition', participants: [{ soop_id: 'minchul', name: '김민철' }] })"
        ),
        'ASL22 · 1인'
    );
    assert.equal(
        evaluate(`calSubjectLabel({ person: '캄몬', subjectType: 'group', participants: ${participants} })`),
        '캄몬 · 2인'
    );
});

test('빈 시간은 대시를 표시하고 관리자가 적은 미정과 시간은 유지한다', () => {
    assert.equal(evaluate("calEventTitle({ title: '팬미팅', person: '캄몬' })"), '팬미팅');
    assert.equal(evaluate("calEventTitle({ title: '', person: '캄몬' })"), '캄몬');
    assert.equal(evaluate("calDisplayTime({ time: '' })"), '-');
    assert.equal(evaluate("calDisplayTime({ time: '미정' })"), '미정');
    assert.equal(evaluate("calDisplayTime({ time: '시간미정' })"), '미정');
    assert.equal(evaluate("calDisplayTime({ time: '19:00' })"), '19:00');
});

test('일정 참가자와 휴방은 하나의 사람 줄 렌더러를 쓴다', () => {
    const cal = fs.readFileSync(path.join(__dirname, '../templates/assets/calendar.js'), 'utf8');
    const page = fs.readFileSync(path.join(__dirname, '../templates/assets/page-schedule.js'), 'utf8');
    assert.match(cal, /histPeopleRowHtml\(/);
    assert.match(page, /histPeopleRowHtml\(/);
});

test('참가자 1~2명은 이름을 모두 보이고, 주체 혼자인 일정은 사람 줄을 뺀다', () => {
    const people = [
        { soop_id: 'brainzerg7', name: '김윤환' },
        { soop_id: 'minchul', name: '김민철' },
    ];
    for (const n of [1, 2]) {
        const item = { id: 1, person: 'ASL22', title: '4강', participants: people.slice(0, n) };
        const html = evaluate('calEventCardHtml(' + JSON.stringify(item) + ',"2026-10-06","today")');
        assert.match(html, /class="people-row"/);
        assert.doesNotMatch(html, /<button|외 \d+명/);
        for (const p of people.slice(0, n)) assert.match(html, new RegExp(p.name));
    }
    const solo = { id: 2, person: '윤환', subjectType: 'person', title: '방송', participants: people.slice(0, 1) };
    assert.doesNotMatch(evaluate('calEventCardHtml(' + JSON.stringify(solo) + ',"2026-10-06","today")'), /people-row/);
});

test('참가자 셋 이상은 두 이름 + 외 N명으로 접고, 누르면 전체 이름을 편다', () => {
    const people = [
        { soop_id: 'brainzerg7', name: '김윤환' },
        { soop_id: 'minchul', name: '김민철' },
        { name: '박상현' },
        { name: '유영진' },
        { name: '정준영' },
    ];
    for (const n of [3, 5]) {
        const item = { id: 15, person: 'ASL22', title: '4강', participants: people.slice(0, n) };
        const html = evaluate('calEventCardHtml(' + JSON.stringify(item) + ',"2026-10-06","today")');
        assert.match(html, new RegExp('김윤환 · 김민철 외 ' + (n - 2) + '명'));
        assert.equal((html.match(/class="people-face"/g) || []).length, Math.min(4, n));
        const all = people
            .slice(0, n)
            .map(p => p.name)
            .join(' · ');
        assert.ok(html.includes('data-people-all="' + all + '"'));
    }
});

test('연혁의 기존 펼침 규칙은 그대로 유지한다', () => {
    const entries = Array.from({ length: 7 }, (_, i) => '멤버' + i);
    const html = evaluate('histChipsHtml(' + JSON.stringify(entries) + ',[],null,"hist-seven")');
    const first = html.split('class="hist-chips-rest"')[0];
    assert.equal((first.match(/class="hist-chip is-unknown"/g) || []).length, 5);
    assert.match(html, /\+2명/);
    const six = evaluate('histChipsHtml(' + JSON.stringify(entries.slice(0, 6)) + ',[],null,"hist-six")');
    assert.doesNotMatch(six, /hist-chip-more/);
});

test('빈 시간은 대시로 채우고 뱃지 이름은 HTML 이스케이프한다', () => {
    const html = evaluate(
        "calEventCardHtml({ id: 1, person: 'ASL22', title: '<b>테스트</b>', participants: [{ name: '<script>', role: '출전' }] }, '2026-10-06', 'today')"
    );
    assert.doesNotMatch(html, /<script>|hist-chip-role/);
    assert.match(html, /class="cal-card-time">-<\/span>/);
    assert.match(html, /&lt;script&gt;/);
});

test('복원한 오늘의 일정과 선택한 날짜 일정은 각각 올바른 카드 스타일을 사용한다', () => {
    const item = JSON.stringify({ id: 101, person: '캄몬', time: '19:00', title: '방송', participants: [] });
    const today = evaluate('calEventCardHtml(' + item + ', "2026-10-14", "today")');
    const selected = evaluate('calEventCardHtml(' + item + ', "2026-10-14", "selected")');
    assert.match(today, /class="cal-today-card"/);
    assert.match(selected, /class="cal-selected-card"/);
});

test('휴방·오늘의 일정·연혁 뱃지는 없음 글자 크기로 통일하고 프로필은 작게 표시한다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../templates/assets/style/07-schedule.css'), 'utf8');
    const chip = css.match(/\.hist-chip\s*\{([^}]+)\}/)?.[1];
    const avatars = css.match(/\.hist-chip-ava,\s*\.hist-stack-face\s*\{([^}]+)\}/)?.[1];
    const none = css.match(/\.cal-offair-none\s*\{([^}]+)\}/)?.[1];
    const historyName = css.match(/\.hist-chip-name\s*\{([^}]+)\}/)?.[1];
    assert.ok(chip && avatars && none && historyName);
    assert.match(chip, /min-height:\s*24px/);
    assert.match(chip, /font-size:\s*var\(--fs-small\)/);
    assert.match(avatars, /width:\s*18px/);
    assert.match(avatars, /height:\s*18px/);
    for (const rule of [none, historyName]) {
        assert.match(rule, /font-size:\s*var\(--fs-small\)/);
    }
});

test('휴방 라벨은 시간 칸과 같은 폭이고, 일정 사람 줄은 주체 칸에서 시작한다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../templates/assets/style/07-schedule.css'), 'utf8');
    const label = css.match(/\.cal-offair-label\s*\{([^}]+)\}/)?.[1];
    const row = css.match(/\.cal-today-card > \.people-row,\s*\.cal-selected-card > \.people-row\s*\{([^}]+)\}/)?.[1];
    assert.ok(label && row);
    assert.match(label, /width:\s*5ch/);
    assert.match(row, /calc\(5ch \+ var\(--space-5\)\)/);
});

test('오늘과 선택한 날짜 일정은 내부 스크롤 없이 펼쳐진다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../templates/assets/style/07-schedule.css'), 'utf8');
    const template = fs.readFileSync(path.join(__dirname, '../templates/pages/schedule.html'), 'utf8');
    const shared = css.match(/\.cal-selected-list,\s*\.cal-today-list\s*\{([^}]+)\}/)?.[1];
    assert.ok(shared);
    assert.match(shared, /display:\s*flex/);
    assert.doesNotMatch(shared, /max-height|overflow|height:/);
    assert.doesNotMatch(css, /\.cal-(?:selected|today)-list\s*\{[^}]*?(?:max-height|overflow(?:-y)?):/);
    assert.match(template, /class="cal-selected-list is-empty" id="selectedDateList"/);
    assert.match(template, /class="cal-today-list is-empty" id="todayList"/);
    assert.match(template, /id="todayDateLabel"/);
    assert.match(template, /오늘의 일정/);
    assert.match(css, /\.cal-card-time\s*\{[^}]*width:\s*5ch/);
    assert.match(css, /\.cal-event-time\s*\{[^}]*width:\s*5ch/);
    assert.doesNotMatch(template, /class="cal-(?:selected|today)-list scroll-area/);
    const cal = fs.readFileSync(path.join(__dirname, '../templates/assets/calendar.js'), 'utf8');
    assert.match(cal, /const calRenderTodaySchedules\s*=\s*\(\)\s*=>/);
});
