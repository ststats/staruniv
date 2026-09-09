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
// 실제 admin.html에서 개발자도구로 직접 확인한 값(#captureMonth 902.4px)으로 고정.
const CAPTURE_WIDTH = 902.4;

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
        await page.setViewport({ width: Math.round(CAPTURE_WIDTH) + 300, height: 1000 });

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

        // "저장" 버튼을 눌렀을 때와 동일한 방식으로, 캡처 대상을 강제로 넓히고
        // 옆의 사이드바를 잠깐 숨긴다 (겹침으로 인한 잘림 방지). 캡처 이미지
        // 테두리에 살짝 여백을 주기 위해 padding도 함께 추가한다.
        await page.evaluate((w) => {
            const captureEl = document.getElementById('captureMonth');
            const sideEl = document.querySelector('.admin-side');
            const mainEl = document.querySelector('.admin-main');
            // 진짜 flex-grow 주범은 #captureMonth(cal-calendar-area)가 아니라
            // 그 조상인 .admin-main(flex:1 1 0%)이다. .admin-side("오늘의 일정")를
            // 숨기면 .admin-main이 flex-grow로 빈 공간을 다시 채우며 커지고,
            // 그 안의 cal-main-layout(width:100%) → #captureMonth(width:100%)로
            // 그대로 전파돼 커진다. 그래서 .admin-main 자체를 측정된 폭으로 못박아
            // 더 이상 커지지 않게 해야 한다.
            if (mainEl) {
                mainEl.style.flex = `0 0 ${w}px`;
                mainEl.style.width = w + 'px';
            }
            if (sideEl) sideEl.style.display = 'none';
            // cal-calendar-area 클래스 자체도 style.css상 flex:1 1 0%라서, 혹시
            // admin-main 고정만으로 충분하지 않은 경우를 대비해 이 요소 자체의
            // flex도 함께 못박아 이중으로 안전장치를 둔다.
            captureEl.style.flex = `0 0 ${w}px`;
            captureEl.style.width = w + 'px';
            captureEl.style.maxWidth = 'none';
            captureEl.style.padding = '16px';
            captureEl.style.boxSizing = 'content-box';
            captureEl.style.background = '#f4f7fc';
            captureEl.querySelectorAll('.cal-calendar-inner').forEach(el => {
                el.scrollLeft = 0;
                el.style.overflowX = 'visible';
            });
        }, CAPTURE_WIDTH);

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
