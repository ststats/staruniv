// 페이지 연기 테스트: 가짜 데이터로 공개 페이지를 열어 오류·로딩 멈춤 없이 그려지는지 본다.
// 브라우저가 필요해 npm test와 따로 돈다(npm run test:pages). 브라우저: CHROME 환경 변수, 없으면 설치된 크롬.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const fixture = require('../fixtures/supabase-fake.js');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const FAKE = 'https://fake.supabase.co';

const PAGES = [
    'index.html',
    'members/',
    'members/?view=news',
    'records/',
    'records/?view=solo',
    'stats/',
    'schedule/',
    'schedule/?view=history',
    'video/',
    'video/?view=pick',
    'tier/',
    'tier/?view=h2h&p1=1000&p2=1003',
    'tier/?view=analysis&p=1000',
    'tier/?view=entry',
    'tools/',
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

function build() {
    const env = { ...process.env, SUPABASE_URL: FAKE, SUPABASE_PUBLISHABLE_KEY: 'fakekey' };
    fs.mkdirSync(path.join(DOCS, 'data'), { recursive: true });
    fs.writeFileSync(path.join(DOCS, 'data', 'site_records_v2.json'), JSON.stringify(fixture.siteData().records));
    const python = process.env.PYTHON || 'python3';
    execFileSync(python, ['scripts/build_html.py'], { cwd: ROOT, env, stdio: 'ignore' });
    execFileSync(python, ['scripts/write_supabase_browser_config.py'], { cwd: ROOT, env, stdio: 'ignore' });
}

function serve() {
    const server = http.createServer((req, res) => {
        let file = path.join(DOCS, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
        if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function routeFixtures(ctx, base, navConfig) {
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith(base)) return route.continue();
        if (navConfig && u.includes('/rpc/api_site_nav')) return route.fulfill({ json: navConfig });
        if (u.startsWith(`${FAKE}/rest/v1/`)) return route.fulfill({ json: fixture.respond(u) });
        if (u.startsWith(`${FAKE}/functions/v1/member-notices`)) {
            const params = new URL(u).searchParams;
            const id = params.get('soop_id');
            const page = Number(params.get('page'));
            const rows = fixture.respond(`${FAKE}/rest/v1/rpc/api_member_posts`).filter(r => r.soop_id === id);
            const posts = rows.map(r => ({ ...r.post, titleNo: r.post.titleNo + (page - 1) * 10000 }));
            return route.fulfill({ json: { posts, totalPages: 2 } });
        }
        if (route.request().resourceType() === 'image') return route.fulfill({ body: PIXEL, contentType: 'image/png' });
        return route.abort();
    });
}

const STUCK = () =>
    [...document.querySelectorAll('body *')]
        .filter(el => el.children.length === 0 && el.offsetParent !== null)
        .map(el => el.textContent.trim())
        .filter(t => /불러오는 중|불러오지 못했습니다/.test(t));

test('공개 페이지가 오류 없이 다 그려진다', { timeout: 300000 }, async t => {
    build();
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    t.after(async () => {
        await browser.close();
        server.close();
    });

    for (const url of PAGES) {
        await t.test(url, async () => {
            const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
            const errors = [];
            await routeFixtures(ctx, base);
            const page = await ctx.newPage();
            page.on('pageerror', e => errors.push(`오류: ${e.message}`));
            page.on('console', m => {
                // 바깥 주소를 막아서 생기는 '리소스를 못 받음'은 뺀다
                if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
                    errors.push(`console.error: ${m.text()}`);
            });
            await page.goto(base + url);
            await page.waitForLoadState('networkidle');
            const stuck = await page
                .waitForFunction(`!(${STUCK})().length`, null, { timeout: 8000 })
                .then(() => [])
                .catch(() => page.evaluate(STUCK));
            if (url === 'tier/') {
                await page.locator('.tier-card.is-live').first().hover();
                const peek = page.locator('.tier-peek.is-open');
                await peek.waitFor({ state: 'visible' });
                const layout = await peek.evaluate(el => {
                    const image = el.querySelector('.live-thumb').getBoundingClientRect();
                    const box = el.getBoundingClientRect();
                    return {
                        body: getComputedStyle(el.querySelector('.live-card-body')).display,
                        ratio: image.width / image.height,
                        inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
                    };
                });
                assert.equal(layout.body, 'grid', '티어 미리보기에도 공통 방송 카드 CSS가 필요하다');
                assert.ok(Math.abs(layout.ratio - 16 / 9) < 0.01, '미리보기 썸네일 비율');
                assert.ok(layout.inside, '미리보기가 화면 밖으로 잘리지 않음');
                await page.mouse.move(0, 0);
                await page.locator('.tier-peek').waitFor({ state: 'hidden' });
            }
            if (url === 'schedule/') {
                assert.equal(await page.locator('#todayList, #todayDateLabel').count(), 2);
                await page.evaluate(() => {
                    calSelectedDateStr = '2026-10-14';
                    calOffAir = { '2026-10-14': Array.from({ length: 17 }, (_, i) => 'member' + i) };
                    calRenderSelectedDateSchedules();
                });
                const chips = page.locator('#selectedDateList .cal-offair-section');
                assert.equal(await chips.locator('.cal-offair-chip:visible').count(), 5);
                assert.equal(
                    await chips
                        .locator('.hist-chip-more .hist-chip-name')
                        .textContent()
                        .then(s => s.trim()),
                    '+12명'
                );
                assert.equal(await chips.locator('.hist-stack-face').count(), 3);
                await chips.locator('.hist-chip-more').click();
                assert.equal(await chips.locator('.cal-offair-chip:visible').count(), 17);
                assert.equal(await chips.locator('.hist-chip-more').count(), 0);
                const layouts = await page.locator('#selectedDateList, #todayList').evaluateAll(elements =>
                    elements.map(el => ({
                        maxHeight: getComputedStyle(el).maxHeight,
                        overflow: getComputedStyle(el).overflowY,
                        fits: el.scrollHeight <= el.clientHeight + 1,
                    }))
                );
                for (const layout of layouts) {
                    assert.equal(layout.maxHeight, 'none');
                    assert.equal(layout.overflow, 'visible');
                    assert.equal(layout.fits, true);
                }
                const columns = await page.evaluate(() => {
                    const list = document.getElementById('selectedDateList');
                    list.innerHTML = ['', '9:00', '19:00', '시간미정']
                        .map((time, id) =>
                            calEventCardHtml(
                                { id, time, person: '캄몬', title: '정렬 확인', participants: [] },
                                '2026-10-14',
                                'selected'
                            )
                        )
                        .join('');
                    return [...list.querySelectorAll('.cal-selected-card')].map(el => ({
                        time: el.querySelector('.cal-card-time').textContent,
                        subjectX: el.querySelector('.cal-card-person').getBoundingClientRect().left,
                        titleX: el.querySelector('.cal-card-desc').getBoundingClientRect().left,
                    }));
                });
                assert.equal(columns[0].time, '-');
                assert.equal(columns[3].time, '미정');
                assert.ok(columns.every(c => c.subjectX === columns[0].subjectX && c.titleX === columns[0].titleX));
                const monthly = await page.evaluate(() => {
                    const sample = document.createElement('div');
                    sample.className = 'cal-day-cell';
                    sample.style.width = '200px';
                    sample.innerHTML = ['', '19:00', '시간미정']
                        .map(time => calGetEventHTML({ time, person: '캄몬', title: '정렬 확인' }))
                        .join('');
                    document.body.appendChild(sample);
                    const rows = [...sample.querySelectorAll('.cal-cell-top')].map(el => ({
                        time: el.querySelector('.cal-event-time').textContent,
                        timeWidth: el.querySelector('.cal-event-time').getBoundingClientRect().width,
                        personX: el.querySelector('.cal-event-person').getBoundingClientRect().left,
                    }));
                    sample.remove();
                    return rows;
                });
                assert.deepEqual(monthly.map(row => row.time), ['-', '19:00', '미정']);
                assert.ok(
                    monthly.every(row => row.timeWidth === monthly[0].timeWidth && row.personX === monthly[0].personX)
                );
            }
            await ctx.close();
            assert.deepEqual(errors, [], `${url} 스크립트 오류`);
            assert.deepEqual(stuck, [], `${url} 다 그려지지 않음`);
        });
    }
    await t.test('개인 공지 진입·더 보기·멤버 전환은 그 멤버만 요청하고 전체 선택에서만 묶음을 받는다', async () => {
        const ctx = await browser.newContext();
        try {
            await routeFixtures(ctx, base);
            const page = await ctx.newPage();
            const calls = [];
            page.on('request', request => {
                const url = new URL(request.url());
                if (url.pathname.endsWith('/api_member_posts') || url.pathname.endsWith('/member-notices'))
                    calls.push(url);
            });
            await page.goto(`${base}members/?view=news&member=${encodeURIComponent('가람')}`);
            await page.locator('#news-feed-content .news-post-card').waitFor();
            assert.equal(calls.filter(u => u.pathname.endsWith('/api_member_posts')).length, 0);
            assert.deepEqual(
                calls.map(u => [u.searchParams.get('soop_id'), u.searchParams.get('page')]),
                [['user0', '1']]
            );
            await page.locator('.news-load-more').click();
            await page.waitForFunction(() => document.querySelectorAll('#news-past-list .news-past-item').length === 3);
            assert.deepEqual(
                calls.map(u => [u.searchParams.get('soop_id'), u.searchParams.get('page')]),
                [
                    ['user0', '1'],
                    ['user0', '2'],
                ]
            );
            await page.locator('[id="news-side-player-나래"]').click();
            await page.waitForFunction(
                () =>
                    document.getElementById('news-content-title').textContent === '나래의 공지' &&
                    document.getElementById('news-feed-content').getAttribute('aria-busy') === 'false'
            );
            assert.equal(calls.filter(u => u.pathname.endsWith('/api_member_posts')).length, 0);
            assert.equal(calls.at(-1).searchParams.get('soop_id'), 'user1');
            await page.locator('#news-side-btn-all').click();
            await page.waitForFunction(
                () =>
                    document.getElementById('news-content-title').textContent === '전체 공지' &&
                    document.getElementById('news-feed-content').getAttribute('aria-busy') === 'false'
            );
            assert.equal(calls.filter(u => u.pathname.endsWith('/api_member_posts')).length, 1);
        } finally {
            await ctx.close();
        }
    });
    await t.test('방문자 글 때문에 비거나 고정글이 반복되는 쪽도 한 번의 더 보기로 건너뛴다', async () => {
        const ctx = await browser.newContext();
        try {
            await routeFixtures(ctx, base);
            const calls = [];
            await ctx.route('**/functions/v1/member-notices*', route => {
                const url = new URL(route.request().url());
                const p = Number(url.searchParams.get('page'));
                calls.push({ id: url.searchParams.get('soop_id'), page: p });
                const titles =
                    p === 1 ? [1, 2] : p === 2 ? [] : p === 3 ? [1, 2] : p === 4 ? [3, 4] : [5, 6, 7, 8, 9, 10, 11, 12];
                return route.fulfill({
                    json: {
                        posts: titles.map(titleNo => ({
                            titleNo,
                            titleName: '공지 ' + titleNo,
                            userId: 'user0',
                            regDate: '2026-10-14 10:00:00',
                        })),
                        totalPages: 10,
                    },
                });
            });
            const page = await ctx.newPage();
            await page.goto(`${base}members/?view=news&member=${encodeURIComponent('가람')}`);
            await page.locator('#news-feed-content .news-post-card').waitFor();
            await page.locator('.news-load-more').click();
            await page.waitForFunction(
                () => document.querySelectorAll('#news-past-list .news-past-item').length === 11
            );
            assert.deepEqual(
                calls.map(c => c.page),
                [1, 2, 3, 4, 5]
            );
            assert.ok(calls.every(c => c.id === 'user0'));
        } finally {
            await ctx.close();
        }
    });
    for (const [route, defaultKey, hiddenKey, prefix, explicit] of [
        ['records', 'individual', 'team', 'tab-', 'team'],
        ['tier', 'h2h', 'list', 'tab-tier-', 'list'],
    ]) {
        await t.test(`${route}: saved public subtab settings`, async () => {
            const ctx = await browser.newContext();
            try {
                const nav = { subtabs: { [route]: { default: defaultKey, hidden: [hiddenKey] } } };
                await routeFixtures(ctx, base, nav);
                await ctx.addInitScript(config => {
                    localStorage.setItem('staruniv-nav-config', JSON.stringify(config));
                }, nav);
                const page = await ctx.newPage();
                const errors = [];
                page.on('pageerror', e => errors.push(e.message));
                await page.goto(`${base}${route}/`);
                await page.waitForFunction(
                    id => document.getElementById(id)?.classList.contains('active'),
                    prefix + defaultKey
                );
                assert.equal(await page.locator('#' + prefix + hiddenKey).isVisible(), false);
                await page.goto(`${base}${route}/?view=${explicit}`);
                await page.waitForFunction(
                    id => document.getElementById(id)?.classList.contains('active'),
                    prefix + hiddenKey
                );
                await page.reload();
                await page.waitForFunction(
                    id => document.getElementById(id)?.classList.contains('active'),
                    prefix + hiddenKey
                );
                assert.deepEqual(errors, []);
            } finally {
                await ctx.close();
            }
        });
    }
});
