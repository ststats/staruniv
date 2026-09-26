// 방송통계 달 이동: 먼저 보낸 요청이 늦게 와도 마지막으로 고른 달의 상태·화면이 유지되는지.
// core.js·page-stats.js의 실제 함수를 떼어 VM에서 돌리고, Supabase 응답 순서만 손으로 정한다.
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
const CORE = slice(read('templates/assets/core.js'), 'let _synergyMonthsRequest', 'function applySynergyResult')
    + slice(read('templates/assets/core.js'), 'function applySynergyResult', '// ====');
const PAGE = slice(read('templates/assets/page-stats.js'), 'let _synergyLoadSeq', 'function loadSynergyMonths');

const MONTH_DATES = { '2026-07': '2026-07-31', '2026-08': '2026-08-31', '': '2026-09-26' };

function setup() {
    const pending = new Map();   // stat_date -> { resolve, reject }
    const paints = [];
    const el = { innerText: '', innerHTML: '' };
    const ctx = vm.createContext({
        console: { error() {} }, Map, Set, Promise, Error,
        SynergyState: { month: '', data: null, failed: false, statDate: '', updatedAt: '' },
        SiteData: { members: [{ 'SOOP ID': 'p1', '입단일': '2020-01-01', '퇴단일': '' }] },
        isActiveMember: () => true,
        document: { getElementById: () => el },
        formatKstDateTime: x => x,
        renderSynergyMonthText() {}, renderSynergyMonthNav() {},
        renderSynergyTable() { paints.push(ctx.SynergyState.month); },
        emptyRowHtml: () => 'error',
        publicSupabaseClient() {
            return { from(table) {
                const q = { table, date: '', select() { return q; }, order() { return q; }, range() { return q; },
                    limit() { return Promise.resolve({ data: [{ stat_date: MONTH_DATES[''] }], error: null }); },
                    eq(k, v) { if (k === 'stat_date') q.date = v; return q; }, in() { return q; } };
                return q;
            } };
        },
        fetchAllPages(makeQuery) {
            const q = makeQuery(0, 999);
            if (q.table === 'synergy_daily_dates') {
                return Promise.resolve([{ stat_date: '2026-09-26' }, { stat_date: '2026-08-31' }, { stat_date: '2026-07-31' }]);
            }
            return new Promise((resolve, reject) => pending.set(q.date, { resolve, reject }));
        },
    });
    vm.runInContext(CORE + PAGE, ctx);
    const tick = () => new Promise(r => setImmediate(r));
    const load = month => vm.runInContext(`loadSynergyData(${JSON.stringify(month)})`, ctx);
    const answer = (month, balloons) => pending.get(MONTH_DATES[month]).resolve([{ soop_id: 'p1', balloons, updated_at: MONTH_DATES[month] }]);
    const fail = month => pending.get(MONTH_DATES[month]).reject(new Error('network'));
    return { ctx, paints, tick, load, answer, fail };
}

test('A→B로 바꾼 뒤 A 응답이 늦게 와도 상태는 B로 남는다', async () => {
    const { ctx, paints, tick, load, answer } = setup();
    const a = load('2026-07'); await tick();
    const b = load('2026-08'); await tick();
    answer('2026-08', 800); await b;
    answer('2026-07', 700); await a;
    assert.equal(ctx.SynergyState.month, '2026-08');
    assert.equal(ctx.SynergyState.data[0].balloons, 800);
    assert.equal(ctx.SynergyState.statDate, '2026-08-31');
    assert.deepEqual(paints, ['2026-08']);
});

test('A→B→A: 마지막으로 고른 A가 남고, 먼저 보낸 A 요청을 같이 쓴다', async () => {
    const { ctx, paints, tick, load, answer } = setup();
    const a1 = load('2026-07'); await tick();
    const b = load('2026-08'); await tick();
    const a2 = load('2026-07'); await tick();
    answer('2026-07', 700); await Promise.all([a1, a2]);
    answer('2026-08', 800); await b;
    assert.equal(ctx.SynergyState.month, '2026-07');
    assert.equal(ctx.SynergyState.data[0].balloons, 700);
    assert.deepEqual(paints, ['2026-07']);
});

test('캐시에 있는 달로 돌아간 뒤 새 달 응답이 늦게 와도 캐시 달이 남는다', async () => {
    const { ctx, paints, tick, load, answer } = setup();
    const a = load('2026-07'); await tick();
    answer('2026-07', 700); await a;
    const b = load('2026-08'); await tick();
    const aAgain = load('2026-07'); await aAgain;   // 캐시라 바로 끝남
    answer('2026-08', 800); await b;
    assert.equal(ctx.SynergyState.month, '2026-07');
    assert.equal(ctx.SynergyState.data[0].balloons, 700);
    assert.deepEqual(paints, ['2026-07', '2026-07']);
});

test('늦게 실패한 옛 요청은 실패 표시·상태를 건드리지 않는다', async () => {
    const { ctx, paints, tick, load, answer, fail } = setup();
    const a = load('2026-07'); await tick();
    const b = load('2026-08'); await tick();
    answer('2026-08', 800); await b;
    fail('2026-07'); await a;
    assert.equal(ctx.SynergyState.failed, false);
    assert.equal(ctx.SynergyState.month, '2026-08');
    assert.deepEqual(paints, ['2026-08']);
});

test('실패한 달은 다시 고르면 새로 받는다', async () => {
    const { ctx, tick, load, answer, fail } = setup();
    const a = load('2026-07'); await tick();
    fail('2026-07'); await a;
    assert.equal(ctx.SynergyState.failed, true);
    const again = load('2026-07'); await tick();
    answer('2026-07', 700); await again;
    assert.equal(ctx.SynergyState.failed, false);
    assert.equal(ctx.SynergyState.data[0].balloons, 700);
});

test('page-stats.js 전체가 오류 없이 읽힌다(지표 설정이 아래 상수를 먼저 쓰는 실수 방지)', () => {
    const ctx = vm.createContext({
        console, formatCount: (v, u) => `${v}${u}`, formatSecondsToHM: v => `${v}`,
        formatSponsorRecord: (w, l) => `${w}-${l}`, hasOwn: (o, k) => Object.prototype.hasOwnProperty.call(o, k),
        bootPage() {},
    });
    vm.runInContext(read('templates/assets/page-stats.js'), ctx);
    const help = vm.runInContext('SYNERGY_METRICS.sponsor_rate.help', ctx);
    assert.match(help.rows[0][1], /^10판 이상/);
});
