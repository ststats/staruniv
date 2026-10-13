const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../templates/assets/calendar.js'), 'utf8');
const members = [
    { '이름': '김윤환', 'SOOP ID': 'brainzerg7' },
    { '이름': '김민철', 'SOOP ID': 'minchul' },
];
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
    getProfileImgUrl: id => `/profiles/${id}.webp`,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

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

test('빈 시간은 숨기고 뱃지 이름은 HTML 이스케이프한다', () => {
    const html = evaluate("calEventCardHtml({ id: 1, person: 'ASL22', title: '<b>테스트</b>', participants: [{ name: '<script>', role: '출전' }] }, '2026-10-06', 'today')");
    assert.doesNotMatch(html, /<script>|hist-chip-role|cal-card-time/);
    assert.match(html, /&lt;script&gt;/);
});
