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
    const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', path.resolve(__dirname, 'docs')]);
    server.stderr.on('data', () => {});

    let browser;
    try {
        await waitForServer(`http://localhost:${PORT}/schedule/`, 10000);
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: CAPTURE_WIDTH + 300, height: 1700 });
        await page.goto(`http://localhost:${PORT}/schedule/`, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 1800));

        await page.evaluate((w) => {
            document.querySelectorAll('.top-navbar, .page-header, .cal-selected-card-wrapper').forEach(el => { if (el) el.style.display = 'none'; });
            const layout = document.querySelector('.cal-main-layout');
            const sidebar = document.querySelector('.cal-sidebar');
            const today = document.querySelector('.cal-today-card-wrapper');
            const calendar = document.querySelector('.cal-calendar-area');
            if (!layout || !sidebar || !today || !calendar) throw new Error('일정 캡처 대상 요소를 찾을 수 없습니다.');

            layout.id = 'captureArea';
            Object.assign(layout.style, {
                display: 'block', width: `${w}px`, maxWidth: `${w}px`, minWidth: `${w}px`,
                background: '#f4f7fc', boxSizing: 'border-box', padding: '0', margin: '0'
            });
            Object.assign(sidebar.style, { display: 'block', width: `${w}px`, maxWidth: `${w}px`, margin: '0 0 14px 0' });
            Object.assign(today.style, { width: `${w}px`, maxWidth: `${w}px`, margin: '0 0 14px 0' });
            Object.assign(calendar.style, { width: `${w}px`, maxWidth: `${w}px`, minWidth: `${w}px`, margin: '0' });
            calendar.querySelectorAll('.cal-calendar-inner').forEach(el => {
                el.scrollLeft = 0; el.style.overflowX = 'visible';
            });
            document.body.style.margin = '0';
            window.scrollTo(0, 0);
        }, CAPTURE_WIDTH);

        await new Promise(resolve => setTimeout(resolve, 300));
        const target = await page.$('#captureArea');
        if (!target) throw new Error('#captureArea 요소를 찾을 수 없습니다.');

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
