(function () {
    'use strict';
    const C = () => window.AdminCore;
    let rows = [];
    async function load() {
        const { data, error } = await AdminApi.tools.list();
        if (error) throw error;
        rows = data || [];
        const grouped = { extTools: { items: [] }, extSites: { items: [] } };
        // 관리자 화면은 끈 도구도 흐리게 보여 준다
        rows.forEach(r => {
            (grouped[r.category] || grouped.extTools).items.push({ ...r });
        });
        renderExternalTools(grouped);
        requestAnimationFrame(() =>
            document.querySelectorAll('.tool-card[data-tool-id]').forEach(card => {
                const row = rows.find(r => String(r.id) === card.dataset.toolId);
                card.classList.toggle('admin-config-hidden', !!row && !row.active);
            })
        );
    }
    function open(row) {
        row = row || { category: 'extTools', name: '', url: '', favicon: '', source_order: '', active: true };
        C().openDrawer({
            eyebrow: 'TOOL',
            title: row.id ? '외부 도구 수정' : '새 도구',
            html: `
        ${C().field(
            '구분',
            C().select(
                'at_category',
                [
                    ['extTools', '도구'],
                    ['extSites', '사이트'],
                ],
                row.category
            )
        )}
        ${C().field('이름', C().input('at_name', row.name || '', 'text', 'required'))}
        ${C().field('URL', C().input('at_url', row.url || '', 'url', 'required'))}
        ${C().field('파비콘', C().input('at_favicon', row.favicon || '', 'url'))}
        <div class="admin-form-grid">
          ${C().field('표시 순서', C().input('at_order', row.source_order ?? '', 'number', 'min="0"'))}
          ${C().field('표시 여부', C().checkbox('at_active', row.id ? !!row.active : true, '표시'))}
        </div>`,
            onSubmit: async () => {
                const url = C().value('at_url').trim();
                if (!/^https?:\/\//i.test(url)) throw new Error('URL은 http:// 또는 https://로 시작해야 합니다');
                const dup = rows.find(
                    r => r.url.toLowerCase() === url.toLowerCase() && String(r.id) !== String(row.id || '')
                );
                if (dup && !confirm(`같은 URL이 이미 "${dup.name}"에 등록돼 있습니다. 그래도 저장할까요?`))
                    throw new Error('중복 URL 저장을 취소했습니다');
                const payload = {
                    category: C().value('at_category'),
                    name: C().value('at_name').trim(),
                    url,
                    favicon: C().empty(C().value('at_favicon')),
                    source_order: Number(C().value('at_order') || (await C().nextSourceOrder('external_tools'))),
                    active: !!document.getElementById('at_active')?.checked,
                    updated_at: new Date().toISOString(),
                };
                let error;
                if (row.id) ({ error } = await AdminApi.tools.update(row.id, payload));
                else ({ error } = await AdminApi.tools.insert(payload));
                if (error) throw error;
                C().toast('도구를 저장했습니다');
                await load();
            },
            onDelete: row.id
                ? async () => {
                      const { error } = await AdminApi.tools.remove(row.id);
                      if (error) throw error;
                      await load();
                  }
                : null,
        });
    }
    // ----- 캄몬라이더 선수 얼굴: 지금 멤버마다 정사각형 얼굴을 올린다(비우면 게임의 기본 그림) -----
    const FACE_OUT = 256; // 게임은 96px로 그리고, 확대 화면에서도 흐리지 않게 넉넉히 저장한다
    const FACE_STAGE = 280;
    async function openRiderFaces() {
        const { data, error } = await AdminApi.members.list();
        if (error) throw error;
        const members = (data || []).filter(m => !m.left_date);
        const faceHtml = m =>
            m.rider_face_path
                ? `<img src="${C().esc(storageMediaUrl(m.rider_face_path))}" alt="">`
                : '<span>기본</span>';
        C().openDrawer({
            eyebrow: 'CALMMON RIDER',
            title: '선수 얼굴',
            html: `<p class="admin-help">선수를 눌러 얼굴을 올립니다. 올리지 않은 선수는 게임에 들어 있는 그림(없으면 헬멧)을 씁니다</p>
        <div class="admin-rider-faces">${members
            .map(
                m =>
                    `<button type="button" class="admin-rider-face" data-rider-face="${C().esc(m.id)}">${faceHtml(m)}<b>${C().esc(m.nickname || m.name)}</b></button>`
            )
            .join('')}</div>`,
        });
        document
            .querySelectorAll('[data-rider-face]')
            .forEach(b =>
                b.addEventListener('click', () =>
                    openFaceEditor(members.find(m => String(m.id) === b.dataset.riderFace))
                )
            );
    }
    function openFaceEditor(m) {
        const crop = { img: null, zoom: 1, x: 0, y: 0 };
        C().openDrawer({
            eyebrow: 'CALMMON RIDER',
            title: `${m.nickname || m.name} 얼굴`,
            html: `<div class="admin-face-stage"><canvas id="arf_canvas" width="${FACE_STAGE}" height="${FACE_STAGE}"></canvas></div>
        ${C().field('이미지', '<input class="admin-input" id="arf_file" type="file" accept="image/*">')}
        ${C().field('확대', '<input id="arf_zoom" type="range" min="1" max="4" step="0.01" value="1">')}
        <p class="admin-help">끌어서 얼굴을 원 안에 맞춥니다. 캐릭터 카드에서 얼굴 부분만 잘라 올리면 됩니다</p>`,
            onSubmit: async () => {
                if (!crop.img) throw new Error('이미지를 골라 주세요');
                const out = document.createElement('canvas');
                out.width = out.height = FACE_OUT;
                drawCrop(out.getContext('2d'), crop, FACE_OUT);
                const blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.9));
                if (!blob) throw new Error('이미지를 만들지 못했습니다');
                const path = await C().uploadMedia(
                    new File([blob], 'face.webp', { type: 'image/webp' }),
                    'rider-faces',
                    m.soop_id || m.nickname
                );
                await saveFace(m, path);
            },
            onDelete: m.rider_face_path ? () => saveFace(m, null) : null,
            deleteLabel: '기본 그림으로',
            deleteConfirm: '올린 얼굴을 지우고 게임의 기본 그림으로 되돌릴까요?',
        });
        const canvas = document.getElementById('arf_canvas'),
            ctx = canvas.getContext('2d'),
            zoom = document.getElementById('arf_zoom');
        const redraw = () => {
            ctx.clearRect(0, 0, FACE_STAGE, FACE_STAGE);
            if (crop.img) drawCrop(ctx, crop, FACE_STAGE);
        };
        if (m.rider_face_path) loadCropImage(storageMediaUrl(m.rider_face_path), crop, redraw);
        document.getElementById('arf_file').addEventListener('change', ev => {
            const file = ev.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            loadCropImage(url, crop, () => {
                URL.revokeObjectURL(url);
                Object.assign(crop, { zoom: 1, x: 0, y: 0 });
                zoom.value = '1';
                redraw();
            });
        });
        zoom.addEventListener('input', () => {
            crop.zoom = Number(zoom.value);
            redraw();
        });
        let drag = null;
        canvas.addEventListener('pointerdown', ev => {
            drag = { x: ev.clientX, y: ev.clientY, ox: crop.x, oy: crop.y };
            canvas.setPointerCapture(ev.pointerId);
        });
        canvas.addEventListener('pointermove', ev => {
            if (!drag) return;
            const k = FACE_STAGE / canvas.getBoundingClientRect().width;
            crop.x = drag.ox + (ev.clientX - drag.x) * k;
            crop.y = drag.oy + (ev.clientY - drag.y) * k;
            redraw();
        });
        canvas.addEventListener('pointerup', () => (drag = null));
    }
    function loadCropImage(src, crop, done) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            crop.img = img;
            done();
        };
        img.onerror = () => C().toast('이미지를 열지 못했습니다', 'error');
        img.src = src;
    }
    // 짧은 변을 칸에 맞춘 뒤 확대·이동한다. 이동량은 미리보기 칸(FACE_STAGE) 기준이라 출력 크기에 맞춰 늘린다.
    function drawCrop(ctx, crop, size) {
        const { img } = crop,
            k = size / FACE_STAGE,
            scale = (size / Math.min(img.naturalWidth, img.naturalHeight)) * crop.zoom,
            w = img.naturalWidth * scale,
            h = img.naturalHeight * scale;
        ctx.drawImage(img, (size - w) / 2 + crop.x * k, (size - h) / 2 + crop.y * k, w, h);
    }
    async function saveFace(m, path) {
        const { error } = await AdminApi.members.update(m.id, { rider_face_path: path });
        if (error) throw error;
        C().toast(path ? '얼굴을 저장했습니다' : '기본 그림으로 되돌렸습니다');
        // 열려 있는 게임을 다시 불러 바로 보이게 한다
        const frame = document.getElementById('rider-frame');
        if (frame?.getAttribute('src')) frame.src = frame.getAttribute('src');
    }

    async function init() {
        if (document.body.dataset.adminPage !== 'tools') return;
        window.toolCardAdminExtra = tool =>
            C().state.editMode
                ? `<button type="button" class="admin-card-action" data-admin-tool="${C().esc(tool.id)}">편집</button>`
                : '';
        await load();
        const ext = document.getElementById('view-tools-external');
        if (ext)
            C().addPageTool({
                id: 'adminToolAdd',
                label: '새 도구',
                icon: 'plus',
                scope: '#view-tools-external',
                onClick: () => open(null),
            });
        if (document.getElementById('view-tools-rider'))
            C().addPageTool({
                id: 'adminRiderFaces',
                label: '선수 얼굴',
                icon: 'edit',
                scope: '#view-tools-rider',
                onClick: () => openRiderFaces().catch(e => C().toast(C().errorText(e), 'error')),
            });
        document.addEventListener(
            'click',
            ev => {
                const b = ev.target.closest('[data-admin-tool]');
                if (!b) return;
                ev.preventDefault();
                ev.stopPropagation();
                open(rows.find(r => String(r.id) === b.dataset.adminTool));
            },
            true
        );
    }
    document.addEventListener('admin:ready', init);
})();
