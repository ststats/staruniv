/**
 * 도구 페이지: 멀티뷰어 설정(실행은 multiview.html 새 창) + 숲리캡 + 외부 도구 링크. (mv-shared.js → core.js → api.js → 이 파일)
 */

const TOOLS_TABS = {
    multiviewer: ['tab-tools-multiviewer', 'view-tools-multiviewer'],
    rider: ['tab-tools-rider', 'view-tools-rider'],
    webp: ['tab-tools-webp', 'view-tools-webp'],
    recap: ['tab-tools-recap', 'view-tools-recap'],
    external: ['tab-tools-external', 'view-tools-external'],
};
// 기본 탭은 주소에 안 남기고, 나머지는 ?view=<탭>으로 남긴다.
const TOOLS_DEFAULT_VIEW = 'multiviewer';
const TOOLS_VIEW_IDS = Object.keys(TOOLS_TABS);

function toolsViewFromUrl(value) {
    return TOOLS_VIEW_IDS.includes(value) ? value : TOOLS_DEFAULT_VIEW;
}

// 옛 주소 /tools/?view=entry는 티어표 페이지로 보낸다.
if (new URLSearchParams(location.search).get('view') === 'entry') {
    location.replace(new URL('../tier/?view=entry', location.href).href);
}

function currentToolsView() {
    return TOOLS_VIEW_IDS.find(isToolsTabActive) || TOOLS_DEFAULT_VIEW;
}

function isToolsTabActive(view) {
    return isTabActive(TOOLS_TABS[view][0]);
}

function updateToolsHash() {
    const view = currentToolsView();
    PageState.update(view === TOOLS_DEFAULT_VIEW ? {} : { view });
}

// ----- 캄몬라이더 -----
// 게임 파일이 약 260KB라 이 탭을 처음 열 때만 src를 채운다. data-src에는 빌드가 해시 붙은 주소를 넣는다.
function riderPageUrl() {
    const frame = document.getElementById('rider-frame');
    return (frame && frame.dataset.src) || 'calmmon-rider.html';
}

function riderEnsureLoaded() {
    const frame = document.getElementById('rider-frame');
    if (frame && !frame.getAttribute('src')) frame.src = riderPageUrl();
}

// ----- 다른 탭으로 갔을 때 게임 멈추기 -----
// 숨겨진 iframe도 계속 돌고, 게임 자체 일시정지는 브라우저 탭이 가려질 때만 걸린다.
// 같은 도메인이라 게임의 "일시 정지"·"소리" 버튼을 대신 누른다(버튼이 없으면 아무 일도 안 한다).
const riderPaused = { race: false, sound: false };

function riderDoc() {
    const frame = document.getElementById('rider-frame');
    if (!frame || !frame.getAttribute('src')) return null;
    try {
        return frame.contentDocument;
    } catch (e) {
        return null;
    }
}

function riderIsRunning(doc) {
    const btn = doc.getElementById('pause');
    return !!btn && !btn.hidden && btn.textContent.includes('일시 정지');
}
function riderSoundOn(doc) {
    const btn = doc.getElementById('soundToggle');
    return !!btn && btn.getAttribute('aria-pressed') === 'true';
}

// 무엇을 껐는지 기억해 두고, 돌아왔을 때 그것만 되돌린다(사용자가 꺼둔 소리는 켜지 않는다).
function riderSuspend() {
    const doc = riderDoc();
    if (!doc) return;
    riderPaused.race = riderIsRunning(doc);
    if (riderPaused.race) doc.getElementById('pause').click();
    riderPaused.sound = riderSoundOn(doc);
    if (riderPaused.sound) doc.getElementById('soundToggle').click();
}

function riderResume() {
    const doc = riderDoc();
    if (!doc) return;
    if (riderPaused.sound && !riderSoundOn(doc)) doc.getElementById('soundToggle').click();
    if (riderPaused.race && !riderIsRunning(doc)) {
        const btn = doc.getElementById('pause');
        if (btn && !btn.hidden) btn.click();
    }
    riderPaused.race = riderPaused.sound = false;
}

// iframe이 아니라 감싼 상자를 전체화면으로 해야 테두리/배경이 따라간다.
function riderFullscreen() {
    const stage = document.getElementById('rider-stage');
    if (!stage) return;
    if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
    }
    if (!stage.requestFullscreen) {
        // iOS 사파리처럼 요소 전체화면이 없으면 새 창으로 연다
        riderOpenWindow();
        return;
    }
    const result = stage.requestFullscreen();
    if (result && typeof result.catch === 'function') result.catch(() => riderOpenWindow());
}

function riderOpenWindow() {
    window.open(riderPageUrl(), '_blank', 'noopener');
}

// ----- 움짤생성기 -----
// 처음 열 때 src를 채우고, iframe 높이를 내용에 맞추고, 사이트 테마를 안쪽에 넘긴다.
function webpFrameDoc() {
    const frame = document.getElementById('webp-frame');
    try {
        return frame && frame.contentDocument;
    } catch (_) {
        return null;
    }
}

function webpFitHeight() {
    const frame = document.getElementById('webp-frame');
    const doc = webpFrameDoc();
    const main = doc && doc.querySelector('main');
    if (!frame || !main) return;
    // scrollHeight는 iframe 높이보다 작아지지 않으므로 main 끝과 열린 색 팔레트 끝 중 아래쪽에 맞춘다.
    let bottom = main.getBoundingClientRect().bottom;
    doc.querySelectorAll('.swatches.is-open').forEach(pop => {
        bottom = Math.max(bottom, pop.getBoundingClientRect().bottom + 8);
    });
    frame.style.height = Math.ceil(bottom + (doc.defaultView ? doc.defaultView.scrollY : 0)) + 'px';
}

function webpSyncTheme() {
    const doc = webpFrameDoc();
    if (doc && doc.documentElement)
        doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
}

function webpSyncVisibility() {
    const frame = document.getElementById('webp-frame');
    if (frame?.getAttribute('src'))
        frame.contentWindow?.postMessage(
            { type: 'webp-visibility', active: isToolsTabActive('webp') && !document.hidden },
            location.origin
        );
}
document.addEventListener('visibilitychange', webpSyncVisibility);

function webpEnsureLoaded() {
    const frame = document.getElementById('webp-frame');
    if (!frame || frame.getAttribute('src')) return;
    frame.addEventListener('load', () => {
        const doc = webpFrameDoc();
        if (!doc) return;
        webpSyncTheme();
        webpSyncVisibility();
        webpFitHeight();
        // 떠 있는 색 팔레트는 ResizeObserver에 안 잡혀서 입력 이벤트로도 다시 맞춘다
        if (typeof ResizeObserver === 'function') new ResizeObserver(webpFitHeight).observe(doc.body);
        ['click', 'input', 'change'].forEach(type =>
            doc.addEventListener(type, () => requestAnimationFrame(webpFitHeight))
        );
    });
    frame.src = frame.dataset.src || 'webp-maker.html';
}

if (typeof MutationObserver === 'function') {
    new MutationObserver(webpSyncTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
}

// ----- 숲리캡 -----
// SOOP 시청 통계 페이지에 붙여 넣은 코드가 시청 데이터를 주소 #recap=에 담아 이 탭으로 돌아온다.
// 데이터는 이 브라우저에서만 그리고, 다시 열어 볼 수 있게 마지막 한 번만 localStorage에 둔다.
const RECAP_STORE = 'recap:last';
const RECAP_TOP = 10;
const RecapState = { data: null, showAll: false };

// SOOP 통계 페이지 주소창에 붙여 넣는 한 줄: 사이트의 recap.js(templates/static)를 싣는다. 하는 일은 그 파일에 있다.
// append는 값을 돌려주지 않아 javascript: 주소가 화면을 바꾸지 않는다.
function recapSnippet() {
    const src = new URL('recap.js', document.baseURI).href;
    return `document.head.append(Object.assign(document.createElement("script"),{src:${JSON.stringify(src)}}))`;
}

async function recapCopySnippet() {
    const btn = document.getElementById('recap-copy');
    try {
        await navigator.clipboard.writeText(recapSnippet());
        if (btn) btn.textContent = '복사했어요';
    } catch (e) {
        // 복사가 막힌 브라우저는 코드를 선택해 두어 직접 복사하게 한다
        const code = document.getElementById('recap-snippet');
        if (code) window.getSelection().selectAllChildren(code);
        if (btn) btn.textContent = '선택됨';
    }
    setTimeout(() => btn && (btn.textContent = '복사'), 2000);
}

// 주소로 들어온 글이라 모양을 검사하고 길이를 자른다.
function recapParse(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return null;
    }
    if (!raw || raw.v !== 1 || !Number.isFinite(raw.s) || !Array.isArray(raw.b)) return null;
    const rows = raw.b
        .slice(0, 300)
        .filter(r => Array.isArray(r) && typeof r[0] === 'string' && Array.isArray(r[1]))
        .map(([nick, days, id]) => ({
            nick: nick.slice(0, 40),
            days: days.slice(0, 62).map(v => Math.max(0, Number(v) || 0)),
            id: typeof id === 'string' && /^[0-9a-z_]{2,30}$/i.test(id) ? id.toLowerCase() : '',
        }));
    return rows.length ? { start: raw.s, rows } : null;
}

function recapInit() {
    const snippet = document.getElementById('recap-snippet');
    if (snippet) snippet.textContent = recapSnippet();
    const m = location.hash.match(/^#recap=(.+)$/);
    if (m) {
        let text = '';
        try {
            text = decodeURIComponent(m[1]);
        } catch (e) {
            text = '';
        }
        // 시청 기록이 주소·방문 기록에 남지 않게 지운다
        history.replaceState(null, '', location.pathname + location.search);
        const data = recapParse(text);
        if (data) {
            RecapState.data = data;
            try {
                localStorage.setItem(RECAP_STORE, text);
            } catch (e) {
                // 저장이 막혀도 이번 화면은 그린다
            }
            return;
        }
    }
    try {
        RecapState.data = recapParse(localStorage.getItem(RECAP_STORE) || '');
    } catch (e) {
        RecapState.data = null;
    }
}

function recapClear() {
    try {
        localStorage.removeItem(RECAP_STORE);
    } catch (e) {
        // 지울 것이 없다
    }
    RecapState.data = null;
    recapRender();
}

function recapToggleAll() {
    RecapState.showAll = !RecapState.showAll;
    recapRender();
}

// SOOP 아이디가 같으면 그 멤버(재입단은 활동 중인 기록). 아이디가 없으면(검색 실패·예전 코드)
// 방송 닉네임에 멤버 이름이 들어 있는지로 본다(긴 이름 우선, 같은 이름이면 활동 중인 기록).
function recapMember(nick, id) {
    if (id) {
        const same = SiteData.members.filter(m => String(m['SOOP ID'] || '').toLowerCase() === id);
        return same.find(isActiveMember) || same[0] || null;
    }
    const key = nick.replace(/[^0-9A-Za-z가-힣]/g, '');
    let best = null;
    for (const m of SiteData.members) {
        const name = String(m['이름'] || '');
        if (name.length < 2 || !key.includes(name)) continue;
        const better =
            !best ||
            name.length > best['이름'].length ||
            (name === best['이름'] && isActiveMember(m) && !isActiveMember(best));
        if (better) best = m;
    }
    return best;
}

function recapTime(sec) {
    const total = Math.round(sec / 60);
    const h = Math.floor(total / 60);
    return h ? `${h}시간 ${total % 60}분` : `${total}분`;
}

function recapBigTime(sec) {
    const total = Math.round(sec / 60);
    const h = Math.floor(total / 60);
    return h ? `${h}<small>시간</small> ${total % 60}<small>분</small>` : `${total}<small>분</small>`;
}

// 통계는 한국 시간 하루 단위라 시작 시각에 9시간을 더해 날짜를 읽는다
function recapDay(start, i) {
    const d = new Date(start + 9 * 3600e3 + i * 864e5);
    return { m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function recapAvatar(row, cls) {
    const soopId = row.member ? row.member['SOOP ID'] : row.id;
    if (soopId) return avatarHtml(soopId, cls);
    const ch = row.nick.replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 1) || '?';
    return `<span class="${cls} recap-letter">${escapeHTML(ch)}</span>`;
}

// 멤버면 이름 옆에 종족 뱃지
function recapRaceBadge(row) {
    return row.member && row.member['종족'] ? raceBadgeHtml(row.member['종족']) : '';
}

// 화면과 저장 이미지가 같이 쓰는 숫자. 본 방송이 없으면 null
function recapSummary(data) {
    const all = data.rows.map(r => ({ ...r, total: r.days.reduce((a, b) => a + b, 0) }));
    const rows = all
        .filter(r => r.nick !== '기타' && r.total > 0)
        .map(r => ({ ...r, member: recapMember(r.nick, r.id) }))
        .sort((a, b) => b.total - a.total);
    const total = all.reduce((a, r) => a + r.total, 0);
    if (!rows.length || !total) return null;
    const len = Math.max(...all.map(r => r.days.length));
    const kammon = rows.filter(r => r.member);
    const kammonTotal = kammon.reduce((a, r) => a + r.total, 0);
    return {
        rows,
        total,
        len,
        first: recapDay(data.start, 0),
        last: recapDay(data.start, len - 1),
        top: rows[0],
        kammon,
        kammonTotal,
        share: (kammonTotal / total) * 100,
    };
}

function recapRender() {
    const box = document.getElementById('recap-result');
    if (!box) return;
    const data = RecapState.data;
    if (!data) {
        box.innerHTML = '';
        return;
    }
    const sum = recapSummary(data);
    if (!sum) {
        box.innerHTML = '<div class="content-state is-boxed">이 기간에는 시청 기록이 없습니다</div>';
        return;
    }
    const { rows, total, len, first, last, top, kammon, kammonTotal, share } = sum;
    const pct = sec => `${((sec / total) * 100).toFixed(1)}%`;
    const circle = 2 * Math.PI * 52;

    const hero = `<div class="section-title has-actions" data-en="SOOP RECAP"><span class="section-title-label">나의 숲리캡</span>
        <button type="button" class="text-action"${act('recapSaveImage')}>이미지 저장 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></button></div>
    <div class="recap-hero">
        <div class="recap-hero-main">
            <div class="recap-period">${first.m}월 ${first.d}일 – ${last.m}월 ${last.d}일</div>
            <div class="recap-hero-sub">${len}일 동안 이렇게 봤어요</div>
        </div>
        <div class="recap-hero-stats">
            <div><span>총 시청</span><b>${recapTime(total)}</b></div>
            <div><span>하루 평균</span><b>${recapTime(total / len)}</b></div>
            <div><span>본 방송</span><b>${rows.length}명</b></div>
        </div>
    </div>`;

    const cards = `<div class="recap-cards">
        <div class="clean-card recap-card recap-best">
            <div class="recap-card-label">가장 많이 본 방송</div>
            <div class="recap-best-body">${recapAvatar(top, 'recap-best-av')}
                <div class="recap-best-info">
                    <div class="recap-best-name"><span>${escapeHTML(top.nick)}</span>${recapRaceBadge(top)}</div>
                    <div class="recap-big">${recapBigTime(top.total)}</div>
                    <div class="recap-sub">전체 시청의 ${Math.round((top.total / total) * 100)}% · ${len}일 중 ${top.days.filter(Boolean).length}일</div>
                </div>
            </div>
            <div class="recap-bar recap-best-bar"><i style="width:${((top.total / total) * 100).toFixed(1)}%"></i></div>
        </div>
        <div class="clean-card recap-card recap-share">
            <div class="recap-card-label">캄몬 지분</div>
            <div class="recap-donut">
                <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="recap-donut-track"/><circle cx="60" cy="60" r="52" class="recap-donut-value" stroke-dasharray="${((circle * share) / 100).toFixed(1)} ${circle.toFixed(1)}"/></svg>
                <div class="recap-donut-text"><b>${Math.round(share)}<small>%</small></b><span>캄몬스타즈</span></div>
            </div>
            <div class="recap-sub">${kammon.length ? `멤버 ${kammon.length}명 · ${recapTime(kammonTotal)}` : '본 멤버 방송이 없습니다'}</div>
        </div>
    </div>`;

    const shown = RecapState.showAll ? rows : rows.slice(0, RECAP_TOP);
    const rank = shown
        .map(
            (r, i) => `<li class="recap-row${r.member ? ' is-kammon' : ''}">
            <span class="recap-rank">${i + 1}</span>${recapAvatar(r, 'recap-av')}
            <div class="recap-row-main">
                <div class="recap-row-head"><span class="recap-nick">${escapeHTML(r.nick)}</span>${recapRaceBadge(r)}</div>
                <div class="recap-bar"><i style="width:${Math.max(1.5, (r.total / top.total) * 100).toFixed(1)}%"></i></div>
            </div>
            <span class="recap-time">${recapTime(r.total)}<em>${pct(r.total)}</em></span>
        </li>`
        )
        .join('');
    const more =
        rows.length > RECAP_TOP
            ? `<button type="button" class="news-load-more recap-more" aria-expanded="${RecapState.showAll}"${act('recapToggleAll')}>${RecapState.showAll ? '접기' : `나머지 ${rows.length - RECAP_TOP}명 더 보기`}</button>`
            : '';

    const members = kammon.length
        ? `<div class="section-title" data-en="CALMMON STARS"><span class="section-title-label">내가 본 캄몬 멤버</span><span class="title-count">${kammon.length}명</span></div>
        <div class="clean-card recap-members">${kammon
            .map(
                r => `<div class="recap-member${isActiveMember(r.member) ? '' : ' is-former'}">${recapAvatar(r, 'recap-member-av')}
                <div class="recap-member-name">${escapeHTML(r.member['이름'])}</div><div class="recap-member-time">${recapTime(r.total)}</div></div>`
            )
            .join('')}</div>`
        : '';

    box.innerHTML = `${hero}${cards}
    <div class="g2 recap-cols">
        <div>
            <div class="section-title" data-en="RANKING"><span class="section-title-label">시청 순위</span><span class="title-count">${rows.length}명</span></div>
            <ol class="clean-card recap-list">${rank}</ol>${more}
        </div>
        <div>${members}</div>
    </div>
    <p class="recap-note">이 기록은 이 브라우저에만 있습니다 · <button type="button" class="text-action"${act('recapClear')}>지우기</button></p>`;
}

// 공유용 세로 이미지(1080px 폭). 사진은 CORS가 막히면 이니셜 원으로 그린다(엔트리 포스터와 같은 부품).
const RECAP_IMAGE_TOP = 5;
async function recapSaveImage() {
    const sum = RecapState.data && recapSummary(RecapState.data);
    if (!sum) return;
    const { rows, total, len, first, last, top, kammon, kammonTotal, share } = sum;
    const list = rows.slice(0, RECAP_IMAGE_TOP);
    const soopId = r => (r.member ? r.member['SOOP ID'] : r.id);
    const imgs = await Promise.all(list.map(r => posterLoadImage(soopId(r) ? getProfileImgUrl(soopId(r)) : null)));
    const pal = posterPalette();
    const font = (weight, size) => `${weight} ${size}px Pretendard, sans-serif`;

    const W = 1080,
        PAD = 72,
        HEAD = 330,
        CARD = 340,
        ROW = 116;
    const LIST_TOP = HEAD + CARD + 40;
    const H = LIST_TOP + 70 + list.length * ROW + 120;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    // 네이비 머리: 기간과 총 시청·하루 평균·본 방송
    ctx.fillStyle = pal.navy;
    ctx.fillRect(0, 0, W, HEAD);
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.navyMuted;
    ctx.font = font(800, 24);
    ctx.fillText('SOOP RECAP', PAD, 92);
    ctx.fillStyle = '#fff';
    ctx.font = font(800, 60);
    ctx.fillText(`${first.m}월 ${first.d}일 – ${last.m}월 ${last.d}일`, PAD, 170);
    const stats = [
        ['총 시청', recapTime(total)],
        ['하루 평균', recapTime(total / len)],
        ['본 방송', `${rows.length}명`],
    ];
    const boxW = (W - PAD * 2 - 32) / 3;
    stats.forEach(([label, value], i) => {
        const x = PAD + i * (boxW + 16);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(x, 210, boxW, 84);
        ctx.fillStyle = pal.navyMuted;
        ctx.font = font(700, 20);
        ctx.fillText(label, x + 22, 242);
        ctx.fillStyle = '#fff';
        ctx.font = font(800, 30);
        ctx.fillText(value, x + 22, 280);
    });

    // 가장 많이 본 방송 · 캄몬 지분
    const cy = HEAD + 44;
    ctx.fillStyle = pal.sub;
    ctx.font = font(700, 22);
    ctx.fillText('가장 많이 본 방송', PAD, cy + 10);
    posterDrawAvatar(ctx, imgs[0], recapLetterName(top), PAD, cy + 40, 170);
    const tx = PAD + 200;
    ctx.fillStyle = pal.text;
    ctx.font = font(800, 40);
    ctx.fillText(recapFit(ctx, top.nick, 360), tx, cy + 90);
    let bx = tx;
    if (top.member) {
        const former = !isActiveMember(top.member);
        bx +=
            posterDrawBadge(
                ctx,
                former ? '이전 멤버' : '캄몬스타즈',
                bx,
                cy + 108,
                32,
                former ? pal.sub : pal.kammon,
                '#fff'
            ) + 8;
        posterDrawRaceBadge(ctx, raceCode(top.member['종족']), bx, cy + 108, 32);
    }
    ctx.fillStyle = pal.kammon;
    ctx.font = font(800, 52);
    ctx.fillText(recapTime(top.total), tx, cy + 200);
    ctx.fillStyle = pal.sub;
    ctx.font = font(600, 22);
    ctx.fillText(
        `전체의 ${Math.round((top.total / total) * 100)}% · ${top.days.filter(Boolean).length}/${len}일`,
        tx,
        cy + 238
    );

    const dx = W - PAD - 110;
    const dy = cy + 140;
    ctx.lineWidth = 26;
    ctx.strokeStyle = pal.stripe;
    ctx.beginPath();
    ctx.arc(dx, dy, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = pal.kammon;
    ctx.beginPath();
    ctx.arc(dx, dy, 96, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * share) / 100);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = pal.text;
    ctx.font = font(800, 48);
    ctx.fillText(`${Math.round(share)}%`, dx, dy + 8);
    ctx.fillStyle = pal.sub;
    ctx.font = font(700, 20);
    ctx.fillText('캄몬 지분', dx, dy + 40);
    ctx.font = font(600, 20);
    ctx.fillText(kammon.length ? `멤버 ${kammon.length}명 · ${recapTime(kammonTotal)}` : '본 멤버 없음', dx, dy + 140);

    // 시청 순위 TOP 5
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.line;
    ctx.fillRect(PAD, LIST_TOP - 20, W - PAD * 2, 2);
    ctx.fillStyle = pal.text;
    ctx.font = font(800, 30);
    ctx.fillText(`시청 순위 TOP ${list.length}`, PAD, LIST_TOP + 30);
    list.forEach((r, i) => {
        const y = LIST_TOP + 70 + i * ROW;
        ctx.textAlign = 'center';
        ctx.fillStyle = i < 3 ? pal.kammon : pal.faint;
        ctx.font = font(800, 30);
        ctx.fillText(String(i + 1), PAD + 16, y + 52);
        posterDrawAvatar(ctx, imgs[i], recapLetterName(r), PAD + 52, y + 8, 76);
        ctx.textAlign = 'left';
        const nx = PAD + 150;
        ctx.fillStyle = pal.text;
        ctx.font = font(700, 28);
        const nick = recapFit(ctx, r.nick, 420);
        ctx.fillText(nick, nx, y + 40);
        if (r.member)
            posterDrawRaceBadge(ctx, raceCode(r.member['종족']), nx + ctx.measureText(nick).width + 12, y + 16, 28);
        const barW = W - PAD - nx - 200;
        ctx.fillStyle = pal.stripe;
        ctx.fillRect(nx, y + 62, barW, 10);
        ctx.fillStyle = r.member ? pal.kammon : pal.empty;
        ctx.fillRect(nx, y + 62, Math.max(6, (barW * r.total) / top.total), 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = pal.text;
        ctx.font = font(800, 28);
        ctx.fillText(recapTime(r.total), W - PAD, y + 44);
        ctx.fillStyle = pal.faint;
        ctx.font = font(600, 20);
        ctx.fillText(`${((r.total / total) * 100).toFixed(1)}%`, W - PAD, y + 74);
    });

    ctx.fillStyle = pal.foot;
    ctx.fillRect(0, H - 90, W, 90);
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.sub;
    ctx.font = font(700, 22);
    ctx.fillText('스타대학 · 숲리캡', PAD, H - 38);
    ctx.textAlign = 'right';
    ctx.fillText(new URL('.', document.baseURI).host, W - PAD, H - 38);

    let blob = null;
    try {
        blob = await new Promise(resolve => cv.toBlob(resolve, 'image/png'));
    } catch (e) {
        blob = null;
    }
    if (!blob) {
        alert('이미지를 만들지 못했습니다. 프로필 사진을 불러올 수 없는 환경일 수 있습니다');
        return;
    }
    // 문서에 붙여서 눌러야 브라우저가 파일 이름(download)을 따른다
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `숲리캡_${first.m}${String(first.d).padStart(2, '0')}-${last.m}${String(last.d).padStart(2, '0')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 이니셜 원에 쓸 이름: 멤버면 멤버 이름, 아니면 방송 닉네임
function recapLetterName(row) {
    return row.member ? row.member['이름'] : row.nick.replace(/[^0-9A-Za-z가-힣]/g, '');
}

// 폭을 넘는 글은 뒤를 줄인다
function recapFit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
}

function switchToolsView(viewType, skipHashUpdate) {
    const wasRider = isToolsTabActive('rider');
    activateTabView(TOOLS_TABS, viewType);
    if (viewType === 'rider') {
        riderEnsureLoaded();
        if (!wasRider) riderResume();
    } else if (wasRider) {
        riderSuspend();
    }
    if (viewType === 'webp') webpEnsureLoaded();
    webpSyncVisibility();
    if (viewType === 'recap') recapRender();
    if (viewType === 'external' && !toolsExternalLoaded) {
        toolsExternalLoaded = true;
        safeInit('도구 목록', loadToolsData);
    }
    if (!skipHashUpdate) updateToolsHash();
}

// ----- 멀티뷰어 -----
// 이 탭은 선택만 하고, 그리드는 새 창(multiview.html)이 URL로 상태를 받아 그린다.
const MvState = {
    order: [], // [{ soopId, name, isMember }]
    cols: MV_AUTO_COLS, // 자동: 새 창이 화면·인원 수로 고른다
    dark: false,
    focus: true,
    focusId: null, // 포커스 모드에서 크게 볼 soopId(목록 순서와 무관)
    liveMap: {}, // soopId(소문자) -> 방송 중
};

function mvSetFocusTarget(soopId) {
    MvState.focusId = soopId;
    mvRenderOrderRow();
}

function mvIndexOf(soopId) {
    return MvState.order.findIndex(e => e.soopId === soopId);
}

function mvRenderChips() {
    const container = document.getElementById('mv-chip-row');
    if (!container) return;
    if (typeof SiteDataLoad !== 'undefined' && SiteDataLoad.errors.has('members')) {
        container.innerHTML = emptyStateHtml('멤버 정보를 불러오지 못했습니다');
        container.setAttribute('aria-busy', 'false');
        return;
    }
    const members = activeMembersWithSoopId();
    container.innerHTML = members.length
        ? members
              .map(m =>
                  mvChipHtml(m, mvIndexOf(mvSoopKey(m['SOOP ID'])) !== -1, !!MvState.liveMap[mvSoopKey(m['SOOP ID'])])
              )
              .join('')
        : emptyStateHtml('선택 가능한 멤버가 없습니다');
    container.setAttribute('aria-busy', 'false');
}

// 멤버는 바로 그리고, LIVE 뱃지는 방송 중 ID 조회 후 덧입힌다.
async function mvCheckLiveAndRerenderChips() {
    if (activeMembersWithSoopId().length === 0) return;
    try {
        const live = await fetchLiveIds();
        MvState.liveMap = Object.fromEntries(Object.keys(live).map(id => [id, true]));
    } catch (e) {
        return; // 실패하면 직전 표시를 유지한다.
    }
    mvRenderChips();
}

function mvRenderOrderRow() {
    const row = document.getElementById('mv-order-row');
    if (!row) return;
    const { order, focus } = MvState;
    const focusEntryId = mvFocusEntryId(order, MvState.focusId);
    const count = document.getElementById('mv-order-count');
    if (count) count.textContent = `${order.length}명`;
    row.innerHTML = order.length
        ? order.map((entry, idx) => mvOrderItemHtml(entry, idx, order, focus, focusEntryId)).join('')
        : `<div class="content-state">선택된 방송이 없습니다</div>`;
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
    if (result.error) {
        alert(result.error);
        return;
    }
    MvState.order.push(result.entry);
    input.value = '';
    mvRenderAll();
}

function mvMove(idx, dir) {
    if (mvMoveEntry(MvState.order, idx, dir)) mvRenderAll();
}

function mvRemove(idx) {
    MvState.order.splice(idx, 1);
    mvRenderAll();
}

function mvChangeCols(delta) {
    // 자동에서 움직이면 이 모니터를 꽉 채웠을 때의 자동 열 수에서 출발한다.
    const base = mvAutoGridCols(Math.max(1, MvState.order.length), screen.availWidth, screen.availHeight);
    MvState.cols = mvStepCols(MvState.cols, delta, base);
    document.getElementById('mv-cols-value').innerText = mvColsLabel(MvState.cols);
}

function mvToggleDarkSetting() {
    const toggle = document.getElementById('mv-theme-toggle');
    MvState.dark = toggle.classList.toggle('active');
    toggle.setAttribute('aria-pressed', String(MvState.dark));
}

function mvSetFocusMode(isFocus) {
    MvState.focus = isFocus;
    const toggle = document.getElementById('mv-mode-toggle');
    if (toggle) {
        toggle.classList.toggle('active', !isFocus);
        toggle.setAttribute('aria-pressed', String(!isFocus));
    }
    // 포커스 모드에선 쓰이지 않지만 레이아웃이 흔들리지 않게 숨기지 않고 비활성화만 한다.
    document.getElementById('mv-col-tile').classList.toggle('disabled', isFocus);
    mvRenderOrderRow();
}

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
        focusId: focus ? mvFocusEntryId(order, focusId) || '' : '',
    });
    window.open(`multiview.html?${params.toString()}`, '_blank', 'noopener');
}

// ----- 외부 도구 (Supabase external_tools) -----
// http(s)만 허용하고, 아니면 href를 아예 달지 않는다('#'은 <base> 때문에 홈 링크가 된다).
function safeHttpUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
}

function toolCardHtml(tool) {
    const url = (tool && tool.url) || '';
    let iconUrl;
    if (tool.favicon) {
        // 구글 캐시에 없는 페이지용 수동 지정
        iconUrl = escapeHTML(tool.favicon);
    } else {
        // 이미 인코딩된 문자가 다시 인코딩(%25)되면 구글이 도메인을 못 알아봐서 한 번 풀고 인코딩한다.
        let normalizedUrl = url;
        try {
            normalizedUrl = decodeURIComponent(url);
        } catch (e) {}
        iconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(normalizedUrl)}`;
    }
    let host = '';
    try {
        host = new URL(safeHttpUrl(url)).hostname.replace(/^www\./, '');
    } catch (e) {}
    return `
        <a class="tool-card" data-tool-id="${escapeHTML(tool.id || '')}" data-tool-category="${escapeHTML(tool.category || '')}"${safeHttpUrl(url) ? ` href="${escapeHTML(safeHttpUrl(url))}"` : ''} target="_blank" rel="noopener">
            <div class="tool-card-media">
                <div class="tool-card-icon"><img loading="lazy" src="${iconUrl}" alt=""${actOn('error', 'imgHide', ACT.el)}></div>
            </div>
            <div class="tool-card-body">
                <div class="tool-card-name">${escapeHTML(tool.name)}</div>
                ${host ? `<div class="tool-card-host">${escapeHTML(host)}</div>` : ''}
            </div>
            ${typeof window.toolCardAdminExtra === 'function' ? window.toolCardAdminExtra(tool) : ''}
        </a>`;
}

function renderExternalTools(data) {
    ['extTools', 'extSites'].forEach(key => {
        const container = document.getElementById('tools-grid-' + key);
        if (!container) return;
        const items = asArray(data && data[key] && data[key].items);
        container.innerHTML = items.length
            ? items.map(toolCardHtml).join('')
            : `<div class="text-center text-muted py-3 fs-body grid-span-all">등록된 도구가 없습니다</div>`;
    });
}

let toolsExternalLoaded = false;
async function loadToolsData() {
    try {
        const data = await Api.tools();
        const grouped = { extTools: { items: [] }, extSites: { items: [] } };
        asArray(data).forEach(row => {
            if (!grouped[row.category]) return;
            grouped[row.category].items.push({
                id: row.id,
                category: row.category,
                name: row.name,
                url: row.url,
                favicon: row.favicon || '',
            });
        });
        renderExternalTools(grouped);
    } catch (e) {
        console.error('도구 목록을 불러오지 못했습니다:', e);
        renderExternalTools({});
    }
}

bootPage(
    () => {
        safeInit('숲리캡', recapInit);
        safeInit('멀티뷰어', () => {
            mvRenderAll();
            return mvCheckLiveAndRerenderChips();
        });
        safeInit('URL 상태 복원', () =>
            PageState.bindRestore(params => {
                switchToolsView(
                    toolsViewFromUrl(params.get('view') || runtimeDefaultSubtab('tools', TOOLS_DEFAULT_VIEW)),
                    true
                );
            })
        );
    },
    {
        prefetch: () => fetchLiveIds().catch(() => {}),
        view: params =>
            activateTabView(
                TOOLS_TABS,
                toolsViewFromUrl(params.get('view') || runtimeDefaultSubtab('tools', TOOLS_DEFAULT_VIEW))
            ),
    }
);
