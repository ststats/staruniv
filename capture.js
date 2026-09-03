const puppeteer = require('puppeteer');

(async () => {
  // 1. 가상 브라우저 실행
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // 2. PC 해상도 고정
  await page.setViewport({ width: 1200, height: 1000 });

  // 3. 본인의 GitHub Pages 주소로 접속 (★이 부분을 본인 주소로 변경하세요)
  const url = 'https://ststats.github.io/staruniv/calendar.html'; 
  await page.goto(url, { waitUntil: 'networkidle2' });

  // 4. 로컬 스토리지에 토큰 주입 후 새로고침 (비공개 일정 데이터를 불러오기 위함)
  const token = process.env.GH_TOKEN;
  if(token) {
    await page.evaluate((t) => { localStorage.setItem('gh_token', t); }, token);
    await page.reload({ waitUntil: 'networkidle2' });
  }

  // 5. 달력과 일정이 화면에 그려질 때까지 2초 대기
  await new Promise(r => setTimeout(r, 2000));

  // 6. 지정된 영역 캡처 후 docs/data/calendar.png 덮어쓰기
  const element = await page.$('#calendarCaptureArea');
  if (element) {
    await element.screenshot({ path: 'docs/data/calendar.png' });
    console.log('✅ 캡처 성공: docs/data/calendar.png 업데이트 완료');
  } else {
    console.error('❌ 캡처 영역을 찾을 수 없습니다.');
    // 여기서 그냥 로그만 남기고 넘어가면, 캡처가 실패해도 워크플로우 자체는
    // "성공"으로 끝나버려서(exit code 0), 그림이 안 바뀐 걸 아무도 눈치 못
    // 챌 수 있다. 명시적으로 실패 처리해서 워크플로우가 빨간불로 뜨게 한다.
    await browser.close();
    process.exit(1);
  }

  await browser.close();
})();