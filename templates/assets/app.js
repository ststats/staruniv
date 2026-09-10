
    let currentPlayer = ''; 
    let currentIndivFilter = '전체';

    // 구글시트 원본 텍스트를 innerHTML에 꽂을 때 깨지거나 마크업이 섞이지 않도록 이스케이프
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    }

    // 승/패/무 결과 뱃지 HTML - 팀/개인 최근전적 리스트가 둘 다 이 로직을 그대로 썼던 걸 공용화
    function resultBadgeHtml(resText) {
        if (resText === '승') return '<span class="match-badge badge-win">WIN</span>';
        if (resText === '무' || resText === '무승부') return '<span class="match-badge badge-draw">DRAW</span>';
        return '<span class="match-badge badge-lose">LOSE</span>';
    }
    const EMPTY_MATCH_ROW_HTML = '<tr><td colspan="6" class="text-center text-muted py-4">경기 기록이 없습니다.</td></tr>';

    // onclick="fn('${value}')"처럼 JS 문자열 리터럴 안에 값을 꽂을 때 백슬래시/따옴표를
    // 이스케이프한다. 멤버 이름에 특수문자가 섞여도 마크업이 깨지거나 엉뚱한 스크립트가
    // 실행되지 않도록 인라인 핸들러에 값을 넣는 곳은 항상 이 함수를 거친다.
    function jsStrEscape(str) {
        return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // 로딩중/데이터없음 등 안내 문구를 보여주는 <div> - 여러 화면(공지, 방송중, 소식 피드)이
    // 문구만 다르고 동일한 마크업을 반복해서 쓰던 것을 공용화
    function emptyStateHtml(text, extraClass) {
        return `<div class="text-center text-muted py-4${extraClass ? ' ' + extraClass : ''}" style="font-size:var(--fs-body);">${text}</div>`;
    }
    // 표 형태(tbody) 안에서 쓰는 안내 문구 <tr> - synergy 표 등에서 재사용
    function emptyRowHtml(colspan, text) {
        return `<tr><td colspan="${colspan}" class="text-center text-muted py-4">${text}</td></tr>`;
    }

    // 공지 카드의 다중 사진 스와이프 - 스크롤 위치를 보고 현재 몇 번째 사진인지
    // 계산해서 스토리바 인디케이터의 active 표시와 좌/우 화살표의 표시 여부를 갱신한다.
    // (첫 장에선 이전 화살표를, 마지막 장에선 다음 화살표를 숨긴다)
    // 공지 사진 갤러리 가로 스크롤 시 인디케이터/화살표 갱신 - 모바일에서 스와이프하면
    // onscroll이 프레임당 여러 번 발생해 매번 나눗셈 연산이 도는 걸 막기 위해,
    // requestAnimationFrame으로 한 프레임당 한 번만 실행되도록 스로틀링한다.
    const newsPhotoDotsScheduled = new WeakSet();
    function updateNewsPhotoDots(scroller) {
        if (newsPhotoDotsScheduled.has(scroller)) return; // 이미 이번 프레임에 예약됨
        newsPhotoDotsScheduled.add(scroller);
        requestAnimationFrame(() => {
            newsPhotoDotsScheduled.delete(scroller);
            const wrap = scroller.parentElement;
            if (!wrap || !wrap.classList.contains('news-post-photos-wrap')) return;
            const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
            const total = scroller.children.length;

            const dotsWrap = wrap.querySelector('.news-post-photos-dots');
            if (dotsWrap) dotsWrap.querySelectorAll('.photo-dot').forEach((d, i) => d.classList.toggle('active', i === idx));

            const prevBtn = wrap.querySelector('.news-photo-nav-prev');
            const nextBtn = wrap.querySelector('.news-photo-nav-next');
            if (prevBtn) prevBtn.classList.toggle('is-hidden', idx <= 0);
            if (nextBtn) nextBtn.classList.toggle('is-hidden', idx >= total - 1);
        });
    }

    // 화살표 클릭 시 사진 한 장 폭만큼 부드럽게 스크롤 이동 (좌: -1, 우: 1)
    function scrollNewsPhotos(btn, dir) {
        const scroller = btn.closest('.news-post-photos-wrap').querySelector('.news-post-photos');
        scroller.scrollBy({ left: dir * scroller.clientWidth, behavior: 'smooth' });
    }

    // 상대팀 로고: docs/images/{팀이름}.webp 로 관리. '내전'(자체 스크림)은
    // 상대가 우리 팀 자신이므로 캄몬스타즈.webp를 대신 쓴다. 로고 파일이
    // 없는 팀은 (임시로) 원형 배지에 팀 이름 첫 글자를 넣어 대신 보여준다.
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
        return `<img src="images/${encodeURIComponent(fileName)}.webp" alt="${escapeHTML(name)}" class="team-logo-icon" loading="lazy" style="width:${size}px;height:${size}px;" onerror="teamLogoFallback(this, '${jsStrEscape(name)}')">`;
    }

    const VALID_PAGE_IDS = ['home', 'schedule', 'members', 'records', 'stats', 'tools'];

    // ===== 해시 라우터: #페이지?파라미터=값 형태로 하위 상태까지 URL에 반영 =====
    function parseHash() {
        // 실제 경로(/page?params)를 표준 URL 형태로 쓴다. GitHub Pages에서도
        // 동작하도록 docs/404.html + 위 부트스트랩 스크립트로 경로를 복원한다
        // (rafgraph/spa-github-pages 패턴).
        //
        // Vercel처럼 루트(/records)에 배포되든, GitHub Pages 프로젝트 페이지처럼
        // 서브경로(/staruniv/records)에 배포되든 둘 다 지원해야 하므로, pathname을
        // 세그먼트로 쪼개서 VALID_PAGE_IDS와 실제로 일치하는 세그먼트를 찾는다
        // (앞에 저장소 이름 같은 서브경로가 몇 겹 있든 상관없이 항상 정확하다).
        const segments = location.pathname.split('/').filter(Boolean);
        const pageSeg = segments.find(s => VALID_PAGE_IDS.includes(s));
        return { page: pageSeg || 'home', params: new URLSearchParams(location.search) };
    }

    function getBasePath() {
        // 현재 URL에서 "알려진 페이지 이름" 세그먼트 앞부분(GitHub Pages라면
        // 저장소 이름 등)을 그대로 유지하기 위해 계산한다. Vercel 루트 배포라면
        // 빈 문자열이 나온다.
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
        if (location.pathname + location.search !== newUrl) {
            history.pushState({ page, params }, '', newUrl);
        }
    }

    function switchPage(pageId, skipHashUpdate) {
        document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('#mainMenu .nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById('page-' + pageId).classList.add('active');

        const targetNav = document.querySelector(`#mainMenu .nav-item[data-page="${pageId}"]`);
        if (targetNav) targetNav.classList.add('active');

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
            currentPlayer = '';
            currentIndivFilter = '전체';
            switchStatView('team');
        } else if (pageId === 'members') {
            currentNewsPlayer = null;
            switchMemberView('status');
        } else if (pageId === 'stats') {
            setSynergyMetric('balloons');
        } else if (pageId === 'tools') {
            switchToolsView('multiviewer');
        }
    }

    // 뒤로가기/앞으로가기 및 새로고침 시 해시에 맞춰 페이지 + 하위 상태를 복원
    function restoreFromHash() {
        const { page, params } = parseHash();
        const pageId = VALID_PAGE_IDS.includes(page) ? page : 'home';
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
            const view = params.get('view');
            const metric = SYNERGY_METRIC_FROM_URL[view] || 'balloons';
            setSynergyMetric(metric);
        } else if (pageId === 'tools') {
            const view = params.get('view') === 'external' ? 'external' : 'multiviewer';
            switchToolsView(view, true);
        }
    }

    window.addEventListener('popstate', restoreFromHash);

    function updateStatsHash() {
        const view = document.getElementById('tab-individual').classList.contains('active') ? 'individual' : 'team';
        const params = {};
        if (view === 'individual') {
            params.view = 'solo';
            if (currentPlayer) params.member = currentPlayer;
        }
        updateHash('records', params);
    }

    function switchStatView(viewType) {
        document.getElementById('tab-team').classList.toggle('active', viewType === 'team');
        document.getElementById('tab-individual').classList.toggle('active', viewType === 'individual');

        if(viewType === 'team') {
            document.getElementById('view-team-stat').style.display = 'block';
            document.getElementById('view-indiv-stat').style.display = 'none';
        } else {
            document.getElementById('view-team-stat').style.display = 'none';
            document.getElementById('view-indiv-stat').style.display = 'block';
            renderIndividualSidebar();
            showIndivSummary(); 
        }
        updateStatsHash();
    }

    function updateMembersHash() {
        const view = document.getElementById('tab-member-news').classList.contains('active') ? 'news' : 'status';
        const params = {};
        if (view === 'news') {
            params.view = 'news';
            if (currentNewsPlayer) params.member = currentNewsPlayer['이름'];
        }
        updateHash('members', params);
    }

    function switchMemberView(viewType, skipHashUpdate) {
        document.getElementById('tab-member-status').classList.toggle('active', viewType === 'status');
        document.getElementById('tab-member-news').classList.toggle('active', viewType === 'news');
        document.getElementById('view-member-status').style.display = viewType === 'status' ? 'block' : 'none';
        document.getElementById('view-member-news').style.display = viewType === 'news' ? 'block' : 'none';
        if (viewType === 'news' && !newsSidebarRendered) {
            renderNewsSidebar();
            newsSidebarRendered = true;
            showNewsAll(true);
        }
        if (!skipHashUpdate) updateMembersHash();
    }

    function updateToolsHash() {
        const view = document.getElementById('tab-tools-external').classList.contains('active') ? 'external' : 'multiviewer';
        const params = {};
        if (view === 'external') params.view = 'external';
        updateHash('tools', params);
    }

    function switchToolsView(viewType, skipHashUpdate) {
        document.getElementById('tab-tools-multiviewer').classList.toggle('active', viewType === 'multiviewer');
        document.getElementById('tab-tools-external').classList.toggle('active', viewType === 'external');
        document.getElementById('view-tools-multiviewer').style.display = viewType === 'multiviewer' ? 'block' : 'none';
        document.getElementById('view-tools-external').style.display = viewType === 'external' ? 'block' : 'none';
        if (!skipHashUpdate) updateToolsHash();
    }

    // ===== 도구 - 멀티뷰어 =====
    // 우리 사이트는 "누구를 볼지 + 어떤 순서/열 개수로 볼지" 선택만 담당하고,
    // 실제 영상 그리드/다크모드/설정 열고닫기는 자체 제작한 새 창(multiview.html)에서
    // 처리한다. 선택 상태(mvOrder)는 도구 탭과 새 창 둘 다에서 똑같이 조정 가능하도록
    // 새 창을 열 때 현재 상태를 그대로 URL로 넘긴다.
    let mvOrder = [];   // [{ soopId, name, isMember }] - 화면에 보여줄 순서 그대로
    let mvCols = 2;
    let mvDark = false;
    let mvFocus = false;

    function mvIndexOf(soopId) {
        return mvOrder.findIndex(e => e.soopId === soopId);
    }

    function mvChipHtml(m) {
        const soopId = m['SOOP ID'];
        const selected = mvIndexOf(soopId) !== -1;
        return `
        <div class="mv-chip${selected ? ' selected' : ''}" onclick="mvToggleMember('${jsStrEscape(soopId)}', '${jsStrEscape(m['이름'])}')">
            ${avatarHtml(soopId, 'mv-chip-avatar')}
            <span class="mv-chip-name">${escapeHTML(m['이름'])}</span>
            <span class="mv-chip-check">✓</span>
        </div>`;
    }

    function mvRenderChips() {
        const container = document.getElementById('mv-chip-row');
        if (!container) return;
        const members = activeMembersWithSoopId();
        container.innerHTML = members.length
            ? members.map(mvChipHtml).join('')
            : `<div class="text-muted" style="font-size:var(--fs-body);">선택 가능한 멤버가 없습니다.</div>`;
    }

    function mvOrderItemHtml(entry, idx) {
        return `
        <div class="mv-order-item${entry.isMember ? '' : ' custom'}">
            <button type="button" title="위로" onclick="mvMove(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" title="아래로" onclick="mvMove(${idx}, 1)" ${idx === mvOrder.length - 1 ? 'disabled' : ''}>▼</button>
            <span class="mv-order-name">${escapeHTML(entry.name)}</span>
            <button type="button" class="mv-order-remove" title="빼기" onclick="mvRemoveFromOrder(${idx})">✕</button>
        </div>`;
    }

    function mvRenderOrderRow() {
        const row = document.getElementById('mv-order-row');
        if (!row) return;
        row.innerHTML = mvOrder.length
            ? mvOrder.map(mvOrderItemHtml).join('')
            : `<span class="mv-order-empty">위에서 멤버를 선택하거나 숲 아이디를 직접 추가해보세요.</span>`;
    }

    function mvUpdateActionbar() {
        const count = mvOrder.length;
        document.getElementById('mv-actionbar-count').innerText = count > 0 ? `${count}명 선택됨` : '선택된 대상이 없습니다.';
        document.getElementById('mv-open-btn').disabled = count === 0;
    }

    function mvRenderAll() {
        mvRenderChips();
        mvRenderOrderRow();
        mvUpdateActionbar();
    }

    function mvToggleMember(soopId, name) {
        const idx = mvIndexOf(soopId);
        if (idx !== -1) mvOrder.splice(idx, 1);
        else mvOrder.push({ soopId, name, isMember: true });
        mvRenderAll();
    }

    function mvAddCustom() {
        const input = document.getElementById('mv-custom-id');
        const id = input.value.trim().toLowerCase();
        if (!id) return;
        if (!/^[a-z0-9_-]+$/.test(id)) { alert('숲(SOOP) 아이디 형식이 아닙니다 (영문/숫자/-/_ 만 가능).'); return; }
        if (mvIndexOf(id) !== -1) { alert('이미 선택된 목록에 있습니다.'); return; }
        // 우리 멤버의 아이디를 그대로 입력한 경우, 익명 항목이 아니라 실제 이름으로 추가한다.
        const knownMember = activeMembersWithSoopId().find(m => m['SOOP ID'] === id);
        mvOrder.push(knownMember ? { soopId: id, name: knownMember['이름'], isMember: true } : { soopId: id, name: id, isMember: false });
        input.value = '';
        mvRenderAll();
    }

    function mvMove(idx, dir) {
        const target = idx + dir;
        if (target < 0 || target >= mvOrder.length) return;
        [mvOrder[idx], mvOrder[target]] = [mvOrder[target], mvOrder[idx]];
        mvRenderAll();
    }

    function mvRemoveFromOrder(idx) {
        mvOrder.splice(idx, 1);
        mvRenderAll();
    }

    function mvChangeCols(delta) {
        mvCols = Math.min(4, Math.max(1, mvCols + delta));
        document.getElementById('mv-cols-value').innerText = mvCols;
    }

    function mvToggleDarkSetting() {
        mvDark = document.getElementById('mv-dark-toggle').checked;
    }

    function mvToggleFocusSetting() {
        mvFocus = document.getElementById('mv-focus-toggle').checked;
        // 포커스 모드에서는 열 개수가 인원 수 기준으로 자동 계산돼서 이 스테퍼가
        // 안 쓰이므로, 헷갈리지 않게 그리드 모드일 때만 보여준다.
        document.getElementById('mv-cols-group').style.display = mvFocus ? 'none' : 'flex';
    }

    function openMultiviewer() {
        if (mvOrder.length === 0) return;
        const list = mvOrder.map(e => ({ id: e.soopId, name: e.name, isMember: e.isMember }));
        const params = new URLSearchParams({
            list: JSON.stringify(list),
            cols: String(mvCols),
            theme: mvDark ? 'dark' : 'light',
            focus: mvFocus ? '1' : '0',
        });
        window.open(`multiview.html?${params.toString()}`, '_blank', 'noopener');
    }

    // 홈 화면 "전체 보기"/공지 클릭 -> 멤버 페이지의 소식 탭으로 이동.
    // name이 있으면(홈 공지 클릭) 원글로 나가지 않고 그 멤버의 개인 공지 탭으로 바로 이동한다.
    // 탭 전환 -> 전체글 표시 -> 멤버 선택까지 한 번의 클릭으로 이어지는데, 단계마다
    // 히스토리를 따로 쌓으면 뒤로가기를 여러 번 눌러야 빠져나가지므로, 여기서
    // 한 번만 히스토리에 반영한다.
    function goToNewsFeed(name) {
        switchPage('members', true);
        switchMemberView('news', true);
        if (name) selectNewsPlayer(name, true);
        updateMembersHash();
    }

    // ===== 멤버 소식(SOOP 게시판 전체 글) =====
    let newsSidebarRendered = false;
    let currentNewsPlayer = null;
    let newsCurrentPage = 1;
    let newsTotalPages = 1;
    let newsLoading = false;

    // "전체 공지"/"멤버별 공지" 두 화면 다 이 하나의 상태로 통일해서 그린다.
    // newsItems: 지금 화면에 로드되어 있는 { member, post } 목록
    // newsMode: 'all'(전체 공지) | 'member'(특정 멤버) - 더보기 눌렀을 때 어느 쪽 API를 더 부를지 결정
    // newsFeaturedKey: 왼쪽 "최신 글" 자리에 올려둔 글의 식별자 - 리스트에서 글을 클릭하면 이 값만 바뀐다.
    let newsItems = [];
    let newsMode = 'all';
    let newsFeaturedKey = null;
    let newsHasMore = false;

    function renderNewsSidebar() {
        const html = [`<div class="avatar-select-item avatar-select-all active" id="news-side-btn-all" onclick="showNewsAll()">
                            <img src="images/캄몬스타즈.webp" alt="전체" class="avatar-select-img" onerror="this.outerHTML='&lt;div class=&quot;avatar-select-fallback&quot;&gt;전체&lt;/div&gt;';">
                            <span class="avatar-select-name">전체</span>
                       </div>`];
        activeMembersWithSoopId().forEach(m => {
            const soopId = m['SOOP ID'];
            html.push(`<div class="avatar-select-item" id="news-side-player-${m['이름']}" onclick="selectNewsPlayer('${jsStrEscape(m['이름'])}')">
                            ${avatarHtml(soopId, 'avatar-select-img')}
                            <span class="avatar-select-name">${escapeHTML(m['이름'])}</span>
                        </div>`);
        });
        document.getElementById('news-avatar-list').innerHTML = html.join('');
    }

    let allNewsPool = [];
    let allNewsShownCount = 0;
    // "전체 공지"에서 멤버별로 다음에 가져올 페이지 번호와 총 페이지 수를 기억해둔다.
    // Map<soopId, { nextPage, totalPages }> - 더보기를 눌렀을 때 풀에 남은 게 부족하면
    // 여기 기록을 보고 아직 페이지가 남은 멤버들의 다음 페이지를 추가로 가져온다.
    let allNewsMemberState = new Map();

    async function showNewsAll(skipHashUpdate) {
        document.querySelectorAll('#news-avatar-list .avatar-select-item').forEach(el => el.classList.remove('active'));
        document.getElementById('news-side-btn-all').classList.add('active');
        document.getElementById('news-content-title').innerText = '전체 공지';
        currentNewsPlayer = null;
        if (!skipHashUpdate) updateMembersHash();

        const content = document.getElementById('news-feed-content');
        content.innerHTML = emptyStateHtml('불러오는 중...');

        const activeMembers = activeMembersWithSoopId();
        allNewsMemberState = new Map();

        // 멤버별로 최근 몇 개씩 후보를 모아서(공지+일반글 합친 것) 전체를 한 번에
        // 날짜순으로 다시 정렬 - "더보기"로 계속 더 볼 수 있게 넉넉히 모아둔다.
        //
        // 주의: fetchMemberFeed(mergeOwnPosts)는 perPage=10짜리 일반글(contents)에
        // 공지(noticeData)를 추가로 합치기 때문에, 공지가 있으면 10개보다 많이
        // 돌아올 수 있다 - 여기서 다시 10개로 잘라버리면 공지든 일반글이든 넘치는
        // 만큼 조용히 누락된다. 그래서 자르지 않고 페이지 1에서 받은 걸 전부 담는다.
        const settled = await Promise.allSettled(
            activeMembers.map(async m => {
                const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], 1);
                allNewsMemberState.set(m['SOOP ID'], { nextPage: 2, totalPages });
                return posts.map(post => ({ member: m, post }));
            })
        );

        allNewsPool = settled
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .sort((a, b) => new Date(b.post.regDate) - new Date(a.post.regDate));

        newsMode = 'all';
        newsFeaturedKey = null; // 새로 들어왔으니 제일 최신 글을 다시 왼쪽에 올린다
        allNewsShownCount = allNewsPool.length; // 이미 멤버별로 가져온 건 처음부터 다 보여준다
        newsItems = allNewsPool.slice(0, allNewsShownCount);
        newsHasMore = allNewsShownCount < allNewsPool.length || newsAnyMemberHasMorePages();
        renderNewsLayout(content);
    }

    // 아직 다음 페이지가 남아있는 멤버가 한 명이라도 있는지
    function newsAnyMemberHasMorePages() {
        for (const st of allNewsMemberState.values()) {
            if (st.nextPage <= st.totalPages) return true;
        }
        return false;
    }

    // { member, post } 하나를 고유하게 식별하는 키 - 리스트 클릭으로 "최신 글" 자리를
    // 바꾸거나, 정렬 후 지금 어떤 글이 최신 글 자리에 있는지 다시 찾을 때 쓴다.
    function newsItemKey(item) {
        const soopId = item.member ? item.member['SOOP ID'] : item.post.userId;
        return soopId + '_' + item.post.titleNo;
    }

    // 리스트에서 글을 클릭했을 때 - 그 글을 왼쪽 "최신 글" 자리로 올린다.
    // (배열 순서나 날짜는 전혀 안 건드리고, 어떤 글을 최신 글 자리에 그릴지 나타내는
    // 값만 바꾼 뒤 다시 그린다 - 그래서 오른쪽 리스트는 항상 날짜순이 유지된다)
    //
    // 모바일에서는 스크롤을 건드리지 않는다(별도 보정 없음) - 그냥 다시 그려질 뿐이다.
    // PC에서는 클릭한 글이 완전히 다른 위치(왼쪽 큰 카드)로 옮겨가므로 페이지
    // 전체 스크롤은 그대로 두고, 다시 그리면서 초기화되는 오른쪽 리스트
    // (#news-past-list)의 내부 스크롤 위치만 그대로 복원한다.
    function setNewsFeatured(key) {
        const content = document.getElementById('news-feed-content');
        const isMobile = content.classList.contains('news-feed-mobile');

        if (isMobile) {
            newsFeaturedKey = key;
            renderNewsLayout(content);
        } else {
            const listEl = document.getElementById('news-past-list');
            const savedScrollTop = listEl ? listEl.scrollTop : 0;

            newsFeaturedKey = key;
            renderNewsLayout(content);

            const newListEl = document.getElementById('news-past-list');
            if (newListEl) newListEl.scrollTop = savedScrollTop;
        }
    }

    // "전체 공지"/"멤버별 공지" 공용 렌더러. newsItems를 항상 날짜순으로 다시 정렬해서
    // 그 중 newsFeaturedKey에 해당하는 글은 왼쪽 큰 카드로, 나머지는 오른쪽 리스트로 그린다.
    // 모바일에서는 화면이 좁아서 "왼쪽 큰 글 + 오른쪽 리스트"를 그냥 위아래로 쌓으면
    // 큰 글이 항상 맨 위에 고정돼버려서, 리스트에서 글을 눌러도 화면 위로 스크롤해야
    // 그 글이 커진 게 보인다. 그래서 모바일에서는 아예 다른 방식으로 그린다:
    // 날짜순 리스트 하나만 있고, 지금 선택된 글만 "그 자리에서" 큰 카드로 확대되고
    // 원래 커져 있던 글은 원래 있던 자리(날짜순 위치)로 다시 작아진다.
    // 고정된 픽셀 값(예: 700px)으로 모바일 전환 기준을 잡으면, 실제로 두 컬럼이
    // 옆으로 나란히 들어갈 수 있는지와 무관한 임의의 숫자가 된다. 대신 CSS에서
    // 두 컬럼에 준 min-width(.featured-post 300px + .past-posts 300px) + gap(28px)을
    // 그대로 기준으로 삼아서, "오른쪽 리스트가 폭이 부족해 아래로 떨어지려는 바로 그
    // 순간"에 정확히 모바일(단일 리스트) 모드로 전환되게 한다.
    const NEWS_TWO_COL_MIN_WIDTH = 300 + 28 + 300; // .featured-post min-width + gap + .past-posts min-width
    function isNewsMobileLayout() {
        const content = document.getElementById('news-feed-content');
        if (!content) return false;
        return content.clientWidth < NEWS_TWO_COL_MIN_WIDTH;
    }

    // 오늘/어제/이번 주/이번 달/이전 - 리스트가 길어질수록 그냥 쭉 나열하는 것보다
    // 이렇게 구간을 나눠주면 메신저 리스트처럼 스캔하기 쉬워진다.
    function newsDateGroupLabel(dateStr) {
        const d = new Date(String(dateStr).replace(' ', 'T'));
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

    // 이미 날짜순으로 정렬된 items를 렌더링하면서, 그룹(위 라벨)이 바뀌는 지점마다
    // 구분 라벨을 끼워 넣는다. renderItemFn은 항목 하나를 어떻게 그릴지(최신 글 큰
    // 카드로 그릴지, 지난 글 리스트 항목으로 그릴지)를 호출부에서 결정해서 넘겨준다.
    function renderNewsItemsWithDateGroups(items, renderItemFn) {
        let lastGroup = null;
        return items.map(item => {
            const group = newsDateGroupLabel(item.post.regDate);
            const groupHtml = group !== lastGroup ? `<div class="news-date-group-label">${group}</div>` : '';
            lastGroup = group;
            return groupHtml + renderItemFn(item);
        }).join('');
    }

    function renderNewsLayout(content) {
        if (newsItems.length === 0) {
            content.classList.remove('news-feed-mobile');
            content.innerHTML = emptyStateHtml('작성된 글이 없습니다.');
            return;
        }

        const sorted = [...newsItems].sort((a, b) => new Date(b.post.regDate) - new Date(a.post.regDate));
        if (!newsFeaturedKey || !sorted.some(it => newsItemKey(it) === newsFeaturedKey)) {
            newsFeaturedKey = newsItemKey(sorted[0]); // 기본값: 가장 최신 글
        }

        const loadMoreHtml = newsHasMore
            ? `<div class="news-load-more-wrap" id="news-load-more-wrap"><button class="news-load-more" onclick="loadMoreNewsFeed()">더 보기 <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button></div>`
            : '';

        if (isNewsMobileLayout()) {
            content.classList.add('news-feed-mobile');
            // 날짜순 그대로 하나의 리스트로 그리되, 선택된 글만 큰 카드로 바꿔서 그 자리에
            // 끼워 넣는다. 날짜 그룹 라벨도 큰 카드/지난 글 구분 없이 전체 흐름 기준으로 붙인다.
            const itemsHtml = renderNewsItemsWithDateGroups(sorted, item => newsItemKey(item) === newsFeaturedKey
                ? `<div class="featured-post" data-news-key="${escapeHTML(newsItemKey(item))}">${renderFeaturedPostHtml(item)}</div>`
                : renderPastNoticeHtml(item)
            );
            content.innerHTML = itemsHtml + loadMoreHtml;
        } else {
            content.classList.remove('news-feed-mobile');
            const featuredItem = sorted.find(it => newsItemKey(it) === newsFeaturedKey);
            const restItems = sorted.filter(it => newsItemKey(it) !== newsFeaturedKey);
            const pastListHtml = restItems.length
                ? renderNewsItemsWithDateGroups(restItems, renderPastNoticeHtml)
                : emptyStateHtml('지난 글이 없습니다.');
            content.innerHTML = `
                <div class="featured-post" data-news-key="${escapeHTML(newsItemKey(featuredItem))}">${renderFeaturedPostHtml(featuredItem)}</div>
                <div class="past-posts">
                    <div id="news-past-list">${pastListHtml}</div>
                    ${loadMoreHtml}
                </div>`;
        }
        checkNewsClampButtons(content);
    }

    // 더보기: 지금 화면이 "전체 공지"면 이미 모아둔 allNewsPool에서 더 꺼내 보여주고,
    // 특정 멤버면 그 멤버의 다음 페이지를 서버에 추가로 요청한다.
    // 창 크기를 조절하다 모바일 기준선을 넘나들면(회전, 브라우저 창 크기 조절 등)
    // 레이아웃 방식 자체가 바뀌어야 하므로 다시 그려준다. 리사이즈 이벤트가
    // 프레임마다 여러 번 발생할 수 있어 requestAnimationFrame으로 한 번만 처리한다.
    let newsResizeScheduled = false;
    window.addEventListener('resize', () => {
        if (newsItems.length === 0 || newsResizeScheduled) return;
        newsResizeScheduled = true;
        requestAnimationFrame(() => {
            newsResizeScheduled = false;
            const content = document.getElementById('news-feed-content');
            if (!content) return;
            const wasMobile = content.classList.contains('news-feed-mobile');
            if (wasMobile !== isNewsMobileLayout()) renderNewsLayout(content);
        });
    });

    async function loadMoreNewsFeed() {
        if (newsLoading) return;
        newsLoading = true;
        // 리스트를 다시 그리면 #news-past-list가 새로 만들어지면서 스크롤이 0으로
        // 초기화되니, 더보기로 항목이 추가된 뒤에도 보던 위치 그대로 있도록 저장해둔다.
        const listElBefore = document.getElementById('news-past-list');
        const savedScrollTop = listElBefore ? listElBefore.scrollTop : 0;
        try {
            if (newsMode === 'all') {
                const remainingInPool = allNewsPool.length - allNewsShownCount;
                if (remainingInPool < 10 && newsAnyMemberHasMorePages()) {
                    // 풀에 남은 게 한 페이지어치(10개)도 안 되면, 아직 다음 페이지가
                    // 남아있는 멤버들의 다음 페이지를 마저 받아와서 풀을 채운다.
                    const membersToFetch = activeMembersWithSoopId().filter(m => {
                        const st = allNewsMemberState.get(m['SOOP ID']);
                        return st && st.nextPage <= st.totalPages;
                    });
                    const settled = await Promise.allSettled(
                        membersToFetch.map(async m => {
                            const st = allNewsMemberState.get(m['SOOP ID']);
                            const { posts, totalPages } = await fetchMemberFeed(m['SOOP ID'], st.nextPage);
                            st.totalPages = totalPages;
                            st.nextPage += 1;
                            return posts.map(post => ({ member: m, post }));
                        })
                    );
                    const fetched = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
                    // 공지가 페이지마다 같이 딸려올 수 있어, 이미 풀에 있는 글(titleNo 기준)은
                    // 다시 추가하지 않는다.
                    const existingKeys = new Set(allNewsPool.map(newsItemKey));
                    const uniqueFetched = fetched.filter(item => !existingKeys.has(newsItemKey(item)));
                    allNewsPool = allNewsPool
                        .concat(uniqueFetched)
                        .sort((a, b) => new Date(b.post.regDate) - new Date(a.post.regDate));
                }
                allNewsShownCount = Math.min(allNewsShownCount + 10, allNewsPool.length);
                newsItems = allNewsPool.slice(0, allNewsShownCount);
                newsHasMore = allNewsShownCount < allNewsPool.length || newsAnyMemberHasMorePages();
            } else if (newsMode === 'member' && currentNewsPlayer) {
                newsCurrentPage += 1;
                const { posts, totalPages } = await fetchMemberFeed(currentNewsPlayer['SOOP ID'], newsCurrentPage);
                newsTotalPages = totalPages;
                // 공지(noticeData)는 게시판 API 특성상 페이지가 넘어가도 고정으로
                // 같이 딸려오는 경우가 있어, titleNo가 이미 있는 글은 다시 추가하지
                // 않는다 (안 그러면 "더보기"를 누를 때마다 같은 공지가 중복으로 쌓임).
                const existingKeys = new Set(newsItems.map(newsItemKey));
                const newOnes = posts
                    .map(post => ({ member: currentNewsPlayer, post }))
                    .filter(item => !existingKeys.has(newsItemKey(item)));
                newsItems = newsItems.concat(newOnes);
                newsHasMore = newsCurrentPage < newsTotalPages;
            }
            renderNewsLayout(document.getElementById('news-feed-content'));
            const listElAfter = document.getElementById('news-past-list');
            if (listElAfter) listElAfter.scrollTop = savedScrollTop;
        } finally {
            newsLoading = false;
        }
    }

    function selectNewsPlayer(name, skipHashUpdate) {
        document.querySelectorAll('#news-avatar-list .avatar-select-item').forEach(el => el.classList.remove('active'));
        const sideItem = document.getElementById(`news-side-player-${name}`);
        if (sideItem) sideItem.classList.add('active');
        document.getElementById('news-content-title').innerText = `${name}의 공지`;

        const m = dbMembers.find(x => x['이름'] === name);
        if (!m) return;
        currentNewsPlayer = m;
        newsCurrentPage = 1;
        newsTotalPages = 1;
        if (!skipHashUpdate) updateMembersHash();

        document.getElementById('news-feed-content').innerHTML = emptyStateHtml('불러오는 중...');
        loadNewsFeed();
    }

    // SOOP 게시판 API의 regDate("YYYY-MM-DD HH:MM:SS")를 "N분 전" 식으로 변환
    function formatRelativeTime(dateStr) {
        const date = new Date(String(dateStr || '').replace(' ', 'T'));
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

    // 게시판 응답의 contents(일반글)와 noticeData(공지)를 합쳐서, 본인이 쓴 글만
    // 남기고 최신순으로 정렬한다. (같은 글이 양쪽에 겹치는 경우는 titleNo로 중복 제거)
    function mergeOwnPosts(data, soopId) {
        const isOwn = p => String(p.userId || '').toLowerCase() === String(soopId).toLowerCase();
        const merged = [...(data.contents || []).filter(isOwn), ...(data.noticeData || []).filter(isOwn)];
        const seen = new Set();
        const unique = merged.filter(p => {
            if (seen.has(p.titleNo)) return false;
            seen.add(p.titleNo);
            return true;
        });
        unique.sort((a, b) => new Date(b.regDate) - new Date(a.regDate));
        return unique;
    }

    // 홈/소식 화면 열 때마다 멤버 30명씩 SOOP API를 다시 호출하면 사용자가 몰릴 때
    // 브라우저 쪽에서 API 호출 빈도 제한(Rate Limit)에 걸릴 수 있어, 세션 안에서는
    // 짧은 시간 내 같은 요청을 재사용하도록 sessionStorage에 살짝 캐싱해둔다.
    async function cachedFetchJson(url, ttlMs) {
        const cacheKey = `apicache:${url}`;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const { data, ts } = JSON.parse(cached);
                if (Date.now() - ts < ttlMs) return data;
            }
        } catch (e) { /* 캐시 읽기 실패는 무시하고 그냥 새로 받아온다 */ }

        const res = await fetch(url);
        if (!res.ok) throw new Error('요청 실패: ' + res.status);
        const data = await res.json();
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
        } catch (e) { /* 저장 공간이 꽉 찼거나 해도 캐싱은 선택사항이니 무시 */ }
        return data;
    }

    async function fetchMemberFeed(soopId, page) {
        try {
            const url = `https://api-channel.sooplive.com/v1.1/channel/${encodeURIComponent(soopId)}/board?perPage=10&page=${page}`;
            const data = await cachedFetchJson(url, 120000); // 2분
            return {
                posts: mergeOwnPosts(data, soopId),
                totalPages: (data.meta && data.meta.totalPages) || 1,
            };
        } catch (e) {
            return { posts: [], totalPages: 1 };
        }
    }

    // 게시판 API의 textContent는 순수 텍스트가 아니라 줄바꿈이 <br> 태그로 남아있는 형태라,
    // 그대로 escapeHTML하면 화면에 "<br />" 글자가 그대로 보인다. <br> 계열만 실제 줄바꿈으로
    // 바꾸고 나머지는 이스케이프해서 news-post-body(white-space: pre-wrap)에 안전하게 꽂는다.
    function formatNewsContent(text) {
        if (!text) return '';
        return escapeHTML(String(text).replace(/<br\s*\/?>/gi, '\n'));
    }

    // 목록 API 응답의 content.content(원본 HTML) 필드는 이미 전체 내용을 담고 있고,
    // textContent/summary만 항상 어느 정도 길이로 잘린 미리보기다 (실측으로 확인함).
    // 그래서 "더보기"를 위해 상세 API를 따로 부를 필요가 없다 - 카드를 그릴 때 이미
    // 받아온 전체 HTML을 titleNo로 기억해뒀다가, 클릭하면 그 자리에서 바로 꺼내 쓴다.
    const newsFullContentMap = {};

    // 게시글 원본 HTML을 그대로 꽂기 전에 script/iframe 등 위험한 태그와 on* 이벤트
    // 속성, javascript: 링크만 제거한다. 정렬/색상 같은 일반 서식은 원문 그대로 유지.
    // 사진(figure/img)은 카드 하단의 사진 갤러리(post.photos)가 이미 따로 보여주므로,
    // 본문에도 그대로 두면 같은 사진이 두 번(본문+갤러리) 나온다 - 본문에서는 제거한다.
    function sanitizeNewsHtml(html) {
        if (!html) return '';
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, figure, img').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const n = attr.name.toLowerCase();
                const v = attr.value || '';
                if (n.startsWith('on') || ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(v))) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        // 사진을 지우고 남은, 원래부터 비어있던 문단(<p></p>, <p>&nbsp;</p>, <p><br></p>)은
        // 빈 줄만 차지하니 같이 정리한다.
        doc.querySelectorAll('p').forEach(p => {
            const onlyBr = p.children.length === 1 && p.children[0].tagName === 'BR';
            if (!p.textContent.trim() && (p.children.length === 0 || onlyBr)) p.remove();
        });
        return doc.body.innerHTML;
    }

    // 렌더링 직후 "더보기"가 필요한지 판단한다. 두 가지를 같이 본다:
    // 1) 실제로 3줄(clamp) 안에 다 들어가는지 DOM에서 직접 재본 결과(넘치면 표시)
    // 2) 목록 API가 이미 "..."으로 잘라서 내려준 미리보기인 경우 - 이런 글은 원문이
    //    3줄보다 짧아 보여도(넘치지 않아도) 실제로는 잘린 상태이므로 버튼을 띄운다.
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
        const fullHtml = newsFullContentMap[titleNo];
        if (!fullHtml) return;
        body.innerHTML = sanitizeNewsHtml(fullHtml);
        body.classList.remove('news-post-body-clamp');
        btn.remove();
    }

    // 왼쪽 "최신 글" 큰 카드 - 기존 news-post-card 마크업(사진 캐러셀, 본문 더보기 등)을
    // 그대로 재사용한다. 사진은 CSS에서 정사각(1:1)으로 꽉 차게 보이도록 처리했다.
    function renderFeaturedPostHtml(item) {
        const { member, post } = item;
        const title = post.titleName || '';
        const snippet = (post.content && post.content.textContent) || '';
        const fullHtml = (post.content && post.content.content) || '';
        if (fullHtml) newsFullContentMap[post.titleNo] = fullHtml;
        const category = (post.display && post.display.bbsName) || '';
        const timeText = formatRelativeTime(post.regDate);
        const photos = post.photos || [];
        const soopId = member ? member['SOOP ID'] : post.userId;
        const name = member ? member['이름'] : (post.userNick || '');

        // 사진이 2장 이상이면 인스타처럼 가로 스와이프(스크롤 스냅)로 넘기고, 몇 번째
        // 사진인지는 하단에 캡슐(활성) + 점(비활성) 인디케이터로 보여준다.
        // (사진이 1장뿐이면 굳이 스크롤 컨테이너로 감쌀 필요 없이 기존처럼 표시)
        const dotsHtml = photos.length > 1
            ? `<div class="news-post-photos-dots">${photos.map((_, i) => `<span class="photo-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
            : '';
        // PC는 호버 시 좌우 화살표로 클릭 이동, 모바일은 화살표 없이 스와이프만
        // (화살표는 CSS의 @media (hover:none)에서 터치 기기일 때 아예 숨김).
        // 맨 처음엔 이전 화살표를 숨겨둔다 - 스크롤이 움직이면 updateNewsPhotoDots가 갱신.
        const navHtml = photos.length > 1
            ? `<button type="button" class="news-photo-nav news-photo-nav-prev is-hidden" onclick="scrollNewsPhotos(this,-1)" aria-label="이전 사진">‹</button>
               <button type="button" class="news-photo-nav news-photo-nav-next" onclick="scrollNewsPhotos(this,1)" aria-label="다음 사진">›</button>`
            : '';
        // 첫 번째 사진은 갤러리가 열리자마자 바로 보이는 영역이라 loading="lazy"를
        // 주면 오히려 불필요하게 로딩을 늦춰 화면에 늦게 뜬다 - 즉시 로드하고,
        // 스와이프해야 보이는 두 번째 사진부터만 지연 로딩한다.
        const photosHtml = photos.length
            ? `<div class="news-post-photos-wrap">
                    <div class="news-post-photos"${photos.length > 1 ? ' onscroll="updateNewsPhotoDots(this)"' : ''}>${photos.map((p, i) => `<img src="${escapeHTML(p.url)}" alt=""${i > 0 ? ' loading="lazy"' : ''} onerror="this.remove();">`).join('')}</div>
                    ${navHtml}
                    ${dotsHtml}
               </div>`
            : '';

        // 좋아요/조회수 - API가 이미 count.likeCnt/count.readCnt로 내려주는데 지금까지
        // 화면에 전혀 안 쓰고 있었다. "원글 보기" 링크와 같은 줄에 나란히 배치한다.
        const likeCnt = post.count && post.count.likeCnt;
        const readCnt = post.count && post.count.readCnt;
        const statsHtml = (likeCnt || readCnt)
            ? `<div class="news-post-stats">
                    ${likeCnt ? `<span class="news-post-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.2 1.4 6.9 4 5.3c2.2-1.3 4.7-.6 6 1.2l2 2.7 2-2.7c1.3-1.8 3.8-2.5 6-1.2 2.6 1.6 3 4.9 1.3 7.6C18.7 16.65 12 21 12 21z"/></svg>${likeCnt.toLocaleString('ko-KR')}</span>` : ''}
                    ${readCnt ? `<span class="news-post-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>${readCnt.toLocaleString('ko-KR')}</span>` : ''}
               </div>`
            : '<div class="news-post-stats"></div>';

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
            ${snippet ? `<div class="news-post-body news-post-body-clamp">${formatNewsContent(snippet)}</div><button type="button" class="news-post-more-btn" onclick="expandNewsPost(this, ${post.titleNo})">더보기 <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>` : ''}
            ${photosHtml}
            <div class="news-post-link-row">
                ${statsHtml}
                <a class="news-post-link" href="https://www.sooplive.co.kr/station/${encodeURIComponent(soopId)}/post/${post.titleNo}" target="_blank" rel="noopener">
                    원글 보기 <span class="ext-arrow">↗</span>
                </a>
            </div>
        </div>`;
    }

    // 오른쪽 "지난 글" 리스트 - 홈 화면 "최근 공지"의 home-notice-card를 그대로 재사용한다.
    // 다른 점은 클릭 시 원글로 나가는 게 아니라, 그 글을 왼쪽 최신 글 자리로 올린다는 것.
    function renderPastNoticeHtml(item) {
        const { member, post } = item;
        const soopId = member ? member['SOOP ID'] : post.userId;
        const name = member ? member['이름'] : (post.userNick || '');
        const title = post.titleName || '(제목 없음)';
        const snippet = (post.content && post.content.textContent) || '';
        const timeText = formatRelativeTime(post.regDate);
        const thumbUrl = post.photos && post.photos[0] && post.photos[0].url;
        const thumbHtml = thumbUrl ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy" onerror="this.remove();">` : '';
        const key = jsStrEscape(newsItemKey(item));

        return `
        <div class="home-notice-card news-past-item" onclick="setNewsFeatured('${key}')" data-news-key="${escapeHTML(newsItemKey(item))}">
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

    async function loadNewsFeed() {
        if (newsLoading || !currentNewsPlayer) return;
        newsLoading = true;
        const soopId = currentNewsPlayer['SOOP ID'];
        const content = document.getElementById('news-feed-content');

        try {
            newsCurrentPage = 1;
            const { posts, totalPages } = await fetchMemberFeed(soopId, newsCurrentPage);
            newsTotalPages = totalPages;

            newsMode = 'member';
            newsFeaturedKey = null; // 멤버를 새로 선택했으니 그 멤버의 가장 최신 글을 왼쪽에 올린다
            newsItems = posts.map(post => ({ member: currentNewsPlayer, post }));
            newsHasMore = newsCurrentPage < newsTotalPages;
            renderNewsLayout(content);
        } catch (e) {
            content.innerHTML = emptyStateHtml('글을 불러오지 못했습니다.');
        } finally {
            newsLoading = false;
        }
    }

    function parseStat(statStr) {
        if (!statStr || statStr === "-") return { wins: 0, losses: 0, rate: 0, text: "-" };
        const match = statStr.match(/(\d+)승 (\d+)패/);
        if (match) {
            const w = parseInt(match[1]), l = parseInt(match[2]);
            return { wins: w, losses: l, rate: (w+l) > 0 ? (w/(w+l)*100) : 0, text: `${w}승 ${l}패` };
        }
        return { wins: 0, losses: 0, rate: 0, text: "-" };
    }
    function getRateText(w, l) { return (w+l) > 0 ? (w/(w+l)*100).toFixed(1) + "%" : "-"; }
    function updateDonut(elId, txtId, subId, stat, color) {
        document.getElementById(txtId).innerText = stat.text === "-" ? "-" : stat.rate.toFixed(1) + "%";
        document.getElementById(subId).innerText = stat.text;
        // color === 'byRate'면 50% 기준으로 승(파랑)/패(빨강) 색을 자동으로 정한다.
        const ringColor = color === 'byRate' ? (stat.rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)') : color;
        document.getElementById(elId).style.background = `conic-gradient(${ringColor} ${stat.rate}%, #eee 0)`;
        if (color === 'byRate') document.getElementById(txtId).style.color = ringColor;
    }

    function calculateTeamSummaries() {
        let tStats = { '대회': {w:0, l:0}, '대학': {w:0, l:0}, '미니': {w:0, l:0}, 'CK': {w:0, l:0} };
        dbMatches.forEach(m => {
            if (tStats[m['형식']] && m['최종 결과']) {
                if (m['최종 결과'] === '승') tStats[m['형식']].w++;
                if (m['최종 결과'] === '패') tStats[m['형식']].l++;
            }
        });
        for (let fmt in tStats) {
            const w = tStats[fmt].w, l = tStats[fmt].l;
            const rate = (w + l) > 0 ? (w / (w + l) * 100) : 0;
            const ringColor = rate >= 50 ? 'var(--color-win)' : 'var(--color-lose)';
            document.getElementById(`t-sum-${fmt}-w`).innerHTML = `<span style="color:var(--color-win);">${w}</span>승 <span style="color:var(--color-lose);">${l}</span>패`;
            document.getElementById(`t-sum-${fmt}-r`).innerText = getRateText(w, l);
            document.getElementById(`t-sum-${fmt}-r`).style.color = ringColor;
            document.getElementById(`t-sum-${fmt}-donut`).style.background = `conic-gradient(${ringColor} ${rate}%, #eee 0)`;
        }
        renderTeamMatchesList('team-recent-list', {format: '전체'}, 10);
    }

    function renderTeamMatchesList(containerId, filters, limit) {
        filters = filters || {};
        const format = filters.format || '전체';
        const opponent = filters.opponent || null;

        let filtered = format === '전체' ? dbMatches : dbMatches.filter(m => m['형식'] === format);
        if (opponent) filtered = filtered.filter(m => m['상대팀'] === opponent);
        const sliced = limit ? filtered.slice(0, limit) : filtered;
        
        if (sliced.length === 0) {
            document.getElementById(containerId).innerHTML = EMPTY_MATCH_ROW_HTML;
            return;
        }

        const html = sliced.map((m, idx) => {
            const resText = m['최종 결과'] || m['최근 결과'] || '';
            const badgeHtml = resultBadgeHtml(resText);

            const collapseId = `collapse-${containerId}-${idx}`;
            // _match_key가 있으면 그걸로 정확히 매칭(같은 날 여러 경기 구분), 없을 때만 날짜+상대팀으로 대체
            // 내전 라운드는 개인 통계용으로 반대편 관점의 '미러' 라운드가 추가돼 있으므로
            // (match_link.py 참고) 세트별 상세보기에는 원본 한 줄만 보이도록 걸러낸다.
            const teamRounds = dbRounds.filter(r => {
                if (r['_mirrored']) return false;
                if (m['_match_key'] && r['_match_key']) return r['_match_key'] === m['_match_key'];
                return r['날짜'] === m['날짜'] && r['상대팀'] === m['상대팀'];
            });
            
            let setDetailsHtml = '';
            if (teamRounds.length > 0) {
                setDetailsHtml = teamRounds.map((r, i) => {
                    const isWin = r['결과'] === '승';
                    const isDraw = r['결과'] === '무' || r['결과'] === '무승부';
                    let resBadge = '<span class="text-danger fw-bold">패</span>';
                    if(isWin) resBadge = '<span class="text-primary fw-bold">승</span>';
                    if(isDraw) resBadge = '<span class="text-secondary fw-bold">무</span>';

                    return `
                    <tr style="border-bottom:1px solid #f1f3f5;">
                        <td style="width:18.8%; font-weight:800; color:#888; white-space:nowrap;">${escapeHTML(r['세트']) || ''} ${escapeHTML(r['라운드']) || ''}</td>
                        <td style="width:18.8%;" class="${isWin?'fw-bold text-primary':'text-dark'}">${escapeHTML(r['우리 선수'])||'-'}</td>
                        <td style="width:18.8%;">${resBadge}</td>
                        <td style="width:18.8%;" class="${(!isWin && !isDraw)?'fw-bold text-primary':'text-dark'}">${escapeHTML(r['상대 선수'])||'-'}</td>
                        <td style="width:18.8%; color:#555;">${escapeHTML(r['맵']) || '-'}</td>
                        <td style="width:6%;"></td>
                    </tr>`;
                }).join('');
            } else {
                setDetailsHtml = '<tr><td colspan="6" class="text-center text-muted py-2" style="font-size:var(--fs-body);">상세 세트 기록이 없습니다.</td></tr>';
            }

            return `
            <tr class="match-row" style="cursor:pointer; border-bottom:1px solid #f1f3f5;" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <td class="stat-table-sticky-col" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span class="d-flex align-items-center justify-content-center gap-2">${teamLogoHtml(m['상대팀'])}<span style="overflow:hidden; text-overflow:ellipsis; line-height:normal;">${escapeHTML(m['상대팀'])}</span></span>
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${m['세트 결과'] || '-'}</td>
                <td class="badge-cell">${badgeHtml}</td>
                <td>${m['날짜'] ? m['날짜'].split(' ')[0].substring(2) : ''}</td>
                <td><span class="m-arrow" style="display:inline-flex; width:auto;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></td>
            </tr>
            <tr>
                <td colspan="6" style="padding:0; border:none;">
                    <div class="collapse" id="${collapseId}">
                        <div style="background-color:#fcfcfd; border-top:1px dashed #eaedf2; padding:0 12px;">
                            <table class="table table-borderless mb-0 text-center" style="table-layout:fixed; width:100%; font-size:var(--fs-body);">
                                <tbody>${setDetailsHtml}</tbody>
                            </table>
                        </div>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
        document.getElementById(containerId).innerHTML = html;
    }

    function openTeamMatchModal(format) {
        document.getElementById('teamModalTitle').innerText = format === '전체' ? '팀 전체 전적' : `팀 ${format} 전적`;
        renderTeamMatchesList('team-modal-list', {format}, null);
        new bootstrap.Modal(document.getElementById('teamMatchesModal')).show();
    }

    function openTeamOpponentModal(opponent) {
        document.getElementById('teamModalTitle').innerHTML = `${teamLogoHtml(opponent, 20)} vs ${escapeHTML(opponent)} 전체 전적`;
        renderTeamMatchesList('team-modal-list', {format: '전체', opponent}, null);
        new bootstrap.Modal(document.getElementById('teamMatchesModal')).show();
    }
    document.addEventListener('click', function(e) {
        const row = e.target.closest('.team-row-clickable');
        if (row) openTeamOpponentModal(row.dataset.team);
    });

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
        return `<img src="${url}" class="${cls}" loading="lazy" onerror="this.outerHTML='<span class=\\'${cls} d-flex align-items-center justify-content-center\\'>👤</span>';">`;
    }

    // 멤버 탭 렌더링
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
    // 종족 뱃지 클래스(T/Z/P별 색상)를 span에 부여할 때 공통으로 쓰는 헬퍼
    function raceBadgeClass(race) {
        const letter = raceShortLabel(race);
        return ['T', 'Z', 'P'].includes(letter) ? ` race-badge race-${letter}` : '';
    }
    function raceBadgeHtml(race) {
        return `<span class="tag-badge${raceBadgeClass(race)}">${raceShortLabel(race)}</span>`;
    }
    // 티어 표기(예: "3티어")를 멤버 카드/모달/개인전적 프로필에서 동일하게 사용
    function tierLabel(tier) {
        return (tier !== undefined && tier !== null && tier !== '') ? `${tier}티어` : '티어 미정';
    }
    function tierBadgeHtml(tier) {
        return `<span class="tag-badge tier-badge">${tierLabel(tier)}</span>`;
    }
    // 직책 뱃지 색상: 자주 쓰는 직책은 고정 색상, 그 외(전력분석관 등 임의의 직책)는
    // 단일 그레이 톤으로 통일 - 종족 뱃지 색(테란 파랑/저그 보라/프로토스 주황)과 겹치지 않도록
    // 선수는 테란 파랑(#1976d2)보다 확연히 진한 네이비를 사용
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
        return dbMembers.filter(m => {
            if (!isActiveMember(m)) return false;
            const soopId = m['SOOP ID'];
            return soopId && /^[a-zA-Z0-9_-]+$/.test(String(soopId).trim());
        });
    }
    function todayStr() {
        return new Date().toISOString().split('T')[0];
    }
    function daysBetween(startStr, endStr) {
        if (!startStr || !endStr) return null;
        const start = new Date(startStr);
        const end = new Date(endStr);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        return Math.floor((end - start) / 86400000) + 1;
    }
    function memberCardHtml(m) {
        return `
        <div class="member-card${isActiveMember(m) ? '' : ' former'}" onclick="openMemberProfile('${jsStrEscape(m['이름'])}')">
            <span class="tool-card-ext">↗</span>
            ${avatarHtml(m['SOOP ID'], 'member-avatar-img')}
            <div class="member-card-name">${escapeHTML(m['이름'])}</div>
            <div class="member-card-tags">
                ${tierBadgeHtml(m['티어'])}
                ${raceBadgeHtml(m['종족'])}
            </div>
        </div>`;
    }
    function renderMemberGroup(title, members, opts) {
        opts = opts || {};
        if (members.length === 0) return '';
        const sorted = [...members].sort((a, b) =>
            tierIndex(a['티어']) - tierIndex(b['티어']) || String(a['이름']).localeCompare(String(b['이름']), 'ko'));

        const titleGroupHtml = `<span class="section-title-label">${escapeHTML(title)}<span class="title-count-divider"></span><span class="text-secondary" style="font-size:var(--fs-body); font-weight:600;">${sorted.length}명</span></span>`;

        if (opts.collapseId) {
            const startClosed = !!opts.startClosed;
            return `
            <div class="section-title${startClosed ? ' collapsed' : ''}" style="cursor:pointer;" role="button" data-bs-toggle="collapse" data-bs-target="#${opts.collapseId}">
                ${titleGroupHtml}
                <svg class="section-title-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div class="collapse${startClosed ? '' : ' show'}" id="${opts.collapseId}">
                <div class="member-grid mb-block">${sorted.map(memberCardHtml).join('')}</div>
            </div>`;
        }

        return `
        <div class="section-title">${titleGroupHtml}</div>
        <div class="member-grid mb-block">${sorted.map(memberCardHtml).join('')}</div>`;
    }
    function renderMembersPage() {
        const roleOrderBase = ['감독', '코치', '선수'];
        const activeMembers = dbMembers.filter(isActiveMember);
        const formerMembers = dbMembers.filter(m => !isActiveMember(m));
        const allRoles = [...new Set(activeMembers.map(m => m['직책'] || '기타'))];
        const extraRoles = allRoles.filter(r => !roleOrderBase.includes(r));
        const roleOrder = [...roleOrderBase, ...extraRoles];

        let html = '';
        roleOrder.forEach(role => {
            const group = activeMembers.filter(m => (m['직책'] || '기타') === role);
            html += renderMemberGroup(role, group);
        });

        if (formerMembers.length > 0) {
            html += `
            <div class="text-center section-trailer">
                <button class="news-load-more" id="former-members-toggle-btn" onclick="toggleFormerMembersSection()">이전 멤버 <svg id="former-members-toggle-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
            </div>
            <div id="former-members-section" style="display:none;">
                ${renderMemberGroup('이전 멤버', formerMembers)}
            </div>`;
        }

        document.getElementById('members-groups').innerHTML = html || '<div class="text-center text-muted py-5">등록된 멤버가 없습니다.</div>';
    }

    function toggleFormerMembersSection() {
        const section = document.getElementById('former-members-section');
        const chevron = document.getElementById('former-members-toggle-chevron');
        const showing = section.style.display !== 'none';
        section.style.display = showing ? 'none' : 'block';
        chevron.style.transform = showing ? '' : 'rotate(180deg)';
    }

    // 홈 화면 - 현재 방송중 목록.
    // 참고 프로젝트(ststats)의 개인페이지 패턴 그대로: bjapi.afreecatv.com을
    // 브라우저에서 직접 fetch한다 (CORS 허용됨, 확인됨). 활성 멤버가 소수라
    // 프록시/백엔드 배치 작업 없이 페이지 로드 시점에 병렬로 바로 체크한다 -
    // 그래서 워크플로를 몇 분마다 돌릴 필요가 없고, 열 때마다 최신 상태.
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
        const startDate = new Date(String(broadStart).replace(' ', 'T'));
        if (isNaN(startDate.getTime())) return '';
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
        const eh = Math.floor(elapsedSec / 3600);
        const em = Math.floor((elapsedSec % 3600) / 60);
        return (eh > 0 ? `${eh}시간 ${em}분` : `${em}분`) + ' 방송 중';
    }

    async function renderLiveBroadcasts() {
        const container = document.getElementById('home-live-broadcast');
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
        const liveList = settled
            .filter(r => r.status === 'fulfilled' && r.value.live)
            .map(r => r.value);

        if (liveList.length === 0) {
            container.innerHTML = noLiveHtml;
            return;
        }

        container.innerHTML = `<div class="live-broadcast-grid">${liveList.map(({ member: m, live }) => {
            const { broad, broadStart } = live;
            const soopId = m['SOOP ID'];
            const viewerText = broad.current_sum_viewer != null ? broad.current_sum_viewer.toLocaleString('ko-KR') + '명' : '-';
            const elapsedText = formatLiveElapsed(broadStart) || '-';
            // 아바타 링 색: 여자는 기존 그대로(빨강 계열 그라디언트), 남자만 파란 원테두리로.
            const avatarRingClass = m['성별'] === '남자' ? 'live-card-avatar-ring live-card-avatar-ring--male' : 'live-card-avatar-ring';

            return `
            <a class="live-broadcast-card" href="https://play.sooplive.co.kr/${encodeURIComponent(soopId)}" target="_blank" rel="noopener">
                <div class="live-thumb-wrap">
                    <img class="live-thumb" src="https://liveimg.sooplive.co.kr/m/${broad.broad_no}" alt="방송 화면" onerror="this.style.display='none';">
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
        }).join('')}</div>`;
    }

    // ===== 홈 화면 - 최신 공지 =====
    // SOOP 채널 게시판 API를 브라우저에서 직접 fetch한다 (방송중 체크와 같은 방식).
    // 응답의 noticeData가 실제로 '공지' 처리된 글들이고(noticeYn:2), 최신순으로 정렬돼 온다.
    async function renderLatestNotices() {
        const container = document.getElementById('home-notice-list');
        const noNoticeHtml = emptyStateHtml('최근 공지가 없습니다.', 'clean-card');
        const activeMembers = activeMembersWithSoopId();

        if (activeMembers.length === 0) {
            container.innerHTML = noNoticeHtml;
            return;
        }

        // 공지만이 아니라 일반글도 같이 긁어와서(fetchMemberFeed는 공지+일반글을 합쳐 최신순 반환) 섞는다.
        const settled = await Promise.allSettled(
            activeMembers.map(async m => {
                const { posts } = await fetchMemberFeed(m['SOOP ID'], 1);
                return posts.slice(0, 3).map(post => ({ member: m, post }));
            })
        );

        const withNotice = settled
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .sort((a, b) => new Date(b.post.regDate) - new Date(a.post.regDate));

        if (withNotice.length === 0) {
            container.innerHTML = noNoticeHtml;
            return;
        }

        container.innerHTML = withNotice.slice(0, 5).map(({ member: m, post }) => {
            const soopId = m['SOOP ID'];
            const name = m['이름'];
            const timeText = formatRelativeTime(post.regDate);
            const title = post.titleName || '(제목 없음)';
            const snippet = (post.content && post.content.textContent) || '';
            const thumbUrl = post.photos && post.photos[0] && post.photos[0].url;
            const thumbHtml = thumbUrl ? `<img class="home-notice-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy" onerror="this.remove();">` : '';

            return `
            <div class="home-notice-card" onclick="goToNewsFeed('${jsStrEscape(name)}')">
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
        }).join('');
    }

    function openMemberProfile(name) {
        const m = dbMembers.find(x => x['이름'] === name);
        if (!m) return;

        document.getElementById('mp-name').innerText = name;
        const mpRoleBadge = document.getElementById('mp-role-badge');
        mpRoleBadge.textContent = m['직책'] || '미정';
        mpRoleBadge.className = 'tag-badge role-badge';
        mpRoleBadge.style.background = roleColor(m['직책']);
        const mpRaceBadge = document.getElementById('mp-race-badge');
        mpRaceBadge.textContent = raceShortLabel(m['종족']);
        mpRaceBadge.className = 'tag-badge' + raceBadgeClass(m['종족']);
        const mpTierBadge = document.getElementById('mp-tier-badge');
        mpTierBadge.textContent = tierLabel(m['티어']);
        mpTierBadge.className = 'tag-badge tier-badge';

        const avatarUrl = getProfileImgUrl(m['SOOP ID']);
        const avatarEl = document.getElementById('mp-avatar');
        avatarEl.innerHTML = avatarUrl
            ? `<img src="${avatarUrl}" onerror="this.parentElement.innerHTML='👤';">`
            : '👤';

        const active = isActiveMember(m);
        const days = m['입단일'] ? daysBetween(m['입단일'], active ? todayStr() : (m['퇴단일'] || null)) : null;
        // 다른 뱃지들(직책/티어/종족)과 같은 tag-badge 패밀리(사각 배지+테두리)를 그대로 써서
        // 톤을 맞춘다 - 예전엔 알약 모양 전용 스타일(.days-chip)이라 이질적으로 보였다.
        // 그리고 옆의 일반 텍스트와 vertical-align:middle로만 맞추면 줄간격 때문에 살짝
        // 어긋나 보여서(실측 약 2px), 텍스트와 뱃지를 flex로 묶어 기준선이 아니라 박스
        // 높이 기준으로 정렬한다.
        const daysBadge = days !== null
            ? `<span class="tag-badge tier-badge">${days}일${active ? '째' : ''}</span>`
            : '';
        const period = m['입단일']
            ? `<span class="d-inline-flex align-items-center flex-wrap gap-2">${m['입단일']} ~ ${active ? '현재' : (m['퇴단일'] || '-')}${daysBadge}</span>`
            : '-';
        const soopId = m['SOOP ID'];
        const isValidSoopId = soopId && /^[a-zA-Z0-9_-]+$/.test(String(soopId).trim());
        const broadcast = isValidSoopId
            ? `<a href="https://www.sooplive.com/station/${encodeURIComponent(String(soopId).trim())}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center;">
                   <img src="images/숲로고.webp" alt="SOOP" style="width:20px; height:20px; border-radius:4px; object-fit:contain;">
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
                <td class="text-secondary" style="width:90px; font-weight:700; border-color:#f1f3f5; padding-left:0;">${label}</td>
                <td class="fw-bold text-dark" style="border-color:#f1f3f5;">${val}</td>
            </tr>`).join('');

        renderMemberActivitySummary(m);

        new bootstrap.Modal(document.getElementById('memberProfileModal')).show();
    }

    // 프로필 팝업의 "이번 달 방송 활동"을 시너지표(ststats)에서 가져온 데이터로 채운다.
    function renderMemberActivitySummary(m) {
        const statusEl = document.getElementById('mp-activity-status');
        const balloonsEl = document.getElementById('mp-balloons');
        const hoursEl = document.getElementById('mp-broadcast-hours');
        const viewersEl = document.getElementById('mp-viewers');
        const sponsorEl = document.getElementById('mp-sponsor-record');

        const resetTo = (statusText) => {
            statusEl.innerText = statusText;
            balloonsEl.innerText = hoursEl.innerText = viewersEl.innerText = sponsorEl.innerText = '-';
        };

        if (!synergyData) {
            resetTo('데이터 불러오는 중');
            return;
        }

        const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
        const entry = synergyData.find(s => String(s.id || '').trim().toLowerCase() === soopId);

        if (!entry) {
            resetTo('데이터 없음');
            return;
        }

        statusEl.innerText = '';
        balloonsEl.innerText = (entry.balloons || 0).toLocaleString('ko-KR') + '개';
        hoursEl.innerText = formatSecondsToHM(entry.broadcast_seconds);
        viewersEl.innerText = (entry.cumulative_viewers || 0).toLocaleString('ko-KR') + '명';
        sponsorEl.innerText = formatSponsorRecord(entry.sponsor_wins, entry.sponsor_losses);
    }

    function renderIndividualSidebar() {
        const html = [`<div class="avatar-select-item avatar-select-all active" id="side-btn-summary" onclick="showIndivSummary()">
                            <img src="images/캄몬스타즈.webp" alt="전체" class="avatar-select-img" onerror="this.outerHTML='&lt;div class=&quot;avatar-select-fallback&quot;&gt;전체&lt;/div&gt;';">
                            <span class="avatar-select-name">전체</span>
                       </div>`];
        const formerHtml = [];
        dbMembers.forEach(m => {
            const item = `<div class="avatar-select-item" id="side-player-${m['이름']}" onclick="selectPlayer('${jsStrEscape(m['이름'])}')">
                            ${avatarHtml(m['SOOP ID'], 'avatar-select-img')}
                            <span class="avatar-select-name">${escapeHTML(m['이름'])}</span>
                        </div>`;
            if (isActiveMember(m)) html.push(item);
            else formerHtml.push(item);
        });

        html.push(`<div class="avatar-select-item avatar-select-toggle" id="indiv-toggle-former" onclick="toggleFormerMembers()">
                        <div class="avatar-select-fallback">
                            <svg id="indiv-toggle-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                        <span class="avatar-select-name">이전 멤버</span>
                   </div>`);
        html.push(`<span id="indiv-former-wrap" style="display:none;">${formerHtml.join('')}</span>`);

        document.getElementById('indiv-avatar-list').innerHTML = html.join('');
    }

    function toggleFormerMembers() {
        const wrap = document.getElementById('indiv-former-wrap');
        const chevron = document.getElementById('indiv-toggle-chevron');
        const showing = wrap.style.display !== 'none';
        wrap.style.display = showing ? 'none' : 'contents';
        chevron.style.transform = showing ? '' : 'rotate(180deg)';
    }

    function showIndivSummary() {
        currentPlayer = '';
        document.getElementById('statContent').style.display = 'none';
        document.getElementById('indiv-summary-content').style.display = 'block';
        document.getElementById('indiv-content-title').innerText = '전체 전적';

        document.querySelectorAll('#indiv-avatar-list .avatar-select-item').forEach(el => el.classList.remove('active'));
        document.getElementById('side-btn-summary').classList.add('active');

        const activeMembers = dbMembers.filter(isActiveMember);
        let html = '';
        activeMembers.forEach(m => {
            const pStat = playersStats.find(x => x['이름'] === m['이름']) || {};
            const name = m['이름'];
            html += `<tr style="border-bottom:1px solid #f1f3f5; cursor:pointer;" onclick="selectPlayer('${jsStrEscape(name)}')">
                <td class="fw-bold text-dark text-center stat-table-sticky-col" style="white-space:nowrap; width:20%;"><span class="d-flex align-items-center justify-content-center gap-2">${avatarHtml(m['SOOP ID'], 'player-avatar-sm')}<span style="overflow:hidden; text-overflow:ellipsis; line-height:normal;">${escapeHTML(name)}</span></span></td>
                <td style="white-space:nowrap; width:20%;">${pStat['대회 전적'] || '-'}</td>
                <td style="white-space:nowrap; width:20%;">${pStat['대학 전적'] || '-'}</td>
                <td style="white-space:nowrap; width:20%;">${pStat['미니 전적'] || '-'}</td>
                <td style="white-space:nowrap; width:20%;">${pStat['CK 전적'] || '-'}</td>
            </tr>`;
        });
        document.getElementById('indiv-summary-tbody').innerHTML = html;
        updateStatsHash();
    }

    function selectPlayer(name) {
        currentPlayer = name;
        document.getElementById('indiv-summary-content').style.display = 'none';
        document.getElementById('statContent').style.display = 'block';
        document.getElementById('indiv-content-title').innerText = `${name}의 전적`;

        document.querySelectorAll('#indiv-avatar-list .avatar-select-item').forEach(el => el.classList.remove('active'));
        const sideItem = document.getElementById(`side-player-${name}`);
        if (sideItem) {
            sideItem.classList.add('active');
            // 이전 멤버가 접혀있는 상태에서 그 사람이 선택되면 자동으로 펼쳐준다
            const formerWrap = document.getElementById('indiv-former-wrap');
            if (formerWrap && formerWrap.contains(sideItem) && formerWrap.style.display === 'none') {
                toggleFormerMembers();
            }
        }

        const pStat = playersStats.find(x => x['이름'] === name) || {};
        const pDb = dbMembers.find(x => x['이름'] === name) || {};

        document.getElementById('p-name').innerText = name;
        const pTierBadge = document.getElementById('p-tier');
        pTierBadge.textContent = tierLabel(pDb['티어']);
        pTierBadge.className = 'tag-badge tier-badge';
        const pRaceBadge = document.getElementById('p-race');
        pRaceBadge.textContent = raceShortLabel(pDb['종족']);
        pRaceBadge.className = 'tag-badge' + raceBadgeClass(pDb['종족']);

        const avatarUrl = getProfileImgUrl(pDb['SOOP ID']);
        const avatarEl = document.getElementById('p-avatar');
        if (avatarUrl) {
            avatarEl.innerHTML = `<img src="${avatarUrl}" onerror="this.parentElement.innerHTML='👤';">`;
        } else {
            avatarEl.innerHTML = '👤';
        }

        updateDonut('d-fmt-1', 'dt-fmt-1', 'dw-fmt-1', parseStat(pStat['대회 전적']), 'byRate');
        updateDonut('d-fmt-2', 'dt-fmt-2', 'dw-fmt-2', parseStat(pStat['대학 전적']), 'byRate');
        updateDonut('d-fmt-3', 'dt-fmt-3', 'dw-fmt-3', parseStat(pStat['미니 전적']), 'byRate');

        updateDonut('d-race-t', 'dt-race-t', 'dw-race-t', parseStat(pStat['테란전 전적']), '#1976d2');
        updateDonut('d-race-z', 'dt-race-z', 'dw-race-z', parseStat(pStat['저그전 전적']), '#7b1fa2');
        updateDonut('d-race-p', 'dt-race-p', 'dw-race-p', parseStat(pStat['프로토스전 전적']), '#f57f17');

        renderIndivMatchesList('indiv-recent-list', currentIndivFilter, 10);
        updateStatsHash();
    }

    function setIndivFilter(format) {
        currentIndivFilter = format;
        document.querySelectorAll('#indiv-filters .filter-item').forEach(el => el.classList.remove('active'));
        
        const activeNavEl = Array.from(document.querySelectorAll('#indiv-filters .filter-item')).find(el => el.innerText === format);
        if(activeNavEl) activeNavEl.classList.add('active');

        renderIndivMatchesList('indiv-recent-list', format, 10);
    }

    function renderIndivMatchesList(containerId, format, limit) {
        let filtered = dbRounds.filter(m => m['우리 선수'] === currentPlayer);
        if (format !== '전체') filtered = filtered.filter(m => m['형식'] === format);
        const sliced = limit ? filtered.slice(0, limit) : filtered;

        if (sliced.length === 0) {
            document.getElementById(containerId).innerHTML = EMPTY_MATCH_ROW_HTML;
            return;
        }

        const html = sliced.map(m => {
            const resText = m['결과'] || '';
            const badgeHtml = resultBadgeHtml(resText);

            return `
            <tr style="border-bottom:1px solid #f1f3f5;">
                <td class="stat-table-sticky-col" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(m['상대 선수']) || '-'}</td>
                <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span class="d-flex align-items-center justify-content-center gap-2">${teamLogoHtml(m['상대팀'])}<span style="overflow:hidden; text-overflow:ellipsis; line-height:normal;">${escapeHTML(m['상대팀'])}</span></span>
                </td>
                <td class="badge-cell"><span class="tag-badge">${escapeHTML(m['형식'])}</span></td>
                <td>${escapeHTML(m['맵']) || '-'}</td>
                <td class="badge-cell">${badgeHtml}</td>
                <td>${m['날짜'] ? m['날짜'].split(' ')[0].substring(2) : ''}</td>
            </tr>
            `;
        }).join('');
        document.getElementById(containerId).innerHTML = html;
    }

    function openIndivMatchModal() {
        const titleText = currentIndivFilter === '전체' ? `${currentPlayer} 개인 전체 전적` : `${currentPlayer} 전체 전적 (${currentIndivFilter})`;
        document.getElementById('indivModalTitle').innerText = titleText;
        renderIndivMatchesList('indiv-modal-list', currentIndivFilter, null);
        new bootstrap.Modal(document.getElementById('indivMatchesModal')).show();
    }

    // ===== 시너지표 (ststats 외부 데이터에서 우리 로스터만 추려서 표시) =====
    const STSTATS_BASE = 'https://ststats.github.io/synergy';
    let synergyData = null;
    let synergyMetric = 'balloons';

    function formatSecondsToHM(sec) {
        sec = sec || 0;
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}시간 ${m}분`;
    }

    async function loadSynergyData() {
        try {
            const datesRes = await fetch(`${STSTATS_BASE}/data/dates.js`, { cache: 'no-store' });
            const datesText = await datesRes.text();
            const match = datesText.match(/window\.AVAILABLE_DATES\s*=\s*(\[[^\]]*\])/);
            if (!match) throw new Error('날짜 목록 형식을 읽을 수 없습니다.');
            const dates = JSON.parse(match[1]);
            const latestDate = dates[0];
            if (!latestDate) throw new Error('사용 가능한 날짜가 없습니다.');

            const dataRes = await fetch(`${STSTATS_BASE}/data/daily/${latestDate}.json`, { cache: 'no-store' });
            if (!dataRes.ok) throw new Error(`daily json HTTP ${dataRes.status}`);
            const data = await dataRes.json();

            // team 이름이 아니라 SOOP ID로 매칭한다 - 외부 쪽 team 표기가
            // 우리 쪽 개편(예: 캄몬스타즈 -> 스타대학)과 항상 동기화된다는
            // 보장이 없기 때문.
            const idToMember = {};
            dbMembers.forEach(m => {
                const soopId = String(m['SOOP ID'] || '').trim().toLowerCase();
                if (soopId) idToMember[soopId] = m;
            });

            synergyData = (data.members || [])
                .map(m => {
                    const key = String(m.id || '').trim().toLowerCase();
                    const ours = idToMember[key];
                    if (!ours) return null;
                    return {
                        ...m,
                        ourMember: ours,
                        active: isActiveMember(ours),
                    };
                })
                .filter(Boolean);

            const updatedText = data.updated_at ? `업데이트: ${data.updated_at}` : '';
            document.getElementById('synergy-updated').innerText = updatedText;

            renderSynergyTable();
        } catch (e) {
            console.error(e);
            const errRow = emptyRowHtml(3, '데이터를 불러오지 못했습니다.');
            document.getElementById('synergy-tbody-male').innerHTML = errRow;
            document.getElementById('synergy-tbody-female').innerHTML = errRow;
        }
    }

    const SYNERGY_METRIC_LABELS = {
        balloons: '별풍선',
        broadcast_seconds: '방송시간',
        cumulative_viewers: '누적시청자',
        sponsor: '스폰전적',
    };

    // 내부적으로 쓰는 값(broadcast_seconds 등은 외부 API 필드명과 동일)과
    // URL에 노출되는 짧은 값(hours 등)을 서로 변환하기 위한 테이블
    const SYNERGY_METRIC_TO_URL = {
        balloons: 'balloons',
        broadcast_seconds: 'hours',
        cumulative_viewers: 'viewers',
        sponsor: 'sponsor',
    };
    const SYNERGY_METRIC_FROM_URL = {
        balloons: 'balloons',
        hours: 'broadcast_seconds',
        viewers: 'cumulative_viewers',
        sponsor: 'sponsor',
    };

    function setSynergyMetric(metric) {
        synergyMetric = metric;
        document.querySelectorAll('#synergy-metric-filter .sub-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.metric === metric);
        });
        document.querySelectorAll('.synergy-metric-label').forEach(el => {
            el.innerText = SYNERGY_METRIC_LABELS[metric] || '';
        });
        renderSynergyTable();
        const urlValue = SYNERGY_METRIC_TO_URL[metric] || metric;
        updateHash('stats', urlValue !== 'balloons' ? { view: urlValue } : {});
    }

    function synergyRowHtml(m, idx) {
        const ours = m.ourMember;
        const name = ours['이름'] || m.nickname;

        let displayVal;
        if (synergyMetric === 'balloons') displayVal = (m.balloons || 0).toLocaleString('ko-KR') + '개';
        else if (synergyMetric === 'broadcast_seconds') displayVal = formatSecondsToHM(m.broadcast_seconds);
        else if (synergyMetric === 'cumulative_viewers') displayVal = (m.cumulative_viewers || 0).toLocaleString('ko-KR') + '명';
        else displayVal = formatSponsorRecord(m.sponsor_wins, m.sponsor_losses);

        return `
        <tr>
            <td class="text-center text-secondary fw-bold" style="width:20%; white-space:nowrap;">${idx + 1}</td>
            <td class="text-center" style="width:40%;">
                <span class="d-flex align-items-center justify-content-center gap-2" style="min-width:0;">
                    ${avatarHtml(ours['SOOP ID'], 'player-avatar-sm')}
                    <span class="fw-bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:normal;">${escapeHTML(name)}</span>
                </span>
            </td>
            <td class="text-center fw-bold" style="width:40%; color:var(--color-primary); white-space:nowrap;">${escapeHTML(displayVal)}</td>
        </tr>`;
    }

    function formatSponsorRecord(wins, losses) {
        wins = wins || 0;
        losses = losses || 0;
        const total = wins + losses;
        const rate = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
        return `${wins}승 ${losses}패 (${rate}%)`;
    }

    function sortSynergyRows(rows) {
        if (synergyMetric === 'sponsor') {
            // 표시는 승패/승률이지만, 정렬은 판수(승+패)가 많은 순 - 승수 기준이 아니다.
            return rows.slice().sort((a, b) =>
                ((b.sponsor_wins || 0) + (b.sponsor_losses || 0)) - ((a.sponsor_wins || 0) + (a.sponsor_losses || 0)));
        }
        return rows.slice().sort((a, b) => (b[synergyMetric] || 0) - (a[synergyMetric] || 0));
    }

    function renderSynergyTable() {
        const maleTbody = document.getElementById('synergy-tbody-male');
        const femaleTbody = document.getElementById('synergy-tbody-female');
        if (!synergyData) return;

        const active = synergyData.filter(m => m.active);
        const male = sortSynergyRows(active.filter(m => m.ourMember['성별'] === '남자'));
        const female = sortSynergyRows(active.filter(m => m.ourMember['성별'] === '여자'));

        const noData = emptyRowHtml(3, '표시할 멤버가 없습니다.');
        maleTbody.innerHTML = male.length ? male.map(synergyRowHtml).join('') : noData;
        femaleTbody.innerHTML = female.length ? female.map(synergyRowHtml).join('') : noData;
    }

    // 모달이 닫히기 시작할 때(hide.bs.modal) 그 안에 포커스가 남아있으면 부트스트랩이
    // aria-hidden="true"를 그대로 씌우면서 "포커스가 남은 요소를 접근성 트리에서
    // 숨겼다"는 크롬 경고가 뜬다. 화면엔 영향 없는 경고지만, 닫히기 직전에 포커스를
    // 미리 빼주면 경고 자체가 안 뜬다.
    document.querySelectorAll('.modal').forEach(modalEl => {
        modalEl.addEventListener('hide.bs.modal', () => {
            if (modalEl.contains(document.activeElement)) {
                document.activeElement.blur();
            }
        });
    });

    // ===== 도구 페이지 - docs/data/tools.json에서 불러와 렌더링.
    // 어드민 페이지 '도구' 탭에서 추가/삭제하고 GitHub에 저장하면 여기 반영된다. =====
    function toolCardHtml(tool) {
        const url = tool.url || '';
        const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}`;
        return `
        <a class="tool-card" href="${escapeHTML(url)}" target="_blank" rel="noopener">
            <span class="tool-card-ext">↗</span>
            <div class="tool-card-icon"><img loading="lazy" src="${faviconUrl}" alt="" onerror="this.style.display='none';"></div>
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
                const items = (data[key] && data[key].items) || [];
                container.innerHTML = items.length
                    ? items.map(toolCardHtml).join('')
                    : `<div class="text-center text-muted py-3" style="font-size:var(--fs-body); grid-column:1/-1;">등록된 도구가 없습니다.</div>`;
            });
        } catch (e) {
            console.error('도구 목록을 불러오지 못했습니다:', e);
        }
    }

    window.onload = async function() {
        // dbMembers/dbMatches/dbRounds/playersStats를 site_data.json에서 먼저 불러온 뒤,
        // 그걸 사용하는 초기화 로직들을 이어서 실행한다.
        await loadSiteData();

        calculateTeamSummaries();
        renderMembersPage();
        renderLiveBroadcasts();
        renderLatestNotices();
        loadSynergyData();
        loadToolsData();
        mvRenderAll();

        // 새로고침해도 URL 해시에 맞춰 페이지 + 하위 상태(선택된 멤버, 지표 등)까지 그대로 복원
        restoreFromHash();

        const today = new Date();
        calSelectedDateStr = calGetFormatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
        calLoadPublicData();
    };

    // 캘린더 "오늘의 일정"/"선택한 날짜 일정" 카드 아래에 그 날 휴방하는 멤버를
    // 프로필 사진 + 이름 칩으로 보여준다. calendar.js는 멤버 정보(사진/이름)를
    // 모르기 때문에, calCardExtra와 같은 방식으로 훅을 걸어 이 사이트(dbMembers를
    // 가진 쪽)에서 실제 내용을 채워 넣는다. 휴방자가 없는 날은 섹션 자체가 안 보이게
    // 빈 문자열을 반환한다.
    window.calOffAirExtra = (dateStr, type) => {
        const soopIds = calOffAirForDate(dateStr);
        if (!soopIds.length) return '';
        const chips = soopIds.map(soopId => {
            const m = dbMembers.find(x => x['SOOP ID'] === soopId);
            const name = m ? m['이름'] : soopId;
            return `<div class="cal-offair-chip">${avatarHtml(soopId, 'cal-offair-avatar')}<span class="cal-offair-name">${escapeHTML(name)}</span></div>`;
        }).join('');
        const label = '휴방';
        return `<div class="cal-offair-section"><div class="cal-offair-label">${label}</div><div class="cal-offair-chips">${chips}</div></div>`;
    };
