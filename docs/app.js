/**
 * 스타대학 사이트 본편 로직 (index.html 전용).
 *
 * [파일 구성] 위에서부터 의존 순서대로 섹션을 나눴다.
 *   1. 공용 유틸          - 이스케이프, 날짜 파싱, 빈 상태 마크업, rAF 스로틀, 표시/숨김 등
 *   2. 사이트 데이터       - site_data.json 적재(SiteData) + 매치→라운드 조회 인덱스
 *   3. API 캐시            - sessionStorage TTL 캐시 + 동시 요청 합치기
 *   4. 공용 표시 헬퍼      - 아바타/팀 로고/티어·종족·직책 뱃지/멤버 판별
 *   5. 라우터              - URL(/page?params) ↔ 화면 상태
 *   6. 전적(팀/개인)
 *   7. 멤버 현황/프로필
 *   8. 홈(방송 중/최근 공지)
 *   9. 멤버 공지 피드
 *  10. 방송통계(시너지표)
 *  11. 도구(멀티뷰어/외부 도구)
 *  12. 캘린더 훅 + 초기화
 *
 * [전역 이름 규칙] index.html/모달/동적으로 만든 마크업의 인라인 핸들러(onclick="...")와
 * mv-shared.js·calendar.js가 이름으로 부르는 함수는 전부 예전 이름 그대로 전역 함수로 남겼다.
 * 반면 화면 상태 변수(예전 currentPlayer, newsItems, mvOrder 등 20여 개의 전역 let)는
 * 기능별 상태 객체(RecordsState/NewsState/MvState/SynergyState/SiteData)로 묶었다.
 */

// =====================================================================
// 1. 공용 유틸
// =====================================================================

// 구글시트 원본 텍스트를 innerHTML에 꽂을 때 깨지거나 마크업이 섞이지 않도록 이스케이프
// (mv-shared.js가 이 이름을 그대로 호출하므로 이름/동작을 바꾸면 안 된다)
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// JS 문자열 리터럴('...') 안에 값을 꽂을 때 백슬래시/따옴표를 이스케이프한다.
function jsStrEscape(str) {
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// onclick="fn('${값}')"처럼 "HTML 속성 안의 JS 문자열"에 값을 꽂을 때 쓴다.
// 예전엔 jsStrEscape만 거쳐서, 값에 큰따옴표(")가 섞이면 속성 자체가 끊기면서 그 뒤가
// 새 속성(onmouseover=... 등)으로 해석될 수 있었다(XSS). JS 이스케이프 후 HTML 이스케이프를
// 한 번 더 하면 브라우저가 속성값을 디코딩한 결과가 정확히 JS 이스케이프된 문자열이 된다.
// 특수문자가 없는 평범한 이름은 결과가 예전과 완전히 같다.
function jsAttr(str) {
    return escapeHTML(jsStrEscape(str));
}

// SOOP API의 "YYYY-MM-DD HH:MM:SS" 형식을 Date로 바꾼다. 공백을 'T'로 바꾸는 이유:
// 공백 구분 형식은 표준이 아니라 사파리(iOS)에서 Invalid Date가 나와 정렬/상대시간이
// 깨진다. 크롬/파이어폭스에서는 두 형식 모두 로컬 시각으로 해석되므로 결과가 같다.
function parseSoopDate(value) {
    return new Date(String(value || '').replace(' ', 'T'));
}
function soopDateMs(value) {
    return parseSoopDate(value).getTime();
}

// 전적 표의 날짜 칸: "2025-01-02 ..." -> "25-01-02". (숫자 등 문자열이 아닌 값이 와도 죽지 않게 String 처리)
function shortMatchDate(value) {
    return value ? String(value).split(' ')[0].substring(2) : '';
}

// 로딩중/데이터없음 등 안내 문구를 보여주는 <div> (공지, 방송중, 소식 피드 등 공용)
function emptyStateHtml(text, extraClass) {
    return `<div class="text-center text-muted py-4 fs-body${extraClass ? ' ' + extraClass : ''}">${text}</div>`;
}
// 표(tbody) 안에서 쓰는 안내 문구 <tr>
function emptyRowHtml(colspan, text, cellClass) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted ${cellClass || 'py-4'}">${text}</td></tr>`;
}
const EMPTY_MATCH_ROW_HTML = emptyRowHtml(6, '경기 기록이 없습니다.');

// 아래 방향 쉐브론 아이콘(더 보기/이전 멤버/세트 상세 토글 등에서 공용)
function chevronDownSvg(size, extraAttrs) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${extraAttrs || ''}><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}

// 화면 표시/숨김은 인라인 style.display 대신 부트스트랩 d-none 클래스 하나로 통일한다.
function setVisible(el, visible) {
    if (el) el.classList.toggle('d-none', !visible);
}
function isVisible(el) {
    return !!el && !el.classList.contains('d-none');
}

// 정적 HTML에 처음부터 있고 절대 다시 그려지지 않는 요소 목록 전용 캐시.
// (innerHTML로 다시 그려지는 요소에는 쓰면 안 된다 - 옛 노드를 계속 붙잡게 된다)
const _staticQueryCache = new Map();
function staticAll(selector) {
    if (!_staticQueryCache.has(selector)) _staticQueryCache.set(selector, Array.from(document.querySelectorAll(selector)));
    return _staticQueryCache.get(selector);
}

// requestAnimationFrame 스로틀: 프레임당 최대 한 번만 fn을 실행한다(resize/scroll 공용).
function rafThrottle(fn) {
    let scheduled = false;
    return (...args) => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; fn(...args); });
    };
}
// 같은 스로틀을 대상(key)별로 따로 적용한다(여러 사진 갤러리가 각자 스크롤될 때).
function rafThrottleByKey(fn) {
    const scheduled = new WeakSet();
    return (key, ...args) => {
        if (scheduled.has(key)) return;
        scheduled.add(key);
        requestAnimationFrame(() => { scheduled.delete(key); fn(key, ...args); });
    };
}

// 탭 + 뷰 전환 공용: tabs = { 키: [탭 id, 뷰 id] }. 활성 탭 표시/aria-selected/뷰 표시를 함께 맞춘다.
function activateTabView(tabs, activeKey) {
    Object.entries(tabs).forEach(([key, [tabId, viewId]]) => {
        const on = key === activeKey;
        const tab = document.getElementById(tabId);
        if (tab) {
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        setVisible(document.getElementById(viewId), on);
    });
}
function isTabActive(tabId) {
    const tab = document.getElementById(tabId);
    return !!tab && tab.classList.contains('active');
}

// 부트스트랩 모달 열기. new bootstrap.Modal()을 열 때마다 만들면 같은 요소에 인스턴스와
// 이벤트 리스너가 계속 쌓이므로(누수) 기존 인스턴스를 재사용한다.
function showModal(id) {
    const el = document.getElementById(id);
    if (el) bootstrap.Modal.getOrCreateInstance(el).show();
}

// 초기화 단계 하나가 실패해도(스크립트 로드 실패, 예상 못한 데이터 형태 등) 그 아래
// 단계들까지 통째로 멈추지 않도록 각 단계를 격리한다. async 함수가 넘어오면 반환된
// Promise의 실패까지 잡아서 "Uncaught (in promise)"로 새지 않게 한다.
function safeInit(label, fn) {
    const report = e => console.error(`${label} 초기화 중 오류가 발생했습니다:`, e);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') result.catch(report);
    } catch (e) {
        report(e);
    }
}

// role="button"/"tab"을 단 div/tr 등(네이티브 버튼이 아닌 클릭 요소)도 키보드
// Enter/Space로 누를 수 있게 한다. 마우스 클릭 동작에는 영향이 없다.
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!el || !el.matches || !el.matches('[role="button"], [role="tab"]')) return;
    if (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    e.preventDefault();
    el.click();
});

// =====================================================================
// 2. 사이트 데이터 (site_data.json)
// =====================================================================
// 멤버/매치/라운드/개인통계는 경기가 쌓일수록 계속 커지는 데이터라, HTML에 직접
// 박아넣지 않고 별도 JSON(data/site_data.json)에서 비동기로 fetch해온다.
const SiteData = {
    members: [],
    matches: [],
    rounds: [],
    playersStats: [],
};
const asArray = v => (Array.isArray(v) ? v : []);

async function loadSiteData() {
    try {
        const res = await fetch('data/site_data.json', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            SiteData.members = asArray(data && data.members);
            SiteData.matches = asArray(data && data.matches);
            SiteData.rounds = asArray(data && data.rounds);
            SiteData.playersStats = asArray(data && data.playersStats);
        }
    } catch (e) {
        console.error('사이트 데이터를 불러오지 못했습니다:', e);
    }
}

function findMemberByName(name) {
    return SiteData.members.find(x => x['이름'] === name);
}
function findMemberBySoopId(soopId) {
    return SiteData.members.find(x => x['SOOP ID'] === soopId);
}
function findPlayerStats(name) {
    return SiteData.playersStats.find(x => x['이름'] === name) || {};
}

// 팀 매치 → 세트(라운드) 목록 조회 인덱스.
// 예전엔 매치 한 줄을 그릴 때마다 전체 라운드를 filter해서 O(매치 수 × 라운드 수)였다.
// 라운드를 한 번만 훑어 (날짜, 상대팀) 묶음으로 나눠두고, 매치마다 그 묶음 안에서만
// 예전과 똑같은 조건으로 거른다. 원래 순서도 그대로 유지된다.
//   - 내전 미러 라운드(_mirrored)는 개인 통계 전용이라 세트 상세에서는 뺀다(match_link.py 참고).
//   - _match_key가 매치/라운드 양쪽에 있으면 그걸로 정확히 매칭하고(같은 날 여러 경기 구분),
//     어느 한쪽이라도 없을 때만 날짜+상대팀으로 대체한다.
//   - _match_key는 "날짜__상대팀__순번" 형태라 같은 키는 항상 같은 (날짜, 상대팀) 묶음 안에 있다.
let _roundIndex = { source: null, byDateTeam: new Map() };
// (===와 똑같이 구분되도록: 숫자 2024와 문자열 "2024", undefined와 null을 서로 다른 키로 만든다)
const _keyPart = v => (v === undefined ? 'u' : 'v' + JSON.stringify(v));
const dateTeamKey = (date, team) => _keyPart(date) + '|' + _keyPart(team);

function roundsForMatch(m) {
    if (_roundIndex.source !== SiteData.rounds) {
        const byDateTeam = new Map();
        SiteData.rounds.forEach(r => {
            if (r['_mirrored']) return;
            const key = dateTeamKey(r['날짜'], r['상대팀']);
            if (!byDateTeam.has(key)) byDateTeam.set(key, []);
            byDateTeam.get(key).push(r);
        });
        _roundIndex = { source: SiteData.rounds, byDateTeam };
    }
    const group = _roundIndex.byDateTeam.get(dateTeamKey(m['날짜'], m['상대팀'])) || [];
    if (!m['_match_key']) return group;
    return group.filter(r => !r['_match_key'] || r['_match_key'] === m['_match_key']);
}

// =====================================================================
// 3. API 캐시 (SOOP 게시판/방송 상태 등)
// =====================================================================
// 홈/소식 화면 열 때마다 멤버 30명씩 SOOP API를 다시 호출하면 사용자가 몰릴 때
// 브라우저 쪽에서 API 호출 빈도 제한(Rate Limit)에 걸릴 수 있어, 세션 안에서는
// 짧은 시간 내 같은 요청을 재사용하도록 sessionStorage에 캐싱해둔다.
// [보강] ① 만료된 항목은 읽을 때 지운다(예전엔 세션 내내 쌓이기만 했다).
//        ② 저장 공간이 꽉 차면 캐시 항목을 비우고 한 번 더 시도한다.
//        ③ 같은 URL 요청이 이미 진행 중이면 새로 부르지 않고 그 결과를 같이 기다린다
//           (페이지 로드 직후 홈 "방송 중"과 멀티뷰어 LIVE 뱃지가 멤버 전원의 방송 상태를
//           동시에 조회해서 요청이 두 배로 나가던 문제).
const API_CACHE_PREFIX = 'apicache:';
const _inflightRequests = new Map();

function readApiCache(url, ttlMs) {
    const cacheKey = API_CACHE_PREFIX + url;
    try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return undefined;
        const entry = JSON.parse(raw);
        if (entry && typeof entry.ts === 'number' && Date.now() - entry.ts < ttlMs) return entry.data;
        sessionStorage.removeItem(cacheKey);
    } catch (e) { /* 캐시 읽기 실패는 무시하고 그냥 새로 받아온다 */ }
    return undefined;
}

function purgeApiCache() {
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(API_CACHE_PREFIX)) sessionStorage.removeItem(key);
        }
    } catch (e) { /* 무시 */ }
}

function writeApiCache(url, data) {
    const payload = JSON.stringify({ data, ts: Date.now() });
    try {
        sessionStorage.setItem(API_CACHE_PREFIX + url, payload);
    } catch (e) {
        // 저장 공간이 꽉 찼으면 오래된 캐시를 비우고 한 번만 재시도. 캐싱은 선택사항이라 실패해도 무시.
        purgeApiCache();
        try { sessionStorage.setItem(API_CACHE_PREFIX + url, payload); } catch (e2) { /* 무시 */ }
    }
}

async function cachedFetchJson(url, ttlMs) {
    const cached = readApiCache(url, ttlMs);
    if (cached !== undefined) return cached;
    if (_inflightRequests.has(url)) return _inflightRequests.get(url);

    const request = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('요청 실패: ' + res.status);
        const data = await res.json();
        writeApiCache(url, data);
        return data;
    })();
    _inflightRequests.set(url, request);
    try {
        return await request;
    } finally {
        _inflightRequests.delete(url);
    }
}

// =====================================================================
// 4. 공용 표시 헬퍼
// =====================================================================

// 승/패/무 결과 뱃지 HTML - 팀/개인 최근전적 리스트 공용
function resultBadgeHtml(resText) {
    if (resText === '승') return '<span class="match-badge badge-win">WIN</span>';
    if (resText === '무' || resText === '무승부') return '<span class="match-badge badge-draw">DRAW</span>';
    return '<span class="match-badge badge-lose">LOSE</span>';
}

const SOOP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
function isValidSoopId(soopId) {
    return !!soopId && SOOP_ID_PATTERN.test(String(soopId).trim());
}

function getProfileImgUrl(soopId) {
    if (!soopId) return null;
    const id = String(soopId).trim().toLowerCase();
    // SOOP 아이디는 영문/숫자/일부 특수문자만 쓰이므로, 형식이 이상한 값은 URL/속성에 꽂지 않고 무시
    if (!id || !/^[a-z0-9_-]+$/.test(id)) return null;
    const prefix = id.substring(0, 2);
    return `https://profile.img.sooplive.co.kr/LOGO/${prefix}/${id}/${id}.jpg`;
}
function avatarHtml(soopId, cls) {
    const url = getProfileImgUrl(soopId);
    if (!url) return `<span class="${cls} d-flex align-items-center justify-content-center">👤</span>`;
    return `<img src="${url}" class="${cls}" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'${cls} d-flex align-items-center justify-content-center\\'>👤</span>';">`;
}
// 프로필 카드(개인전적 상단/멤버 프로필 모달)의 큰 원형 아바타 내용
function profileAvatarInnerHtml(soopId) {
    const url = getProfileImgUrl(soopId);
    return url ? `<img src="${url}" alt="" onerror="this.parentElement.innerHTML='👤';">` : '👤';
}

// 상대팀 로고: docs/images/{팀이름}.webp 로 관리. '내전'(자체 스크림)은 상대가 우리 팀
// 자신이므로 캄몬스타즈.webp를 대신 쓴다(build_html.py의 team_logo_src 필터와 같은 규칙).
// 로고 파일이 없는 팀은 원형 배지에 팀 이름 첫 글자를 넣어 대신 보여준다.
function teamLogoFallback(imgEl, teamName) {
    const initial = String(teamName || '').trim().charAt(0) || '?';
    const span = document.createElement('span');
    span.className = 'team-logo-fallback';
    const w = imgEl.style.width, h = imgEl.style.height;
    if (w) span.style.width = w;
    if (h) span.style.height = h;
    const sizeNum = parseInt(w, 10);
    if (sizeNum) span.style.fontSize = Math.max(8, Math.round(sizeNum * 0.5)) + 'px';
    span.textContent = initial;
    imgEl.replaceWith(span);
}
function teamLogoHtml(teamName, sizePx) {
    const name = String(teamName || '').trim();
    if (!name) return '';
    const fileName = (name === '내전') ? '캄몬스타즈' : name;
    const size = sizePx || 16;
    // 팀 이름을 onerror 안의 JS 문자열로 직접 꽂지 않고 data 속성으로 넘긴다(이스케이프 문제 원천 차단).
    // 크기는 대체 배지(teamLogoFallback)가 그대로 물려받아야 해서 인라인으로 둔다.
    return `<img src="images/${encodeURIComponent(fileName)}.webp" alt="" class="team-logo-icon" loading="lazy" style="width:${size}px;height:${size}px;" data-team="${escapeHTML(name)}" onerror="teamLogoFallback(this, this.dataset.team)">`;
}
// 로고 + 팀 이름(말줄임) 묶음 - 팀/개인 전적 표 공용
function teamCellInnerHtml(teamName) {
    return `<span class="d-flex align-items-center justify-content-center gap-2">${teamLogoHtml(teamName)}<span class="ellipsis-text">${escapeHTML(teamName)}</span></span>`;
}

const TIER_ORDER = ['갓','킹','잭','조커','스페이드','0','1','2','3','4','5','6','7','8','베이비'];
function tierIndex(tier) {
    const idx = TIER_ORDER.indexOf(String(tier));
    return idx === -1 ? TIER_ORDER.length : idx;
}
function raceShortLabel(race) {
    if (!race) return '-';
    if (race.includes('테란')) return 'T';
    if (race.includes('저그')) return 'Z';
    if (race.includes('프로토스')) return 'P';
    return race;
}
// 종족 뱃지 클래스(T/Z/P별 색상)
function raceBadgeClass(race) {
    const letter = raceShortLabel(race);
    return ['T', 'Z', 'P'].includes(letter) ? ` race-badge race-${letter}` : '';
}
function raceBadgeHtml(race) {
    return `<span class="tag-badge${raceBadgeClass(race)}">${escapeHTML(raceShortLabel(race))}</span>`;
}
// 티어 표기(예: "3티어")를 멤버 카드/모달/개인전적 프로필에서 동일하게 사용
function tierLabel(tier) {
    return (tier !== undefined && tier !== null && tier !== '') ? `${tier}티어` : '티어 미정';
}
function tierBadgeHtml(tier) {
    return `<span class="tag-badge tier-badge">${escapeHTML(tierLabel(tier))}</span>`;
}
// 뱃지 요소 하나에 텍스트/클래스를 채운다(개인전적 프로필, 멤버 프로필 모달 공용)
function applyBadge(el, text, className) {
    if (!el) return;
    el.textContent = text;
    el.className = className;
}
// 직책 뱃지 색상: 자주 쓰는 직책은 고정 색상, 그 외(전력분석관 등 임의의 직책)는
// 단일 그레이 톤으로 통일 - 종족 뱃지 색과 겹치지 않도록 선수는 진한 네이비를 사용
const ROLE_COLOR_FIXED = {
    '감독': '#c62828',
    '코치': '#2e7d32',
    '선수': '#0d47a1',
};
const ROLE_COLOR_FALLBACK = '#78909c';
function roleColor(role) {
    if (!role) return '#9e9e9e';
    return ROLE_COLOR_FIXED[role] || ROLE_COLOR_FALLBACK;
}
function isActiveMember(m) {
    return !m['퇴단일'] || String(m['퇴단일']).trim() === '';
}
// 방송중 체크/소식 피드 등 SOOP API를 부르는 화면들이 공통으로 쓰는 대상:
// 활동중이면서 SOOP ID 형식이 유효한 멤버만 추려낸다.
function activeMembersWithSoopId() {
    return SiteData.members.filter(m => isActiveMember(m) && isValidSoopId(m['SOOP ID']));
}
// 오늘 날짜(YYYY-MM-DD). 예전엔 toISOString()(UTC 기준)이라 한국 시간 0~9시에는 어제
// 날짜가 나와 "활동 N일째"가 하루 적게 보였다 - 캘린더와 같은 로컬 날짜 기준으로 통일.
function todayStr() {
    return calTodayStr();
}
function daysBetween(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.floor((end - start) / 86400000) + 1;
}

// 아바타 선택 바(개인 전적/멤버 공지 상단)의 항목 한 칸 - 두 화면이 같은 마크업을 쓴다.
function avatarSelectItemHtml(idPrefix, name, soopId, onclickFn) {
    return `<div class="avatar-select-item" id="${idPrefix}${escapeHTML(name)}" role="button" tabindex="0" onclick="${onclickFn}('${jsAttr(name)}')">
                            ${avatarHtml(soopId, 'avatar-select-img')}
                            <span class="avatar-select-name">${escapeHTML(name)}</span>
                        </div>`;
}
// 아바타 선택 바 맨 앞의 "전체" 항목
function avatarSelectAllItemHtml(id, onclickJs) {
    return `<div class="avatar-select-item avatar-select-all active" id="${id}" role="button" tabindex="0" onclick="${onclickJs}">
                            <img src="images/캄몬스타즈.webp" alt="전체" class="avatar-select-img" onerror="this.outerHTML='&lt;div class=&quot;avatar-select-fallback&quot;&gt;전체&lt;/div&gt;';">
                            <span class="avatar-select-name">전체</span>
                       </div>`;
}
// 아바타 선택 바에서 하나만 활성 표시
function setActiveAvatarItem(listId, activeEl) {
    document.querySelectorAll(`#${listId} .avatar-select-item`).forEach(el => el.classList.remove('active'));
    if (activeEl) activeEl.classList.add('active');
}

// =====================================================================
// 5. 라우터: /페이지?파라미터=값 형태로 하위 상태까지 URL에 반영
// =====================================================================
const VALID_PAGE_IDS = ['home', 'schedule', 'members', 'records', 'stats', 'tools'];

// restoreFromHash가 화면을 되살리는 동안에는 하위 함수들이 URL을 다시 "새 기록"으로
// 쌓지(pushState) 않고 현재 기록을 고쳐 쓰기(replaceState)만 하게 한다.
// 예전엔 뒤로가기(popstate) 처리 도중 pushState가 불려서 앞으로가기 기록이 통째로
// 지워지거나, 딥링크로 들어오면 기록이 2~3개씩 쌓이는 문제가 있었다.
const Router = { restoring: false };

function parseHash() {
    // 실제 경로(/page?params)를 표준 URL 형태로 쓴다. GitHub Pages에서도
    // 동작하도록 docs/404.html + index.html 부트스트랩 스크립트로 경로를 복원한다
    // (rafgraph/spa-github-pages 패턴).
    // Vercel처럼 루트(/records)에 배포되든, GitHub Pages 프로젝트 페이지처럼
    // 서브경로(/staruniv/records)에 배포되든 둘 다 지원해야 하므로, pathname을
    // 세그먼트로 쪼개서 VALID_PAGE_IDS와 실제로 일치하는 세그먼트를 찾는다.
    const segments = location.pathname.split('/').filter(Boolean);
    const pageSeg = segments.find(s => VALID_PAGE_IDS.includes(s));
    return { page: pageSeg || 'home', params: new URLSearchParams(location.search) };
}

function getBasePath() {
    // 현재 URL에서 "알려진 페이지 이름" 세그먼트 앞부분(GitHub Pages라면 저장소 이름 등)을
    // 그대로 유지하기 위해 계산한다. Vercel 루트 배포라면 빈 문자열이 나온다.
    const segments = location.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex(s => VALID_PAGE_IDS.includes(s));
    const baseSegments = idx === -1 ? segments : segments.slice(0, idx);
    return baseSegments.length ? '/' + baseSegments.join('/') : '';
}

function buildHash(page, params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const qsStr = qs.toString();
    const base = getBasePath();
    const path = page === 'home' ? (base ? base + '/' : '/') : base + '/' + page;
    return path + (qsStr ? '?' + qsStr : '');
}

function updateHash(page, params) {
    const newUrl = buildHash(page, params);
    if (location.pathname + location.search === newUrl) return;
    if (Router.restoring) history.replaceState({ page, params }, '', newUrl);
    else history.pushState({ page, params }, '', newUrl);
}

function switchPage(pageId, skipHashUpdate) {
    const section = document.getElementById('page-' + pageId);
    if (!section) return; // 알 수 없는 페이지 id - 예전엔 여기서 TypeError로 죽었다

    staticAll('.page-section').forEach(el => el.classList.remove('active'));
    staticAll('#mainMenu .nav-item').forEach(el => {
        const on = el.dataset.page === pageId;
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    section.classList.add('active');

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    if (!skipHashUpdate) {
        resetPageSubState(pageId);
        updateHash(pageId, {});
    }
}

// 상단 메뉴로 직접 이동할 때는 이전에 보고 있던 하위 상태(선택 탭, 선택된 멤버 등)를
// 그대로 남겨두지 않고 각 페이지의 기본 화면으로 되돌린다.
function resetPageSubState(pageId) {
    if (pageId === 'records') {
        RecordsState.player = '';
        RecordsState.indivFilter = '전체';
        syncIndivFilterUI(); // 예전엔 값만 '전체'로 돌리고 필터 칩 표시는 옛 값에 남아 있었다
        switchStatView('team');
    } else if (pageId === 'members') {
        NewsState.player = null;
        switchMemberView('status');
    } else if (pageId === 'stats') {
        setSynergyMetric('balloons');
    } else if (pageId === 'tools') {
        switchToolsView('multiviewer');
    }
}

// 뒤로가기/앞으로가기 및 새로고침 시 URL에 맞춰 페이지 + 하위 상태를 복원
function restoreFromHash() {
    const { page, params } = parseHash();
    const pageId = VALID_PAGE_IDS.includes(page) ? page : 'home';
    Router.restoring = true;
    try {
        switchPage(pageId, true);
        if (pageId === 'records') {
            const view = params.get('view') === 'solo' ? 'individual' : 'team';
            switchStatView(view);
            const member = params.get('member');
            if (view === 'individual' && member) selectPlayer(member);
        } else if (pageId === 'members') {
            const view = params.get('view') === 'news' ? 'news' : 'status';
            switchMemberView(view);
            const member = params.get('member');
            if (view === 'news' && member) selectNewsPlayer(member);
        } else if (pageId === 'stats') {
            setSynergyMetric(synergyMetricFromUrl(params.get('view')));
        } else if (pageId === 'tools') {
            const view = params.get('view') === 'external' ? 'external' : 'multiviewer';
            switchToolsView(view, true);
        }
    } finally {
        Router.restoring = false;
    }
}

window.addEventListener('popstate', restoreFromHash);

// =====================================================================
// 6. 전적 (팀 / 개인)
// =====================================================================
const RecordsState = {
    player: '',          // 개인 전적에서 선택된 멤버 이름('' = 전체 요약)
    indivFilter: '전체', // 개인 최근 전적 형식 필터
};
const RECORD_TABS = { team: ['tab-team', 'view-team-stat'], individual: ['tab-individual', 'view-indiv-stat'] };
const FORMAT_KEYS = ['대회', '대학', '미니', 'CK'];

function updateStatsHash() {
    const params = {};
    if (isTabActive('tab-individual')) {
        params.view = 'solo';
        if (RecordsState.player) params.member = RecordsState.player;
    }
    updateHash('records', params);
}

function switchStatView(viewType) {
    activateTabView(RECORD_TABS, viewType);
    if (viewType === 'individual') {
        renderIndividualSidebar();
        showIndivSummary();
    }
    updateStatsHash();
}

function parseStat(statStr) {
    if (!statStr || statStr === "-") return { wins: 0, losses: 0, rate: 0, text: "-" };
    const match = String(statStr).match(/(\d+)승 (\d+)패/);
    if (match) {
        const w = parseInt(match[1], 10), l = parseInt(match[2], 10);
        return { wins: w, losses: l, rate: (w+l) > 0 ? (w/(w+l)*100) : 0, text: `${w}승 ${l}패` };
    }
    return { wins: 0, losses: 0, rate: 0, text: "-" };
}
function getRateText(w, l) { return (w+l) > 0 ? (w/(w+l)*100).toFixed(1) + "%" : "-"; }
// 50% 기준으로 승(파랑)/패(빨강) 색을 정한다.
const rateColor = rate => (rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)');
const donutBackground = (color, rate) => `conic-gradient(${color} ${rate}%, var(--color-donut-track) 0)`;

function updateDonut(elId, txtId, subId, stat, color) {
    const txtEl = document.getElementById(txtId);
    txtEl.innerText = stat.text === "-" ? "-" : stat.rate.toFixed(1) + "%";
    document.getElementById(subId).innerText = stat.text;
    // color === 'byRate'면 50% 기준으로 승(파랑)/패(빨강) 색을 자동으로 정한다.
    const ringColor = color === 'byRate' ? rateColor(stat.rate) : color;
    document.getElementById(elId).style.background = donutBackground(ringColor, stat.rate);
    if (color === 'byRate') txtEl.style.color = ringColor;
}

function calculateTeamSummaries() {
    const tStats = {};
    FORMAT_KEYS.forEach(fmt => { tStats[fmt] = { w: 0, l: 0 }; });
    SiteData.matches.forEach(m => {
        const bucket = tStats[m['형식']];
        if (!bucket || !m['최종 결과']) return;
        if (m['최종 결과'] === '승') bucket.w++;
        if (m['최종 결과'] === '패') bucket.l++;
    });
    FORMAT_KEYS.forEach(fmt => {
        const { w, l } = tStats[fmt];
        const rate = (w + l) > 0 ? (w / (w + l) * 100) : 0;
        const ringColor = rateColor(rate);
        document.getElementById(`t-sum-${fmt}-w`).innerHTML = `<span class="wl-win">${w}</span>승 <span class="wl-lose">${l}</span>패`;
        const rateEl = document.getElementById(`t-sum-${fmt}-r`);
        rateEl.innerText = getRateText(w, l);
        rateEl.style.color = ringColor;
        document.getElementById(`t-sum-${fmt}-donut`).style.background = donutBackground(ringColor, rate);
    });
    renderTeamMatchesList('team-recent-list', {format: '전체'}, 10);
}

// 팀 매치 한 경기의 세트별 상세 행들
function teamSetDetailsHtml(m) {
    const teamRounds = roundsForMatch(m);
    if (teamRounds.length === 0) {
        return emptyRowHtml(6, '상세 세트 기록이 없습니다.', 'py-2 fs-body');
    }
    return teamRounds.map(r => {
        const isWin = r['결과'] === '승';
        const isDraw = r['결과'] === '무' || r['결과'] === '무승부';
        let resBadge = '<span class="text-danger fw-bold">패</span>';
        if (isWin) resBadge = '<span class="text-primary fw-bold">승</span>';
        if (isDraw) resBadge = '<span class="text-secondary fw-bold">무</span>';
        const winnerCls = 'fw-bold text-primary', otherCls = 'text-dark';

        return `
                    <tr class="stat-row">
                        <td class="colw-18-8 set-detail-label">${escapeHTML(r['세트']) || ''} ${escapeHTML(r['라운드']) || ''}</td>
                        <td class="colw-18-8 ${isWin ? winnerCls : otherCls}">${escapeHTML(r['우리 선수'])||'-'}</td>
                        <td class="colw-18-8">${resBadge}</td>
                        <td class="colw-18-8 ${(!isWin && !isDraw) ? winnerCls : otherCls}">${escapeHTML(r['상대 선수'])||'-'}</td>
                        <td class="colw-18-8 set-detail-map">${escapeHTML(r['맵']) || '-'}</td>
                        <td class="colw-6"></td>
                    </tr>`;
    }).join('');
}

function teamMatchRowHtml(m, collapseId) {
    const resText = m['최종 결과'] || m['최근 결과'] || '';
    return `
            <tr class="match-row stat-row" role="button" tabindex="0" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <td class="stat-table-sticky-col cell-ellipsis">
                    ${teamCellInnerHtml(m['상대팀'])}
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${escapeHTML(m['세트 결과']) || '-'}</td>
                <td class="badge-cell">${resultBadgeHtml(resText)}</td>
                <td>${escapeHTML(shortMatchDate(m['날짜']))}</td>
                <td><span class="m-arrow">${chevronDownSvg(9)}</span></td>
            </tr>
            <tr>
                <td colspan="6" class="set-detail-host">
                    <div class="collapse" id="${collapseId}">
                        <div class="set-detail-panel">
                            <table class="table table-borderless mb-0 text-center set-detail-table">
                                <tbody>${teamSetDetailsHtml(m)}</tbody>
                            </table>
                        </div>
                    </div>
                </td>
            </tr>
            `;
}

function renderTeamMatchesList(containerId, filters, limit) {
    filters = filters || {};
    const format = filters.format || '전체';
    const opponent = filters.opponent || null;

    let filtered = format === '전체' ? SiteData.matches : SiteData.matches.filter(m => m['형식'] === format);
    if (opponent) filtered = filtered.filter(m => m['상대팀'] === opponent);
    const sliced = limit ? filtered.slice(0, limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length
        ? sliced.map((m, idx) => teamMatchRowHtml(m, `collapse-${containerId}-${idx}`)).join('')
        : EMPTY_MATCH_ROW_HTML;
}

function openTeamMatchModal(format) {
    document.getElementById('teamModalTitle').innerText = format === '전체' ? '팀 전체 전적' : `팀 ${format} 전적`;
    renderTeamMatchesList('team-modal-list', {format}, null);
    showModal('teamMatchesModal');
}

function openTeamOpponentModal(opponent) {
    document.getElementById('teamModalTitle').innerHTML = `${teamLogoHtml(opponent, 20)} vs ${escapeHTML(opponent)} 전체 전적`;
    renderTeamMatchesList('team-modal-list', {format: '전체', opponent}, null);
    showModal('teamMatchesModal');
}
// 상대 전적 표(서버에서 구운 행)는 행마다 onclick을 달지 않고 한 곳에서 위임 처리한다.
document.addEventListener('click', function(e) {
    const row = e.target.closest('.team-row-clickable');
    if (row) openTeamOpponentModal(row.dataset.team);
});

function renderIndividualSidebar() {
    const html = [avatarSelectAllItemHtml('side-btn-summary', 'showIndivSummary()')];
    const formerHtml = [];
    SiteData.members.forEach(m => {
        const item = avatarSelectItemHtml('side-player-', m['이름'], m['SOOP ID'], 'selectPlayer');
        (isActiveMember(m) ? html : formerHtml).push(item);
    });

    html.push(`<div class="avatar-select-item avatar-select-toggle" id="indiv-toggle-former" role="button" tabindex="0" onclick="toggleFormerMembers()">
                        <div class="avatar-select-fallback">
                            ${chevronDownSvg(10, ' id="indiv-toggle-chevron" class="chevron-rotatable"')}
                        </div>
                        <span class="avatar-select-name">이전 멤버</span>
                   </div>`);
    html.push(`<span id="indiv-former-wrap" class="d-none">${formerHtml.join('')}</span>`);

    document.getElementById('indiv-avatar-list').innerHTML = html.join('');
}

// "이전 멤버" 접기/펼치기 공용: 대상 영역 표시 + 쉐브론 회전
function toggleCollapsible(areaId, chevronId) {
    const area = document.getElementById(areaId);
    const chevron = document.getElementById(chevronId);
    const nowOpen = !isVisible(area);
    setVisible(area, nowOpen);
    if (chevron) chevron.classList.toggle('is-open', nowOpen);
}

function toggleFormerMembers() {
    toggleCollapsible('indiv-former-wrap', 'indiv-toggle-chevron');
}

function showIndivSummary() {
    RecordsState.player = '';
    setVisible(document.getElementById('statContent'), false);
    setVisible(document.getElementById('indiv-summary-content'), true);
    document.getElementById('indiv-content-title').innerText = '전체 전적';
    setActiveAvatarItem('indiv-avatar-list', document.getElementById('side-btn-summary'));

    document.getElementById('indiv-summary-tbody').innerHTML = SiteData.members.filter(isActiveMember).map(m => {
        const pStat = findPlayerStats(m['이름']);
        const name = m['이름'];
        return `<tr class="stat-row clickable-row" role="button" tabindex="0" onclick="selectPlayer('${jsAttr(name)}')">
                <td class="fw-bold text-dark text-center stat-table-sticky-col text-nowrap colw-20"><span class="d-flex align-items-center justify-content-center gap-2">${avatarHtml(m['SOOP ID'], 'player-avatar-sm')}<span class="ellipsis-text">${escapeHTML(name)}</span></span></td>
                ${FORMAT_KEYS.map(fmt => `<td class="text-nowrap colw-20">${escapeHTML(pStat[`${fmt} 전적`]) || '-'}</td>`).join('\n                ')}
            </tr>`;
    }).join('');
    updateStatsHash();
}

// 개인 전적 프로필 도넛: [도넛 id 접미사, 통계 키, 색상]
const INDIV_DONUTS = [
    ['fmt-1', '대회 전적', 'byRate'],
    ['fmt-2', '대학 전적', 'byRate'],
    ['fmt-3', '미니 전적', 'byRate'],
    ['race-t', '테란전 전적', 'var(--color-race-t)'],
    ['race-z', '저그전 전적', 'var(--color-race-z)'],
    ['race-p', '프로토스전 전적', 'var(--color-race-p)'],
];

function selectPlayer(name) {
    RecordsState.player = name;
    setVisible(document.getElementById('indiv-summary-content'), false);
    setVisible(document.getElementById('statContent'), true);
    document.getElementById('indiv-content-title').innerText = `${name}의 전적`;

    const sideItem = document.getElementById(`side-player-${name}`);
    setActiveAvatarItem('indiv-avatar-list', sideItem);
    // 이전 멤버가 접혀있는 상태에서 그 사람이 선택되면 자동으로 펼쳐준다
    const formerWrap = document.getElementById('indiv-former-wrap');
    if (sideItem && formerWrap && formerWrap.contains(sideItem) && !isVisible(formerWrap)) {
        toggleFormerMembers();
    }

    const pStat = findPlayerStats(name);
    const pDb = findMemberByName(name) || {};

    document.getElementById('p-name').innerText = name;
    applyBadge(document.getElementById('p-tier'), tierLabel(pDb['티어']), 'tag-badge tier-badge');
    applyBadge(document.getElementById('p-race'), raceShortLabel(pDb['종족']), 'tag-badge' + raceBadgeClass(pDb['종족']));
    document.getElementById('p-avatar').innerHTML = profileAvatarInnerHtml(pDb['SOOP ID']);

    INDIV_DONUTS.forEach(([suffix, key, color]) => {
        updateDonut(`d-${suffix}`, `dt-${suffix}`, `dw-${suffix}`, parseStat(pStat[key]), color);
    });

    renderIndivMatchesList('indiv-recent-list', RecordsState.indivFilter, 10);
    updateStatsHash();
}

// 필터 칩의 활성 표시를 현재 필터 값에 맞춘다.
function syncIndivFilterUI() {
    staticAll('#indiv-filters .filter-item').forEach(el => {
        el.classList.toggle('active', el.textContent.trim() === RecordsState.indivFilter);
    });
}

function setIndivFilter(format) {
    RecordsState.indivFilter = format;
    syncIndivFilterUI();
    renderIndivMatchesList('indiv-recent-list', format, 10);
}

function renderIndivMatchesList(containerId, format, limit) {
    let filtered = SiteData.rounds.filter(m => m['우리 선수'] === RecordsState.player);
    if (format !== '전체') filtered = filtered.filter(m => m['형식'] === format);
    const sliced = limit ? filtered.slice(0, limit) : filtered;

    document.getElementById(containerId).innerHTML = sliced.length ? sliced.map(m => `
            <tr class="stat-row">
                <td class="stat-table-sticky-col cell-ellipsis">${escapeHTML(m['상대 선수']) || '-'}</td>
                <td class="cell-ellipsis">
                    ${teamCellInnerHtml(m['상대팀'])}
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${escapeHTML(m['맵']) || '-'}</td>
                <td class="badge-cell">${resultBadgeHtml(m['결과'] || '')}</td>
                <td>${escapeHTML(shortMatchDate(m['날짜']))}</td>
            </tr>
            `).join('') : EMPTY_MATCH_ROW_HTML;
}

function openIndivMatchModal() {
    const { player, indivFilter } = RecordsState;
    document.getElementById('indivModalTitle').innerText = indivFilter === '전체' ? `${player} 개인 전체 전적` : `${player} 전체 전적 (${indivFilter})`;
    renderIndivMatchesList('indiv-modal-list', indivFilter, null);
    showModal('indivMatchesModal');
}

// =====================================================================
// 7. 멤버 현황 / 프로필
// =====================================================================
const MEMBER_TABS = { status: ['tab-member-status', 'view-member-status'], news: ['tab-member-news', 'view-member-news'] };
const ROLE_ORDER_BASE = ['감독', '코치', '선수'];

function updateMembersHash() {
    const params = {};
    if (isTabActive('tab-member-news')) {
        params.view = 'news';
        if (NewsState.player) params.member = NewsState.player['이름'];
    }
    updateHash('members', params);
}

function switchMemberView(viewType, skipHashUpdate) {
    activateTabView(MEMBER_TABS, viewType);
    if (viewType === 'news') {
        if (!NewsState.sidebarRendered) {
            renderNewsSidebar();
            NewsState.sidebarRendered = true;
            showNewsAll(true);
        } else {
            // 숨겨져 있던 동안 그려졌거나 창 크기가 바뀌었으면 레이아웃(PC/모바일)을 다시 맞춘다.
            refreshNewsLayoutIfNeeded();
        }
    }
    if (!skipHashUpdate) updateMembersHash();
}

function memberCardHtml(m) {
    return `
        <div class="member-card${isActiveMember(m) ? '' : ' former'}" role="button" tabindex="0" onclick="openMemberProfile('${jsAttr(m['이름'])}')">
            <span class="tool-card-ext">↗</span>
            ${avatarHtml(m['SOOP ID'], 'member-avatar-img')}
            <div class="member-card-name">${escapeHTML(m['이름'])}</div>
            <div class="member-card-tags">
                ${tierBadgeHtml(m['티어'])}
                ${raceBadgeHtml(m['종족'])}
            </div>
        </div>`;
}

// (예전의 opts.collapseId 분기는 어디서도 쓰이지 않던 죽은 코드라 제거했다)
function renderMemberGroup(title, members) {
    if (members.length === 0) return '';
    const sorted = [...members].sort((a, b) =>
        tierIndex(a['티어']) - tierIndex(b['티어']) || String(a['이름']).localeCompare(String(b['이름']), 'ko'));

    return `
        <div class="section-title"><span class="section-title-label">${escapeHTML(title)}<span class="title-count-divider"></span><span class="text-secondary title-count">${sorted.length}명</span></span></div>
        <div class="member-grid mb-block">${sorted.map(memberCardHtml).join('')}</div>`;
}

function renderMembersPage() {
    const activeMembers = SiteData.members.filter(isActiveMember);
    const formerMembers = SiteData.members.filter(m => !isActiveMember(m));
    const allRoles = [...new Set(activeMembers.map(m => m['직책'] || '기타'))];
    const roleOrder = [...ROLE_ORDER_BASE, ...allRoles.filter(r => !ROLE_ORDER_BASE.includes(r))];

    let html = roleOrder.map(role => renderMemberGroup(role, activeMembers.filter(m => (m['직책'] || '기타') === role))).join('');

    if (formerMembers.length > 0) {
        html += `
            <div class="text-center section-trailer">
                <button class="news-load-more" id="former-members-toggle-btn" onclick="toggleFormerMembersSection()">이전 멤버 ${chevronDownSvg(9, ' id="former-members-toggle-chevron" class="chevron-rotatable"')}</button>
            </div>
            <div id="former-members-section" class="d-none">
                ${renderMemberGroup('이전 멤버', formerMembers)}
            </div>`;
    }

    document.getElementById('members-groups').innerHTML = html || '<div class="text-center text-muted py-5">등록된 멤버가 없습니다.</div>';
}

function toggleFormerMembersSection() {
    toggleCollapsible('former-members-section', 'former-members-toggle-chevron');
}

function openMemberProfile(name) {
    const m = findMemberByName(name);
    if (!m) return;

    document.getElementById('mp-name').innerText = name;
    const mpRoleBadge = document.getElementById('mp-role-badge');
    applyBadge(mpRoleBadge, m['직책'] || '미정', 'tag-badge role-badge');
    mpRoleBadge.style.background = roleColor(m['직책']); // 직책마다 달라지는 동적 색이라 인라인 유지
    applyBadge(document.getElementById('mp-race-badge'), raceShortLabel(m['종족']), 'tag-badge' + raceBadgeClass(m['종족']));
    applyBadge(document.getElementById('mp-tier-badge'), tierLabel(m['티어']), 'tag-badge tier-badge');
    document.getElementById('mp-avatar').innerHTML = profileAvatarInnerHtml(m['SOOP ID']);

    const active = isActiveMember(m);
    const days = m['입단일'] ? daysBetween(m['입단일'], active ? todayStr() : (m['퇴단일'] || null)) : null;
    // 다른 뱃지들(직책/티어/종족)과 같은 tag-badge 패밀리를 써서 톤을 맞추고, 텍스트와
    // 뱃지를 flex로 묶어 기준선이 아니라 박스 높이 기준으로 정렬한다.
    const daysBadge = days !== null
        ? `<span class="tag-badge tier-badge">${days}일${active ? '째' : ''}</span>`
        : '';
    const period = m['입단일']
        ? `<span class="d-inline-flex align-items-center flex-wrap gap-2">${escapeHTML(m['입단일'])} ~ ${active ? '현재' : (escapeHTML(m['퇴단일']) || '-')}${daysBadge}</span>`
        : '-';
    const soopId = m['SOOP ID'];
    const broadcast = isValidSoopId(soopId)
        ? `<a href="https://www.sooplive.com/station/${encodeURIComponent(String(soopId).trim())}" target="_blank" rel="noopener" class="d-inline-flex align-items-center" aria-label="SOOP 방송국">
                   <img src="images/숲로고.webp" alt="SOOP" class="soop-logo-icon">
               </a>`
        : '-';

    const rows = [
        ['성별', escapeHTML(m['성별']) || '-'],
        ['생년월일', escapeHTML(m['생년월일']) || '-'],
        ['MBTI', escapeHTML(m['MBTI']) || '-'],
        ['활동기간', period],
        ['방송국', broadcast],
    ];
    document.getElementById('mp-info-body').innerHTML = rows.map(([label, val]) => `
            <tr>
                <td class="text-secondary profile-info-label">${label}</td>
                <td class="fw-bold text-dark profile-info-value">${val}</td>
            </tr>`).join('');

    renderMemberActivitySummary(m);
    showModal('memberProfileModal');
}

// 프로필 팝업의 "이번 달 방송 활동"을 시너지표(ststats)에서 가져온 데이터로 채운다.
function renderMemberActivitySummary(m) {
    const statusEl = document.getElementById('mp-activity-status');
    const valueEls = ['mp-balloons', 'mp-broadcast-hours', 'mp-viewers', 'mp-sponsor-record'].map(id => document.getElementById(id));
    const setValues = values => valueEls.forEach((el, i) => { el.innerText = values[i]; });

    if (!SynergyState.data) {
        statusEl.innerText = '데이터 불러오는 중';
        setValues(['-', '-', '-', '-']);
        return;
    }

    const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
    const entry = SynergyState.data.find(s => String(s.id || '').trim().toLowerCase() === soopId);
    if (!entry) {
        statusEl.innerText = '데이터 없음';
        setValues(['-', '-', '-', '-']);
        return;
    }

    statusEl.innerText = '';
    setValues([
        formatCount(entry.balloons, '개'),
        formatSecondsToHM(entry.broadcast_seconds),
        formatCount(entry.cumulative_viewers, '명'),
        formatSponsorRecord(entry.sponsor_wins, entry.sponsor_losses),
    ]);
}

// =====================================================================
// 8. 홈 화면 (방송 중 / 최근 공지)
// =====================================================================

// 참고 프로젝트(ststats)의 개인페이지 패턴 그대로: bjapi.afreecatv.com을
// 브라우저에서 직접 fetch한다 (CORS 허용됨). 활성 멤버가 소수라 페이지 로드
// 시점에 병렬로 바로 체크한다 - 그래서 워크플로를 몇 분마다 돌릴 필요가 없다.
async function checkIsLiveRealtime(soopId) {
    try {
        const data = await cachedFetchJson(`https://bjapi.afreecatv.com/api/${soopId}/station`, 30000); // 30초 (실시간성 유지 위해 짧게)
        if (!data || !data.broad) return null;
        return {
            broad: data.broad,
            broadStart: (data.station && data.station.broad_start) || null,
        };
    } catch (e) {
        return null;
    }
}

function formatLiveElapsed(broadStart) {
    if (!broadStart) return '';
    const startDate = parseSoopDate(broadStart);
    if (isNaN(startDate.getTime())) return '';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
    const eh = Math.floor(elapsedSec / 3600);
    const em = Math.floor((elapsedSec % 3600) / 60);
    return (eh > 0 ? `${eh}시간 ${em}분` : `${em}분`) + ' 방송 중';
}

function liveCardHtml({ member: m, live }) {
    const { broad, broadStart } = live;
    const soopId = m['SOOP ID'];
    const viewerText = broad.current_sum_viewer != null ? broad.current_sum_viewer.toLocaleString('ko-KR') + '명' : '-';
    const elapsedText = formatLiveElapsed(broadStart) || '-';
    // 아바타 링 색: 여자는 기존 그대로(빨강 계열 그라디언트), 남자만 파란 원테두리로.
    const avatarRingClass = m['성별'] === '남자' ? 'live-card-avatar-ring live-card-avatar-ring--male' : 'live-card-avatar-ring';

    return `
            <a class="live-broadcast-card" href="https://play.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
                <div class="live-thumb-wrap">
                    <img class="live-thumb" src="https://liveimg.sooplive.co.kr/m/${encodeURIComponent(broad.broad_no)}" alt="방송 화면" onerror="this.style.display='none';">
                    <span class="live-badge">LIVE</span>
                </div>
                <div class="live-card-body">
                    <div class="live-card-title">${escapeHTML(broad.broad_title || '')}</div>
                    <div class="live-card-meta-row">
                        <div class="live-card-who">
                            <span class="${avatarRingClass}">${avatarHtml(soopId, 'live-card-avatar')}</span>
                            <span class="live-card-name">${escapeHTML(m['이름'])}</span>
                        </div>
                        <div class="live-card-stats">
                            <div class="live-card-viewers">${escapeHTML(viewerText)}</div>
                            <div class="live-card-elapsed">${escapeHTML(elapsedText)}</div>
                        </div>
                    </div>
                </div>
            </a>`;
}

async function renderLiveBroadcasts() {
    const container = document.getElementById('home-live-broadcast');
    if (!container) return;
    const noLiveHtml = emptyStateHtml('현재 방송 중인 멤버가 없습니다.');
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noLiveHtml;
        return;
    }
    container.innerHTML = emptyStateHtml('방송 상태 확인 중...');

    const settled = await Promise.allSettled(
        activeMembers.map(m => checkIsLiveRealtime(m['SOOP ID']).then(live => ({ member: m, live })))
    );
    const liveList = settled.filter(r => r.status === 'fulfilled' && r.value.live).map(r => r.value);

    container.innerHTML = liveList.length
        ? `<div class="live-broadcast-grid">${liveList.map(liveCardHtml).join('')}</div>`
        : noLiveHtml;
}

// 공지 카드에 필요한 표시용 필드를 게시글 한 개에서 뽑는다(홈 최근 공지/지난 글 리스트 공용).
function noticeCardFields(member, post) {
    return {
        soopId: member ? member['SOOP ID'] : post.userId,
        name: member ? member['이름'] : (post.userNick || ''),
        title: post.titleName || '(제목 없음)',
        snippet: (post.content && post.content.textContent) || '',
        timeText: formatRelativeTime(post.regDate),
        thumbUrl: post.photos && post.photos[0] && post.photos[0].url,
    };
}

// "최근 공지"/"지난 글" 카드 한 장의 마크업 - 홈 화면 목록과 멤버 공지 탭의
// "지난 글" 리스트가 완전히 같은 모양이라 공용 함수로 뺐다. 클릭했을 때 동작만
// 서로 달라서 onclick 속성 문자열(호출부에서 jsAttr로 이스케이프 완료)만 인자로 받는다.
function homeNoticeCardHtml({ soopId, name, title, snippet, timeText, thumbUrl }, onclickAttr, extra) {
    const thumbHtml = thumbUrl ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy" onerror="this.remove();">` : '';
    const extraClass = extra && extra.extraClass ? ' ' + extra.extraClass : '';
    const extraAttr = extra && extra.dataAttr ? ' ' + extra.dataAttr : '';
    return `
        <div class="home-notice-card${extraClass}" role="button" tabindex="0" onclick="${onclickAttr}"${extraAttr}>
            <div class="home-notice-main">
                <div class="home-notice-top">
                    ${avatarHtml(soopId, 'home-notice-avatar')}
                    <div class="home-notice-toptext">
                        <div class="home-notice-name">${escapeHTML(name)}</div>
                        <div class="home-notice-title-row">
                            <span class="home-notice-title">${escapeHTML(title)}</span>
                            <span class="home-notice-dot">·</span>
                            <span class="home-notice-meta">${escapeHTML(timeText)}</span>
                        </div>
                    </div>
                </div>
                ${snippet ? `<div class="home-notice-snippet">${formatNewsContent(snippet)}</div>` : ''}
            </div>
            ${thumbHtml}
        </div>`;
}

// SOOP 채널 게시판 API를 브라우저에서 직접 fetch한다 (방송중 체크와 같은 방식).
// 공지만이 아니라 일반글도 같이 긁어와서(fetchMemberFeed는 공지+일반글을 합쳐 최신순 반환) 섞는다.
async function renderLatestNotices() {
    const container = document.getElementById('home-notice-list');
    if (!container) return;
    const noNoticeHtml = emptyStateHtml('최근 공지가 없습니다.', 'clean-card');
    const activeMembers = activeMembersWithSoopId();

    if (activeMembers.length === 0) {
        container.innerHTML = noNoticeHtml;
        return;
    }

    const settled = await Promise.allSettled(
        activeMembers.map(async m => {
            const { posts } = await fetchMemberFeed(m['SOOP ID'], 1);
            return posts.slice(0, 3).map(post => ({ member: m, post }));
        })
    );
    const latest = sortNewsByDateDesc(settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value));

    container.innerHTML = latest.length
        ? latest.slice(0, 5).map(({ member: m, post }) =>
            homeNoticeCardHtml(noticeCardFields(m, post), `goToNewsFeed('${jsAttr(m['이름'])}')`)).join('')
        : noNoticeHtml;
}

// 홈 화면 "전체 보기"/공지 클릭 -> 멤버 페이지의 소식 탭으로 이동.
// name이 있으면(홈 공지 클릭) 원글로 나가지 않고 그 멤버의 개인 공지 탭으로 바로 이동한다.
// 탭 전환 -> 전체글 표시 -> 멤버 선택까지 한 번의 클릭으로 이어지는데, 단계마다
// 히스토리를 따로 쌓으면 뒤로가기를 여러 번 눌러야 빠져나가지므로, 여기서 한 번만 반영한다.
function goToNewsFeed(name) {
    switchPage('members', true);
    switchMemberView('news', true);
    if (name) selectNewsPlayer(name, true);
    updateMembersHash();
}

// =====================================================================
// 9. 멤버 공지 피드 (SOOP 게시판 전체 글)
// =====================================================================
// "전체 공지"/"멤버별 공지" 두 화면 다 이 하나의 상태로 통일해서 그린다.
const NewsState = {
    sidebarRendered: false,
    player: null,          // 선택된 멤버 객체 (null = 전체 공지)
    mode: 'all',           // 'all'(전체 공지) | 'member'(특정 멤버) - 더보기 때 어느 쪽 API를 더 부를지 결정
    items: [],             // 지금 화면에 로드되어 있는 { member, post } 목록
    featuredKey: null,     // 왼쪽 "최신 글" 자리에 올려둔 글의 식별자 - 리스트 클릭 시 이 값만 바뀐다
    hasMore: false,
    loading: false,        // "더 보기" 중복 클릭 방지
    memberPage: 1,         // 멤버 모드: 마지막으로 받은 페이지
    memberTotalPages: 1,
    allPool: [],           // 전체 모드: 멤버별로 모아 날짜순 정렬해둔 후보 풀
    allShownCount: 0,
    // 전체 모드에서 멤버별로 다음에 가져올 페이지 번호와 총 페이지 수.
    // Map<soopId, { nextPage, totalPages }> - 풀에 남은 게 부족하면 아직 페이지가 남은 멤버의 다음 페이지를 가져온다.
    allMemberState: new Map(),
    // 목록 API의 content.content(원본 HTML)는 이미 전체 본문이고 textContent만 잘린 미리보기다.
    // "더보기"를 위해 상세 API를 따로 부르지 않고, 카드를 그릴 때 받아온 전체 HTML을 titleNo로 기억해둔다.
    fullContent: {},
    // 요청 세대 번호: 새 목록 요청을 시작할 때마다 올린다. 응답이 돌아왔을 때 번호가 바뀌어
    // 있으면(그 사이 다른 멤버/전체를 선택함) 그 응답은 버린다. 예전엔 A 멤버 글을 불러오는
    // 도중 B를 누르면 B 요청은 무시되고, 뒤늦게 온 A의 글이 B 이름·사진으로 그려졌다.
    requestSeq: 0,
};
const NEWS_PAGE_SIZE = 10;

const sortNewsByDateDesc = items => items.slice().sort((a, b) => soopDateMs(b.post.regDate) - soopDateMs(a.post.regDate));

function renderNewsSidebar() {
    const html = [avatarSelectAllItemHtml('news-side-btn-all', 'showNewsAll()')];
    activeMembersWithSoopId().forEach(m => {
        html.push(avatarSelectItemHtml('news-side-player-', m['이름'], m['SOOP ID'], 'selectNewsPlayer'));
    });
    document.getElementById('news-avatar-list').innerHTML = html.join('');
}

// 아직 다음 페이지가 남아있는 멤버가 한 명이라도 있는지
function newsAnyMemberHasMorePages() {
    for (const st of NewsState.allMemberState.values()) {
        if (st.nextPage <= st.totalPages) return true;
    }
    return false;
}

// { member, post } 하나를 고유하게 식별하는 키
function newsItemKey(item) {
    const soopId = item.member ? item.member['SOOP ID'] : item.post.userId;
    return soopId + '_' + item.post.titleNo;
}

async function showNewsAll(skipHashUpdate) {
    setActiveAvatarItem('news-avatar-list', document.getElementById('news-side-btn-all'));
    document.getElementById('news-content-title').innerText = '전체 공지';
    NewsState.player = null;
    if (!skipHashUpdate) updateMembersHash();

    const content = document.getElementById('news-feed-content');
    content.innerHTML = emptyStateHtml('불러오는 중...');
    const token = ++NewsState.requestSeq;

    // 멤버별로 최근 글 후보를 모아서(공지+일반글 합친 것) 전체를 한 번에 날짜순으로 다시 정렬.
    // 주의: fetchMemberFeed(mergeOwnPosts)는 perPage=10짜리 일반글에 공지를 추가로 합치기
    // 때문에 10개보다 많이 돌아올 수 있다 - 자르면 넘치는 만큼 조용히 누락되므로 전부 담는다.
    const memberState = new Map();
    const settled = await Promise.allSettled(
        activeMembersWithSoopId().map(async m => {
            const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], 1);
            memberState.set(m['SOOP ID'], { nextPage: 2, totalPages });
            return posts.map(post => ({ member: m, post }));
        })
    );
    if (token !== NewsState.requestSeq) return; // 그 사이 다른 목록이 선택됨

    NewsState.allMemberState = memberState;
    NewsState.allPool = sortNewsByDateDesc(settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value));
    NewsState.mode = 'all';
    NewsState.featuredKey = null; // 새로 들어왔으니 제일 최신 글을 다시 왼쪽에 올린다
    NewsState.allShownCount = NewsState.allPool.length; // 이미 멤버별로 가져온 건 처음부터 다 보여준다
    NewsState.items = NewsState.allPool.slice(0, NewsState.allShownCount);
    NewsState.hasMore = NewsState.allShownCount < NewsState.allPool.length || newsAnyMemberHasMorePages();
    renderNewsLayout(content);
}

function selectNewsPlayer(name, skipHashUpdate) {
    setActiveAvatarItem('news-avatar-list', document.getElementById(`news-side-player-${name}`));
    document.getElementById('news-content-title').innerText = `${name}의 공지`;

    const m = findMemberByName(name);
    if (!m) return;
    NewsState.player = m;
    NewsState.memberPage = 1;
    NewsState.memberTotalPages = 1;
    if (!skipHashUpdate) updateMembersHash();

    document.getElementById('news-feed-content').innerHTML = emptyStateHtml('불러오는 중...');
    loadNewsFeed();
}

async function loadNewsFeed() {
    const member = NewsState.player;
    if (!member) return;
    const content = document.getElementById('news-feed-content');
    const token = ++NewsState.requestSeq;

    try {
        const { posts, totalPages } = await fetchMemberFeed(member['SOOP ID'], 1);
        if (token !== NewsState.requestSeq) return;

        NewsState.memberPage = 1;
        NewsState.memberTotalPages = totalPages;
        NewsState.mode = 'member';
        NewsState.featuredKey = null; // 멤버를 새로 선택했으니 그 멤버의 가장 최신 글을 왼쪽에 올린다
        NewsState.items = posts.map(post => ({ member, post }));
        NewsState.hasMore = NewsState.memberPage < NewsState.memberTotalPages;
        renderNewsLayout(content);
    } catch (e) {
        if (token === NewsState.requestSeq) content.innerHTML = emptyStateHtml('글을 불러오지 못했습니다.');
    }
}

// 풀에 남은 게 한 페이지어치도 안 되면, 아직 다음 페이지가 남은 멤버들의 다음 페이지를
// 마저 받아와서 풀을 채운 뒤 10개를 더 보여준다.
async function loadMoreAllNews(token) {
    const S = NewsState;
    if (S.allPool.length - S.allShownCount < NEWS_PAGE_SIZE && newsAnyMemberHasMorePages()) {
        const membersToFetch = activeMembersWithSoopId().filter(m => {
            const st = S.allMemberState.get(m['SOOP ID']);
            return st && st.nextPage <= st.totalPages;
        });
        const settled = await Promise.allSettled(
            membersToFetch.map(async m => {
                const st = S.allMemberState.get(m['SOOP ID']);
                const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], st.nextPage);
                st.totalPages = totalPages;
                st.nextPage += 1;
                return posts.map(post => ({ member: m, post }));
            })
        );
        if (token !== S.requestSeq) return false;
        // 공지가 페이지마다 같이 딸려올 수 있어, 이미 풀에 있는 글은 다시 추가하지 않는다.
        const existingKeys = new Set(S.allPool.map(newsItemKey));
        const fetched = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
            .filter(item => !existingKeys.has(newsItemKey(item)));
        S.allPool = sortNewsByDateDesc(S.allPool.concat(fetched));
    }
    S.allShownCount = Math.min(S.allShownCount + NEWS_PAGE_SIZE, S.allPool.length);
    S.items = S.allPool.slice(0, S.allShownCount);
    S.hasMore = S.allShownCount < S.allPool.length || newsAnyMemberHasMorePages();
    return true;
}

// 특정 멤버의 다음 페이지를 서버에 추가로 요청한다.
async function loadMoreMemberNews(token) {
    const S = NewsState;
    const member = S.player;
    S.memberPage += 1;
    const { posts, totalPages } = await fetchMemberFeed(member['SOOP ID'], S.memberPage);
    if (token !== S.requestSeq) return false;
    S.memberTotalPages = totalPages;
    // 공지(noticeData)는 페이지가 넘어가도 고정으로 같이 딸려오는 경우가 있어, 이미 있는 글은
    // 다시 추가하지 않는다 (안 그러면 "더보기"를 누를 때마다 같은 공지가 중복으로 쌓임).
    const existingKeys = new Set(S.items.map(newsItemKey));
    S.items = S.items.concat(posts.map(post => ({ member, post })).filter(item => !existingKeys.has(newsItemKey(item))));
    S.hasMore = S.memberPage < S.memberTotalPages;
    return true;
}

// 더보기: "전체 공지"면 모아둔 풀에서 더 꺼내 보여주고, 특정 멤버면 다음 페이지를 요청한다.
async function loadMoreNewsFeed() {
    if (NewsState.loading) return;
    NewsState.loading = true;
    const token = NewsState.requestSeq;
    // 다시 그리면 #news-past-list가 새로 만들어지면서 스크롤이 0으로 초기화되니, 보던 위치를 저장해둔다.
    const restoreScroll = capturePastListScroll();
    try {
        let updated = false;
        if (NewsState.mode === 'all') updated = await loadMoreAllNews(token);
        else if (NewsState.mode === 'member' && NewsState.player) updated = await loadMoreMemberNews(token);
        if (!updated) return;
        renderNewsLayout(document.getElementById('news-feed-content'));
        restoreScroll();
    } finally {
        NewsState.loading = false;
    }
}

// 오른쪽 "지난 글" 리스트(#news-past-list)의 내부 스크롤 위치를 저장하고, 다시 그린 뒤
// 복원하는 함수를 돌려준다(더보기/최신 글 교체 공용). 리스트가 없는 모바일 레이아웃에선 사실상 무동작.
function capturePastListScroll() {
    const before = document.getElementById('news-past-list');
    const saved = before ? before.scrollTop : 0;
    return () => {
        const after = document.getElementById('news-past-list');
        if (after) after.scrollTop = saved;
    };
}

// 리스트에서 글을 클릭했을 때 - 그 글을 왼쪽 "최신 글" 자리로 올린다(배열 순서/날짜는 그대로,
// 어떤 글을 큰 카드로 그릴지만 바꿔서 다시 그린다 - 오른쪽 리스트는 항상 날짜순 유지).
function setNewsFeatured(key) {
    const restoreScroll = capturePastListScroll();
    NewsState.featuredKey = key;
    renderNewsLayout(document.getElementById('news-feed-content'));
    restoreScroll();
}

// 고정 픽셀 기준 대신, CSS에서 두 컬럼에 준 min-width(.featured-post 300px + .past-posts
// 300px) + gap(28px)을 기준으로 삼아 "오른쪽 리스트가 폭이 부족해 아래로 떨어지려는 순간"에
// 정확히 모바일(단일 리스트) 모드로 전환한다.
const NEWS_TWO_COL_MIN_WIDTH = 300 + 28 + 300;
function isNewsMobileLayout() {
    const content = document.getElementById('news-feed-content');
    if (!content) return false;
    return content.clientWidth < NEWS_TWO_COL_MIN_WIDTH;
}
// 화면에 실제로 보이는 중인지(숨겨진 탭에서는 폭이 0으로 재져서 모바일로 오판된다)
function isNewsFeedShown(content) {
    return !!content && content.offsetParent !== null;
}

// 창 크기를 조절하다 모바일 기준선을 넘나들면 레이아웃 방식 자체가 바뀌어야 하므로
// 다시 그린다. 숨겨진 상태에서는 판단을 미루고, 다시 보일 때 맞춘다.
function refreshNewsLayoutIfNeeded() {
    const content = document.getElementById('news-feed-content');
    if (NewsState.items.length === 0 || !isNewsFeedShown(content)) return;
    const wasMobile = content.classList.contains('news-feed-mobile');
    if (wasMobile !== isNewsMobileLayout()) renderNewsLayout(content);
}
window.addEventListener('resize', rafThrottle(refreshNewsLayoutIfNeeded));

// 오늘/어제/이번 주/이번 달/이전 - 리스트를 메신저처럼 구간으로 나눠 스캔하기 쉽게 한다.
function newsDateGroupLabel(dateStr) {
    const d = parseSoopDate(dateStr);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = new Date();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((todayDay - day) / 86400000);
    if (diffDays <= 0) return '오늘';
    if (diffDays === 1) return '어제';
    if (diffDays <= 7) return '이번 주';
    if (diffDays <= 30) return '이번 달';
    return '이전';
}

// 이미 날짜순으로 정렬된 items를 렌더링하면서, 그룹 라벨이 바뀌는 지점마다 구분 라벨을 끼운다.
function renderNewsItemsWithDateGroups(items, renderItemFn) {
    let lastGroup = null;
    return items.map(item => {
        const group = newsDateGroupLabel(item.post.regDate);
        const groupHtml = group !== lastGroup ? `<div class="news-date-group-label">${group}</div>` : '';
        lastGroup = group;
        return groupHtml + renderItemFn(item);
    }).join('');
}

function featuredPostWrapHtml(item) {
    return `<div class="featured-post" data-news-key="${escapeHTML(newsItemKey(item))}">${renderFeaturedPostHtml(item)}</div>`;
}

// 모바일: 날짜순 단일 리스트에서 선택된 글만 그 자리에서 큰 카드로 확대한다
// (큰 글을 맨 위에 고정하면 리스트에서 누를 때마다 위로 스크롤해야 보이기 때문).
function newsMobileLayoutHtml(sorted, loadMoreHtml) {
    return renderNewsItemsWithDateGroups(sorted, item => (newsItemKey(item) === NewsState.featuredKey
        ? featuredPostWrapHtml(item)
        : renderPastNoticeHtml(item))) + loadMoreHtml;
}

// PC: 왼쪽 큰 카드(선택된 글) + 오른쪽 날짜순 "지난 글" 리스트
function newsDesktopLayoutHtml(sorted, loadMoreHtml) {
    const featuredItem = sorted.find(it => newsItemKey(it) === NewsState.featuredKey);
    const restItems = sorted.filter(it => newsItemKey(it) !== NewsState.featuredKey);
    const pastListHtml = restItems.length
        ? renderNewsItemsWithDateGroups(restItems, renderPastNoticeHtml)
        : emptyStateHtml('지난 글이 없습니다.');
    return `
                ${featuredPostWrapHtml(featuredItem)}
                <div class="past-posts">
                    <div id="news-past-list">${pastListHtml}</div>
                    ${loadMoreHtml}
                </div>`;
}

const NEWS_LOAD_MORE_HTML = `<div class="news-load-more-wrap" id="news-load-more-wrap"><button class="news-load-more" onclick="loadMoreNewsFeed()">더 보기 ${chevronDownSvg(9)}</button></div>`;

// "전체 공지"/"멤버별 공지" 공용 렌더러.
function renderNewsLayout(content) {
    if (NewsState.items.length === 0) {
        content.classList.remove('news-feed-mobile');
        content.innerHTML = emptyStateHtml('작성된 글이 없습니다.');
        return;
    }

    const sorted = sortNewsByDateDesc(NewsState.items);
    if (!NewsState.featuredKey || !sorted.some(it => newsItemKey(it) === NewsState.featuredKey)) {
        NewsState.featuredKey = newsItemKey(sorted[0]); // 기본값: 가장 최신 글
    }
    const loadMoreHtml = NewsState.hasMore ? NEWS_LOAD_MORE_HTML : '';

    const mobile = isNewsMobileLayout();
    content.classList.toggle('news-feed-mobile', mobile);
    content.innerHTML = mobile ? newsMobileLayoutHtml(sorted, loadMoreHtml) : newsDesktopLayoutHtml(sorted, loadMoreHtml);
    checkNewsClampButtons(content);
}

// SOOP 게시판 API의 regDate("YYYY-MM-DD HH:MM:SS")를 "N분 전" 식으로 변환
function formatRelativeTime(dateStr) {
    const date = parseSoopDate(dateStr);
    if (isNaN(date.getTime())) return '';
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay}일 전`;
    return String(dateStr).split(' ')[0];
}

// 게시판 응답의 contents(일반글)와 noticeData(공지)를 합쳐서, 본인이 쓴 글만 남기고
// 최신순으로 정렬한다. (같은 글이 양쪽에 겹치는 경우는 titleNo로 중복 제거)
function mergeOwnPosts(data, soopId) {
    const owner = String(soopId).toLowerCase();
    const isOwn = p => !!p && String(p.userId || '').toLowerCase() === owner;
    const merged = [...asArray(data && data.contents).filter(isOwn), ...asArray(data && data.noticeData).filter(isOwn)];
    const seen = new Set();
    const unique = merged.filter(p => {
        if (seen.has(p.titleNo)) return false;
        seen.add(p.titleNo);
        return true;
    });
    return unique.sort((a, b) => soopDateMs(b.regDate) - soopDateMs(a.regDate));
}

async function fetchMemberFeed(soopId, page) {
    try {
        const url = `https://api-channel.sooplive.com/v1.1/channel/${encodeURIComponent(soopId)}/board?perPage=${NEWS_PAGE_SIZE}&page=${page}`;
        const data = await cachedFetchJson(url, 120000); // 2분
        return {
            posts: mergeOwnPosts(data, soopId),
            totalPages: (data && data.meta && data.meta.totalPages) || 1,
        };
    } catch (e) {
        return { posts: [], totalPages: 1 };
    }
}

// 게시판 API의 textContent는 줄바꿈이 <br> 태그로 남아있는 형태라, <br> 계열만 실제 줄바꿈으로
// 바꾸고 나머지는 이스케이프해서 news-post-body(white-space: pre-wrap)에 안전하게 꽂는다.
function formatNewsContent(text) {
    if (!text) return '';
    return escapeHTML(String(text).replace(/<br\s*\/?>/gi, '\n'));
}

// 게시글 원본 HTML을 꽂기 전에 위험한 요소/속성만 제거한다. 정렬/색상 같은 일반 서식은 유지.
// 사진(figure/img)은 카드 하단 갤러리(post.photos)가 따로 보여주므로 본문에서는 제거한다.
// [보강] - noscript/template/svg/math 등 "파싱 문맥에 따라 다르게 해석되는" 요소 제거(mXSS 차단:
//          DOMParser 문서는 스크립트가 꺼진 상태라 noscript 속 내용을 요소로 해석하지만, 실제
//          페이지에 꽂히면 텍스트로 재해석되며 속성값 안에 숨긴 태그가 살아난다).
//        - URL 속성 검사 시 제어문자/공백을 지운 뒤 판단("java\tscript:"도 브라우저는 실행한다),
//          vbscript:/data: 스킴과 formaction/xlink:href 등 URL 속성도 함께 검사.
const NEWS_BLOCKED_TAGS = 'script, style, iframe, object, embed, link, meta, form, figure, img, noscript, template, base, frame, frameset, applet, svg, math, noembed, noframes';
const NEWS_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'background', 'poster', 'srcset']);
const NEWS_BLOCKED_URL = /^(javascript|vbscript|data):/i;

function sanitizeNewsHtml(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll(NEWS_BLOCKED_TAGS).forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            const n = attr.name.toLowerCase();
            const compactValue = (attr.value || '').replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
            if (n.startsWith('on') || n === 'srcdoc' || (NEWS_URL_ATTRS.has(n) && NEWS_BLOCKED_URL.test(compactValue))) {
                el.removeAttribute(attr.name);
            }
        });
    });
    // 사진을 지우고 남은, 원래부터 비어있던 문단(<p></p>, <p>&nbsp;</p>, <p><br></p>)은 정리한다.
    doc.querySelectorAll('p').forEach(p => {
        const onlyBr = p.children.length === 1 && p.children[0].tagName === 'BR';
        if (!p.textContent.trim() && (p.children.length === 0 || onlyBr)) p.remove();
    });
    return doc.body.innerHTML;
}

// 렌더링 직후 "더보기"가 필요한지 판단한다: 1) 실제로 3줄 안에 다 안 들어가거나
// 2) 목록 API가 이미 "..."으로 잘라서 내려준 미리보기인 경우.
function checkNewsClampButtons(container) {
    container.querySelectorAll('.news-post-body-clamp:not([data-clamp-checked])').forEach(body => {
        body.setAttribute('data-clamp-checked', '1');
        const overflowed = body.scrollHeight > body.clientHeight + 1;
        const looksApiTruncated = /(\.\.\.|…)\s*$/.test((body.textContent || '').trim());
        if (overflowed || looksApiTruncated) {
            const btn = body.nextElementSibling;
            if (btn && btn.classList.contains('news-post-more-btn')) btn.style.display = 'inline-flex';
        }
    });
}

// "더보기" 클릭 - 이미 목록 API에서 받아 기억해둔 전체 본문(HTML)을 바로 꽂는다.
function expandNewsPost(btn, titleNo) {
    const body = btn.previousElementSibling;
    const fullHtml = NewsState.fullContent[String(titleNo)];
    if (!fullHtml || !body) return;
    body.innerHTML = sanitizeNewsHtml(fullHtml);
    body.classList.remove('news-post-body-clamp');
    btn.remove();
}

// 공지 카드의 다중 사진 스와이프 - 스크롤 위치로 현재 몇 번째 사진인지 계산해서 인디케이터
// active 표시와 좌/우 화살표(첫 장에선 이전, 마지막 장에선 다음을 숨김)를 갱신한다.
// 스와이프 중 onscroll이 프레임당 여러 번 와도 갤러리마다 한 프레임에 한 번만 계산한다.
const updateNewsPhotoDots = rafThrottleByKey(scroller => {
    const wrap = scroller.parentElement;
    if (!wrap || !wrap.classList.contains('news-post-photos-wrap')) return;
    const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
    const total = scroller.children.length;

    wrap.querySelectorAll('.news-post-photos-dots .photo-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    const prevBtn = wrap.querySelector('.news-photo-nav-prev');
    const nextBtn = wrap.querySelector('.news-photo-nav-next');
    if (prevBtn) prevBtn.classList.toggle('is-hidden', idx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-hidden', idx >= total - 1);
});

// 화살표 클릭 시 사진 한 장 폭만큼 부드럽게 스크롤 이동 (좌: -1, 우: 1)
function scrollNewsPhotos(btn, dir) {
    const wrap = btn.closest('.news-post-photos-wrap');
    const scroller = wrap && wrap.querySelector('.news-post-photos');
    if (scroller) scroller.scrollBy({ left: dir * scroller.clientWidth, behavior: 'smooth' });
}

const HEART_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.2 1.4 6.9 4 5.3c2.2-1.3 4.7-.6 6 1.2l2 2.7 2-2.7c1.3-1.8 3.8-2.5 6-1.2 2.6 1.6 3 4.9 1.3 7.6C18.7 16.65 12 21 12 21z"/></svg>';
const EYE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// 사진이 2장 이상이면 인스타처럼 가로 스와이프(스크롤 스냅) + 하단 인디케이터. PC는 호버 시
// 좌우 화살표, 모바일은 스와이프만(화살표는 CSS @media (hover:none)에서 숨김). 첫 사진은
// 즉시 로드하고, 스와이프해야 보이는 두 번째 사진부터만 지연 로딩한다.
function newsPhotosHtml(photos) {
    if (!photos.length) return '';
    const multi = photos.length > 1;
    const dotsHtml = multi
        ? `<div class="news-post-photos-dots">${photos.map((_, i) => `<span class="photo-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
        : '';
    const navHtml = multi
        ? `<button type="button" class="news-photo-nav news-photo-nav-prev is-hidden" onclick="scrollNewsPhotos(this,-1)" aria-label="이전 사진">‹</button>
               <button type="button" class="news-photo-nav news-photo-nav-next" onclick="scrollNewsPhotos(this,1)" aria-label="다음 사진">›</button>`
        : '';
    return `<div class="news-post-photos-wrap">
                    <div class="news-post-photos"${multi ? ' onscroll="updateNewsPhotoDots(this)"' : ''}>${photos.map((p, i) => `<img src="${escapeHTML(p && p.url)}" alt=""${i > 0 ? ' loading="lazy"' : ''} onerror="this.remove();">`).join('')}</div>
                    ${navHtml}
                    ${dotsHtml}
               </div>`;
}

// 좋아요/조회수 - "원글 보기" 링크와 같은 줄에 나란히 배치한다.
function newsPostStatsHtml(post) {
    const likeCnt = post.count && post.count.likeCnt;
    const readCnt = post.count && post.count.readCnt;
    if (!likeCnt && !readCnt) return '<div class="news-post-stats"></div>';
    const stat = (icon, n) => `<span class="news-post-stat">${icon}${escapeHTML(Number(n).toLocaleString('ko-KR'))}</span>`;
    return `<div class="news-post-stats">
                    ${likeCnt ? stat(HEART_ICON, likeCnt) : ''}
                    ${readCnt ? stat(EYE_ICON, readCnt) : ''}
               </div>`;
}

// 왼쪽 "최신 글" 큰 카드 - 사진 캐러셀, 본문 더보기 등을 포함한 news-post-card.
function renderFeaturedPostHtml(item) {
    const { member, post } = item;
    const title = post.titleName || '';
    const snippet = (post.content && post.content.textContent) || '';
    const fullHtml = (post.content && post.content.content) || '';
    if (fullHtml) NewsState.fullContent[String(post.titleNo)] = fullHtml;
    const category = (post.display && post.display.bbsName) || '';
    const timeText = formatRelativeTime(post.regDate);
    const soopId = member ? member['SOOP ID'] : post.userId;
    const name = member ? member['이름'] : (post.userNick || '');
    const postUrl = `https://www.sooplive.co.kr/station/${encodeURIComponent(soopId)}/post/${encodeURIComponent(post.titleNo)}`;

    return `
        <div class="news-post-card news-post-card-fade">
            <div class="news-post-header">
                ${avatarHtml(soopId, 'news-post-avatar')}
                <div>
                    <div class="news-post-name">${escapeHTML(name)}</div>
                    <div class="news-post-meta">${escapeHTML(category)}${category && timeText ? ' · ' : ''}${escapeHTML(timeText)}</div>
                </div>
            </div>
            ${title ? `<div class="news-post-title">${escapeHTML(title)}</div>` : ''}
            ${snippet ? `<div class="news-post-body news-post-body-clamp">${formatNewsContent(snippet)}</div><button type="button" class="news-post-more-btn" onclick="expandNewsPost(this, '${jsAttr(post.titleNo)}')">더보기 ${chevronDownSvg(9)}</button>` : ''}
            ${newsPhotosHtml(asArray(post.photos))}
            <div class="news-post-link-row">
                ${newsPostStatsHtml(post)}
                <a class="news-post-link" href="${postUrl}" target="_blank" rel="noopener">
                    원글 보기 <span class="ext-arrow">↗</span>
                </a>
            </div>
        </div>`;
}

// 오른쪽 "지난 글" 리스트 - 홈 "최근 공지"와 같은 카드를 쓰되, 클릭하면 원글로 나가지 않고
// 그 글을 왼쪽 최신 글 자리로 올린다.
function renderPastNoticeHtml(item) {
    const key = newsItemKey(item);
    return homeNoticeCardHtml(
        noticeCardFields(item.member, item.post),
        `setNewsFeatured('${jsAttr(key)}')`,
        { extraClass: 'news-past-item', dataAttr: `data-news-key="${escapeHTML(key)}"` }
    );
}

// =====================================================================
// 10. 방송통계 (시너지표: ststats 외부 데이터에서 우리 로스터만 추려서 표시)
// =====================================================================
const STSTATS_BASE = 'https://ststats.github.io/synergy';
const SynergyState = {
    data: null,          // [{ ...외부 필드, ourMember, active }]
    metric: 'balloons',
};

function formatSecondsToHM(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}시간 ${m}분`;
}
function formatCount(value, unit) {
    return (value || 0).toLocaleString('ko-KR') + unit;
}
function formatSponsorRecord(wins, losses) {
    wins = wins || 0;
    losses = losses || 0;
    const total = wins + losses;
    const rate = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
    return `${wins}승 ${losses}패 (${rate}%)`;
}

// 지표별 설정을 한 곳에 모았다: 탭 라벨 / URL에 노출되는 짧은 값 / 표시 형식 / 정렬 기준.
// (예전엔 라벨·URL 변환표 2개·표시 if문·정렬 if문이 4군데에 흩어져 있었다)
const SYNERGY_METRICS = {
    balloons: {
        label: '별풍선', url: 'balloons',
        format: m => formatCount(m.balloons, '개'),
    },
    broadcast_seconds: {
        label: '방송시간', url: 'hours',
        format: m => formatSecondsToHM(m.broadcast_seconds),
    },
    cumulative_viewers: {
        label: '누적시청자', url: 'viewers',
        format: m => formatCount(m.cumulative_viewers, '명'),
    },
    sponsor: {
        label: '스폰전적', url: 'sponsor',
        format: m => formatSponsorRecord(m.sponsor_wins, m.sponsor_losses),
        // 표시는 승패/승률이지만, 정렬은 판수(승+패)가 많은 순 - 승수 기준이 아니다.
        sortValue: m => (m.sponsor_wins || 0) + (m.sponsor_losses || 0),
    },
};
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
// URL의 view 값 -> 내부 지표 키. 모르는 값(또는 'constructor' 같은 프로토타입 이름)은 기본값.
function synergyMetricFromUrl(urlValue) {
    const found = Object.keys(SYNERGY_METRICS).find(key => SYNERGY_METRICS[key].url === urlValue);
    return found || 'balloons';
}
function synergyMetricConfig(metric) {
    return hasOwn(SYNERGY_METRICS, metric) ? SYNERGY_METRICS[metric] : null;
}

async function loadSynergyData() {
    try {
        const datesRes = await fetch(`${STSTATS_BASE}/data/dates.js`, { cache: 'no-store' });
        if (!datesRes.ok) throw new Error(`dates.js HTTP ${datesRes.status}`);
        const datesText = await datesRes.text();
        const match = datesText.match(/window\.AVAILABLE_DATES\s*=\s*(\[[^\]]*\])/);
        if (!match) throw new Error('날짜 목록 형식을 읽을 수 없습니다.');
        const dates = JSON.parse(match[1]);
        const latestDate = Array.isArray(dates) ? dates[0] : null;
        if (!latestDate) throw new Error('사용 가능한 날짜가 없습니다.');

        const dataRes = await fetch(`${STSTATS_BASE}/data/daily/${encodeURIComponent(latestDate)}.json`, { cache: 'no-store' });
        if (!dataRes.ok) throw new Error(`daily json HTTP ${dataRes.status}`);
        const data = await dataRes.json();

        // team 이름이 아니라 SOOP ID로 매칭한다 - 외부 쪽 team 표기가 우리 쪽 개편
        // (예: 캄몬스타즈 -> 스타대학)과 항상 동기화된다는 보장이 없기 때문.
        const idToMember = new Map();
        SiteData.members.forEach(m => {
            const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
            if (soopId) idToMember.set(soopId, m);
        });

        SynergyState.data = asArray(data && data.members)
            .map(m => {
                const ours = idToMember.get(String((m && m.id) || '').trim().toLowerCase());
                return ours ? { ...m, ourMember: ours, active: isActiveMember(ours) } : null;
            })
            .filter(Boolean);

        document.getElementById('synergy-updated').innerText = data && data.updated_at ? `업데이트: ${data.updated_at}` : '';
        renderSynergyTable();
    } catch (e) {
        console.error(e);
        const errRow = emptyRowHtml(3, '데이터를 불러오지 못했습니다.');
        document.getElementById('synergy-tbody-male').innerHTML = errRow;
        document.getElementById('synergy-tbody-female').innerHTML = errRow;
    }
}

function setSynergyMetric(metric) {
    SynergyState.metric = metric;
    const config = synergyMetricConfig(metric);
    staticAll('#synergy-metric-filter .sub-tab').forEach(el => {
        const on = el.dataset.metric === metric;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    staticAll('.synergy-metric-label').forEach(el => {
        el.innerText = config ? config.label : '';
    });
    renderSynergyTable();
    const urlValue = config ? config.url : metric;
    updateHash('stats', urlValue !== 'balloons' ? { view: urlValue } : {});
}

function synergyRowHtml(m, idx) {
    const ours = m.ourMember;
    const name = ours['이름'] || m.nickname;
    // 알 수 없는 지표면(직접 호출된 경우) 예전처럼 스폰전적 형식으로 표시
    const displayVal = (synergyMetricConfig(SynergyState.metric) || SYNERGY_METRICS.sponsor).format(m);

    return `
        <tr>
            <td class="text-center text-secondary fw-bold colw-20 text-nowrap">${idx + 1}</td>
            <td class="text-center colw-40">
                <span class="d-flex align-items-center justify-content-center gap-2 min-w-0">
                    ${avatarHtml(ours['SOOP ID'], 'player-avatar-sm')}
                    <span class="fw-bold ellipsis-text text-nowrap">${escapeHTML(name)}</span>
                </span>
            </td>
            <td class="text-center fw-bold colw-40 text-nowrap synergy-value">${escapeHTML(displayVal)}</td>
        </tr>`;
}

function sortSynergyRows(rows) {
    const metric = SynergyState.metric;
    const config = synergyMetricConfig(metric);
    const value = config && config.sortValue ? config.sortValue : (m => m[metric] || 0);
    return rows.slice().sort((a, b) => value(b) - value(a));
}

function renderSynergyTable() {
    if (!SynergyState.data) return;
    const active = SynergyState.data.filter(m => m.active);
    const noData = emptyRowHtml(3, '표시할 멤버가 없습니다.');
    [['synergy-tbody-male', '남자'], ['synergy-tbody-female', '여자']].forEach(([tbodyId, gender]) => {
        const rows = sortSynergyRows(active.filter(m => m.ourMember['성별'] === gender));
        document.getElementById(tbodyId).innerHTML = rows.length ? rows.map(synergyRowHtml).join('') : noData;
    });
}

// =====================================================================
// 11. 도구 (멀티뷰어 설정 / 외부 도구)
// =====================================================================
const TOOLS_TABS = { multiviewer: ['tab-tools-multiviewer', 'view-tools-multiviewer'], external: ['tab-tools-external', 'view-tools-external'] };

function updateToolsHash() {
    updateHash('tools', isTabActive('tab-tools-external') ? { view: 'external' } : {});
}

function switchToolsView(viewType, skipHashUpdate) {
    activateTabView(TOOLS_TABS, viewType);
    if (!skipHashUpdate) updateToolsHash();
}

// ----- 멀티뷰어 -----
// 우리 사이트는 "누구를 볼지 + 어떤 순서/열 개수로 볼지" 선택만 담당하고, 실제 영상 그리드/
// 다크모드/설정 열고닫기는 자체 제작한 새 창(multiview.html)에서 처리한다. 새 창을 열 때
// 현재 상태를 그대로 URL로 넘긴다. "선택 목록"에 관한 순수 로직(mvFocusEntryId/
// mvOrderItemHtml/mvResolveCustomInput)은 multiview.html과 공유하는 mv-shared.js에 있다.
// 이 페이지엔 그리드가 없어서 목록이 바뀔 때마다 통째로 다시 그리면 된다.
const MvState = {
    order: [],       // [{ soopId, name, isMember }] - 화면에 보여줄 순서 그대로
    cols: 2,
    dark: false,
    focus: true,
    focusId: null,   // 포커스 모드에서 크게 보여줄 대상(soopId) - 목록 순서와 무관하게 별도 지정
    liveMap: {},     // soopId -> live 여부. 최초 한 번만 조회해서 캐시(선택할 때마다 API를 다시 부르지 않음)
};
const MV_MIN_COLS = 1, MV_MAX_COLS = 4;

function mvSetFocusTarget(soopId) {
    MvState.focusId = soopId;
    mvRenderOrderRow();
}

function mvIndexOf(soopId) {
    return MvState.order.findIndex(e => e.soopId === soopId);
}

function mvChipHtml(m, isLive) {
    const soopId = m['SOOP ID'];
    const selected = mvIndexOf(soopId) !== -1;
    return `
        <div class="mv-chip${selected ? ' selected' : ''}" role="button" tabindex="0" aria-pressed="${selected}" onclick="mvToggleMember('${jsAttr(soopId)}', '${jsAttr(m['이름'])}')">
            ${avatarHtml(soopId, 'mv-chip-avatar')}
            ${isLive ? '<span class="mv-chip-live">LIVE</span>' : ''}
            <span class="mv-chip-name">${escapeHTML(m['이름'])}</span>
            <span class="mv-chip-check">✓</span>
        </div>`;
}

function mvRenderChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    const members = activeMembersWithSoopId();
    container.innerHTML = members.length
        ? members.map(m => mvChipHtml(m, !!MvState.liveMap[m['SOOP ID']])).join('')
        : `<div class="text-muted fs-body">선택 가능한 멤버가 없습니다.</div>`;
}

// 멤버 목록은 즉시 그려서 바로 선택할 수 있게 하고, 방송중 여부(LIVE 뱃지)는 비동기로
// 확인해 나중에 덧입힌다. (페이지 로드 시 한 번만 부른다 - 홈 "방송 중"과 같은 URL이라
// cachedFetchJson이 진행 중인 요청을 공유해서 실제 네트워크 요청은 한 번만 나간다.)
async function mvCheckLiveAndRerenderChips() {
    const members = activeMembersWithSoopId();
    if (members.length === 0) return;
    const settled = await Promise.allSettled(
        members.map(m => checkIsLiveRealtime(m['SOOP ID']).then(live => ({ soopId: m['SOOP ID'], live: !!live })))
    );
    MvState.liveMap = {};
    settled.forEach(r => { if (r.status === 'fulfilled') MvState.liveMap[r.value.soopId] = r.value.live; });
    mvRenderChips();
}

function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    if (!row) return;
    const { order, focus } = MvState;
    const focusEntryId = mvFocusEntryId(order, MvState.focusId);
    row.innerHTML = order.length
        ? order.map((entry, idx) => mvOrderItemHtml(entry, idx, order, focus, focusEntryId)).join('')
        : `<span class="mv-order-empty">위에서 멤버를 선택하거나 숲 아이디를 직접 추가해보세요.</span>`;
}

function mvUpdateActionbar() {
    const btn = document.getElementById('mv-open-btn');
    if (btn) btn.disabled = MvState.order.length === 0;
}

function mvRenderAll() {
    mvRenderChips();
    mvRenderOrderRow();
    mvUpdateActionbar();
}

function mvToggleMember(soopId, name) {
    const idx = mvIndexOf(soopId);
    if (idx !== -1) MvState.order.splice(idx, 1);
    else MvState.order.push({ soopId, name, isMember: true });
    mvRenderAll();
}

function mvAddCustom() {
    const input = document.getElementById('mv-custom-id');
    const result = mvResolveCustomInput(input.value, MvState.order, activeMembersWithSoopId());
    if (!result) return;
    if (result.error) { alert(result.error); return; }
    MvState.order.push(result.entry);
    input.value = '';
    mvRenderAll();
}

function mvMove(idx, dir) {
    const order = MvState.order;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    mvRenderAll();
}

function mvRemove(idx) {
    MvState.order.splice(idx, 1);
    mvRenderAll();
}

function mvChangeCols(delta) {
    MvState.cols = Math.min(MV_MAX_COLS, Math.max(MV_MIN_COLS, MvState.cols + delta));
    document.getElementById('mv-cols-value').innerText = MvState.cols;
}

function mvToggleDarkSetting() {
    const toggle = document.getElementById('mv-theme-toggle');
    MvState.dark = toggle.classList.toggle('on');
    toggle.setAttribute('aria-pressed', String(MvState.dark));
}

function mvSetFocusMode(isFocus) {
    MvState.focus = isFocus;
    const toggle = document.getElementById('mv-mode-toggle');
    if (toggle) {
        toggle.classList.toggle('on', !isFocus);
        toggle.setAttribute('aria-pressed', String(!isFocus));
    }
    // 포커스 모드에서는 열 개수가 인원 수 기준으로 자동 계산돼서 이 스테퍼가 안 쓰이므로,
    // 요소를 숨기지 않고 흐릿하게 비활성화만 한다(레이아웃이 덜컹거리지 않게).
    document.getElementById('mv-col-tile').classList.toggle('disabled', isFocus);
    // 모드를 막 바꿨을 때 목록에 포커스 지정 표시가 보이거나 안 보이게 다시 그린다.
    mvRenderOrderRow();
}
// 그리드 토글 스위치: 누를 때마다 현재 모드의 반대로 전환한다.
function mvToggleFocusMode() {
    mvSetFocusMode(!MvState.focus);
}

function openMultiviewer() {
    const { order, cols, dark, focus, focusId } = MvState;
    if (order.length === 0) return;
    const list = order.map(e => ({ id: e.soopId, name: e.name, isMember: e.isMember }));
    const params = new URLSearchParams({
        list: JSON.stringify(list),
        cols: String(cols),
        theme: dark ? 'dark' : 'light',
        focus: focus ? '1' : '0',
        focusId: focus ? (mvFocusEntryId(order, focusId) || '') : '',
    });
    window.open(`multiview.html?${params.toString()}`, '_blank', 'noopener');
}

// ----- 외부 도구 (docs/data/tools.json - 어드민 '도구' 탭에서 편집) -----
// javascript: 같은 스킴이 섞여 들어와도 클릭 시 실행되지 않도록 http(s) 링크만 허용한다.
function safeHttpUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '#';
}

function toolCardHtml(tool) {
    const url = (tool && tool.url) || '';
    let iconUrl;
    if (tool.favicon) {
        // tools.json에 favicon이 직접 지정돼 있으면(구글 캐시에 그 페이지가 없는 경우를 위한
        // 수동 지정) 구글을 거치지 않고 그 값을 그대로 쓴다.
        iconUrl = escapeHTML(tool.favicon);
    } else {
        // URL 안에 이미 퍼센트 인코딩된 문자가 있으면 encodeURIComponent가 '%'를 '%25'로 다시
        // 인코딩(이중 인코딩)해서 구글이 도메인을 못 알아본다. 한 번 풀었다가 다시 인코딩하면
        // 전부 한 번만 인코딩된 상태로 맞춰진다(인코딩 문자가 없는 링크는 결과가 그대로다).
        let normalizedUrl = url;
        try { normalizedUrl = decodeURIComponent(url); } catch (e) { /* 잘못된 인코딩이면 원본 사용 */ }
        iconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(normalizedUrl)}`;
    }
    return `
        <a class="tool-card" href="${escapeHTML(safeHttpUrl(url))}" target="_blank" rel="noopener">
            <span class="tool-card-ext">↗</span>
            <div class="tool-card-icon"><img loading="lazy" src="${iconUrl}" alt="" onerror="this.style.display='none';"></div>
            <div class="tool-card-name">${escapeHTML(tool.name)}</div>
        </a>`;
}

async function loadToolsData() {
    try {
        const res = await fetch('data/tools.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        ['extTools', 'extSites'].forEach(key => {
            const container = document.getElementById('tools-grid-' + key);
            if (!container) return;
            const items = asArray(data && data[key] && data[key].items);
            container.innerHTML = items.length
                ? items.map(toolCardHtml).join('')
                : `<div class="text-center text-muted py-3 fs-body grid-span-all">등록된 도구가 없습니다.</div>`;
        });
    } catch (e) {
        console.error('도구 목록을 불러오지 못했습니다:', e);
    }
}

// =====================================================================
// 12. 캘린더 훅 + 초기화
// =====================================================================

// 캘린더 "오늘의 일정"/"선택한 날짜 일정" 카드 아래에 그 날 휴방하는 멤버를 프로필 사진 +
// 이름 칩으로 보여준다. calendar.js는 멤버 정보를 모르기 때문에 이 훅으로 내용을 채워 넣는다.
// 휴방자가 없는 날은 섹션 자체가 안 보이게 빈 문자열을 반환한다.
window.calOffAirExtra = (dateStr, type) => {
    const soopIds = calOffAirForDate(dateStr);
    if (!soopIds.length) return '';
    const chips = soopIds.map(soopId => {
        const m = findMemberBySoopId(soopId);
        const name = m ? m['이름'] : soopId;
        return `<div class="cal-offair-chip">${avatarHtml(soopId, 'cal-offair-avatar')}<span class="cal-offair-name">${escapeHTML(name)}</span></div>`;
    }).join('');
    return `<div class="cal-offair-section"><div class="cal-offair-label">휴방</div><div class="cal-offair-chips">${chips}</div></div>`;
};

// 달력 칸 맨 위에 특정 멤버(김윤환)의 휴방을 노란 띠로 표시하기 위한 훅 -
// calendar.js는 soopId만 다루므로 soopId -> 이름 변환만 여기서 해준다.
window.calOffAirMemberName = (soopId) => {
    const m = findMemberBySoopId(soopId);
    return m ? m['이름'] : null;
};

// 모달이 닫히기 시작할 때 그 안에 포커스가 남아있으면 부트스트랩이 aria-hidden을 씌우면서
// 크롬 접근성 경고가 뜬다. 닫히기 직전에 포커스를 미리 빼주면 경고 자체가 안 뜬다.
staticAll('.modal').forEach(modalEl => {
    modalEl.addEventListener('hide.bs.modal', () => {
        if (modalEl.contains(document.activeElement)) document.activeElement.blur();
    });
});

async function initApp() {
    // 멤버/매치/라운드/개인통계를 먼저 불러온 뒤, 그걸 사용하는 초기화 로직들을 이어서 실행한다.
    await loadSiteData();

    safeInit('팀 요약 통계', calculateTeamSummaries);
    safeInit('멤버 페이지', renderMembersPage);
    safeInit('방송중 카드', renderLiveBroadcasts);
    safeInit('최근 공지', renderLatestNotices);
    safeInit('방송통계(시너지)', loadSynergyData);
    safeInit('도구 목록', loadToolsData);
    safeInit('멀티뷰어', () => { mvRenderAll(); return mvCheckLiveAndRerenderChips(); });

    // 새로고침해도 URL에 맞춰 페이지 + 하위 상태(선택된 멤버, 지표 등)까지 그대로 복원
    safeInit('URL 상태 복원', restoreFromHash);

    safeInit('일정표', () => {
        calSelectedDateStr = calTodayStr();
        return calLoadPublicData();
    });
}

// 예전엔 window.onload(이미지까지 전부 받은 뒤)에 시작했다. 이 스크립트는 body 맨 끝에서
// 동기로 실행되므로 DOM은 이미 준비돼 있다 - DOMContentLoaded에 바로 시작해서 팀 로고/프로필
// 사진 로딩을 기다리지 않고 데이터를 먼저 채운다. (window.onload 대입은 다른 스크립트가
// 덮어쓸 수 있어서 addEventListener로 바꿨다)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();
