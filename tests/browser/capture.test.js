const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const html = '<style>body{margin:0;background:#123}</style><p>공유 카드</p>';

test('주어진 크기로 PNG를 찍고, 실패하면 이전 출력을 그대로 둔다', async () => {
    const { capturePage } = await import('../../scripts/capture_page.mjs');
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-capture-'));
    // 응답하지 않는 서버: 페이지가 끝내 뜨지 않는 경우
    const server = http.createServer(() => {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const output = path.join(dir, 'card.png');
        const size = await capturePage({
            url: 'data:text/html,' + encodeURIComponent(html),
            output,
            width: 320,
            height: 200,
            timeout: 5000,
            browser,
        });
        assert.deepEqual(size, { width: 320, height: 200 });
        const image = await fs.readFile(output);
        assert.deepEqual(image.subarray(0, 8), PNG);
        assert.equal(image.readUInt32BE(16), 320);
        assert.equal(image.readUInt32BE(20), 200);
        assert.equal(browser.contexts().length, 0);

        await assert.rejects(
            capturePage({
                url: `http://127.0.0.1:${server.address().port}/`,
                output,
                width: 320,
                height: 200,
                timeout: 500,
                browser,
            }),
            /Timeout/
        );
        assert.deepEqual(await fs.readFile(output), image);
        assert.deepEqual(await fs.readdir(dir), ['card.png']);
        assert.equal(browser.contexts().length, 0);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
        await fs.rm(dir, { recursive: true, force: true });
    }
});
