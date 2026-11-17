const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../templates/assets/page-members.js'), 'utf8');
const fn = source.slice(
    source.indexOf('async function loadMoreMemberNews('),
    source.indexOf('\nasync function loadMoreNewsFeed(')
);
const post = titleNo => ({ titleNo });
function setup(fetcher, totalPages = 100) {
    const member = { 'SOOP ID': 'freshtomato' };
    const state = {
        player: member,
        requestSeq: 1,
        memberPage: 1,
        memberTotalPages: totalPages,
        items: [{ member, post: post(1) }],
    };
    const calls = [];
    const ctx = vm.createContext({
        NewsState: state,
        NEWS_PAGE_SIZE: 10,
        Set,
        newsItemKey: item => item.member['SOOP ID'] + '_' + item.post.titleNo,
        fetchMemberFeed: async (id, page) => {
            calls.push({ id, page });
            return fetcher(page, state);
        },
    });
    vm.runInContext(fn, ctx);
    return { state, calls, more: () => ctx.loadMoreMemberNews(1) };
}
test('one click skips repeated pins and empty visitor-only pages until ten new notices are found', async () => {
    const { state, calls, more } = setup(page => ({
        posts: page < 8 ? (page % 2 ? [post(1)] : []) : [post(page)],
        totalPages: 100,
    }));
    await more();
    assert.equal(state.items.length, 11);
    assert.equal(state.memberPage, 17);
    assert.equal(calls.length, 16);
    assert.ok(calls.every(call => call.id === 'freshtomato'));
    assert.equal(state.hasMore, true);
});
test('last source page stops loading with fewer than ten new notices', async () => {
    const { state, more } = setup(page => ({ posts: [post(page)], totalPages: 3 }), 3);
    await more();
    assert.equal(state.items.length, 3);
    assert.equal(state.memberPage, 3);
    assert.equal(state.hasMore, false);
});
test('same-page duplicates count once and the scan has a finite bound', async () => {
    const { state, calls, more } = setup(() => ({ posts: [post(1), post(1)], totalPages: 100 }));
    await more();
    assert.equal(state.items.length, 1);
    assert.equal(calls.length, 50);
    assert.equal(state.hasMore, true);
});
test('member switch during scan discards the response without advancing the new view', async () => {
    const { state, more } = setup((page, state) => {
        state.requestSeq++;
        return { posts: [post(page)], totalPages: 100 };
    });
    assert.equal(await more(), false);
    assert.equal(state.memberPage, 1);
    assert.equal(state.items.length, 1);
});
test('failed page is retried rather than skipped, including after partial success', async () => {
    for (const failPage of [2, 3]) {
        let fail = true;
        const { state, calls, more } = setup(page => {
            if (fail && page === failPage) throw new Error('temporary outage');
            return { posts: [post(page)], totalPages: 4 };
        }, 4);
        if (failPage === 2) await assert.rejects(more(), /temporary outage/);
        else await more();
        assert.equal(state.memberPage, failPage - 1);
        fail = false;
        const before = calls.length;
        await more();
        assert.equal(calls[before].page, failPage);
        assert.equal(state.items.length, 4);
    }
});
