/**
 * docs/admin.html을 헤드리스 브라우저로 열어서 캘린더 그리드(#captureMonth)를
 * PNG로 캡처해 docs/data/calendar.png에 저장한다.
 *
 * 매일 자동 실행되는 이유: "오늘" 표시, 요일 배치 등은 날짜가 바뀌면 데이터가
 * 그대로여도 이미지가 달라져야 하므로, 관리자가 "저장"을 안 눌러도 최소 하루에
 * 한 번은 최신 상태로 갱신돼야 한다.
 *
 * admin.html의 init()은 localStorage에 GitHub 토큰이 있으면 자동으로
 * loadDataFromGithub()를 호출해서 최신 일정을 불러와 렌더링하므로, 페이지가
 * 로드되기 전에(evaluateOnNewDocument) 토큰만 미리 넣어두면 된다.
 *
 * file:// 프로토콜에서는 브라우저가 fetch 자체를 막아서(holidays.json 등을 못
 * 불러옴) admin.html이 정상 렌더링되지 않으므로, 로컬 HTTP 서버를 잠깐 띄워서
 * 그 위에서 연다.
 */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8791;
// 캘린더 캡처 폭은 더 이상 하드코딩하지 않는다. 실제 공개 사이트에서 캘린더가
// "오늘의 일정" 사이드바(.cal-sidebar)와 나란히 배치된 상태 그대로의 폭을
// 렌더링 시점에 직접 측정해서 쓴다(아래 captureWidth 측정 부분 참고).
// 이 뷰포트 폭은 그 "나란히" 배치가 최대로 펼쳐지는 지점을 재현하기 위한 값이다:
// .container가 max-width:1320px에 도달하고 @media(min-width:1200px)로
// 패딩이 40px이 되는 데스크톱 최대 레이아웃 상태가 되도록 충분히 크게 잡는다.
const MEASURE_VIEWPORT_WIDTH = 1600;

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
    const token = process.env.GH_TOKEN;
    if (!token) {
        console.error('❌ GH_TOKEN 환경변수가 설정되지 않았습니다.');
        process.exit(1);
    }

    const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', path.resolve(__dirname, 'docs')]);
    server.stderr.on('data', () => {}); // http.server가 매 요청마다 로그를 찍는 걸 콘솔에서 숨김

    let browser;
    try {
        await waitForServer(`http://localhost:${PORT}/admin.html`, 10000);

        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: MEASURE_VIEWPORT_WIDTH, height: 1000 });

        await page.evaluateOnNewDocument((t) => {
            localStorage.setItem('gh_token', t);
        }, token);

        await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle0' });

        // admin.html은 이제 기본 활성 탭이 '홈'이라 '일정' 탭(#captureMonth가 있는 곳)은
        // display:none 상태로 시작한다. 그대로 두면 캡처 대상이 화면에 없는 걸로 처리돼
        // Puppeteer가 "Node is either not visible" 에러를 낸다. switchPage()로 강제로
        // '일정' 탭을 활성화해서 렌더링되게 한다.
        await page.evaluate(() => switchPage('schedule'));

        // admin.html의 init()이 GitHub에서 일정 데이터를 불러와 렌더링을 끝낼 시간을 준다.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // "오늘의 일정" 사이드바(.cal-sidebar)가 아직 그대로 보이는, 즉 실제 공개
        // 사이트와 동일하게 나란히 배치된 상태에서 캘린더(#captureMonth)의 실제
        // 렌더링 폭을 측정한다. 위에서 뷰포트를 충분히 넓게 잡아뒀으므로 이 값이
        // 곧 "최대 넓이일 때 나란히 있는 폭"이 된다.
        const captureWidth = await page.evaluate(() => {
            const el = document.getElementById('captureMonth');
            return el ? el.getBoundingClientRect().width : null;
        });
        if (!captureWidth) throw new Error('#captureMonth 요소를 찾을 수 없어 폭을 측정하지 못했습니다.');
        console.log(`📏 측정된 캘린더 폭(사이드바와 나란히 있을 때): ${captureWidth}px`);

        // "저장" 버튼을 눌렀을 때와 동일한 방식으로, 캡처 대상을 강제로 넓히고
        // 옆의 사이드바를 잠깐 숨긴다 (겹침으로 인한 잘림 방지). 캡처 이미지
        // 테두리에 살짝 여백을 주기 위해 padding도 함께 추가한다.
        await page.evaluate((w) => {
            const captureEl = document.getElementById('captureMonth');
            const sideEl = document.querySelector('.admin-side');
            if (sideEl) sideEl.style.display = 'none';
            captureEl.style.width = w + 'px';
            captureEl.style.maxWidth = 'none';
            captureEl.style.padding = '16px';
            captureEl.style.boxSizing = 'content-box';
            captureEl.style.background = '#f4f7fc';
            captureEl.querySelectorAll('.cal-calendar-inner').forEach(el => {
                el.scrollLeft = 0;
                el.style.overflowX = 'visible';
            });
        }, captureWidth);

        await new Promise((resolve) => setTimeout(resolve, 300));

        const target = await page.$('#captureMonth');
        if (!target) throw new Error('#captureMonth 요소를 찾을 수 없습니다.');

        await target.screenshot({ path: path.resolve(__dirname, 'docs/data/calendar.png') });
        console.log('✅ docs/data/calendar.png 캡처 완료');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
})();
