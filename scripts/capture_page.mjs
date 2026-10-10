import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

// 페이지 준비 확인과 촬영을 같은 탭에서 수행한다. 실패하면 이전 출력은 교체하지 않는다.
export async function capturePage({ url, output, width, height, calendar = false, timeout = 60000, browser: providedBrowser }) {
    const browser = providedBrowser || await chromium.launch({
        ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
        args: ['--no-sandbox', '--hide-scrollbars'],
    });
    let context;
    let today;
    const temp = `${output}.${process.pid}.tmp`;
    try {
        context = await browser.newContext({
            viewport: { width, height }, deviceScaleFactor: 1,
            timezoneId: process.env.CAPTURE_TZ || 'Asia/Seoul', locale: 'ko-KR',
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        await page.goto(url, { waitUntil: 'load' });
        const state = () => {
            if (document.fonts.status !== 'loaded' || ![...document.images].every(img => img.complete)) return null;
            const grid = document.getElementById('daysGrid');
            const layout = document.querySelector('.cal-main-layout');
            if (!layout || grid?.dataset.loadState !== 'ready' || grid.getAttribute('aria-busy') !== 'false'
                || document.getElementById('todayList')?.getAttribute('aria-busy') !== 'false'
                || !grid.querySelector('.cal-day-cell')) return null;
            return { width: innerWidth, height: Math.ceil(layout.getBoundingClientRect().bottom), today: calTodayStr() };
        };
        const waitForState = async () => {
            // 준비된 순간의 반환값을 사용한다. 다시 evaluate하면 그 사이 로딩이 재개될 수 있다.
            const handle = await page.waitForFunction(state);
            try { return await handle.jsonValue(); }
            finally { await handle.dispose(); }
        };
        if (calendar) {
            const first = await waitForState();
            today = first.today;
            if (first.width !== width || first.height <= 0) throw new Error('달력 크기가 올바르지 않습니다');
            height = first.height;
            await page.setViewportSize({ width, height });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const ready = await waitForState();
            if (!ready || ready.width !== width || ready.height !== height || ready.today !== first.today)
                throw new Error('촬영 전에 달력 상태가 변경되었습니다');
        } else {
            await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.images].every(img => img.complete));
        }
        const image = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled' });
        if (calendar) {
            const after = await page.evaluate(state);
            if (!after || after.width !== width || after.height !== height || after.today !== today) throw new Error('촬영 중 달력 상태가 변경되었습니다');
        }
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(temp, image);
        await fs.rename(temp, output);
        return { width, height };
    } finally {
        try {
            await fs.rm(temp, { force: true });
        } finally {
            try { await context?.close(); }
            finally { if (!providedBrowser) await browser.close(); }
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [url, output, width, height] = process.argv.slice(2);
    if (!url || !output || !(Number(width) > 0) || !(Number(height) > 0)) throw new Error('사용: capture_page.mjs URL OUTPUT WIDTH HEIGHT');
    await capturePage({ url, output: path.resolve(output), width: Number(width), height: Number(height) });
}
