'use strict';
let W = 1200,
    H = 740,
    trackId = 'park';
const villageNodes = [
    [500, 850],
    [300, 850],
    [165, 740],
    [160, 555],
    [265, 400],
    [190, 250],
    [310, 150],
    [485, 190],
    [650, 145],
    [810, 250],
    [820, 420],
    [715, 550],
    [805, 705],
    [710, 835],
];
const villageSamples = 2048,
    villageX = new Float64Array(villageSamples + 1),
    villageY = new Float64Array(villageSamples + 1);
// 닫힌 스플라인을 제어점 순서가 아니라 달린 거리 기준으로 다시 샘플링한다.
(() => {
    const raw = [],
        dist = [0],
        n = villageNodes.length;
    let length = 0;
    for (let i = 0; i <= 4096; i++) {
        const u = (i / 4096) * n,
            j = Math.floor(u) % n,
            t = u - Math.floor(u),
            a = villageNodes[(j + n - 1) % n],
            b = villageNodes[j],
            c = villageNodes[(j + 1) % n],
            d = villageNodes[(j + 2) % n];
        const p = [0, 0];
        for (let k = 0; k < 2; k++)
            p[k] =
                0.5 *
                (2 * b[k] +
                    (-a[k] + c[k]) * t +
                    (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
                    (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t);
        if (i) {
            length += Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]);
            dist.push(length);
        }
        raw.push(p);
    }
    let j = 0;
    for (let i = 0; i <= villageSamples; i++) {
        const target = (length * i) / villageSamples;
        while (j < raw.length - 2 && dist[j + 1] < target) j++;
        const t = (target - dist[j]) / (dist[j + 1] - dist[j] || 1);
        villageX[i] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t;
        villageY[i] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t;
    }
})();
function fingerPoint(p, lane, out) {
    const u = (((p % 1) + 1) % 1) * villageSamples,
        i = Math.floor(u),
        t = u - i,
        x = villageX[i] + (villageX[i + 1] - villageX[i]) * t,
        y = villageY[i] + (villageY[i + 1] - villageY[i]) * t,
        prev = (i + villageSamples - 1) % villageSamples,
        next = (i + 1) % villageSamples,
        angle = Math.atan2(villageY[next] - villageY[prev], villageX[next] - villageX[prev]);
    out.cx = x;
    out.cy = y;
    out.x = x - Math.sin(angle) * lane;
    out.y = y + Math.cos(angle) * lane;
    out.angle = angle;
    return out;
}

const trackTitle = () => (trackId === 'pocket' ? '캄몬빌리지' : '몬스타즈파크');
// 작은 절차적 사운드트랙: 다운로드 없음, 컨텍스트 하나, 동시 음 수 제한.
const raceAudio = (() => {
    let ctx,
        bus,
        enabled = true,
        timer = null,
        step = 0,
        next = 0,
        lastFx = -10,
        voices = 0,
        noise;
    const melody = [
        76, 79, 84, 0, 83, 79, 76, 79, 81, 0, 79, 76, 74, 76, 79, 0, 74, 77, 81, 0, 79, 77, 74, 77, 79, 83, 86, 83, 79,
        0, 74, 0, 76, 79, 84, 88, 86, 84, 83, 79, 81, 84, 88, 0, 86, 84, 81, 79, 77, 81, 84, 81, 79, 77, 76, 74, 76, 79,
        83, 86, 84, 0, 79, 0,
    ];
    const chords = [
        [48, 52, 55],
        [43, 47, 50],
        [45, 48, 52],
        [53, 57, 60],
    ];
    const hz = n => 440 * 2 ** ((n - 69) / 12);
    function drum(at, snare = false) {
        if (!ctx || !enabled || voices >= 20) return;
        const src = ctx.createBufferSource(),
            filter = ctx.createBiquadFilter(),
            gain = ctx.createGain();
        voices++;
        src.buffer = noise;
        filter.type = 'highpass';
        filter.frequency.value = snare ? 1400 : 7000;
        gain.gain.setValueAtTime(snare ? 0.11 : 0.035, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + (snare ? 0.11 : 0.045));
        src.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        src.onended = () => {
            src.disconnect();
            filter.disconnect();
            gain.disconnect();
            voices--;
        };
        src.start(at);
        src.stop(at + 0.13);
    }
    function tone(freq, at, duration = 0.12, volume = 0.07, type = 'triangle', end = freq) {
        if (!ctx || !enabled || voices >= 20) return;
        const osc = ctx.createOscillator(),
            gain = ctx.createGain();
        voices++;
        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, end), at + duration);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(volume, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain);
        gain.connect(bus);
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            voices--;
        };
        osc.start(at);
        osc.stop(at + duration + 0.015);
    }
    function init() {
        try {
            const C = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!C) return;
            if (!ctx) {
                ctx = new C();
                bus = ctx.createGain();
                bus.gain.value = enabled ? 1 : 0;
                const limiter = ctx.createDynamicsCompressor();
                limiter.threshold.value = -12;
                limiter.knee.value = 12;
                limiter.ratio.value = 5;
                limiter.attack.value = 0.003;
                limiter.release.value = 0.15;
                bus.connect(limiter);
                limiter.connect(ctx.destination);
                noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.15), ctx.sampleRate);
                const data = noise.getChannelData(0);
                let seed = 91;
                for (let i = 0; i < data.length; i++) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    data[i] = seed / 2147483648 - 1;
                }
            }
            ctx.resume().catch(() => {});
        } catch {}
    }
    function stop() {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
        if (bus && ctx) {
            bus.gain.cancelScheduledValues(ctx.currentTime);
            bus.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        }
    }
    function musicTone(freq, at, duration, volume, type, end = freq) {
        tone(freq, at, duration, volume, type, end);
    }
    function restartMusic() {
        stop();
        step = 0;
    }
    function music() {
        if (!ctx || !enabled || document.hidden || timer !== null) return;
        bus.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
        next = ctx.currentTime + 0.04;
        timer = setInterval(() => {
            if (document.hidden || !enabled || !['racing', 'countdown'].includes(state)) {
                stop();
                return;
            }
            while (next < ctx.currentTime + 0.18) {
                if (next < ctx.currentTime) next = ctx.currentTime + 0.02;
                const n = step % 64,
                    chord = chords[Math.floor(step / 16) % 4],
                    note = melody[n];
                if (note) {
                    musicTone(hz(note), next, 0.12, 0.105, 'triangle');
                    musicTone(hz(note + 12), next, 0.055, 0.018, 'sine');
                }
                if (step % 2 === 0) musicTone(hz(chord[0] + (step % 4 === 2 ? 7 : 0)), next, 0.14, 0.13, 'triangle');
                if (step % 2 === 1) {
                    for (const key of chord) musicTone(hz(key + 12), next, 0.09, 0.032, 'triangle');
                }
                if (step % 4 === 0) musicTone(130, next, 0.11, 0.19, 'sine', 38);
                if (step % 4 === 2) drum(next, true);
                else drum(next);
                next += (60 / 168 / 2) * (step % 2 ? 0.97 : 1.03);
                step++;
            }
        }, 100);
    }
    function effect(kind) {
        if (!ctx || !enabled || document.hidden) return;
        const t = ctx.currentTime;
        if (t - lastFx < 0.12) return;
        lastFx = t;
        const notes = {
            missile: [180, 45, 'sawtooth'],
            water: [900, 180, 'sine'],
            banana: [600, 130, 'triangle'],
            ufo: [250, 1000, 'sine'],
            lightning: [110, 50, 'square'],
            shield: [650, 1300, 'sine'],
            rocket: [170, 700, 'triangle'],
            magnet: [350, 700, 'sine'],
            wisp: [760, 260, 'sine'],
            barricade: [300, 80, 'square'],
        };
        const n = notes[kind];
        if (n) tone(n[0], t, 0.22, 0.18, n[2], n[1]);
    }
    function cue(kind) {
        if (!ctx || !enabled) return;
        bus.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
        const t = ctx.currentTime;
        if (kind === 'finish') {
            const notes = [72, 76, 79, 84, 83, 84];
            for (let i = 0; i < notes.length; i++) {
                const at = t + i * 0.12;
                tone(hz(notes[i]), at, i === 5 ? 0.65 : 0.18, 0.11, 'triangle');
            }
            for (const n of [60, 64, 67]) tone(hz(n), t + 0.6, 0.75, 0.045, 'sine');
        } else if (kind === 'go') {
            tone(1047, t, 0.24, 0.15, 'triangle');
            tone(1568, t + 0.05, 0.2, 0.075, 'sine');
        } else {
            tone(740, t, 0.11, 0.13, 'sine');
            tone(370, t, 0.07, 0.04, 'triangle');
        }
    }
    function toggle() {
        enabled = !enabled;
        const b = $('soundToggle');
        b.querySelector('.sound-label').textContent = enabled ? '소리 켜짐' : '소리 꺼짐';
        b.setAttribute('aria-pressed', String(enabled));
        b.setAttribute('aria-label', enabled ? '소리 켜짐, 눌러서 끄기' : '소리 꺼짐, 눌러서 켜기');
        if (enabled) {
            init();
            music();
        } else stop();
    }
    return { init, stop, music, effect, cue, toggle, restartMusic };
})();

const elements = new Map();
const $ = id => {
        if (!elements.has(id)) elements.set(id, document.getElementById(id));
        return elements.get(id);
    },
    cv = $('game'),
    g = cv.getContext('2d');
// 출전 명단은 사이트의 현재 멤버(loadRoster). 얼굴은 어드민에서 올린 것(어드민 도구 → 캄몬라이더 → 선수 얼굴),
// 없으면 헬멧을 그린다. 선수 색은 얼굴 그림 가장자리(카드 바탕)의 색 계열을 게스트 색처럼 밝은 파스텔로 맞춘 것이다
// (평균색 그대로는 카드 무늬가 섞여 칙칙하다).
const GUEST_COLORS = ['#9ed978', '#f5b263', '#8ccfee', '#d99be7', '#f38eac'];
// id는 이 배열의 인덱스다. 앞쪽 BASE_DRIVERS명이 멤버, 그 뒤가 게스트.
const names = [],
    colors = [],
    uploadedFaces = [];
let BASE_DRIVERS = 0;
// 명단을 못 받으면(파일로 열었을 때 등) 게스트만 넣을 수 있다.
async function loadRoster() {
    let list = [];
    try {
        const { members } = await Api.members();
        list = (members || [])
            .filter(m => m && !String(m['퇴단일'] || '').trim() && String(m['이름'] || '').trim())
            .map(m => ({ name: String(m['이름']).trim(), face: storageMediaUrl(m['라이더 얼굴']) }));
    } catch {}
    const faces = await Promise.all(list.map(m => m.face && loadFace(m.face)));
    list.forEach(({ name }, i) => {
        names.push(name);
        uploadedFaces.push(faces[i] || null);
        colors.push(faces[i] ? edgeColor(faces[i]) : GUEST_COLORS[i % GUEST_COLORS.length]);
    });
    BASE_DRIVERS = names.length;
    return list.length > 0;
}
function edgeColor(img) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const b = c.getContext('2d');
    b.drawImage(img, 0, 0, 16, 16);
    const px = b.getImageData(0, 0, 16, 16).data;
    let r = 0,
        gr = 0,
        bl = 0,
        n = 0;
    for (let i = 0; i < 256; i++) {
        const x = i % 16,
            y = (i / 16) | 0;
        if (x && y && x < 15 && y < 15) continue;
        r += px[i * 4];
        gr += px[i * 4 + 1];
        bl += px[i * 4 + 2];
        n++;
    }
    const [R, G, B] = [r / n / 255, gr / n / 255, bl / n / 255];
    const max = Math.max(R, G, B),
        d = max - Math.min(R, G, B);
    const hue = !d ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return `hsl(${Math.round(hue * 60 + 360) % 360}, 70%, 70%)`;
}
// 못 받으면 null(시트 그림·헬멧으로). 캔버스에 그려도 오염되지 않게 CORS로 받는다.
function loadFace(src) {
    return new Promise(resolve => {
        const img = new Image();
        const timer = setTimeout(() => resolve(null), 8000);
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
        };
        img.src = src;
    });
}
const defaultLineup = () => new Set(names.slice(0, Math.min(8, BASE_DRIVERS)).map((_, i) => i));
const addMemberCards = () => names.slice(0, BASE_DRIVERS).forEach((_, i) => addCard(i));
let chosen = new Set(),
    portraits = [],
    racers = [],
    state = 'setup',
    elapsed = 0,
    countdown = 3,
    rate = 1,
    laps = 3,
    focused = null,
    ready = false,
    last = 0,
    accumulator = 0,
    uiClock = 0,
    lastLeader = null,
    eventAt = -20,
    raceNumber = 0;
cv.width = 1200;
cv.height = 740;
let traps = [],
    effects = [],
    cameraMode = 'auto',
    camera = { x: 600, y: 370, z: 1, angle: 0 },
    cameraTarget = null,
    cameraUntil = 0,
    finishAt = null,
    slowMotion = false,
    finalAnnounced = false,
    itemStats = { used: 0, hits: 0, blocks: 0, leadChanges: 0 };
const itemNames = {
    missile: '🚀 미사일',
    shield: '🛡 방어막',
    lightning: 'ϟ 번개',
    rocket: '🔥 부스터',
    magnet: '🧲 자석',
    banana: '🍌 바나나',
    ufo: '🛸 우주선',
    water: '💧 물폭탄',
    wisp: '💧 물파리',
    barricade: '🚧 바리케이드',
};
const minimap = $('miniMap').getContext('2d');
let renderDirty = true,
    settleFrames = 0,
    renderClock = 0,
    frameHandle = null;
function stopLoop() {
    raceAudio.stop();
    if (frameHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameHandle);
    frameHandle = null;
    last = 0;
}
function wakeLoop() {
    raceAudio.music();
    if (frameHandle === null && state !== 'setup' && !document.hidden) {
        last = 0;
        frameHandle = requestAnimationFrame(frame);
    }
}

// 렌더 크기는 실제 임베드에 맞추고 트랙은 논리 좌표를 유지한다.
let renderInterval = 1 / 60,
    canvasScale = 1,
    drawElapsed = 0;
const visibleKarts = [],
    kartDrawEntries = new Map(),
    cameraAlive = [];
// 캔버스 크기는 RESIZE_STEP 이상 차이 날 때만 바꾼다. 재할당은 비트맵·텍스처를 새로 올려 프레임이 크게 늦는데
// 폭은 스크롤바·글꼴·주소창 등으로 1px씩 흔들린다. 그 이하 차이는 1:1에서 2.5% 안쪽이라 보이지 않는다.
const RESIZE_STEP = 24;
// 고해상도에서 경기 중 2초 동안 늦은 프레임이 5%를 넘으면 기본 해상도로 내리고 되돌리지 않는다.
// 칠하기 비용은 나중에 드러나서 실제 프레임 간격으로, 느린 기기도 늦지 않게 프레임 수가 아닌 시간으로 모은다.
let hiResOk = true,
    hiResLate = 0,
    hiResSeen = 0,
    hiResTime = 0;
function watchHiRes(rawDt) {
    if (!hiResOk || cv.width <= 1200 || rawDt <= 0 || elapsed < 1) return;
    hiResSeen++;
    hiResTime += rawDt;
    if (rawDt > 0.025) hiResLate++;
    if (hiResTime < 2) return;
    if (hiResLate / hiResSeen > 0.05) {
        hiResOk = false;
        console.info('[캄몬라이더] 화면이 밀려 해상도를 낮춥니다 (' + hiResLate + '/' + hiResSeen + ' 프레임 지연)');
        fitRaceCanvas();
    }
    hiResLate = 0;
    hiResSeen = 0;
    hiResTime = 0;
}
function fitRaceCanvas() {
    const width = cv.clientWidth;
    if (!width) return;
    const mobile = width <= 750;
    // PC(가로 750px 초과)는 픽셀 밀도 2배·가로 1600px까지, 모바일은 발열·배터리 때문에 1.5배·1200px로 그린다.
    // PC라도 프레임이 밀리면 watchHiRes가 1200px로 내린다.
    const hi = !mobile && hiResOk;
    const wanted = Math.min(
        hi ? 1600 : 1200,
        Math.max(600, Math.round(width * Math.min(globalThis.devicePixelRatio || 1, hi ? 2 : 1.5)))
    );
    if (!cv.width || Math.abs(wanted - cv.width) >= RESIZE_STEP) {
        const height = Math.round((wanted * H) / W);
        cv.width = wanted;
        cv.height = height;
        canvasScale = wanted / W;
        renderDirty = true;
    }
    renderInterval = mobile ? 1 / 30 : 1 / 60;
    if (state !== 'setup' && state !== 'paused') wakeLoop();
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitRaceCanvas).observe(cv);
// 카트 얼굴은 아틀라스 한 장에 모은다. 선수마다 캔버스를 두면 텍스처가 많아 브라우저가 캔버스를
// 소프트웨어로 강등·재승격하며 수백 ms씩 멈춘다. 한 칸 84px는 확대 샷(최대 4.8배)에서도 흐려지지 않는 크기다.
const FACE_PX = 84,
    FACE_COLS = 8;
let faceAtlas = null,
    faceAtlasCtx = null;
const faceSlots = new Map();
function kartFaceSlot(id) {
    let slot = faceSlots.get(id);
    if (slot !== undefined) return slot;
    if (!faceAtlas) {
        faceAtlas = document.createElement('canvas');
        faceAtlas.width = FACE_PX * FACE_COLS;
        faceAtlas.height = FACE_PX * Math.ceil(MAX_DRIVERS / FACE_COLS);
        faceAtlasCtx = faceAtlas.getContext('2d');
    }
    slot = faceSlots.size;
    const sx = (slot % FACE_COLS) * FACE_PX,
        sy = Math.floor(slot / FACE_COLS) * FACE_PX,
        b = faceAtlasCtx;
    b.save();
    b.beginPath();
    b.arc(sx + FACE_PX / 2, sy + FACE_PX / 2, FACE_PX / 2, 0, Math.PI * 2);
    b.clip();
    if (portraits[id]) b.drawImage(portraits[id], sx, sy, FACE_PX, FACE_PX);
    b.restore();
    faceSlots.set(id, slot);
    return slot;
}
// 그리는 도중에 텍스처 원본을 고치면 다시 업로드해야 해서 레이스 시작 때 다 써 둔다.
function warmKartFaces() {
    for (const r of racers) kartFaceSlot(r.id);
}
function drawKartFace(id, x, y, size) {
    const slot = kartFaceSlot(id),
        sx = (slot % FACE_COLS) * FACE_PX,
        sy = Math.floor(slot / FACE_COLS) * FACE_PX;
    g.drawImage(faceAtlas, sx, sy, FACE_PX, FACE_PX, x, y, size, size);
}

const nameWidths = new Map();
const cameraButtons = [...document.querySelectorAll('[data-camera]')],
    speedButtons = [...document.querySelectorAll('[data-speed]')];
function setText(node, text) {
    text = String(text);
    if (node.textContent !== text) node.textContent = text;
}
function toggleSettings(open) {
    $('opening').hidden = !open;
    $('broadcast').hidden = open;
    $('cinema').hidden = open;
}
$('replay').onclick = () => start();
// 화면 확대 버튼은 레이아웃을 건드리지 않는다. 중계 카메라 배율만 2배 <-> 4배로 바꾼다.
$('cinema').onclick = () => {
    camBoost = camBoost > 2 ? 2 : 4;
    $('cinema').textContent = camBoost > 2 ? '화면 복원 ⛶' : '화면 확대 ⛶';
};
for (const b of cameraButtons)
    b.onclick = () => {
        setCamera(b.dataset.camera);
        saveSetup();
    };
function setCamera(mode) {
    renderDirty = true;
    if (!['auto', 'wide', 'leader', 'driver'].includes(mode)) throw Error('Invalid camera');
    cameraMode = mode;
    shot = null;
    shotAge = 0;
    if (mode !== 'driver') focused = null;
    cameraButtons.forEach(b => b.classList.toggle('active', b.dataset.camera === mode));
    wakeLoop();
}
function resetRaceFX() {
    finishShotOn = false;
    finishShotDone = false;
    finishSlowAge = 0;
    finishPostAge = 0;
    finishScale = 1;
    shot = null;
    shotAge = 0;
    drawElapsed = 0;
    freezeLog.length = 0;
    visibleKarts.length = 0;
    kartDrawEntries.clear();
    miniState = '';
    miniClock = 0;
    renderClock = 0;
    renderDirty = true;
    settleFrames = 0;
    leaderOrder = '';
    traps = [];
    if (cameraMode === 'driver') setCamera('auto');
    effects = [];
    camera = { x: W / 2, y: H / 2, z: 1, angle: 0 };
    cameraTarget = null;
    cameraUntil = 0;
    finishAt = null;
    slowMotion = false;
    finalAnnounced = false;
    itemStats = { used: 0, hits: 0, blocks: 0, leadChanges: 0 };
    $('itemToast').textContent = '';
    $('finalBadge').classList.remove('is-visible');
    $('finalBadge').setAttribute('aria-hidden', 'true');
}
function itemEvent(text, id) {
    announce(text);
    $('itemToast').textContent = text;
    if (elapsed >= cameraUntil) {
        cameraTarget = id;
        cameraUntil = elapsed + 2.2;
    }
}
// 무적은 휘청이는(stun) 동안뿐이라 연달아 맞아 계속 묶이지 않는다. 우주선은 느려지기만 해서 무적이 없다.
// 느려지기만 하니 무적도 없다. 원작처럼 방어막은 한 번 막으면 끝이고, 부스터에도 무적이 없다.
function strike(target, kind, owner) {
    if (target.finish !== null) return;
    if (target.immunity > 0 && kind !== 'barricade') return;
    if (target.shield > 0) {
        raceAudio.effect('shield');
        target.shield = 0;
        itemStats.blocks++;
        effects.push({ type: 'block', id: target.id, ttl: 0.8 });
        if (elapsed - eventAt > 1) itemEvent(target.name + ' 방어막으로 공격 방어!', target.id);
        return;
    }
    raceAudio.effect(kind);
    target.stun =
        kind === 'ufo'
            ? 0
            : kind === 'water'
              ? 1.7
              : kind === 'wisp'
                ? 1.35
                : kind === 'barricade'
                  ? 1.4
                  : kind === 'banana'
                    ? 1.2
                    : kind === 'lightning'
                      ? 1.05
                      : 1.45;
    if (kind === 'ufo') target.ufo = 3;
    target.hitKind = kind;
    target.hitAt = elapsed;
    target.immunity = target.stun;
    target.boost = 0;
    itemStats.hits++;
    if (kind !== 'ufo') effects.push({ type: 'hit_' + kind, id: target.id, ttl: 0.85, total: 0.85 });
    if (elapsed - eventAt > 1)
        itemEvent(
            owner +
                ' → ' +
                target.name +
                ' ' +
                {
                    lightning: '번개 적중!',
                    banana: '바나나에 미끄러졌습니다!',
                    water: '물폭탄 적중!',
                    wisp: '물파리에 갇혔습니다!',
                    barricade: '바리케이드 충돌!',
                    ufo: '우주선 감속!',
                    missile: '미사일 적중!',
                }[kind],
            target.id
        );
}
// 트랙 길이의 1/3 간격(결승선 기준 대칭, 12시에 하나)으로 박스를 둔다. 랩당 3개라 타이머 방식(2.4~3.8개)과 비슷하다.
// 마지막 박스가 결승선 약 1.6초 앞이라 최종 랩 체커기 앞에서 교전이 한 번 더 걸리고, 출발 그리드(0.918~0.99)와는 겹치지 않는다.
const ITEM_BOXES = [1 / 6, 3 / 6, 5 / 6];
// 노면은 카트 세 대 폭이고 출발 그리드·바리케이드도 이 세 칸 단위다.
// 폭 7 · 선두 앞 0.026바퀴는 스윕으로 맞춘 값이다(노린 1등이 열 번에 다섯 번쯤 걸린다).
const BARRICADE_SLOTS = [-17, 0, 17], // 두 칸을 막고 한 칸을 남긴다
    BARRICADE_SPAN = 7, // 조각 하나의 유효 폭
    BARRICADE_WARN = 0.05, // 선수가 앞쪽 조각을 알아보는 거리
    BARRICADE_LEAD = 0.026; // 선두 앞 어디에 세우는가
const ITEM_POOLS = {
    // 카트라이더처럼 순위에 따라 풀이 갈린다. 선두권은 방어 · 설치류, 후미는 공격류.
    // 바리케이드와 우주선은 선두를 노리는 아이템이라 후미 전용이다.
    front: ['shield', 'shield', 'banana', 'banana', 'wisp', 'water', 'magnet'],
    rear: ['rocket', 'rocket', 'ufo', 'barricade', 'magnet', 'water', 'missile'],
    middle: ['missile', 'shield', 'rocket', 'magnet', 'water', 'banana', 'wisp', 'ufo'],
    // 1등은 노릴 앞차가 없어 지키고 까는 아이템만 준다.
    leader: ['shield', 'shield', 'banana', 'banana'],
};
function giveItem(r, list) {
    const q = list.indexOf(r) / Math.max(1, list.length - 1),
        hasAhead = list.some(o => o.finish === null && o !== r && o.progress > r.progress),
        pool = !hasAhead
            ? ITEM_POOLS.leader
            : q < 0.25
              ? ITEM_POOLS.front
              : q > 0.58
                ? ITEM_POOLS.rear
                : ITEM_POOLS.middle;
    r.item = hasAhead && raceRandom() < 0.03 ? 'lightning' : pool[Math.floor(raceRandom() * pool.length)];
    r.useIn = 0.45 + raceRandom() * 0.9;
    r.itemTimer = 1.2;
}
const attackTargets = [],
    barricadeAhead = [];
function useItem(r, list) {
    const kind = r.item;
    if (!kind) return;
    itemStats.used++;
    if (['rocket', 'magnet', 'shield'].includes(kind)) raceAudio.effect(kind);
    r.item = null;
    r.lastItem = kind;
    r.lastItemUntil = elapsed + 1.7;
    const ahead = attackTargets;
    ahead.length = 0;
    if (kind === 'ufo' || kind === 'missile' || kind === 'lightning' || kind === 'wisp')
        for (const o of list) if (o.finish === null && o !== r && o.progress > r.progress) ahead.push(o);
    if (kind === 'banana') {
        traps.push({
            owner: r.id,
            kind: 'banana',
            span: 20,
            hits: 1,
            progress: r.progress - 0.008,
            lane: r.lane,
            ttl: 12,
        });
        if (elapsed - eventAt > 1.8) itemEvent(r.name + ' 바나나 설치! 뒤따르는 선수 주의!', r.id);
    } else if (kind === 'ufo') {
        const target = ahead[0];
        if (target) {
            strike(target, 'ufo', r.name);
            if (target.ufo > 0) effects.push({ type: 'ufo', id: target.id, ttl: 3 });
            itemEvent(r.name + ' 우주선! ' + target.name + ' 추격 저지!', target.id);
        } else r.shield = 2;
    } else if (kind === 'water') {
        const origin = point(r.progress, r.lane),
            landing = point(r.progress + 0.065, r.lane);
        effects.push({ type: 'water', from: r.id, origin, landing, ttl: 0.75, total: 0.75, owner: r.name });
        if (elapsed - eventAt > 1.5) itemEvent(r.name + ' 물폭탄 투척!', r.id);
    } else if (kind === 'shield') {
        r.shield = 4.5;
    } else if (kind === 'rocket') {
        r.boost = 2.7;
        if (elapsed - eventAt > 1.8) itemEvent(r.name + ' 부스터! 단숨에 거리를 좁힙니다', r.id);
    } else if (kind === 'magnet') {
        // 자석은 바로 앞차 한 명에게 붙는다(순위표에서 나보다 앞선 사람 중 마지막).
        let target = null;
        for (const o of list) {
            if (o === r) break;
            if (o.finish === null && o.progress > r.progress) target = o;
        }
        if (target) {
            r.magnet = 3.2;
            r.magnetTarget = target.id;
            r.magnetGap = target.progress - r.progress;
            if (elapsed - eventAt > 2) itemEvent(r.name + ' 자석! ' + target.name + '에게 끌려갑니다', target.id);
        } else r.shield = 2;
    } else if (kind === 'missile') {
        const target = ahead[ahead.length - 1];
        if (target) {
            effects.push({ type: 'missile', from: r.id, id: target.id, ttl: 0.65, total: 0.65, owner: r.name });
            if (elapsed - eventAt > 1.8) itemEvent(r.name + ' → ' + target.name + ' 미사일 발사!', target.id);
        } else r.shield = 2.2;
    } else if (kind === 'wisp') {
        // 물파리는 물폭탄의 축소판 - 바로 앞 한 명만 물방울에 가둔다.
        const target = ahead[ahead.length - 1];
        if (target) {
            effects.push({ type: 'wisp', from: r.id, id: target.id, ttl: 0.6, total: 0.6, owner: r.name });
            if (elapsed - eventAt > 1.8) itemEvent(r.name + ' → ' + target.name + ' 물파리!', target.id);
        } else r.shield = 2;
    } else if (kind === 'barricade') {
        // 바리케이드는 선두 차선에서 가까운 두 칸을 막고 먼 한 칸만 열어 둔다(조각은 한 번 맞으면 부서진다).
        // 차선 이동에 관성(시정수 0.67초)이 있어 바깥 차선에 있던 선두는 건너다 조각을 긁는다.
        const lead = list.find(o => o.finish === null && o !== r && o.progress > r.progress);
        if (lead) {
            const flee = lead.lane >= 0 ? -1 : 1;
            const slots = BARRICADE_SLOTS.slice().sort((a, b) => {
                const da = Math.abs(a - lead.lane),
                    db = Math.abs(b - lead.lane);
                return da !== db ? da - db : (a - lead.lane) * flee < 0 ? 1 : -1; // 같은 거리면 도망갈 쪽을 먼저 막는다
            });
            for (const lane of slots.slice(0, 2))
                traps.push({
                    owner: r.id,
                    kind: 'barricade',
                    span: BARRICADE_SPAN,
                    hits: 1,
                    progress: lead.progress + BARRICADE_LEAD,
                    lane,
                    ttl: 5,
                });
            itemEvent(r.name + ' 바리케이드! ' + lead.name + ' 앞을 막아섭니다!', lead.id);
        } else r.shield = 2;
    } else if (kind === 'lightning') {
        const targets = ahead;
        targets.forEach(t => strike(t, 'lightning', r.name));
        if (targets.length) itemEvent(r.name + ' 번개! 앞선 선수 전원 감속 공격!', targets[0].id);
        else r.boost = 1.6;
    }
}

const MAX_DRIVERS = 48;
function portrait(id, size = 96) {
    // 작은 크기(순위 40px·결과 64px)는 다시 그리지 않고 96px 원본을 줄여 쓴다.
    if (size < 96 && portraits[id]) {
        const small = document.createElement('canvas');
        small.width = small.height = size;
        small.getContext('2d').drawImage(portraits[id], 0, 0, size, size);
        return small;
    }
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const brush = c.getContext('2d');
    if (uploadedFaces[id]) {
        brush.drawImage(uploadedFaces[id], 0, 0, size, size);
    } else {
        brush.save();
        brush.scale(size / 96, size / 96);
        brush.fillStyle = '#edf3ff';
        brush.fillRect(0, 0, 96, 96);
        brush.fillStyle = colors[id];
        brush.globalAlpha = 0.18;
        brush.beginPath();
        brush.arc(84, 12, 55, 0, 7);
        brush.fill();
        brush.globalAlpha = 1;
        // 레이싱 헬멧을 쓴 작은 게스트 선수.
        brush.fillStyle = '#273c66';
        brush.beginPath();
        brush.roundRect(16, 69, 64, 36, 23);
        brush.fill();
        brush.fillStyle = colors[id];
        brush.beginPath();
        brush.roundRect(30, 72, 36, 26, 8);
        brush.fill();
        brush.fillStyle = '#ffffff';
        brush.fillRect(44, 72, 8, 24);
        brush.fillStyle = '#172c4922';
        brush.beginPath();
        brush.ellipse(50, 67, 31, 10, 0, 0, 7);
        brush.fill();
        brush.fillStyle = colors[id];
        brush.beginPath();
        brush.roundRect(18, 14, 60, 59, 25);
        brush.fill();
        brush.fillStyle = '#ffffffd9';
        brush.beginPath();
        brush.roundRect(43, 15, 10, 19, 4);
        brush.fill();
        brush.fillStyle = '#18324f';
        brush.beginPath();
        brush.roundRect(23, 33, 50, 24, 11);
        brush.fill();
        brush.fillStyle = '#88cfff';
        brush.beginPath();
        brush.roundRect(27, 36, 42, 13, 6);
        brush.fill();
        brush.fillStyle = '#d8f5ff';
        brush.beginPath();
        brush.moveTo(31, 38);
        brush.lineTo(43, 38);
        brush.lineTo(37, 45);
        brush.lineTo(29, 45);
        brush.closePath();
        brush.fill();
        brush.fillStyle = '#e8f0ff';
        brush.beginPath();
        brush.roundRect(38, 62, 20, 5, 2);
        brush.fill();
        brush.fillStyle = '#fff';
        brush.beginPath();
        brush.arc(79, 78, 14, 0, 7);
        brush.fill();
        brush.fillStyle = '#23447c';
        brush.font = '800 13px Pretendard,sans-serif';
        brush.textAlign = 'center';
        brush.textBaseline = 'middle';
        brush.fillText(Array.from(names[id]).slice(0, 1).join(''), 79, 79);
        brush.restore();
    }
    return c;
}
function addCard(i) {
    const b = document.createElement('button');
    b.className = 'driver';
    b.driverId = i;
    b.setAttribute('aria-label', names[i] + ' 출전 선택');
    b.title = names[i];
    b.append(portrait(i));
    const t = document.createElement('strong');
    t.textContent = names[i];
    const check = document.createElement('span');
    check.className = 'check';
    b.append(t, check);
    if (i >= BASE_DRIVERS) {
        const x = document.createElement('span');
        x.className = 'remove';
        x.textContent = '×';
        x.title = names[i] + ' 삭제';
        x.setAttribute('aria-hidden', 'true');
        b.append(x);
        b.setAttribute('aria-label', names[i] + ' 출전 선택 (Delete 키로 삭제)');
        b.onkeydown = e => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeGuest(i);
            }
        };
    }
    b.onclick = e => {
        if (state !== 'setup') return;
        if (e.target.closest?.('.remove')) {
            removeGuest(i);
            return;
        }
        chosen.has(i) ? chosen.delete(i) : chosen.add(i);
        syncSelection();
    };
    $('roster').append(b);
}
// id가 배열 인덱스라 게스트를 지우면 목록과 id 기반 캐시를 다시 만든다.
function setGuests(guestNames, chosenNames) {
    faceSlots.clear();
    faceAtlas = null;
    faceAtlasCtx = null;
    nameWidths.clear();
    prefixWidths.clear();
    leaderRows.clear();
    $('leaderList').replaceChildren();
    names.splice(BASE_DRIVERS);
    colors.splice(BASE_DRIVERS);
    portraits.splice(BASE_DRIVERS);
    $('roster').replaceChildren();
    addMemberCards();
    for (const name of guestNames) {
        try {
            registerDriver(name);
        } catch {}
    }
    const wanted = new Set(chosenNames);
    chosen = new Set(names.map((_, i) => i).filter(i => wanted.has(names[i])));
    syncSelection();
}
function removeGuest(id) {
    if (state !== 'setup' || id < BASE_DRIVERS || id >= names.length) return;
    const name = names[id],
        slot = [...$('roster').children].findIndex(b => b.driverId === id);
    setGuests(
        names.slice(BASE_DRIVERS).filter(n => n !== name),
        [...chosen].filter(i => i !== id).map(i => names[i])
    );
    $('driverMessage').textContent = name + ' 선수를 삭제했습니다';
    const cards = $('roster').children;
    (cards[Math.min(slot, cards.length - 1)] || $('driverName')).focus?.();
}
// 라인업 설정은 새로고침해도 남는다. 게스트 목록이 바뀌어도 엉뚱한 선수가 골라지지 않게 이름으로 저장한다.
const SETUP_KEY = 'calmmon-rider-setup';
function saveSetup() {
    if (!ready) return;
    try {
        localStorage.setItem(
            SETUP_KEY,
            JSON.stringify({
                guests: names.slice(BASE_DRIVERS),
                chosen: [...chosen].map(i => names[i]),
                laps: $('laps').value,
                track: trackId,
                rate,
                camera: cameraMode,
            })
        );
    } catch {}
}
function restoreSetup() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    } catch {
        return;
    }
    if (!saved || typeof saved !== 'object') return;
    const list = v => (Array.isArray(v) ? v.filter(n => typeof n === 'string') : []);
    if ([...$('laps').options].some(o => o.value === String(saved.laps))) {
        $('laps').value = String(saved.laps);
        $('lapLabel').textContent = $('laps').value + ' LAPS';
    }
    if (['park', 'pocket'].includes(saved.track) && saved.track !== trackId) {
        $('trackSelect').value = saved.track;
        selectTrack(saved.track);
    }
    if ([1, 2, 4].includes(saved.rate)) setRate(saved.rate);
    if (['auto', 'wide', 'leader'].includes(saved.camera)) setCamera(saved.camera);
    setGuests(list(saved.guests), list(saved.chosen));
}
// 이름 하나를 검사해 등록한다. 못 넣으면 이유를 담아 던진다.
function registerDriver(raw) {
    if (state !== 'setup') throw Error('라인업 변경 화면에서 선수를 추가해 주세요');
    const name = String(raw).trim().replace(/\s+/g, ' ');
    if (!name || Array.from(name).length > 16) throw Error('이름을 1~16자로 입력해 주세요');
    if (names.some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase()))
        throw Error('같은 이름의 선수가 이미 있습니다');
    if (names.length >= MAX_DRIVERS) throw Error('최대 48명까지 등록할 수 있습니다');
    const id = names.length;
    names.push(name);
    colors.push(GUEST_COLORS[(id - BASE_DRIVERS) % GUEST_COLORS.length]);
    portraits[id] = portrait(id);
    addCard(id);
    chosen.add(id);
    return { id, name };
}
// 쉼표·줄바꿈으로 나눠 이름마다 따로 검사하고, 잘못된 이름은 그것만 건너뛴다.
function addGuests(raw) {
    const parts = String(raw)
        .split(/[,\uFF0C\n]/)
        .map(t => t.trim())
        .filter(Boolean);
    if (!parts.length) throw Error('이름을 1~16자로 입력해 주세요');
    const added = [],
        skipped = new Map();
    for (const part of parts) {
        try {
            added.push(registerDriver(part).name);
        } catch (err) {
            const list = skipped.get(err.message) || [];
            list.push(part);
            skipped.set(err.message, list);
        }
    }
    syncSelection();
    return { added, skipped };
}
const nameList = (arr, max = 5) =>
    arr.length <= max ? arr.join(', ') : arr.slice(0, max).join(', ') + ' 외 ' + (arr.length - max) + '명';
// 한 줄 입력칸은 붙여넣은 줄바꿈을 지워 이름이 붙어 버리므로 쉼표로 바꾼다.
$('driverName').addEventListener('paste', e => {
    const text = (e.clipboardData || globalThis.clipboardData || {}).getData?.('text');
    if (!text || !/[\n\r\t]/.test(text)) return;
    e.preventDefault();
    const input = $('driverName');
    const cleaned = text
        .split(/[\n\r\t]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .join(', ');
    const start = input.selectionStart ?? input.value.length,
        end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + cleaned + input.value.slice(end);
    const caret = start + cleaned.length;
    if (input.setSelectionRange) input.setSelectionRange(caret, caret);
});
$('addDriverForm').onsubmit = async e => {
    e.preventDefault();
    // 캔버스는 웹폰트를 기다리지 않으므로 게스트 머리글자 글리프를 먼저 받는다.
    if (document.fonts?.load) {
        try {
            await document.fonts.load('800 13px Pretendard', $('driverName').value);
        } catch {}
    }
    let result;
    try {
        result = addGuests($('driverName').value);
    } catch (error) {
        $('driverMessage').textContent = error.message;
        return;
    }
    const { added, skipped } = result,
        lines = [];
    if (added.length === 1) lines.push(added[0] + ' 추가 · 카드의 ×로 삭제할 수 있습니다');
    else if (added.length > 1)
        lines.push(added.length + '명 추가: ' + nameList(added) + ' · 카드의 ×로 삭제할 수 있습니다');
    for (const [reason, list] of skipped)
        lines.push(list.length + '명 제외 — ' + reason + ' (' + nameList(list, 3) + ')');
    $('driverMessage').textContent = lines.join(' / ');
    // 다시 치지 않고 고칠 수 있게 실패한 이름은 입력칸에 남긴다.
    const failed = [...skipped.values()].flat();
    $('driverName').value = failed.join(', ');
};
(async () => {
    const rosterReady = loadRoster();
    if (document.fonts?.load) {
        let guestText = '';
        try {
            guestText = (JSON.parse(localStorage.getItem(SETUP_KEY) || 'null')?.guests || []).join('');
        } catch {}
        try {
            await Promise.all([
                document.fonts.load('400 16px Pretendard'),
                document.fonts.load('900 16px Pretendard'),
                guestText && document.fonts.load('800 13px Pretendard', guestText),
            ]);
        } catch {}
    }
    const hasRoster = await rosterReady;
    portraits = names.map((_, i) => portrait(i));
    chosen = defaultLineup();
    addMemberCards();
    restoreSetup();
    prepareTrackRaster();
    ready = true;
    syncSelection();
    $('error').textContent = hasRoster ? '' : '멤버 명단을 불러오지 못했습니다. 게스트를 추가해 경기할 수 있습니다';
})();
$('error').textContent = '선수 라인업을 불러오는 중';
function syncSelection() {
    [...$('roster').children].forEach(b => {
        const on = chosen.has(b.driverId);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        b.querySelector('.check').textContent = on ? '✓' : '+';
    });
    $('selectedCount').textContent = chosen.size;
    $('entryCount').innerHTML = String(chosen.size).padStart(2, '0') + ' <small>명</small>';
    $('start').disabled = !ready || chosen.size < 2;
    $('all').textContent = chosen.size === names.length ? '전체 해제' : '전체 선택';
    $('commentary').textContent =
        chosen.size < 2
            ? '출전 선수를 2명 이상 선택해 주세요'
            : chosen.size + '명의 라인업이 준비됐습니다. 레이스를 시작하세요';
    saveSetup();
    updateUI();
}
$('all').onclick = () => {
    chosen = chosen.size === names.length ? new Set() : new Set(names.map((_, i) => i));
    syncSelection();
};
$('clear').onclick = () => {
    chosen.clear();
    syncSelection();
};
$('random').onclick = () => {
    let ids = names.map((_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    chosen = new Set(ids.slice(0, 8));
    syncSelection();
};
$('laps').onchange = () => {
    $('lapLabel').textContent = $('laps').value + ' LAPS';
    saveSetup();
};
for (const b of speedButtons) b.onclick = () => setRate(Number(b.dataset.speed));
function setRate(n) {
    if (![1, 2, 4].includes(n)) throw Error('Invalid rate');
    rate = n;
    speedButtons.forEach(b => b.classList.toggle('active', +b.dataset.speed === n));
    saveSetup();
}
// 경기 난수. 같은 시드·같은 출전 순서면 같은 경기가 나온다(자동 녹화가 미리 만든 경기를 그대로 재현).
// 화면 효과는 경기 상태를 따라 그려지므로 시드와 상관없다. 시드를 안 주면(버튼으로 시작) 새로 뽑는다.
let raceSeed = 0,
    raceRandom = Math.random;
function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function start(seed) {
    if (!ready || chosen.size < 2) return false;
    raceSeed = Number.isInteger(seed) ? seed >>> 0 : Math.floor(Math.random() * 4294967296);
    raceRandom = seededRandom(raceSeed);
    raceAudio.init();
    raceAudio.restartMusic();
    closeCeremony();
    $('ceremonyOpen').hidden = true;
    laps = +$('laps').value;
    elapsed = 0;
    countdown = 3;
    accumulator = 0;
    eventAt = -20;
    lastLeader = null;
    raceNumber++;
    focused = null;
    resetRaceFX();
    document.body.classList.add('watching');
    racers = [...chosen].map((id, index) => ({
        id,
        name: names[id],
        progress: -Math.floor(index / 3) * 0.01,
        lane: ((index % 3) - 1) * 17,
        laneTarget: ((index % 3) - 1) * 17,
        speed: 0,
        form: 0,
        formTarget: 0,
        decision: 1 + raceRandom() * 2,
        boost: 0,
        cooldown: 3 + raceRandom() * 5,
        finish: null,
        phase: raceRandom() * Math.PI * 2,
        place: index + 1,
        ai: index,
        stun: 0,
        hitKind: null,
        hitAt: 0,
        ufo: 0,
        shield: 0,
        immunity: 0,
        magnet: 0,
        item: null,
        useIn: 0,
        itemTimer: 0,
        lastItem: null,
        lastItemUntil: 0,
    }));
    warmKartFaces();
    state = 'countdown';
    $('replay').hidden = true;
    toggleSettings(false);
    $('rankTitle').textContent = '실시간 순위';
    $('selection').hidden = true;
    $('standings').hidden = false;
    $('start').hidden = true;
    $('pause').hidden = false;
    $('reset').hidden = false;
    $('laps').disabled = true;
    $('centerOverlay').hidden = true;
    $('sessionStatus').textContent = 'ON THE GRID';
    $('pause').textContent = '일시 정지 Ⅱ';
    $('commentary').textContent = racers.length + '명의 드라이버, 출발 준비!';
    $('trackState').textContent = 'STARTING GRID';
    document.body.classList.add('racing');
    updateUI();
    wakeLoop();
    return true;
}
function reset() {
    closeCeremony();
    $('ceremonyOpen').hidden = true;
    stopLoop();
    state = 'setup';
    resetRaceFX();
    // 선수별 캐시는 라인업이 바뀔 때만 비운다(재경기는 그대로 쓴다).
    faceSlots.clear();
    faceAtlas = null;
    faceAtlasCtx = null;
    nameWidths.clear();
    prefixWidths.clear();
    leaderRows.clear();
    $('leaderList').replaceChildren();
    document.body.classList.remove('watching');
    state = 'setup';
    chosen = new Set([...chosen].filter(id => id < names.length));
    if (chosen.size < 2) chosen = defaultLineup();
    $('roster').replaceChildren();
    addMemberCards();
    for (let id = BASE_DRIVERS; id < names.length; id++) addCard(id);
    $('driverMessage').textContent = '';
    toggleSettings(true);
    $('rankTitle').textContent = '출전 선수';
    $('start').innerHTML = '경기 시작 <span aria-hidden="true">▶</span>';
    racers = [];
    focused = null;
    elapsed = 0;
    $('selection').hidden = false;
    $('standings').hidden = false;
    $('start').hidden = false;
    $('pause').hidden = true;
    $('reset').hidden = true;
    $('laps').disabled = false;
    $('centerOverlay').hidden = false;
    $('countdown').textContent = '';
    $('trackState').textContent = 'READY TO RACE';
    $('sessionStatus').textContent = 'ENTRY OPEN';
    $('timer').textContent = '00:00.00';
    $('lapLabel').textContent = $('laps').value + ' LAPS';
    $('focusLabel').textContent = 'FULL CIRCUIT VIEW';
    document.body.classList.remove('racing');
    syncSelection();
}
let resumeState = 'racing';
function pause() {
    if (state === 'countdown' || state === 'racing') {
        resumeState = state;
        state = 'paused';
        stopLoop();
        $('pause').textContent = '계속 관전 ▶';
        $('trackState').textContent = 'PAUSED';
        $('countdown').textContent = 'Ⅱ';
        document.body.classList.remove('racing');
    } else if (state === 'paused') {
        state = resumeState;
        wakeLoop();
        $('pause').textContent = '일시 정지 Ⅱ';
        $('countdown').textContent = '';
        $('trackState').textContent = state === 'countdown' ? 'STARTING GRID' : 'LIVE RACE';
        document.body.classList.add('racing');
    } else if (state === 'finished') showResults();
}
// AudioContext는 만드는 데 수십 ms라 시작 클릭 안에서 만들면 첫 프레임이 멈춘다. 처음 누르는 순간 미리 만든다.
for (const type of ['pointerdown', 'keydown', 'touchend'])
    document.addEventListener(type, () => raceAudio.init(), { capture: true, once: true, passive: true });
$('start').onclick = start;
$('pause').onclick = pause;
$('reset').onclick = reset;
let visibilityPaused = false;
function handleVisibilityChange() {
    if (document.hidden) {
        visibilityPaused = state === 'racing' || state === 'countdown';
        if (visibilityPaused) pause();
        else stopLoop();
    } else {
        if (visibilityPaused && state === 'paused') pause();
        else if (state !== 'setup' && state !== 'paused') wakeLoop();
        visibilityPaused = false;
    }
}
document.addEventListener('visibilitychange', handleVisibilityChange);
// 캐시한 정렬 순서는 실제 progress/finish 값으로 검증한다.
let indexedRacers = null;
const sortedRacers = [],
    activeRacers = [],
    racersById = new Map();
let rankingDirty = true;
function syncRacerIndex() {
    if (indexedRacers !== racers || racersById.size !== racers.length) {
        indexedRacers = racers;
        rankingDirty = true;
        sortedRacers.length = 0;
        racersById.clear();
        for (const r of racers) racersById.set(r.id, r);
    }
}
function getRacer(id) {
    syncRacerIndex();
    return racersById.get(id);
}
function rankCompare(a, b) {
    return a.finish !== null && b.finish !== null
        ? a.finish - b.finish
        : a.finish !== null
          ? -1
          : b.finish !== null
            ? 1
            : b.progress - a.progress;
}
// 거의 정렬된 상태라 제자리 삽입 정렬이 O(n)이다.
function order() {
    syncRacerIndex();
    const a = sortedRacers;
    if (!rankingDirty) return a;
    if (a.length !== racers.length) {
        a.length = 0;
        for (const r of racers) a.push(r);
    }
    for (let i = 1; i < a.length; i++) {
        const v = a[i];
        let j = i - 1;
        while (j >= 0 && rankCompare(a[j], v) > 0) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = v;
    }
    rankingDirty = false;
    return a;
}
// 틱마다 새 배열을 만들지 않고 만료 항목을 지운다.
function compact(list, keep) {
    let w = 0;
    for (let i = 0; i < list.length; i++) if (keep(list[i])) list[w++] = list[i];
    list.length = w;
}
function formatTime(t) {
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + (t % 60).toFixed(2).padStart(5, '0');
}
function announce(text) {
    eventAt = elapsed;
    $('commentary').textContent = text;
}
function tick(dt) {
    if (state === 'countdown') {
        countdown -= dt;
        const label = countdown > 0 ? Math.ceil(countdown) : 'GO';
        if (String(label) !== $('countdown').textContent) raceAudio.cue(label === 'GO' ? 'go' : 'count');
        setText($('countdown'), label);
        if (countdown < -0.55) {
            state = 'racing';
            $('countdown').textContent = '';
            $('trackState').textContent = 'LIVE · ITEM RACE';
            $('sessionStatus').textContent = trackTitle();
            announce('출발! 아이템을 자동으로 획득하고 사용합니다');
        }
        return;
    }
    if (state !== 'racing') return;
    elapsed += dt;
    const standings = order();
    // 배열 재사용 + 순위 인덱스로 "바로 앞차" 찾기를 짧은 역방향 탐색으로 끝낸다.
    const active = activeRacers;
    active.length = 0;
    for (const r of standings)
        if (r.finish === null) {
            r.ai = active.length;
            active.push(r);
        }
    const frontProgress = active[0]?.progress || 0;
    // 자석: 뒷차는 앞차와의 간격이 멀수록 세게 끌려가고(가까우면 +20%대, 멀면 최대 +60%), 끌려가는 앞차는 느려진다
    // (한 명에게 -12%, 여럿이 붙어도 -20%까지). 따라잡거나 대상이 완주하면 끝난다. 뒷차는 앞차 차선으로 붙어 간다.
    for (const r of racers) r.magnetDrag = 1;
    for (const r of racers) {
        if (!(r.magnet > 0) || r.finish !== null) continue;
        const t = getRacer(r.magnetTarget);
        if (!t || t.finish !== null || t.progress <= r.progress) {
            r.magnet = 0;
            continue;
        }
        t.magnetDrag = Math.max(0.8, t.magnetDrag * 0.88);
        r.magnetGap = t.progress - r.progress;
        r.laneTarget = t.lane;
    }
    for (const t of traps) t.ttl -= dt;
    compact(traps, t => t.ttl > 0);
    for (const e of effects) {
        e.ttl -= dt;
        if (e.ttl <= 0 && e.type === 'water' && !e.done) {
            e.done = true;
            for (const r of racers) {
                if (r.id === e.from || r.finish !== null) continue;
                const p = point(r.progress, r.lane),
                    dx = p.x - e.landing.x,
                    dy = p.y - e.landing.y;
                if (dx * dx + dy * dy <= 55 * 55) strike(r, 'water', e.owner);
            }
            effects.push({ type: 'water_splash', landing: e.landing, ttl: 0.6, total: 0.6 });
        }
        if (e.ttl <= 0 && (e.type === 'missile' || e.type === 'wisp') && !e.done) {
            e.done = true;
            const target = getRacer(e.id);
            if (target) strike(target, e.type === 'wisp' ? 'wisp' : 'missile', e.owner);
        }
    }
    compact(effects, e => e.ttl > 0);
    for (const r of racers) {
        if (r.finish !== null) continue;
        r.decision -= dt;
        r.boost = Math.max(0, r.boost - dt);
        r.stun = Math.max(0, r.stun - dt);
        r.ufo = Math.max(0, r.ufo - dt);
        r.shield = Math.max(0, r.shield - dt);
        r.immunity = Math.max(0, r.immunity - dt);
        r.magnet = Math.max(0, r.magnet - dt);
        r.itemTimer -= dt;
        if (r.item) {
            r.useIn -= dt;
            if (r.useIn <= 0) useItem(r, standings);
        }
        if (r.decision <= 0) {
            r.formTarget = (raceRandom() - 0.5) * 0.18;
            r.laneTarget = (raceRandom() - 0.5) * 38;
            r.decision = 1.5 + raceRandom() * 2.8;
        }
        r.form += (r.formTarget - r.form) * dt * 0.8;
        const a = (r.progress % 1) * Math.PI * 2,
            catchup = Math.min(0.17, Math.max(0, frontProgress - r.progress) * 0.32);
        let target =
            0.043 *
            (1 + r.form + catchup + 0.035 * Math.sin(a * 2 + r.phase)) *
            (r.boost > 0 ? 1.68 : r.magnet > 0 ? 1.15 + Math.min(0.45, (r.magnetGap || 0) * 9) : 1) *
            (r.stun > 0 ? 0.27 : r.ufo > 0 ? 0.52 : 1) *
            (r.magnetDrag || 1);
        let front = null;
        for (let j = r.ai - 1; j >= 0; j--) {
            const other = active[j],
                d = other.progress - r.progress;
            if (d >= 0.011) break;
            if (d > 0 && Math.abs(other.lane - r.lane) < 12) front = other;
        }
        if (front) {
            target *= 0.92;
            r.laneTarget = r.lane >= 0 ? -18 : 18;
        }
        // 조각을 하나씩 보고 꺾으면 다른 조각으로 뛰어드니, 앞쪽 조각을 한꺼번에 보고 전부 비낄 수 있는 가장 가까운 차선을 고른다.
        // 관성 때문에 늦게 발견하면 꺾다가 긁는다. 스핀 중이거나 우주선에 붙잡힌 선수는 반응하지 못한다.
        if (r.stun <= 0 && r.ufo <= 0) {
            barricadeAhead.length = 0;
            for (const t of traps) {
                if (t.kind !== 'barricade' || t.ttl <= 0 || r.id === t.owner) continue;
                const d = t.progress - r.progress;
                if (d > 0 && d <= BARRICADE_WARN) barricadeAhead.push(t);
            }
            let threatened = false;
            for (const t of barricadeAhead)
                if (Math.abs(r.lane - t.lane) < t.span + 8) {
                    threatened = true;
                    break;
                }
            if (threatened) {
                let best = null,
                    bestCost = Infinity;
                for (let cand = -20; cand <= 20; cand += 2) {
                    let clear = true;
                    for (const t of barricadeAhead)
                        if (Math.abs(cand - t.lane) < t.span + 2) {
                            clear = false;
                            break;
                        }
                    if (clear) {
                        const cost = Math.abs(cand - r.lane);
                        if (cost < bestCost) {
                            bestCost = cost;
                            best = cand;
                        }
                    }
                }
                r.laneTarget = best !== null ? best : r.lane >= 0 ? -20 : 20;
            }
        }
        r.speed += (target - r.speed) * Math.min(1, dt * (r.stun > 0 ? 8 : 2.4));
        r.lane += (r.laneTarget - r.lane) * Math.min(1, dt * 1.5);
        const before = r.progress;
        r.progress += r.speed * dt;
        for (const t of traps) {
            if (
                t.ttl > 0 &&
                r.id !== t.owner &&
                Math.abs(r.lane - t.lane) < (t.span || 20) &&
                Math.floor(r.progress - t.progress) > Math.floor(before - t.progress)
            ) {
                strike(r, t.kind || 'banana', names[t.owner]);
                if (--t.hits <= 0) t.ttl = 0;
            }
        }
        // 아이템 박스 통과. 손에 아이템이 있으면 지나친다 - 한 번에 하나만 든다.
        if (!r.item && r.itemTimer <= 0)
            for (const box of ITEM_BOXES) {
                if (Math.floor(r.progress - box) > Math.floor(before - box)) {
                    giveItem(r, standings);
                    break;
                }
            }
        if (r.progress >= laps) {
            r.finish = elapsed - dt + (laps - before) / r.speed;
            r.progress = laps;
            if (finishAt === null) {
                finishAt = r.finish;
                itemEvent(r.name + ' 체커기 통과! 끝까지 달린 승부!', r.id);
            } else if (elapsed - eventAt > 2) announce(r.name + ' 결승선 통과!');
        }
    }
    rankingDirty = true;
    const sorted = order();
    if (sorted[0] && lastLeader !== sorted[0].id) {
        if (lastLeader !== null) {
            itemStats.leadChanges++;
            if (elapsed - eventAt > 1.6 && sorted[0].finish === null)
                itemEvent(sorted[0].name + ' 선두 탈환! 승부가 뒤집힙니다', sorted[0].id);
        }
        lastLeader = sorted[0].id;
    }
    if (!finalAnnounced && sorted[0]?.progress >= laps - 1) {
        finalAnnounced = true;
        $('finalBadge').classList.add('is-visible');
        $('finalBadge').setAttribute('aria-hidden', 'false');
        announce('FINAL LAP · 마지막 아이템 하나가 승부를 바꿉니다!');
    }
    if (elapsed - eventAt > 4) setText($('itemToast'), '');
    if (elapsed - eventAt > 7)
        announce(
            sorted[0].finish !== null
                ? '아직 끝나지 않은 순위 싸움! 나머지 선수들도 결승선으로'
                : sorted[0].name + ' 선두! 후속 선수들이 다음 아이템을 노립니다'
        );
    let allDone = true;
    for (const r of racers)
        if (r.finish === null) {
            allDone = false;
            break;
        }
    if (allDone) {
        state = 'finished';
        slowMotion = false;
        document.body.classList.remove('racing');
        $('trackState').textContent = 'CHEQUERED FLAG';
        $('sessionStatus').textContent = 'RACE COMPLETE';
        $('pause').textContent = '결과 보기 ↗';
        $('commentary').textContent =
            sorted[0].name + ' 우승! 아이템 ' + itemStats.used + '회 · 선두 교체 ' + itemStats.leadChanges + '회';
        updateUI();
        showResults();
    }
}
function focus(id) {
    if (!racers.some(r => r.id === id)) return;
    focused = focused === id ? null : id;
    setCamera(focused === null ? 'auto' : 'driver');
    $('focusLabel').textContent = focused === null ? 'FULL CIRCUIT VIEW' : 'FOLLOWING · ' + names[focused];
    updateUI();
}
// 행과 아바타는 재사용하고 값이 바뀐 칸만 고친다.
const leaderRows = new Map();
let leaderOrder = '';
function createLeaderRow(r) {
    const button = document.createElement('button');
    button.className = 'leader';
    const rank = document.createElement('b'),
        info = document.createElement('span'),
        name = document.createElement('strong'),
        status = document.createElement('small'),
        gap = document.createElement('span');
    info.className = 'leader-info';
    name.textContent = r.name;
    info.append(name, status);
    button.append(rank, portrait(r.id, 40), info, gap);
    button.onclick = () => {
        if (state !== 'setup') focus(r.id);
    };
    return { button, rank, status, gap };
}
// 상태 한 줄의 세 종류: 당한 것(미끄러짐), 쓴 것(방어 중), 보유(🛡 방어막). 아이템 이름은 보유에만 쓴다.
function racerStatus(r) {
    if (state === 'setup') return '출전 대기';
    if (r.finish !== null) return 'FINISHED';
    if (r.stun > 0)
        return (
            {
                missile: '💥 폭발 충격',
                banana: '🍌 미끄러짐',
                water: '💧 물폭탄 감금',
                wisp: '💧 물파리 감금',
                barricade: '🚧 바리케이드 충돌',
                lightning: 'ϟ 감전',
            }[r.hitKind] || '피격'
        );
    if (r.ufo > 0) return '🛸 붙잡힘';
    if (r.shield > 0) return '🛡 방어 중';
    if (r.boost > 0) return '🔥 가속 중';
    if (r.magnet > 0) return '🧲 추격 중';
    if (r.magnetDrag < 1) return '🧲 끌려오는 중';
    return r.item ? itemNames[r.item] : Math.floor((Math.max(0, r.progress) / laps) * 100) + '%';
}
function updateUI() {
    const list =
        state === 'setup' ? [...chosen].map(id => ({ id, name: names[id], progress: 0, finish: null })) : order();
    setText($('timer'), formatTime(elapsed));
    setText(
        $('lapLabel'),
        state === 'finished'
            ? laps + ' / ' + laps + ' LAPS'
            : Math.min(laps, Math.floor(Math.max(0, list[0]?.progress || 0)) + 1) + ' / ' + laps + ' LAPS'
    );
    const signature = list.map(r => r.id).join(',');
    list.forEach((r, i) => {
        r.place = i + 1;
        let row = leaderRows.get(r.id);
        if (!row) {
            row = createLeaderRow(r);
            leaderRows.set(r.id, row);
        }
        const { button, rank, status, gap } = row;
        const isFocused = focused === r.id;
        if (row.isFocused !== isFocused) {
            button.classList.toggle('focus', isFocused);
            row.isFocused = isFocused;
        }
        setText(rank, state === 'setup' ? '—' : String(i + 1).padStart(2, '0'));
        setText(status, racerStatus(r));
        setText(
            gap,
            state === 'setup'
                ? ''
                : r.finish !== null
                  ? formatTime(r.finish)
                  : i === 0
                    ? 'LEADER'
                    : '+' + ((list[0].progress - r.progress) / 0.043).toFixed(1) + 's'
        );
        const label = i + 1 + '위 ' + r.name + ' 강조';
        if (row.label !== label) {
            button.setAttribute('aria-label', label);
            row.label = label;
        }
    });
    if (signature !== leaderOrder) {
        // 자리가 틀린 행만 옮긴다. DOM 순서가 화면 순서와 같아 포커스·탭 순서가 맞다.
        const parent = $('leaderList');
        let node = parent.firstChild;
        for (const r of list) {
            const wanted = leaderRows.get(r.id).button;
            if (node === wanted) {
                node = node.nextSibling;
                continue;
            }
            parent.insertBefore(wanted, node);
        }
        while (node) {
            const next = node.nextSibling;
            parent.removeChild(node);
            node = next;
        }
        leaderOrder = signature;
    }
}
function closeCeremony() {
    const dialog = $('ceremony');
    if (dialog.close) dialog.close();
}
function openCeremony() {
    if (state !== 'finished') return;
    const dialog = $('ceremony');
    if (!dialog.open && dialog.showModal) dialog.showModal();
}
let ceremonyResultsReady = false;
function buildCeremony() {
    ceremonyResultsReady = false;
    $('ceremonyResults').replaceChildren();
    $('podium').hidden = false;
    $('ceremonyResults').hidden = true;
    $('ceremonyRanking').textContent = '전체 순위';
    $('ceremonyTitle').textContent = '오늘의 주인공';
    const list = order();
    $('podium').replaceChildren();
    setText($('ceremonySummary'), racers.length + '명 출전 · ' + laps + '바퀴 · ' + trackTitle());
    for (const position of [1, 0, 2]) {
        const racer = list[position];
        if (!racer) continue;
        const card = document.createElement('section');
        card.className = 'podium-place place-' + (position + 1);
        const medal = document.createElement('span');
        medal.className = 'podium-medal';
        medal.textContent = ['우승', '2위', '3위'][position];
        const name = document.createElement('h3');
        name.textContent = racer.name;
        const time = document.createElement('p');
        time.className = 'podium-time';
        time.textContent = formatTime(racer.finish);
        const gap = document.createElement('small');
        gap.textContent = position === 0 ? 'WINNER' : '+' + (racer.finish - list[0].finish).toFixed(2) + '초';
        const stand = document.createElement('div');
        stand.className = 'podium-stand';
        stand.textContent = String(position + 1).padStart(2, '0');
        card.append(medal, portrait(racer.id, 128), name, time, gap, stand);
        $('podium').append(card);
    }
}
function toggleCeremonyRanking() {
    const panel = $('ceremonyResults'),
        show = panel.hidden;
    if (show && !ceremonyResultsReady) {
        const list = order();
        panel.replaceChildren();
        list.forEach((r, index) => {
            const row = document.createElement('div');
            row.className = 'ceremony-result-row';
            const rank = document.createElement('b');
            rank.textContent = String(index + 1).padStart(2, '0');
            const name = document.createElement('span');
            name.className = 'ceremony-result-name';
            name.textContent = r.name;
            const record = document.createElement('span');
            record.className = 'ceremony-result-time';
            record.textContent = r.finish == null ? '미완주' : formatTime(r.finish);
            const gap = document.createElement('small');
            gap.textContent =
                index === 0 ? '우승' : r.finish == null ? '—' : '+' + (r.finish - list[0].finish).toFixed(2) + '초';
            row.append(rank, portrait(r.id, 64), name, record, gap);
            panel.append(row);
        });
        ceremonyResultsReady = true;
        panel.scrollTop = 0;
    }
    panel.hidden = !show;
    $('podium').hidden = show;
    $('ceremonyRanking').textContent = show ? '시상대 보기' : '전체 순위';
    $('ceremonyTitle').textContent = show ? '전체 순위' : '오늘의 주인공';
}
function showResults() {
    raceAudio.stop();
    raceAudio.cue('finish');
    if (freezeLog.length) {
        const worst = freezeLog.reduce((a, b) => (b.stallMs > a.stallMs ? b : a));
        console.info(
            '[캄몬라이더] 이번 레이스 화면 멈춤 ' +
                freezeLog.length +
                '회 · 최악 ' +
                worst.stallMs +
                'ms (그중 자바스크립트 ' +
                worst.js +
                'ms) · 자세히 보려면 raceFreezes()'
        );
    }
    settleFrames = 90;
    $('replay').hidden = false;
    $('ceremonyOpen').hidden = false;
    $('rankTitle').textContent = '최종 순위';
    $('pause').hidden = true;
    $('start').hidden = false;
    $('start').textContent = '다시 경기';
    updateUI();
    buildCeremony();
    openCeremony();
}
$('ceremonyClose').onclick = reset;
$('ceremony').oncancel = e => {
    e.preventDefault();
    reset();
};
$('ceremonyRanking').onclick = toggleCeremonyRanking;
$('ceremonyReplay').onclick = start;
$('ceremonyLineup').onclick = reset;
$('ceremonyOpen').onclick = openCeremony;
function point(p, lane = 0, out = {}) {
    if (trackId === 'pocket') return fingerPoint(p, lane, out);
    const a = p * Math.PI * 2 + Math.PI / 2;
    const x = W * 0.5 + W * 0.355 * Math.cos(a) + 42 * Math.sin(a * 2);
    const y = H * 0.515 + H * 0.295 * Math.sin(a) + 40 * Math.sin(a * 3);
    const dx = -W * 0.355 * Math.sin(a) + 84 * Math.cos(a * 2),
        dy = H * 0.295 * Math.cos(a) + 120 * Math.cos(a * 3),
        angle = Math.atan2(dy, dx);
    out.cx = x;
    out.cy = y;
    out.x = x - Math.sin(angle) * lane;
    out.y = y + Math.cos(angle) * lane;
    out.angle = angle;
    return out;
}
function racerPoint(r) {
    let entry = kartDrawEntries.get(r.id);
    if (!entry) {
        entry = { r, p: { x: 0, y: 0, angle: 0 }, progress: NaN, lane: NaN };
        kartDrawEntries.set(r.id, entry);
    }
    if (entry.r !== r || entry.progress !== r.progress || entry.lane !== r.lane) {
        point(r.progress, r.lane, entry.p);
        entry.r = r;
        entry.progress = r.progress;
        entry.lane = r.lane;
    }
    return entry.p;
}
const compareKartDepth = (a, b) => a.p.y - b.p.y;
const PROJECTILE_DASH = [4, 6],
    SOLID_DASH = [];

const trackPoints = new Map();
function trackPoint(p, lane = 0) {
    const key = p + ':' + lane;
    let result = trackPoints.get(key);
    if (!result) {
        result = point(p, lane);
        trackPoints.set(key, result);
    }
    return result;
}
function path(offset = 0, context = g) {
    const g = context;
    g.beginPath();
    for (let i = 0; i <= 240; i++) {
        let p = trackPoint(i / 240, offset);
        i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
    }
    g.closePath();
}

function paintPark(g) {
    if (trackId === 'pocket') {
        g.fillStyle = '#dcebd7';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#efe5cc';
        g.beginPath();
        g.roundRect(340, 330, 320, 340, 40);
        g.fill();
        g.fillStyle = '#aed8e9';
        g.beginPath();
        g.ellipse(500, 490, 55, 70, 0, 0, 7);
        g.fill();
        g.strokeStyle = '#f7f4e9';
        g.lineWidth = 12;
        g.stroke();
        const roofColors = ['#6c9ed1', '#d89583', '#98af7c'];
        for (let row = 0; row < 7; row++)
            for (let col = 0; col < 7; col++) {
                const x = 65 + col * 145,
                    y = 65 + row * 145;
                let distance = Infinity;
                for (let i = 0; i < villageSamples; i += 8)
                    distance = Math.min(distance, Math.hypot(x - villageX[i], y - villageY[i]));
                if (distance < 112 || Math.hypot(x - 500, y - 490) < 110) continue;
                g.fillStyle = '#42644620';
                g.fillRect(x - 23, y - 10, 59, 58);
                g.fillStyle = '#fff6e5';
                g.fillRect(x - 27, y - 24, 54, 56);
                g.fillStyle = roofColors[(row + col) % 3];
                g.beginPath();
                g.moveTo(x - 35, y - 20);
                g.lineTo(x, y - 48);
                g.lineTo(x + 35, y - 20);
                g.closePath();
                g.fill();
                g.fillStyle = '#90b9cf';
                g.fillRect(x - 17, y - 10, 12, 13);
                g.fillRect(x + 5, y - 10, 12, 13);
                g.fillStyle = '#b99e79';
                g.fillRect(x - 6, y + 12, 12, 20);
            }
        for (let i = 0; i < 70; i++) {
            const x = 35 + ((i * 197) % 930),
                y = 35 + ((i * 113) % 930);
            let d = Infinity;
            for (let j = 0; j < villageSamples; j += 16) d = Math.min(d, Math.hypot(x - villageX[j], y - villageY[j]));
            if (d < 88 || (x > 320 && x < 690 && y > 280 && y < 710)) continue;
            g.fillStyle = '#49745b22';
            g.beginPath();
            g.arc(x + 4, y + 5, 12, 0, 7);
            g.fill();
            g.fillStyle = i % 2 ? '#82ae7e' : '#a6bc82';
            g.beginPath();
            g.arc(x, y, 12, 0, 7);
            g.fill();
        }
        return;
    }

    g.fillStyle = '#deeadf';
    g.fillRect(-1000, -1000, 3200, 2800);
    // 안쪽 산책로와 연못.
    g.strokeStyle = '#f5eedf';
    g.lineWidth = 20;
    g.beginPath();
    g.moveTo(290, 325);
    g.bezierCurveTo(430, 250, 690, 490, 900, 390);
    g.stroke();
    g.fillStyle = '#badbe9';
    g.beginPath();
    g.ellipse(780, 342, 79, 45, -0.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#96c5dc';
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = '#e6f9ff';
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.ellipse(750 + i * 17, 335 + i * 4, 19, 4, 0, 0, Math.PI);
        g.stroke();
    }
    function tree(x, y, r, c) {
        g.fillStyle = '#254b3020';
        g.beginPath();
        g.ellipse(x + 8, y + 10, r, r * 0.68, 0, 0, 7);
        g.fill();
        g.fillStyle = '#81694a';
        g.fillRect(x - 2, y, 4, r * 0.85);
        g.fillStyle = c;
        g.beginPath();
        g.arc(x, y - 6, r, 0, 7);
        g.fill();
        g.fillStyle = '#ffffff17';
        g.beginPath();
        g.arc(x - r * 0.25, y - r * 0.35, r * 0.55, 0, 7);
        g.fill();
    }
    for (let i = 0; i < 160; i++) {
        let x = ((i * 197 + 43) % 1480) - 140,
            y = ((i * 131 + 19) % 980) - 110;
        let nearest = Infinity;
        for (let j = 0; j < 100; j++) {
            const p = trackPoint(j / 100);
            nearest = Math.min(nearest, Math.hypot(x - p.x, y - p.y));
        }
        const infield = x > 270 && x < 925 && y > 230 && y < 510;
        if (nearest > 90 && !infield)
            tree(x, y, 12 + (i % 5) * 3, ['#79a77b', '#639772', '#96b97e', '#d1b17a', '#89ab80'][i % 5]);
    }
    for (const [x, y] of [
        [360, 335],
        [405, 370],
        [340, 405],
        [480, 285],
        [520, 300],
        [900, 360],
        [895, 425],
    ])
        tree(x, y, 17, '#7eaa86');
    // 서킷 바깥 관중석.
    for (const [x, y] of [
        [400, 58],
        [720, 58],
        [370, 690],
        [740, 690],
    ]) {
        g.fillStyle = '#25344c20';
        g.fillRect(x - 4, y + 5, 148, 36);
        for (let row = 0; row < 4; row++) {
            g.fillStyle = row % 2 ? '#f8fbff' : '#73a5ed';
            g.fillRect(x, y + row * 7, 140, 6);
            for (let col = 0; col < 20; col++) {
                g.fillStyle = ['#245bc2', '#6e8098', '#fafafa'][col % 3];
                g.beginPath();
                g.arc(x + 4 + col * 7, y + row * 7 + 2, 1.8, 0, 7);
                g.fill();
            }
        }
    }
    // 피크닉 광장, 꽃, 조명.
    for (const [x, y] of [
        [415, 440],
        [455, 455],
        [890, 295],
    ]) {
        g.fillStyle = '#b99165';
        g.fillRect(x, y, 24, 5);
        g.fillRect(x, y + 10, 24, 5);
        g.fillStyle = '#6c7370';
        g.fillRect(x + 3, y + 5, 3, 5);
        g.fillRect(x + 18, y + 5, 3, 5);
    }
    for (let i = 0; i < 22; i++) {
        g.fillStyle = ['#f4a8bb', '#fff3a5', '#c8b8f3'][i % 3];
        g.beginPath();
        g.arc(590 + (i % 11) * 9, 470 + Math.floor(i / 11) * 9, 3, 0, 7);
        g.fill();
    }
}
// 정적 서킷 캐시는 논리 트랙과 1:1이다. 페이지에서 가장 큰 비트맵이라 확대 선명도보다 메모리를 택한다.
let trackRaster = null;
const RASTER_SCALE = 1;
// 레이스 시작을 켜기 전, 첫 로딩 때 정적 배경을 준비한다.

function prepareTrackRaster() {
    if (trackRaster) return;
    const raster = document.createElement('canvas');
    raster.width = Math.round(W * RASTER_SCALE);
    raster.height = Math.round(H * RASTER_SCALE);
    const ctx = raster.getContext('2d');
    ctx.scale(RASTER_SCALE, RASTER_SCALE);
    paintTrack(ctx);
    trackRaster = raster;
}
function drawTrack() {
    g.drawImage(trackRaster, 0, 0, W, H);
}
// 확대해도 흐려지지 않아야 하는 마킹 - 출발 그리드 18칸과 체커기.
function drawStartMarkings() {
    for (let i = 0; i < 18; i++) {
        const p = trackPoint(-0.01 - Math.floor(i / 3) * 0.012, ((i % 3) - 1) * 18);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.angle);
        g.strokeStyle = '#e9efda70';
        g.lineWidth = 1;
        g.strokeRect(-9, -6, 18, 12);
        g.restore();
    }
    const p = trackPoint(0);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.angle);
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 8; j++) {
            g.fillStyle = (i + j) % 2 ? '#fff' : '#24313e';
            g.fillRect(i * 7 - 10, j * 8 - 32, 7, 8);
        }
    g.restore();
}
// 아이템이 정해진 자리에서 나오니 그 자리를 노면에 표시한다. 글자는 직선 구간에서 뒤집히지 않게 회전시키지 않는다.
const ITEM_BOX_LANES = [-16, 0, 16];
function drawItemBoxes() {
    const halfW = W / (2 * camera.z) + 24,
        halfH = H / (2 * camera.z) + 24,
        pulse = 1 + Math.sin(elapsed * 2.6) * 0.06;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 9px Pretendard,sans-serif';
    for (const box of ITEM_BOXES)
        for (const lane of ITEM_BOX_LANES) {
            const p = trackPoint(box, lane);
            if (Math.abs(p.x - camera.x) > halfW || Math.abs(p.y - camera.y) > halfH) continue;
            const half = 5.5 * pulse;
            g.save();
            g.translate(p.x, p.y);
            g.fillStyle = '#f7fbffe6';
            g.strokeStyle = '#5a9ae8';
            g.lineWidth = 1.4;
            g.beginPath();
            g.roundRect(-half, -half, half * 2, half * 2, 3);
            g.fill();
            g.stroke();
            g.fillStyle = '#3f8ce8';
            g.fillText('?', 0, 0.5);
            g.restore();
        }
    g.textBaseline = 'alphabetic';
}
function paintTrack(context) {
    const g = context;
    paintPark(g);
    // 런오프, 럼블 스트립, 노면.
    path(0, g);
    g.strokeStyle = '#c4d2b8';
    g.lineWidth = 127;
    g.stroke();
    path(0, g);
    g.strokeStyle = '#d8cbb0';
    g.lineWidth = 111;
    g.stroke();
    path(0, g);
    g.strokeStyle = '#f3f5e9';
    g.lineWidth = 91;
    g.stroke();
    for (let i = 0; i < 220; i++) {
        const a = trackPoint(i / 220),
            b = trackPoint((i + 1) / 220);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineWidth = 80;
        g.strokeStyle = i % 2 ? '#f5f7f4' : '#4c90df';
        g.stroke();
    }
    path(0, g);
    g.strokeStyle = '#39454e';
    g.lineWidth = 67;
    g.stroke();
    path(0, g);
    g.strokeStyle = '#4a5660';
    g.lineWidth = 59;
    g.stroke();
    for (const side of [-1, 1]) {
        path(side * 29, g);
        g.strokeStyle = '#dce4dd';
        g.lineWidth = 1.4;
        g.stroke();
    }
    path(0, g);
    g.strokeStyle = '#d2d8c670';
    g.lineWidth = 1;
    g.setLineDash([9, 20]);
    g.stroke();
    g.setLineDash([]);
    // 제동 구간의 타이어 자국.
    for (const start of [0.13, 0.36, 0.65, 0.85])
        for (const lane of [-12, -7]) {
            g.strokeStyle = '#15222b55';
            g.lineWidth = 2;
            g.beginPath();
            for (let j = 0; j < 24; j++) {
                const p = trackPoint(start + j * 0.0014, lane + Math.sin(j * 0.13) * 4);
                j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
            }
            g.stroke();
        }
    // 코너를 따라 세운 방호벽과 기둥.
    for (let i = 0; i < 96; i++) {
        if (i % 12 > 8) continue;
        for (const side of [-1, 1]) {
            const p = trackPoint(i / 96, side * 56),
                q = trackPoint((i + 0.65) / 96, side * 56);
            g.strokeStyle = i % 3 ? '#e9eff5' : '#478dde';
            g.lineWidth = 7;
            g.beginPath();
            g.moveTo(p.x, p.y);
            g.lineTo(q.x, q.y);
            g.stroke();
        }
    }
    for (const t of [0.11, 0.34, 0.63, 0.85]) {
        for (let j = 0; j < 7; j++) {
            const p = trackPoint(t + j * 0.004, 64);
            g.fillStyle = j % 2 ? '#2e414c' : '#517fa9';
            g.beginPath();
            g.arc(p.x, p.y, 4.5, 0, 7);
            g.fill();
            g.strokeStyle = '#172d3644';
            g.lineWidth = 1;
            g.stroke();
        }
    }
    // 출발 그리드와 체커기는 래스터에 굽지 않고 매 프레임 벡터로 그린다. 3.7배 확대에서 대비 큰 체커기가 바로 뭉개진다.
    if (trackId === 'pocket') return;
    // 원형 정원이 있는 작은 인필드(글자 없음).
    g.fillStyle = '#c3d6ba';
    g.beginPath();
    g.ellipse(582, 383, 71, 48, 0, 0, 7);
    g.fill();
    g.strokeStyle = '#eee9da';
    g.lineWidth = 10;
    g.stroke();
    for (let j = 0; j < 28; j++) {
        const a = (j / 28) * Math.PI * 2;
        g.fillStyle = ['#83af83', '#f1bfcd', '#e8d98d', '#94baca'][j % 4];
        g.beginPath();
        g.arc(582 + Math.cos(a) * 52, 383 + Math.sin(a) * 32, 5, 0, 7);
        g.fill();
    }
}
// 🪰 이모지는 색을 바꿀 수 없어 물파리만 직접 그린다.
function drawWaterFly(x, y, r) {
    g.save();
    g.translate(x, y);
    g.fillStyle = '#aee0fa';
    g.strokeStyle = '#7cc9f2';
    g.lineWidth = r * 0.07;
    g.beginPath();
    g.ellipse(-r * 0.46, -r * 0.42, r * 0.46, r * 0.21, -0.733, 0, 7);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(r * 0.46, -r * 0.42, r * 0.46, r * 0.21, 0.733, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = '#3fadea';
    g.beginPath();
    g.ellipse(0, r * 0.12, r * 0.37, r * 0.46, 0, 0, 7);
    g.fill();
    g.fillStyle = '#7fd4f7';
    g.beginPath();
    g.arc(0, -r * 0.34, r * 0.26, 0, 7);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(-r * 0.13, -r * 0.42, r * 0.07, 0, 7);
    g.fill();
    g.restore();
}
function drawHitStatus(r, p) {
    const age = elapsed - r.hitAt;
    g.save();
    g.translate(p.x, p.y);
    if (r.hitKind === 'water' || r.hitKind === 'wisp') {
        const bub = r.hitKind === 'wisp' ? 20 : 25;
        g.fillStyle = '#7ad8ff50';
        g.strokeStyle = '#a6edff';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(0, -3, bub + Math.sin(age * 6) * 2, 0, 7);
        g.fill();
        g.stroke();
        g.strokeStyle = '#efffff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(-1, -4, 19, 3.8, 4.7);
        g.stroke();
        for (let j = 0; j < 4; j++) {
            g.fillStyle = '#9ce8ff';
            g.beginPath();
            g.arc(Math.sin(j * 2.1 + age) * (bub + 4), Math.cos(j * 2.1 + age) * (bub + 2) - 3, 2.5, 0, 7);
            g.fill();
        }
        if (r.hitKind === 'wisp') drawWaterFly(19, -22, 8);
    } else if (r.hitKind === 'barricade') {
        g.strokeStyle = '#e8863f';
        g.lineWidth = 2.5;
        for (let j = 0; j < 2; j++) {
            g.beginPath();
            g.arc(0, 2, 17 + j * 9 + age * 10, 0.5 + age * 2, 2.3 + age * 2);
            g.stroke();
        }
        g.font = '17px Pretendard,sans-serif';
        g.textAlign = 'center';
        g.fillText('🚧', 19, -20);
    } else if (r.hitKind === 'lightning') {
        g.strokeStyle = '#e4c9ff';
        g.lineWidth = 2;
        for (let j = 0; j < 3; j++) {
            g.beginPath();
            g.moveTo(-22 + j * 20, -34);
            g.lineTo(-14 + j * 18, -22);
            g.lineTo(-21 + j * 19, -14);
            g.lineTo(-9 + j * 16, 0);
            g.stroke();
        }
        g.fillStyle = '#fff19b';
        g.font = 'bold 23px Pretendard,sans-serif';
        g.textAlign = 'center';
        g.fillText('ϟ', 0, -20);
    } else if (r.hitKind === 'banana') {
        g.strokeStyle = '#34352499';
        g.lineWidth = 2;
        for (let j = 0; j < 2; j++) {
            g.beginPath();
            g.arc(j * 13 - 7, 3, 19 + age * 4, 0.3 + age, 2.5 + age);
            g.stroke();
        }
        g.font = '18px Pretendard,sans-serif';
        g.textAlign = 'center';
        g.fillText('🍌', 20, -20);
    } else if (r.hitKind === 'missile') {
        for (let j = 0; j < 3; j++) {
            g.fillStyle = ['#65676f70', '#9a929377', '#d0b9a560'][j % 3];
            g.beginPath();
            g.arc(Math.sin(j * 2.3 + age) * 8, -10 - age * 7 - j * 4, 4 + j, 0, 7);
            g.fill();
        }
        g.fillStyle = '#ffd58a';
        g.font = '17px Pretendard,sans-serif';
        g.textAlign = 'center';
        g.fillText('✦', 19, -20);
    }
    g.restore();
}
const impactUnit = Array.from({ length: 20 }, (_, j) => {
    const a = (j / 20) * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
});
function drawImpact(e, p) {
    const age = 1 - e.ttl / e.total;
    g.save();
    g.translate(p.x, p.y);
    g.globalAlpha = Math.max(0, 1 - age);
    if (e.type === 'hit_missile') {
        g.fillStyle = '#ff8538';
        g.beginPath();
        for (let j = 0; j < 20; j++) {
            const unit = impactUnit[j],
                r = (j % 2 ? 7 : 15) * (1 + age * 0.35);
            j ? g.lineTo(unit.x * r, unit.y * r) : g.moveTo(unit.x * r, unit.y * r);
        }
        g.closePath();
        g.fill();
        g.fillStyle = '#ffe49c';
        g.beginPath();
        g.arc(0, 0, 6 * (1 - age) + 2, 0, 7);
        g.fill();
    } else if (e.type === 'hit_water' || e.type === 'hit_wisp') {
        const reach = e.type === 'hit_wisp' ? 26 : 45,
            drops = e.type === 'hit_wisp' ? 8 : 12;
        for (let j = 0; j < drops; j++) {
            const a = (j / drops) * Math.PI * 2;
            g.fillStyle = '#50c8ff';
            g.beginPath();
            g.ellipse(Math.cos(a) * (12 + age * reach), Math.sin(a) * (12 + age * reach), 3, 6, a, 0, 7);
            g.fill();
        }
    } else if (e.type === 'hit_lightning') {
        g.strokeStyle = '#fff38c';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(8, -85);
        g.lineTo(-10, -53);
        g.lineTo(9, -53);
        g.lineTo(-7, -16);
        g.stroke();
        g.strokeStyle = '#c4a0ff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 18 + age * 25, 0, 7);
        g.stroke();
    } else if (e.type === 'hit_banana') {
        g.strokeStyle = '#e3bd42';
        g.lineWidth = 3;
        for (let j = 0; j < 3; j++) {
            g.beginPath();
            g.arc(0, 0, 16 + j * 7, 0.2 + age * 4, 1.8 + age * 4);
            g.stroke();
        }
    } else if (e.type === 'hit_barricade') {
        g.strokeStyle = '#f0913f';
        g.lineWidth = 3;
        for (let j = 0; j < 3; j++) {
            g.beginPath();
            g.arc(0, 0, 10 + j * 8 + age * 18, 0, 7);
            g.stroke();
        }
        g.fillStyle = '#ffd9a8';
        for (let j = 0; j < 6; j++) {
            const a = (j / 6) * Math.PI * 2 + age;
            g.beginPath();
            g.arc(Math.cos(a) * (14 + age * 34), Math.sin(a) * (10 + age * 24), 2.5, 0, 7);
            g.fill();
        }
    }
    g.restore();
}
// 회전 변환에선 채우기가 느려서 카트 세부(그림자·바퀴·헤드라이트·든 아이템)는 확대했을 때만 그린다.
// 한 배율에서 켜고 끄면 줌 전환 때 한꺼번에 튀어나오므로 이 구간에서 서서히 나타나게 한다.
const KART_DETAIL_Z = 1.45,
    KART_DETAIL_FADE = 0.15;
const kartDetailAlpha = () =>
    Math.min(1, Math.max(0, (camera.z - (KART_DETAIL_Z - KART_DETAIL_FADE)) / (2 * KART_DETAIL_FADE)));
function drawKart(r, preview = false, p = point(r.progress, r.lane)) {
    const isFocused = focused === r.id;
    const detailAlpha = preview || isFocused ? 1 : kartDetailAlpha(),
        detail = detailAlpha > 0,
        baseAlpha = g.globalAlpha;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(
        p.angle +
            Math.PI / 2 +
            (r.stun > 0
                ? r.hitKind === 'banana'
                    ? (elapsed - r.hitAt) * 11
                    : r.hitKind === 'lightning'
                      ? Math.sin(elapsed * 55) * 0.13
                      : r.hitKind === 'missile'
                        ? Math.sin(elapsed * 28) * 0.3
                        : 0
                : 0)
    );
    if (r.boost > 0 && !preview && r.finish === null) {
        g.fillStyle = '#d5fd75cc';
        g.beginPath();
        g.moveTo(-7, 10);
        g.lineTo(0, 35 + Math.sin(elapsed * 28 + r.id) * 8);
        g.lineTo(7, 10);
        g.fill();
    }
    if (detail) {
        g.globalAlpha = baseAlpha * detailAlpha;
        g.fillStyle = '#18292335';
        g.beginPath();
        g.ellipse(3, 6, 15, 18, 0, 0, 7);
        g.fill();
        g.fillStyle = '#243033';
        for (let side of [-1, 1]) {
            g.fillRect(side * 10 - 3, -10, 6, 10);
            g.fillRect(side * 10 - 3, 6, 6, 10);
        }
        g.globalAlpha = baseAlpha;
    }
    g.fillStyle = colors[r.id];
    g.beginPath();
    g.roundRect(-9, -16, 18, 33, 5);
    g.fill();
    if (detail) {
        g.globalAlpha = baseAlpha * detailAlpha;
        g.fillStyle = '#f4f4d7';
        g.fillRect(-5, -14, 10, 3);
        g.globalAlpha = baseAlpha;
    }
    g.fillStyle = '#253039';
    g.fillRect(-14, 10, 28, 4);
    g.restore();
    drawKartFace(r.id, p.x - 10.5, p.y - 14.5, 21);
    if (r.shield > 0) {
        g.strokeStyle = '#62dbff';
        g.fillStyle = '#6feaff22';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, 21, 0, 7);
        g.fill();
        g.stroke();
    }
    if (r.stun > 0) drawHitStatus(r, p);
    // 전체 샷에선 아이템 글리프가 안 읽히고 순위표에 같은 정보가 있어 카트가 보일 때만 그린다.
    if (detail && (r.item || r.lastItemUntil > elapsed)) {
        const held = r.item || r.lastItem,
            itemAlpha = g.globalAlpha;
        g.globalAlpha = itemAlpha * detailAlpha;
        if (held === 'wisp') drawWaterFly(p.x + 19, p.y + 1, 8.5);
        else {
            g.font = '14px Pretendard,sans-serif';
            g.textAlign = 'center';
            g.fillText(itemNames[held].split(' ')[0], p.x + 19, p.y + 7);
        }
        g.globalAlpha = itemAlpha;
    }
    if (isFocused) {
        g.strokeStyle = '#eaff8d';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, 22, 0, 7);
        g.stroke();
    }
}
// ------------------------------------------------------------------ 카메라 디렉터
//  1. 수동 모드(전체·선두·드라이버)는 즉시 적용되고 유지 시간이 없다.
//  2. 자동 모드는 "샷" 단위로 움직인다. 어떤 샷도 SHOT_MIN 보다 짧게 끝나지 않는다.
//  3. 샷 우선순위: 결승선 > 전체 서킷(주기가 정한 차례) > 아이템 액션 > 선두 추격.
//  4. 진행 중인 샷을 끊을 수 있는 것은 결승선 샷뿐이다(놓치는 쪽이 더 나쁘다).
//  5. 샷이 시작되면 대상·동반 선수·줌이 그 샷 내내 고정된다.
//  6. 같은 그림이 다시 선택되면 컷 없이 그대로 이어간다.
//  7. 추격 BATTLE_RUN초 → 전체 WIDE_RUN초 주기. 마지막 바퀴에는 전체로 빠지지 않는다.
// 이 결정은 한 곳에서만 한다. 따로 덮어쓰면 샷 유지 중에도 화면이 한 프레임에 수백 픽셀씩 튄다.
const SHOT_MIN = 2, // 샷 최소 유지 시간(초)
    BATTLE_RUN = 14, // 선두 추격을 보여주는 시간
    WIDE_RUN = 7, // 그 뒤 전체 서킷을 보여주는 시간
    RIVAL_GAP = 0.1, // 이 안에 있으면 같은 화면에 담을 라이벌로 본다
    CUT_TIME = 0.17, // 컷 직후 카메라가 목표로 붙는 시간(스프링 시간 상수, 90% 도달 약 0.33초)
    FOLLOW_TIME = 0.33, // 샷이 자리잡은 뒤 따라가는 시간(움직이는 선수와의 간격 = 속도 × 이 값)
    CUT_EASE = 0.35; // 빠르게 붙는 구간에서 따라가기로 넘어가는 시간(초)
let shot = null,
    shotAge = 0;
// 카메라는 임계 감쇠 스프링(Unity SmoothDamp와 같은 식)이다. 지수 따라가기는 컷 첫 프레임에 튀고 전환이 덜컥거린다.
// 반환은 새 위치, 새 속도는 camDampVel에 둔다(프레임마다 배열을 만들지 않게).
let camDampVel = 0;
function camDamp(cur, target, vel, time, dt) {
    const w = 2 / time,
        x = w * dt,
        e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x),
        c = cur - target,
        t = (vel + w * c) * dt;
    camDampVel = (vel - w * t) * e;
    return target + (c + t) * e;
}
// 근접 샷(리더/드라이버/배틀/액션) 배율. 기본 2배, '화면 확대' 버튼을 누르면 4배.
let camBoost = 2;

// 지금 어떤 샷이어야 하는가. 상태를 읽기만 하고 아무것도 바꾸지 않는다.
let finishShotOn = false,
    finishShotDone = false,
    finishSlowAge = 0,
    finishPostAge = 0,
    finishScale = 1;
// 1→2위 착차 중간값이 0.45초라 1위 통과 직후 슬로우를 풀면 2위 장면을 버린다.
// 그래서 결승선 0.055바퀴 전부터 0.35배로 늦추고 3위까지 통과하면(최대 1.5초) 푼다.
const FINISH_SLOW = 0.35, // 슬로우 배속
    FINISH_LEAD = 0.055, // 결승선 몇 바퀴 전부터 느려지는가
    FINISH_HOLD = 5, // 슬로우 최대 지속(경기 시간). 선두가 맞아 늦어진 경우까지 덮는다
    FINISH_TAIL = 1.5, // 1위 통과 후 더 붙잡는 시간
    FINISH_PODIUM = 3; // 여기까지 들어오면 원속 복귀
function updateFinishDirection(dt) {
    const lead = order()[0];
    const auto = cameraMode === 'auto';
    if (!auto) {
        slowMotion = false;
        finishScale = 1;
        return rate;
    }
    if (!finishShotDone && lead && lead.progress >= laps - 0.13) finishShotOn = true;
    if (finishShotOn && finishAt !== null) {
        finishPostAge += dt;
        if (finishPostAge >= 1.8) {
            finishShotOn = false;
            finishShotDone = true;
        }
    }
    let done = 0;
    for (const r of racers) if (r.finish !== null) done++;
    const close =
        finishShotOn &&
        lead &&
        lead.progress >= laps - FINISH_LEAD &&
        finishSlowAge < FINISH_HOLD &&
        (finishAt === null || (done < FINISH_PODIUM && finishPostAge < FINISH_TAIL));
    if (close) finishSlowAge += dt;
    const target = close ? FINISH_SLOW : 1;
    finishScale += (target - finishScale) * (1 - Math.exp(-dt * (close ? 9 : 5)));
    slowMotion = finishScale < 0.97;
    return close || slowMotion ? Math.min(rate, 1) * finishScale : rate;
}
function chooseShot(list, alive, leader) {
    const progress = list[0]?.progress || 0,
        finalLap = progress >= laps - 1;
    if (finishShotOn)
        // 2배 배틀 샷과 차이가 보이게 3.7배로 당기고, 화면 확대(4배)면 같이 올린다.
        return {
            kind: 'finish',
            subjectId: null,
            partnerId: null,
            zoom: camBoost > 2 ? 4.8 : 3.7,
            label: 'CAM 04 · PHOTO FINISH',
        };
    // 주기는 경과 시간에서 바로 계산해 어긋날 상태가 없다.
    // 48명이면 아이템 이벤트가 끊이지 않아 전체 서킷 차례가 아이템 액션보다 앞서야 전체 화면이 나온다.
    const wideTurn = !finalLap && elapsed % (BATTLE_RUN + WIDE_RUN) >= BATTLE_RUN;
    if (wideTurn || !leader)
        return { kind: 'wide', subjectId: null, partnerId: null, zoom: 1, label: 'CAM 01 · 전체 서킷' };
    if (elapsed < cameraUntil) {
        const target = getRacer(cameraTarget) || leader;
        if (target)
            return { kind: 'action', subjectId: target.id, partnerId: null, zoom: 2.4, label: 'CAM 03 · ITEM ACTION' };
    }
    let rival = null;
    for (const r of alive)
        if (r.id !== leader.id && Math.abs(r.progress - leader.progress) < RIVAL_GAP) {
            rival = r;
            break;
        }
    return {
        kind: 'battle',
        subjectId: leader.id,
        partnerId: rival ? rival.id : null,
        zoom: finalLap ? 2.9 : rival ? 2.6 : 2.3,
        label: finalLap ? 'CAM 02 · FINAL BATTLE' : 'CAM 02 · LEAD BATTLE',
    };
}
const sameShot = (a, b) => !!a && a.kind === b.kind && a.subjectId === b.subjectId && a.partnerId === b.partnerId;

function cameraStep(dt, list = order()) {
    const alive = cameraAlive;
    alive.length = 0;
    for (const r of list) if (r.finish === null) alive.push(r);
    const leader = alive[0] || list[0];
    let tx = W / 2,
        ty = H / 2,
        z = 1,
        label = 'CAM 01 · 전체 서킷';
    shotAge += dt;

    if (state === 'setup' || state === 'countdown' || !leader) {
        shot = null;
        shotAge = 0;
    } else if (cameraMode !== 'auto') {
        // 규칙 1 - 사람이 고른 화면은 기다리게 하지 않는다.
        shot = null;
        const subject = cameraMode === 'driver' ? getRacer(focused) || leader : cameraMode === 'leader' ? leader : null;
        if (subject) {
            const p = racerPoint(subject);
            tx = p.x;
            ty = p.y;
            z = cameraMode === 'driver' ? 3.5 : 2.3;
            label = (cameraMode === 'driver' ? 'CAM 05 · ' : 'CAM 02 · ') + subject.name;
        }
    } else {
        const progress = list[0]?.progress || 0;
        const finishPriority = finishShotOn ? shot?.kind !== 'finish' : shot?.kind === 'finish';
        const next = shot === null || shotAge >= SHOT_MIN || finishPriority ? chooseShot(list, alive, leader) : null;
        // 규칙 2 와 4.
        if (next) {
            if (!sameShot(shot, next)) shot = next; // 규칙 6 - 같은 그림이면 컷 없이 시간만 연장
            shotAge = 0;
        }
        // 규칙 5 - 여기서부터는 저장된 샷만 읽는다. 다시 고르지 않는다.
        label = shot.label;
        z = shot.zoom;
        if (shot.kind === 'finish') {
            // 3.7배로 당기면 화면이 좁아져서, 결승선을 화면 중앙에 두면 달려오는 무리가 오른쪽
            // 밖으로 잘린다. 중심을 진입 방향으로 물려서 체커기는 앞쪽에, 다가오는 팩은 가운데에.
            const p = trackPoint(0),
                approach = trackPoint(-0.035);
            tx = p.x + (approach.x - p.x) * 0.55;
            ty = p.y + (approach.y - p.y) * 0.55 - 8;
        } else if (shot.subjectId != null) {
            const subject = getRacer(shot.subjectId);
            if (subject) {
                const p = racerPoint(subject);
                tx = p.x;
                ty = p.y;
                const mate = shot.partnerId == null ? null : getRacer(shot.partnerId);
                if (mate && mate.finish === null) {
                    const q = racerPoint(mate);
                    tx = (tx + q.x) / 2;
                    ty = (ty + q.y) / 2;
                }
            } else {
                z = 1;
                label = 'CAM 01 · 전체 서킷';
            } // 담고 있던 선수가 사라지면 전체로 물러난다
        }
    }

    if (
        state !== 'setup' &&
        state !== 'countdown' &&
        (cameraMode === 'leader' ||
            cameraMode === 'driver' ||
            (cameraMode === 'auto' && (shot?.kind === 'battle' || shot?.kind === 'action')))
    )
        z = camBoost;
    // 확대는 로그로 움직여 줌인·줌아웃의 체감 속도를 같게 한다.
    const time = shot?.kind === 'finish' ? 0.2 : FOLLOW_TIME - (FOLLOW_TIME - CUT_TIME) * Math.exp(-shotAge / CUT_EASE);
    camera.x = camDamp(camera.x, tx, camera.vx || 0, time, dt);
    camera.vx = camDampVel;
    camera.y = camDamp(camera.y, ty, camera.vy || 0, time, dt);
    camera.vy = camDampVel;
    camera.z = Math.exp(camDamp(Math.log(camera.z), Math.log(z), camera.vz || 0, time, dt));
    camera.vz = camDampVel;
    camera.angle = 0;
    setText($('cameraLabel'), label);
    setText(
        $('focusLabel'),
        slowMotion
            ? 'PHOTO FINISH · SLOW MOTION'
            : cameraMode === 'auto'
              ? 'AUTO DIRECTOR'
              : cameraMode === 'wide'
                ? 'FULL CIRCUIT VIEW'
                : 'FOLLOW CAMERA'
    );
}
function drawEffects() {
    // 자석으로 붙은 두 카트를 점선으로 잇는다
    g.save();
    g.setLineDash(PROJECTILE_DASH);
    g.strokeStyle = '#ff6b6bb0';
    g.lineWidth = 2;
    for (const r of racers) {
        if (!(r.magnet > 0) || r.finish !== null) continue;
        const t = getRacer(r.magnetTarget);
        if (!t || t.finish !== null) continue;
        const a = racerPoint(r),
            ax = a.x,
            ay = a.y,
            b = racerPoint(t);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(b.x, b.y);
        g.stroke();
    }
    g.restore();
    const left = camera.x - W / (2 * camera.z),
        right = camera.x + W / (2 * camera.z),
        top = camera.y - H / (2 * camera.z),
        bottom = camera.y + H / (2 * camera.z);
    const visible = (x, y, pad) => x + pad >= left && x - pad <= right && y + pad >= top && y - pad <= bottom;
    if (traps.length) {
        g.font = '22px Pretendard,sans-serif';
        g.textAlign = 'center';
        for (const t of traps) {
            const p = t.drawPoint || (t.drawPoint = point(t.progress, t.lane));
            if (!visible(p.x, p.y, 38)) continue;
            g.fillText(t.kind === 'barricade' ? '🚧' : '🍌', p.x, p.y + 7);
        }
    }
    for (const e of effects) {
        if (e.type === 'water' || e.type === 'water_splash') {
            const p = e.landing;
            if (e.type === 'water') {
                const t = Math.max(0, Math.min(1, 1 - e.ttl / e.total)),
                    x = e.origin.x + (p.x - e.origin.x) * t,
                    y = e.origin.y + (p.y - e.origin.y) * t - 100 * t * (1 - t);
                if (visible(x, y, 12)) {
                    g.fillStyle = '#41b9ff';
                    g.beginPath();
                    g.arc(x, y, 7, 0, 7);
                    g.fill();
                    g.fillStyle = '#d5f5ff';
                    g.beginPath();
                    g.arc(x - 2, y - 2, 2, 0, 7);
                    g.fill();
                }
            } else if (visible(p.x, p.y, 60)) {
                g.save();
                g.globalAlpha = Math.max(0, e.ttl / e.total);
                g.strokeStyle = '#6ae6ff';
                g.lineWidth = 3;
                g.beginPath();
                g.arc(p.x, p.y, 12 + (1 - e.ttl / e.total) * 43, 0, 7);
                g.stroke();
                g.restore();
            }
            continue;
        }
        const r = getRacer(e.id);
        if (!r) continue;
        const entry = kartDrawEntries.get(r.id);
        const p = racerPoint(r);
        if (e.type !== 'missile' && e.type !== 'water' && e.type !== 'wisp' && !visible(p.x, p.y, 96)) continue;
        if (e.type.startsWith('hit_')) {
            drawImpact(e, p);
        } else if (e.type === 'ufo') {
            g.fillStyle = '#b0a3ff55';
            g.beginPath();
            g.moveTo(p.x, p.y - 54);
            g.lineTo(p.x - 22, p.y + 8);
            g.lineTo(p.x + 22, p.y + 8);
            g.fill();
            g.font = '30px Pretendard,sans-serif';
            g.textAlign = 'center';
            g.fillText('🛸', p.x, p.y - 38);
        } else if (e.type === 'missile' || e.type === 'water' || e.type === 'wisp') {
            const from = getRacer(e.from);
            if (!from) continue;
            const a = racerPoint(from),
                t = 1 - e.ttl / e.total,
                x = a.x + (p.x - a.x) * t,
                y = a.y + (p.y - a.y) * t;
            if (
                Math.max(a.x, x) + 8 < left ||
                Math.min(a.x, x) - 8 > right ||
                Math.max(a.y, y) + 8 < top ||
                Math.min(a.y, y) - 8 > bottom
            )
                continue;
            const wet = e.type === 'water' || e.type === 'wisp';
            g.strokeStyle = wet ? '#5acaff' : '#ff9c4c';
            g.lineWidth = 3;
            g.setLineDash(PROJECTILE_DASH);
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(x, y);
            g.stroke();
            g.setLineDash(SOLID_DASH);
            g.fillStyle = wet ? '#41b9ff' : '#ff653c';
            g.beginPath();
            g.arc(x, y, 6, 0, 7);
            g.fill();
        } else {
            g.strokeStyle = e.type === 'block' || e.type === 'splash' ? '#6ae6ff' : '#ffbb45';
            g.lineWidth = 3;
            g.beginPath();
            g.arc(p.x, p.y, 15 + (1 - e.ttl) * 35, 0, 7);
            g.stroke();
        }
    }
}
// 미니맵 정적 그림은 한 번 그리고 위치 점은 20Hz로 갱신한다.
let miniBackground = null,
    miniClock = 0,
    miniState = '';
function drawMini(dt = 1 / 60) {
    miniClock += dt;
    const signature = state + ':' + focused;
    if (miniState === signature && miniClock < 1 / 20) return;
    miniClock %= 1 / 20;
    miniState = signature;
    if (!miniBackground) {
        miniBackground = document.createElement('canvas');
        miniBackground.width = 240;
        miniBackground.height = 150;
        const paint = miniBackground.getContext('2d');
        paint.fillStyle = '#152b2bdd';
        paint.fillRect(0, 0, 240, 150);
        paint.translate((240 - W * Math.min(240 / W, 150 / H)) / 2, (150 - H * Math.min(240 / W, 150 / H)) / 2);
        paint.scale(Math.min(240 / W, 150 / H), Math.min(240 / W, 150 / H));
        paint.strokeStyle = '#b0c997';
        paint.lineWidth = 10;
        paint.beginPath();
        for (let i = 0; i <= 100; i++) {
            const p = point(i / 100);
            i ? paint.lineTo(p.x, p.y) : paint.moveTo(p.x, p.y);
        }
        paint.stroke();
    }
    minimap.clearRect(0, 0, 240, 150);
    minimap.drawImage(miniBackground, 0, 0);
    minimap.save();
    const ms = Math.min(240 / W, 150 / H);
    minimap.translate((240 - W * ms) / 2, (150 - H * ms) / 2);
    minimap.scale(ms, ms);
    for (const r of racers) {
        const center = racerPoint(r);
        minimap.fillStyle = r.place === 1 ? '#d8ff73' : r.id === focused ? '#67e9ff' : '#fff';
        minimap.beginPath();
        minimap.arc(center.cx, center.cy, r.place === 1 ? 12 : 7, 0, 7);
        minimap.fill();
    }
    minimap.restore();
    minimap.fillStyle = '#d6e0cb';
    minimap.font = '9px Pretendard,sans-serif';
    minimap.fillText('LIVE CIRCUIT', 12, 16);
}
// 이름표는 카트 바로 위에 두고 자리가 차 있으면 한 줄 위로 쌓는다. 화면을 이름표 크기 격자로 나눠 Set으로 확인한다.
// 칸이 이름표보다 조금 좁아 몇 px 겹칠 수 있고, 위가 꽉 차면 멀리 보내지 않고 겹친다.
// 배치는 선두부터 해서 자리를 먼저 잡고, 그리기는 거꾸로 해서 선두 이름표가 위에 온다.
const NAMEPLATE_BUDGET = 17,
    PLATE_H = 23,
    PLATE_ROW = 27,
    PLATE_CELL_W = 84,
    PLATE_STEPS = 18,
    PLATE_TOP = 90;
const nameplatePicks = [],
    platePool = [],
    prefixWidths = new Map(),
    plateCells = new Set();
function plateCell(x, y) {
    return Math.round(x / PLATE_CELL_W) * 4096 + Math.round(y / PLATE_ROW);
}
function plateTaken(x, y, half) {
    return (
        plateCells.has(plateCell(x, y)) ||
        plateCells.has(plateCell(x - half, y)) ||
        plateCells.has(plateCell(x + half, y))
    );
}
function plateClaim(x, y, half) {
    plateCells.add(plateCell(x, y));
    plateCells.add(plateCell(x - half, y));
    plateCells.add(plateCell(x + half, y));
}
function plateWidth(prefix, name) {
    let a = prefixWidths.get(prefix);
    if (a === undefined) {
        a = g.measureText(prefix).width;
        prefixWidths.set(prefix, a);
    }
    let b = nameWidths.get(name);
    if (b === undefined) {
        b = g.measureText(name).width;
        nameWidths.set(name, b);
    }
    return Math.min(W - 24, a + b + 18);
}
function drawNameplates(list = order()) {
    if (state === 'setup') return;
    g.font = 'bold 13px Pretendard,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const picks = nameplatePicks;
    picks.length = 0;
    for (const r of list) {
        const entry = kartDrawEntries.get(r.id);
        const p = racerPoint(r);
        const px = W / 2 + (p.x - camera.x) * camera.z,
            py = H / 2 + (p.y - camera.y) * camera.z;
        if ((px < -70 || px > W + 70 || py < -70 || py > H + 70) && focused !== r.id) continue;
        const slot = platePool[picks.length] || (platePool[picks.length] = {});
        slot.r = r;
        slot.px = px;
        slot.py = py;
        picks.push(slot);
        if (picks.length >= NAMEPLATE_BUDGET) break;
    }
    plateCells.clear();
    for (let i = 0; i < picks.length; i++) {
        const s = picks[i],
            r = s.r;
        const outside = s.px < 12 || s.px > W - 12 || s.py < 12 || s.py > H - 12;
        s.prefix = (outside ? '↗ ' : '') + (r.finish !== null ? '✓ ' : r.place + ' ');
        s.text = s.prefix + r.name;
        s.w = plateWidth(s.prefix, r.name);
        const half = Math.max(0, s.w / 2 - 12);
        // 카트는 카메라 변환 안에서 그려져 확대하면 커지므로 띄우는 높이도 줌에 맞춘다. 붐비면 옆 칸으로 넘긴다.
        const lift = 38 * Math.min(camera.z, 2.6);
        const anchorY = Math.max(PLATE_TOP, Math.min(H - 55, s.py - lift));
        let x = 0,
            y = 0,
            placed = false;
        for (let col = 0; col < 3 && !placed; col++) {
            const spread = col === 0 ? 0 : col === 1 ? s.w / 2 + 42 : -(s.w / 2 + 42);
            const cx = Math.max(s.w / 2 + 8, Math.min(W - s.w / 2 - 8, s.px + spread));
            let cy = anchorY;
            for (let step = 0; step < PLATE_STEPS; step++) {
                if (!plateTaken(cx, cy, half)) {
                    x = cx;
                    y = cy;
                    placed = true;
                    break;
                }
                const next = cy - PLATE_ROW;
                if (next < PLATE_TOP) break;
                cy = next;
            }
        }
        if (!placed) {
            x = Math.max(s.w / 2 + 8, Math.min(W - s.w / 2 - 8, s.px));
            y = anchorY;
        }
        plateClaim(x, y, half);
        s.x = x;
        s.y = y;
    }
    for (let i = picks.length - 1; i >= 0; i--) {
        const s = picks[i],
            r = s.r,
            x = s.x,
            y = s.y;
        g.strokeStyle = focused === r.id ? '#82b3ff' : '#477dc7aa';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y + PLATE_H / 2);
        g.lineTo(Math.max(8, Math.min(W - 8, s.px)), Math.max(8, Math.min(H - 8, s.py)));
        g.stroke();
        g.fillStyle = focused === r.id ? '#b9d4ff' : r.finish !== null ? '#687b96ee' : '#16386aef';
        g.beginPath();
        g.roundRect(x - s.w / 2, y - PLATE_H / 2, s.w, PLATE_H, 5);
        g.fill();
        g.fillStyle = focused === r.id ? '#173660' : '#ffffff';
        g.fillText(s.text, x, y + 4);
    }
}
function render(dt = 0.016) {
    prepareTrackRaster();
    g.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    const list = order();
    cameraStep(state === 'paused' ? 0 : dt, list);
    g.fillStyle = '#e9f0fa';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(camera.z, camera.z);
    g.translate(-camera.x, -camera.y);
    drawTrack();
    drawStartMarkings();
    drawItemBoxes();
    if (ready) {
        if (state === 'setup') {
            [...chosen].forEach((id, i) =>
                drawKart({ id, progress: -Math.floor(i / 3) * 0.014, lane: ((i % 3) - 1) * 20, boost: 0 }, true)
            );
        } else {
            visibleKarts.length = 0;
            const halfW = W / (2 * camera.z) + 100,
                halfH = H / (2 * camera.z) + 100;
            for (const r of racers) {
                if (r.finish !== null) continue;
                const p = racerPoint(r),
                    entry = kartDrawEntries.get(r.id);
                if (Math.abs(p.x - camera.x) <= halfW && Math.abs(p.y - camera.y) <= halfH) visibleKarts.push(entry);
            }
            visibleKarts.sort(compareKartDepth);
            for (const entry of visibleKarts) drawKart(entry.r, false, entry.p);
        }
    }
    drawEffects();
    g.restore();
    drawNameplates(list);
    drawMini(dt);
}
// 프레임 멈춤 기록. 비용이 프레임당 비교 한 번이라 늘 켜 둔다. raceFreezes()로 보고, 주소에 #perf를 붙이면 바로 출력한다.
const freezeLog = [];
globalThis.raceFreezes = function () {
    if (!freezeLog.length) {
        console.log('기록된 멈춤 없음 — 이번 레이스에서 100ms를 넘긴 프레임이 없었습니다.');
        return [];
    }
    const worst = freezeLog.reduce((a, b) => (b.stallMs > a.stallMs ? b : a));
    console.log(
        '멈춤 ' + freezeLog.length + '회 · 최악 ' + worst.stallMs + 'ms · 그중 자바스크립트 ' + worst.js + 'ms'
    );
    (console.table || console.log)(freezeLog);
    return freezeLog.slice();
};
// 고정 스텝 시뮬레이션. 조절 값은 SIM_HZ 하나다.
const SIM_HZ = 60,
    SIM_STEP = 1 / SIM_HZ,
    MAX_SUBSTEPS = 8;
// 보간: 시뮬레이션은 1/60초 단위인데 화면 갱신 간격은 흔들려서 그대로 그리면 카트가 끊겨 보인다.
// 그릴 때만 남은 시간 비율만큼 직전 위치와 지금 사이에 놓았다가 되돌린다. 진행 판정은 그대로다.
function keepRacerSteps() {
    for (const r of racers) {
        r.prevProgress = r.progress;
        r.prevLane = r.lane;
    }
}
// 날아가는 아이템과 애니메이션도 단계마다 줄어드는 ttl·경과 시간을 같은 비율로 되돌려 그린다.
function renderSmooth(dt) {
    const a = state === 'racing' || state === 'paused' ? Math.min(1, Math.max(0, accumulator / SIM_STEP)) : 1;
    if (a >= 1) {
        render(dt);
        return;
    }
    const back = SIM_STEP * (1 - a),
        simElapsed = elapsed;
    for (const r of racers) {
        if (r.prevProgress === undefined) continue;
        r.simProgress = r.progress;
        r.simLane = r.lane;
        r.progress = r.prevProgress + (r.progress - r.prevProgress) * a;
        r.lane = r.prevLane + (r.lane - r.prevLane) * a;
    }
    for (const e of effects) {
        if (e.total === undefined) continue;
        e.simTtl = e.ttl;
        e.ttl = Math.min(e.total, e.ttl + back);
    }
    if (state === 'racing') elapsed = Math.max(0, elapsed - back);
    try {
        render(dt);
    } finally {
        elapsed = simElapsed;
        for (const r of racers) {
            if (r.simProgress === undefined) continue;
            r.progress = r.simProgress;
            r.lane = r.simLane;
            r.simProgress = undefined;
        }
        for (const e of effects) {
            if (e.simTtl === undefined) continue;
            e.ttl = e.simTtl;
            e.simTtl = undefined;
        }
    }
}
function frame(now) {
    frameHandle = null;
    const frameStart = performance.now();
    const rawDt = last === 0 ? 0 : (now - last) / 1000;
    const dt = Math.min(0.1, rawDt);
    last = now;
    if (state === 'racing') watchHiRes(rawDt);
    if (document.hidden || state === 'setup') {
        last = 0;
        return;
    }
    if (state === 'countdown') tick(dt);
    else if (state === 'racing') {
        // 슬로모션은 시뮬레이션 속도라 렌더를 건너뛴 프레임에서도 최신이어야 해서 여기서 매 프레임 정한다.
        accumulator += dt * updateFinishDirection(dt);
        let steps = 0;
        while (accumulator >= SIM_STEP && state === 'racing' && steps < MAX_SUBSTEPS) {
            keepRacerSteps();
            tick(SIM_STEP);
            accumulator -= SIM_STEP;
            steps++;
        }
        // 밀린 시간은 버린다. 느린 프레임이 다음 프레임을 더 느리게 하면 안 된다.
        if (accumulator > SIM_STEP * MAX_SUBSTEPS) accumulator = SIM_STEP * MAX_SUBSTEPS;
    }
    const animated = state === 'countdown' || state === 'racing';
    if (animated) {
        uiClock += dt;
        if (uiClock > 0.16) {
            updateUI();
            uiClock = 0;
        }
    }
    drawElapsed += dt;
    renderClock += dt;
    if ((animated || renderDirty || settleFrames > 0) && (renderDirty || renderClock + 0.0001 >= renderInterval)) {
        const drawDt = drawElapsed;
        drawElapsed = 0;
        renderClock = Math.max(0, renderClock - renderInterval);
        if (renderClock >= renderInterval) renderClock %= renderInterval;
        renderSmooth(drawDt);
        renderDirty = false;
        if (settleFrames > 0) settleFrames--;
    }
    if (animated && rawDt > 0.1) {
        const stall = {
            at: +elapsed.toFixed(2),
            stallMs: Math.round(rawDt * 1000),
            js: +(performance.now() - frameStart).toFixed(1),
            camZ: +camera.z.toFixed(2),
            cam: cameraMode,
            drivers: racers.length,
        };
        if (freezeLog.length >= 200) freezeLog.shift();
        freezeLog.push(stall);
        // 열린 페이지에서 #perf를 쳐도 새로고침 없이 바뀌므로 지금 읽는다.
        if (location.hash === '#perf') console.warn('[stall]', stall);
    }
    if (animated || renderDirty || settleFrames > 0) frameHandle = requestAnimationFrame(frame);
    else last = 0;
}
if (document.modelContext?.registerTool) {
    try {
        Promise.resolve(
            document.modelContext.registerTool({
                name: 'get_race_status',
                description: '관전 레이스의 출전 선수, 진행 상태 및 실제 통과 순위를 확인합니다',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                annotations: { readOnlyHint: true },
                execute: () => ({
                    state,
                    entrants: [...chosen].map(id => names[id]),
                    elapsed,
                    laps,
                    standings: order().map((r, i) => ({ rank: i + 1, name: r.name, finish: r.finish })),
                }),
            })
        ).catch(() => {});
    } catch {}
}

// 마우스 휠 단계만 부드럽게 하고 터치패드·터치·스크롤바는 그대로 둔다.
function installRosterScroll() {
    const el = $('roster');
    if (!el.addEventListener) return;
    let target = 0,
        raf = 0,
        previous = 0;
    const stop = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        target = el.scrollTop;
    };
    function animate(now) {
        const dt = Math.min(40, now - previous || 16);
        previous = now;
        target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, target));
        const gap = target - el.scrollTop;
        el.scrollTop = Math.abs(gap) < 0.5 ? target : el.scrollTop + gap * (1 - Math.exp(-dt / 60));
        if (Math.abs(target - el.scrollTop) > 0.5) raf = requestAnimationFrame(animate);
        else raf = 0;
    }
    el.addEventListener(
        'wheel',
        e => {
            if (
                e.ctrlKey ||
                Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
                window.matchMedia('(prefers-reduced-motion: reduce)').matches
            )
                return;
            const discrete = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 80);
            if (!discrete) {
                stop();
                return;
            }
            const max = el.scrollHeight - el.clientHeight;
            if (max <= 0) return;
            if ((e.deltaY < 0 && el.scrollTop <= 0) || (e.deltaY > 0 && el.scrollTop >= max - 1)) {
                stop();
                return;
            }
            e.preventDefault();
            if (!raf) target = el.scrollTop;
            const pixels =
                e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
            target = Math.max(0, Math.min(max, target + Math.sign(pixels) * Math.min(90, Math.abs(pixels) * 0.55)));
            if (!raf) {
                previous = 0;
                raf = requestAnimationFrame(animate);
            }
        },
        { passive: false }
    );
    for (const event of ['pointerdown', 'touchstart', 'keydown']) el.addEventListener(event, stop, { passive: true });
}
installRosterScroll();

$('soundToggle').onclick = raceAudio.toggle;

function selectTrack(value) {
    if (state !== 'setup' || !['park', 'pocket'].includes(value)) return;
    trackId = value;
    W = value === 'pocket' ? 1000 : 1200;
    H = value === 'pocket' ? 1000 : 740;
    trackPoints.clear();
    trackRaster = null;
    miniBackground = null;
    miniState = '';
    kartDrawEntries.clear();
    camera = { x: W / 2, y: H / 2, z: 1, angle: 0 };
    shot = null;
    shotAge = 0;
    cv.width = 0;
    fitRaceCanvas();
    prepareTrackRaster();
    $('trackName').textContent = trackTitle();
    renderDirty = true;
}
$('trackSelect').onchange = () => {
    selectTrack($('trackSelect').value);
    saveSetup();
};
