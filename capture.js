/**
 * docs/admin.html을 헤드리스 브라우저로 열어서 왼쪽 열(#captureArea: "오늘의 일정" 위,
 * "이달의 일정" 아래)을 docs/data/calendar.png 한 장으로 캡처해 저장한다.
 *
 * 매일 자동 실행되는 이유: "오늘" 표시, 요일 배치, 오늘의 일정 목록 등은
 * 날짜가 바뀌면 데이터가 그대로여도 이미지가 달라져야 하므로, 관리자가
 * "저장"을 안 눌러도 최소 하루에 한 번은 최신 상태로 갱신돼야 한다.
 *
 * admin.html의 init()은 sessionStorage에 GitHub 토큰이 있으면 자동으로
 * loadDataFromGithub()를 호출해서 최신 일정을 불러와 렌더링하므로, 페이지가
 * 로드되기 전에(evaluateOnNewDocument) 토큰만 미리 넣어두면 된다.
 * (admin.html이 보안상 토큰 보관 위치를 localStorage → sessionStorage로 바꿨으므로 여기도 맞춘다.
 *  헤드리스 브라우저는 매번 새 프로필이라 어느 쪽이든 실행이 끝나면 사라진다.)
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
// 예전엔 여백을 더 주려고 888px로 강제로 넓혀봤는데, 부모 요소 폭 불일치로
// 계속 이상하게 늘어나는 문제가 반복돼서, 아예 style.css에 .cal-calendar-area의
// max-width를 804px !important로 못박아뒀다 - 그래서 여기서 폭을 얼마로
// 지정하든 804px보다 커질 수 없다. 그러면 그냥 804로 맞춰서 혼란을 없앤다.
// "오늘의 일정" 카드도 이 폭에 맞춰 같이 눕혀 붙이므로 동일한 값을 그대로 쓴다.
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
    // 토큰은 "있으면 더 최신"을 위한 것이지 필수가 아니다. 넣어주면 admin.html이 GitHub API로
    // 최신 calendar.json을 읽고, 없으면 저장소에 들어있는 docs/data/calendar.json을 그대로 쓴다.
    const token = process.env.GH_TOKEN || '';
    if (!token) {
        console.log('ℹ️ GH_TOKEN이 없어 저장소에 있는 일정(docs/data/calendar.json)으로 캡처합니다.');
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
        // "오늘의 일정"까지 위에 얹으면서 전체 높이가 늘어나 뷰포트(기존 1000px)를
        // 넘길 수 있다. 넘치면 Puppeteer가 대상 요소를 보이게 하려고 스크롤을
        // 내리는데, admin.html 상단바(.top-navbar)가 position:sticky라 스크롤
        // 위치와 무관하게 화면 맨 위에 계속 떠 있으면서 캡처 영역 위쪽을 덮어버려
        // "오늘의 일정" 대신 상단바가 찍히는 문제가 있었다. 뷰포트를 넉넉히
        // 키워서 스크롤 자체가 필요 없게 만든다.
        await page.setViewport({ width: Math.round(CAPTURE_WIDTH) + 300, height: 1600 });

        if (token) {
            await page.evaluateOnNewDocument((t) => {
                sessionStorage.setItem('gh_token', t);
            }, token);
        }

        await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle0' });

        // admin.html은 이제 기본 활성 탭이 '홈'이라 '일정' 탭(#captureMonth가 있는 곳)은
        // display:none 상태로 시작한다. 그대로 두면 캡처 대상이 화면에 없는 걸로 처리돼
        // Puppeteer가 "Node is either not visible" 에러를 낸다. switchPage()로 강제로
        // '일정' 탭을 활성화해서 렌더링되게 한다.
        await page.evaluate(() => switchPage('schedule'));

        // admin.html의 init()이 GitHub에서 일정 데이터를 불러와 렌더링을 끝낼 시간을 준다.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // admin.html의 왼쪽 열(#captureArea)에 "오늘의 일정"이 위, "이달의 일정"이 아래로 이미 붙어 있다.
        // 오른쪽 열(선택한 날짜/편집 폼, 어드민 전용)과 상단바만 숨기고 왼쪽 열 폭을 캘린더 폭에 맞춰 통째로 찍는다.
        // (예전엔 오늘의 일정이 오른쪽 사이드바에 있어서 여기서 옮겨 붙이는 감싸기 요소를 만들었다)
        await page.evaluate((w) => {
            document.querySelectorAll('.admin-side, .top-navbar').forEach(el => { el.style.display = 'none'; });
            const area = document.getElementById('captureArea');
            Object.assign(area.style, { flex: `0 0 ${w}px`, width: w + 'px', maxWidth: 'none', background: '#f4f7fc', boxSizing: 'border-box' });
            area.querySelectorAll('.cal-calendar-inner').forEach(el => {
                el.scrollLeft = 0;
                el.style.overflowX = 'visible';
            });
        }, CAPTURE_WIDTH);

        await new Promise((resolve) => setTimeout(resolve, 300));

        // 스크롤 위치가 0이 아니면 sticky/fixed 요소와 elementHandle.screenshot()의
        // 클리핑 좌표 계산이 어긋날 여지가 있으므로, 안전하게 맨 위로 고정해둔다.
        await page.evaluate(() => window.scrollTo(0, 0));

        const target = await page.$('#captureArea');
        if (!target) throw new Error('#captureArea 요소를 찾을 수 없습니다.');

        // 임시 파일에 찍고 마지막에 바꿔치기한다. 바로 덮어쓰면 캡처 도중 중단됐을 때
        // 반쯤 쓰인 PNG가 남고, 워크플로가 그걸 그대로 커밋해버린다.
        const outPath = path.resolve(__dirname, 'docs/data/calendar.png');
        const tmpPath = outPath + '.tmp';
        await target.screenshot({ path: tmpPath });
        require('fs').renameSync(tmpPath, outPath);
        console.log('✅ docs/data/calendar.png 캡처 완료 (오늘의 일정 + 이달의 일정 통합)');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
})();
