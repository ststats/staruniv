import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

// 글꼴·이미지가 다 뜬 뒤 촬영한다. 실패하면 이전 출력은 교체하지 않는다.
export async function capturePage({ url, output, width, height, timeout = 60000, browser: providedBrowser }) {
    const browser = providedBrowser || await chromium.launch({
        ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
        args: ['--no-sandbox', '--hide-scrollbars'],
    });
    let context;
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
        await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.images].every(img => img.complete));
        const image = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled' });
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
