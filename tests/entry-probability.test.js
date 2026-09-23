'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function entryContext() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'assets', 'page-entry.js'), 'utf8');
  const context = vm.createContext({
    console, Date, Math, Promise, URLSearchParams, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  vm.runInContext(`
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

test('period filter does not change predicted win probability', () => {
  const context = entryContext();
  const values = vm.runInContext(`
    ['30','90','365','all'].map(period => {
      EntryState.period = period;
      return entryWinProb('1', '2', '투혼').p;
    })
  `, context);
  values.forEach(value => assert.equal(value, values[0]));
});
