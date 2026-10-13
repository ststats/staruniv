(function () {
    'use strict';
    const C = () => window.AdminCore;
    let rows = [];
    let people = null; // 티어표 선수(연결용): {id,nickname,soop_id,tier}
    async function loadPeople() {
        if (people) return people;
        people = await AdminApi.tierMembers.all('id,nickname,soop_id,tier');
        return people;
    }
    const low = v =>
        String(v || '')
            .trim()
            .toLowerCase();
    // 연동은 DB 트리거가 SOOP ID로 한다. 창에는 연동 상태만 보여 준다.
    function linkStatus(list, soop) {
        if (!low(soop)) return 'SOOP ID를 적으면 같은 SOOP ID의 티어표 선수와 연동됩니다';
        const p = list.find(x => low(x.soop_id) === low(soop));
        return p
            ? `티어표 연동: <b>${C().esc(p.nickname)}</b>${p.tier ? ` · ${C().esc(p.tier)}${/^\d$/.test(p.tier) ? '티어' : ''}` : ''} (SOOP ID·생년월일·성별·지금 티어는 티어표 값을 씁니다)`
            : '이 SOOP ID는 티어표에 없어 연동되지 않습니다(여기 적은 값을 그대로 씁니다)';
    }

    // refresh: 화면도 공개 읽기 함수로 다시 받아 관리자가 방문자와 같은 화면을 보게 한다.
    async function load(refresh = false) {
        rows = await C().loadMembers(true);
        if (!refresh) return;
        SiteDataLoad.loaded.delete('members');
        SiteDataLoad.loaded.delete('profiles');
        await loadSiteData(['members', 'profiles']);
        const error = SiteDataLoad.errors.get('members') || SiteDataLoad.errors.get('profiles');
        if (error) throw error;
        renderMembersPage();
    }

    function opts(values, selected) {
        return values
            .map(
                v =>
                    `<option value="${C().esc(v)}"${String(v) === String(selected || '') ? ' selected' : ''}>${C().esc(v || '선택')}</option>`
            )
            .join('');
    }

    function youtubeUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (/^@[\w.\-]+$/.test(raw)) return 'https://www.youtube.com/' + raw;
        let url;
        try {
            url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
        } catch (e) {
            throw new Error('YouTube 주소 형식이 올바르지 않습니다');
        }
        const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
        if (host !== 'youtube.com' && host !== 'youtu.be')
            throw new Error('YouTube 칸에는 youtube.com 주소나 @핸들만 넣을 수 있습니다');
        url.protocol = 'https:';
        return url.href;
    }

    // 대표 영상을 1280×720·30fps·무음·최대 6초 H.264 MP4로 다시 만든다(방송통계에서 끊기지 않는 크기). 못 하면 null.
    // 소프트웨어 인코더(OpenH264 Baseline)를 먼저 쓴다: 하드웨어 인코더는 그래픽 칩마다 결과가 달라 첫 장면에서 멈춘
    // 영상이 나온 적이 있다. 레벨 3.1이 1280×720 30fps까지 받는다.
    const CLIP = {
        w: 1280,
        h: 720,
        fps: 30,
        maxSec: 6,
        bitrate: 2_500_000,
        codecs: [
            {
                encoder: 'avc1.42001f',
                muxer: 'avc',
                extra: { avc: { format: 'avc' }, hardwareAcceleration: 'prefer-software' },
            },
            { encoder: 'avc1.4d401f', muxer: 'avc', extra: { avc: { format: 'avc' } } },
        ],
    };
    async function pickCodec() {
        for (const c of CLIP.codecs) {
            const config = {
                codec: c.encoder,
                width: CLIP.w,
                height: CLIP.h,
                bitrate: CLIP.bitrate,
                framerate: CLIP.fps,
                ...c.extra,
            };
            try {
                if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, muxer: c.muxer };
            } catch (e) {}
        }
        return null;
    }
    async function encodeClip(file, onProgress) {
        if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || !window.Mp4Muxer) return null;
        const codec = await pickCodec();
        if (!codec) return null;
        const config = codec.config;
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = url;
        // 아이폰 등은 영상을 미리 불러오지 않아 멈출 수 있어 제한 시간을 두고 재생을 한 번 걸어 불러오게 한다
        const within = (promise, ms, msg) =>
            Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms))]);
        try {
            const loaded = new Promise((ok, no) => {
                video.onloadeddata = ok;
                video.onerror = () => no(new Error('이 브라우저에서 열 수 없는 영상입니다'));
            });
            video.load();
            video
                .play()
                .then(() => video.pause())
                .catch(() => {});
            await within(loaded, 10000, '영상을 불러오지 못했습니다(시간 초과)');
            const vw = video.videoWidth,
                vh = video.videoHeight;
            if (!vw || !vh) throw new Error('영상 크기를 읽지 못했습니다');
            // 16:9가 아니면 가운데를 잘라 쓴다(사진 칸도 가운데 기준으로 채운다)
            const scale = Math.max(CLIP.w / vw, CLIP.h / vh),
                sw = CLIP.w / scale,
                sh = CLIP.h / scale,
                sx = (vw - sw) / 2,
                sy = (vh - sh) / 2;
            const canvas = document.createElement('canvas');
            canvas.width = CLIP.w;
            canvas.height = CLIP.h;
            const ctx = canvas.getContext('2d');
            const muxer = new Mp4Muxer.Muxer({
                target: new Mp4Muxer.ArrayBufferTarget(),
                video: { codec: codec.muxer, width: CLIP.w, height: CLIP.h, frameRate: CLIP.fps },
                fastStart: 'in-memory',
            });
            let failure = null;
            const encoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: e => {
                    failure = e;
                },
            });
            encoder.configure(config);
            const total = Math.max(1, Math.floor(Math.min(video.duration || 0, CLIP.maxSec) * CLIP.fps));
            for (let i = 0; i < total; i++) {
                if (failure) throw failure;
                const t = i / CLIP.fps;
                await within(
                    new Promise(ok => {
                        video.onseeked = ok;
                        video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
                    }),
                    5000,
                    '영상 장면을 읽지 못했습니다(시간 초과)'
                );
                ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CLIP.w, CLIP.h);
                const frame = new VideoFrame(canvas, {
                    timestamp: Math.round(t * 1e6),
                    duration: Math.round(1e6 / CLIP.fps),
                });
                encoder.encode(frame, { keyFrame: i % (CLIP.fps * 2) === 0 });
                frame.close();
                if (encoder.encodeQueueSize > 10) await new Promise(ok => setTimeout(ok, 0));
                onProgress?.((i + 1) / total);
            }
            await encoder.flush();
            if (failure) throw failure;
            encoder.close();
            muxer.finalize();
            const stem = String(file.name || 'clip').replace(/\.[^.]+$/, '');
            return new File([muxer.target.buffer], `${stem}.mp4`, { type: 'video/mp4' });
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function open(row) {
        row = row || {};
        const list = await loadPeople().catch(() => []);
        C().openDrawer({
            eyebrow: 'MEMBER',
            title: row.id ? '멤버 수정' : '멤버 추가',
            html: `
        <div class="admin-form-grid">
          ${C().field('이름', C().input('am_name', row.name || '', 'text', 'required'))}
          ${C().field('닉네임', C().input('am_nick', row.nickname || '', 'text', 'required'))}
          ${C().field('SOOP ID', C().input('am_soop', row.soop_id || ''))}
          ${C().field('ELO ID(전적 분석 버튼용)', C().input('am_elo', row.elo_id ?? '', 'number', 'min="1" placeholder="비우면 전적 분석 버튼 없음"'))}
          ${C().field('직책', C().input('am_role', row.role || ''))}
          ${C().field('티어(지금)', C().input('am_tier', row.tier || ''))}
          ${C().field('입단 티어', C().input('am_join_tier', row.join_tier || ''))}
          ${C().field('종족', `<select class="admin-input" id="am_race">${opts(['', '테란', '저그', '프로토스'], row.race)}</select>`)}
          ${C().field('성별', `<select class="admin-input" id="am_gender">${opts(['', '남자', '여자'], C().normalizeGender(row.gender))}</select>`)}
          ${C().field('생년월일', C().input('am_birth', row.birth_date || '', 'date'))}
          ${C().field('MBTI', C().input('am_mbti', row.mbti || '', 'text', 'maxlength="8"'))}
          ${C().field('입단일', C().input('am_joined', row.joined_date || '', 'date'))}
          ${C().field('퇴단일', C().input('am_left', row.left_date || '', 'date'))}
          ${C().field('YouTube', C().input('am_youtube', row.youtube_url || '', 'text', 'placeholder="https://www.youtube.com/@채널 또는 @핸들"'))}
        </div>
        <p class="admin-help" id="am_link">${linkStatus(list, row.soop_id)}</p>
        <p class="admin-help">닉네임·종족·입단 티어·직책·입단일·퇴단일·ELO ID는 이 입단 기록의 값입니다</p>
        <p class="admin-help">활동 상태는 별도 필드 없이 퇴단일 유무로 판단합니다. 일반적인 운영에서는 삭제 대신 퇴단일을 입력하세요</p>
        <div class="admin-preview-row"><div><b>현재 프로필</b><div class="admin-media-preview">${row.avatar_path ? `<img src="${C().esc(C().mediaUrl(row.avatar_path))}" alt="">` : ''}</div></div></div>
        ${C().field('프로필 사진', `<input class="admin-input" id="am_avatar" type="file" accept="image/*">`)}
        <div class="admin-preview-row"><div><b>대표 사진·영상(방송통계 TOP)</b><div class="admin-media-preview">${row.photo_path ? (/\.(mp4|webm)$/i.test(row.photo_path) ? `<video src="${C().esc(C().mediaUrl(row.photo_path))}" muted loop autoplay playsinline></video>` : `<img src="${C().esc(C().mediaUrl(row.photo_path))}" alt="">`) : ''}</div></div></div>
        ${C().field('대표 사진·영상', `<input class="admin-input" id="am_photo" type="file" accept="video/mp4,video/webm,video/*,image/webp,image/gif,image/png,image/jpeg">`)}
        <p class="admin-help" id="am_photo_status"></p>
        <p class="admin-help">영상을 고르면 저장할 때 자동으로 1280×720 · 30fps · 소리 없음 · 최대 6초 MP4로 줄여서 올립니다(16:9가 아니면 가운데를 잘라 맞춤). PC 크롬·엣지에서 올려 주세요(모바일은 줄이지 못할 수 있음). 사진·움짤은 그대로 올라갑니다. 얼굴이 가운데~위쪽에 오게 해 주세요${row.photo_path ? ` · <label><input type="checkbox" id="am_photo_clear"> 대표 사진 지우기</label>` : ''}</p>
      `,
            onSubmit: async () => {
                const payload = {
                    name: C().value('am_name').trim(),
                    nickname: C().value('am_nick').trim(),
                    soop_id: C().empty(C().value('am_soop')),
                    elo_id: C().intOrNull(C().value('am_elo')),
                    role: C().empty(C().value('am_role')),
                    tier: C().empty(C().value('am_tier')),
                    join_tier: C().empty(C().value('am_join_tier')),
                    race: C().empty(C().value('am_race')),
                    gender: C().empty(C().value('am_gender')),
                    birth_date: C().empty(C().value('am_birth')),
                    mbti: C().empty(C().value('am_mbti')),
                    joined_date: C().empty(C().value('am_joined')),
                    left_date: C().empty(C().value('am_left')),
                    youtube_url: youtubeUrl(C().value('am_youtube')),
                    avatar_path: row.avatar_path || null,
                    photo_path: document.getElementById('am_photo_clear')?.checked ? null : row.photo_path || null,
                };

                if (!payload.name || !payload.nickname) throw new Error('이름과 닉네임은 필수입니다');
                const file = document.getElementById('am_avatar')?.files?.[0];
                if (file)
                    payload.avatar_path = await C().uploadMedia(file, 'members', payload.soop_id || payload.nickname);
                let photo = document.getElementById('am_photo')?.files?.[0];
                if (photo && /^video\//.test(photo.type)) {
                    const status = document.getElementById('am_photo_status');
                    const say = t => {
                        if (status) status.textContent = t;
                    };
                    say('영상 편집 중(1280×720 · 30fps · 소리 없음)');
                    const before = photo.size;
                    let why = '';
                    const clip = await encodeClip(photo, p => say(`영상 편집 중 ${Math.round(p * 100)}%`)).catch(e => {
                        why = C().errorText(e);
                        return null;
                    });
                    if (clip) {
                        photo = clip;
                        say(`편집 완료: ${Math.round(before / 1024)}KB → ${Math.round(clip.size / 1024)}KB`);
                    } else {
                        // 저장소는 MP4·WebM만 받는다(아이폰 .mov는 안 됨)
                        say(why ? `영상 편집 실패: ${why}` : '이 브라우저는 영상 자동 편집을 지원하지 않습니다');
                        if (!/^video\/(mp4|webm)$/.test(photo.type))
                            throw new Error(
                                '이 기기에서는 영상을 줄일 수 없고 원본 형식(MP4·WebM만 가능)도 올릴 수 없습니다. PC 크롬·엣지에서 올리거나 채팅으로 보내 주세요'
                            );
                        if (
                            !confirm(
                                `${why ? `영상 편집에 실패했습니다(${why})` : '이 브라우저는 영상 자동 편집을 지원하지 않습니다'}\n원본(${Math.round(before / 1024)}KB)을 그대로 올릴까요? 줄여서 올리려면 PC 크롬·엣지에서 다시 올려 주세요`
                            )
                        )
                            throw new Error('영상 올리기를 취소했습니다');
                    }
                }
                if (photo) {
                    if (photo.size > 10 * 1024 * 1024)
                        throw new Error('대표 사진은 10MB 이하만 올릴 수 있습니다(2MB 이하 권장)');
                    payload.photo_path = await C().uploadMedia(
                        photo,
                        'members-photo',
                        payload.soop_id || payload.nickname
                    );
                }
                let error;
                if (row.id) ({ error } = await AdminApi.members.update(row.id, payload));
                else {
                    payload.source_order = await C().nextSourceOrder('members');
                    ({ error } = await AdminApi.members.insert(payload));
                }
                if (error) throw error;
                C().toast('멤버를 저장했습니다');
                await load(true);
            },
            onDelete: row.id
                ? async () => {
                      const { count, error: countErr } = await AdminApi.rounds.countOfOurPlayer(
                          row.nickname || row.name || ''
                      );
                      if (countErr) throw countErr;
                      if (
                          Number(count || 0) > 0 &&
                          !confirm(`이 멤버 이름이 연결된 세트가 ${count}개 있습니다. 그래도 실제 삭제할까요?`)
                      )
                          return;
                      const { error } = await AdminApi.members.remove(row.id);
                      if (error) throw error;
                      C().toast('멤버를 삭제했습니다');
                      await load(true);
                  }
                : null,
            deleteConfirm: '멤버 삭제는 연결 데이터에 영향을 줄 수 있습니다. 계속할까요?',
        });
        const soopEl = document.getElementById('am_soop'),
            linkEl = document.getElementById('am_link');
        if (soopEl && linkEl)
            soopEl.addEventListener('input', () => {
                linkEl.innerHTML = linkStatus(list, soopEl.value);
            });
    }

    async function init() {
        if (document.body.dataset.adminPage !== 'members') return;
        await load();
        if (document.getElementById('members-groups'))
            C().addPageTool({
                id: 'adminMemberAdd',
                label: '멤버 추가',
                icon: 'plus',
                scope: '#view-member-status',
                onClick: () => open(null),
            });
        document.addEventListener(
            'click',
            ev => {
                if (!C().state.editMode) return;
                const card = ev.target.closest('.member-card[data-member]');
                if (!card) return;
                ev.preventDefault();
                ev.stopPropagation();
                const name = card.dataset.member;
                const row = rows.find(r => r.nickname === name) || rows.find(r => r.name === name);
                if (row) open(row);
            },
            true
        );
    }
    document.addEventListener('admin:ready', init);
})();
