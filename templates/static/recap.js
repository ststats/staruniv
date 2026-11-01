/* 숲리캡: SOOP 시청 통계 페이지(m.sooplive.com/statistics)에서 싣는 코드. 도구 → 숲리캡의 한 줄 코드가 이 파일을 불러온다.
   통계 페이지의 차트 함수(setGraphPart1)를 바꿔 끼우고 데이터를 다시 불러, 닉네임마다 SOOP 검색으로 아이디를 찾은 뒤
   시청 기록을 주소 #recap=에 담아 스타대학 도구 페이지로 넘긴다(page-tools.js recapParse가 읽는다). 서버로는 보내지 않는다. */
(() => {
    if (typeof setGraphPart1 !== 'function' || typeof callWatchAjax !== 'function') {
        alert('SOOP 시청 통계 페이지에서 실행해 주세요');
        return;
    }
    const target = new URL('tools/?view=recap#recap=', document.currentScript.src).href;
    // 통계에는 닉네임만 있어 같은 닉네임의 방송을 검색으로 찾는다(사진·멤버 확인용). 못 찾으면 빈칸
    const findId = async nick => {
        try {
            const res = await fetch(
                'https://sch.sooplive.co.kr/api.php?m=bjSearch&v=3.0&szOrder=score&nListCnt=5&szKeyword=' +
                    encodeURIComponent(nick),
                { credentials: 'include' }
            );
            const hit = (await res.json()).DATA.find(d => d.user_nick === nick);
            return hit ? hit.user_id : '';
        } catch (e) {
            return '';
        }
    };
    setGraphPart1 = async (_el, _type, data) => {
        // '기타'는 여러 방송을 합친 칸이라 찾지 않는다
        const b = await Promise.all(
            data.data_stack.map(async x => [x.bj_nick, x.data, x.bj_nick === '기타' ? '' : await findId(x.bj_nick)])
        );
        location.href = target + encodeURIComponent(JSON.stringify({ v: 1, s: data.date.starttime, b }));
    };
    callWatchAjax(szMethod, szModule);
})();
