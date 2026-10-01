// 멤버 공지: 첫 페이지는 모아 둔 표(member_posts)에서, 표에 없는 멤버·2쪽부터는 SOOP에 직접(soop.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { code } = require('./code-pattern');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOOP = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'soop.js'), 'utf8');

function setup(tableRows, { tableError = null } = {}) {
    const apiCalls = [];
    const ctx = vm.createContext({
        console, Map, Set, Promise, Number, String, Array,
        asArray: v => (Array.isArray(v) ? v : []),
        soopDateMs: v => Date.parse(String(v).replace(' ', 'T')),
        Api: {
            memberPosts: async () => { if (tableError) throw tableError; return tableRows; },
            recentPosts: async () => { if (tableError) throw tableError; return tableRows; },
        },
        cachedFetchJson: async url => {
            apiCalls.push(url);
            return { contents: [{ titleNo: 9, userId: 'api', regDate: '2026-09-01 10:00:00', titleName: 'api' }], noticeData: [], meta: { totalPages: 3 } };
        },
    });
    vm.runInContext(SOOP, ctx);
    return { ctx, apiCalls, feed: (id, page) => vm.runInContext(`fetchMemberFeed(${JSON.stringify(id)}, ${page})`, ctx) };
}

const ROWS = [
    { soop_id: 'aaa', total_pages: 5, post: { titleNo: 1, userId: 'aaa', regDate: '2026-09-20 10:00:00' } },
    { soop_id: 'aaa', total_pages: 5, post: { titleNo: 2, userId: 'aaa', regDate: '2026-09-25 10:00:00' } },
];

test('첫 페이지는 모아 둔 표에서 읽고 SOOP은 부르지 않는다(최신순)', async () => {
    const { feed, apiCalls } = setup(ROWS);
    const r = await feed('AAA', 1);
    assert.deepEqual(Array.from(r.posts, p => p.titleNo), [2, 1]);   // VM 배열 → 바깥 배열로 비교
    assert.equal(r.totalPages, 5);
    assert.equal(apiCalls.length, 0);
});

test('표에 없는 멤버와 2쪽부터는 SOOP에 직접 묻는다', async () => {
    const { feed, apiCalls } = setup(ROWS);
    await feed('api', 1);
    await feed('aaa', 2);
    assert.equal(apiCalls.length, 2);
    assert.match(apiCalls[0], /channel\/api\/board\?perPage=10&page=1/);
    assert.match(apiCalls[1], /channel\/aaa\/board\?perPage=10&page=2/);
});

test('표를 못 읽거나 비어 있으면 예전처럼 SOOP에 직접 묻는다', async () => {
    for (const opts of [[[], {}], [null, { tableError: { message: 'x' } }]]) {
        const { feed, apiCalls } = setup(...opts);
        const r = await feed('aaa', 1);
        assert.equal(apiCalls.length, 1);
        assert.equal(r.totalPages, 3);
    }
});

test('홈 카드용 최근 글은 카드 칸만 받아 카드 모양(post)으로 되돌린다', async () => {
    const { ctx } = setup([
        { soop_id: 'AAA', titleName: '제목', regDate: '2026-09-25 10:00:00', text: '본문', thumb: 'https://x/1.jpg' },
        { soop_id: 'bbb', titleName: '사진 없음', regDate: '2026-09-24 10:00:00', text: null, thumb: null },
    ]);
    const rows = await vm.runInContext('fetchRecentStoredPosts(30)', ctx);
    assert.equal(rows[0].soopId, 'aaa');
    assert.equal(rows[0].post.photos[0].url, 'https://x/1.jpg');
    assert.equal(rows[0].post.content.textContent, '본문');
    assert.equal(rows[1].post.photos.length, 0);
    assert.equal(rows[1].post.content.textContent, '');
    const api = fs.readFileSync(path.join(__dirname, '..', 'templates', 'assets', 'api.js'), 'utf8');
    assert.match(api, code("select('soop_id,titleName:post->>titleName,regDate:post->>regDate,text:post->content->>textContent,thumb:post->photos->0->>url')"));
});
