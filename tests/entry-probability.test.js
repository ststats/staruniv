'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function entryContext(setup) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'page-entry.js'), 'utf8');
    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        URLSearchParams,
        setTimeout,
        clearTimeout,
    });
    const core = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'core.js'), 'utf8');
    for (const re of [
        /^function raceCode\([\s\S]*?^\}$/m,
        /^const RACE_NAMES = .*;$/m,
        /^function withTimeout\([\s\S]*?^\}$/m,
    ]) {
        vm.runInContext(core.match(re)[0], context);
    }
    const h2h = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'page-h2h.js'), 'utf8');
    vm.runInContext(h2h.match(/^function h2hSince\([\s\S]*?^\}$/m)[0], context);
    vm.runInContext(source, context);
    vm.runInContext(
        setup ||
            `
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', rawRating:1600 },
      '2': { n:'B', r:'Z', t:'1', rawRating:1500 }
    }, ranking:{ tierLevels:{'1':1500} }, maps:{} };
    EntryState.rows = {
      '1': [
        ['2026-09-20', 2, 1, '투혼', '대학대전'],
        ['2025-01-01', 2, 0, '투혼', '대학대전']
      ],
      '2': [
        ['2026-09-20', 1, 0, '투혼', '대학대전'],
        ['2025-01-01', 1, 1, '투혼', '대학대전']
      ]
    };
  `,
        context
    );
    return context;
}

const run = (context, code) => vm.runInContext(code, context);

test('기간 필터를 바꿔도 예상 승률은 그대로다', () => {
    const context = entryContext();
    const values = run(
        context,
        `
    ['30','90','365','all'].map(period => {
      EntryState.period = period;
      return entryWinProb('1', '2', '투혼').p;
    })
  `
    );
    values.forEach(value => assert.equal(value, values[0]));
});

test('기본 승률은 Elo 공식을 따르고 10~90%로 자르지 않는다', () => {
    const context = entryContext(`
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', rawRating:2000 },
      '2': { n:'B', r:'T', t:'1', rawRating:1500 }
    }, ranking:{ asOf:'2026-09-24', tierLevels:{} }, maps:{} };
    EntryState.rows = {};
  `);
    const wp = run(context, `entryWinProb('1', '2', '')`);
    const elo = 1 / (1 + Math.pow(10, -500 / 400));
    assert.ok(Math.abs(wp.base - elo) < 1e-12);
    assert.ok(wp.p > 0.9, `expected > 90%, got ${wp.p}`);
});

test('레이팅은 전체 선수 theta → 랭킹 rawRating → 티어 기준값 순으로 쓴다', () => {
    const context = entryContext(`
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', rawRating:1600, theta:1700 },
      '2': { n:'B', r:'T', t:'1', theta:1500 },
      '3': { n:'C', r:'T', t:'1' }
    }, ranking:{ tierLevels:{'1':1450} }, maps:{} };
  `);
    assert.equal(run(context, `entryRating(EntryState.index.players['1']).value`), 1700);
    assert.equal(run(context, `entryRating(EntryState.index.players['2']).value`), 1500);
    assert.equal(run(context, `entryRating(EntryState.index.players['3']).value`), 1450);
    assert.equal(run(context, `entryRating(EntryState.index.players['3']).exact`), false);
});

test('랭킹 메타의 종족 상성은 기본 승률을 양쪽 대칭으로 옮긴다', () => {
    const context = entryContext(`
    EntryState.index = { players: {
      '1': { n:'T1', r:'T', t:'1', theta:1500 },
      '2': { n:'Z1', r:'Z', t:'1', theta:1500 }
    }, ranking:{ tierLevels:{}, raceMatchup:{ TZ: 40, ZP: 0, PT: 0 } }, maps:{} };
    EntryState.rows = {};
  `);
    const tz = run(context, `entryWinProb('1', '2', '').base`);
    const zt = run(context, `entryWinProb('2', '1', '').base`);
    assert.ok(Math.abs(tz - 1 / (1 + Math.pow(10, -40 / 400))) < 1e-12);
    assert.ok(Math.abs(tz + zt - 1) < 1e-12);
});

test('약한 상대를 기대만큼 이긴 것은 종족 보정을 주지 않는다', () => {
    // 10전 9승이어도 상대가 전부 400점 아래라 기대(약 91%)대로다
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(['2026-09-20', 9, i < 9 ? 1 : 0, '', '']);
    for (let i = 0; i < 10; i++) rows.push(['2026-09-20', 8, i < 5 ? 1 : 0, '', '']);
    const context = entryContext(`
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', theta:1500 },
      '2': { n:'B', r:'Z', t:'1', theta:1500 },
      '9': { n:'weakZ', r:'Z', t:'5', theta:1100 },
      '8': { n:'evenP', r:'P', t:'1', theta:1500 }
    }, ranking:{ asOf:'2026-09-24', tierLevels:{} }, maps:{} };
    EntryState.rows = { '1': ${JSON.stringify(rows)}, '2': [] };
  `);
    const wp = run(context, `entryWinProb('1', '2', '')`);
    assert.ok(Math.abs(wp.raceAdj) < 0.01, `race adj ${wp.raceAdj}`);
});

test('맞대결에서 기대보다 많이 이기면 로짓 공간에서 승률이 오른다', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(['2026-09-20', 2, i < 16 ? 1 : 0, '', '']);
    const context = entryContext(`
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', theta:1500 },
      '2': { n:'B', r:'T', t:'1', theta:1500 }
    }, ranking:{ asOf:'2026-09-24', tierLevels:{} }, maps:{} };
    EntryState.rows = { '1': ${JSON.stringify(rows)}, '2': [] };
  `);
    const wp = run(context, `entryWinProb('1', '2', '')`);
    assert.equal(wp.base, 0.5);
    assert.ok(wp.h2hAdj > 0.05 && wp.h2hAdj < 0.2, `h2h adj ${wp.h2hAdj}`);
    // 로짓에서 더했으므로 최종 확률은 보정 로짓의 시그모이드와 같다
    const logit = run(context, `entryWinProb('1', '2', '').factors.reduce((s, f) => s + f.logit, 0)`);
    assert.ok(Math.abs(wp.p - 1 / (1 + Math.exp(-logit))) < 1e-12);
});

test('최근 가중치는 랭킹 기준일부터 잰다', () => {
    const context = entryContext(`
    EntryState.index = { players:{}, ranking:{ asOf:'2026-06-01', tierLevels:{} }, maps:{} };
  `);
    assert.equal(run(context, `entryRowAgeDays('2026-03-03')`), 90);
    assert.equal(run(context, `entryRecentWeight('2026-03-03')`), 0.5);
});

test('세트끼리 이어진 컨디션을 반영하면 시리즈 승률이 독립 세트 계산보다 덜 극단적이다', () => {
    const context = entryContext();
    const mixed = run(context, `entrySeriesSim([0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7], 9)`);
    const independent = run(context, `entrySeriesSimIndependent([0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7], 9)`);
    assert.ok(mixed.pA < independent.pA);
    assert.ok(mixed.pA > 0.5);
    assert.ok(Math.abs(mixed.pA + mixed.pB - 1) < 1e-9);
    const even = run(context, `entrySeriesSim([0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5], 9)`);
    assert.ok(Math.abs(even.pA - 0.5) < 1e-9);
});

test('승률은 입력이 바뀔 때까지 다시 계산하지 않고 재사용한다', () => {
    const context = entryContext();
    const out = run(
        context,
        `
    let edges = 0;
    const realEdge = entryResidualEdge;
    entryResidualEdge = (...args) => { edges += 1; return realEdge(...args); };
    const first = entryWinProb('1', '2', '투혼');
    const afterFirst = edges;
    const again = entryWinProb('1', '2', '투혼');
    const reused = again === first && edges === afterFirst;
    // 새 전적이 들어오면 다시 계산하고, 값은 캐시 없이 계산한 것과 같다
    EntryState.rows['1'].push(['2026-09-25', 2, 1, '투혼', '대학대전']);
    entryProbsChanged();
    const updated = entryWinProb('1', '2', '투혼');
    ({ reused, afterFirst, recomputed: edges > afterFirst,
       changed: updated.p !== first.p, same: updated.p === entryComputeWinProb('1', '2', '투혼').p });
  `
    );
    assert.equal(out.reused, true);
    assert.equal(out.afterFirst, 5); // 맞대결 1 · 종족 2 · 맵 2
    assert.equal(out.recomputed, true);
    assert.equal(out.changed, true);
    assert.equal(out.same, true);
});
