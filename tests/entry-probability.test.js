'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function entryContext(setup) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'assets', 'page-entry.js'), 'utf8');
  const context = vm.createContext({
    console, Date, Math, Promise, URLSearchParams, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  vm.runInContext(setup || `
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
  `, context);
  return context;
}

const run = (context, code) => vm.runInContext(code, context);

test('period filter does not change predicted win probability', () => {
  const context = entryContext();
  const values = run(context, `
    ['30','90','365','all'].map(period => {
      EntryState.period = period;
      return entryWinProb('1', '2', '투혼').p;
    })
  `);
  values.forEach(value => assert.equal(value, values[0]));
});

test('base probability follows the Elo scale and is not clamped to 10-90%', () => {
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

test('all-player theta is preferred over ranked rawRating and tier level', () => {
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

test('race matchup from ranking meta shifts the base symmetrically', () => {
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

test('beating weaker opponents of a race as expected gives no race boost', () => {
  // A(테란)는 저그 상대로 10전 9승인데, 상대가 전부 400점 아래라 기대(약 91%)대로다.
  // 예전 방식(평소 승률 대비)은 이걸 '저그에 강하다'로 읽었다.
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

test('winning more than expected head-to-head moves the probability in logit space', () => {
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

test('recency weights are measured from the ranking as-of date', () => {
  const context = entryContext(`
    EntryState.index = { players:{}, ranking:{ asOf:'2026-06-01', tierLevels:{} }, maps:{} };
  `);
  assert.equal(run(context, `entryRowAgeDays('2026-03-03')`), 90);
  assert.equal(run(context, `entryRecentWeight('2026-03-03')`), 0.5);
});

test('correlated set form makes series odds less extreme than independent sets', () => {
  const context = entryContext();
  const mixed = run(context, `entrySeriesSim([0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7], 9)`);
  const independent = run(context, `entrySeriesSimIndependent([0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7], 9)`);
  assert.ok(mixed.pA < independent.pA);
  assert.ok(mixed.pA > 0.5);
  assert.ok(Math.abs(mixed.pA + mixed.pB - 1) < 1e-9);
  const even = run(context, `entrySeriesSim([0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5], 9)`);
  assert.ok(Math.abs(even.pA - 0.5) < 1e-9);
});
