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
            await ctx.close();
            assert.deepEqual(errors, [], `${url} 스크립트 오류`);
            assert.deepEqual(stuck, [], `${url} 다 그려지지 않음`);
        });
    }
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
