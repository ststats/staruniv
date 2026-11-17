// 재입단 선수: 이번 달은 활동 중인 기록을, 지난 달은 말일에 걸친 기록 중 늦게 입단한 기록을 잇는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Windows에서 CRLF로 받아도 같은 구간을 찾게 LF로 맞춘다
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const slice = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `${from} ~ ${to} 구간을 찾지 못함`);
    return src.slice(a, b);
};
const core = read('templates/assets/core.js');
const CODE =
    slice(core, 'function isActiveMember', '\n}\n') +
    '\n}\n' +
    slice(core, 'let _synergyMonthsRequest', 'function applySynergyResult');

const OLD = { 'SOOP ID': 'p1', '입단일': '2026-01-10', '퇴단일': '2026-06-20', 'tier': '5' };
const NOW = { 'SOOP ID': 'p1', '입단일': '2026-08-05', '퇴단일': '', 'tier': '3' };

function run(members, month) {
    const ctx = vm.createContext({
        console: { error() {} },
        Map,
        Set,
        Promise,
        Error,
        String,
        Number,
        SiteData: { members },
        Api: {
            statsLatest: async ids => ids.map(id => ({ soop_id: id, stat_date: '2026-09-26', balloons: 10 })),
            statsDates: async () => [
                { stat_date: '2026-09-26' },
                { stat_date: '2026-08-31' },
                { stat_date: '2026-06-30' },
                { stat_date: '2026-05-31' },
            ],
            stats: async (date, ids) => ids.map(id => ({ soop_id: id, balloons: 5 })),
        },
    });
    vm.runInContext(CODE, ctx);
    return vm.runInContext(`fetchSynergyResult(${JSON.stringify(month)})`, ctx);
}

test('이번 달: 목록 순서와 상관없이 활동 중인 기록을 쓴다', async () => {
    for (const members of [
        [NOW, OLD],
        [OLD, NOW],
    ]) {
        const { data } = await run(members, '');
        assert.equal(data.length, 1);
        assert.equal(data[0].active, true);
        assert.equal(data[0].ourMember['입단일'], '2026-08-05');
    }
});

test('지난 달: 그 달 말일에 걸친 기록만 쓴다', async () => {
    for (const members of [
        [NOW, OLD],
        [OLD, NOW],
    ]) {
        const { data } = await run(members, '2026-05');
        assert.equal(data.length, 1);
        assert.equal(data[0].ourMember['입단일'], '2026-01-10');
    }
});

test('지난 달: 그 달 안에 퇴단한 멤버는 빠지고, 그 달 안에 입단한 멤버는 들어간다', async () => {
    const STAY = { 'SOOP ID': 'p2', '입단일': '2026-01-01', '퇴단일': '', 'tier': '4' };
    // vm 안에서 만든 배열이라 펼쳐서 비교한다
    // 6월: OLD(6/20 퇴단)는 6/30에 팀에 없다
    const june = await run([OLD, STAY], '2026-06');
    assert.deepEqual([...june.data.map(d => d.id)], ['p2']);
    // 8월: NOW(8/5 입단)는 8/31에 팀에 있다
    const aug = await run([NOW, STAY], '2026-08');
    assert.deepEqual([...aug.data.map(d => d.id)].sort(), ['p1', 'p2']);
    // 말일에 퇴단해도 그 달 결산에서 빠진다
    const lastDay = await run([{ ...STAY, 'SOOP ID': 'p3', '퇴단일': '2026-08-31' }, STAY], '2026-08');
    assert.deepEqual([...lastDay.data.map(d => d.id)], ['p2']);
});
