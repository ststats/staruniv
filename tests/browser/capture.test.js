const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const html = `<style>body{margin:0}.cal-main-layout{height:100px}</style>
<div class="cal-main-layout"><div id="daysGrid" data-load-state="ready" aria-busy="false"><div class="cal-day-cell"></div></div><div id="todayList" aria-busy="false"></div></div>
<script>function calTodayStr(){return '2026-10-07'}</script>`;

test('달력 준비 직후 로딩이 재개돼도 준비 스냅샷을 쓰고 크기 변경 후 다시 기다린다', async () => {
    const { capturePage } = await import('../../scripts/capture_page.mjs');
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-capture-'));
    let context;
    try {
        const wrapped = {
            async newContext(options) {
                context = await browser.newContext(options);
                const newPage = context.newPage.bind(context);
                context.newPage = async () => {
                    const page = await newPage();
                    const wait = page.waitForFunction.bind(page);
                    let first = true;
                    page.waitForFunction = async (...args) => {
                        const ready = await wait(...args);
                        if (first) {
                            first = false;
                            await page.evaluate(() => {
                                const grid = document.getElementById('daysGrid');
                                grid.dataset.loadState = 'loading';
                                setTimeout(() => {
                                    grid.dataset.loadState = 'ready';
                                }, 250);
                            });
                        }
                        return ready;
                    };
                    return page;
                };
                return context;
            },
        };
        const output = path.join(dir, 'calendar.png');
        const size = await capturePage({
            url: 'data:text/html,' + encodeURIComponent(html),
            output,
            width: 804,
            height: 2000,
            calendar: true,
            timeout: 5000,
            browser: wrapped,
        });
        assert.deepEqual(size, { width: 804, height: 100 });
        assert.deepEqual((await fs.readFile(output)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        assert.equal(browser.contexts().length, 0);

        const previous = await fs.readFile(output);
        await assert.rejects(
            capturePage({
                url:
                    'data:text/html,' +
                    encodeURIComponent(html.replace('data-load-state="ready"', 'data-load-state="loading"')),
                output,
                width: 804,
                height: 2000,
                calendar: true,
                timeout: 500,
                browser,
            }),
            /Timeout/
        );
        assert.deepEqual(await fs.readFile(output), previous);
        assert.deepEqual(await fs.readdir(dir), ['calendar.png']);
        assert.equal(browser.contexts().length, 0);
    } finally {
        await browser.close();
        await fs.rm(dir, { recursive: true, force: true });
    }
});
