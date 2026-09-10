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
// 캘린더 그리드 자체의 순수 콘텐츠 폭은 7일 × 110px = 770px + 카드 패딩(32px) +
// 테두리(2px) = 804px로 고정이다(style.css의 .cal-weekdays/.cal-days-grid 참고).
// 캡처 결과물은 그보다 여유를 둔 888px로 뽑는다 - admin.html/style.css 전역에서
// 반응형 전환 기준점으로도 쓰는 값과 맞춰, 캘린더(804px) 좌우로 살짝 여백이
// 남도록 한다(캘린더 자체가 888px로 늘어나 보이는 게 아니라, 그만큼 넓은
// 배경 위에 804px 캘린더가 놓이는 그림이 된다).
const CAPTURE_WIDTH = 888;

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
            // .admin-main은 style.css상 flex:0 1 804px라 기본적으로 안 커지지만,
            // 혹시 모를 상황(스타일 로딩 순서 등)에 대비해 여기서도 폭을 못박아
            // 이중으로 안전장치를 둔다.
            if (mainEl) {
                mainEl.style.flex = `0 0 ${w}px`;
                mainEl.style.width = w + 'px';
            }
            if (sideEl) sideEl.style.display = 'none';
            // cal-calendar-area 클래스 자체도 style.css상 flex:0 1 804px라서, 혹시
            // admin-main 고정만으로 충분하지 않은 경우를 대비해 이 요소 자체의
            // flex도 함께 못박아 이중으로 안전장치를 둔다.
            captureEl.style.flex = `0 0 ${w}px`;
            captureEl.style.width = w + 'px';
            captureEl.style.maxWidth = 'none';
            captureEl.style.padding = '16px';
            // border-box여야 위에서 지정한 width(w)가 padding까지 포함한 "최종
            // 캡처 폭"이 된다. content-box로 두면 width(804px) + 양쪽 padding(16px×2)
            // = 836px가 실제로 렌더링되는 폭이 돼서, 캡처 이미지가 의도한 804px보다
            // 계속 더 넓게 나오는 원인이 된다.
            captureEl.style.boxSizing = 'border-box';
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
