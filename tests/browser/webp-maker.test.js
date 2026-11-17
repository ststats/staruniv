// 움짤생성기 변환이 프레임을 빠뜨리거나 겹치지 않는지 본다. 고정 영상(tests/fixtures/frames-*.webm)과
// 움짤(frames-uneven.gif)은 프레임마다 번호를 8칸 흑백 막대(왼쪽이 1의 자리)로 그린 128×32다. 결과 WebP를 풀어 막대를 읽는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const FILES = {
    '/webp-maker.html': ['templates/standalone/webp-maker.html', 'text/html'],
    '/webp-maker.js': ['templates/assets/webp-maker.js', 'text/javascript'],
};

function serve() {
    const server = http.createServer((req, res) => {
        const hit = FILES[new URL(req.url, 'http://x').pathname];
        if (!hit) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, { 'content-type': hit[1] });
        fs.createReadStream(path.join(ROOT, hit[0])).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// file을 열고 setup(page)으로 설정을 바꾼 뒤 변환한다. 결과 WebP의 프레임마다 [원본 프레임 번호, 표시 시간(ms)]
async function convertFile(page, base, file, setup) {
    await page.goto(`${base}/webp-maker.html`);
    await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures', file));
    await page.waitForFunction(() => !document.getElementById('convert').disabled, null, { timeout: 20000 });
    if (setup) await setup(page);
    await page.click('#convert');
    await page.waitForFunction(() => document.getElementById('resultImg').src.startsWith('blob:'), null, {
        timeout: 60000,
    });
    return page.evaluate(async () => {
        const data = await (await fetch(document.getElementById('resultImg').src)).arrayBuffer();
        const decoder = new ImageDecoder({ data, type: 'image/webp' });
        await decoder.tracks.ready;
        const out = [];
        for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const w = canvas.width / 8;
            let n = 0;
            for (let b = 0; b < 8; b++) {
                if (ctx.getImageData(Math.floor(b * w + w / 2), canvas.height >> 1, 1, 1).data[0] > 128) n |= 1 << b;
            }
            out.push([n, Math.round(image.duration / 1000)]);
            image.close();
        }
        return out;
    });
}

// 영상을 fps로 0~end초 무손실 변환한다. busy면 변환 내내 화면 스레드를 붙잡아 재생 중 프레임을 놓치게 한다
// (놓친 프레임은 위치를 옮겨 다시 뽑아야 한다).
function convertVideo(page, base, video, fps, end, busy = false) {
    return convertFile(page, base, video, page =>
        page.evaluate(
            ([fps, end, busy]) => {
                const set = (id, v) => {
                    const el = document.getElementById(id);
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                };
                set('fps', fps);
                set('start', 0);
                set('end', end);
                if (!document.getElementById('lossless').checked) document.getElementById('lossless').click();
                if (busy)
                    setInterval(() => {
                        const until = performance.now() + 45;
                        while (performance.now() < until);
                    }, 50);
            },
            [fps, end, busy]
        )
    );
}

// 출력 프레임 하나하나가 몇 번 영상 프레임인지 펼친다(같은 프레임이 이어지면 한 장으로 합쳐져 길이가 늘어난다)
function unroll(frames, fps) {
    return frames.flatMap(([n, ms]) => Array(Math.round(ms / (1000 / fps))).fill(n));
}

test('움짤 변환은 원본 프레임을 빠뜨리거나 겹치지 않는다', { timeout: 240000 }, async () => {
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const page = await (await browser.newContext()).newPage();
        // 글꼴 등 바깥 요청은 막는다(변환과 무관)
        await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
        const range = (n, step = 1) => Array.from({ length: n }, (_, i) => i * step);
        // 같은 fps: 경계에서 뽑으면 3장마다 한 장이 빠졌다(0 1 1 3 4 4 …)
        assert.deepEqual(unroll(await convertVideo(page, base, 'frames-30fps.webm', 30, 2), 30), range(60));
        // 절반 fps: 짝수 프레임만 고르게
        assert.deepEqual(unroll(await convertVideo(page, base, 'frames-60fps.webm', 30, 1), 30), range(30, 2));
        assert.deepEqual(unroll(await convertVideo(page, base, 'frames-30fps.webm', 15, 2), 15), range(30, 2));
        // 두 배 fps: 모든 프레임이 정확히 두 번씩
        const doubled = range(60).flatMap(n => [n, n]);
        assert.deepEqual(unroll(await convertVideo(page, base, 'frames-30fps.webm', 60, 2), 60), doubled);
        // 재생하며 뽑다가 프레임을 놓쳐도 결과는 같다
        assert.deepEqual(unroll(await convertVideo(page, base, 'frames-60fps.webm', 60, 1, true), 60), range(60));
        // GIF는 fps로 다시 뽑지 않고 원본 프레임·간격 그대로(전에는 30fps로 뽑아 빠른 프레임이 빠지고 간격이 틀어졌다)
        const delays = [20, 70, 40, 100, 30, 60, 20, 20, 90, 50, 40, 80];
        assert.deepEqual(
            await convertFile(page, base, 'frames-uneven.gif'),
            delays.map((ms, i) => [i, ms])
        );
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
    }
});
