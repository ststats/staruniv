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
    escapeHTML: value => String(value).replace(/[&<>"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[ch]),
    Date,
    Map,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

function evaluate(expression) {
    return vm.runInContext(expression, sandbox);
}

test('개인 주체는 본인을 제외한 인원만 세고 이름을 두 글자로 표시한다', () => {
    assert.equal(evaluate("calSubjectLabel({ person: '김윤환', subjectType: 'person', participants: [{ soop_id: 'brainzerg7', name: '김윤환' }, { soop_id: 'minchul', name: '김민철' }] })"), '윤환 외 1인');
    assert.equal(evaluate("calSubjectLabel({ person: '김윤환', subjectType: 'person', participants: [{ soop_id: 'brainzerg7', name: '김윤환' }] })"), '윤환');
});

test('단체와 대회는 전체 참가자 수를 인으로 표시한다', () => {
    const participants = "[{ soop_id: 'brainzerg7', name: '김윤환' }, { soop_id: 'minchul', name: '김민철' }]";
    assert.equal(evaluate(`calSubjectLabel({ person: 'ASL22', subjectType: 'competition', participants: ${participants} })`), 'ASL22 · 2인');
    assert.equal(evaluate("calSubjectLabel({ person: 'ASL22', subjectType: 'competition', participants: [{ soop_id: 'minchul', name: '김민철' }] })"), 'ASL22 · 1인');
    assert.equal(evaluate(`calSubjectLabel({ person: '캄몬', subjectType: 'group', participants: ${participants} })`), '캄몬 · 2인');
});

test('기존 일정은 제목 대체값을 표시하고 불명확한 시간은 미정으로 표시한다', () => {
    assert.equal(evaluate("calEventTitle({ title: '', desc: '팬미팅', person: '캄몬' })"), '팬미팅');
    assert.equal(evaluate("calEventTitle({ title: '', desc: '', person: '캄몬', time: '비방연습' })"), '비방연습');
    assert.equal(evaluate("calDisplayTime({ time: '비방연습' })"), '미정');
    assert.equal(evaluate("calDisplayTime({ time: '19:00' })"), '19:00');
});

test('날짜 카드에는 역할과 참가자 이름이 뱃지로 나타나고 원문을 이스케이프한다', () => {
    const html = evaluate("calEventCardHtml({ id: 1, time: '19:00', person: 'ASL22', subjectType: 'competition', title: '4강', detail: '김민철 출전', participants: [{ soop_id: 'minchul', name: '김민철', role: '출전' }] }, '2026-10-06', 'today')");
    assert.match(html, /ASL22 · 1인/);
    assert.match(html, /민철 · 출전/);
    assert.match(html, /김민철 출전/);
    const unsafe = evaluate("calEventCardHtml({ id: 1, person: 'ASL22', title: '<b>테스트</b>', participants: [{ name: '<script>', role: '출전' }] }, '2026-10-06', 'today')");
    assert.doesNotMatch(unsafe, /<script>/);
    assert.match(unsafe, /&lt;script&gt;/);
});
