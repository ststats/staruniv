/**
 * 도구 > 움짤생성기(webp-maker.html): 영상에 텍스트·테두리를 얹어 움직이는 WebP로 만든다.
 * 영상은 서버로 보내지 않고 브라우저 안에서만 처리한다(캔버스 → 프레임마다 WebP → Animated WebP 조립).
 * 사이트 도구 페이지가 iframe으로 띄우고, 높이·테마는 page-tools.js가 맞춰 준다.
 */

// 사이트(스타대학)와 같은 테마 저장값을 쓴다. 사이트에서 테마를 바꾸면 page-tools.js가 여기 data-theme도
// 바꿔 주고, 다른 창에서 바꾼 것은 storage 이벤트로 따라간다.
function webpApplyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
try {
    webpApplyTheme(
        localStorage.getItem('staruniv-theme') ||
            (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );
} catch (e) {
    webpApplyTheme('light');
}
window.addEventListener('storage', e => {
    if (e.key === 'staruniv-theme' && e.newValue) webpApplyTheme(e.newValue);
});

// 본체: head에서 실리므로 화면 요소가 다 만들어진 뒤에 시작한다
document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const $$ = sel => document.querySelectorAll(sel);
    const show = (el, on) => el.classList.toggle('hidden', !on);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const round2 = v => Math.round(v * 100) / 100;
    const fireInput = el => el.dispatchEvent(new Event('input', { bubbles: true }));

    const video = $('video');
    const pv = $('preview');
    const pctx = pv.getContext('2d');

    const state = {
        loaded: false,
        converting: false,
        cancel: false,
        fileName: 'output',
        srcURL: null,
        resultURL: null,
        frame: 'none',
        crop: null,
        cropEditing: false,
        sel: { s: 0, e: 0 },
    };

    // ---------- 공통 입력 UI ----------
    function segmented(id, onPick) {
        const buttons = $$(`#${id} button`);
        const set = v => buttons.forEach(b => b.classList.toggle('on', b.dataset.v === v));
        buttons.forEach(b =>
            b.addEventListener('click', () => {
                onPick(b.dataset.v);
                set(b.dataset.v);
            })
        );
        return set;
    }

    // data-unit이 붙은 슬라이더 옆에 숫자 칸을 붙임 (px 값은 슬라이더 범위를 넘겨 입력 가능)
    $$('input[type=range][data-unit]').forEach(range => {
        const num = Object.assign(document.createElement('input'), { type: 'number', min: range.min });
        range.after(num);
        if (range.dataset.unit)
            num.after(
                Object.assign(document.createElement('span'), { className: 'unit', textContent: range.dataset.unit })
            );
        range._num = num;
        range.addEventListener('input', () => {
            num.value = range.value;
        });
        num.addEventListener('input', e => {
            if (num.value === '') return;
            e.stopPropagation();
            let v = Math.max(+range.min, +num.value);
            if (range.dataset.unit === 'px') range.max = Math.max(+range.max, v);
            else v = Math.min(+range.max, v);
            range.value = v;
            fireInput(range);
        });
        num.addEventListener('blur', () => {
            num.value = range.value;
        });
    });
    const syncNums = () =>
        $$('input[type=range][data-unit]').forEach(r => {
            r._num.value = r.value;
        });

    function stepNumber(input, dir, big) {
        const step = +input.step || 1;
        const decimals = (String(input.step).split('.')[1] || '').length;
        let v = (+input.value || 0) + dir * step * (big ? 10 : 1);
        if (input.min !== '') v = Math.max(+input.min, v);
        if (input.max !== '') v = Math.min(+input.max, v);
        input.value = +v.toFixed(decimals);
        fireInput(input);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $$('input[type=number]').forEach(input => {
        const wrap = Object.assign(document.createElement('span'), { className: 'stepper' });
        input.replaceWith(wrap);
        const button = (label, dir) => {
            const b = Object.assign(document.createElement('button'), {
                type: 'button',
                textContent: label,
                tabIndex: -1,
                title: 'Shift: ×10',
            });
            let delay, repeat;
            const stop = () => {
                clearTimeout(delay);
                clearInterval(repeat);
            };
            b.addEventListener('pointerdown', e => {
                e.preventDefault();
                stepNumber(input, dir, e.shiftKey);
                delay = setTimeout(() => {
                    repeat = setInterval(() => stepNumber(input, dir, e.shiftKey), 50);
                }, 350);
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
            return b;
        };
        wrap.append(button('−', -1), input, button('+', 1));
        // 칸에 포커스가 있을 때만 휠로 조절 (페이지 스크롤 중 실수로 바뀌지 않게)
        input.addEventListener(
            'wheel',
            e => {
                if (document.activeElement !== input) return;
                e.preventDefault();
                stepNumber(input, e.deltaY < 0 ? 1 : -1, e.shiftKey);
            },
            { passive: false }
        );
    });

    const SWATCHES = [
        ['#ffffff', '흰색'],
        ['#000000', '검정'],
        ['#3a3a3a', '진회색'],
        ['#ffe14d', '노랑'],
        ['#ff9f40', '주황'],
        ['#ff4b4b', '빨강'],
        ['#ff8fb1', '분홍'],
        ['#ffd1dc', '연분홍'],
        ['#4cd964', '초록'],
        ['#5ac8fa', '하늘'],
        ['#3478f6', '파랑'],
        ['#a974ff', '보라'],
        ['#8b5a3c', '갈색'],
    ];
    const closePalettes = () => $$('.swatches.open').forEach(p => p.classList.remove('open'));
    $$('input[type=color]').forEach(input => {
        const pop = Object.assign(document.createElement('div'), { className: 'swatches' });
        for (const [c, name] of SWATCHES) {
            const b = Object.assign(document.createElement('button'), { className: 'dot', title: name });
            b.dataset.c = c;
            b.style.background = c;
            b.addEventListener('click', () => {
                input.value = c;
                fireInput(input);
                closePalettes();
            });
            pop.append(b);
        }
        if (input.showPicker) {
            const custom = Object.assign(document.createElement('button'), {
                className: 'custom text-action',
                textContent: '다른 색 직접 고르기',
            });
            custom.addEventListener('click', () => {
                closePalettes();
                input.showPicker();
            });
            pop.append(custom);
        }
        input.closest('.row').append(pop);
        input.addEventListener('click', e => {
            e.preventDefault();
            const open = !pop.classList.contains('open');
            closePalettes();
            pop.style.left = input.offsetLeft + 'px';
            pop.classList.toggle('open', open);
        });
        input._mark = () =>
            pop.querySelectorAll('.dot').forEach(b => b.classList.toggle('on', b.dataset.c === input.value));
        input.addEventListener('input', input._mark);
        input._mark();
    });
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest('.swatches, input[type=color]')) closePalettes();
    });

    segmented('tabs', v => $$('[data-panel]').forEach(p => p.classList.toggle('show', p.dataset.panel === v)));

    // ---------- 영상 불러오기 ----------
    $('drop').addEventListener('click', () => $('file').click());
    $('newFile').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', e => {
        if (e.target.files[0]) loadFile(e.target.files[0]);
        e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(t =>
        document.addEventListener(t, e => {
            e.preventDefault();
            $('drop').classList.add('over');
        })
    );
    ['dragleave', 'drop'].forEach(t =>
        document.addEventListener(t, e => {
            e.preventDefault();
            $('drop').classList.remove('over');
        })
    );
    document.addEventListener('drop', e => {
        const f = [...(e.dataTransfer?.files || [])].find(
            f => f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|ogv)$/i.test(f.name)
        );
        if (f) loadFile(f);
    });

    function loadFile(file) {
        showError('');
        state.loaded = false;
        if (state.srcURL) URL.revokeObjectURL(state.srcURL);
        state.srcURL = URL.createObjectURL(file);
        state.fileName = file.name.replace(/\.[^.]+$/, '') || 'output';
        video.src = state.srcURL;
    }

    video.addEventListener('loadedmetadata', async () => {
        // 일부 WebM은 duration이 Infinity → 끝으로 탐색해야 실제 길이가 잡힘
        if (!isFinite(video.duration)) {
            await new Promise(resolve => {
                video.addEventListener('durationchange', function onChange() {
                    if (isFinite(video.duration)) {
                        video.removeEventListener('durationchange', onChange);
                        resolve();
                    }
                });
                video.currentTime = 1e9;
            });
        }
        const d = video.duration;
        $('seek').max = d;
        $('start').value = 0;
        $('end').value = $('start').max = $('end').max = round2(d);
        $('srcInfo').textContent = `원본 ${video.videoWidth}×${video.videoHeight} · ${d.toFixed(2)}초`;
        $('srcBadge').textContent = `원본 ${video.videoWidth}×${video.videoHeight}`;
        show($('srcBadge'), true);
        show($('drop'), false);
        show($('editor'), true);
        $('convert').disabled = false;
        state.loaded = true;
        state.crop = null;
        state.cropEditing = false;
        video.currentTime = 0;
        cropUI();
    });
    video.addEventListener('error', () =>
        showError('영상을 불러올 수 없어요. 브라우저가 지원하는 형식(MP4/H.264, WebM 등)인지 확인해주세요')
    );

    $('play').addEventListener('click', () => {
        if (!video.paused) return video.pause();
        const s = +$('start').value,
            e = +$('end').value;
        if (video.currentTime < s || video.currentTime >= e) video.currentTime = s;
        video.play();
    });
    video.addEventListener('play', () => {
        $('play').textContent = '❚❚';
    });
    video.addEventListener('pause', () => {
        $('play').textContent = '▶';
    });
    $('seek').addEventListener('input', e => {
        video.currentTime = +e.target.value;
    });
    $('setStart').addEventListener('click', () => {
        $('start').value = round2(video.currentTime);
        updateInfo();
    });
    $('setEnd').addEventListener('click', () => {
        $('end').value = round2(video.currentTime);
        updateInfo();
    });

    // ---------- 출력 설정 ----------
    function outSize() {
        const mode = $('sizeMode').value;
        let w, h;
        if (mode === 'orig') {
            const c = state.crop || { w: video.videoWidth, h: video.videoHeight };
            w = c.w;
            h = c.h;
        } else if (mode === 'custom') {
            w = +$('cw').value || 200;
            h = +$('ch').value || 200;
        } else {
            w = h = +mode;
        }
        const fix = v => clamp(Math.round(v), 1, 16383);
        return { w: fix(w), h: fix(h) };
    }
    // 원본 크기 모드에선 출력이 자르기 영역을 따라가므로 고정할 비율이 없음
    function outRatio() {
        if ($('sizeMode').value === 'orig') return null;
        const { w, h } = outSize();
        return w / h;
    }

    function keepAspect(changed) {
        if ($('lockAR').checked && state.loaded) {
            const c = state.crop || { w: video.videoWidth, h: video.videoHeight };
            if (changed === 'cw') $('ch').value = Math.round((+$('cw').value * c.h) / c.w);
            else $('cw').value = Math.round((+$('ch').value * c.w) / c.h);
        }
        refitCrop();
        updateInfo();
    }
    ['cw', 'ch'].forEach(id => $(id).addEventListener('input', () => keepAspect(id)));
    $('lockAR').addEventListener('change', () => keepAspect('cw'));
    $('sizeMode').addEventListener('change', () => {
        const m = $('sizeMode').value;
        show($('customSize'), m === 'custom');
        show($('fitRow'), m !== 'orig');
        refitCrop();
        cropUI();
    });
    ['start', 'end', 'fps', 'quality'].forEach(id => $(id).addEventListener('input', updateInfo));
    ['fps', 'lossless'].forEach(id => $(id).addEventListener('change', updateInfo));

    function updateInfo() {
        const lossless = $('lossless').checked;
        show($('qualityRow'), !lossless);
        $('qualityHint').textContent = lossless
            ? '원본 픽셀 그대로 저장해요. 화질은 최고지만 파일이 몇 배 커질 수 있어요'
            : '손실 압축: 색 경계(특히 빨강·분홍 외곽선)가 살짝 번질 수 있어요. 85 이상 추천';
        if (!state.loaded) return;
        const { w, h } = outSize();
        $('sizeInfo').textContent = `출력: ${w} × ${h} px`;
        const dur = +$('end').value - +$('start').value;
        const n = Math.max(1, Math.floor(dur * +$('fps').value));
        $('frameInfo').innerHTML =
            dur <= 0
                ? '<span class="err">끝 시간이 시작 시간보다 커야 해요</span>'
                : `길이 ${dur.toFixed(2)}초 · 약 ${n}프레임` +
                  (n > 300
                      ? ' <span class="warn">— 프레임이 많아 변환이 오래 걸리고 파일이 커질 수 있어요</span>'
                      : '');
    }

    // ---------- 텍스트 레이어 ----------
    const FIELDS = [
        'text',
        'font',
        'weight',
        'fsize',
        'color',
        'strokeColor',
        'strokeW',
        'outerColor',
        'outerW',
        'margin',
        'tFrom',
        'tTo',
    ];
    const readField = f => {
        const el = $(f);
        return el.type === 'range' || el.type === 'number' ? +el.value : el.value;
    };
    const LAYER_DEFAULTS = {
        ...Object.fromEntries(FIELDS.map(f => [f, readField(f)])),
        outline: 'single',
        anchor: 'bottom',
        x: 0.5,
        y: 0.88,
        timeOn: false,
    };
    // colors: 글자별 색 (null이면 기본 글자색)
    const newLayer = (base = {}) => ({
        ...LAYER_DEFAULTS,
        ...base,
        colors: [...(base.colors || [])],
        _box: null,
        _visible: false,
    });

    const layers = [newLayer()];
    let cur = 0;
    const layer = () => layers[cur];

    // 글자가 추가·삭제돼도 각 글자의 색이 따라가게 함. 새로 친 글자는 바로 앞 글자 색을 이어받음
    function remapColors(oldT, newT, cols) {
        cols = Array.from({ length: oldT.length }, (_, i) => cols[i] ?? null);
        let p = 0;
        while (p < oldT.length && p < newT.length && oldT[p] === newT[p]) p++;
        let q = 0;
        while (q < oldT.length - p && q < newT.length - p && oldT[oldT.length - 1 - q] === newT[newT.length - 1 - q])
            q++;
        const inherit = p > 0 && newT[p] !== '\n' ? cols[p - 1] : null;
        return [...cols.slice(0, p), ...Array(newT.length - p - q).fill(inherit), ...cols.slice(oldT.length - q)];
    }

    function saveLayer() {
        const L = layer();
        if ($('text').value !== L.text) L.colors = remapColors(L.text, $('text').value, L.colors);
        for (const f of FIELDS) L[f] = readField(f);
        L.timeOn = $('timeOn').checked;
        renderLayerTabs();
    }
    function loadLayer() {
        const L = layer();
        for (const f of FIELDS) $(f).value = L[f];
        $('timeOn').checked = L.timeOn;
        show($('timeGroup'), L.timeOn);
        outlineUI();
        setAnchor(L.anchor);
        syncNums();
        $$('input[type=color]').forEach(i => i._mark());
        updateSel();
        renderLayerTabs();
        ensureFont();
    }
    function renderLayerTabs() {
        const box = $('layerTabs');
        box.replaceChildren();
        const button = (text, cls, onClick) => {
            const b = Object.assign(document.createElement('button'), { textContent: text, className: cls });
            b.addEventListener('click', onClick);
            box.append(b);
            return b;
        };
        layers.forEach((L, i) => {
            const name = L.text.trim().split('\n')[0].slice(0, 10) || `텍스트 ${i + 1}`;
            const b = button((L.timeOn ? '⏱ ' : '') + name, i === cur ? 'on' : '', () => {
                cur = i;
                loadLayer();
            });
            b.title = L.timeOn ? `${L.tFrom}초 ~ ${L.tTo}초에만 보임` : '항상 보임';
        });
        button('+ 텍스트 추가', 'add', () => {
            layers.push(newLayer({ ...layer(), text: '', colors: [], anchor: 'middle', timeOn: false }));
            cur = layers.length - 1;
            loadLayer();
            $('text').focus();
        });
        if (layers.length > 1)
            button('삭제', 'del', () => {
                layers.splice(cur, 1);
                cur = Math.max(0, cur - 1);
                loadLayer();
            });
    }
    ['input', 'change'].forEach(t =>
        $('textCard').addEventListener(t, e => {
            if (e.target.closest('#layerTabs') || e.target.id === 'selColor') return;
            saveLayer();
            if (['text', 'font', 'weight'].includes(e.target.id)) ensureFont();
        })
    );

    const setAnchor = segmented('anchorMode', v => {
        layer().anchor = v;
    });
    const setOutline = segmented('outlineMode', v => {
        layer().outline = v;
        outlineUI();
    });
    function outlineUI() {
        const m = layer().outline;
        setOutline(m);
        show($('strokeRow'), m !== 'none');
        show($('outerRow'), m === 'double');
        $('strokeLabel').textContent = m === 'double' ? '안쪽 외곽선' : '외곽선 색';
    }

    $('timeOn').addEventListener('change', () => {
        if ($('timeOn').checked && +$('tTo').value <= +$('tFrom').value) {
            const now = video.currentTime || 0;
            $('tFrom').value = round2(now);
            $('tTo').value = round2(Math.min(video.duration || now + 1, now + 1));
        }
        show($('timeGroup'), $('timeOn').checked);
    });
    $('setFrom').addEventListener('click', () => {
        $('tFrom').value = round2(video.currentTime);
        saveLayer();
    });
    $('setTo').addEventListener('click', () => {
        $('tTo').value = round2(video.currentTime);
        saveLayer();
    });

    const fontSpec = (L, px) => `${L.weight} ${px}px ${L.font}`;
    async function ensureFont() {
        try {
            await Promise.all(layers.map(L => document.fonts.load(fontSpec(L, 40), L.text || '가A')));
        } catch {}
    }

    // ---------- 드래그한 글자만 색 바꾸기 ----------
    function updateSel() {
        const ta = $('text');
        state.sel = { s: ta.selectionStart, e: ta.selectionEnd };
        const n = state.sel.e - state.sel.s;
        $('selInfo').textContent = n > 0 ? `${n}글자 선택됨` : '텍스트를 드래그해서 선택';
        $('selInfo').classList.toggle('warn', n > 0);
    }
    ['select', 'keyup', 'mouseup', 'input', 'focus'].forEach(t => $('text').addEventListener(t, updateSel));
    document.addEventListener('selectionchange', () => {
        if (document.activeElement === $('text')) updateSel();
    });

    function paintSelection(color) {
        const L = layer(),
            { s, e } = state.sel;
        if (e <= s) {
            $('selInfo').textContent = '먼저 텍스트를 드래그해서 선택하세요';
            return;
        }
        L.colors = Array.from({ length: L.text.length }, (_, i) => (i >= s && i < e ? color : (L.colors[i] ?? null)));
    }
    $('selColor').addEventListener('input', () => paintSelection($('selColor').value));
    $('selApply').addEventListener('click', () => paintSelection($('selColor').value));
    $('selClear').addEventListener('click', () => {
        if (state.sel.e > state.sel.s) paintSelection(null);
        else layer().colors = [];
    });
    // 버튼을 눌러도 텍스트 선택이 풀리지 않게
    ['selApply', 'selClear'].forEach(id => $(id).addEventListener('mousedown', e => e.preventDefault()));

    // ---------- 사진 테두리 ----------
    segmented('frameMode', v => {
        state.frame = v;
        show($('frameRow'), v !== 'none');
        show($('frameOuterRow'), v === 'double');
        $('frameLabel').textContent = v === 'double' ? '안쪽 테두리' : '테두리 색';
    });

    // ---------- 그리기 ----------
    function readOpts() {
        return {
            fit: $('fit').value,
            bg: $('bg').value,
            radius: $('radiusOn').checked ? +$('radius').value : 0,
            frame: state.frame,
            frameW: state.frame === 'none' ? 0 : +$('frameW').value,
            frameOuterW: state.frame === 'double' ? +$('frameOuterW').value : 0,
            frameColor: $('frameColor').value,
            frameOuterColor: $('frameOuterColor').value,
        };
    }

    function drawText(ctx, w, h, L, t, o) {
        L._visible = false;
        if (!L.text.trim() || (L.timeOn && (t < L.tFrom || t > L.tTo))) return;
        const lines = L.text.split('\n');
        const n = lines.length;
        const size = Math.max(4, L.fsize);
        const lh = size * 1.22;
        ctx.font = fontSpec(L, size);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const sw = L.outline !== 'none' ? L.strokeW : 0;
        const ow = L.outline === 'double' ? L.outerW : 0;
        const pad = sw + ow;
        const metrics = lines.map(l => ctx.measureText(l || ' '));
        const asc = Math.max(...metrics.map(m => m.actualBoundingBoxAscent || size / 2));
        const desc = Math.max(...metrics.map(m => m.actualBoundingBoxDescent || size / 2));
        const maxW = Math.max(...metrics.map(m => m.width));

        let x = L.x * w;
        let y0 = L.y * h - ((n - 1) * lh) / 2;
        if (L.anchor) {
            // 실제 글자 높이 + 외곽선 + 사진 테두리 두께까지 고려해 붙임
            const margin = o.frameW + o.frameOuterW + L.margin;
            x = w / 2;
            if (L.anchor === 'top') y0 = margin + pad + asc;
            else if (L.anchor === 'bottom') y0 = h - margin - pad - desc - (n - 1) * lh;
            else y0 = (h - (asc + (n - 1) * lh + desc)) / 2 + asc;
        }
        const strokeLines = (width, color) => {
            ctx.lineWidth = width * 2; // 선의 절반은 글자에 덮이므로 두 배로 그림
            ctx.strokeStyle = color;
            lines.forEach((ln, i) => ctx.strokeText(ln, x, y0 + i * lh));
        };
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        if (ow > 0) strokeLines(sw + ow, L.outerColor);
        if (sw > 0) strokeLines(sw, L.strokeColor);

        let gi = 0;
        lines.forEach((ln, i) => {
            const y = y0 + i * lh;
            const cols = L.colors.slice(gi, gi + ln.length);
            gi += ln.length + 1;
            if (!cols.some(Boolean)) {
                ctx.fillStyle = L.color;
                ctx.fillText(ln, x, y);
                return;
            }
            const left = x - ctx.measureText(ln).width / 2;
            ctx.textAlign = 'left';
            for (let j = 0; j < ln.length;) {
                const c = cols[j] || L.color;
                let k = j + 1;
                while (k < ln.length && (cols[k] || L.color) === c) k++;
                ctx.fillStyle = c;
                ctx.fillText(ln.slice(j, k), left + ctx.measureText(ln.slice(0, j)).width, y);
                j = k;
            }
            ctx.textAlign = 'center';
        });

        L._visible = true;
        L._cx = x;
        L._cy = y0 + ((n - 1) * lh) / 2;
        L._box = {
            x1: x - maxW / 2 - pad,
            y1: y0 - asc - pad,
            x2: x + maxW / 2 + pad,
            y2: y0 + (n - 1) * lh + desc + pad,
        };
    }

    // 크게 줄일 때 한 번에 줄이면 뭉개지므로 절반씩 단계적으로 줄임
    const stepCanvases = [document.createElement('canvas'), document.createElement('canvas')];
    function drawScaled(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
        let i = 0;
        while (sw / 2 >= dw && sh / 2 >= dh) {
            const nw = Math.round(sw / 2),
                nh = Math.round(sh / 2);
            const t = stepCanvases[i++ % 2];
            if (t.width !== nw || t.height !== nh) {
                t.width = nw;
                t.height = nh;
            }
            const tc = t.getContext('2d');
            tc.imageSmoothingQuality = 'high';
            tc.drawImage(src, sx, sy, sw, sh, 0, 0, nw, nh);
            src = t;
            sx = 0;
            sy = 0;
            sw = nw;
            sh = nh;
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    // clip=false: 모서리 바깥까지 그대로 채운 그림(투명 없음) - 압축용 색을 얻을 때만 쓴다(convert 주석)
    function drawFrame(ctx, w, h, t, o = readOpts(), clip = true) {
        const c = state.crop || { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
        let sx = c.x,
            sy = c.y,
            sw = c.w,
            sh = c.h,
            dx = 0,
            dy = 0,
            dw = w,
            dh = h;
        if (o.fit === 'cover') {
            const s = Math.max(w / c.w, h / c.h);
            sw = w / s;
            sh = h / s;
            sx += (c.w - sw) / 2;
            sy += (c.h - sh) / 2;
        } else if (o.fit === 'contain') {
            const s = Math.min(w / c.w, h / c.h);
            dw = c.w * s;
            dh = c.h * s;
            dx = (w - dw) / 2;
            dy = (h - dh) / 2;
        }
        const r = Math.min(o.radius, Math.min(w, h) / 2);
        const shape = new Path2D();
        if (r > 0 && shape.roundRect) shape.roundRect(0, 0, w, h, r);
        else shape.rect(0, 0, w, h);

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        if (clip) ctx.clip(shape);
        ctx.fillStyle = o.bg;
        ctx.fillRect(0, 0, w, h);
        drawScaled(ctx, video, sx, sy, sw, sh, dx, dy, dw, dh);
        if (o.frame !== 'none') {
            // 클립 안쪽 절반만 보이므로 두께를 두 배로 그림 → 출력 크기는 그대로
            ctx.lineJoin = 'round';
            ctx.lineWidth = (o.frameW + o.frameOuterW) * 2;
            ctx.strokeStyle = o.frameColor;
            ctx.stroke(shape);
            if (o.frameOuterW > 0) {
                ctx.lineWidth = o.frameOuterW * 2;
                ctx.strokeStyle = o.frameOuterColor;
                ctx.stroke(shape);
            }
        }
        ctx.restore();
        layers.forEach(L => drawText(ctx, w, h, L, t, o));
    }

    // ---------- 미리보기 ----------
    // 재생 중이거나 뭔가 바뀌었을 때만 다시 그림
    let dirty = true;
    const requestDraw = () => {
        dirty = true;
    };
    ['input', 'change', 'click', 'pointerdown', 'keyup'].forEach(t => document.addEventListener(t, requestDraw, true));
    ['seeked', 'loadeddata', 'timeupdate', 'pause'].forEach(t => video.addEventListener(t, requestDraw));
    document.fonts.addEventListener('loadingdone', requestDraw);
    window.addEventListener('resize', requestDraw);

    function loop() {
        requestAnimationFrame(loop);
        if (!state.loaded || state.converting) return;
        if (!video.paused) {
            if (video.currentTime >= +$('end').value) video.currentTime = +$('start').value;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        $('seek').value = video.currentTime;
        $('timeLabel').textContent = `${video.currentTime.toFixed(2)} / ${video.duration.toFixed(2)}`;
        if (state.cropEditing) return drawCropEditor();

        const { w, h } = outSize();
        if (pv.width !== w || pv.height !== h) {
            pv.width = w;
            pv.height = h;
        }
        drawFrame(pctx, w, h, video.currentTime);
        const b = layer()._box;
        if (layers.length > 1 && layer()._visible) {
            const dash = Math.max(3, w / 80);
            pctx.save();
            pctx.setLineDash([dash, dash]);
            pctx.lineWidth = Math.max(1, w / 300);
            pctx.strokeStyle = '#7c9cff';
            pctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
            pctx.restore();
        }
    }
    requestAnimationFrame(loop);

    // 텍스트를 누르면 선택, 빈 곳을 누르면 선택된 텍스트를 그 자리로 옮김
    let textDrag = null,
        cropDrag = null;
    function canvasPoint(e) {
        const r = pv.getBoundingClientRect();
        return { x: ((e.clientX - r.left) / r.width) * pv.width, y: ((e.clientY - r.top) / r.height) * pv.height };
    }
    function moveText(p) {
        const L = layer();
        L.x = clamp((p.x + textDrag.ox) / pv.width, 0, 1);
        L.y = clamp((p.y + textDrag.oy) / pv.height, 0, 1);
        if (L.anchor) {
            L.anchor = null;
            setAnchor(null);
        }
    }
    pv.addEventListener('pointerdown', e => {
        if (state.converting) return;
        pv.setPointerCapture(e.pointerId);
        if (state.cropEditing) return cropPointerDown(e);
        const p = canvasPoint(e);
        const hit = layers.findLastIndex(
            ({ _visible, _box: b }) => _visible && p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2
        );
        if (hit >= 0 && hit !== cur) {
            cur = hit;
            loadLayer();
        }
        if (hit >= 0) textDrag = { ox: layer()._cx - p.x, oy: layer()._cy - p.y };
        else {
            textDrag = { ox: 0, oy: 0 };
            moveText(p);
        }
    });
    pv.addEventListener('pointermove', e => {
        if (state.cropEditing) cropPointerMove(e);
        else if (textDrag) moveText(canvasPoint(e));
        if (textDrag || cropDrag) requestDraw();
    });
    ['pointerup', 'pointercancel'].forEach(t =>
        pv.addEventListener(t, () => {
            textDrag = cropDrag = null;
        })
    );

    // ---------- 자르기 (state.crop은 원본 영상 픽셀 기준) ----------
    const cropScale = () => Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
    const handleSize = () => (14 * pv.width) / (pv.getBoundingClientRect().width || pv.width);

    // 중심을 유지한 채 비율 R로 맞추고 원본 안에 들어가게 함
    function fitRatio(c, R) {
        const vw = video.videoWidth,
            vh = video.videoHeight;
        let w = c.w,
            h = c.h;
        if (w / h > R) w = h * R;
        else h = w / R;
        if (w > vw) {
            w = vw;
            h = w / R;
        }
        if (h > vh) {
            h = vh;
            w = h * R;
        }
        return { x: clamp(c.x + (c.w - w) / 2, 0, vw - w), y: clamp(c.y + (c.h - h) / 2, 0, vh - h), w, h };
    }
    function refitCrop() {
        const R = $('cropLock').checked && state.crop && outRatio();
        if (R) {
            state.crop = fitRatio(state.crop, R);
            cropUI();
        }
    }
    function cropUI() {
        const c = state.crop;
        show($('cropNums'), !!c);
        if (c)
            for (const [id, v] of [
                ['cropX', c.x],
                ['cropY', c.y],
                ['cropW', c.w],
                ['cropH', c.h],
            ])
                if (document.activeElement !== $(id)) $(id).value = Math.round(v);
        $('cropReset').disabled = !c;
        $('cropLock').disabled = $('sizeMode').value === 'orig';
        // 원본 크기일 때는 맞출 비율이 없으므로, 자르는 중이면서 출력 크기를 정해 둔 때만 보인다
        show($('cropLockWrap'), state.cropEditing && $('sizeMode').value !== 'orig');
        $('cropToggle').textContent = state.cropEditing ? '자르기 완료' : '자르기';
        $('cropToggle').classList.toggle('on', state.cropEditing);
        $('previewHint').textContent = state.cropEditing
            ? '자르기: 박스를 드래그해서 옮기고, 모서리로 크기 조절. 바깥에서 드래그하면 새로 그려요'
            : '미리보기에서 텍스트를 드래그해서 위치를 옮길 수 있어요';
        updateInfo();
    }
    $('cropToggle').addEventListener('click', () => {
        if (!state.loaded) return;
        state.cropEditing = !state.cropEditing;
        if (state.cropEditing && !state.crop) {
            const full = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
            const R = $('cropLock').checked && outRatio();
            state.crop = R ? fitRatio(full, R) : full;
        }
        cropUI();
    });
    $('cropReset').addEventListener('click', () => {
        state.crop = null;
        state.cropEditing = false;
        cropUI();
    });
    $('cropLock').addEventListener('change', refitCrop);

    function setCrop(x, y, w, h, keep) {
        const vw = video.videoWidth,
            vh = video.videoHeight;
        w = clamp(w, 8, vw);
        h = clamp(h, 8, vh);
        const R = $('cropLock').checked && outRatio();
        if (R) {
            if (keep === 'h') w = h * R;
            else h = w / R;
            if (w > vw) {
                w = vw;
                h = w / R;
            }
            if (h > vh) {
                h = vh;
                w = h * R;
            }
        }
        state.crop = { x: clamp(x, 0, vw - w), y: clamp(y, 0, vh - h), w, h };
        cropUI();
    }
    ['cropX', 'cropY', 'cropW', 'cropH'].forEach(id => {
        $(id).addEventListener('input', () => {
            if ($(id).value === '' || !state.crop) return;
            setCrop(
                +$('cropX').value,
                +$('cropY').value,
                +$('cropW').value,
                +$('cropH').value,
                id === 'cropH' ? 'h' : 'w'
            );
        });
        $(id).addEventListener('blur', () => setTimeout(cropUI));
    });

    function drawCropEditor() {
        const s = cropScale();
        const W = Math.round(video.videoWidth * s),
            H = Math.round(video.videoHeight * s);
        if (pv.width !== W || pv.height !== H) {
            pv.width = W;
            pv.height = H;
        }
        pctx.imageSmoothingQuality = 'high';
        pctx.drawImage(video, 0, 0, W, H);
        const { x, y, w, h } = Object.fromEntries(Object.entries(state.crop).map(([k, v]) => [k, v * s]));
        pctx.save();
        pctx.fillStyle = 'rgba(0,0,0,0.6)';
        pctx.beginPath();
        pctx.rect(0, 0, W, H);
        pctx.rect(x, y, w, h);
        pctx.fill('evenodd');
        pctx.strokeStyle = 'rgba(255,255,255,0.35)';
        pctx.lineWidth = 1;
        pctx.beginPath();
        for (const k of [1, 2]) {
            pctx.moveTo(x + (w * k) / 3, y);
            pctx.lineTo(x + (w * k) / 3, y + h);
            pctx.moveTo(x, y + (h * k) / 3);
            pctx.lineTo(x + w, y + (h * k) / 3);
        }
        pctx.stroke();
        pctx.strokeStyle = pctx.fillStyle = '#fff';
        pctx.lineWidth = Math.max(1.5, W / 400);
        pctx.strokeRect(x, y, w, h);
        const hs = handleSize();
        for (const [hx, hy] of [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h],
        ])
            pctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        pctx.restore();
    }

    function cropPoint(e) {
        const s = cropScale(),
            p = canvasPoint(e);
        return { x: clamp(p.x / s, 0, video.videoWidth), y: clamp(p.y / s, 0, video.videoHeight) };
    }
    function cropPointerDown(e) {
        const p = cropPoint(e),
            c = state.crop,
            tol = handleSize() / cropScale();
        const corners = [
            [c.x, c.y],
            [c.x + c.w, c.y],
            [c.x, c.y + c.h],
            [c.x + c.w, c.y + c.h],
        ];
        const k = corners.findIndex(([cx, cy]) => Math.abs(p.x - cx) <= tol && Math.abs(p.y - cy) <= tol);
        if (k >= 0) {
            const [fx, fy] = corners[3 - k]; // 반대쪽 모서리를 고정점으로
            cropDrag = { fx, fy };
        } else if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
            cropDrag = { ox: p.x - c.x, oy: p.y - c.y };
        } else {
            cropDrag = { fx: p.x, fy: p.y };
        }
    }
    function cropPointerMove(e) {
        if (!cropDrag) return;
        const p = cropPoint(e),
            c = state.crop;
        if ('ox' in cropDrag) return setCrop(p.x - cropDrag.ox, p.y - cropDrag.oy, c.w, c.h, 'w');
        const { fx, fy } = cropDrag;
        let w = Math.max(8, Math.abs(p.x - fx)),
            h = Math.max(8, Math.abs(p.y - fy));
        const R = $('cropLock').checked && outRatio();
        if (R) {
            if (w / h > R) w = h * R;
            else h = w / R;
        }
        setCrop(p.x < fx ? fx - w : fx, p.y < fy ? fy - h : fy, w, h, 'w');
    }

    // ---------- 변환 ----------
    function seekTo(t) {
        return new Promise((resolve, reject) => {
            const done = () => {
                cleanup();
                resolve();
            };
            const fail = () => {
                cleanup();
                reject(new Error('영상 탐색 중 오류가 발생했어요'));
            };
            const cleanup = () => {
                video.removeEventListener('seeked', done);
                video.removeEventListener('error', fail);
            };
            video.addEventListener('seeked', done);
            video.addEventListener('error', fail);
            video.currentTime = t;
        });
    }

    $('cancel').addEventListener('click', () => {
        state.cancel = true;
    });
    $('convert').addEventListener('click', convert);

    async function convert() {
        if (!state.loaded || state.converting) return;
        const start = Math.max(0, +$('start').value);
        const end = Math.min(video.duration, +$('end').value);
        if (!(end > start)) return showError('끝 시간이 시작 시간보다 커야 해요');
        showError('');
        state.converting = true;
        state.cancel = false;
        if (state.cropEditing) {
            state.cropEditing = false;
            cropUI();
        }
        video.pause();
        $('convert').disabled = true;
        show($('progWrap'), true);

        try {
            await ensureFont();
            const { w, h } = outSize();
            const fps = +$('fps').value;
            // 브라우저는 품질 1.0을 무손실(VP8L)로 인코딩함
            const q = $('lossless').checked ? 1 : +$('quality').value / 100;
            const n = Math.max(1, Math.floor((end - start) * fps));
            const opts = readOpts();
            const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
            const ctx = canvas.getContext('2d');
            // 둥근 모서리(투명)를 손실 압축하면 투명한 바깥이 검정으로 취급돼 모서리 픽셀에 번져서, 가장자리가
            // 어둡고 계단처럼 보인다. 그래서 모양(알파)은 모서리를 깎은 그림에서, 색은 바깥까지 채운 그림에서
            // 따로 인코딩해 한 프레임으로 합친다(WebP는 알파(ALPH)와 색(VP8)을 따로 담는다). 무손실은 번지지 않는다.
            const splitAlpha = q < 1 && opts.radius > 0;
            const colorCanvas = splitAlpha
                ? Object.assign(document.createElement('canvas'), { width: w, height: h })
                : null;
            const colorCtx = colorCanvas && colorCanvas.getContext('2d');
            if (pv.width !== w || pv.height !== h) {
                pv.width = w;
                pv.height = h;
            }

            const frames = [];
            let prevData = null,
                prevColor = null,
                done = 0;
            const webpBytes = async blobP => {
                const blob = await blobP;
                if (blob?.type !== 'image/webp')
                    throw new Error(
                        '이 브라우저는 WebP 인코딩을 지원하지 않아요. 크롬, 엣지 또는 파이어폭스를 사용해주세요'
                    );
                return new Uint8Array(await blob.arrayBuffer());
            };
            const finish = async ({ blobP, colorP, duration }) => {
                const data = await webpBytes(blobP);
                const colorData = colorP ? await webpBytes(colorP) : null;
                if (prevData && bytesEqual(prevData, data) && (!colorData || bytesEqual(prevColor, colorData)))
                    frames[frames.length - 1].duration += duration;
                else frames.push({ ...mergeAlphaColor(extractImageChunks(data), colorData), duration });
                prevData = data;
                prevColor = colorData;
                $('prog').value = ++done / n;
                $('progLabel').textContent = `프레임 ${done} / ${n}`;
            };
            // toBlob은 호출 시점의 그림을 복사해 따로 인코딩하므로, 기다리지 않고 다음 프레임으로 넘어가 최대 4장을 동시에 인코딩
            const pending = [];
            for (let i = 0; i < n; i++) {
                if (state.cancel) throw new Error('취소했어요');
                const t = Math.min(start + i / fps, video.duration - 0.001);
                await seekTo(t);
                drawFrame(ctx, w, h, t, opts);
                if (colorCtx) drawFrame(colorCtx, w, h, t, opts, false);
                pctx.drawImage(canvas, 0, 0);
                pending.push({
                    blobP: new Promise(r => canvas.toBlob(r, 'image/webp', q)),
                    colorP: colorCanvas && new Promise(r => colorCanvas.toBlob(r, 'image/webp', q)),
                    duration: Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps),
                });
                if (pending.length >= 4) await finish(pending.shift());
            }
            while (pending.length) await finish(pending.shift());

            $('progLabel').textContent = '파일 만드는 중';
            const blob = new Blob([buildAnimatedWebP(frames, w, h, +$('loop').value)], { type: 'image/webp' });
            if (state.resultURL) URL.revokeObjectURL(state.resultURL);
            state.resultURL = URL.createObjectURL(blob);
            $('resultImg').src = $('download').href = state.resultURL;
            $('download').download = `${state.fileName}_${w}x${h}.webp`;
            $('resultInfo').textContent =
                `${w}×${h} · ${n}프레임 · ${fps}fps · ${q === 1 ? '무손실' : '품질 ' + Math.round(q * 100)} · ${formatBytes(blob.size)}`;
            show($('result'), true);
            $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (err) {
            showError(err.message || String(err));
        } finally {
            state.converting = false;
            $('convert').disabled = false;
            show($('progWrap'), false);
            $('prog').value = 0;
            requestDraw();
        }
    }

    // ---------- Animated WebP 조립 ----------
    // 정지 WebP에서 이미지 청크(ALPH/VP8/VP8L)만 헤더 포함으로 잘라냄 (패딩은 쓸 때 붙임)
    function extractImageChunks(u8) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
        if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('WebP 프레임 형식이 올바르지 않아요');
        const chunks = [];
        let alpha = false;
        for (let o = 12; o + 8 <= u8.length;) {
            const id = tag(o),
                size = dv.getUint32(o + 4, true);
            if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
                chunks.push(u8.subarray(o, o + 8 + size));
                alpha ||= id !== 'VP8 ';
            }
            o += 8 + size + (size & 1);
        }
        return { chunks, alpha };
    }

    // 알파는 모서리를 깎은 프레임의 ALPH 청크, 색은 바깥까지 채운 프레임의 VP8 청크로 한 프레임을 만든다.
    // 색 쪽은 불투명이라 VP8 하나만 있다. 어느 한쪽이 예상과 다르면(예: 무손실 VP8L) 원래 프레임을 그대로 쓴다.
    function mergeAlphaColor(frame, colorData) {
        if (!colorData) return frame;
        const tagOf = c => String.fromCharCode(c[0], c[1], c[2], c[3]);
        const alpha = frame.chunks.filter(c => tagOf(c) === 'ALPH');
        const color = extractImageChunks(colorData).chunks.filter(c => tagOf(c) === 'VP8 ');
        if (alpha.length !== 1 || color.length !== 1) return frame;
        return { chunks: [alpha[0], color[0]], alpha: true };
    }

    // 구조: RIFF/WEBP → VP8X(애니메이션 플래그) → ANIM(반복) → 프레임마다 ANMF(위치·크기·시간 + 이미지 청크)
    function buildAnimatedWebP(frames, w, h, loopCount) {
        const padded = c => c.length + (c.length & 1);
        const anmfSize = f => 8 + 16 + f.chunks.reduce((a, c) => a + padded(c), 0);
        const total = 12 + 18 + 14 + frames.reduce((a, f) => a + anmfSize(f), 0);
        const out = new Uint8Array(total);
        const dv = new DataView(out.buffer);
        let o = 0;
        const fourcc = s => {
            for (let k = 0; k < 4; k++) out[o++] = s.charCodeAt(k);
        };
        const u32 = v => {
            dv.setUint32(o, v, true);
            o += 4;
        };
        const u24 = v => {
            out[o++] = v & 255;
            out[o++] = (v >> 8) & 255;
            out[o++] = (v >> 16) & 255;
        };

        fourcc('RIFF');
        u32(total - 8);
        fourcc('WEBP');
        fourcc('VP8X');
        u32(10);
        out[o] = 0x02 | (frames.some(f => f.alpha) ? 0x10 : 0);
        o += 4;
        u24(w - 1);
        u24(h - 1);
        fourcc('ANIM');
        u32(6);
        o += 4; // 배경색
        out[o++] = loopCount & 255;
        out[o++] = loopCount >> 8;
        for (const f of frames) {
            fourcc('ANMF');
            u32(anmfSize(f) - 8);
            u24(0);
            u24(0);
            u24(w - 1);
            u24(h - 1);
            u24(Math.min(0xffffff, f.duration));
            out[o++] = 0x02; // 블렌딩 안 함
            for (const c of f.chunks) {
                out.set(c, o);
                o += padded(c);
            }
        }
        return out;
    }

    // ---------- 유틸 ----------
    function bytesEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    const formatBytes = b =>
        b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
    const showError = m => {
        $('error').textContent = m;
    };

    // 새로고침 시 브라우저가 복원한 입력값에 화면 상태를 맞춤
    $('sizeMode').dispatchEvent(new Event('change'));
    loadLayer();
});
