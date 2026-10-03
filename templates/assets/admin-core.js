(function () {
    'use strict';

    const state = {
        client: null,
        user: null,
        role: null,
        editMode: true,
        dirty: false,
        saving: false,
        drawer: null,
        members: null,
        siteConfig: null,
    };

    const $ = id => document.getElementById(id);
    const q = (sel, root = document) => root.querySelector(sel);
    const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
    const esc = value =>
        typeof escapeHTML === 'function'
            ? escapeHTML(value)
            : String(value ?? '').replace(
                  /[&<>'"]/g,
                  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]
              );
    const value = id => $(id)?.value ?? '';
    const empty = v => String(v ?? '').trim() || null;
    const intOrNull = v => (String(v ?? '').trim() === '' ? null : Number(v));
    // 성별 표기는 '남자'/'여자'로 통일한다(DB도 저장할 때 같은 규칙으로 맞춘다 - staruniv.sql 10번)
    function normalizeGender(v) {
        const raw = String(v ?? '').trim(),
            upper = raw.toUpperCase();
        if (['남', '남성', '남자'].includes(raw) || ['M', 'MALE'].includes(upper)) return '남자';
        if (['여', '여성', '여자'].includes(raw) || ['F', 'FEMALE'].includes(upper)) return '여자';
        return raw;
    }

    function setVisible(id, visible) {
        const el = $(id);
        if (!el) return;
        el.classList.toggle('admin-hidden', !visible);
    }

    function setSaveState(text, kind = '') {
        const el = $('adminSaveState');
        if (!el) return;
        el.textContent = text;
        el.dataset.kind = kind;
    }

    function toast(message, kind = 'ok') {
        const el = $('adminToast');
        if (!el) return;
        el.textContent = message;
        el.dataset.kind = kind;
        el.hidden = false;
        clearTimeout(el._timer);
        el._timer = setTimeout(
            () => {
                el.hidden = true;
            },
            kind === 'error' ? 6500 : 3200
        );
    }

    function markDirty(dirty = true) {
        state.dirty = !!dirty;
        setSaveState(state.dirty ? '수정 중' : '저장됨', state.dirty ? 'dirty' : 'ok');
    }

    function field(label, input, help = '') {
        return `<label class="admin-field"><span>${esc(label)}</span>${input}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
    }
    function input(id, val = '', type = 'text', attrs = '') {
        return `<input class="admin-input" id="${id}" type="${type}" value="${esc(val ?? '')}" ${attrs}>`;
    }
    function textarea(id, val = '', attrs = '') {
        return `<textarea class="admin-input admin-textarea" id="${id}" ${attrs}>${esc(val ?? '')}</textarea>`;
    }
    function select(id, options, selected, attrs = '') {
        const html = options
            .map(opt => {
                const pair = Array.isArray(opt) ? opt : [opt, opt];
                return `<option value="${esc(pair[0])}"${String(pair[0]) === String(selected ?? '') ? ' selected' : ''}>${esc(pair[1])}</option>`;
            })
            .join('');
        return `<select class="admin-input" id="${id}" ${attrs}>${html}</select>`;
    }
    // 관리 화면 머리의 보기 전환 탭(공개 페이지 서브탭과 같은 모양). views: [[값, 이름], ...]
    // 4~5개면 공개 서브탭처럼 폰에서 한 줄에 나눠 담는다(core.js syncSubTabDensity는 처음 그린 탭만 센다)
    function viewTabsHtml(views, current) {
        const dense = views.length >= 4 && views.length <= 5 ? ' data-tab-dense' : '';
        return `<div class="sub-tabs tab-scroll" role="tablist"${dense}>${views
            .map(
                ([k, l]) =>
                    `<div class="sub-tab${current === k ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${current === k}" data-admin-view="${esc(k)}">${esc(l)}</div>`
            )
            .join('')}</div>`;
    }
    function bindViewTabs(root, onPick) {
        root.querySelectorAll('[data-admin-view]').forEach(el => (el.onclick = () => onPick(el.dataset.adminView)));
    }
    function checkbox(id, checked, label) {
        return `<label class="admin-check"><input id="${id}" type="checkbox"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    }

    function closeDrawer(force = false, saved = false) {
        if (state.dirty && !force && !confirm('저장하지 않은 변경사항이 있습니다. 닫을까요?')) return false;
        const drawer = $('adminDrawer');
        if (!drawer) return true;
        const opts = state.drawer;
        drawer.setAttribute('aria-hidden', 'true');
        drawer.inert = true;
        document.body.classList.remove('admin-drawer-open');
        document.body.style.removeProperty('--drawer-lock-gap');
        state.drawer = null;
        markDirty(false);
        if (!saved && typeof opts?.onCancel === 'function') opts.onCancel();
        const back = state.drawerReturnFocus;
        state.drawerReturnFocus = null;
        if (back?.isConnected) back.focus({ preventScroll: true });
        return true;
    }
    // 서랍이 열려 있으면 Esc로 닫는다(저장 안 한 변경이 있으면 closeDrawer가 먼저 묻는다).
    // 한글 조합 중 Esc는 조합 취소라 건드리지 않는다.
    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape' || ev.isComposing || !state.drawer || state.saving) return;
        ev.preventDefault();
        closeDrawer();
    });

    function openDrawer(opts) {
        const drawer = $('adminDrawer');
        const form = $('adminDrawerForm');
        if (!drawer || !form) return;
        state.drawer = opts || {};
        $('adminDrawerEyebrow').textContent = opts.eyebrow || 'EDIT';
        $('adminDrawerTitle').textContent = opts.title || '편집';
        $('adminDrawerBody').innerHTML = opts.html || '';
        const del = $('adminDrawerDelete');
        del.hidden = !opts.onDelete;
        del.textContent = opts.deleteLabel || '삭제';
        form.onsubmit = async ev => {
            ev.preventDefault();
            if (state.saving) return;
            state.saving = true;
            setSaveState('저장 중', 'saving');
            $('adminDrawerSave').disabled = true;
            try {
                await opts.onSubmit?.(ev);
                markDirty(false);
                setSaveState('저장됨', 'ok');
                closeDrawer(true, true);
            } catch (err) {
                console.error(err);
                setSaveState('저장 실패', 'error');
                toast(`저장 실패: ${errorText(err)}`, 'error');
            } finally {
                state.saving = false;
                $('adminDrawerSave').disabled = false;
            }
        };
        del.onclick = async () => {
            if (!opts.onDelete || state.saving) return;
            if (!confirm(opts.deleteConfirm || '정말 삭제할까요?')) return;
            state.saving = true;
            del.disabled = true;
            try {
                await opts.onDelete();
                markDirty(false);
                closeDrawer(true, true);
            } catch (err) {
                toast(`삭제 실패: ${errorText(err)}`, 'error');
            } finally {
                state.saving = false;
                del.disabled = false;
            }
        };
        form.oninput = () => markDirty(true);
        // 스크롤을 잠그면 스크롤바가 사라지며 뒤 화면이 그만큼 옆으로 밀린다 - 공개 페이지 모달(core.js showModal)처럼 여백으로 메운다
        if (!document.body.classList.contains('admin-drawer-open')) {
            const scrollbar = window.innerWidth - document.documentElement.clientWidth;
            if (scrollbar > 0) document.body.style.setProperty('--drawer-lock-gap', `${scrollbar}px`);
            const active = document.activeElement;
            state.drawerReturnFocus = active && active !== document.body && !drawer.contains(active) ? active : null;
        }
        drawer.setAttribute('aria-hidden', 'false');
        drawer.inert = false;
        document.body.classList.add('admin-drawer-open');
        markDirty(false);
        requestAnimationFrame(() => q('input,select,textarea', $('adminDrawerBody'))?.focus());
    }

    function errorText(err) {
        return err?.message || err?.details || err?.hint || String(err || '알 수 없는 오류');
    }

    async function requireAdmin() {
        const {
            data: { user },
            error,
        } = await window.AdminApi.auth.user();
        if (error || !user) {
            state.user = null;
            setVisible('loginView', true);
            setVisible('deniedView', false);
            $('adminView')?.classList.add('admin-hidden');
            return false;
        }
        const { data, error: roleError } = await window.AdminApi.auth.role(user.id);
        if (roleError || !data?.is_active) {
            setVisible('loginView', false);
            setVisible('deniedView', true);
            $('adminView')?.classList.add('admin-hidden');
            return false;
        }
        state.user = user;
        state.role = data.role || 'admin';
        setVisible('loginView', false);
        setVisible('deniedView', false);
        $('adminView')?.classList.remove('admin-hidden');
        if ($('adminPageLabel')) $('adminPageLabel').textContent = document.body.dataset.adminPage || 'admin';
        // 세션 확인은 첫 로드 + onAuthStateChange(INITIAL_SESSION·SIGNED_IN·TOKEN_REFRESHED)로 여러 번 돈다.
        // 각 페이지 init이 버튼·클릭 핸들러를 다시 붙이지 않게 ready는 페이지당 한 번만 알린다.
        if (!state.readyFired) {
            state.readyFired = true;
            document.dispatchEvent(new CustomEvent('admin:ready', { detail: { user, role: state.role } }));
        }
        return true;
    }

    async function login(ev) {
        ev?.preventDefault();
        const email = value('loginEmail').trim();
        const password = value('loginPassword');
        const status = $('loginStatus');
        if (status) status.textContent = '로그인 중';
        const { error } = await window.AdminApi.auth.signIn(email, password);
        if (error) {
            if (status) status.textContent = errorText(error);
            return false;
        }
        if (status) status.textContent = '';
        await requireAdmin();
        return false;
    }

    async function logout() {
        await window.AdminApi.auth.signOut();
        location.reload();
    }

    async function loadMembers(force = false) {
        if (state.members && !force) return state.members;
        const { data, error } = await window.AdminApi.members.list();
        if (error) throw error;
        state.members = data || [];
        return state.members;
    }

    async function loadSiteConfig(force = false) {
        if (state.siteConfig && !force) return state.siteConfig;
        const { data, error } = await window.AdminApi.siteConfig.get('nav');
        if (error) throw error;
        state.siteConfig = data?.config_value || {};
        return state.siteConfig;
    }

    async function saveSiteConfig(config) {
        const { error } = await window.AdminApi.siteConfig.save(config, 'nav');
        if (error) throw error;
        state.siteConfig = config;
        document.dispatchEvent(new CustomEvent('admin:site-config-saved', { detail: config }));
    }

    async function nextSourceOrder(table) {
        const { data, error } = await window.AdminApi.nextSourceOrder(table);
        if (error) throw error;
        return Number(data?.[0]?.source_order || 0) + 1;
    }

    async function uploadMedia(file, folder, stem) {
        if (!file) return null;
        const ext =
            String(file.name || '')
                .split('.')
                .pop()
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '') || 'bin';
        const safeStem = String(stem || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '-');
        const path = `${folder}/${safeStem}-${Date.now()}.${ext}`;
        // 경로에 올린 시각이 붙어 파일마다 주소가 달라서, 브라우저가 1년 동안 다시 받지 않게 해도 된다
        // (기본 1시간이면 방송통계 움짤 같은 큰 파일을 한 시간마다 다시 받는다)
        const { error } = await window.AdminApi.media.upload(path, file, { upsert: false, cacheControl: '31536000' });
        if (error) throw error;
        return path;
    }

    function mediaUrl(path) {
        if (!path) return '';
        return window.AdminApi.media.publicUrl(path);
    }

    async function audit(action, entity, entityId, details = {}) {
        try {
            await window.AdminApi.audit(action, entity, String(entityId ?? ''), details);
        } catch (_) {
            /* migration may not yet be installed; primary operation must still surface its own error */
        }
    }

    function setEditMode(enabled) {
        state.editMode = !!enabled;
        document.body.classList.toggle('admin-edit-disabled', !state.editMode);
        const btn = $('adminEditModeButton');
        if (btn) {
            btn.setAttribute('aria-pressed', state.editMode ? 'true' : 'false');
            btn.textContent = state.editMode ? '편집 모드' : '보기 모드';
        }
        document.dispatchEvent(new CustomEvent('admin:edit-mode', { detail: { enabled: state.editMode } }));
    }

    // 사이트 빌드: 스타유니브 빌드(build.yml)를 바로 실행한다. 멤버·전적·연혁·대표 영상처럼 빌드 때 만드는
    // 데이터와 달력 사진(calendar.png)이 00:05·12:05 정기 빌드를 기다리지 않고 2~3분 안에 공개 사이트에 반영된다.
    // GitHub 토큰은 브라우저에 두지 않는다 - Supabase 함수가 Vault의 토큰으로 GitHub에 요청한다
    // (supabase/staruniv.sql 5절의 calendar_capture). 응답 코드를 잠깐 확인해 실패를 알린다.
    async function requestSiteBuild(btn) {
        if (btn.disabled || !state.client) return;
        const idle = btn.textContent;
        btn.disabled = true;
        btn.textContent = '빌드 요청 중';
        try {
            const { data: requestId, error } = await window.AdminApi.calendarCapture.request();
            if (error) {
                if (
                    /admin_request_calendar_capture/.test(error.message || '') &&
                    /(find|exist)/i.test(error.message || '')
                )
                    throw new Error('Supabase에 supabase/staruniv.sql을 먼저 실행해야 합니다');
                throw error;
            }
            let status = null,
                detail = '';
            for (let i = 0; i < 10 && status === null; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const res = await window.AdminApi.calendarCapture.status(requestId);
                const row = (res.data || [])[0];
                if (row && (row.status_code !== null || row.error)) {
                    status = row.status_code;
                    detail = row.error || '';
                }
            }
            if (status === null && !detail) toast('빌드를 요청했습니다. 2~3분 뒤 공개 사이트에 반영됩니다');
            else if (status >= 200 && status < 300) toast('빌드를 시작했습니다. 2~3분 뒤 공개 사이트에 반영됩니다');
            else throw new Error(`GitHub가 요청을 거절했습니다(${status || '응답 없음'}) ${detail}`.trim());
        } catch (e) {
            toast(errorText(e), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = idle;
        }
    }

    // 관리 버튼은 두 곳에 나눈다.
    // - 히어로 편집(설명 · 서브탭): 그 페이지 히어로(.page-header) 안. PC는 서브탭 줄 오른쪽 끝, 좁은 화면은 히어로 오른쪽 위.
    // - 추가 · 관리(멤버 추가 · 연혁 추가 · 새 매치 등): 히어로 바로 아래 줄. 스크롤해도 상단바 밑에 붙어 있다.
    //   scope(그 버튼이 속한 서브탭 화면)가 보일 때만 나온다 - 일정 탭에서는 '연혁 추가'가 보이지 않는다.
    // 전용 관리 화면(전적 · 티어표 · 팀)은 히어로를 직접 그리므로 pageToolsHtml을 히어로 바로 뒤에 넣는다.
    function toolButtonHtml({ id, label, icon = 'plus', scope = '' }) {
        return `<button type="button" class="admin-tool-btn" id="${esc(id)}" data-icon="${esc(icon)}"${scope ? ` data-scope="${esc(scope)}"` : ''}>${esc(label)}</button>`;
    }
    function pageToolsHtml(items) {
        return `<div class="admin-action-bar"><div class="admin-action-bar-inner"><span class="admin-action-bar-label">EDIT</span>${items.map(toolButtonHtml).join('')}</div></div>`;
    }
    const activeHeader = () =>
        document.querySelector('.page-section.active > .page-header') ||
        document.querySelector('.page-section > .page-header');
    function bindTool(id, onClick) {
        const b = document.getElementById(id);
        if (b && onClick) b.addEventListener('click', onClick);
        return b;
    }
    function addHeroTool({ id, label, icon = 'edit', onClick }) {
        if (document.getElementById(id)) return document.getElementById(id);
        const header = activeHeader();
        if (!header) return null;
        let box = document.getElementById('adminHeroTools');
        if (!box) {
            header.insertAdjacentHTML(
                'beforeend',
                '<div class="admin-hero-tools" id="adminHeroTools"><span class="admin-hero-tools-label">EDIT</span></div>'
            );
            box = document.getElementById('adminHeroTools');
        }
        box.insertAdjacentHTML('beforeend', toolButtonHtml({ id, label, icon }));
        return bindTool(id, onClick);
    }
    function addPageTool({ id, label, icon = 'plus', onClick, scope = '' }) {
        if (document.getElementById(id)) return document.getElementById(id);
        let bar = document.getElementById('adminActionBar');
        if (!bar) {
            const header = activeHeader();
            if (!header) return null;
            header.insertAdjacentHTML('afterend', pageToolsHtml([]));
            bar = header.nextElementSibling;
            bar.id = 'adminActionBar';
            watchActionScopes();
        }
        bar.querySelector('.admin-action-bar-inner').insertAdjacentHTML(
            'beforeend',
            toolButtonHtml({ id, label, icon, scope })
        );
        const b = bindTool(id, onClick);
        syncActionBars();
        return b;
    }
    // 버튼마다 scope 화면이 지금 보이는지 보고 보이는 것만 남긴다. 남는 버튼이 없으면 줄째로 숨긴다.
    function syncActionBars() {
        let on = false;
        qa('.admin-action-bar').forEach(bar => {
            let any = false;
            bar.querySelectorAll('.admin-tool-btn').forEach(b => {
                const scope = b.dataset.scope;
                const show = !scope || !!document.querySelector(scope)?.getClientRects().length;
                if (b.hidden === show) b.hidden = !show;
                any = any || show;
            });
            if (bar.hidden === any) bar.hidden = !any;
            if (any && bar.getClientRects().length) on = true;
        });
        if (document.body.classList.contains('admin-actions-on') !== on)
            document.body.classList.toggle('admin-actions-on', on);
    }
    function watchActionScopes() {
        if (state.actionWatch || typeof MutationObserver === 'undefined') return;
        let queued = false;
        state.actionWatch = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            setTimeout(() => {
                queued = false;
                syncActionBars();
            }, 0);
        });
        state.actionWatch.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'hidden'],
        });
    }

    function bindCommonUi() {
        $('adminBuildButton')?.addEventListener('click', ev => requestSiteBuild(ev.currentTarget));
        $('loginForm')?.addEventListener('submit', login);
        $('adminLogoutButton')?.addEventListener('click', logout);
        $('deniedLogout')?.addEventListener('click', logout);
        $('adminEditModeButton')?.addEventListener('click', () => setEditMode(!state.editMode));
        qa('[data-admin-close]').forEach(el => el.addEventListener('click', () => closeDrawer()));
        window.addEventListener('beforeunload', ev => {
            if (!state.dirty) return;
            ev.preventDefault();
            ev.returnValue = '';
        });
    }

    async function init() {
        bindCommonUi();
        const cfg = window.STARUNIV_SUPABASE_CONFIG || window.SUPABASE_CONFIG || {};
        if (!window.supabase || !cfg.url || !cfg.key) {
            setVisible('configError', true);
            return;
        }
        // 관리자 페이지끼리 이동해도 같은 Supabase Auth 세션을 유지한다.
        // 공개 조회용 publicSupabaseClient()는 persistSession:false 이므로 관리자 전용 클라이언트를 쓴다.
        state.client = window.supabase.createClient(cfg.url, cfg.key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'staruniv-admin-auth',
            },
        });
        if (!state.client) {
            setVisible('configError', true);
            return;
        }
        setVisible('configError', false);

        window.AdminApi.auth.onChange(session => {
            if (session?.user) {
                queueMicrotask(() => requireAdmin().catch(err => console.error('관리자 세션 확인 실패:', err)));
            } else {
                state.user = null;
                setVisible('loginView', true);
                setVisible('deniedView', false);
                $('adminView')?.classList.add('admin-hidden');
            }
        });

        await requireAdmin();
    }

    window.AdminCore = {
        state,
        $,
        q,
        qa,
        esc,
        value,
        empty,
        intOrNull,
        normalizeGender,
        field,
        input,
        textarea,
        select,
        checkbox,
        viewTabsHtml,
        bindViewTabs,
        toast,
        markDirty,
        setSaveState,
        openDrawer,
        closeDrawer,
        errorText,
        requireAdmin,
        loadMembers,
        loadSiteConfig,
        saveSiteConfig,
        nextSourceOrder,
        uploadMedia,
        mediaUrl,
        audit,
        setEditMode,
        addHeroTool,
        addPageTool,
        pageToolsHtml,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
