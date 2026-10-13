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

test('휴방은 공통 뱃지로 6명까지, 7명부터 나머지를 합친다', () => {
    const page = fs.readFileSync(path.join(__dirname, '../templates/assets/page-schedule.js'), 'utf8');
    sandbox.findMemberBySoopId = id => members.find(m => String(m['SOOP ID']) === String(id));
    sandbox.bootPage = () => {};
    vm.runInContext(page, sandbox);
    for (const count of [0, 1, 6, 7, 17]) {
        evaluate(`calOffAir = { '2026-10-14': ${JSON.stringify(Array.from({ length: count }, (_, i) => 'id' + i))} }`);
        const html = evaluate("window.calOffAirExtra('2026-10-14','selected')");
        if (!count) assert.match(html, /없음/);
        else assert.equal((html.match(/data-offair-date=/g) || []).length, count);
        if (count > 6) {
            assert.ok(html.includes('+' + (count - 5) + '명'));
            assert.match(html, /data-hist-rest="offair-selected-2026-10-14" hidden/);
            assert.equal((html.match(/hist-stack-face/g) || []).length, Math.min(3, count - 5));
        } else assert.doesNotMatch(html, /hist-chip-more/);
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

test('빈 시간은 숨기고 관리자가 직접 적은 미정만 보여준다', () => {
    assert.equal(evaluate("calEventTitle({ title: '', desc: '팬미팅', person: '캄몬' })"), '팬미팅');
    assert.equal(evaluate("calEventTitle({ title: '', desc: '', person: '캄몬', time: '비방연습' })"), '비방연습');
    assert.equal(evaluate("calDisplayTime({ time: '' })"), '');
    assert.equal(evaluate("calDisplayTime({ time: '비방연습' })"), '');
    assert.equal(evaluate("calDisplayTime({ time: '미정' })"), '미정');
    assert.equal(evaluate("calDisplayTime({ time: '시간미정' })"), '시간미정');
    assert.equal(evaluate("calDisplayTime({ time: '19:00' })"), '19:00');
});

test('일정과 연혁 뱃지는 하나의 공통 렌더러를 사용한다', () => {
    const cal = fs.readFileSync(path.join(__dirname, '../templates/assets/calendar.js'), 'utf8');
    assert.match(cal, /histChipsHtml\(/);
    assert.doesNotMatch(cal, /calParticipantBadge|calParticipantChip|calParticipantAvatar/);
});

test('참가자 1~3명은 역할 없이 원래 이름으로 개별 표시한다', () => {
    const people = [
        { soop_id: 'brainzerg7', name: '김윤환', role: '해설' },
        { soop_id: 'minchul', name: '김민철', role: '출전' },
        { name: '박상현', role: '진행' },
    ];
    for (const n of [1, 2, 3]) {
        const item = { id: 1, person: 'ASL22', title: '4강', participants: people.slice(0, n) };
        const html = evaluate('calEventCardHtml(' + JSON.stringify(item) + ',"2026-10-06","today")');
        assert.equal((html.match(/class="hist-chip(?: is-unknown)?"/g) || []).length, n);
        assert.doesNotMatch(html, /hist-chip-more|hist-chip-role/);
        for (const p of people.slice(0, n)) assert.match(html, new RegExp(p.name));
    }
});

test('4명 이상부터 첫 두 명과 나머지 겹친 세 번째 뱃지를 표시한다', () => {
    const people = [
        { soop_id: 'brainzerg7', name: '김윤환' },
        { soop_id: 'minchul', name: '김민철' },
        { name: '박상현' },
        { name: '유영진' },
        { name: '정준영' },
    ];
    for (const n of [4, 5]) {
        const item = { id: 15, person: 'ASL22', title: '4강', participants: people.slice(0, n) };
        const html = evaluate('calEventCardHtml(' + JSON.stringify(item) + ',"2026-10-06","today")');
        const first = html.split('class="hist-chips-rest"')[0];
        assert.equal((first.match(/class="hist-chip(?: is-unknown)?"/g) || []).length, 2);
        assert.match(first, /김윤환/);
        assert.match(first, /김민철/);
        assert.match(html, /class="hist-stack"/);
        assert.match(html, /class="hist-stack-face"/);
        assert.match(html, new RegExp('\\+' + (n - 2) + '명'));
        assert.match(html, /data-hist-rest="schedule-today-15" hidden/);
        assert.doesNotMatch(html, /hist-chip-role/);
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

test('빈 시간은 숨기고 뱃지 이름은 HTML 이스케이프한다', () => {
    const html = evaluate(
        "calEventCardHtml({ id: 1, person: 'ASL22', title: '<b>테스트</b>', participants: [{ name: '<script>', role: '출전' }] }, '2026-10-06', 'today')"
    );
    assert.doesNotMatch(html, /<script>|hist-chip-role|cal-card-time/);
    assert.match(html, /&lt;script&gt;/);
});

test('휴방·오늘의 일정·연혁 뱃지는 없음 글자 크기로 통일하고 프로필은 작게 표시한다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../templates/assets/style/07-schedule.css'), 'utf8');
    const chip = css.match(/\.cal-offair-chip,\s*\.hist-chip\s*\{([^}]+)\}/)?.[1];
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

test('선택한 날짜 일정은 내부 스크롤 없이 펼쳐지고 오늘 일정 패널은 없다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../templates/assets/style/07-schedule.css'), 'utf8');
    const template = fs.readFileSync(path.join(__dirname, '../templates/pages/schedule.html'), 'utf8');
    const shared = css.match(/\.cal-selected-list\s*\{([^}]+)\}/)?.[1];
    assert.ok(shared);
    assert.match(shared, /display:\s*flex/);
    assert.doesNotMatch(shared, /max-height|overflow|height:/);
    assert.doesNotMatch(css, /\.cal-(?:selected|today)-list\s*\{[^}]*?(?:max-height|overflow(?:-y)?):/);
    assert.match(template, /class="cal-selected-list is-empty" id="selectedDateList"/);
    assert.doesNotMatch(template, /todayList|todayDateLabel|오늘의 일정/);
    assert.doesNotMatch(template, /class="cal-(?:selected|today)-list scroll-area/);
});
