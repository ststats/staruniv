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
        /^function todayStr\([\s\S]*?^\}$/m,
    ]) {
        vm.runInContext(core.match(re)[0], context);
    }
    const h2h = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'page-h2h.js'), 'utf8');
    for (const re of [
        /^function h2hSince\([\s\S]*?^\}$/m,
        /^const eloSourceRequests = .*;$/m,
        /^function eloSource\([\s\S]*?^\}$/m,
        /^function eloPlayersSource\([\s\S]*?^\}$/m,
        /^function eloPlayerMatchesSource\([\s\S]*?^\}$/m,
    ]) {
        vm.runInContext(h2h.match(re)[0], context);
    }
    vm.runInContext(source, context);
    vm.runInContext(
        setup ||
            `
    EntryState.index = { players: {
      '1': { n:'A', r:'T', t:'1', rawRating:1600 },
      '2': { n:'B', r:'Z', t:'1', rawRating:1500 }
    }, prediction:{ tierLevels:{'1':1500} }, maps:{} };
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

function jointContext() {
    return entryContext(`
      EntryState.index = {players:{
        '1': {n:'A',r:'T',modelRace:'T',t:'1',theta:1600,matchupEffects:{T:-10,Z:30,P:-20}},
        '2': {n:'B',r:'Z',modelRace:'Z',t:'1',theta:1500,matchupEffects:{T:10,Z:-5,P:-5}}
      },prediction:{modelVersion:'joint-map-v1',asOf:'2026-10-13',tierLevels:{'1':1500},raceMatchup:{TZ:20,ZP:20,PT:20}},maps:{}};
      EntryState.rows = {};
    `);
}

test('공동 추정한 실력·공통 상성·양 선수 개인 효과를 한 번씩 더한다', () => {
    const ctx = jointContext();
    const result = run(ctx, "entryWinProb('1','2','')");
    const expected = 1 / (1 + 10 ** (-(100 + 20 + 30 - 10) / 400));
    assert.ok(Math.abs(result.p - expected) < 1e-12);
    assert.ok(Math.abs(result.p - result.base - result.raceAdj) < 1e-12);
});

test('선수 교체와 모든 종족 조합에서 승률은 반대편과 합쳐 1이다', () => {
    const ctx = jointContext();
    for (const a of ['T', 'Z', 'P', ''])
        for (const b of ['T', 'Z', 'P', '']) {
            run(ctx, `EntryState.index.players['1'].modelRace='${a}'; EntryState.index.players['2'].modelRace='${b}';`);
            const forward = run(ctx, "entryComputeWinProb('1','2','').p");
            const reverse = run(ctx, "entryComputeWinProb('2','1','').p");
            assert.ok(Math.abs(forward + reverse - 1) < 1e-12);
        }
});

test('한쪽 종족이 미상이면 공동학습 때와 같이 개인 효과를 적용하지 않는다', () => {
    const ctx = jointContext();
    run(ctx, "EntryState.index.players['2'].modelRace='';");
    const p = run(ctx, "entryComputeWinProb('1','2','')");
    assert.equal(p.raceAdj, 0);
    assert.equal(p.raceEdge, 0);
});

test('현재 명단의 종족을 바꿔도 학습 스냅샷의 예측은 그대로다', () => {
    const ctx = jointContext();
    const before = run(ctx, "entryComputeWinProb('1','2','').p");
    run(ctx, "EntryState.index.players['1'].r='P';");
    assert.equal(run(ctx, "entryComputeWinProb('1','2','').p"), before);
});

test('맞대결 전적·맵·기간을 바꿔도 학습된 효과를 중복 가산하지 않는다', () => {
    const ctx = jointContext();
    const before = run(ctx, "entryComputeWinProb('1','2','').p");
    run(ctx, `EntryState.rows['1']=Array.from({length:100},()=>['2026-10-13',2,1,'투혼','college_event']);`);
    for (const period of ['all', '365', '90', '30']) {
        run(ctx, `EntryState.period='${period}';`);
        assert.equal(run(ctx, "entryComputeWinProb('1','2','투혼').p"), before);
    }
});

test('지원되지 않는 모델로 임의 승률을 표시하지 않는다', () => {
    const ctx = jointContext();
    run(ctx, "EntryState.index.prediction.modelVersion='legacy';");
    assert.equal(run(ctx, "entryComputeWinProb('1','2','')"), null);
});

test('선택 맵의 종족 효과만 반영하고 역방향·동종족·미등록 맵을 처리한다', () => {
    const ctx = jointContext();
    run(ctx, `EntryState.index.prediction.mapMatchup={'투혼':{TZ:40,ZP:-20,PT:10}};`);
    const base = run(ctx, "entryComputeWinProb('1','2','')");
    const mapped = run(ctx, "entryComputeWinProb('1','2','투 혼')");
    assert.ok(mapped.p > base.p);
    assert.equal(mapped.mapEdge, 40);
    assert.ok(Math.abs(mapped.p - mapped.base - mapped.raceAdj - mapped.mapAdj) < 1e-12);
    assert.ok(Math.abs(mapped.p + run(ctx, "entryComputeWinProb('2','1','투혼').p") - 1) < 1e-12);
    assert.equal(run(ctx, "entryComputeWinProb('1','2','미등록').p"), base.p);
    assert.equal(run(ctx, "entryMapEdge('T','T','투혼')"), 0);
    assert.equal(run(ctx, "entryMapEdge('','Z','투혼')"), 0);
});

test('랭킹 표시 값을 바꿔도 승률 전용 계산은 바뀌지 않는다', () => {
    const ctx = jointContext();
    const p = run(ctx, "entryComputeWinProb('1','2','').p");
    run(ctx, "EntryState.index.players['1'].k=99;EntryState.index.players['1'].rawRating=9999;");
    assert.equal(run(ctx, "entryComputeWinProb('1','2','').p"), p);
});

test('개인 레이팅이 없으면 티어 기준값을 쓰며 개인 효과는 적용하지 않는다', () => {
    const ctx = jointContext();
    run(ctx, "EntryState.index.players['1'].theta=null;");
    const result = run(ctx, "entryComputeWinProb('1','2','')");
    assert.equal(result.effectA, 0);
    assert.equal(result.exact, false);
    assert.equal(run(ctx, "entryRating(EntryState.index.players['1']).value"), 1500);
});

test('강한 레이팅 차를 임의의 10~90% 경계로 자르지 않는다', () => {
    const ctx = jointContext();
    run(ctx, "EntryState.index.players['1'].theta=2100;");
    assert.ok(run(ctx, "entryComputeWinProb('1','2','').p") > 0.9);
});

test('명단 밖 상대도 데이터에 보존하지만 선택 검색에는 올리지 않는다', async () => {
    const ctx = entryContext();
    ctx.Api = {
        eloPlayers: async () => [
            { elo_id: 1, nickname: '선수', race: 'T', tier: '1', affiliation: '팀' },
            { elo_id: 9, nickname: null, elo_name: '외부상대', race: 'Z' },
        ],
        teamOrder: async () => [{ name: '팀' }],
    };
    const index = await run(ctx, 'entryLoadIndexFromSupabase()');
    assert.equal(index.players['9'].r, 'Z');
    assert.equal(index.players['9'].selectable, false);
    ctx.loaded = index;
    run(ctx, 'EntryState.index=loaded;');
    assert.equal(run(ctx, "entrySearch('외부').length"), 0);
    assert.equal(run(ctx, "entryRoster('팀').length"), 1);
});

test('한 스냅샷을 통째로 적용하고 이전 스냅샷의 누락 선수 계수는 지운다', () => {
    const ctx = jointContext();
    ctx.model = {
        as_of: '2026-10-14',
        model_version: 'joint-map-v1',
        half_life_days: 90,
        tier_levels: { '1': 1500 },
        race_matchup: { TZ: 10, ZP: 10, PT: 10 },
        ratings: [
            { elo_id: 1, rating: 1550, rating_se: 40, race: 'P', matchup_effects: { T: 1, Z: 2, P: -3 }, tier_rank: 2 },
        ],
    };
    run(ctx, "entryWinProb('1','2','');entryApplyPredictionModel(model);");
    assert.equal(run(ctx, 'EntryState.index.players[1].theta'), 1550);
    assert.equal(run(ctx, 'EntryState.index.players[2].theta'), null);
    assert.equal(run(ctx, 'EntryState.index.players[2].modelRace'), null);
    assert.equal(run(ctx, 'EntryState.index.prediction.asOf'), '2026-10-14');
    assert.equal(run(ctx, 'EntryState.probCache.size'), 0);
});

test('비어 있거나 지원하지 않는 모델은 기존 스냅샷을 훼손하지 않는다', () => {
    const ctx = jointContext();
    for (const model of [
        {},
        { as_of: '2026-10-14', model_version: 'future-v99', ratings: [{ elo_id: 1, rating: 5 }] },
    ]) {
        ctx.model = model;
        assert.throws(() => run(ctx, 'entryApplyPredictionModel(model)'));
        assert.equal(run(ctx, 'EntryState.index.players[1].theta'), 1600);
    }
});

test('모델 로딩 실패는 재시도할 수 있고 성공은 재요청하지 않는다', async () => {
    const ctx = jointContext();
    let calls = 0;
    ctx.Api = {
        eloPredictionModel: async () => {
            calls++;
            if (calls === 1) throw new Error('offline');
            return { as_of: '2026-10-14', model_version: 'joint-map-v1', ratings: [{ elo_id: 1, rating: 1500 }] };
        },
    };
    ctx.TierState = { view: 'list' };
    ctx.console = { warn: () => {} };
    await run(ctx, 'entryLoadRatingMetaInBackground()');
    assert.equal(run(ctx, "EntryState.ratingMetaLoaded.has('model')"), false);
    await run(ctx, 'entryLoadRatingMetaInBackground()');
    await run(ctx, 'entryLoadRatingMetaInBackground()');
    assert.equal(calls, 2);
});

test('확률 캐시는 모델 교체 때 무효화된다', () => {
    const ctx = jointContext();
    const first = run(ctx, "entryWinProb('1','2','')");
    assert.equal(run(ctx, "entryWinProb('1','2','')"), first);
    run(ctx, "EntryState.index.players['1'].theta+=50;entryProbsChanged();");
    assert.notEqual(run(ctx, "entryWinProb('1','2','').p"), first.p);
});

test('기존 시리즈 컨디션 혼합은 대칭성과 확률합을 유지한다', () => {
    const ctx = jointContext();
    const mixed = run(ctx, 'entrySeriesSim([.7,.7,.7,.7,.7,.7,.7,.7,.7],9)');
    const independent = run(ctx, 'entrySeriesSimIndependent([.7,.7,.7,.7,.7,.7,.7,.7,.7],9)');
    assert.ok(mixed.pA < independent.pA && mixed.pA > 0.5);
    assert.ok(Math.abs(mixed.pA + mixed.pB - 1) < 1e-9);
});
