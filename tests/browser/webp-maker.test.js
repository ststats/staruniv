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

// 투명: 여백 투명(여백 넣기)·투명색(고른 색 지우기)은 손실 압축이어도 투명하게 저장되고, 나머지는 그대로 남는다.
// 고정 움짤은 흰 막대(번호 비트 1)와 검은 막대로 된 128×32라, 5번 프레임은 0·2번 막대가 흰색이다.
test('여백 투명·투명색은 손실 압축에서도 투명하게 저장된다', { timeout: 120000 }, async () => {
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    // 설정을 바꾸고 변환한 뒤, 5번 프레임에서 [x, y] 점들의 알파를 읽는다
    const alphaAt = async (page, setup, points) => {
        await page.goto(`${base}/webp-maker.html`);
        await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures', 'frames-uneven.gif'));
        await page.waitForFunction(() => !document.getElementById('convert').disabled, null, { timeout: 20000 });
        await page.evaluate(setup);
        await page.click('#convert');
        await page.waitForFunction(() => document.getElementById('resultImg').src.startsWith('blob:'), null, {
            timeout: 60000,
        });
        return page.evaluate(async points => {
            const data = await (await fetch(document.getElementById('resultImg').src)).arrayBuffer();
            const decoder = new ImageDecoder({ data, type: 'image/webp' });
            await decoder.tracks.ready;
            const { image } = await decoder.decode({ frameIndex: 5 });
            const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            image.close();
            return points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
        }, points);
    };
    try {
        const page = await (await browser.newContext()).newPage();
        await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
        // 투명색: 흰 막대(0·2번)는 투명, 검은 막대(1·3번)는 그대로
        const keyed = await alphaAt(page, () => {
            document.getElementById('keyColor').value = '#ffffff';
            document.getElementById('keyOn').checked = true;
        }, [
            [8, 16],
            [40, 16],
            [24, 16],
            [56, 16],
        ]);
        assert.ok(keyed[0] < 16 && keyed[1] < 16, `흰 막대가 투명하지 않음: ${keyed}`);
        assert.ok(keyed[2] > 240 && keyed[3] > 240, `검은 막대가 지워짐: ${keyed}`);
        // 여백 투명: 128×128에 여백 넣기 → 위아래 여백은 투명, 그림은 불투명
        const margin = await alphaAt(page, () => {
            const set = (id, v) => {
                const el = document.getElementById(id);
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            set('sizeMode', 'custom');
            set('cw', 128);
            set('ch', 128);
            set('fit', 'contain');
            document.getElementById('bgClear').checked = true;
        }, [
            [64, 4],
            [64, 124],
            [24, 64],
        ]);
        assert.ok(margin[0] < 16 && margin[1] < 16, `여백이 투명하지 않음: ${margin}`);
        assert.ok(margin[2] > 240, `그림이 투명해짐: ${margin}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
    }
});

// 선명하게: 작게 줄인 그림의 경계(흰 막대↔검은 막대)에 걸친 회색이 줄어 더 또렷해진다
test('선명하게는 줄인 그림의 경계를 또렷하게 한다', { timeout: 120000 }, async () => {
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    const edges = async (page, sharp) => {
        await page.goto(`${base}/webp-maker.html`);
        await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures', 'frames-uneven.gif'));
        await page.waitForFunction(() => !document.getElementById('convert').disabled, null, { timeout: 20000 });
        await page.evaluate(sharp => {
            const set = (id, v) => {
                const el = document.getElementById(id);
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            set('sizeMode', 'custom');
            set('cw', 45);
            set('ch', 11);
            set('fit', 'stretch');
            set('sharp', sharp);
            if (!document.getElementById('lossless').checked) document.getElementById('lossless').click();
        }, sharp);
        await page.click('#convert');
        await page.waitForFunction(() => document.getElementById('resultImg').src.startsWith('blob:'), null, {
            timeout: 60000,
        });
        return page.evaluate(async () => {
            const data = await (await fetch(document.getElementById('resultImg').src)).arrayBuffer();
            const decoder = new ImageDecoder({ data, type: 'image/webp' });
            await decoder.tracks.ready;
            const { image } = await decoder.decode({ frameIndex: 5 });
            const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            image.close();
            const row = ctx.getImageData(0, canvas.height >> 1, canvas.width, 1).data;
            // 경계에 걸친 회색 점의 진하기(검정·흰색에서 먼 정도)를 더한다. 또렷할수록 작다
            let blur = 0;
            for (let x = 0; x < row.length; x += 4) blur += Math.min(row[x], 255 - row[x]);
            return blur;
        });
    };
    try {
        const page = await (await browser.newContext()).newPage();
        await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
        const plain = await edges(page, '0');
        const sharp = await edges(page, '0.9');
        assert.ok(plain > 0 && sharp < plain * 0.8, `선명하게 효과 없음: ${plain} → ${sharp}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
    }
});

// 200×200처럼 크게 줄일 때: 바로 줄인 결과가 400×400으로 뽑았다 다시 200×200으로 줄인 것만큼 또렷해야 한다.
// 어중간한 비율 축소를 마지막(작은 크기)에 하면 흐려졌다(1080→540→270→200).
test('작게 줄여도 두 번에 나눠 줄인 것만큼 또렷하다', { timeout: 120000 }, async () => {
    const browser = await chromium.launch(
        process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
    );
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    // file(이름·형식·바이트)을 열어 size 칸으로 무손실 변환 → [결과 바이트, 선명도(라플라시안 분산)]
    const convert = async (page, size, file) => {
        await page.goto(`${base}/webp-maker.html`);
        await page.setInputFiles('#file', file);
        await page.waitForFunction(() => !document.getElementById('convert').disabled, null, { timeout: 20000 });
        await page.click(`[data-for="sizeMode"] [data-v="${size}"]`);
        await page.evaluate(() => {
            if (!document.getElementById('lossless').checked) document.getElementById('lossless').click();
        });
        await page.click('#convert');
        await page.waitForFunction(() => document.getElementById('resultImg').src.startsWith('blob:'), null, {
            timeout: 60000,
        });
        return page.evaluate(async () => {
            const out = new Uint8Array(await (await fetch(document.getElementById('resultImg').src)).arrayBuffer());
            const bmp = await createImageBitmap(new Blob([out], { type: 'image/webp' }));
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const x = c.getContext('2d');
            x.drawImage(bmp, 0, 0);
            const d = x.getImageData(0, 0, c.width, c.height).data;
            const g = (px, py) => d[(py * c.width + px) * 4 + 1];
            let n = 0,
                s1 = 0,
                s2 = 0;
            for (let py = 1; py < c.height - 1; py++)
                for (let px = 1; px < c.width - 1; px++) {
                    const v = 4 * g(px, py) - g(px - 1, py) - g(px + 1, py) - g(px, py - 1) - g(px, py + 1);
                    n++;
                    s1 += v;
                    s2 += v * v;
                }
            return [Array.from(out), s2 / n - (s1 / n) ** 2];
        });
    };
    try {
        const page = await (await browser.newContext()).newPage();
        await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
        // 가는 사선 줄무늬 1080×1080 PNG
        await page.goto(`${base}/webp-maker.html`);
        const png = await page.evaluate(async () => {
            const c = new OffscreenCanvas(1080, 1080);
            const x = c.getContext('2d');
            x.fillStyle = '#123';
            x.fillRect(0, 0, 1080, 1080);
            x.strokeStyle = '#fc0';
            x.lineWidth = 5;
            for (let i = -1080; i < 1080; i += 23) {
                x.beginPath();
                x.moveTo(i, 0);
                x.lineTo(i + 700, 1080);
                x.stroke();
            }
            return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
        });
        const src = { name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(png) };
        const [, direct] = await convert(page, '200', src);
        const [mid] = await convert(page, '400', src);
        const [, twoStep] = await convert(page, '200', {
            name: 'mid.webp',
            mimeType: 'image/webp',
            buffer: Buffer.from(mid),
        });
        assert.ok(direct >= twoStep * 0.95, `바로 줄인 쪽이 흐림: ${direct.toFixed(0)} < ${twoStep.toFixed(0)}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
    }
});
