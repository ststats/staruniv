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
    const esc = value => escapeHTML(value); // core.js가 먼저 로드된다
    const value = id => $(id)?.value ?? '';
    const empty = v => String(v ?? '').trim() || null;
    const intOrNull = v => (String(v ?? '').trim() === '' ? null : Number(v));
    // DB도 저장할 때 같은 규칙으로 맞춘다(staruniv.sql 9번)
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
        $('adminDrawerEyebrow').textContent = opts.eyebrow || '';
        $('adminDrawerEyebrow').hidden = !opts.eyebrow;
        $('adminDrawerTitle').textContent = opts.title || '편집';
        $('adminDrawerBody').innerHTML = opts.html || '';
        const del = $('adminDrawerDelete');
        del.hidden = !opts.onDelete;
        $('adminDrawerSave').hidden = !opts.onSubmit;
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
        // 스크롤바 자리는 CSS scrollbar-gutter가 남긴다. 그걸 못 쓰는 브라우저만 여백으로 메운다.
        if (!document.body.classList.contains('admin-drawer-open')) {
            const scrollbar = window.innerWidth - document.documentElement.clientWidth;
            if (scrollbar > 0 && !(CSS.supports && CSS.supports('scrollbar-gutter', 'stable')))
                document.body.style.setProperty('--drawer-lock-gap', `${scrollbar}px`);
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
        // 세션 확인은 여러 번 돌므로(onAuthStateChange) 핸들러가 겹쳐 붙지 않게 ready는 한 번만 알린다.
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
        // 경로에 시각이 붙어 주소가 매번 달라서 1년 캐시해도 된다(기본 1시간이면 큰 움짤을 자주 다시 받는다).
        const { error } = await window.AdminApi.media.upload(path, file, { upsert: false, cacheControl: '31536000' });
        if (error) throw error;
        return path;
    }

    function mediaUrl(path) {
        if (!path) return '';
        // 저장소에 둔 대표 영상(templates/static/media/members/)은 사이트 파일 그대로
        if (/^media\/members\/[a-z0-9_-]+\.[a-z0-9]+(\?v=[0-9a-f]+)?$/.test(path)) return path;
        return window.AdminApi.media.publicUrl(path);
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

    // 정기 빌드를 기다리지 않고 build.yml을 실행한다(전적 데이터·달력 사진). 토큰은 DB의 Vault에 있다(staruniv.sql 4번).
    async function requestSiteBuild(btn) {
        if (btn.disabled || !state.client) return;
        const idle = btn.textContent;
        btn.disabled = true;
        btn.textContent = '빌드 요청 중';
        try {
            const { data: requestId, error } = await window.AdminApi.calendarCapture.request();
            if (error) throw error;
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

    // 히어로 편집 버튼은 히어로 안, 추가·관리 버튼은 히어로 아래 줄에 둔다. scope는 버튼이 속한 서브탭 화면이다.
    function toolButtonHtml({ id, label, icon = 'plus', scope = '' }) {
        return `<button type="button" class="admin-tool-btn" id="${esc(id)}" data-icon="${esc(icon)}"${scope ? ` data-scope="${esc(scope)}"` : ''}>${esc(label)}</button>`;
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
            header.insertAdjacentHTML('beforeend', '<div class="admin-hero-tools" id="adminHeroTools"></div>');
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
            header.insertAdjacentHTML(
                'afterend',
                '<div class="admin-action-bar"><div class="admin-action-bar-inner"></div></div>'
            );
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
        const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
        if (!window.supabase || !cfg.url || !cfg.key) {
            setVisible('configError', true);
            return;
        }
        // 공개 읽기(api.js)는 로그인 없는 작은 클라이언트라 로그인은 supabase-js로 따로 둔다.
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
        setEditMode,
        addHeroTool,
        addPageTool,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
