// 방송통계: 달을 바꿨는데 받지 못했으면(실패) 지표를 바꿔도 이전 달 수치를 새 달처럼 그리지 않고,
// 같은 달을 다시 누르면 다시 받는다. page-stats.js의 실제 함수를 떼어 VM에서 돌린다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const fn = (src, name) => {
    const a = src.indexOf(`function ${name}(`);
    const b = src.indexOf('\n}\n', a);
    assert.ok(a >= 0 && b > a, `${name}를 찾지 못함`);
    return src.slice(a, b + 3);
};
const page = read('templates/assets/page-stats.js');
const CODE = fn(page, 'setSynergyMonth') + fn(page, 'renderSynergyTable');

function setup() {
    const els = {}, loads = [];
    const ctx = vm.createContext({
        SynergyState: { month: '2026-08', data: [{ active: true, balloons: 88, ourMember: { '성별': '남자' } }], failed: false },
        document: { getElementById: id => (els[id] ||= { innerHTML: '', innerText: '' }) },
        synergyMonthKey: m => m, renderSynergyMonthNav() {}, syncSynergyUrl() {},
        loadSynergyData: m => loads.push(m),
        renderSynergySummary: rows => { els.summary = rows.length; },
        sortSynergyRows: rows => rows, synergyRowHtml: m => `ROW${m.balloons}`,
        emptyRowHtml: (_, text) => `EMPTY:${text}`,
    });
    vm.runInContext(CODE, ctx);
    return { ctx, els, loads };
}

test('새 달을 받지 못했으면 지표를 바꿔 다시 그려도 이전 달 수치가 나오지 않는다', () => {
    const { ctx, els } = setup();
    vm.runInContext("setSynergyMonth('2026-07')", ctx);   // 7월 요청
    ctx.SynergyState.failed = true;                         // 7월 실패(8월 데이터는 남아 있음)
    vm.runInContext('renderSynergyTable()', ctx);           // 지표 변경 등으로 다시 그림
    assert.doesNotMatch(els['synergy-tbody-male'].innerHTML, /ROW88/);
    assert.match(els['synergy-tbody-male'].innerHTML, /불러오지 못했습니다/);
    assert.equal(els.summary, 0);
});

test('실패한 달을 다시 누르면 다시 받는다', () => {
    const { ctx, loads } = setup();
    vm.runInContext("setSynergyMonth('2026-07')", ctx);
    ctx.SynergyState.failed = true;
    vm.runInContext("setSynergyMonth('2026-07')", ctx);
    assert.deepEqual(loads, ['2026-07', '2026-07']);
});

test('받은 달을 다시 누르면 다시 받지 않는다', () => {
    const { ctx, loads } = setup();
    vm.runInContext("setSynergyMonth('2026-08')", ctx);
    assert.deepEqual(loads, []);
});
