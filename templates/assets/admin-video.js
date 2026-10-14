(function () {
    'use strict';
    const C = () => window.AdminCore;
    let channels = [],
        videos = [],
        picks = [];

    function youtubeId(url) {
        const s = String(url || '').trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
        return (s.match(/(?:youtu\.be\/|v=|shorts\/)([A-Za-z0-9_-]{11})/) || [])[1] || '';
    }
    function soopId(url) {
        const s = String(url || '').trim();
        const n = (s.match(/(?:vod|player)\/?(\d{1,20})/) || s.match(/(\d{5,20})/) || [])[1];
        return n ? `soop:${n}` : '';
    }
    function pickUrl(row) {
        if (row.kind === 'soop') {
            const no = String(row.id || '').replace(/^soop:/, '');
            return no ? `https://vod.sooplive.co.kr/player/${no}` : '';
        }
        return row.id ? `https://www.youtube.com/watch?v=${row.id}` : '';
    }

    function syncRows() {
        channels = Object.values(VideoState.data.channels);
        videos = [...VideoState.data.videos, ...VideoState.data.top, ...VideoState.data.shorts];
        picks = VideoState.data.picks;
    }
    document.addEventListener('video:data', syncRows);

    async function refresh() {
        if ((await loadVideoData(C().state.client)) === false) throw new Error(VIDEO_LOAD_FAILED);
    }

    const saveRenamed = (table, key, oldKey, payload) => AdminApi.video.saveKeyed(table, key, oldKey, payload);

    function openChannel(row) {
        row = row || {};
        C().openDrawer({
            eyebrow: 'CHANNEL',
            title: row.channel_url ? '팬튜브 채널 수정' : '팬튜브 채널 추가',
            html: `
        ${C().field('채널 URL', C().input('avc_url', row.channel_url || '', 'url', 'required'))}
        ${C().field('표시 이름', C().input('avc_name', row.display_name || row.title || '', 'text', 'required'))}
        <div class="admin-form-grid">
          ${C().field('표시 순서', C().input('avc_order', row.source_order ?? '', 'number', 'min="0"'))}
          ${C().field('사용 여부', C().checkbox('avc_active', row.channel_url ? !!row.active : true, '사용'))}
        </div>`,
            onSubmit: async () => {
                const url = C().value('avc_url').trim();
                if (!/^https?:\/\//i.test(url)) throw new Error('올바른 채널 URL을 입력하세요');
                const payload = {
                    channel_url: url,
                    display_name: C().value('avc_name').trim(),
                    source_order: Number(C().value('avc_order') || (await C().nextSourceOrder('video_channels'))),
                    active: !!document.getElementById('avc_active')?.checked,
                    updated_at: new Date().toISOString(),
                };
                await saveRenamed('video_channels', 'channel_url', row.channel_url, { ...row, ...payload });
                C().toast('채널을 저장했습니다');
                await refresh();
            },
        });
    }

    function openChannelList() {
        C().openDrawer({
            eyebrow: 'CHANNELS',
            title: '팬튜브 채널',
            html: `<button type="button" class="admin-btn primary" id="avc_add">+ 채널 추가</button>
        <div class="admin-list">${channels.map((r, i) => `<button type="button" class="admin-list-row" data-channel-index="${i}"><b>${C().esc(r.display_name || r.title || r.channel_url)}</b><span>${r.active ? '사용' : '중지'} · ${r.source_order}</span></button>`).join('')}</div>`,
        });
        document.getElementById('avc_add').onclick = () => openChannel(null);
        document
            .querySelectorAll('[data-channel-index]')
            .forEach(b => (b.onclick = () => openChannel(channels[Number(b.dataset.channelIndex)])));
    }

    async function toggleHidden(id, hidden) {
        const { error } = await AdminApi.video.setHidden(id, hidden);
        if (error) throw error;
        C().toast(hidden ? '영상을 숨겼습니다' : '영상을 표시했습니다');
        await refresh();
    }

    // 오타로 분류가 갈라지지 않게 기존 값을 골라 쓰게 한다. 분류 영문은 분류마다 하나다.
    const uniq = list => [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];
    const groupEnOf = name =>
        String((picks.find(p => p.group_name === name && String(p.group_en || '').trim()) || {}).group_en || '').trim();
    const datalist = (id, values) =>
        `<datalist id="${id}">${values.map(v => `<option value="${C().esc(v)}"></option>`).join('')}</datalist>`;
    const youtubeThumb = id => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
    // 비운 제목·채널 이름을 채운다. 숲 VOD는 다른 사이트의 조회를 막아 '숲 VOD'로 둔다.
    const SOOP_DEFAULT = '숲 VOD';
    const oembedCache = new Map();
    function youtubeMeta(id) {
        if (!oembedCache.has(id)) {
            const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`;
            oembedCache.set(
                id,
                fetch(url)
                    .then(r => (r.ok ? r.json() : null))
                    .then(j =>
                        j ? { title: String(j.title || '').trim(), author: String(j.author_name || '').trim() } : null
                    )
                    .catch(() => null)
            );
        }
        return oembedCache.get(id);
    }
    async function fillPickMeta() {
        const url = C().value('avp_url').trim(),
            y = youtubeId(url),
            s = !y && soopId(url);
        const title = document.getElementById('avp_title'),
            author = document.getElementById('avp_author');
        if (!title || !author || (!y && !s)) return;
        const meta = y ? await youtubeMeta(y) : { title: SOOP_DEFAULT, author: SOOP_DEFAULT };
        if (!meta || C().value('avp_url').trim() !== url) return; // 기다리는 사이 주소가 바뀌었으면 버린다
        if (!title.value.trim() && meta.title) title.value = meta.title;
        if (!author.value.trim() && meta.author) author.value = meta.author;
    }

    function openPick(row) {
        row = row || {
            kind: 'youtube',
            title: '',
            note: '',
            group_name: '',
            group_en: '',
            author: '',
            thumb: '',
            source_order: '',
            short: false,
            hidden: false,
        };
        const groupEn = String(row.group_en || '').trim() || groupEnOf(row.group_name);
        C().openDrawer({
            eyebrow: 'PICK',
            title: row.id ? '보자 영상 수정' : '영상 추가',
            html: `
        ${C().field('YouTube 또는 SOOP URL', C().input('avp_url', row.id ? pickUrl(row) : '', 'url', 'required'))}
        ${C().field('제목', C().input('avp_title', row.title || ''), '비우면 YouTube 제목, 숲 VOD는 "숲 VOD"')}
        <div class="admin-form-grid">
          ${C().field('분류', C().input('avp_group', row.group_name || '', 'text', 'list="avp_groups" autocomplete="off"'), '기존 분류에서 고르거나 새로 적기')}
          ${C().field('분류 영문', C().input('avp_group_en', groupEn, 'text', 'placeholder="예: MONSTARZ"'), '제목 위 작은 라벨 · 분류마다 하나')}
          ${C().field('작성자', C().input('avp_author', row.author || '', 'text', 'list="avp_authors" autocomplete="off"'), '채널 이름 · 비우면 자동으로 채움')}
          ${C().field('표시 순서', C().input('avp_order', row.source_order ?? '', 'number', 'min="0"'), row.id ? '' : '비우면 맨 뒤')}
        </div>
        ${C().field('썸네일', C().input('avp_thumb', row.thumb || '', 'url'), '비우면 자동 · 숲 VOD는 저장 후 다음 정기 수집 때 반영')}
        <div class="admin-media-preview" id="avp_preview"></div>
        ${C().field('설명', C().textarea('avp_note', row.note || '', 'rows="2"'), '선택 · 카드 제목 아래에 나옴')}
        <div class="admin-form-grid">${C().field('쇼츠', C().checkbox('avp_short', !!row.short, '쇼츠'))}${C().field('숨김', C().checkbox('avp_hidden', !!row.hidden, '숨김'))}</div>
        ${datalist('avp_groups', uniq(picks.map(p => p.group_name)))}${datalist('avp_authors', uniq(picks.map(p => p.author)))}`,
            onSubmit: async () => {
                const url = C().value('avp_url').trim();
                const y = youtubeId(url),
                    s = soopId(url);
                if (!y && !s) throw new Error('지원하는 YouTube 또는 SOOP URL이 아닙니다');
                const id = y || s,
                    kind = y ? 'youtube' : 'soop';
                const group = C().empty(C().value('avp_group').trim());
                const groupEn = C().empty(C().value('avp_group_en').trim());
                await fillPickMeta();
                const title = C().value('avp_title').trim();
                if (!title) throw new Error('YouTube 제목을 가져오지 못했습니다. 제목을 적어 주세요');
                const payload = {
                    id,
                    kind,
                    title,
                    note: C().empty(C().value('avp_note')),
                    group_name: group,
                    group_en: groupEn,
                    author: C().empty(C().value('avp_author').trim()),
                    thumb: C().empty(C().value('avp_thumb')),
                    source_order: Number(C().value('avp_order') || (await C().nextSourceOrder('video_picks'))),
                    short: !!document.getElementById('avp_short')?.checked,
                    hidden: !!document.getElementById('avp_hidden')?.checked,
                    updated_at: new Date().toISOString(),
                };
                await saveRenamed('video_picks', 'id', row.id, payload);
                // 분류 영문은 분류마다 하나라 같은 분류의 다른 영상도 같이 바꾼다
                if (group && groupEn && groupEn !== groupEnOf(group)) {
                    const { error: en } = await AdminApi.video.setPickGroupEn(group, groupEn);
                    if (en) throw en;
                }
                C().toast('보자 영상을 저장했습니다');
                await refresh();
            },
            onDelete: row.id
                ? async () => {
                      const { error } = await AdminApi.video.removePick(row.id);
                      if (error) throw error;
                      await refresh();
                  }
                : null,
        });
        const preview = () => {
            const t = C().value('avp_thumb').trim() || youtubeThumb(youtubeId(C().value('avp_url')));
            document.getElementById('avp_preview').innerHTML = t ? `<img src="${C().esc(t)}" alt="">` : '';
        };
        document.getElementById('avp_thumb')?.addEventListener('input', preview);
        document.getElementById('avp_url')?.addEventListener('input', preview);
        // 직접 적은 영문은 덮지 않는다
        let enTouched = false;
        document.getElementById('avp_group_en')?.addEventListener('input', () => {
            enTouched = true;
        });
        document.getElementById('avp_group')?.addEventListener('input', ev => {
            const en = groupEnOf(ev.target.value.trim());
            if (!enTouched) document.getElementById('avp_group_en').value = en;
        });
        let metaTimer = 0;
        document.getElementById('avp_url')?.addEventListener('input', () => {
            clearTimeout(metaTimer);
            metaTimer = setTimeout(fillPickMeta, 400);
        });
        preview();
    }

    async function init() {
        if (document.body.dataset.adminPage !== 'video') return;
        window.videoCardAdminExtra = (v, opts) => {
            if (!C().state.editMode) return '';
            const row = opts?.pick
                ? picks.find(x => String(x.id) === String(v.id))
                : videos.find(x => String(x.id) === String(v.id));
            if (opts?.pick)
                return `<button type="button" class="admin-card-action" data-admin-pick="${C().esc(v.id)}">편집</button>`;
            return `<button type="button" class="admin-card-action" data-admin-video-toggle="${C().esc(v.id)}">${row?.hidden ? '표시' : '숨김'}</button>`;
        };
        await refresh();
        if (document.getElementById('video-channel-row'))
            C().addPageTool({
                id: 'adminVideoChannels',
                label: '채널 관리',
                icon: 'edit',
                scope: '#view-video-fantube',
                onClick: openChannelList,
            });
        if (document.getElementById('view-video-pick'))
            C().addPageTool({
                id: 'adminVideoPickAdd',
                label: '영상 추가',
                icon: 'plus',
                scope: '#view-video-pick',
                onClick: () => openPick(null),
            });
        document.addEventListener(
            'click',
            ev => {
                const p = ev.target.closest('[data-admin-pick]');
                if (p) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openPick(picks.find(x => String(x.id) === p.dataset.adminPick));
                    return;
                }
                const v = ev.target.closest('[data-admin-video-toggle]');
                if (v) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const r = videos.find(x => String(x.id) === v.dataset.adminVideoToggle);
                    toggleHidden(r.id, !r.hidden).catch(e => C().toast(C().errorText(e), 'error'));
                }
            },
            true
        );
    }
    document.addEventListener('admin:ready', init);
})();
