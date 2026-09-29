// 재입단 선수: 같은 SOOP ID의 입단 기록이 여러 개일 때, 목록 순서(직책·티어 순)와 상관없이
// 이번 달은 활동 중인 기록을, 지난 달은 그 달과 겹치는 기록 중 늦게 입단한 기록을 방송통계에 연결한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const slice = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `${from} ~ ${to} 구간을 찾지 못함`);
    return src.slice(a, b);
};
const core = read('templates/assets/core.js');
const CODE = slice(core, 'function isActiveMember', '\n}\n') + '\n}\n'
    + slice(core, 'let _synergyMonthsRequest', 'function applySynergyResult');

const OLD = { 'SOOP ID': 'p1', '입단일': '2026-01-10', '퇴단일': '2026-06-20', 'tier': '5' };
const NOW = { 'SOOP ID': 'p1', '입단일': '2026-08-05', '퇴단일': '', 'tier': '3' };

function run(members, month) {
    const ctx = vm.createContext({
        console: { error() {} }, Map, Set, Promise, Error, String, Number,
        SiteData: { members },
        Api: {
            statsLatest: async ids => ids.map(id => ({ soop_id: id, stat_date: '2026-09-26', balloons: 10 })),
            statsDates: async () => [{ stat_date: '2026-09-26' }, { stat_date: '2026-08-31' }, { stat_date: '2026-06-30' }],
            stats: async (date, ids) => ids.map(id => ({ soop_id: id, balloons: 5 })),
        },
    });
    vm.runInContext(CODE, ctx);
    return vm.runInContext(`fetchSynergyResult(${JSON.stringify(month)})`, ctx);
}

test('이번 달: 목록 순서와 상관없이 활동 중인 기록을 쓴다', async () => {
    for (const members of [[NOW, OLD], [OLD, NOW]]) {
        const { data } = await run(members, '');
        assert.equal(data.length, 1);
        assert.equal(data[0].active, true);
        assert.equal(data[0].ourMember['입단일'], '2026-08-05');
    }
});

test('지난 달: 그 달과 겹치는 기록만 쓴다', async () => {
    for (const members of [[NOW, OLD], [OLD, NOW]]) {
        const { data } = await run(members, '2026-06');
        assert.equal(data.length, 1);
        assert.equal(data[0].ourMember['입단일'], '2026-01-10');
    }
});
