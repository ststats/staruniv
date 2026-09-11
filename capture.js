/**
 * docs/admin.html을 헤드리스 브라우저로 열어서 "오늘의 일정" 카드(#captureToday)를
 * 캘린더 그리드(#captureMonth) 바로 위로 옮겨 붙인 뒤, 그 둘을 하나로 묶어
 * docs/data/calendar.png 한 장으로 캡처해 저장한다.
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
        // "오늘의 일정"까지 위에 얹으면서 전체 높이가 늘어나 뷰포트(기존 1000px)를
        // 넘길 수 있다. 넘치면 Puppeteer가 대상 요소를 보이게 하려고 스크롤을
        // 내리는데, admin.html 상단바(.top-navbar)가 position:sticky라 스크롤
        // 위치와 무관하게 화면 맨 위에 계속 떠 있으면서 캡처 영역 위쪽을 덮어버려
        // "오늘의 일정" 대신 상단바가 찍히는 문제가 있었다. 뷰포트를 넉넉히
        // 키워서 스크롤 자체가 필요 없게 만든다.
        await page.setViewport({ width: Math.round(CAPTURE_WIDTH) + 300, height: 1600 });

        await page.evaluateOnNewDocument((t) => {
            sessionStorage.setItem('gh_token', t);
        }, token);

        await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle0' });

        // admin.html은 이제 기본 활성 탭이 '홈'이라 '일정' 탭(#captureMonth가 있는 곳)은
        // display:none 상태로 시작한다. 그대로 두면 캡처 대상이 화면에 없는 걸로 처리돼
        // Puppeteer가 "Node is either not visible" 에러를 낸다. switchPage()로 강제로
        // '일정' 탭을 활성화해서 렌더링되게 한다.
        await page.evaluate(() => switchPage('schedule'));

        // admin.html의 init()이 GitHub에서 일정 데이터를 불러와 렌더링을 끝낼 시간을 준다.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // "오늘의 일정"(#captureToday)을 원래 있던 사이드바(.admin-side)에서 빼내
        // 캘린더 그리드(#captureMonth) 바로 위에 붙이고, 둘을 감싸는 wrapper 하나를
        // 만들어 그 wrapper를 통째로 캡처한다 - 그러면 이미지 한 장 안에 "오늘의
        // 일정"이 위, "이달의 일정"이 아래로 세로로 이어져 찍힌다. 사이드바에 남는
        // 나머지 카드들(선택한 날짜/편집 폼 등, 전부 어드민 전용)은 통째로 숨긴다.
        await page.evaluate((w) => {
            const monthEl = document.getElementById('captureMonth');
            const todayEl = document.getElementById('captureToday');
            const sideEl = document.querySelector('.admin-side');
            const mainEl = document.querySelector('.admin-main');

            if (sideEl) sideEl.style.display = 'none';

            // 뷰포트를 넉넉히 키워도 혹시 모를 스크롤 상황(콘텐츠가 유난히 길어지는
            // 경우 등)에 대비해, sticky 상단바 자체를 캡처 도중엔 아예 숨겨서
            // 겹침 가능성을 원천 차단한다.
            const navEl = document.querySelector('.top-navbar');
            if (navEl) navEl.style.display = 'none';

            const wrapper = document.createElement('div');
            wrapper.id = 'captureCombined';
            wrapper.style.background = '#f4f7fc';
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.gap = '16px';
            wrapper.style.width = w + 'px';
            wrapper.style.boxSizing = 'border-box';

            // wrapper를 캘린더가 있던 자리에 끼워넣은 뒤, 오늘의 일정 → 캘린더
            // 순서로 그 안에 옮겨 담는다 (todayEl이 sideEl 밑에 숨어있던 상태라도
            // appendChild가 문서 트리에서 그대로 꺼내와 옮겨준다).
            monthEl.parentNode.insertBefore(wrapper, monthEl);
            wrapper.appendChild(todayEl);
            wrapper.appendChild(monthEl);

            // .admin-main은 style.css상 flex:0 1 804px라 기본적으로 안 커지지만,
            // 혹시 모를 상황(스타일 로딩 순서 등)에 대비해 여기서도 폭을 못박아
            // 이중으로 안전장치를 둔다.
            if (mainEl) {
                mainEl.style.flex = `0 0 ${w}px`;
                mainEl.style.width = w + 'px';
            }
            // cal-calendar-area 클래스 자체도 style.css상 flex:0 1 804px라서, 혹시
            // admin-main 고정만으로 충분하지 않은 경우를 대비해 이 요소 자체의
            // flex도 함께 못박아 이중으로 안전장치를 둔다.
            monthEl.style.flex = `0 0 ${w}px`;
            monthEl.style.width = w + 'px';
            monthEl.style.maxWidth = 'none';
            // (예전엔 여기에 monthEl.style.padding='16px'를 추가해서 캡처
            // 이미지에 여백을 주려 했는데, border-box라 이 패딩이 안쪽 카드가
            // 쓸 수 있는 공간을 그만큼 깎아먹어서 - 안쪽 .clean-card는 804px가
            // 그대로 필요한데 772px밖에 못 받아 - 매번 계산이 안 맞았다. 안쪽
            // .clean-card 자체에 이미 자기 패딩(p-3, 16px)이 있어서 여백은
            // 이미 충분하므로, 바깥에 패딩을 더 얹지 않는다.)
            monthEl.style.boxSizing = 'border-box';
            monthEl.style.background = '#f4f7fc';
            monthEl.querySelectorAll('.cal-calendar-inner').forEach(el => {
                el.scrollLeft = 0;
                el.style.overflowX = 'visible';
            });
        }, CAPTURE_WIDTH);

        await new Promise((resolve) => setTimeout(resolve, 300));

        // 스크롤 위치가 0이 아니면 sticky/fixed 요소와 elementHandle.screenshot()의
        // 클리핑 좌표 계산이 어긋날 여지가 있으므로, 안전하게 맨 위로 고정해둔다.
        await page.evaluate(() => window.scrollTo(0, 0));

        const target = await page.$('#captureCombined');
        if (!target) throw new Error('#captureCombined 요소를 찾을 수 없습니다.');

        await target.screenshot({ path: path.resolve(__dirname, 'docs/data/calendar.png') });
        console.log('✅ docs/data/calendar.png 캡처 완료 (오늘의 일정 + 이달의 일정 통합)');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
})();
