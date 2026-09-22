/**
 * 공개 일정 페이지(docs/schedule/)를 헤드리스 브라우저로 열어서
 * "오늘의 일정" + "이달의 일정"을 docs/data/calendar.png 한 장으로 캡처한다.
 *
 * 관리자 페이지가 Supabase Auth 전용으로 바뀌어도 캡처가 영향을 받지 않도록
 * admin.html과 완전히 분리했다. 일정 원본은 공개 페이지가 읽는 docs/data/calendar.json이다.
 */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8791;
const CAPTURE_WIDTH = 804;
const CAPTURE_URL = `http://localhost:${PORT}/schedule/?capture=calendar`;

function waitForServer(url, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            require('http').get(url, res => {
                res.destroy();
                resolve();
            }).on('error', () => {
                if (Date.now() - start > timeoutMs) return reject(new Error('로컬 서버가 응답하지 않습니다.'));
                setTimeout(tryOnce, 200);
            });
        };
        tryOnce();
    });
}

(async () => {
    const pythonCommand = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const server = spawn(pythonCommand, ['-m', 'http.server', String(PORT), '--directory', path.resolve(__dirname, 'docs')]);
    server.stderr.on('data', () => {});

    let browser;
    try {
        await waitForServer(CAPTURE_URL, 10000);
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.setViewport({ width: CAPTURE_WIDTH, height: 1700, deviceScaleFactor: 1 });
        await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            const days = document.getElementById('daysGrid');
            const today = document.getElementById('todayList');
            return document.body.classList.contains('calendar-capture')
                && days?.getAttribute('aria-busy') === 'false'
                && today?.getAttribute('aria-busy') === 'false'
                && days.querySelector('.cal-day-cell');
        }, { timeout: 10000 });
        await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {
            console.warn('⚠️ 웹폰트 대기 시간이 지나 시스템 글꼴로 캡처합니다.');
        });
        await page.waitForFunction(() => [...document.images].every(img => img.complete)).catch(() => {
            console.warn('⚠️ 외부 이미지 대기 시간이 지나 로드된 자원만 캡처합니다.');
        });

        const target = await page.$('.cal-main-layout');
        if (!target) throw new Error('.cal-main-layout 요소를 찾을 수 없습니다.');

        const outPath = path.resolve(__dirname, 'docs/data/calendar.png');
        const tmpPath = outPath + '.tmp';
        await target.screenshot({ path: tmpPath });
        fs.renameSync(tmpPath, outPath);
        console.log('✅ docs/data/calendar.png 캡처 완료 (공개 일정 페이지 기준)');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
})().catch(err => { console.error(err); process.exit(1); });
