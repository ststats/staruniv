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
  const q = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => [...root.querySelectorAll(sel)];
  const esc = value => typeof escapeHTML === 'function' ? escapeHTML(value) :
    String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const value = id => $(id)?.value ?? '';
  const empty = v => String(v ?? '').trim() || null;
  const intOrNull = v => String(v ?? '').trim() === '' ? null : Number(v);

  function setVisible(id, visible) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('admin-hidden', !visible);
  }

  function setSaveState(text, kind='') {
    const el = $('adminSaveState');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  }

  function toast(message, kind='ok') {
    const el = $('adminToast');
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6500 : 3200);
  }

  function markDirty(dirty=true) {
    state.dirty = !!dirty;
    setSaveState(state.dirty ? '수정 중' : '저장됨', state.dirty ? 'dirty' : 'ok');
  }

  function field(label, input, help='') {
    return `<label class="admin-field"><span>${esc(label)}</span>${input}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
  }
  function input(id, val='', type='text', attrs='') {
    return `<input class="admin-input" id="${id}" type="${type}" value="${esc(val ?? '')}" ${attrs}>`;
  }
  function textarea(id, val='', attrs='') {
    return `<textarea class="admin-input admin-textarea" id="${id}" ${attrs}>${esc(val ?? '')}</textarea>`;
  }
  function select(id, options, selected, attrs='') {
    const html = options.map(opt => {
      const pair = Array.isArray(opt) ? opt : [opt,opt];
      return `<option value="${esc(pair[0])}"${String(pair[0])===String(selected ?? '')?' selected':''}>${esc(pair[1])}</option>`;
    }).join('');
    return `<select class="admin-input" id="${id}" ${attrs}>${html}</select>`;
  }
  function checkbox(id, checked, label) {
    return `<label class="admin-check"><input id="${id}" type="checkbox"${checked?' checked':''}><span>${esc(label)}</span></label>`;
  }

  function closeDrawer(force=false, saved=false) {
    if (state.dirty && !force && !confirm('저장하지 않은 변경사항이 있습니다. 닫을까요?')) return false;
    const drawer = $('adminDrawer');
    if (!drawer) return true;
    const opts = state.drawer;
    drawer.setAttribute('aria-hidden','true');
    document.body.classList.remove('admin-drawer-open');
    state.drawer = null;
    markDirty(false);
    if (!saved && typeof opts?.onCancel === 'function') opts.onCancel();
    return true;
  }

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
      setSaveState('저장 중','saving');
      $('adminDrawerSave').disabled = true;
      try {
        await opts.onSubmit?.(ev);
        markDirty(false);
        setSaveState('저장됨','ok');
        closeDrawer(true, true);
      } catch (err) {
        console.error(err);
        setSaveState('저장 실패','error');
        toast(`저장 실패: ${errorText(err)}`,'error');
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
        toast(`삭제 실패: ${errorText(err)}`,'error');
      } finally {
        state.saving = false;
        del.disabled = false;
      }
    };
    form.oninput = () => markDirty(true);
    drawer.setAttribute('aria-hidden','false');
    document.body.classList.add('admin-drawer-open');
    markDirty(false);
    requestAnimationFrame(() => q('input,select,textarea', $('adminDrawerBody'))?.focus());
  }

  function errorText(err) {
    return err?.message || err?.details || err?.hint || String(err || '알 수 없는 오류');
  }

  async function requireAdmin() {
    const { data: { user }, error } = await state.client.auth.getUser();
    if (error || !user) {
      state.user = null;
      setVisible('loginView', true);
      setVisible('deniedView', false);
      $('adminView')?.classList.add('admin-hidden');
      return false;
    }
    const { data, error: roleError } = await state.client
      .from('admin_users').select('role,is_active').eq('user_id', user.id).maybeSingle();
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
      document.dispatchEvent(new CustomEvent('admin:ready', { detail: { user, role: state.role }}));
    }
    return true;
  }

  async function login(ev) {
    ev?.preventDefault();
    const email = value('loginEmail').trim();
    const password = value('loginPassword');
    const status = $('loginStatus');
    if (status) status.textContent = '로그인 중';
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) {
      if (status) status.textContent = errorText(error);
      return false;
    }
    if (status) status.textContent = '';
    await requireAdmin();
    return false;
  }

  async function logout() {
    await state.client.auth.signOut();
    location.reload();
  }

  async function loadMembers(force=false) {
    if (state.members && !force) return state.members;
    const { data, error } = await state.client.from('members').select('*').order('source_order');
    if (error) throw error;
    state.members = data || [];
    return state.members;
  }

  async function loadSiteConfig(force=false) {
    if (state.siteConfig && !force) return state.siteConfig;
    const { data, error } = await state.client.from('site_config').select('config_value')
      .eq('config_key','nav').maybeSingle();
    if (error) throw error;
    state.siteConfig = data?.config_value || {};
    return state.siteConfig;
  }

  async function saveSiteConfig(config) {
    const { error } = await state.client.from('site_config').upsert({
      config_key: 'nav',
      config_value: config,
      updated_at: new Date().toISOString()
    }, { onConflict: 'config_key' });
    if (error) throw error;
    state.siteConfig = config;
    document.dispatchEvent(new CustomEvent('admin:site-config-saved', {detail: config}));
  }

  async function nextSourceOrder(table) {
    const { data, error } = await state.client.from(table).select('source_order')
      .order('source_order',{ascending:false}).limit(1);
    if (error) throw error;
    return Number(data?.[0]?.source_order || 0) + 1;
  }

  async function uploadMedia(file, folder, stem) {
    if (!file) return null;
    const ext = String(file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'bin';
    const safeStem = String(stem || Date.now()).replace(/[^a-zA-Z0-9_-]/g,'-');
    const path = `${folder}/${safeStem}-${Date.now()}.${ext}`;
    // 경로에 올린 시각이 붙어 파일마다 주소가 달라서, 브라우저가 1년 동안 다시 받지 않게 해도 된다
    // (기본 1시간이면 방송통계 움짤 같은 큰 파일을 한 시간마다 다시 받는다)
    const { error } = await state.client.storage.from('staruniv-media').upload(path, file, { upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return path;
  }

  function mediaUrl(path) {
    if (!path) return '';
    const { data } = state.client.storage.from('staruniv-media').getPublicUrl(path);
    return data?.publicUrl || '';
  }

  async function audit(action, entity, entityId, details={}) {
    try {
      await state.client.rpc('admin_write_audit', {
        p_action: action, p_entity: entity, p_entity_id: String(entityId ?? ''), p_details: details
      });
    } catch (_) { /* migration may not yet be installed; primary operation must still surface its own error */ }
  }

  function setEditMode(enabled) {
    state.editMode = !!enabled;
    document.body.classList.toggle('admin-edit-disabled', !state.editMode);
    const btn = $('adminEditModeButton');
    if (btn) {
      btn.setAttribute('aria-pressed', state.editMode ? 'true' : 'false');
      btn.textContent = state.editMode ? '편집 모드' : '보기 모드';
    }
    document.dispatchEvent(new CustomEvent('admin:edit-mode', {detail:{enabled:state.editMode}}));
  }

  function bindCommonUi() {
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
        storageKey: 'staruniv-admin-auth'
      }
    });
    if (!state.client) {
      setVisible('configError', true);
      return;
    }
    setVisible('configError', false);

    state.client.auth.onAuthStateChange((_event, session) => {
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
    state, $, q, qa, esc, value, empty, intOrNull, field, input, textarea, select, checkbox,
    toast, markDirty, setSaveState, openDrawer, closeDrawer, errorText, requireAdmin,
    loadMembers, loadSiteConfig, saveSiteConfig, nextSourceOrder, uploadMedia, mediaUrl,
    audit, setEditMode
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
