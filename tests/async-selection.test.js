const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../templates/assets', file), 'utf8');

test('분석 작업 A→B→A에서 이전 성공·반환 오류·거절은 마지막 A를 바꾸지 않는다', async () => {
    const source = read('admin-tier-update.js').match(/    async function openJob\(id\) \{[\s\S]*?\n    \}/)[0];
    for (const outcome of ['success', 'error', 'reject']) {
        const pending = [];
        const U = { jobRequest: 0 };
        const ctx = vm.createContext({
            U,
            render() {},
            loadPeople: async () => {},
            kstToday: () => '',
            initDecisions() {},
            AdminApi: {
                tierJobs: {
                    get: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
                },
            },
        });
        vm.runInContext(source, ctx);
        const first = ctx.openJob(1);
        const middle = ctx.openJob(2);
        const last = ctx.openJob(1);
        pending[2].resolve({ data: { id: 1, status: 'done', version: 'latest' } });
        await last;
        pending[1].resolve({ data: { id: 2, status: 'failed' } });
        await middle;
        if (outcome === 'reject') pending[0].reject(new Error('old network failure'));
        else pending[0].resolve(outcome === 'error' ? { error: new Error('old error') } : { data: { id: 1 } });
        await first;
        assert.equal(U.job.version, 'latest');
    }
});

test('달 목록이 늦게 도착해도 최신 월 URL은 최신 캐시 키로 바꾸고 과거 월은 유지한다', async () => {
    const src = read('page-stats.js');
    const source = src.slice(src.indexOf('function loadSynergyMonths()'), src.indexOf('function synergyMonthLabel'));
    for (const selected of ['2026-10', '2026-09', '']) {
        const changes = [];
        const ctx = vm.createContext({
            SynergyMonths: [],
            SynergyState: { month: selected },
            fetchSynergyMonths: async () => [{ month: '2026-10' }, { month: '2026-09' }],
            setSynergyMonth: month => changes.push(month),
            renderSynergyMonthNav() {},
            console,
        });
        vm.runInContext(source, ctx);
        await ctx.loadSynergyMonths();
        assert.deepEqual(changes, selected === '2026-10' ? [''] : []);
        assert.equal(ctx.synergyMonthKey('2026-10'), '');
        assert.equal(ctx.synergyMonthKey('2026-09'), '2026-09');
    }
});
