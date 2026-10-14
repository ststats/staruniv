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
    g = cv.getContext('2d'),
    source = new Image();
const names = [
    '주하랑',
    '소주양',
    '왜냐맨',
    '지두두',
    '남덕선',
    '햇살',
    '사테',
    '김민철',
    '김윤환',
    '토마토',
    '박준오',
    '먼진',
    '아리송이',
    '임조이',
    '배성흠',
    '비타밍',
    '낭니',
];
const coords = Array.from({ length: 17 }, (_, i) => [(i % 6) * 116, Math.floor(i / 6) * 132]);
const colors = [
    '#56b3ec',
    '#e374aa',
    '#56b3ec',
    '#e374aa',
    '#8b6dc2',
    '#e374aa',
    '#e374aa',
    '#8b6dc2',
    '#ee674e',
    '#56b3ec',
    '#8b6dc2',
    '#8b6dc2',
    '#56b3ec',
    '#8b6dc2',
    '#8b6dc2',
    '#e374aa',
    '#8b6dc2',
];
let chosen = new Set([8, 9, 0, 1, 15, 3, 7, 4]),
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
    r.item = hasAhead && Math.random() < 0.03 ? 'lightning' : pool[Math.floor(Math.random() * pool.length)];
    r.useIn = 0.45 + Math.random() * 0.9;
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

const BASE_DRIVERS = 17,
    MAX_DRIVERS = 48;
const CARD_ORDER = [8, 9, 13, 10, 0, 5, 1, 11, 14, 15, 12, 3, 6, 16, 7, 4, 2];
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
    if (id < BASE_DRIVERS) {
        brush.drawImage(source, coords[id][0], coords[id][1], 116, 132, 0, 0, size, size);
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
    CARD_ORDER.forEach(id => addCard(id));
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
    colors.push(['#9ed978', '#f5b263', '#8ccfee', '#d99be7', '#f38eac'][(id - BASE_DRIVERS) % 5]);
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
source.onload = async () => {
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
    portraits = names.map((_, i) => portrait(i));
    CARD_ORDER.forEach(i => addCard(i));
    restoreSetup();
    prepareTrackRaster();
    ready = true;
    syncSelection();
    $('error').textContent = '';
};
source.onerror = () => {
    $('error').textContent = '선수 사진을 불러오지 못했습니다. 파일을 다시 열어 주세요';
};
source.src =
    'data:image/webp;base64,UklGRuZFAQBXRUJQVlA4INpFAQCQYgOdASq4AowBPjEUiEKiISEXaZdgIAMEsTdwu7AlEL5lOP/Pn5f8vP7l+3nys8c9ifpT7r/l/9r/gP3L+aH/n7SOv/q797Pz/+E/7/+M/1n7dfLb/hf+f/R/634hfqv/yf5j98PoJ/Wz/hf3f/M/tD9Jv/L65/3j/LD4Nf2f/ef/L/X+63/3/3j9939c+7n5If7H/v//D/xfbf///vGfut/9Pcx/dP//+zh/5v3Y/6/y//1L/g/ur7R//v7PHTZ/GP1//Q/lT5n/jv0P+Y/u3+U/43+C/cf7Afwn/m/1PhR9V/qP/X/qfUX+WfiL+B/hf9J/4P8t+8XzB/0/9V45/mv8j/0f9J+W3yF/k39O/0/+D/df/H/vb9iH6Xcd3H/bn2Gvez71/yP8n/q//t/qffa+2/9fpL+qf6z/0/dz9gf9C/u//O/PP/VfQ3/H8R71D9zPgD/qP+Y/7v+h/Mb6av8f/6/8H88Pcx+j/7P/4/7b8wvsO/mv99/6/+U/LL///XR/+veX+1v/+/4/w9ftn/9CEtAafOX8HFyBURhm5JvX05YU4fV6dT/PsbmFmYUzQkZxDJVTdjYo5AelItMvY5Ie1PL003RuyrKZPyH4zyrdPdMZLGdkI5TPVAaM9hf9SWNXbCvOR03wWHI+h10sb27IlyufB6arx7m/VAWf7A0/Ggt2OLAeZaVXve27Efi5594aNnc9X2PfMFRdqqfeNPuQ/9ewI/581bupc/kbUR/hyjaZSqhbqbTErzT6dBOcZZPovwufLWZ5nkDFB4obx1TRwCPWS5iWokSiR5GdnRPBgSNy4yXIjsa+8uE98oV7hEGaywRcVpRqH/4ahklTVYuldT8zE98E9Qg9gH9Peygg0nuO7enBzBSr53nlAoZEEe0Mo9AW/PG7yzttF9Va3VE884/cV6hmBM+316ima70NUHHrqMeZ5YbNjX36YzGiwhIsHK874KZ0ZEAxQODIh8VZZhMAqI7HPvFIyyCt7wmqhVcIVefe9CaL87/lg8Aw5LrynGaIP/pQL633owJsSKvY6D+ayH31MQKxVZA6pctrc1g3wRa/+aK+q38UUbZEJnHjWE9yfuzzUDpkeCWc7Zibx2uy6F+biyDTMpn+gdtDKTbdi5qJ+26EremmLXSFgGIFpSnVqcnZ03zTH6I1jlI8t+6m3cEa6qVeq0NgleBXia/L8dzQ9lCGplOgBWzIhTn/J8cdbpQOuMY4xc/a6esHEB2xJzAFC8ScNiLt69szyVMfWfL7tXbc+KZoXkG+GJScLp1Gn2B1YzO95Vr8QMwh0ElpKlJX2zzO7hyYYo5pWGk0230sK5k7HTYltU9TaPPiYeV3VjdnUF7OFtDtfY+sCW8NkGt/MomG3vcnY+V2PgIuGyAKEglZxAxulHwXSuJKf4Z/ZTNlVs8NRKB9wpw1vsX/t9cvgEzOknxqs6qmT9c1LSKKPJDQdFLPKFRA9/0Ug4QcoCgZA7OiZ4NoZ0sTWiXNodJi6o5OMw8qDC8LVizzuCrUD3n0e0sGh1xp8WDOUjy5PNNMk79uiVr3l0YqCVHKZDgAAZ73emH1O+Fso6Dk/v8a++sMJjoZEnA/i7eeYQQAMtvMKyhDCjoVowte061jWaH7DytimbeGdXo02OXX/qaDWYGUk+EdgvTrWp63DRGYtyKOdOdNfZECzDMNhAF8q0RD7fW6HW0RjFJIhjlWIbEqv01bBpNV5ZCDCZrYGzJtXye746lsLry17Upj/1z3TwxJTuP/0Qu5z29Fwke0DAscrqHugDe1CWjelz/BJyNahPvVaFca9RU66ataBtVOZSg1y++0RchnBkCr1tuYpBWuWUd+LVrTWPQetumLjd33DiZ96d6RENDjar+EGqZiQeUY3dHSfQ9arUxHhyOGwsqC9jKK2gg3To+SpVxzDmuqJ9nzLHrAmYu+E0pBM+XsG6XpYEV4rMSHXxwUoqnMaFpmesh8O58bK6ch/epy25fNeN7sz3ovmlrIlx1z5zbv2DPwKKmZRosp/Bs4ceBT8YSEG5DS7QtJXe1Mq9e2CI2jeMUk82nSMWiTFY38Fk9pfh+UHS5z7B3KZjba1mBp1fsnL2TPZgXcL0b9gezfboLblCp+D1lONSnAaFVuQeAormRmjJ2HMYQ0VCKyLJne73A8TtoNXaKCH/mn46VJ5ydmKQEkKIosMGVYTIlE6Ja5AhoYpnDd/U/qwiBcVCfsrOea8O2+PgtluywB3qFeoLniZiDYL6csqX/xPzn6Q/uRcyWZvs1trfTDFKrFoqXlly8kqApdStkCISuk5i9lcQNBoFjBWWG6Sa/FzGeTHIUgI+0CuzwnbZTGIx0BraXP2z54rUyumcmLIP5iP1Qx+yJoCskUANoeGf5LmBwV21aW/V7Vn0CaPSgLV8EUgz4kS1No+9vs/kQ8eb0oiPNDzZaPb6Ah0SwrHAmVoPZmj/77ki+wseXf2nvGCcxw1PxDH8YPcbJw8innvfwphS40ZoXl/QDnOpKLdXlVCgG5L4xeU/unoHd8AeMmXnOP99lWb9+Q4/YmiFFlV0eL8VdprnuXd22/gO80fdtiQIlUvJiLUbL8PgKv+QTJ+Xl5zf404diIxFarCicKmh6JGhHmDN+cefYaLcpsdGvRfr+cIEkQlTl9G1qxVJMR6HckKG3e/zPhL8OrTaRoIgW6Xu4pJXu2jYAwvsZcjPurf9Bmss6OjeaXOQlNevnh5RGZRjJyLQGjwzcPL7mN/O3cqAKrh1Ygu6brX6Eix1Jefkp9lPUglzrH+CjP5Jrs0L/YdK2i8bgjeb8L4WzcC98ya/+QKFbZCO4e0auwz3AIHDdT/tI/Vo2m1yg0vNRDsetOF+h0GHTBVrLMj9zUhJ5aBfo/ta8pVIE25aTrORqVXD7D7jDZoNOLa8+rdEne2gnmejdU8P9opAZoRAcml3/MyoztyT09dJVf71BkmxjYpOZSqSyyr9/DzWuGvSEW/0iVZ+7FYp1Gs9gRS84guqfrGpeQo1+qn9nCDbgHK9EAZUIlZ7QE5mUqGNQpsbsQXEuOg9l2jQUPKSQbB3boZ3mvH3YaN36FCQpdPJ3FX5BtFysttA4Eje7LBWN7X3XZsKZp7t/8AoWyKVZXez6t8MwP/+2ku66aYBDkUIt2HdJm4dUn1fr6uHJZGv+9D0Ru3xKDDyJY9yOvI7SJk+aY+b+lXzDNbu4tK6YkWbgMAcmgj9wkvI3EqSilrxrerFHrahG5hThbHXqNWumTFh8B5e0NeNlsuQn5Qd27OpCGI/niEjvshkS1kWpL8KbTNwJmf+d8Al3Ovkjcar6B961qqXnYrKv+4NYjAv3fesaO791TiEH052Gx9iu3dmN2ZJfVyyvWpJBQJJm+DNRerl/emOgyocs9pPZ/Xrt483LZQ+NFk5/CRJjUW0070gnlPe+0J6y5SZLmL+/pmK52y/5l+f+4y1Od45MFtx5yvtUeL1eKvZrM20iDCO9qg39N6uyzMVaUxF/fiL9W1OlVYFuxLVuODPP9/a8kRZm6PzP9sQxxYX8MXOaxeE5Oqdbec2EdHHRCUdy2+UUjselnFyKHDqkJUwVP/+1KihbHDUGl9bNIJbv1TYFh2ewloFZXoDVkPCc5MskqcEEFeyvsfP+RFjwtZi0gsbngxSdVu34xNeONbkPzuPzm9cnU9lGJL4j7iuF6SvqFy/e0mW4msaOS9IcLVzpljTdfNplf8KObI0X7kF28pai8xTGOy/JMqVvzdOkRqiPLdZfs5kqGYFYBGL7nAB/0ZMzjATyKQxoc/8mXRH9Onr3HRiewawuKEPStwItsC8knx0aDZptaI9llIJVy60R5Khm8vev7tPN/z8HRVaTsqHsIj36lKbvIw/SdeonrbsukHSQFxX46q50Bc/N8u2LBR4GUfpl5KP7m+JKJLX0j2t4dScycHy0FqU1ullM+zSp9hX0DDLJc5VPxtjPqLf54esVTG2f6Xj5vpTAeUvq/Nl5i3ayJxA2Mwdf4DRLDVqnZHHQ0YEcx+IHbDdseNTMu3XSrm906HUvUboxN7+xUt2QNtNoyuXkjIhFxA+651snfCh8+oQ1m0vqVDc7TWxg+xk89XbJr7p1lH6q9shg4W6yCNw75/4YQWhUBIyVSBkzPjdEK8kiJ4UvU8QsY/9vFDogWJvQg7By/ggW3Z+xQXg1/mZfN1Cngs/q94zYWQpIZDLqbZ1EWxnzozUPMz5IhWWFBTwZHetDAhJfYp8x+52a3rl9kVjPDtCw59Vm4/FI68jp+mpkOgBwQCMGCP0MsjZoOoUk8Ye46Rs5hVY6n7THZAJOX2gnIh9zshF7dqcrSKTOn9CAkWpo64alw/ulaAIg6bXxMRC/2ss+gN+iYudQSXRe6AY01uwh9VcUJ5ptYAwAfeY69E65k3w5tIW4M0hqcJ5hbpxi2BVMDi4x2P5ZjVzct6GRbLqRXO1TBg8tyvwY7O5x59F7HEDKmei54Ezhe8bNI7it2kttwuA/y64siu8L+318+f9YvRId6TMiBuOSvt/s1Ujo9xZmNyphT7j28h+1ZKt7DN2OfiBnbQbNKGEJxGaAYyY8DG5o03tdSEE7yrjenVzE5JNmOxi/B9M7FUjYIhGa8L39OVxIszSEvQwOURqNyhIrre8FLDALQv7GC1ENYhbEmVcQmtV8Dd36PN1wmqhZsbaJmGOW+dbcwRPmNdldhAExII0Dp9hXtlqQNOFd7LN5ZXwaTQW7VZa/oa4ytdicwuHYNWi4pdk3ejYdcNIddxhV7is17auw0JB8MJiJv0GmZCE3BWMM0bsSbXsB9Qw/kQgUQdlUuNSMOFCnka8hDZPvi63Tar4v37FDyiPH3cWVLqIEctAfhl+t46ZPN852NzwWcDKxdYrm3kP/fNatohok2QlXqcDaD+iCfo7iNbTqarZZ6L5tBA7HoqE55xR+EXzAVYkQUjRJZ5Bwwh3cXl/K37ef3VWPHgPHZWnpc0DgD7i/kdUU0YeTe1hx1m9GoLODOyoELLJ6tPZHj0wSc/L00kVqXgvU87OITjQvZqNrgdH2GUz+qdN8+wlq+1g3XTJbELDyWusnH/xztzkn1iDHzMTcDJQqvZThHiIedNPGALH6IAbX98aINYiFNWjcUMvtoSmqaP+CTlfnx3vjLjNoUpJ/1loKxuKFzB4pdZhsEtIs+DZtLq8Cb9WdvRsh+JwH5tO8aZBvEWU3WaaDlXNcXC78Of9fKuJ1JRBi6tAUGGudm8bZoYyJk//8L+Ks9SN1fSxvoDVDDIDm+y5TEePOIWLvr0UELz2M/4/Sn2jJd8Uv6fNIxxOF3opR9NPcDnvB9K+sdeMjleuEDCkPa3/tN5cVytfvZBBTywic7d7a5uyw2c/OwRt11lkuEdH/7pikq7zPixnrrw0UhtB3kFQ5wieHBKu6cyGh4s3C8Jtcx7IpelY5ojqlWtskD9Tq0T4YUuskFTPdqxVCMFKeJvK7UlU7wZE/lKzDJLIbitr7kq4isxOIfV7ICKrQgO0LSGZ1GaRPFDHop9GTCDTk0K5jvutu7OE2/LcUuVEgyG4LWl32zhLIdM4DqJdvDXkxUWcoz2SiMZJIZ4h6r1gKLi450cZkSpzOgqMaFeydZlMA5EvuzE4dmUE7+a4JgrTa7IBXFbLiRDV4e7a+CTVi8wfIhNmXM0ggkZOqutOUgu++7JAwIp6Jodm6MLn4zO3g49gVQgEclNxn5whmuWSrYbrWKYEeHrTmWbRUVnP1IlQvHZtF5p3HTISAw79veaUKMMRtVuQsEiMQ3O4mkVHkoUjBqQAf0FEsev2ExorD2SAvDhN9gcCzSoeSYNCYxaBYKsPHY3uRBGt34LIC4uuLq+0Y8DtP4/DhL4hxB1Lj3YzzipBF7Rwv77teibuAppliLf0B/UWsLofUyWV4EOVv2XIbAjX63G/DhT5nWjeK2l37COBj1itHXU9xzFwomIe+LYFoH3CXwPm9xn1qXB5T56uWoRTPhLBJO2MLzty6ndyhN/65Te85+kKjlWOIB7Ea1Wo9tuqvZS0nX7q6ixa0wUA/YT+EmQTqRihHLx6YKGMClNS5gkWmjn7Zr0Z+12gNhHH2P+VaRe9H3RqAari0aD83/pnZrmocwRdfIydXm370YAaLTTCibG7XDoDukECweZE9fH+14EP30i76GggqYPWdYeBCCe9/5S5ltiUq49dWlOIQplWu0HEdTQsimCQVN6eqh8GpJkfZihBwN7c/YQLu300Z0j1qTh50Q0I1zZQzkR5u8hQzHaqrJgNRoJ9pOHdKjgn8MMsja+SHaG8Llixgx1jGm2j5pv7nBN/XCTmPSsVFtaL8e0xxWhXv9EphwG/yMVMzRksdp8JIXMuDkXDctZe5wfpCAlNektCMAj+FjpPSUYdBUQnGUXQ9BnWXeuMRGeOurm+udggThi5/pIEvXzquRPL01YglPRL2d5InEzQu4xzUtsRm+78x3JM7vhahdAHD/WObM78EAdDFOeMmRuPKv7dMVZ7PEjqj8iU7Y1dm/9bY5l/0w5XF7V3N3tEpiz1FVM0/0noMog5SiaOrSAyQPvDiw7ElRRzL72XgUNojONNBWWPK4pnw3x2OMW/Pe8yzCM+WQR6qur0p4Rf6yg4po+Jv+5FlTopx+aXV5YZsQt2/YlC8U+puaVGTHL3lk+mg+wrFesZ0qOQD5ga8xu0M91m96/CUBUUz6+GBiH78AtCzBKmKOHvCIe7mSxndvEN807/o5Rmv3/nI9w+xzyTmaArO5Ms0Hm/7vDVEsLbLndKTJv9qMhf++pywzPd22o09dlyYXVJ6DasCvjBPHMaStwZDXtiu/wbVRTfKk0GOH96HeSA57RPLPEhogMdHnmgmbb7o1gcu8Ee9Io2xgxPWyLmknIWhaCuIj57/5PFaZ0W/deL2qxwyCdl3C0iWehuOuhuPLR7R3AYiHPzGzMtff4LgFDC+8ldTx3dHWGkW7KHWJ9+JmUcQwPlqMwRs/1lyjEOV5hYnvb5Is9r5q656GqW8CsT55eJ94NMPFIvBCbmmvf3fjtgT/SrwzUOuoKgzKEJRmPfMFw0hnJUh8IECBAaXy6yuAXAhZZkBfQQmHWq7j/OSocuvk6D+oFg4/Tf0OaMxrMvlzSCXqMrBdGNI6267brZoakeY8iHwb0GIs/Dav82Zxm+JsUVfWt9L8Wjw0eUWVa/xY/MHsYR0G4NsQUIXTHiPzci3O7CN+VE6/4XAfG+cTi739ajyLTWlXyxX8rj/ezWhR085niVlClM0FaWWVhSAX+HTif2uAbwf11IE0DUTI5Jx//h9h62NjPpnMiRB8hJR0R59ZgnOuhUtbA5p+YftlW8fE7gKGhHnY3UpNbXreUoCxsqiHMYymR1Ta5G22dn50+8pKNL5S76Thw4cOG7jWqm4RidvFBLQVkQuayfcb4vIOwUtYczi1sit7dHqATJfsPe4CzIY5BhEEf/jfwNSBlHUbCu6KKwYab2ulp4j5YIkaYVIv8eQeEt70VI2qGWUTCVVOqYqCym4+DOTyxITPha8G/7lmM4gjXgIKWWWTlUv4c2QhvIiD77temnnqpKRdPnyCMpfeiMbU08NM9PkNoteTQNozEj5J7RglYgaB7KsYnI/YhjNUkg56bVJOD1h1bxqjDKC8qAf1OfIDmM70gn0I/ujmAg61OxAhJoe3w1fhqu3bt0ZggAmBOY3CnbYfQJQjRI/uZvzEdvdvbuBgSVFUSBloblXIBO+dmqK5RMuzhKxwHm1l13JLRBLDJpNhMwknYsH6VCh7DgEexKqz909K4UFHnNfDke+DcX1FpAjP3e/PWHmtNIMI7PW/zmM576sd2MOGKv/WaE/WN7ZlpfvKdXJHmzL+YDjqaktL+X3j1utwKLTermCkXk/TTQlCfMKL0+oPB8avKBy36hTGYkU1nKpLrg2TAVBLjtU0zL8NuV+HFKGUn9lRfTr8m1ajBfkOxWD7u57llHlXLqT5WiHY/f9owB2SeM60n7vQypcuXLly0vbqb2knF7aBjBxAGpgDCuucZzY38J173k+3k51QUHUYstS5C3I57czFBczXirW2LzCwyZT1Rbn6l6OvxalSFOIptSvWHrSmlmurcvfFkTFJT000oBxyLqSEoeC9skbhcd6WcsA4APjbUOec1Q+J4V3entHGZAGkJD7IRmDiLZONVt8yhrggH5MsJB/VDcKpdLq6/ojzmy3yGBMWtZRGEKnKfzQV5CYm3SEtyIjyJPMQeUwUWx/OwRZWs/z6kTTEEk89sepOzc4XjZdLeF6q8fnDM7eQn6dcs4TJu+oV6B9H+BweWt8/HvMzIoTP379+/fgS9N4sc4PRQj5ANmbLbTtLlvz2vOWPqUipKXeRBlCUFQjUkpbzwZXifZ546NmfwrEOZDLQBmdq0vyzfsEl0sPJ4iOn1icHokt1pZ6h7hDG9wGkm9c076G4DQdRbnRWy1sBpAye+jbiWq0BQcywl/maDt0sDaNuia1uFd0Gp+8mTtdy7oeXc30WQxlYnMpY3yuJ+CYRFuLpN+okjG8ogoQL/8S1OL2JsyQaTbPb/m7C0uaeN0GWo8Qb9gg+e/DF2GjGBkcn0YbRF1U6ZVqqn50WhO+jRMrzkTgcMhVq1atWq/floAvKGPwHpMuY8ppfw98ZXQskYGcWau+JjneRY2oK+LFT9PDkSAkCjbaGiTRm928GE43CvGAc9AA4whZcAXwvzZWCCsQVg0aW0eTZvIaLRy2ikRlPjBai1zRyRZ7WzLn5xBWb2aHLd066IigGUJBOreLv/B6elGOM6zRwu7BL19ORS1V3Z0ABiMcczv1l5LYsQICfvmaLLfHj2/z7PFNcis/BpNakVmaZ/g1vfxNXU+zvEHPuCPJ+OE1WQtqct5zG4ohmv7VvS8XJtlc2Y9vYr+wgN4mfLTx+TdcsmqiMr2rt27du3W/wLy07570sPiS7GIGQXO8/mTB5ggmGv5o7xXa7DkLKpjn5LUbn7gh4RLQpyZ7vi333eLrgtmhDNT+1Q795XIggzxaYMQruIT4K/gOK+r9wEAmRPN3G28N4yWy2ZGJ6zm8Mkfrk/piybqRWiDcaO3HKaM0s44boLwrFuk7tAXPb3I/y2gKRBIeqgtO/fG8ugGQnUbEeTuZJPWTbvVB2MTQNvJPfwI5pQt2gu97LMWALL/c0Ykgk3BGtQvnuUMuiE2+/x0Zmw1Uhp9aKskYe8Pexl1YvMgmu1c5TI6pKhIKsMWLFixYOAAD+/htcBu7jUF/vFPs6/aRWMVupcRHT6We4A/tYn5eaUT1tNUVusUz6I9VTLgbuVXejTES+4CxFVMCPrbnAL+L83hmjS3/JZLX/4vPNmHlH+LTm85L09MSOk2f+wabJ5I0jHs2RWElHVi/p8iOkgS9WxWpTPnvlNyFbo7o3FMeONcElyLQFi89flTeDgEwNMGbd5r0KfIVlmHFdfMNiJ6Ee3pSzK76QBU6ZVi5gr2191+6HHgzHBR/LuEeFD+OwGQQfog3AraRi9VVqSRzIgnOVxDSSFAskDuCVcbkCNcOwRzBklCN+D3l/2jmyMatXLN7bbJ6OfJevjwXOs0hx5h3O8LCo5QjN8QiovbQY0m4MwzEqtOWch2AucIwEWaET0WJHUwUmyQXMX/fyOMv7H1ARO/P1yJGBcQmB9NBPg87IE9XjY1LuY5LxoK1jZF4VtGpAGSxIGHH2kLtZ8LE6oVO8yd/0VYh78GEmfJoXdlabE8vfmpv7ssA6YO6/q7ktbRGISEHS761QyKpXr9UQwgSwpEc2U6w9r2LRwtQYgE6i6n3rij9V+qAmc9tzZ0W1IV5LhODIKQ3mGE7H29jhbW2H6CP6kKBeC84mLDt0KDFc04HnxlGsD21qnVpWMNOAKQV3n9QLtGuKsFz/MBR/b5Zl1ti/xq0NRj/3QRvis27LInhYXAr1+2K5miDrsxm07PFw8ByVWADiHyCf70n+QxJPFBy0EviSwRR2EGt709I9RpXBN4IW9oH7doFeSPispZpDX2hT/jV9W8TiwgzI+AfhWqz5ygAR+isUFHOK8Fs8BN/vcj+ml7jMjP+hAOz1QcDtuLKUozIcO+0+gA/Yd6EdAkK5vpMLMieWOpl0gW23aR2scT5wYo/fZQ4txBYVhZGcPv/CKQQinJ0XxzKbAFZOx5eLDj1fHzPzFwMbTSHr44vUpRLacREbCzHam07b0VPWCLq/A/5GcblH9WTFwhBEvZYyH4M77/ujUrh/HHcAtXhIPhdF4iB1w7Y/PrCA15zXIH5kHAxnRq2Dl8U3DsTDlk9fb/9jD4WUaKTO4Ok2mbfQt1KEV9WCV0khMNmNgQlobPUCEwdueWCBpKDn3McXO/vHrRx0blC00oJpPcACpvBDLdJNFdjDznSiNCKCDYuxvxXSU6PqP97n18jar19/CTjyw95iEqc542iGY5Q+dDL3rGMY760HerCLMlGUV1vPsJ2GGtUDPdM/z4xraXiISjYSXXOTWFcoi/AJX8Ma9FDrTNAb8ZamX5syA1niI+l37Hk1XE6Yb95iY6cu74ORAPF4Fngmlp3WC+oqCDNPjY9Pr4DYc45+xYtNRGCgwLwJhkw05T/UydolknR+A/L0BVkFVvm2YpP0RRDsoXrY1IMt8Ey9fdgqPwOYql1KqWOdmt8jtczpFZ4Ne4n7cq3709p4LhffrSzBm+RYi75yy0dqnB2BQ61je/1lB1EdbOpVJLV3to3SAgQwECl1Z4H9SZgF3KYRNHfMMBzW85cpMMSLtjPP5s4W7kJUz98M3kqHdzuTYsg4JMSggTMjW03cu5GKjhoJMAyJlr8k/MshZsNzxjlKiocEtUaahapmpNBTB9thRLlbKFiBq7GyTkdG0usMDlBvuLqXrccZTyE7PHSWNwngDwnABJ3Di4U6bzN0/p/VBzyB3AWh2cMpAaxWtBVlXfHkwCJEAugsEpdunaavZkOne6S2EPuRn8nV37R+pG5XPvv1AUaYGzJ+stLanqouyoRBl0rPH7TJYIlyn3BVgg85215a+oYX84ybOKVjXeCTiT22nM5ruZm2FEi1gHlhlSaMWDxX2j0bLmmgEwZc/ylK2PkZXvvKq6N4H2bAX1r8TDsUkJGUDsIgvW1KACkfDB4XUHpZoSMzceo4v6t4NPqB/Flwwa+Lc/AT13B7pRg+VO+6EBgukql2krgOJtpjGWlCp4DXBWVwJBOFG07olH2caHP3XnuEmOqEYu8FSUzph8pgT0JZkAFrJW5RKRG6T/kN713TBaNy6OjOeD3i2Jnd95JWM0zRa2WJwh0H7HnHpjeCOMBDuaWynpctDbNdv4zyPNj+YMLd8skxXbyznudwUn910OnFVRCwA0S/Wyh/4i7uB146gVY3MlrCIcrrJPY9LEY2hQc4wb1Njp4bSjPqvkM/2oubwYl0l/WRqAREP/ez6gl6fdvAIZRSu6uLGBXg6avf0BdIYGUB817x+v24o0mpAyXvY2kxRNTzErsvp5LcBmDyzqkMQOnQhhuqgsZcjeJtaWWX5RtUMMVvJ+CeJMXLMvFeC7+ZoSjU6WVXXL8oYHH5Yyl5LwsZaF9d5U/zrO2WbSLq+bu/QK+899GFtQsm27gi/5Pq5am/zhHsDHw5+SP4/D/jZpOdR0+DgjpHjVplzqZkG+xN5Ki2uUs6WRodq71qXnVTJ+4D1v6aM+orjnoJloDBHeb9rat8Fyo/axJf6lkCs7rVSVQOv4K4WG1MkHryXUfEsm+Ygd+Kd70+yluqZHjRNoca9awYOgl1RF/LmCvHSy3XVBvdZPXpuXAVHK+JALhkKlimON4D6VkobsfWYnX9HwbxXoX/m+59jg7i5s0Atj7OI61OEHgnYu49NRE6LgiwfQgXxW7UtOh4jVOnYwSnTp/cFdXXTX251zMFv5mOB/M8E6DjXeRv6Lr4zOC5anC09ZWrsTSK6AM30ZMwSyKI1EuGLJCzvkyECS/4PFOoP9eg71h4TUFvj5d/PhJpLMRYtTswyAsvpZ0qVgYYUi862VrVv9O8HZl1K6O44uaP9eDifJLOj8xFxwlgLzRyvlk+wnGJ1/lWm/cGEbCgcJgDF44sDDto30RB2i2DvGxTobTHQK0M5wD9nnAnjziQo6oOn6hftcoA//NfuWgH8jj0YMYha4y5QL/n5d2xCL5qtd+7uRr50ioun88NII9PorE+sRWdzlZbREPg/9xEyfZQtfNhW7mJ2weZ7Q0XDVLVzvhS5Bk+P9KnVm8s4nljZr2G2H4/tqDbei7DqnQhoHeNmClRoHRzDcf+u0aR4p+Dc54BECee81mg7abFSaBOBbCwu8KjTTlCjRJYgJI2UOHDU9x/bNTbXo+S2tCtROvVSMFn+VQ1vplcwS1oi1hwaiJk/wiXjBa9IPAg2o17N991JEz8qa3QpUAncHaGuxhk99qiRoja39mUWPveHX/FKRG63oFx67z4Eh8I95yfeuVNNsCG/3ln7IhE+zWprJhsCXcwcWVaJ/L0LE0Wxzy6vfICf/UJTycDdlJMtDW2ZZ74ArM5d09GGuUmZnlJ8x+YKW5FjdwF86A292GyK7u2T+dqvOhfKi+CE6Xb8xm3LxLHhory3/tHkmedLzOtHKq/RTvNIBwMwxihtPu5Zwu/nQVWgS9hK8bUEvXIju/WnmmzeRrrW939CeCyuY6tztEwEAELW2Rp/+BO2zic13Qm5VfnsNVPGg8jToO1DS7p9CUNy5/v4JAm9MPZ6F+awhuM/dqamDCruUhLjI8GUXM1tG4if1NIeF5o98eJ3AR0+CJxMel8idefPO4c/KitZbKqPUSZiq2RRJ5UA40OVDIxIZGcZcXuodzb14YjSIJ8GELd8VvooRxBPAfTycyJIqOvft/TqRGKOPRE2WVTXwEmRNjzmX8gWU8MaL6ErWONjJZLcfYDp/S2H0E20nGdS89qLEV8Q8aSX6VFiSPpyE0xiW/B/XfFDzE/quN1lb0Tl6QEY3lEFPpVZkmNQLXRtRUGn858IsL1sEGibev2kEzTtkJN8pXOg+YR99pawG9tWD+n2mD4IfL9qApUds+aDERY/RsVwBDiosNocQtgTpH1U69ZeLMBX2IDJ3gVfdLjzQ2QfG5yPMI3Lex4RRKfpIjxVy2DX+ucnJAgDHuZBdDxupQ9qyxaPQc064CADEAOokQvDCIUUcDhfgqtRY9lmSMihvMiAEz4LH86kmnUDYXbZigZxLANiE2xqyY/YyycjFJYOEGYQu486f4Wy7d0LcA3Um9kcXaKgssIyy7cG4cNHWNt8I/o6+yPJZaHkh51xsv19hqHeJkC91Z9Oe9wmLGwsWNshGCrIoPXgLNiMZkXU9hEu6Ne7aZDBUJCkabi94/2l6I/YVZn3O5pcJuxBhF2QtKY9DyiJyzRQKJV+I+1VRbk0wBJBLtZrN7M0n1YZdo9guvuPXpTgdjAmdH0ceth69LSnY3+kT/uopt3BRaTmUrzRI42s4uUG9j1FkiKVlp5V4DV1tgRA5RMMk3pmTp7o9R1XPshDGnqoaadXu1s3Z/XagQATA1PYfzsHNv5f2vmfN8MIOgr00agj0v2p6LtGJN0I32uIbGVFV/j4fjzFPvf29cYbW257+Mds+HCHlp0cJFadsgLrE12zuQRUT1W4hkHQotRTMtKLRu2uARLPZvYMJFmORR+jtr2wmVvQMKEnr+Tr+JzKRc/SzMPOXuPHOXom8EH4Fs/N6BM0ZTVvD26ailcWLd6UPWbWcnLD8NVL82LouAzukMvSveInSMR+rI2M+IpsVF2GjbGKfVbYCJbwlZjIpFNyTV3WD7i59MyJ7w//vyByKfAlHqFp0GPPwG+Er62oHHVdFJz3VYTaTRsjmZy1cHRm3kbi3PgDzFNQSoYtCoRuQbo8cfED95fUm0WKyngbXbicC1g4k857euFZfXPhkQimjhDdGxQnhWTZi9WqHLnfuAjjO6eJ0/S2rMaNg0KTdX8AxMojtbbX0O1KXuAAjLQGbVntktRe2s1MqzmFl65BlggHOkDPqA/SOsnqUuJLMM1QB6Wxjo9xsA0AHxBNuxj1nRWVBR4mV4aWIWQdVnemd7vxelRzw0zhoyo+AAvfP/a3igN7JRqjKwrFMVXQn52jNphfX2ENzjlj10sEkqPehNua/a7JLpkwxDGX7PO0qJIGX9DAnZivt7PDah8Fv7MvCaojTJyTBwamXHk7IJdQoGOhZ6FJfufgst++i+EfIWE1vZEW5H+nEUzJvDKJbdyMKKAYLlCqZC2Y/WBuOaqX11Mmpxpg41ClaE8nsZQaJPO7AFEJmBvAiYAEeJoFoirtUdP78qgmCfj/xi1JEmCUliu7mGj4YNi5nvc+bUhg6ny9n+1bTKJqiK8t435pT6R9pgRk9Aa/9OF4jjH2phLPkcKRWNM7oyn4XTJngvflOaAUiDQgklgBUngq+vfNOD2NjhxzlQrwUiafRjspZL7iQQ+N3YhA396hkrDirC/yfZZX1+qBhdrnb2HAy6UHELVie6w5rY1hTWR3tPHA5Uu10/1nb8tWlUNh4rpvgYwRe5c+yZHi1Q8nPrbc5iUjvXPloBWn6FhQcPUVQR85N5g4tQPu0H/GmeD88aSKcZTvfQ+enSn+5uU/sRFG3ihkvA2ZwhmYrNl2n0iJg1wM7gH4aEMSnyFgxoDF7sCwoWTNyzieJeM0H9XXxhb7DeT0/k6womCjFPI3OYFwkWvPQ4E6LUyHYXy49Mo8OYVJStcZ0wg74GP62UrST8HLR1tF8KI/N0yQ+aGHKR6AWjxFYoOb65KzZlepX1MxsrKd+PDlyd0J7mQyflgdmUpzUacEXZgcWe+shG2dypRMjsSJxRON3nBx8bmkexsNGTUIS41PV51bXy5mnBb1hYrcyQ9VeHwJ0AiW5LKNgRmnnRLF5H4ElGtXSZ3WNujA4kqqzJCH6iQYZfduGhNzsrvX4aCuzdfxvvaCd4AyCv0Z5CMCQ6169Sj12tnXv2Cxij8Nw+gvVWbmR6j4JgezkkZljICShMf9Z6OhzK0flvLIms2pksBhBwoIh07bGxbNF9UE+/V9eg2FX5ilHYjoVgOMW2nNsNxNe8k8GOcY2Z9qzCc54duvAaCAjZYgfkL5o/gQO6l99Jb221dtcya47M/LoxHbLBdPTPL5LI+TnzZczkaQFKjz8ZD/xh4nHUcKJaB1poLfp+Cl6y/Di7VzRIJK5VkKYgcF/AWrX6OaSjQaH3oIRW+V1FjlDtBCRVJ2oeW0QlpPjmOq1n1OoAQbGrklhT36G9OTr3ADgwhkhVd9WxsFfMsv1IvTTbmfdkftCu42qJU+dlgoRFHj9s6db/LeB/zaSoduse0Id3kmZC2/14zpKksapItxs6CkCGpBc0bwB5qVnlzjf+gZGM8OtO+wZYXbXboaLhRZEOGMH15viOwKqw/Q6mDEBlMSkyhcvtaxURJ4O9G8HOXbbbWIQFnFowFkIx2LASU+vkMUEXcpY8fFkJJflX0LT4IWkctxBkeE1/TJ9waHib6f74YbDErymi56ZKMkemY5KZGSsg6gu7FV4P9xNi0sCm2iMuz5NCWu+53h0gv+hMo/Wpn+Wh+QkH2Mr/5VaJE3WOmTICXeb3lSma0Lu3pIasjfaWr+MMUkV2kcVv4fD7eR6vrlFhVmtMGROHeMRYRAaWkrayll/qjRE/Y+M0afWSkwAxU4gVqXnqjkFKaR/YfFvyme/5txX+GFYo/Sk5/ycLMBCtpx0WxGW7p89g4YwglCbzyfcxLicD82dXL5iPjs3pYNtor/ojzcOClPnpuclEq4EeCZwBMt2BR4eoXH3nQWive6KSz/I84xpb5sssGjSdm7WN2nlzvSRFQ4hZDbhHTvVB1dA/yi5WVU7NaL57PgJAukxJ2oZfbscnQ7sBsLwwk0wDpkkkHIwP4NnDvQI8h2/kUPncsP9IsqT29vsNx/tnsZ+1RmDlA2FtjE12nr1/u99vkmYahSpOZuZxC5+/uN9dOezyArNDG4Bl1zs1stj0vjUKIE5LPVRft74NItOjCvNx8IVG21tQrkhnxlN2zVde9U2zJOvREIsFcLsFBOR/WT8egC/AytZAWcbn0oA2ZMVzOs/ljlM/5pMf8BI8zob6GVKXvfuqB7GBq7zPo81FhrT+r56ZwXhi2iMMMHcK4e6dvf3OR5x5leEjJBUmWT7s5qHyDCn/QIlHZofm+yOIlRgqoEvMtr/gE5deFz6yQdEAyjtO8X0Vz70FBCKDKmCfaPdhxXmffYlXL/qqD1qSnbkWRK7czcz9Yt6YOVQqh/rLRiVwh9o+0UUUnQoFpGU1DcXdk7XY8AFm++nfIz133YyfVVp+hvWWGgHxm+0M0spAamVA2Y+4t8Znqlo+jDlRbUwxEYSdjyzingBUS6hhZ2ql04f6wuLt7PU4LfnPahQm94L8R0iOvktU+CZ+PS/oXTOmFkfpMowz1ojPT9ezG+uSglSDBKktEKRaO/etEEzgVR1r0+YrgyawMN9ZhY2oSMf+0hp1bKY+l/H78UnR9NMPlqPhIclt7ZtLvbOZNmKBdoNlBesZ0tbTHGTUFToQ+khujQvloIGR28zvEKNIMBdP3j7uXe94wGMJqpVi8scSRzvV8B5PuwICnHtjbY86QJrbb1cNcTt0Ge+Zf7h8lWgiigokHD/KDvy1mxySBD0vbpLoksYBaiXLLWfiqnlSJCQY7SqgezLzokuQT+TUKzU6KBBbgmjEWYzjiMw/GHFFyNQ8lsyN3S3/MJoBkfM39u9rBx66xH+mk2Z40pf8zITRjpru/9RW0FUntP47ZdzFXbaaem+M0JzZ0DFCOUBNhvhnXh8uz+EMHWFL3zKXBIP/3P9TPOZJhdEPnym//iqTLn8GT7b9Dl8vPfSFya0NDe+7x68o6kXpNm/m9wiN0XHz9SciGNe1rSf+naRyQMTZKateEqEenn3LAMM+0Y1122OfAsoHH1yx08galTWFpIsLf6PzFP+AVjS7/2FvbSVNQITF77ytHHQiIsjCezBhwcZ1MCxI1U7UwfxHHKfArlXQoI7H0yQYtQZelBviyowfrCIRgn4igkX6AwTOiyy+n961fLBNx4P69YwjCc5YgU/KVhpADskDfQW9jmyY905PsNBu1xRutqPQBQhaC3woN9ugHCmloDG96RBX3tn9HjjYalGRjqcB5xJcZNdcYCQjvlG31ylNgEsV15k8XIVHboRdxw4UUHSSHVP/riHcy/PySpCBdMrOnEi/uTqWSsgnAgubyy+nf3gG/3Nr0QwtDywa/cdPD0jcQ7or1hwpBKnhDEOrA040fmM8DCig7vzeSfbvt7nh5bSzPeQOarkHKfB+gTqREmxbIGJqswOJp4ylMHE8YHmwfuNZQlHosap7LbX+fz1XUX8XE8INpT09Qna4+5Z0kVn93msiWOUf2q6YyoPOdTmXRYbJPzv1dyO2Y8eFEs6Ir84Fc7Q+9bbCD7giA9NdkyhyRXNpmC3yhC2aak+oKRF+U0kXcxrS3Q29wkKddby3MyGh28pQSmkgzGXVjY1OdIIR27Fm2nxSiztPis3niM781BlfoUJVF99V1+Cz6tJ53JRpmipOXRYWNwNlfiSotuPvuLYcAaVAzZiN0IbEKKsF8gHDVj8fMH/cLYH/wGVw9VZekCDX0Crm5zI8v+tHbpHYDGh9B8Sj7N0x4YR/xphcF95z/IxdYeZfHudQd2L4IuNWtB00Jeq/tVK73l34e+M+O7001EL0Bc4k8nUBiuK0dAa9x9j8TZIXEwoSFQManoaik69kNthq9Y9Y3azO9iwtFngTG5RriCPARLQJ2TPgkIR5MBWvO3IAxLP0dfUXP1DjtVK+16+ImOygmhARC4OxCgjtZWhtNAjw4x8VHTpbW05iTp2CtqOFQ9Rr4G1ZgUgwEOrRoKMZzrxDUpGbCOHGUsdeALQKZ4dcfTQ4X6dwbLWunnhfkDO/CkJhqtbPeYdnOUREVpAB5bg2XwobMzWY6yCBW0TDebB4PYkqEBG9jIHH6+UyjJI/ruFL54+FTuLVSIeeONnJGqHHLJX9dSOOIU53bNhM5dhQ0A7jZADfKfzFks0vSFGCQfub8OUEGSlVF8kYzGlwSaa0qaIMKq82/dGsC8We9S/XBv3/IMIyfNrZESoO1ZM2WV5Ep00ikPsr+i8myEXEJwrOQ+u51xoAKbMzxBdTEqUc3B0AMya5MEPL5nOMtmkTRfjt/bIkxU5cHYn+YHutsIAKnB8hmOqSmyyCzDlVXHfx6lN+BIQ47SucNmDtX0bje+/pH0ghsBpc2JnEXxEL4VwLz3qKlG3Vf02OUED7mSe7PfcGTaxEBZaX+9TAXrhyCO1B9ExkRTqbKgBW0p/nsYiP1LmdKBrgbmDhEdQB1Zgj0jtGO7SSklBAmOcu5P93S1SoD5VzxgIlgQVeJ8zME3RwjsdfCWOJdbi8Ksk/G07k/59nSN9Jx9Lx3ekgSp1NvMNbdM1SOgfxj5rg0N2hJlGUpfh8y6SeHl7Dj15Ii1BI/tjtVOWbll9ainp/wlHve8rDHvPk4kK2AELcO2EQl983p5lIlarTt1fGW6aKCxvya+vfDfl8AJLyBHaCDc1jpwGreE6vZSoe5LmXLBLRJMgigFCMB1SV2rus9oMfP8yovLTO6JnBDd84WwgmIFAy47rs4swpXlOtJN/EYI1GIvBA1cX2GxY1Z9ocC7kp6zwhdG7fjg3OBzX41h3iPr91+Q1TILb8KLHQYm1erf8dIrgUqCRAIn4Jcz93bhc4wJKBYandoeCJq31iCdIox+XWJO+OSAohMrJ57OnqN4riV7pk/njYO0hom51tOHFV28U8O4aCzn3mu6N1V9BSjJ1MYsVsuycJfZba5c0r8jOOv+TtsZan3gJcj/dHnJ6xEztK8PaAV6cMsU2IC74Htzo3NSb+3tef3UAW9YGbovb0GDxzvLrsHiZlnbc9b5SseiWKPh84y6v9QGTK8JNYzhT3pnMa0h1qX/jdMyE09dyWxPjMQbeI/6QFNQr/MLSXqY2lRSD5HVfWE2uH1ENnG6X91lFLtTGortzb/exZ85Sznr5PZ0aFDun83R5iWNfhQi+hMR9T5lJsxftpTb0TYJYInCG05t2v6OUe4lYeXCHS3hdHxMCax4aJk7TDJar/OnunjIP6F1qow0LD03CDVjq/CWjYgd/M0OvYoznGIav0wRUEcBffLLTljmNU6gnb0hPFyUze/77dCE7RvFCQCFMX+zn4T7+abpx/yJQAkcjTBKOJB655wTF1YjYMHuW7LZsYu1YJ3ccE2u2wsvsNkZDe4u2m4rSSd9VPwFJjxuCo2i2h0y5eNpEo9vWUsOHJbXAGR+Wq41FwT4y/9/4gFIS0k91rp+r/5y5DQACQ8V4c9/SSPBvwIx8gaFH/8iNA8HbOAR7/MBxgz4mpzyZpKzvG73Gp+2dmJvG33eOZXr/vUV+PY6uTwslmwwqKhrArMDtXC18c5GYch1kMeIzNBsJUYW3S9msyMwWsuCNitNgvnx8esRUBaDSQdTF+EV2Nskc8NFpEJ4j6FJoDVa9+Tip88EeC2efKJ90RSv0LORkm0Lx3FwK2NkYb90ixrh2PVnE2A+YH4TMvucSbkEseQeadFiJsurtZeXvZY1TJelMG5XGyvm57LkAse+FzImA2CDmrs3V6DiE5S0PO9GERn4KOdJbdM2+LY9INqFwAMTovu9GNo9oCyZCSMvL9ejVG5EkqO7MAWxtGGKMpKuUZORMBfxH0vbuaclHow4uF7G1X8Ywb6hzh/ML4CCXRgnHmZvdz6dM7XTjSSAftp51mMbs9lT5wMKLJJLTfUA3xj/Mgv4z34wfbAm5FyPGHC1jOXnj5K3tuIE+rPhDs9JQKYedZGl2IXsBsd/asNLVSgCLGh37y9K99jqi/xxeWGbxuyJFc65wuG9pMgfuAjdfUyi1LmjSJop4B859Z7lFh658IUuPoxAv5xfmvdVcuABxatNYmvr2/JyAmZWpaJiv6AwYFkGUzXjXOVRUnpoGgqXFpQ9zwZKGRB7H1K9sby1by6BBlj5xfgltTuOxrytQxlFvfwys/zooNJyNaFs/hy6GqtwHuE1tK29psio8N/CfuiN0deOPABRhg+cZpYHRcvxIIASIsdsct8iNXpdGujq0hgH5rFUOlF5nvmh1ZIazHGlUsN8OgxGscqTIxkkFhNPyYykBg6V2vZZHiGtAIKSt9HX+EyMVOq9xJqOEUicT56VY/vqxQpMpESQpRahsSvbAZY7iwPkC8KwtrY3cn5h5lxLKfkhbxOG11QGd/7lNhzFLoIksgNHaYhNQSlIi46qfV3119MxSoR1dZkgOizJUiutVT6D2WHdhHKezCUm7GfkOGfl3ZejujJin4AbFvwb0RHd7mTmh3sLSkzH65h5EvfmTeo/DloiXwpKpC2/smVFfAFUmiCHsu2/T9JVyDHzhFLw2SETYp4Fy7pCiXIAgbUXs4v9i/c0xCSg5ZIKJmno7nOieim5P3IItYs8txkZ73DavFyhhrIai7JioENqIwlY4dNqdPedhJKUz/W0b/M70GOUj9A9zSn9jTDtxd7AO2sPWB7FVmzxom1ODnNGBSj0xhPTHy8iYtKaV6+GigiYP0F7rn942HK+VSxEmMGTEpWPw3TwvrLO2m4UJvag1BmEdkLSzB6XEfbMABt9h6+13DNvV0ozM+ZVsFclQpvkXQdvrc1RzIA/kdCdYMoBNzhig8xMfy7YsT3IMsfZfE/lbiP+Z9Mo1FL2fbc7FVO7VCQXH5lSj96XeWZWjwDVAM1YtK5v9Ro6zpuzsLwbzOjSHH5Ur1qY3wwhPB6xCtKv5U2yX9WPlWA4wO6ZNKXxL/0h7qvV9EsH8whuk5yUKWf9nG6q/XYM4vL9nMp1vdA2wRbwxGDx3zhvG20uq1/BSB6VZvfuyiwdznCvNZIqaAoWrdiTD27Z/6Kv/xaC1rgyngdpCY6fF1v+7rqGKfFpOKxd20j5lGsd97SLQ/F9DfumXR3HcXxlJ7mHWEG/IzKJwCmdTVAcBLW/fi4a+dv3lqIWt5ETssRSmsYw8gEYv7F5PP9lQLterZGCS1P8q9jMw344v9SXIqysSOdNbHc9dokH9IS6NenImPMRomcnES/PGNGPnpKCMF1FgYpuD/X4EzzIXibf4nfdQ5XwZikEWxR2dR4fHM/c787vCqO6Gxc/gOIlMOxuP9w1a8OlCHSODNbhIPVjO79j7woCRJ4DyELLtqDrC/wai8f1MaDtVZ0mW+I+jfTOa+3vI9Drr/E5/8DCXxJAeGfZA/4U3Nr8EgBn/g023DCIrYnnLI8fziNLCejnrp81oTve+zO0Hm2FB0V6JqSPDkESEjj1O/RrqfaYU9bpYPAn/TJVCbAiL3SlU3nZE7T0R/qcVD5FMOrSgFql/RO+g2vmDsNsMMy3K35lnereXMw8a+ppZ9l2Uo5KzpEUylUjod14nGty9LAN9tfjBQDERSXV4jFEy7U/RPckF2Z1iRksSAM/QqJMuFP9MEey1JnAv8VdLluvrci1oBBRj+xmS+DIcFYoSIMmjxHGf25necMO/sz8xODT4FuzdJfNniohEJIN7S1w2xU1I4gVIWZvc5HuESv3jEPb3sSe35Gn+2fNjhu3TyveoLAugPHUzSmYLfqug/DJMP5Jfeu9diESFTecEeDd7DytwId18iNIzRBajbQTlvD65T0TkV3zV5C4ueFn0xCM/jcnDZKMU9P5S/apVhkQRMNKcEkm6I6tHzd5bQfa6TBNNL1RInccpnlUc2I+YqyN1dvdgE7OZIFFIXOv+rWQIcDjCWdBXHcDQV/SfdM/qr39fq0rLkMglo67342kijVWB8J/aUVisTo0/8U7UGr7wEiFiSoZTn5x/UR376s8024tQucwLd9tbLaHGBSPRY2rEgrEW3jlbN4x/Zp/V33gs4dCjUj77OlsCjlMSVLRrYLetKxGst4EPJCLFU+wDevIE+EeXX1H3Bg86C3CpaWPZDoK1hXG2VtDEpi2XSBn9fXUG5sJQSMBlhZpMant3AQ9ZoROZC5Qtyvc+xkPwMrM/PAEVoC7W5ESLuKPQ2OgR0ceIHyCLqyEDQ6HS+tufAFaZg8pTHQWw37eADwYpVlcKnMOuLIAr1p/QBmQP1yGho6QhXaEsgFH816ZYlqQtsc6+opm2QORdnPqPbVINOEOxa5PJoO+8Zct2p1X6C8m7CCmP/txGwrLLI6g/akiGlyRD1m9VS+KFgygh1E36FrAm1WpOX+PCOqnz+nsCNFccbjm+xVSqA3SrRyGqkRYavKFDCwQAp0pUuUPogue6YZEFlDYL+Jsmm0FedJE2YWQfcLkoLlK378z/e/8atK9P7cEARVNcSE/xidcftcq9h8x1jNo3g2dKG/TePINpJobVbokUQo+oU+yYLdRe68uz9e3w7dRCvR3T2o+bLz4Hk2MP+91J9nLRpGBgdHfXX/OyYRpKYKPChnG4CvzdZeH3OR7DTPvTrKRIsmI/gncs7Z/4YooH4nWC9KzUzEOn698iBKu8HE+39zAoqwnj4PkFgWwpTz0xd2LoXxfbb7aIXsotc/0GgQT1OXePBIyHXTl3O7+xQqUDqwyjiB7nWctVCw+CXgwck5YB8VGTRuu65Dudssy4ryi2H0rtrag7zWy4LQFg3QKIbxWU//WAvjVqxteTb7eIiJm+ihVcrV5lAniSlrqQNn5lltnzAPhm0JF57JdQAQ+uH1XBjtrt+s2pAl5G+2BgINlnisYlivGQcPyW6kYj2dX5c02o6a5zZW5JaYNNhevq7q0EFPcuogFNkeahRFE1tSDeaBq6xbzJLOwqCzjS1hR8Jkbe4LVpoC4qHSsW7OmBxUSIlLLM8NOrPFOfu1oMyPt9ZLQbRQtZKl8OB2Y83Lyrf57OvxcsNNQRjifLATXbskyo4+5H3+kN/yfYw7wSsO7nbXzl5frMuMAJxgn6XDvjeGHQblKPQjb0m0/48eLhBYL+ZWKxl1VKuDZMfJ+pV2pzNHQL8QpDasTTukdCx7puJs6KHSj4aQs3zA4vBQdLgO/koYpfObU7gYW4K7G2aDQeQOUxrUxgLbetpDcjpdVhjTBnmvUcwGT078myj2iBDnFPadOZGA/CdbNN/aYHpwzWoNSGefW56BZjjSXSuAvGZUYCne2uvYpyZaJBtOL4/8/mfyHvKj8uYc5Tb4Pqkgmr26X2evER7wffgFkwuRqsncVOr6LKIP/Ld29Ep02pzOJX6NqblmPUQjc6aC8GnDkJFOAESmy4LtyV9TMzROxA548IvBcYarDts1tU4SrYgR4/KtEw506Be/nuYs8zAHkxSLPfwqiqi3tsrZ196dKBC7P4G4uLyCYU7U62xNUN4ODr6jxSnTvCwbBd8mgJh6/JH/W+sar/X7XSEcgzVkYT4MKjVPHg39ovY0OCjOzbqaMxCwpaKIWDQnjjK73+NfufzEa552uGX+9IxNPpxo+iYxI4Hbb+rWDUprBT8LxHA0jLMkByYrSfwGlnqkEu3D89PAf6HE+MD6QD+vlxGKSU1TXH9zzvGx0S0ecD2UFOto9yYLSPlig6zTX7IpsbItvPIwS+QzlgdcX+xS44NK7R4gYWNqWxiaTZvCzj3YFBSmLPras0oppWJ7V1MszRUSvPF9IVMYpx+qtQxJFar8zwyWVswsrb5gZmQqRIcRA+v2DhE9I6vG81VurmKeijJbpPZOW7fmYun+VoHaS0QEzET11ynS6OHd2gagklUnIiP8ClS5ZV1AQc+ffquLbSCAxbC3HCYrFuiESnb/ibZL9+H6wJ9dFVgOwdoxZ5H7FP9GhPEGw5ZHcI2RL5KHMDBwnccxWPcwV6jqB+a7jDHqzZxIRZC6GZGjR722I8FmFx/c20qApuRwsTJlZXY4O/aI+37CL8T+OvE3eIUwHi8NVSnlolwzPX2ijzxabKu205Mp1uL4xM03GmW2FkvRx0+aZwxTfDxWUuBAPTtITUdfExTX99zker9KyXZj/QEFTy9CmPmsPtYvXYeEuS9RdtjUvz04LMNwgIwWHYEZETCzvJwe8IECTQ+/S9o7PXqMn929mXoox+A4OQp/JPGYzQcaxf42mvXDHpplAVUUv28qrNlzhlgxbXVuzb93ITkzwHeSfOzQUw9j6HI22YPEE4rvKv+acO+M6tHehNA7EtdncZRq05LlIuwIePIaki5yLKakeYhGB13fiOzSoWVvWy7S1PErByfJSHkgz2CfUNqyHNmWq7Bdc28ePs9R0wvAi6XBaBx/Gdar7Dts3efmGmgqm9rWILLfMC77rdrMzq0Wz2FzEZCIjE77k8suDwIgxvcPWRCw8ixpkZv6cJ8UZU+cOF9d1EB5zWuSqe84STEeHOTIDBzBvuOJw71FuxFHVU/3xGXhHtEEdkrS1sasCa8OzX+TrbRPV2e21tQOzqWfvI1G8BKSqAnXlbApYfn60E1Zgg+6zy3J7RYLLSvcjF+sUj3Gzwtopek8ndv/PCuALktTaguTPFRSDcRm7enLu+gQd+R0Tbdmp3RhBBJl8aShh72c5mcWyyDfeV0I6YNlFhbE8S+V0MJlB2BYrtb58T60eO8Z0ONbZ3HH1eFgl84l/un+ietrn4fRscT92OUkdl3ZDI5nY5aA2z9mydFQGh2rv8hHngDQIUXBGOULuL1ZGPGcPPRRjjpYN2ewBbV+LX2NGLQQTUmW2eY23J526K68yIO4trUPSyaxf0wTyJiDbvUl/1G8BmXHDWd7Hq4zjlG/1GIkSWyLTVZCNRg5l0hVW6z3BHn9zv+AFddk4bjiE+XEWZXe/JnQe/AJUYFLKFdN300furHd62IHqQXLhdmzHs/dIZvPo+Bve/Pv05NYm0o+89pjyb7h0DEjOCgl87ZRzJVxLNDJHwlY27/6kiR+3tSSTb0hJAQS25lwZk+9wmqnbygV98z3oauvWCKfsXzlvwDVJFjJr89vGapwl5ZWCRpqMocHNJrQ2uY7jh0LMSuFrwCa6po+zioKX/Diliyyh+qB/nBlnat2PDAYm8spewL6V7eGwgGznE80GvLAO0N9BUVMhABCVSdTjlOpEoZ/qLDrpthyUvieKBP1iOLzUUxIq41EnDw56lk0vm/zVdvg7C9wLVcKxZzEYJiVJbf92e2rQdyAqYIcARVYJDJZlWqcjkyRvH1gf7Pi0iel9ag2OKcLO/XuTCRFc8Ex0HAeP60Zqdz+AvdLYmHRCLmSdn0arEYWHJIEW8MbABP9KCkOlzsYI34iy0xbqbKsXskqqIVmYXnvDR0t5b3+nV/gh3podMs+ymawYTn8AWbLFuejaJjJpMkATWhwwFe9kGO3HYr8E24fph5kuzEqal1yhwrqkbICdRJXLhemYWBY8Cs5SJ/y768Frem0XQAaVYdlLln5y3zGPY2KCNgEzmGHKenwmDfKhTBHoeZeLdH5NV967L2KwIW9YpnufuhJT3Solb/e7p3slG0FatWHv4NBXHaoi+J/R414qOyHZ5NOMsXwaVW16XPwyX3gB6ozKd7CThp2HqhtVJ/jfmBRxDUbqmIVQuNHoMf/XsCi9LLFMuwEtcqNR7JoP2C8ROw1UBds6fthTAXMml5ThIERbFZh7G3s5NyqjEwcEibRQ5y46+39QozoblTkHzcebxEYnPyVjk7TrxArltu0FCkjMlSy7RstE7XX5yAjPPOme2S0rZMDT+WsTVNoy4rvEoPdWAZR2f/8HpTNs5555efCZRqkrQWJl/h6XpLesbRDusHj9OHFzkVOp2LWNzW/nAcZKaZvzGuxk8KB9GVmCna6W4O+rMGe3L6JiSeCA2JtkNm44sPB700oVBOzt0zJcmnW4o5mdPSoHaiOang6MXgA4lUVAOtKhn7U59B6dpJeSlvLuWOrZp3gVxI2pngukCZsB9NSaHK+dpt2tiyHBCRghDsoCx5lECXRlPfZn/xmfIIIsZdFPnFrwkWRltVPAdV/fAsN2DxfuI9osncyRODxU8SKI9CTlTYoLAnf2QmjPvv9ZiVEUCjUZM52u43c8lbZTMVHDcdgTP3jZDnW79DEI6F+zkIueUmqfJuOuHpTxnYf1MQFQ3hkR+gwr4OKcVW4B78mrhUM+ueRo6m0X0et8yh6NtMU+620jtKkhgSZVsJ4IV4mBn64z7KXXHiO90Jm1wM2qh3Hz5dm/lDuFae1o3gqhR020ax1+DgIFrS8JXesN1R/GLe75t670brVU1OP9kVmZrelVTKZD4O2Qcu7F6xWcv9TMOXMRO7zianlYLe8bpVkW34+Jp5jrR68CqjZHhbmZHSipppXpCfUPEv4KKvQw0GI8wiqAd6KSp1qJiNPEXhACw7rw1ifYlSfK4jBsOzpJg7dFpaPfLgi8OQHVsb4ONMmsDdXQeUf5zTmAzgiaVB/CCQgAt0h0ylehEVFUkWATic/vfCg5eMkOZJZEKXOBCxpME9970PYRZ9lft3Z1/BsJW1JXQgrrjB9EsQH2dNB+w663fsyrA2vyOE5eP/9/xk9zva3rTXvFprBdWb8PQzvrPm0QKLS6M71VkcfdIBDdFAjSK+o/ThGxn2chdQsh0iSLaRXDTPEmhvF+WKeKyM0CJb45vmtRCbNItKp4/OTaDhHnwBatEEvON85OlnqXFydY5ynq7FLMS1xIO1XRXqRPGDEWYn5tDgXjKy7DGW0RBPEIaMgZz8T/h268Edjf7euBrjfIhY58XJEz0fOTG2hPcEr2j7YG3Ss3cBXAAWV1HvlJlQdNoAF+nGZQxdxMDA0PVQFzgxGVp1JwJ2Ofmt1BTojNesUUL+0UAf2R1Wbt1FCpipR03RKTNH4wQeHOOgaYVZnpwaZ12TXK7oNh68EC2sdAM79GVvCBLENY1lYeeLjjwETFSWHqltoIvvz5kn96p5fFGqyeizB4gOxdFWa5Xo4bkAzC98HCUfa9Sa/kQOyA/+0nP+eBBR+OylSZUUMsnJ1JBR01wRBvABMieVMg4dI2xMgAKJcneQRFgcZpOGV3LMDgWk8XBpEgdzg8l+L3p3V3DKWiePijwHQeZcJ+SPn0B7IvPabhqofZTxxPZxhcwVTAi9lyygQxJUbPDqGNv66k0aXMKBxJgW1XLjXqH9B/L+iJeGhCptLNXgvtNb2si5QTOA7tafUdQHXHlcVJj1XY4LWTIAbOS0y20GdU6zaTqvnbw1sui8Tkf/c2TDuPQSUJbEJN46bWaMAO+eD+LYmL6gNo8J8af1W/boXxXOu9cu/f5fCOyX0E1n4Z+xxrL5AKw80MYmsOI8EwOAsqvOlg2yF/x1ElqupVK9wVa3g6dLNf0epEQX84j7ci9P+HBB8tytKlceQux3yJYoh/O42WXWLiIFqNtoeGBS8wE4Epba6rEsBG3fyxOPCwt41Xpfb09YCXVjlul0rfPCTThFWQjdxXD7A4Xte2mybAAlven9S+2GamdYV7PhM+ZqlGQr6UkW3hTfmEHKK3pyaS/ETNvq8I2IhaFzEXskwcvbanm+o4WzfpoW11UzXLJ+JVK7yurBVTug+DEYKqV0dD+eAxvJwyfKREI9VBskU86eJe4eVM3rNPTlI7MZ/ihW1a4+QkT400zTyGM3DzRAXDEdGGSmX7S8FOI4TWeb+qv+VQsCcQrLt6iZlxDbqPG1a7sxAbuZwDatv/RzBknFupoVrdPwuofqISJ0nNDPGc6SYD69iexP4pbxVEROTfqUGUjVWuGkJJzy5PV2yWOm4+ZW+Z66RJwJLgqLWLpjgvCfkvhw7YfxF9pkSRIMhl9KrsIxZNQMf/Ka+Z7a2x26b9ifqMYFw3Ez1NqP6U88WRbeuC23MgPIWu/Dw3keLejGz+98BkCP23UasrS+sOBTrITR9sBvDJ1o6KSpBnf1VFxZKdShDoUUwcQXPrFfJk1hQza/OuQTcKPnZHPPO+5GWMncdBsbloamZuOfN/+TroN6DV5I27N00gcYmGuS6KyHcRylLsHJv5DICE+ftbCOdW3k9eqZDohD/qkliHDC4GTLiKC3NvBzfp3XwZGphs1H31rMBK0W7oroI8ypdDHPyraFeoy6peqQobp4Cjiyln+7chCOtcUu1eTne2XHJTCVtfOY6u6liabPaUgvnKa6MWlnVfWPfWX2z4pCqitPe9mtvBjQq0yu/N5FJriyYdszZazXRg6zVAmKzWqXgg7MJlzYojcpQHCWmRXHoMUbclpzEs1rEWcMLc1SOdZG2RiatdIH8oe+qtgSwBa3zwzzXqAfq8+F2ItBEiWCX5QtUuWR0dWAuEUf4U80w1vCTyT51D+2bqrgQlotq/pY33xnDE2KyLJKyBKIONYhM8HXpQUUtl7xJdd3kOYii+TW4Plgd4ZEESkway7sD+CIsW0RowhMpxvooO1Qs1lQX31WnAjXcp29fqsmOKO5LctdT/GTlDH/yrLk91dR1HTP9DQ0dohyu52osTJAYJkUt7b29VVs99KF10vDwa0VfRMxNtReHimPChV/m315PXUQnW3wSkNGhnpabFM85lGlfnSWYtGDBkCa401ZbMndFuphmd3Y7F8Mg1mE+e4ymVPalCfIKm/rIQd4CL6YW9r0SraDNfdQV57y+eM0LgZK27mbMLDWQyCtlPeRs163gf0SwuZMj3oyiadXBmhjoY36AbPY0ndzM4szv4/fgcri1GoDO9HgzPaTthKHqcmcfzZxyCVZXmZm96ayZ0B7azTR70xtMEFBTOVETtJ4nnjqKMafpvcoSTa4XHpsmoG6EQKNPW0VKwHFC3psVao/gX2UjCw8duifT+OZ5MLBsetoAmPqkN6hN6/rjs43Dt1FqOm7k1k2MvWq2ep/brjyKkHllmuCk5duF61pwApH2EaD4NVmqCKLZN3hpCjdV4kjqQWGVCV+oTQrzOLSWd2LSp4GyRLDPRmutX1CJWIqK0lc8Da7cmLQhruYfiHIG57nfjNSSsjTeToaSRCD8WucNFINGDIkBUVlh4iAjTuN+yUqOmy2OPurxq1n0g7L32nNfhnLQ+FTtWWTuHrLaf6wfkuxoT7LHa77vCogadGRmoW5lnjwWh1mnFXqNS/1NpgiUu5yNC46sCNMgS8vu1w96od1fwT5WChRU6MRNb4YoEQ9GuvK6rYOarXvM2AuzfdVu4G2M16+KZzBTMD2LSyLE8LjTsUe3sunS8I91dyQLfx9PKPaQYD9LnxJV/amS55PMGBKVJZpl6dtYqO2c2yUkoBgIHZ32hp18y8dcnk5lt8p35XswHc0zQS2pOhdb5DUP+QuUkQR6QVwnCs/k2yjSqPDc3xWqnUBmSZaNIVV7F7o9IB7Xko3F/xcnA65at7GzQYYBR42AHlLERupd/R8NQCbMd5pU0gTxXp7JaL2NelW+Itj44fT/H8y+yMku+oFCb2f8d9LUU26aQYjxO6uBSKiOmxBgjmpvyyXaikzNseIvuKruzI02zoB/mPABuYl6jetlpcYBIKjZyqZ+qIi8RWSGt8Tw7rOb5oP0tYLugqLk3HKdfTx/ASByaaaQRhikYJ7FZ6Wo/oZNLewbehS/F/8OnldVlHLuAH+ROQAh7TDZHeB7x9qWrmSa0n6MNgWks5uCUivENshKzAkoI50sC8FGSubmJbRmtiSqX8ynzZM8u7Jb+W/EN9VAzFo7l4ukN7IsR7jrTfoyZyIcK6jZraafmlQ/hfAUuq9SwPuQiJzyxRZqPqYRuZYPq6tLXpzl1GL0rQzG+Sgznn5TE6Jg+Kkq2RO9qJenushFoOFwX6dq9/Iruo3+jKwPrAH4iJXDGNnyUiIdCEc+H1G2CXAPUDuGvUFGoJCtUTKtHtzN9NOFTJ8hOdI0nAzWsNMkmPSq2W2dYwHT9vU7lzc+Kbbl56TsMk7QJ9t/DPS5XZ/ZWJp2c/QZPLP3bNF/VFhoPG3bmRoTwA/hckXOglGFA2RbEkUgrtw9vKXVP3rHi7TjTzSVNNQ2uvxqCGwV8F6c5qIKzkY4oiGeI6IXEYZppA33lsC3dDZPILsV2c5jEqt5/SQOTQMYVq1SbaG15xe+8mO0EUvh6QcXGACm5Tu6vhP8bhwf66qYaR2eXRN7CLlyeedw/mfsfVv0rBePsYIkMhNrljP54OkfUsB4ak2g+K03QkI0ZpXAZkaTGE5ojqO3bLQXRvVE4jyQ2ttMh9wYNAre5OjfYysFERi6SYaa9d7DxbAIT6IDqtxKf6E4vkpf0Lo+yQO//UNfdzcD6ueELqpPHUexHpwjCUhu4OKUIkMNvlqsnfQ6+cH9b1gflSfQjKpB7bypY9cdgA7voZ8pnq/Gf6uCxkHzDeBe8kySN9EgkLmrrGFNQe/U2ZFd3g8rJ3o/pbJsTm22tJu3M7NVHX4pyQVV5SSXoCDk1DZbFnCNlEMO7Bs8gWXyAC3Mni3FyPKOFUtFZfO+KJykqVOSdIP9Hn+u90336wUbMh1aBy+eG75RimbdL8J+anwSwq4K4Cb2Dn3CoNTr05CSvLXfZL+Kqn46T7ooAMpbOsIE5pqWB9bnRdJq3AYR3U3P/Eb8JBwWHG0QXuJzoJLyGVAPqDs89F2nHcJjEvh9hnmWDX8GEK5FyNdQusXfNrN7G7C5vr21Y/B+SR6Pzsxp8gfsI3LBlaoxxPfX53awxdrXxfbwCdLuJoROrDpE62AFMvFsYULVZFDYZS3u57lllzTEL8GgBhwxh6Gc5Z9tFkUlOiQPUaSb2Or3umfFATq3FDiCu36zj382oIDtvLEX+1yAFATa3ZXbdp5EZk3f2oDwNrioTZwbxj38q17SiblEUmWbROrdcKGGtPMO6ab7SD0IkohwLuhtmATiSHr4QzrQnGcHSibz4kF9aOd+HjzBo5hjfnwousv8adzNUOhI7fkznOLycBe+LgZgkpBgy+zCltvozvbM6CDr72dbHHtu7T1AvoIZ0glBNEwKaOQKbBb++EPKT98ScdD9J24Al3EqhXTAG4MMFIiOwqCJ8vqVTXYAM6M3/2YUVKjliJWWG3j7rKSW4V7zf2N/LTfFQtIGDZCyKljLTcKZv/QMiFo/q/TiLTsas8s9mjJEWOvX9rNGzATrI+dwSW+b+OcxY60TULvFWKfX49Lsx//am0Ylva61Sh5v6OuakQoIxzW7v11CI5Q6QBUBozKPaCVDpLdMTdqx9DcLEY2bXIOhAL09IPZbN0oHrWMjQD/22yMuQE80aOXTnjvUeit68C+FRtcQk5fIrGECuHMVODKMp/CblXxrFyoGyWOKMBlF1y1Y6jDNrDy8nN4mGM65G5aI5m5C8MmZF33KPp85dGv4Mg2b1RbLeyhnX6Ne2+mUBAIpfCCJNb5WqhJE1JmKCQOaYUN4AAmGsOuOhHMC/lZandrteanIciL1XpDPOBOWYdflmQpwIbl38L7PF077OtegPtpN0GJrkR94ju8w0VBv9eRbOznPJ/6OlKpHfvfcoJ1q+moTzxhZbqlKPJCYoND6uSJPT6XdU6BO9Kf4zOwtbsjXb1Rce5d7zEqhzI27fcvDvAx/octhTF+cwVmSxta/rEzddvz/FmvlTEFwQlpSPrFlM/NPxmRfA4uoJlzysUPWngpRXahw+vBGZFPBGz8Z+gwDK2WcDBB4an64UW+ukVD7rj8V1y4aYRxNccYxM94DTG1ivcxpAQ/LHeYL6fcLjQMsDMTq4dTBpklnO5hdZp0IOLa0nU8xiS+hsQyxofFv+IAg5DeNUe7lMNFaLR2Y8S8XE7douZXj8T+eSFrLLCip3fPqkgK66bZ7DkAfbGqHRtTtFNhWaZ5p+1SawY7vS6J5U6Fu/8WsnkICOJpYMRfrtv8rO1EvKxTuld5FSL6y4PLxP+LoosLFJKycXBiL0mNfjK6OYULKybMjDi1vCsKMECXmFmRmchIXsfttO+7hEmmXF4Zm7gNDJV745xbnq8ZGdhSU5kH6NhSW2pd3BUocaz5y5WOQxYCLk7VZm3HJJpnWp7Ph9RwEnhlhVhM3vWCMUsFLFpYmgUplC/imzK/M2l0JaJ/12jSfBIz0DhJ3k+UYND+7G/Rsn9F+M9dlRHfGOc+obHh9DXz0kitwpIeKmPY6lSTlGocdEXSr40xo3Lh1f2hiYZMl91OQ1mX/XJBrhuNjld9j1F/aIg5EfGuxLHhR9gDCMnfvRKUnneYCcxbiingSlEWfjRo56nZHUQY6iHTno4HUe5/wfQODe4RZhcAMg6cAEGJ65d9YgEWjJr+8Z+xc16IK2u7x5OPVADr9mj4rkVuZSuPwFmMeuzu/AQInSPy6XenJ6rHA11n6o/C5dWmdqrWmap/BPVxjQdNTstHtmL5yTEc4HOZcCn497Ui6roYwZFnFqJ7LC4qN2Ynl6XXfWtNAIHkJFvVzioOb8PBJQjXViFqP39mv24kNr182vJIL1/DYgtZqkg/HoTnPhmbHPikj/f8xyu81kqw1Bvs8DGRN1t0aqqVOEzhgI1XhB/ECXxfzeZp5tc7cj4EaUUmNZJLbZm5AWw6Hck2zoxQ9b4vvvn2+9jh1rNJAFv/Fv32R9L5520xhWdZkXokDQN/0qESdG9M1i0Zbe8/mzr2Z2/LK6GrvKQRQvuGd37mmpwoc7CL/u3vU0VzPk2H8iYlXfQaIgMQBFmQcrScMcWLDJGiyfMNoi4+QEopyL/uFtN7+ufyXoMAccyttn+BbmE4wrKy+yXX/e2b94jg/tPJ/SSogyghFA0tIQfnbSyPbMr41AgbmGl6tEl/lF0QZ6uh9rbLVI/Z+W8IdaIg5Yxp05cmfWiMH9toc/MnNxkPoDcwqS2cETP90zKjwYyjkdhmlebvv9Xgnvt3T9JSavRGxAoc7BB/vga4PdtnV8DElSLZhl+HLYzw2FNmpeCIGt/iIYrTasCpKOAHi17pl2xkTcFlSH728z+KHDTdoM5ryTkmU3tWMZudspI55c2lsmhbc38lQahvLvDTKZ8Lm/h+gw2z1NSDAfMgBpnVbTTgGwQachvjfskkxvIDbW475lNJzbqmlro9kR5Yg6qX2owDYDiN6+wN5lMVYkff0b6sghup9RNneoeX5cjS/LOoXEMbk8/YBXycKFRZmEdcWSqSaElt/vbTp1xMG0QxWmQTd1R9wMpiWdn3TtXhtnVHLF6sLIp7xTPm4vD1fVd1flt71y+5HEbNkoMcLS/FftRTZUkyeZ4YrNUjQ/SgQwIo+6gQ33p6fKa54uJGEM5v0721jlW1DuLiJRCfh9I19ssFGbcXsGCJ1BowCenXHcfoPZYlMDsvYqKCy+/Jh0FRSKnd6tE5wTN797llH0v/hv98gqcfEz8apUHNax1ufaNTsMTqX/uONeQvqXiJ+uEYtLkw2p64Ku/ucvIXs3IQV4rdXiJsjcqieFqJEgj/9Y5K56XZd3+5Fq93sA3y4o21hKJ8Eb6HL7Xi1BwXUJOSFrJmpzuKfoUy656sqxEx2L5a0b4tbW5e9W5RJsUDGsXlig53irk0HBoW4Vj3InUwTgIxQpJ0iC2qcytJnraSCodq4p3al4G3+MKpb8ftmJqScN2brJ3TITkjwKalfO/D2AIlEvIXrOJrfDReuajLqV29AHHo22gbX+fSVo6fNIzdYRHPgrKkj2HyibN7UebTF1DJqEpp7JKPlz1Ezg9nX8v04/nQiqr7DPvKdATnUHOygPFby5A7gFBYtCkA/B5Dl8MEMfg9dQOZ+iXE1s0B8MGG6unE6/tCV+cQWD1jPO3uH+JdrxxLKtCug47dQ2NKSBjaHW7Aca+iMRoEQhKn5WU+0nTOWAjaMwWGRoFyKOCH3ZquCYQuZKBzuLT09RRutskA0tyy/kOl0xyZ8duyEZvZ3RfTCYE7RP3xob32efVIWVRrcodLMur90X+T9PSrd1RranktbxznC6a16qs8DJFdH5nicc92RVtCmiykMltbj6KYKQ7G4dhzhpsPuaOEMKdZRhXpN1mdeUaASApUJpuD8OmEqsNyxEpYrWHkPGktJin22EJMu2+Z/nxxpdCWDsA9Zfrt+NLmOsLUg2ss7nKBGKKwyN7EpKa7PW8fAu1bCDrmX4GFQHCoKR+qN/uAKkSEVpHJC/GHX8+w7rXJ+XrOsyPCxyudxLKu47DDSTV56PpyWlY2QhJrcniZNf0MB1G7Wi++JcgHbqDPJzdKm3cnyFNHeKmuE+N8+frA8wzvzUaJODERZiQQDAAH8z2R1FhLAZRFwkHMkwmmbLTTgSawvXbQvJfoyH9wrDp7V4ZACwptz8cQ+9eWrCKTOQtRuHmEqCMBvOEE4s3ChWzC4KARbGVQ+JTJK+Y5F+cWkOVIdFOjOwScYdjEL+7r+KDxtwJ974ARO+/fdKzpch8/1lKuquvQgS5R7cr3wLx1L9sLGeik8sV3bHK6Ik2XJyaz0VKaXy7Irmv6BAE9UXl84emDlVPwoAw30/dICvvpzvEymTmhAcp3AycsenW8mEzztGitV4zE4JWty7KLw37z5uFxquE4g9G4FQYUcDVRHShz6/Lt9pk1TOd4Mx7BU+79Y543Jq6MVcDw5XofCDXv49vQSyazTscYXh3PG2PD4gynGsg7wieBTTHTCd4GedzxrORV+LJigeBIiU2hIdU6QJDC/OIJB6ps6h+DxcPblGe0lNEzY4IlYwJ31HjCVna5iQizjmvwYgR8M7Rce/YVp705HYXkAHCvbp5QrqrAuIKuXZQY1KvMxtqAJk1Nhs08RSpyjip0O0TMqbm4W7IGeMXkONEgjjnwJw+trvIsWxCW9f6XDyazr3+qH1Wij2A1sqQwKdEi32OWfV7WD9dUziyAhQxLYHC9OlXSIMTKooj/aCCRqjC947plHovb7KeHlVVdH2KFzyZr7hQTBgH5EAG/tW1T+7Vmuz6Pl8GUn9A7WEG2To7MRp1HMSflXNqy0hpRtqeeZ/mLlJX9JIBiBqUWNauC3WRBpq2E0Obrju7iva4l9e8V6jjef/560+75Yi4OgYZeTKukjtkKy3vMosaxOpWILAyMLk+ACRPh3ujwLumBl1VW643yqfxG5WQhEMttO8/v5wZfjsvCyTz5FG8566mVRsdaFBKyfXh7KdQJPQKFix+XohFFWjgI64By+QjQbNth413TT25DW/dlsNHm7f/DclJzFCr2oaw+ZvwM20vKf4UeMIC4G0cEXnBd+GjhJPxEDwOPIBFkP68SV3i+qBwldh/fU/Y+HRBo/L7n2FTI1zIl5eSXmi15MJQIpTRPAipTJvgjJ/tcYneYl7O6+mn7b5fLUHy1JVLJIGdWgm/WkxfjFaRSnTJQ1Z48Ys1eLrzc2ld6noLoQWyRIsm+RnTaOUn9pPMhKHilMpibQL8Z44X26dAqs/csHdr6wGYj9J5KdONJC+dBIzvICDAf5c8aWT2BqU3iWuG1C+11vBH5aamPriR1XI1iwGfabap9AVDtpfRmsjlq0I8ZOHcVDD84/WKXR3/EC0EJOoZCdIzb3uMp/wDBUDHDvVtZh1ZYKJi18hOQWWDX8JzT5njAJS1NTf0P+TM88lkw3+pvh8Nx1A3QoJL/Dkt7/f8jx5B0B4p2R2z3+MZCspiRNVgmW8vrtvf+V6hycgnOeA+3oUj8SMztItcsFwga6hAKI6QM7TbU+cNsDPiBjLZBC1aBzUDCA/mH7FSSca7ka1MWuDGR5UFbXqKQLDaC7glZd4CfQghYPy5sU7IkwbSmccj7gwjJsiqtnvBTe6kDR5jbivxMpb/6x/ksvMSuhG8AJqjmr3+b2AjpPPwVeReJewS8FC93DGMWoCqKGILbwQkWbcdaVNCBYYjIYW1JauwxEomqWlD6jbW6Gj/LFVdmTW/C5GmHV7kH+ydayjeru7bkuRDXDqjtsphV5D9k8d26/Qkvtvo2G8Cn7Y2xvzkgW2Nd3BdAwi63/naJSBZCIr8serop43PRDGSpJK9fEoU59t/E9kB0NxFlm5CGo3qQw1ULrS80AmzZA7mufpG8y/dQzbKRcgFNIohUYqzyhmq2OQ7IiBm5ycNSfBZAsZh9aCc1M4MnT457gEuOvPtL6uNkwfrdduSTeR9b3Bn3CdWNwZazzk/OMkWBsPJxSzABCGwOqogJt7O9ciN4iKQ+hylKd8wK7PCq4HiZVAr51sQChA7fmyqdyQTXi1uE2QLJDQB+qE4aJ7PQwcNJUCLkD/pbKA9jem0UGuTiz/zsmevNbEdtVWh4nsFAdXRxGKoX8cyOhKgl1PJaZfwWIZeYfWhIk5xI4ojjWY+bmpLV0V+LBA9O6F0Hc89Hzv4gnF2Steija262SO1OTCi7wGkGGSqAf57hbsjSA9U+GQYnujpjjnCamFkTJtblyEAf1Xb4HPUY/dDX4u6ZirLwQ8OCLrmnK6e12johhAbwC5eXq9roqFHKBO2FtIIsYt3bS70TEu9DyD0U2uhNULKQOwcxVIR2yqbxqNeU6n7/JjwnWfSzyB7nNXmNU7CjdSgnSRNxipb8a0MF32x8apkJxPUdivn9wQXrIipHUzygs4dZR8hexG3r74qaqh8QdDerW/HKvcQ1Vg7ALs9e01DX/Qf7oI939wMmlTSHPJ+wtHYs6AqicCQ+Cjloi5gm2J4foXX7ClwLEP8dVtcCEvfzeNoqYS2/lmiyvTasu/rZ92O/2C/I1jQcvAMQ4XwPkHst2WwUiG1qnNHqxAQRT5rVr8+GXGzEv8/fBJQhSuc0ZVbpcP0na0HtyHV0tLZoU5SC+u6HeFkklzxN0XQEsDfhdL+bfuGWPmvbwMNMXPCMFsJhX9L8NpsF+OUEMbT4e9rdFFMprH4WKyd6LLRnNraTuG7z9OlxZOcJhuFMwcBYP+Oeq7l/oUBMNXL7A32A11WBjCxK3Hq/6be7WTIXL/OhnpbOkWbwPsP3cR21GTpdbYsAgbM+OBUuzjpMx/dF+rw4Qyij1UROpUa8BpYcJYo4Cc4Ews1Ka0ElGRjvXLJltLrVwz5tqP3I6WlqkZjko9VUJsZIdP74mTM+HlYM/64TMv29FXWa6yS00Q6eRBS8GnrdvP8dHZ51bSw51gPMb6JLAdRfBMqPDevuQKcAXfmcrCDp5Rs+tNetyYnUpTVHFTYnn8NmkCoI9bPCAOnRPEGTrUS8HYE44r+swzwbbHYFc4r98MCU6hMUavO1Pf05y6PgLXkgm2bDosPLUjhXmY70MKVOZmbTscLVH+Gb5aBZ7praJ+LAlyOvZER22nqZfCSH7NQbVxARohCCGrutplG/2Z+aWBQJ5G0Qty77FspUfmgz/w5mTsqJwA9K87eCjZ5+TqGbVeeI5Vj963OxrwJ9MP6pPdve/mOZL47Jb2PMlNcUi6VOQKs4uJ1aC+0MdMGHvI2bVXieCz0oCII2Ee4vEz/5Nam7S8eLKebzrxJrfonvGGQmA3J++x6izXBf2mUx0L8rwJ59nHoRo4tMjhPr9cn0XFekW+4tWxOCYF64GnBQWJoTXCEdeVoKLvLd6xx3OHvQukcZTiX+hCoD4VL0/91EEpSV1QBVR1NAR3g4fWFgTEv5DlvUnR64eEZnewQVoBt0qsyk0Zz5sF6z8y+Mbixy3QFurEZNmIwrpL26Hcq+EIZKEnXHU4uOIZ4t9ZfKXkQCBtQ+5TPvntJHg4ljZXgwU4FrUNW4chqFXWJ+p299pc1Ti1i+tmxZZspp+EakPPzNofl7MYH3SKyPFGiWlbL7o90c0YJWWvsRrCtfa1Cd6XoC0tfSukYqMS5ZNWeDBRLeXduvHU5p7zVJmCRNYMpsqiJ0CVIqtF1Wa9HNGpmnND13OmhNXribOcLRgAi+QhjNtI5ofyT2ruBiKRZK5kC3k8yzL5EBnpmLdPjfVs7WkDevzmkdfahk+RV7th/8g+GmNf00rjt1OdTc3cXekoyuh9C1fKS7oaZQTHJbTnprGUK/OZz2WRbJt4JeURHSD1nM1ZAIR3lHs5QaKy+q5p763YgZ4C/lEbN3kOL6g4L5gFwyFXzd1L/kHKc2/DYILWsfv/QAMEMDZNu7/GIpq7giCSIZ7ZVE+F2j687pkz2ElHyS9R49bPHFHvFzyBbrTAw6gNJ1rFg2i88ojwk2YZdEgY0Q2RZ4m51LeQG5aCHu72A1j7HWcz+Ju4N69jb8ilzfBeGTLQCD5RtoNw0U4ZvLJs09w1c+U1mG2RBVFQqJOJAcimfdM31AjCfgIezKNZazu4qSc6gsz7wT94U+6mOGObzcPTOXUTZ+cko6BtmQWOk1Q7QngGvGUD+kW7ykzAcJPADMygH+NK+uVd2oQwUbjDZO6OWrNBn1fFiCw1R2YkkfHOj/JwyEjZ1ipSUkSK5tEhTmIwMHvPku8mjzKz18pm7knkaZqLuf1wL5dx+rO4jlxDpZTHyJ24qx6xM51V86yo/nug0pIzMvfCQO5oXa8Rzu1xEbUiQ3r2+FdwPmqzxRepqjrcuEZ7Lt5ZHnbZi3Dy8v6z/oUSJIqtT7XiAemuV7lDUYZ/fPE3yUsSG00b5zHf3h2KMHnv7SbZZPc0SxEcDd8F0aq9YHXF50rcG4oSlmCw993/H8bWaeszsvy90wWPSC26y4H3kRhR1FgDl0DA+jCMpS8XNtuIkJgS67CtFs4pOs3xGWTkUreGAFW51Cyv5DGetRwyqSKT7FX4ZPoFEvJuxpSrkivy5Vqny/i6V0OLCAVYpwA50Ngjpj1hw0r28GcVGbsSxd8vfyUjill+McdsZyixs0ob1WfKoc4kMKNb90jYV3pe4NiU/4TmfF1xq0yiFhcxTcA6/45uEp9CJ39AEP0LHEhT5RjJUBUjGuZx1kroQWkovIyERApMeBQbQzTomzAao5TLjuUEngf1KrbUklL/Q4oP0ZxfOkh83qp1sDeeiXZctL0hm01Hcp9KEYg5McYdFiJjzqhHrgaRM2I8d6c6Lp3WYjpTYgsrU5m4AyaNV0hN3kpmY2XwYCecs7Hk351o76JrW+cq84/4DCSs8bmEWAW19PLgzcC/3GozWHTGzm7oo+usVCD0/gYp7RqjBUxCmh6nSvivn+4syilPKUwbB+TOgATFeTG8sA7Io/IqOrDQCJqV8137Wj/KaQOaK5+3l4foth5ZRwy23ez1W5P2twj/qoINxFASCSPXltiGJ1if38qPB5uPKFt6xtvUdcymDqYB9tWfArjFO5ueSBHH+vd2BqrjONGljDgLlieO67jI7jb08NWV8AS3aIPc8u9SBc1ONl3pIbqpwdQATJ4ccfo2Ir8LpKgnrnYiEd8Xrge/Zu6Sc5uBNAphJ6OpXhDW/QH+eWox8+/6b9ATZ9eNZ3Fv+FJEfTcxi5jdquJMjAn8YfhAp0mp9RFxFga3NcsYo2V75xVIjCOIkF7FGZHDxl9L1RNLz483EPabpJdHKz8eE+qWiMgTXzYptPEHcrdZ27SGIm7djts+Yq8SEu7kBLnYfRzvZBpHg9GYHIsTFtFzK3iORgBxUIO469L3iwD2hqHYs0oyBpjxoITd4dAAFby3bQQup8FpjTe3XSFJnXSM5kzSDKEcE7tGLktKWq++sFDoWd0ZbIX9y+GUM28+Vm4WBvzZZ78hdf2I/TvpFV/kbXkZO531X68lALhDGeiho0ua/8SkOhT1u7wpAZbrk+OkDchMIb6sayHKSieE8xCznMGhyRbc6u2lu6ydDrIEQxOB2eql+vfHbNg/uI8uDyrWa3SNld0fhuo9esIVV+aD1cpDLLMozV2SrFFBARaQIJ+donfmm8CJM9bt6Zk8QjbmFz5C+jAtTW41cmVy3509JXX9SiCN15Alc3uP1xX1tS9lP8yjaogvFVBe3bsnGPy7Pv1zuvTubE9aVc+KqvAoLdx9vc+UkAqkmvIxZeUdb3AcGf84AKYl6DuWBNZgOGkLVk2Ur+hKFdkb3aZPhn9y5jpeqKo+nQffRt7ZH03DpLLBVlQNc1Toiv00jPvyc/DPoLlN68+ZrPJyNdxQW4xPqTz6n/lnGW+uWfoZPB0Sxtv0D+QA0CUT+HtFSfPM4Dd/km7nOaJxukTSsSMOLWia/pG4BlWrKo2UDkCJ1BxQW4DLrMOCXfK67JBcpA9rIlHnRYtLSUyabGSDw03LkOJNIcvto/QBw56dXhSduTovitVf9qlsx3alEVWd+NDrBJie5TOh/m8Xqlpb/Lk7MorI7pDmB+vTFo8ICbur4Vu/R8rXx9tOSo2O7WK5guTQ5Ywp8z8+WUbj/+yzceL167F7WnvOq6NRrGQWtqaV3E4sFFxn5aGd1CRRr/ATJNmytJvp609n20vY5MIDfa/24wDOCbDNELEJ1h1YtIKfofJJSZctoys5JdeQymdkLc2pWoHMKJXksuGK7cVOG2X6R5L2anS1bwZlDwltJPmEb6R2UKEm39ovB4k7QN9fgoo1KU8xoOdNClblKz5Dm2wqnoqO2DkqVtx4wzT13xsaXDnI2JqEedtjr3gtriqU8KeYHPhUrX1wVyytetoGIY3k790et3GUiXd+eSznlYyAGsza/qTsdj8yc+3h8tMFQA0kDGVGsdWfKFl7VkrSkumHBk/HnOJinOlNOeubRDEvJ7i2X2M9n0PuR8e5jYGuU8s0kKukq0N1guLtfJhvg0hvCeMUqciaOX0m+8I/LAUaDvDh1Mnovc5zdqiXjk/msMrt0zmfqOqPxtlqp1ApIOdWh6Q3T79582XHedfnk/1/ZEFcU4OwwA00hGoAOOUEjqUAQCYH/RJgIlQifOFKu7vkg+/43c/k8RXAeEq6EgxXNvsN0UXjKjfGN6jzHUFN+NkBTeFcvIj0ZFFFDFJh5KEApISdEXzyqfPRCxBN15zNQyrCbODdzCsxDjPfiI7cRFGzIQ1bVvxGtAxRunqkF1RNjQTo17pg8EYNwBGul4nyO7NA/qQRm4NgM9wKSWp7UHydP2WUZirukmJGLUOKOWO3jolHP7R+OXqKMxlT04BtMOnZI3+WnsDDkwKbq6R4CEtBNOdQIjmSyF+/qnDbsM2vbrJ38N8l6qZkn5XV9daFJ3rjTeJ4IOwdnbvsT9rkCRXVamQbenAif8/5Ehd4CmhfdV2nhjpA7jpTs/B5WLsTB92q9W4AK7RNrSpWFCOryMmvIo5MVriFrFo8x8UTPzSD23buzVKJ7UIvAu5/D0IYA6mqE1rMfQGKG/eGaaDnitV2UPO1BJSRiTpXUq8cx2Vbd5QjFXwXMLh1kxBWVsh/vZPURh92EogQrrUxdDS9ha07GYvxA7NvOboZR/3TGUt/IJaA17f5iGDkY6KQeHHChmc8V8zyeC5XcZVdDPPSx/4pAehbSH+GNCVdx7IBHs2dYH74kcJiCO/dvQDdaFmotIUQahGgSv8cjkhlp/AuiZFwmxMN8HD+B5XPD0VaNvILcvWwsv1fkpvHmN1+isOf7FINqB2atjDOG2po5SuL8oiT9KbMWv6GNwcm/8QvNw5F8cF/mXj3aKBlx49CezB5IqEp5qHnKkoOPRPYgps3/GRClH+5jAnhr7gkx1IgSQ6VhHSUuWWRPDrjz2MPMlsWxsc+CUJuGjDZskQp8yozClj6QmX+q3j4yBPpGH4JfxgvHEyWOYoynvfImwJY5vmmJUsGI+mT3cXZT00n1OT9MeSYgCRGiZrhc5bid+R11kuXGV33bb2R8HnYSU68F0BvaON+7/MKZJZpIThaSgS2O19eA0sfcrVb6riJeM6xlwhmNP/Rd9S+feVQF2Z9Fv9KFA5RVk7qnrJPM1Op3ONq3v7e3SraVFI3K+UVFdamV09uB1pdB10dyc0MhOUWaiLM7vpJdhPzXI5Xx4g1mc9aIvabhXZ3j5kl2P7h0deq9wvTYt4Atju2QAHtAxfB67AlkWV76m67gbTnxp52utKUKo+gHIJZ68imc+BXYZy+iPdFsJWeGuCikfNmC46hYOAF6quMF9p6WYwSClUkQwkhavfgX1McH2jO4AQwicRFM3rfPev4g2ekn5f8p/KZHxok6iou08aTEgS8PK6/y8YvrDK//2DyyIruMPSiu+hm5uBeAS/ZXJsbASwrLvNb6EhMf3Iy3pja4rEQMrqqr45NpFqehLNZI3nYSF2PKOm0IDx3mFS+hso15haSX/nzaCtDpIpoBe6cNhqHlGJ1HVEbdmnFUPePZ29JM/AilJXrE1HotVY/8OdCS3yV/evZvML6ABEOgO7//yaI47/DEWAN5lxCWEJ5/3jtLek7Zv/9GCWVR5VXsklmJqGe8a10QAHaB2Arutej+iSl6nMFOeHlIxixJiuQn0pBrG+q7eD7BgEFgApxBw8IGdxZYZ+xAmoXIgeF/renlqPIFuMWqbDHqgKHKEvdCzBtI6oubLFGevz/8z3TrhTy18Y+VWyEaaIK7/SrZ7pvOLSUaYIyrOozKqcLzzKA56/iCnWpA+5fS6BZuDFTyb3//hX5BIr2V1SJmmFsLICYBMUTOhstoDKLAv9lMKVzGY/ttpNGFaWDvlXRRC99JJOutAZLhYYxuvJ1rVwU25M1v2Yb/kaqswhH4n3+VmLS8+bJwrD7LDoIBJrUM8NkRaaLMY1YojT148LX0faL3ZqvyjT8nt0qWI7vj8IrsybkgHHRDkG4sQtPvcWZCj01At3i5dAy4p20bPJwjDdrDjcdzXr1jK+ApT7ePTGkUtAluBlhXedsvKQGGJvP7bGAYz+yuU3qaEjh0uvO5rU3NP1DPCc6eVI7ZaPQrAL3I3UjMAJrPeRJ1lONpYHzRlSkrdXzYfUeV2JTakOzscU9JXD0Lxo0vVY640jvAkKKAu3xMdbc5rDKCgOWxmE2me+gIS/3cUQepB3fiD6iwHMYdqHjsMqoBIlv+u7IwiCJWbUY0ixJ52075UGWFh7EK/PQoKUJ96jll1Fq4xs8pNf7t11bdBdfbV476cg9KidplF20fhAXmbkjynOKfDbO9chBwoO2vtyK6gXd733NeUuGqTuL7ihS27+e7vD4CyJV0OJSnnYGuNKaQ0XVgjRskCKVIqfbrFRlgyZMtzJUlxrbiNMWj0DLFWc6EXUuWB57d4vfLpkmHfAiFlAY/sGCDCkYXMRpmM+C99hTf5fEj7B8rZ/qRm67nVC1XqGlQj+IuZ/04mjbaloCUGLlEbudrseg7NQWgUlgxtgHSaMVxwxGMLO+sRbTLUnFWNZoqG30SNYTrzPJbfpprGjCBgko8tInNWlTrpjNj+IeQGgLlFooN+VRP7EsPLIhenlqr7/V9ilqSll7XoE638edpJanq98Sm6ZDznJOM7PZQbKRxZOCrB8RH7DGxUw1iwIo8xk7439ZKUHMqFJaruRts1MJX3FrhSQYP02UI69EbuvS5M8J+jbxzm/4dLULaNFrD1nxCEkpDvcgz4FytSwkS1XZG4DpZav49VKMtOim5pGkv6eLV6tQXRsxVxbS/3yDklyg0Y767q2441N5AS6ODMkzIrNQKSUI86ISRl0tPGx9zZ5DHOY9WsN6BZ4+KYSOuFECIFdRylJKKKi5gkj8BK4d7arnvYBUeGu06DGM3ldLeE3BWP+cO7BqPbQqTwvL2GQyJHMz7GSQUOjK3mdS4zwysaQ7WCc5Tn6F2N5KEzrecpH98UwzrkacG+rVb+8VOOeCXm9ICI10QskbzkP36F3ERJcRN0iYN0H/5iplVL8UoHabClEOUDVNH0RtogvOPDcpwlFpDcf0Dev5HsctWpmeN4W4WmInnNRF8CI4OC0J1+0NrrC+D+CORMUG0SxS6sZ+NmJ/VG0SqdsgxGglFHnZqBUP1xsHafM3WXEb+i1sqyMqhBFZr/1Ct9vKNH0W2kFXRK9dWnmigrZ+dVeV0rxaAtmheuOg6//EDNulKzWrf76z7Nn+QhROh7uPqHxBt2UrtMuao8A3FYApYBS88TlEa7yjwDVO92A3gWCLI6uzoHD+wUAGWAHXb499mwMD83eigNYp1xvrcSE3v/LlPh8EUTqGj/S8Dwx/quRTa7sAHKQSR8wnt8v26m1KyFA2Iqixf2h1nc/LDPrd340lB8ETP8Qsf8aQ2bdvJ+4QsE7Z7KWm4pwlENerqeWoqil0goLE/I7OtPzYJcbc3ZEO+PkO1L0ZNFNYUDhnDuX4Dw7sNTAULrLJKl0bpH1DXaHVemPs/TzNuXvoHQToQGl9OM+aiO1r6x1MGSL8Icoipyz2rPAUSoKq01VVGrnQqbUQUcgP18EDMp166qPOgZp/jgsIa8SZ6dUUjCNKZvL/Vl1Ats/Me1+PJbxymcd+Kzdz/AEzWNv+xxnoDJLSWgs7/yjBQJrRRenqfAnpGwQvIeYy4funkb9I+xRNx/9xN7O0/ZnEuHCfIMR8Pheutqnq91skXnRgfV0rDX+ZXikfcmfGTrTZNJOgWjDEAtM5pZyYloi41r2rtRuLO2vmdxZWylha8zOhLtdb3Zf2OWjO15ipcgUaG1h96O7Pwnxvf8XwsCin4k2fOBm1tuCN7w3A2YY2NXHs+iWe05TACe0SLRGNllMS/YBpbHcJM5jJMUBtHCzt6qLKpcA8t3v6gIf8boftVtNpP3kgJXu4ak6bRNbVrEOcPmmpuiVHuyWovYqlX3YfDH4rQ+jnUYSk/EFVSc0T4RubrS0ioNuelZAYixdm2KfVS8ob10Oe/PotcyEFOJiADEO0k1SLInhBKGtWunmeMrvzGLMcj2wJJ+5KIaAVa3EdyPt7Cz2t7fPEMi7rei84TloanbrWCmEmg1Ktq1jBaH7GFehVDA3IrIYS68Y5EJt6Mxu9Dv8CZTUpck60BncYPC7Y2W9tvPxriepVtYyPD6OIB78TJE4Ez/INeh0j73qdeEZdRpfEoUpOyE/AFugj4Pi6aWsk18c6DH8T5b8Ip5+lt/+gDEjJJcFUe0nNf6oztNbWvV/e1DWWZFhTnJyzfa1UurROyVWd4uALq3IktQHyY9G+l+c2M+NEZVt27m0g76Bt+RW/PKnIMKNlu4QOV2iueu6IKiaWJ3CNtI2J3oIGwZFqmqlvxlgjMkJqR/1jMF/dR+AT1oSSRrlA7Qdf3O8xWZjP9JuR8Fl5NIa3G9yyjlZoVm/7eva/m4ccnV+OvT+gTRim87v9ZoyG9h8Of8rZTM5ayN4DFmS+6r4N8NygaLZBsUdygFpUsmta0etmJN/wd1wvnxcfAQ8Yjny7f72Sad2DgQhxv8pnZipZGUm4PujLD7YUZ92WZDm21lzbrv+koM0NW0+JtoPXRZMgCtbGXb0/5sYpdHWZ+EjusJTzBw2h1T6nljaIe973gXpZVRJ/l4w1jmAgHkXW7uy76HlFWZph6iqBifWa/mqFPJW/Ili3QFeHyhPWpdwECiP7fUYTFnY0T47Uz3f5T4p2S3wrIfefEyqTT/C8jEIMkpRG75k2HB9S315rhl3T+Mr/IcfSAREK54aLOg54yuDaOZmGs1/AHO0LEWTUyCLBOSzwU+LP7G8wpOW4I+zu4F18OjpOwirPZ78XBJaTGGVp5GyJQ+fA5rWCFa3k3LwjW1mWpxVNk3oC4zhmTw45OPLhW1jMWEhy0hqjwfNxem4zQTUwAS3Jsc50a+8wUBaFOaYw0I+wHCbP9wJ7TzLstcXHjDS4ngNE1wUHPjPdELMytkT7wXUoek0fWzTEr0Te1EoG54kwYJbbtdwo1IQa+9PZrwKc5n/pDmAMBCFJm4FxnJdu3oVbvtP4GN7Rgt8YTsf4fnMwU/KZELhEIzxuGAlLiGEH73lHTwJXKiqGJZ1vSbzQb9TBUin3dO6KjOjP07FqRRa/yxP82JkHzSw7/jwPtHx9nVNbUrta5pVdJKhSdNM3P1jpghGAkIZIKZdFtdGAJPe5cgJHkUoJ9Xz3LzDPdn7GnPvhmQj3cDrnmPLRcIYVUo8jnwevVcJx3riUp1Jn3fRddiqK+n35O/uwGvo4esJu4y077Pz1+NI2GrBulShq8FXP+XjIBfYNJ8iF5HacBsrsKQ3gtTl4qe7/ElcAwOzYFcj+QuaR1zesNxeV1PPFfJK+BbO795yGlu202QqCtd1GeeiDaYP82HVif3fA0nVhl6edZAIlD4oLkMiTEHv/w2G5WolQmKSLwrWBNDKuZkni0WLWCaiTyChXTYgb6eoYQuKwtaWB8UEi4ORrQn+/xUO9MlGEHC0fxrzAxwm5mKbcg0TS0Jo4md941Bz0ipz9dX2XJy/j6dZ25P2at3nSqdEzdodly0KsAa6U8DaftDoxVv7dDAV7zIamwr6maO7PQlL1PFJHpuEpAjw15xP0QS6kDEfNSJXbJ+yihBP+xqh4dCZoWiEzlQsnUfv5H98mWnuc9gcC4+/irlT7Cv5dEKZA1C+d3CeBuG/Hb9qD2jNHhn2l8HZ9QRog97A+9PsZKp1XaCf77tTEB23GoMAMw1mcOuMaasy06v91jJb1cv8c0WaGiuGAaLc+N9iZOf7/kCTscwNkrTYlFO//lAHASt8mS0dmVhhAs4dV720LBvheiAK0xuk+rm4J/beFuQEq6QsN7C3aP67VKvzqh03ORkPlqhxqK7XzvflfN9ZxqSVff0TJCcnmfD2rsu2JrYak3iFP/CFxwN2snDsH7MOryR0F8hPMYD1BD+514YrqDuiJ31H0tnVkdkJWkgXalmyRSRNgGYnm+yBH0YuOvH3vxxbno3oxuy9c6bWVgnsUXZUnscnpMVcm8ZjCjToOAXSaDlL4iePPTMYJqHAFoBIcjjSPrOZxaVERwGxsfSR4Lds/GSc73zBPHjeAlsp54+w0awLWi1fbxyAuTgKg+ifynbUC7U/Hq02+O7FUo6W/3uRZX5iugI4fkvTRLkNMPQprnfz3wRZ1O5ch7Oklg3bSonzob+mO2jGtCL7YzCxwQG2RSZIYAWjrE3KUkeSqf7bCKTktSs7AqyXs77VHYhBguXQBbTu/sd/fdLeF0ktyb+r043oWGPZJYG3UJhtVnIh8K0zN1HnY7if9vtZtZF13VW5mFOj0oafKMjexfi6H/EmblNRnITvOCxEphNEoQUAQkYVqiRzNgMhXekftLAO2YYfEDs7pA9vcJgsaZ1o3BsRPVzn56EubHWvLnYW2pbqPTLqrBdyG0+UolqrdRYW07SSckOLijSmjzMU0iKAVmSya67TyW+1ONfYcU/0MwkYwsAyLx5m+lBg+KbbqG3ih/7Q/B9N0DYI4KGjvlh6P9Lqi9/+L+Cjq+bjuZua+Nc+MEw9grldpLG8xUIfpyOCGeljkmf94ceG++XS/1eJcE6vIcbOzrMhCU0zKsEXcdrWki6XRhe4EJfWcGWVBwCiZ/0jK/srUIZoaHZQ4OlTcDvvwh1gijh9SbPKsIRZTgznDk9jlZyJFbccjyaOz//t99gSeNURDFN+L7VVvAtWbFJ53t26mIh5kDg4heroz1UyBmySN24mpLyu5po467+4O91+Ayi+My5xnBju5qojetH4n9BnXnvwlTM5TfUkWDwjtBq0eJc6/wykDiTwYeXQdj10XfORh5tNduGrU+3t791vpOHsFub1eX8u8IL8Rtf+O/TsCoi0V8+VIKI724760QOw4c8XXy6Q6Rlz3o9nPvt85/f7YyXkwA+49EEHYmoZV4KqZpoaqs6a+Tv+DadMDzRq/+bK502nl74bD/+4b926lfidZ5qRvcs/SJcPjwKj6EYBJRD2oNFyEdjWBdV5HF5lzH6z5KkLm3cxlU9/l3c2TrNquePRC9YiUFiJsb4K5MN/EklsESOpxiq5E5U3bXQ6CcwuE5ZRPRUnYQSmuGDl+Ez0fCJItOiYvtmWSQr92KUuNcmepZ/fHlUWUlkptdjNuayQ9fHHVoTTOicWlXreS2zSxxhX1iN+TLG35xdv2RbsSV1cfCXkywXs5u1lgs3fw7qVwnyMd3mfHcJ02hgNmHXK7xpeSU7GJq6sMRy/NvQ9IOoXOzyFpTWFCR8PxCW2LhVhMxB7yG5TVVlpAb44kkkWSNmo89ZPapMtIGArsy3Ywk9sALO/k7rs/hXlmrBFH4G4nNTMXrCZZUG3tZbQa1H1JJhYyoI6z0lPVB/IdqiLuGoUOoVJIf21RCthH6mzQYfMd7VyFn/FL7l8p3jSac4QWbHt3E4q0LeN/HGGFa8i/8W8Xu9wYvNHt8sLwXpfpAmRcIXpHfbgMBCOEp0MrmGz/xtyGVvysFN2xpBMOB5x0395e2Q/hJeDe/7+FAF1gM1pPHOIcZtBMLJ2zNAD1OCRtWMbvNW4hK1zK3bXJcC9rtM/lsmYTrHOaqoTr/SVI9pbq0mIUhM1Pt/ujPGm/TZkir5WCiTmsSBBpddbAaW528y2Era2aetLXrRcxUmpK/7gWgjlEHniOQMLbaTZiUBRaqWRrVhxjtl6YVZoStFJbPh0pkkwZB7utUFWjd8CqA6rBbCrh/uIyouhjumWN2C+n0oKShyIs//aLQNkPIOeNU+Cvq+I95CaiEqq7exD2R075f4gLHlYxT1GKWFiV2HHTIuMPA8+07nHaAivBlnwjiT+rNWL4kaqOPwZzlYD7bU5xMoDOpTxXmnQW7jlNpgrNm7u7/vgxQIjZsOGQyXNgKyAcVYqlE55gaxlYgGLRa6acd27APPGxzMl82eDjM2F+87VOvCd382vwjsNq0pjl2iSNc1X7MMIZOD1of+iqpMzZ6uGDVTkdgpkhqDbbi+yvmtUHWwdAwu8JYIqIO8daC+JgqTN33R78XLwUj00K3rJ8Gph+u1Ktu/4JMdg/+piVtgUJ7LQOeYGDOJzISFc4wek8hOLy3n4QHfLgkAAvCy5uDM0C9jgzA/VZetBL6qcVk5EZQv2LKjQC7vK7KKd2ZGASSpdwGQp7+CQQlYorbSSH/qBqesf8sOJ2UhpM50sYYdx4rj1uITVqIvPjI0hPKHvyIrwe4pmILm5oIzZnhiC3hLGpG4pRfdO+YeTLy/YNwvLX+gudDAKN1/+RAMiyOVt1HBLU7e+Lu55VhDE990j1KJ64TAuJqwfRUYgOnZD3TSqGBuUBYCjQd37MdtfZc5G5dqSrHreIpTQULgVMyULjtEKYP3GsFIGNbCSyIXDrPTcBQopH+HYSbdcBiaXaB1MJ/apAdsfVUhKESYlEvzzd1hRX0HSNmok+3g4th+yoOzrabjIerwQdFTHcWNciC/TASgz1LXUXiIcpSfUTasS6swapBJuxu2ferHdcL5E9Wyw7SdWWSL1EyqfTn8IEoc1pCtjtBv/2T1hjKLR6NR16+aN/dtpIVnocqnxCFoCu9Bd5Z2ipV7OTpheY/wiNgwobQrKJT78SkPXG19TO1Uqh/JdgI6WuQ/U1P6RZx68hxM4mrw8c5+OMeXhZLNKAtsNoaB5WFq6ObpM2lJg4U7idYkao42URESVp92Gcn+UvZvPRs6O1mQMonFMQWl38tCVReZfE6rNIdUZXQvdbpPG05rRjSceliJtM5tGX5W7C8W6xpW6zVvYNwebsMfzxrOTvhO7FKoyMBdcff4n6fj+Ii8vBRZTI5IgIQkhcdxJtz/t2glYMPmp0refkXeFlNHCExk3NPRHOadr+81VUHXUFnHEV7qtD/hUwJewnCmTS7C8ErCM8tdF/2QW8ookPld++6nxIkf/+kYMV5KG5IgeQRCgBim2TxFewVWtNhItJ5tx0pdqJeLVUWrPJuPDHKGbOY9FFz2EzcxApm1Mbl4MPMi98mhgljS4poTEBcPa1cCToxSO9OEQeGaE3+Uul3QBFX8TfZoJpA8I0LRWgLb41Qj57C5NmWt0ogX17KcwmwLeEt7HeL5TAuJRR5f7NX1MpyNxBMuY2vqbD9VImPKLqjaKOL4aabDlPLVO/qXhlOm+gKvjgMUZmP6MPUSE85DJrsn3fKTxi2Cmydq75YpbEGLsToHrqppeNU3ds6/2tUkGul4hKPdzclFtfMIJOb60CpL8H7XiOADIfZc7uQZiZMp1uBJJWtetbfUKfFaoCplSVqTwBamGT9G5P5tCNlDcUwGSx+2VdjzlN53S6eiguJxBAydH408GIjgql2HSlHwePalrij9bb3hguE58jcAiS6nemCCZ8fWbznoBRcpvtN1ZzZggYTFd6eLHCVsZS/wxxqo/DbRAG+qd50ZPr4unS0pgLB3/kzYW3Op8Ol0G+yoOVHqkEsvzj/NRPCVp4DqjIXwkZtBdYlGgs9QjPsXzqnkYEWk011qJyO6DQZXbfDRuXrsm8P0SpVnM5JQYuvyf8+IbYX7txCEo67m89mCz5DgcTusOU06Cc22ZIMzqwQ7CxySWVtpM11jeBz3+y6+eZCFcgbwyUvDEsjm76RSUd0cTheKRqNYNc+PTi3CoJ1xdgOgkqAWj5Uqxy38JtJstynkjWJ+QUkz5OaYqo/uatLjdevdb9D3/Uf0xGBTe6kuxAIDOuBrhdtdVvZzYRDg+wP15IASiCfeD0ecJTrQ72cfCQAbpjy/hHmheqmGnvYzaPAr2xuMnahf4YzLNJ7UB9HgRXXmX2drCsS2/zUW1NyT7sDQkyS+88mlVF4v6S3w+G+so6WOP5FUzq7bpIP0xvtVisIeUDLvhh6ScQUQ+ANNC36DK8h1q2WpGJvqJAKk3/IiS1ujra1HONM+wY8nyhfAsYHP6k9RhEBqQjWqXNGuZUIE8lzMQ2XeRHJxuDKW9hu5QQVhCK38+tqRGhJOQQBABH/ZZEoHnCIprExDU/vefV0y4gX53C9pvbynKt58E/1s9VSxhkpWuATseYHIPDCZoHKEyRph1j40AUFq0bHKOmqpaKLrcOBwsbD5On081U4bilOu09ISKuo7M0weqztIOYyMZMxuNRaB3JNFynD6zux0nUAyqDn1MFTV8wXBqgjfzDPSrsyinpvp2a9PPKr3cNIlb84lwNDizyKFDPZOdywDsCH7KO64k3KArF75m/hEUJfaP8uWfSAAvqsFq1QP9Ls0eVCko8ku8ZbK7Crt1CT5o/iAHIilGKI52n5/CtDUuPpRzxTTlqn4SPZOJu1+o70UGYVdKCnaWF89W/imqwIbfJ7jx8H5Wj/nqfMslMjfc7tTqOZ2QCNzQjH3WtDaw9zsWdYAx9KdeXlvkSn7Q0lweqJvbOry8nCwlrx8NpiWDzrrIIu6n+fkYFXsd5S+NFzTtEK+jgHvbtlbJsIoHlp/TF/A4v3Q803OVOHOHvnjKQikJTW1R7dn8WQcAy+l3of0Kgbch1l8IzaaiiQkN6c44AWeT8F9NQYxjJMP5McOBY0WUS/29owATurSpqU7i11bxNZMl7n3LCzTqRHPW/FekofrG/4ZThLfv+Lwh4WyjmIr7kKu98zsZUYVMy01o9yqpZ4+Ps6Y1C6n+xC5fCd5FZfdgE/7qHrHI6pIjFa4tuaPWW+nkwrT4sXywN9/wvpTrdzgTbX0QaW1SCje9njgze93uTgaNxb/NcjjlixmUxyD1J7VUzBqM5EIrrZM4ipI4PpaGu8l6bN7PhJRG4+wI/M88hiKjwuN2Wt24y76T32txhSN9FifjMzcPF6PPsJayr4E213+XB5DBVlHhvYu1EAtP7dU2yRSU7tOh2j6w3yOrTev285V5nBO3PafCoaq/baE1n5QaITcS8SEU/ZkfAHRBOruA/WPDBSsjMGVPfjUbRcuhFs5csqjfvxdSSD36fJGLtSIKrxFVwD+hdrr/E/PIbSENyTOQNNlhjUCkwuUUg1W4g85jkblwkIf+maPG63JGntpPWstb9Ofi/zxy5X2Q6+KIU1RZuCKUOYbFeE7gmUDiy+svwXoY8RoDyXucSfXasxG7jdEJZUjcdXcFGnAvJ3HMZ0G9milw9dcK3fbXBxYo11rj0ophwp1cEZoQzS7V6tPurcIbgP/ivEgzyCOln+FygP60MaNjH+zF8gHLG8Mm0O3mr/hU/E+7h8DI/Uo21DGzuj22hXMPVPIHd0of8d7rTxo2vTUIuT84ArqsLUEeToiLFJ1qDaxDSzAC86JBazdQs6N0P5QKIA4yawK+1GojVNw8WYbjFPBHiheqzeBxpQ7UiBDMkhCVzkXjPI5hJUBUC/N6udL3jdFcteSTK4xUeUBCghOP8mOdENPBPD0QtvSmtCEbg7HNdFZuuFMAojyfIG/Akuu1AMTlvGQw8GPr8m2T0EES5PM8vu/As1tpPXzX1lXkhPor1inXvPDFnJmbPLOWbL5o3GBTLE6fFjiQO5LDLpatXx2RnJlEJrIt2Ah3ifZXsMUjMO0DSTnXgJYL/dmTj7yXbaLfxFYjWjNgxuGs+vs5oRajGYASh11RBVGbM6Rkkd/g/O9a1yT03nXZRutGfrurxXCIQBzESeTWaVyyKxXKXhCHyQboancmD9z1bpNRFIutoyDMldEnllIAoeipjNzpj5IBlR5GNFZ01chDQ8ntAKnSl+Ac0ROP8Ebh5VEfyxiDNF45TCPNXTweAXUw0ww8DM9PufCxCZya3hsBncnuIo4ZmNniqn9ByxYZQrFwzw2B2n8WrZh0A/Hie7MpN/wtkw4vUXL2KEM0Kkk4gxrMq6CcmxtCtGO+1rHJ3+HbzWPyWBo6WaYLLAsqhd4JaPvC6hh2cPXGPXXRq/Oou2CccUkttQRE0oghNBf3YzhogMJQOhbS6I9wyX8P+tWcPMp9ZWqUezeaXlkJqBrogWUT+INpqCIcvI5lfhhe4fJNFLXNk3+YA+CFmn6cbgAtsWjuDixtiqof2fUTVfWrqSNbmgFyvDOscPe/GdXOKjFrSDnR7AbiWaqSqL5zKfWjXV9vCZ5PJK2yihVQDL2lckK3mgn+3UykUeodo3OeDjCF/O80OAJfHje7JoMWlIQGE9JILRzZYuKZv3UlU8XnKJkVhj+RwE4BEkubGNxIIDeqh1i5yA6FpXL4jEqqzG7vSBcbrbGZzF+XN/Fn3nsX3nSX7ED7I4b938jN0qPaEuELBYr7gKOo5LPAswO4+U6Nesh5cfPzY0VM/iiKuxV14RRGW9OXSJDiXWURL7MQrqUvwEMO+vCyfGCyVeu09f0PjHqWy8VlJXwU8FDYT92Or7jZjRgCwOX4ETlcCu24kTOs2qxosHioIRUCC9bn0mxieYsT8eSkMoAuIzkiWF7Otk0Wv3KwyxKlM0oEo3mR/bwVN8IDTZwIFn6PozChlU9OQMTez6O50C3tXhw26A4De/QA+RH/SHkTese7jsuirK8JQFGELriSavjM8+v5nTyf/k0VfUXSML03112fMX4TkoKMki6ChzaKB+2IPQJpvXaLiaDxX3Kk0C4VnUcAZuEFO7CTh5AQcuN8b27PcGSZiicjbCcP42t4QB+Ln65yI91iHpzNne8Hps+3z4Njh9W/8pYnrEANQEhz80K1EWqFFCgikOYW7aCJ4NxlNgnTQDRFn718Qx4/eJda1FiZn6J2akg8b5FV/ISoUocMy6Rt6WDVkvsJGwoox2N//2mX0WNX/1QzC97O1RYOXPKowwu+NtSDjgxFS6XgUjxzUX/xFhlVrugRIQ+FnMz/1R0Uhb+5QheWdecJQ4X6vKzAqqtCiKdQCBnBpBrgUrFwtlYPGuoUWKQelNPzDV/ZukwcufTC63ApNF8mXFFUyLq5klyd5fAcpN7CnVCV7WLtRtZusbA0r7ZRmT+0lyWP2duvHDuw+PkcI7UQAKx0tSNhafMyvbvHRSEKDY78SkLf0R2BcqGg/zNKt3Q073FyRNPXS4F75qjILYNNPSOc7PR1NWi4fd1V8RIRwZckvTakQVVc4vYbAdep049AxxlXEAyqdFiJrldAISCFS5t7TzNaDBIthBXeruHs9APniYhnsy4mHYrS8bx3jdmGQiKqO03nTXWwmw2zvIhsqRDayw1ebad12y0Wq+JmyfOH9aiCSs+01FPvkwMv7IuuLxh6Ko7kxXey9rlxRY3Dsy71rL+dcHFGR04nBUdFg9wx63lF0Pm+hVlxHL1wO5S7QpzvJoMwFmgzexe257XVBTSbxKcS85WcsqcRzaRiHByBRGHoFYak8XPkzuuIJJxriD+qrBMejc2M+zNwbtVius2OAptc7QK3ZOBRrILkSuc7/Yi2qlUnQG7WnPsPLtSQ4dcUhj8EwF17UZAhD9DpgIfpREMkEwDS+ejIoy9hEHvVejB0dVBCV4tEScwrz4qRhhyjepkepzb4pRVRpZA5y/Y0dK5c0rDd6FFpW6eIDO7FcAXb68tB1Bx4fa+d9moSF6ion45hEcSsL+E4WHGXq2IOpJHA6CZHcpyShRm2aZRf4pNWcusSmpm3GkTdOmOE6EzIcyDkpP6vvJARdaDVjQoGZaeFWMtkU/yBBInpCN983Ar5tJTTNrHs9qfIyJEVwIm6bNzdplgAO8X8P03Zhvgq/dkFuoDwLEwWhKgvdXfC2ghjsWSoKnrPZ+BWQ/BR5Z02K12YUu4IHD0YQAch41lP/A8aGO5gBHt6Dbbsw6CalvnWNWqTjJyWNlwA59lFcdec0pOytguHKW5XSHZRdjuSHUdIZ6s35ty7BCfoOb2Fu1M+Ysyu3Fog40kO/FN9BHB5Vc9o53TUjMKdXtbCB4L7ajSbO8Q5oObd0itAmq+Q6m6l1/tADG/eECEHJwmW8vp8T3UGovAdzEVd2l90JYIPcVL2oVJ02I7SH2IyYP44wXcQ/deeY+LAmfpTkX4o5rvfcZnswelyyIXmlfnRM/irOlpPxscF812i400mxVHStk1nrc8xexTSphwgVRl1HN1qydwbtQ6LsPyEebvYNdLMF1QjAzwewJSIyGqQ8HM8wcBa7ecNzXUDU8i0G7Yb1JJe4Rpd6OjbjyabgghrdLm7qSfEUVqNWadShQ5oMOOnnMA58yMrHAcujzmNwsHQNGwMJ17Apj3qNNnBbU/Nd4Yvi0dzSqOQ2aeLLzgLIXVDIsgbGUw1FnlOp776eaf4IppJpg27N2BeIZ1ZcrZIaWrOxV5HUhroeV8w1gKMKHFFJ+QaYPSxnj3Jo4J+H9RIjD+J6LflxC6zIYW2xxFkJ+VckdeAEo4dR+0b6JCjw7cd//jFVqcdAHaDl9YLt5Gt/gsapsE6+nW+Z2JrU8iMDn3fLA0OT20izEU5+ShQKs2H/IT7Cp5jqMwbLUSsC3tsweKDkkdzTZa79xmZRPUwem0Hms8jAuIks4sUuwpYqBPt6aSxe7aevvLzOv/G4zDq9tilnW4tYfsO7xoTTi96o1Z7XRnj3ie8o9RPNGaZedGywEyhze2HqN6yhsvncHoT/jKpBSEoEW+ls7PHjZUaLgHN80MBCzCG+BlySF8NzHu+UPN2Ns+rqj1cY89nivCmP/TzyUE9qq4PKF8sbMFx76qDj5jnsSkI2ouDQWeIDf65/xIOFgLm9+fCcl0JvAj7zk9fYOi/yBSB7FpYbx3cJrCEWIRiMjcbn9OrGMqVkb4z52sElbfyBaMApZbpS4OAsxEW3Qaf34Dk+5kQjk0zy7V6iAzQ6BFO7kvZOOURXzF8Q4wRMF3I1UUL1HKqwB2ZqHE/Iv4nC41qkM1CShkzmK+ZL/t7PuRaEV4Cxxk0F4xl+mNrZGhnb1Va0IbGvAGg532gVSZ98UkcY0pjSHVjExDTaGXwK/FeaUjJBFVmfoQPNBAsbp3ItcEHSQgm27vEkNrPemo2gAaUjnAwQazxtakHhxbdxi1f2KgSzQtX2xXejvsqXOwHd7gzi4bGBT83+r0ngJrDWU4nsfxnoO1m3YpiLSD7/kIU1LpsJNQtV6mQMfozJ18Ry4BukUvdQAXXA6FanAadkCuOoF0qKE56FMJtChZUhA3kNwou46QV5/G5ZkpRcJlr1L+EGuVRv7Fgqgu4IiOqMroEUR2QIk96Lnndb6OzNAq7G9FN0yRlS/AOmL1sKW06RK9S6yOJDCTYI3sJHQBjcCzmxaSxXzz/MsrBYaMkbDCSVwQWqnm7LIdUwhNKMCYD/n4miBf0VRYsCODgKaj1Pa0dNtGJ2NSLGsE08j8P+miK7hLgGzL/2n2zxsJkPYON0yA/l1+3t+Lhx9KtJuV7rylf+3ngw3cZM7f9ffrDLADFzmWb1rtJKaNyNundbu/Rval61LpX/C8yMAhumd9A0OfmGZDAimuC2tAmqXMB8yu9cgE7MOnxVR5u14SDt8IrMj8/DEXRMzB4OwdftqmK3ZsoU/hi2+5tdfj4BJFTXYBKsfB5sqbrvRQK743BSKanzDo2kz2YAgrCb7Wy+DjaN1Gz7SJGVDV2JzAWFzJqFyhkvBjHLSiq8HqO3AMq+/C9twE3WeI4Opdh/eD+sfLetRgiYs/7eV7OQv5svGxMmPd4RaXjB42vBZfeH/hXH9RtsOAVQvDYdmpLzdXQxpamIP8Coh+5vMlzxDnIiTt0gznWMeEt55uGlB8zWeEQNTNTS0+k1JY/pu8fmN2W3eXSVZfC4DEL/wvG9TU1sLuW35YR6drr1APtvscUHXIeG9IJ8QZf7BsrH7ezlpUoV6QYoT6fAnvU+p1r3Nmn1v9SdjNcUlS1e3GtQHF/E65qOFmZH1sam/e106KpLDWaKU4Bl0XunsvPS2ztsc5SEUEcmjizbBs3Or9hWI4GzwyGuVigcvvfJsR8Ug6izs5dmcRkvPTmbmG+BX7NaqbNYo1RBOIYiy8yfn/aslC++TZ/ed27B3XahcddASiT0WC+/OaOgoLmS8lA7SoXEj0U1BBlNSaOWQU7JG/Rgw4XZCVzDvMoGt6VgEphCTEZ7fmTgQ+u+RVrySzFT+dt0etAsUH+Hj5XupNSGJ8mrjVN1P8afPz5TreGWNx3GTU4YzM1jjN1ZGfXs9UFMTUFQ5fHkOb2i4B29pklBrlpR6N1H8Zb8h5FttNpsgfSDqNxEesLXPnq/+sH3/g/ZuLuykiKVyFDB6VDGBRFO8NOYCzy+kV+XciHZW8Yg9o/DegEf5fB9hIyXv3Kv5xL1sm/aO826bS/mCRot5fRGw6rdDDEQQgYhdOQ3kdZaPETIKetnqQDdECS9ACT+tWGRG8xrisXfDHndAuKclFSKwvBUgF5Z4j4ap7ptt3cQCgXFMPbWX2fRxAG2tnk6/NBvjD2alfap6fJ6bYW2FAamlZCtUHFzumfgizRGj3w0KOCMHuFvdkU6wDd52PLv1uNt8fbLqeceHm7+uIxvc9pD0G/jtaQJ2C4drjDX2hRUh5Xdu/DipQQV1PoAcQXIAyZCrOrbSnnOImhqIUcJaKRmLclqLFgx6xz2zLRUNDb1ZN8r9FALrWzFOaBQ078A+VGe8yukZv7l7bo7IfeHmdGwtRSOZeh3Ef2ZeP92YgI9imZFaI1jDYRuf2ZOnSkrZCLpMAG62gAaSK8mMaX1v5eRe33paiJVT+ZBWAo/CGHlyAregK4Vz6EsAJlpxtJvEkdAFGs7fLY2xxhHorfIJmx4H8/dkLF57QTqPU3qliWBUber3qO/5Cam2KdBkZnAc1NV1rv2CdnVO5M9REgQ+nyWBwkXi7NneFyZOfL4y0eOs5Xz+4GqnLioFUEPZEdSqFrkDEQUKRRG2Gy1DZ0ilMjrMGM1tYDQSN+uLcnh6kJtcWGDgLnjOUXHsNSEpp56xRvH0x/omuejBsCNjCyzObyPbfhDqaZS6AK+5P191wQsr3aPXMlTtvfqvaMenmpCE+1+vOQtsNLmBetfIIRAPL7GrHK6NoqvWkVifvFM9OPHqv01tgC/aqCymH9NZ+4+iSeP7rW3fHfRedjW1wYj3qQPcNxFax0Baza4mmTKfu7Pj7LS/nvSwMfNFZPctyYByGaP7ECDiCtOsfnITiYwlfJFLcv2rvwFr2Ag6qquKvZk7/2jQVLFcNI1zZdsFFP7MTrqYM3RvERa5wjZRuXBUAXSd/O6wj7R11cMdV2XwimFg+Js4/Vnm9PDy8q5TKfR4KkUwb418pNw7qTsWG/vN6O3hDjkV4uY8ogw1SpFkZPWH2BC4T6tqGSq6Y9c8AFRT1Tu9FsmZJ8iK3mQLFSBJWO8hGhbF0v4LKMPCwUmH76D2tnYeWHBeAqoCZYJHQHoUKEG2FUU7dK1rAoxD7Qerr0fp4ei7Kw/mVykXUf3oKFFy2Bbf/9ZivdiKJbpqF74jlpB/rmjuPEtrag6xLKVI36dRCEXEMighPoB++otVvU9/zKRX5L5WhiQTImacvYl5aDreqWYJGISAerJZQrXc8w5P9zOvfhJtS8dyqHYU8kIJkGWFhyOs9+C8I3kUmp7QSuxt1MDE/q5177uCal1rVjffbLYxC07xSUw6ErSa/DyDCUDmNO3K/ac6hdf3kBQ5JjnOAKC7cQixft36T/tZzaSGkOl8d79jEjwMwQcTQU6aXP7X4nyAIeE0CemH7/z1mSis3cUCVM3axFYzfpdhVJ7S7SA0/t6nxFaI7DPQ7Pjy+SUY76NcNZh9LWezwAuAX1URBSRk1HZ113cwdqvmusBwQ+15rU9nvevXc5HGXucZzcPH3HdwbcF19KVOslWQg0btsnQh0ck8ul4vH47OL1TyINt29IGYTwXtv0gnNJkbJoh20KvWo4fZ9LzeslVYI72M0Cm0ZMAnie+ymDbfgCx+2/dwb+cm0G2cqB6MRRFqSQ4HtfKuqiQsJhAAdW2ZSJXcK6cJm9TAayvunu1BP0G6S7HPoF4oXmOjMPUAt85TlUIfW8ll9vCpvjECsk9Q+Dy4XpjdCFJC26+BtFfOEPbJKWrmZLKoFk0lpixAF+/2a4xE2QzYWr6CNw6h0QWDOe/bQWbgz9nHjMu54jPijgzbzJuYZ2cK6PCI4oLos5r47DKcvz88foDvvssi4TfObSLNfwvwFApYqNJuCd6aBjMWDWEgTurp1pqYYdcKa6OnZJu7TEJNb0DayPiCyW6CF3NY8gwFhD5q5h5uhezc3tyCVAeYqWiEpeEndHFVWmE+gMpSJ8I4K2hcqbGWWmrzX4kDw0VuGv5ptxlKJ8oS/yxAa7mfHfGvxYLLjO9k3NoIFY3rxptMJ6aHEOaYGbLprIdOOJD/uVoaof13+tg71j+jAeRB7W+ob7OGwYt1s0E7MpZaAs0+lp0Td8I3387vymC77wYQW2TK2aU7QUXygsGyjDuuxt/KwwzqX6NXzslmBazJQSIZ5gKZKKFol/xhhVVXTHyATMs+6iHgYt7ROKxphl1dZDxw8hNNgd/8RuipfOKRHcPjEeLfOQ9cq3IVElSbQE6zEOa7uVIQj0uphPvhAoCbIs/h73/UmXWvgKnjKIhCuLwU5/XgLWt48Co2/CiOsPPUbsGED7GiJy43S4pbrBLwFrn4npRI7OJqmNkFR+q1POHopTgn2b2IogjcJJ5aOYV5YyGi5aPJbjtmNgdZtCp2NxpblNttoeiw5hW+xl5fOxU501H6pVxeOm8NH/cy88lmLxESXm2dZ8ibUbYVezcxxFcCV6iNGx4voZ4b+E6vWVkkiQsxB4X2WBSZhZWBA/8dmojfIgq2Y9cVHqGC5RT2cYZ3kIxgtM3XyOQm8Gsdno6Bx5vxa+FV67Gklx3f5uQlMrnQ69x3nu+hncrZY8UqPZ6YuIHEJEYlcU+bRUR0ioxPMrqjBxvTUr977MxMplfSRC8IxjeGejA7lLUJDbaK2Q7GVGBS0sStQEcdTK8mhO0IaOxfI//lvYUIA9JL4zRs9PrHAQ1Wez8pswRbDLq9uLRY22uhjxpsPhXR9IagVxOsr8ll1/wlWkGY6beYW7ZedaZ7BL5KbSq9m0Uz+4JmcSnTnfqASgj+E3/YAUSHcD+S9+xxx5A7E9+DctDg3rwFj6TUVZk5PTQL/a+IkXgNVf+eDUEPAxqYdunkOa3Wk3zVmZ6tVQaWDvI/2hj6quNTOWt2dcpmR3w6CVww1wd2Plyab6avqcf2lKGabnj3UdY/7J+07uS1D2tloROUb+IPQ8YrdyQXA1thSXxTpbs+jF0+7SUT4hBvWbxrQcMRFyd7hHNH7GPI89RcE6wrzWQQI8gdUDK1rX21AHF8iu+QOeeaJErwMMZ9LVeKax3WCF+DM2T+yBa8tBn0IP9Tkuu0DoNHjIOdmhhmS8CGlmpan8J3xq4hvrZoHLpKmnK+I7gM3aLbL7kxipllVGiL7tmWaLwbfTU0tDHglo4f5SqyFIjuKfbJn7mxX6pOG+q3DMdcNYLPvGr5cK5aRwzBQBlzKJRMVpB/vWV+T4OFVkxD+XWGbZUF11RQ56UX29aMjVYHrbZFyfqWuL1+kvUBZHviMoxuW6bg8pIrJY+++hgLCp7f5+c9+4uFAzPUqWt1kezcCkqP91F183VdtIkcpGtkOXx/gNdpXqPsIe+8tgbxMgdVdfVcRuSVHG1Eb7L5m0tWXVlv7FfY8penqkjlgC6HMWXRLdA7MfWxbkT5sVIu9nrqajyPLd0fT2vI/TirPRwsmy1p+7BtpzbfaD+zXnuFbvjOHDr1XZGBcdH/LuD8fyoqHKzcmEGWBFnNuFbBlJbP6LVPZYsUepN2kwsOHH3XDXfXLgCsTdbiWhfFq0BSr4aJrBOHTZamvr17MCm4F6DJK9IJ0Vo6vVlnnNl69USi1cE2Zkh6bfxUC6jvuweQ6pEQ0uxSMKrZ/rkMSi2lu1Zo6nlb/DZD8ZrTWKr5HC0vVUH7cgKX0Wl4w9e/xOExyQUkNxwEgWZPTp2CR5opK2FfhD1ocq3G0B91bqUbl8DrNVVHKZ3Il8euUv3mbKB7ee8Mcq2g6SsCUBJ59WzwVi5cUJGVDBfKf7UHQKQUjx4mOTRKAXiXw93zCP6rcGZFz0A8HmSEDWxUqlEnKnPXgvej8qqOX/8aGuaGX38fbaVDE+d2Apk7qJARbmPyFa5W6hm0o727pgQ1rHadEU7Z/ccHJBPDKC5nU22UT5epc3d/0m3wNfbkvjVW3yvRl0LeMmddJUdjMo9aLATYrxTVz4+PowIF250D1bl2eoMptyUdt1PXvhAm4+KSThewubqeh89gmztWzMcm+9DIg2rxOUftj2pFtmUnX06y9Wrb2dC34RRTjSHU7rUE82EYsXlXY0ykD4lGU0/8P/dHPFjVXSeOxfO7stJ15LqkodBxntD9lvbxFNa1lix/FVhwPVosK2H96wxtJAKbhvpphd04UzlJs0Hna5o38qng7T5A0Ysb0gwZcm+Ydthb4+fNnyVFX6d9cw3aCp/E+ig0kxm5qvFoTkW7YfKaq5TYxzX4OhevuujNcmf0mE9sTcowaZ15i68TToZHxvLSwjkXNh9ECLmCIhNlCibMs5tI3bQWbO0Yc/cY+uxKTAnTR7u27dqa9L4QdRJ2U4kFZDxcGuIa47bR8MrFIP1TTPbVZ0khdtGmEcW96UNWmPjEmycsKYFhV/sjA07nlNjhxGkamnvFbLr/PQo3gvs1MuBBJl/ApzFbeCadrYPft2uUSnpeMPB6OwUwSCesKijdnMH5l1XTZGhcgOgfkw6NWg6LGljmiCE+DTxHAj8rU0Z4olmEXWI0RoS37fVLtek0Dhngm3kyPnxUQ3dSAQEtQGO6jPQaWTx85MPDH1upLWDdvp7rB08Qv9dWeSWz5MW5t5C/ERXAJe1VUzhFI77r52Q5sOSj+4tZd9hsochERSieIHiOoZFyyJbZ97ogHUytSa8ox8UJa8hWqYH9Gqrq1d5CkS9UrI+jQlnewIW+/hqeGO305/OerQKKo761g79/oTnAvAhY0BZ/OSbD5BqcbpPj6LMzEorQb+NBsnHaCGNDHQ5dNfzPPk2UC1wKDu3pVh9PaupkzlbqTqJCoGQbwTU7Ry+ARgzEkaD6oLtoe4dQhlRIjmWKNpxyVa08pXakJZvg7vwMSS8vGfGdQjugCitQH7oVhG4BSx6/XRU7wf3kwc4fPcpCVpGC1q+lzQyxNoEbg3ujyNU6wDDMPdEJ3dJyXCBh1E5N0Bz4E/F3G0NXaYZu/LvvFubraCRvV6RMFnai2XAteiykUy333BqM5xtM4newMlFhoii0mjDq8n13Clf/fIAIZrza9WeOaCd4EfgeJTkyFFODr3249E4YtzS/GEW3utsglR0LzL9L+toG5M4hRQCLPxfvFsuUiOAk39011rRvSFD52AMwjfIZai4FON8dYhq6IYGY8wZ03xLYNCB+p3fx1VLeHSdJ5ptoeS+CxmSP/fTt1N6J4UVB7F7wZ70s4blw0s1NS+7aqFBAPYawA6MlMlo/1x3sMmYm5va72gEfY/UW6regmWANjpGFR0Vdj/kXhrQUJ2Svb8Fqjr6Ndd3xni33Ux6zH6+OK3i+/u340QFpmskRayJWcAx7jJO2nIul2EIJFZbUVU9GRHnXKtwfTYCAqKpt6s2YRy4qeRTSOrOFIDOrmjpwIDD1kskLNpaQjnqFR1L+TSTEdC7MDiNJsQUdWXoM4Ke1iZjhX5PGKwayQvNcG0/v/xnE5OefuY2WSxKlcO13wuJ87UfhSI280nfk0FSuKVHidWl0HPgyDvvN/PE7mA5IwWItSaahtydOLfyq66iybkbpfr070ef8JbV74Q9F7VTNzp01qOlwtJXnRz9t4IPkG6vjlXmb6zndMPcD8073j64SCGUeZCghKM36c7nqh4+RO/PaoYTAk15DmcLsxnHgp1z+Ly035jpDmKcR4KdpLlVTtgmJUwe/lXrTs4Q+uaJ7zKpn3afOC1GEeREe17Gf726mYACqqs4ptszFyb75+NsCbGT8rj3io0mQouGHj1JJIYtvkYVwkr1XyUt/JeQBrw3A2Y+SgchSPKm/zTCIwzEX7yLFB7u8z9+V4b0tK6ErslbUB/tK+YxqmmE7ghuPsUcfG0ZG0pQb3Ae322n1NcdMPuYjLRJSFluTrKVvaxRBUON7zAEWmMCRRUB0+TmVw3N76nARcLYqGuuXxu8FgZZjS2WT7nseHkOY6akXi7iU9zVpHXgaEFOjBTOJeKsw3OHSsqCwk/F8X7u5bLGQ09X8SAO0lX5GCwkwzkrxoKqbUU1QxuH8NwCaETBPaDnnH1RlTmjOKKqYp31oxCOxxFuGsrxaXzt6jkUKktl3TBxrX71pm9mH9OVpEEeCXBKTjDOOUbqh6WSTT5gD8yTsVd3zxo/oYNsetMW+BxQ0W0EUB2fpeMl796FQwNcRYsi+pCoHlDtTRAS2AJLj1/iosKIqizsWc8OgobCo9C0OCV3Bl/3mL7g7seIq9xpJCHU8SudXsSoaT3U5Qk9JbOPX44AcxT5ELZ5KOyj4JTvIk8+KoXmSIr9XdPTAS55otF27lMF8pxE2tcT+eM7F4We05CAHRsS7tTOcXxOA4UoO3y02ZBUiv8kvsAEy44SkI9pUtBUU/trBYtpg7EfA4wetO32yH+XIY9E6AM8jxt05Zxh+V0tY0FrrLnw9hKPLG5XeJC/4yz7KZVD+K4vcat/fQsoXvuPNX5k5dVI98pcuHrJ5V8mdNuEW3417Wb5917EWg2UF1EyF8uGDPIWo6bO3LL5/buQYSWXTnE1xjZwwfiWNVR+mDvhzOHlt58ZT3/aE1S2islqvS168bFeNeMnmmbM4Amd4EzD/RIA0D8mV5BWTxSaoukzm+dL4NMXnb+o2zAXRj0jf+I8XX4F+zPROb0nrS/j39kGquhIsJKoimh8Roaoy9zK0eCOPVCtrmNyIgHKWtU2Q6rTnV/LpjMszN1OLtnetsowQatz2WDdvcxHMR5L2ke9+wbg2EG6V5unV+vDLlmm0KAfJcjqtZS+/NJPcE77AKDD6m77qR5C33tMRLDdg82m+EwP9Mvmn78louV4B3b24VHz2oua16QvwB5GaKD7qf+YNuHoevVpdhtutc2G/5IwyKnoPuZIB/SiQxidJApSI5qernka/aYhYqfX48tja+prX1k3Ea8qUNhVFV5HBndm75eufgE3MP8HWdWHt0ZgiFYTdbGf99Y86EeLeVhWXraClIfNIiYkOW33qrxRrb6VE30p9AgPgyGM4PEVa4/PnhE+1S78lR8SfZ7eZbJSQE+scUKfd9jduSrGIL3zG66lb9ovW+9CG7ln4rO7Zve1oDNqyi22eepNiC8OQawGNS0C/Rrn1/BgNz3f0/PZDrvRMq5n+2cd3daI9ynyyLt1C2l2VPpU7BpG1a4OrZev6GN9mRqlaXcqi65vrShXW2x7P3Ps3rjpFHIx+VvpbM7YZSdklrvJgvL8Y+NRB9j4+vdbdpQKnDXAuKvOhEOtEXAIkIyJhbBsvVs0B1HyUnEVug+edlhOexBlPv582LaKfNRvi6XmSGqURacLE4qvz4Txd/rnwTHJt6rstpe0S5+K+wvRbzShREygtK6s3vcGQmudsL8thyqh1HTVvyxAM35qn/XbdrL8tWMbqdaIWbH9lXyOl91RTDdd3xTpKa5cpARCb2hAg60oLb1BjK/H7sgOo7/yf3m8K/94hl09M/UovMof/bEvzBstDb7k6ssKNa5rDfir//FvuEoa69f57XalvIRnrKFGcGC+N+4C5WKM92bIZWwKqDe95umKYlrDXWVJZjj9mE4FUULp95DqpxAiBwzfWKsK8aQYybPEMfYSfQM1y8H1h/5EKNLXMHauFgx3jnm+KYb6dz+T19hM8PiCn8eGVfpBzKyduZ0u5QrgkrS5pGV8odPELPA58TtV+Grormli7jvFSPm4kDu/y1ythAijZMQuTARUX1u+GnfNutCX2gfr5XrkkArDQNbWYIZE7SM7AA6AAsmZvTVnvpCnTL3sG5GZjhqIZz7JIzQNGDKqNpIWm+1EFAUidSj7G673bZsk/JgIDPFFm6AItCYNujQD3vkVwyuDKfPBY/R+SkPc/I7wjB5fdV0kdF5hfhlngfEF+l1kAMzOYA75S4CqPI2BC/iofZ4UPKGECuHfQQPIS/jiy44Ty6TfUHkPd31t+ZIzXKte+onsFYEJ/WbsrdH786zNCxHPEj73pCxT/FJdh3sHI7kqUX3h5cxEi8Tz16v2JixjYH0mx3ODf01OOv6tznn4nAHDCZymXe9dVlc9lJL+JaG2sAEwOvW/Xi+AgJg/A0Rlffvo/1/b7dOhFdbOlmJxntPzWOyqBf9WRw52n3s5VxlSmM4or/NkTls4sDTVN4Vw63yAoGe3K9eUIptW/260elJ4CfvY30+beBw0tCbtqVJt3dlgPJHCQ0tiOsnGezSoxT5QBjWDN8xAtmAuLVYNWrAqUQyd7outQWPG6UF3BTHGdj6xDInaH3XaOXWVlqQWRBvWqXiPz6wYrDWmSKeCZfeHjiqK/0PyafBPQkZMREuEBYcXNqZnnsWM2MHVh8JK10rmIt2xn2vQn3zAVTLYn9tLDJvQlTnzwZ6OM8DuKNw5ODy2fJU7IMjk1Dy8WRyZGg8yj0eT1Rvqj9aEo5SwUMA3V9Ryoj7f+fKgirm5Jzqz50KxSt63dL3wZ3BTTeKwHpACeIT6AFD1/NSKcLqvWGJirVNa2HHFD336SzLEnB4tPyzcDMjd4p0krk7T+fR7dclh3OLQZoaQhUcbjLBd3Ef0Pgau95COlhVA+Dr68N1qqazKiZDK4Ly388EE/qvThRiq6/h3WC+Vo4gcyq/5LSAu6oRKf9zTxckoVZAhPjRyWfLNZTSBGqRtE3JEdr/VfldYLeDwFM1Y2K110Sh5CH1yKZf06OejNq6YOtd8zYxmvL7Ab3v3LrfJToAtc3v76XVCHsMpEa6A0dItPWkkuCE1YfhFr5wAiOD7tlrv4Gu8VFbV2R0IgLLV7zSXd9s+RxwTNRAaz1OpkJRNd/PS7bMSdfANnLUelaM+VqS0O6M/aVbPk3LSHYZaajFWIZvtBgSU8XHxqA+yJdthRO/1RcnFGuqucc9vXIF/Nea4hbXFK0y/17eWXb0OyU+Ol0K/cgiym2UYfLRBkR/Z1PgfnpbcRRIL3LIaMMxyIqQfHEoBopuC0RNa/8XXkEdrb/NbDmE2vNNOIzAvR/XiFbDPGEx7JZ/nGq8+nWPFFJCphjAC8j5HDVHgCpm+LSCqGVk/mV01c9pWT1CX8b45eZwO2yyS3/OVhIXXcJGlnZn1jI0yWyNh4Gi2FfNny9e0N3FDTDZBrV9KihNObpGmoF3DHHo0ZwB6P+lgvNloV3VYBNuRIVtZGLVh2M4YSUDDHMuZ31NdqpslDka3kDbvhUXSzATb17j078DMykWHJNgSWWtf+2vSLEKk3TTmW4FdDRHLWs8mspKCvkjk1Zd1h3OjnoY8BjT5f80pAilmAMMxpk7Wm5tlO6mNRLbGXOa8BdeLFx67H5Z3p8YTjPiOul8hZZUTl9BT3Ib+mlcPAMQQp9F5NzOTrGyoEZ2tQOMvBqQQyHv8lh7Zemo2d0uu2xkPvdc0JxsBdthyEcUe+PAKQ6L7FNkFRW01NeUNE9QB+sI05vGLPbT6ZR4BKaP6OoTRveEhOXfSnCikR/TbwQzgfg7EQZixLIkdlg5poyy3Zv+Hz0Hgfywa67CVuMD75b+ugifGx3gAmncCztJo8tuX2B+vWYmsxiGZEKTDld3WQ0ez9obZGJdvixcmnFoZZRaX0ncfbj6ScjPXXKPmvXYrv6gyfgRxuPYfpDHIEBlX9YurGPqL3tOaIw9gOYqzgbXJ+E/DSv4G5yFDuQF1eNzBaF1dfZRr2OKbkaaxLNxNs2PmSjf5dpvpDFXu6TqLRDAmEnXBiv8zl9FJzgE+WWVmD9IkQMEdsvR0Jdfx2VPLtK4fnVmXoGn7i7eT5y0WHgbAvvLlfW3CGMD5dlvJ3jF7af71bxLIBStlUXdWSsIVgRSWxzOm82ItHu7nDAJHP7Rlv2GEY3F2yTpwMzAJpJHIUmWe4hHijhOICY/NaDZ7OVlGOovpm1WHIzW75hmcfyu+w5P9em6WNPRcJqJeJOqVLkHMQlVaS0qEkB+y8cvgf/CG6vqwVjsHpWaZXV9OyJx+cUpujh385svq+q9xQSLcKcSHxDcxDlOaX3Op4x9BKku8AUr8nJvSymglqtzqcnfiJxjXdxDggYrVrjoKwLcppWEPxLIQgDbV/O5W/1AKWObNJ7VewzLwShXs6q9uJ2PizbF6k1TsYiOq/S84o6Z4ODL46y+dtGf+9rNB4h625K+MM5Y9GfI8KNXl2ZxogXLAVnfEnQ6bFgZFfuGmgyUVzKbc+5ra2jWe5ueQTSonH8W4nw0Zv4/49uWQrP7bA6twmlWTPCvX87L/ydgZ+LtaFQqwZI7LY/ygPeLMjlhiLVOArLcJ4gBM39CIhiH8Vo8zrRpJwDcKnQ2BpLAQJDBXT86Rc/0yFTIYiBCprJDkJXkUpa+kHsNy93FPukVvYCyRJKWwK+NiJAY6MyJnfdxqUJgnPMUF04qLCrYARlozlnSzxDyxdPLii2Ka870ODDCRqyHk/83bjMCLcYdDwyYyLjO90Uzz/lTJyYjMnVAmPbE9gbQp+z/8JmA0h6AhvUoMqbmDq+0FvBfO7l5xt4jThMckAY9MZyXMvRvsov0c+qDZPu2OFCGJNanoHWoh7rtOm7aSRcJiTUSOQ2iuvnb8JohSSKzHnIM0Jol9FxD1SwesZ0QY3umGROX4/xOSSWigvbL0Wiw+DWZL4i9JY6J1fCDEpzOaPVogQLn08Cz3F4PcDfHahRRDQvbAWa4ztsVvjqYp7VkB09pnsUzUjBu6bPzzMZszC+CwiFIKRqYIa+LF5SU+XrxItqKt16ChmL54jw5XHlhvareaOlkL/zlTJZDJbQzsdww/iTyLliAVzh0IgHICo1bZBf7glAfadI3iPrvCqcVhxUxQ4dGJ4uyYBeD7R/hhP4Dc0WaVl/JrgP5klPXStAgFOPOH//OY4CoxNYnLIvRDerhWuL4CPRO/SfMmROmrT5t8JazeoTR3eJa9cobdnIN+DeUi05XZ+wRTot8JSPG6Z/8edwqa8MU2NOhvuvS19v7tVm3PnX5VmwAJYvGF7vKjwG1M0cL/nQ4fAtYzhi5umLx73ebHMfchRfSbBPWNcTXgFKtdE6qS1pKP1d2wB8ih3P0RZawXrtY6Nx1cgFdaou9/opseHcczYfLK97a+cy714eDHKClOhpRmgCliVbNLgA8CJWD4rWwwLbdfsMFsk7On87sZxZdkraoJ0ZLB/rRR7uLnchivhdUzJrDPFx1tIwW+aR9Daz0GF7P95y7iXMiL2FFqyvtsarLCKIjM9NP4rUe4amq9nKkTWQjcR/Aj0G1KiTmOQnft8+uY9DcdIZimZAkRLwYch37KvPcdQ02gXvgzK93eEsrWeg5m3eSXKb063xhLylXixAZssr/+jZtxBqrVhpZ+8/ZpWt1FMGh3WTNe+X+s/+Z38SczL/gwjNd0cmKjV9I/8rTaQPczc4tLyGfdENao1J9C6LoWNlf2zx9ZMuXVbxB+X66I5LFYoWm9xICPctbgmI1mhJsjW5VsM8mseNe/m1EdI1F3CwbW5e4LgqSk1TxZN3+eNOxD9UvHDdy9wdZS4TLmen+tgL2LMX8VXBvu1cUswBa/Eo1uc3Jk4ZUTBXbl41csqtRdSs/h2QX6VOkSCo3ID0tu6IA413pramBpn+USzXmZzSVQDcuVPRvzqLpDCIl5mDjKeok2wwIPeBJ6kG2fHRjvyDLvBn9hyqJ1Zhs0H7ok6EmF1/Bjxe79Tyf+xw3iM4qGVP6kRxevGNUWZF/gppg64RvfUjqcZP81Z3gGGemt6DCYgoTEk6iq0bT8rDVj/mRvB3h8s70f6HTzadbxImPdAcUZkm6JxCduwXoObS3mASzCV+m2u68cl6oKH/eJjtlJLovCygYGA7Pgrc+cpEAhqe1pBPNHoh+SosfguvyKCvl9AChunuzaQlBpwYclgomlGtR+LEQK7710Bw0/K9Fnm/u/onasLdvRyw8FaEdVH5OxM6tkYtjHHB3PRxY5Wd2QDBy2uW+2CU9ns3gCeBEBRgu2+IN1eyMLSjdDzZ4rEXOnBKGXXKsVAl3VH6AHq12GGzFqAoUvuQScOl3a/Zow6OIQGWM7JuegDz8Y4KarE/hLrtFWL9ar+eIrdHtVVvFcmN6vAd2gFEpmepuahsTfs7gQH8aEJfqgcNTptAF22AVg5b+rw2j4SKutpkogC5swV7yzB+RIRYhN9DuYPpK3tZ88Y66oDZi21QpsxRz4YKHzc4dA9sCosCOu7cLgRLLbRC/aJ/sIfceJXI+299VsMZxdZvNtCIoJ13SEnHvHi6LeeGEaqqc1DUBF4kBO5keqWWBbConucrMOu0W42uCR3VzM8Dh6Z8mEqHcS+eBRtN7KjBBQCHGInIheC03BldNvjP3xjUfMTo9FbeFTuxPOz0nm1sB+LZBaC+wv5rd9LZi+Ij3mElgrxHysZ4ChdmigZ7Wvm0OjtQaURi1Q//dCNl0rUnvNbAhQZ4B67uqo9XwZgzjsWYAHNU8gXmE2HOwGlM6veMd7RZ+KQyGnrgKFy/KOE2MnXxMwHcDBuyRRGVo3/t68aVed7w/wPPJXSA2PGXWPwcqFVoN0bkjGLav9IiQfafrTCBYgHPWW7hFLopdLaN4xdU7yMl2BCk0gFu6+Eau3m2BCHAYg29aVJgjelw0BpVEAPXn0EqBgMwBgkYOkpilK9Vt2qfp4wEFvXEBxn3D4sQfZsAK9vBrD98jb7A6s5jqd19fgriNSJsLw0CsRlzRWp7S6f4HqEpXqyjNlkE9XB/J3Wc1zyLuoT0tDYgT72tNjIfwGRhu3e8LNm3DMXsCOjNGw+m9n75dG8WsNw4m+dZXkWEOSe3P654vAMCyRuyUKaWJ1AzTFvQQcPmVi7oaXqhRHbZJ72UB3Ci4EB2SXpBHWV1XkiJHZvh/Mr98o+OYAGlbyRpQaI1hwzS1Nqfr9DJK/RwRe3L2Tv40ZJ1A7ff5tSkTP4OrZ/AXTXwJiMwpTamPFfZeXZhn5sxNS0HJRxWStnlT0zSiO0a1dyX2f451c5nWsJoxlZ/yO0g3g9lwSeaMgyEbJNZj0awSB4Eh4CVA6e1bizrYSX5QaNxHI9klcqYHnH4o+1JzVRtOl0X6Jh+EFYmE+On+ApviNFhS1RowTW0gDEk3fDJrr4Uw81RC6+OGW7mcympCHFCOOkliyfQOG0OJJSuyBzI9d54ewCML93v56TIO2rJCjWzgHGT/n1kFiq4xamVNWLmWkt/zkje9dHpyn6xP4mPZbv/mzeR8FovDk66Cq+JML/i5hPZwlzKQ5OpoYVf7DR0O7nhVOlkG3pQWu4c2bWe/bTRL8Hbog9rIicZZYn2e1TrRto4QKCqaN6KktR8P62cON/dAC/GJQY1FjO7+weKRUOUszPGrbNyFtcTwsGYk7F26hmw3uhCXRxsR6ZYRsn8Obrw4JbEmiTuqSM+fP6w8FyhCeAXsq9umC+ubq4NFT642+EqIj/IcYWR5jywsXwVvToaziDgRfLOJ82WArNijDXoN6fyE9xPHVSnLI6/g6EjDPb9ruWuRbZ7Pk7RZSAZ1rdxS9u/EI6WWnsu+zjz8xRgcuXaPSBRAW10rQAEsc2sn9zCs03Yur1jRjLHLZGeAHD3Fkreg0jTa8gZFJ80mMnOz0VfU+hqkYmJwq+3TayhQiuu0nzSMpAnxn3tMpnpgk9hlECIPWnDPB03iEyIeT3yCfBepp39ro/AfAf5mnFK7wR+OPRAYCkXoFvV3U8Ol9arSVVxGaR3POXYjBF1jXkCZI6lRet7m8nr/j1VQPAgGVcasX4rmKAi4mz6QgZ8WlY6b1d34UQ9iQRX6hSQKRz5G8pzVTGwuw9flHfr3wPOEwEY5bzGQBV/QvBQ6PghZ4UR/O9LwReSRD0B4/wLkRKPagRdjsCiGxD+Id3/lSzI88ZQ8lQqKK7p+9r6jcr8VxEXB8OMcPKxQiQlByNhscEc9LPyTH7d+NmCrqw9YcsivaaLC4oy6aRpF9Cg3+AsvnIbSScjQrVyUztRzeqS8vZBgvylv0/h4pRDon+Kf7abt76wibYGHsHgw/8MpaETwFFkKKk5qgl3Zqj0XPHGxMjknqUoOAOpmtTwsjxgj0+C8BqlTSt4lgowgDhmtqIdd2WoTOP3RLNu/PxzaD6qoxjpTMlT5CPDAfxG45a7E5YL//uReKS4w/izTijEyebzfuqIzVt8B6LqWOVIGz+H2FBwQAtmuPuujPvrIlfUY7Um3Hk3RkblgGGeaxTaAblvKBqz35RoxF3XcJdsjPt+St7ryyM7B7ybhNNW5ulgLaPjgSfCgDJ18ODWA8/WFz9IzQCowZuD+6j0eXdr8xuUX/Vu4yFr4b9bvOd3Yilm57UPKcv0MHTXaKIXpVsgHaWFrOBop6sBpQR3yKJWl1jcGGSXio/p7WQAPh0P0HXCeXpWbEScLSC2kSWAzxe2kWGqFNznmmVV0Rxk3N8ZMgT3/EKjCNwwqQ/h4cUsPPjgUamBKHDl0MfaJudKcSe4YqzKCH6BQvLL7J08nKkZ68/MLuIRb/ZHQU6skuGif0qjflgsWvtTVqwVBwZwe69x5oW4DWN1LN7DdqdkqMxqtqldQ5g7NkJUBihjY8WOxSI/kDLv2qL8tf45cKGZrSTGg8tmN9DPkgga0URcFp/kXF9NF8NqSDQ0iV5ACofIxdhGxMfOST5vPbO1jDjrjRfBaM5IJRabCDG0+peP4CateD0cTFOwRJs+zV3zU3/C/wMcrwNM8toVThPHKyTM6bKL3AwmCzUuXdimx3syb/0E7JTM0vAR8aTQDgTxizRenasqNlv34Rhn3nvnXa9rT0N6d5Y4C+kTCEwGwmtsTCPnRD43SX5/JEOPWQTZY0HRC54Xssgzn08G08zOdDZ6rbu+qsppp4EWBUm4to0nd0JgMBKlZ9LY/LlsNlykAEbkqEvKmeWNIpQ69YUaT/x+hZusWcTYXbsQMiCFwMoyazhDYbwOVjONwDFiZAFTGU4AE08WUD5R5kk0Srxzvy0Vw6U2qHg0mTQVGD/TDZTC2Anzo/HvkEtRrX0G3q8TFxgzBzWv6FFvuhocJd585jF1asIe5E/npYiDx0kAD57tivTYE57lX1y+5QlTRla/q8XtTQu1pGfGovh2g5Z4MyVSsGcjb5/NC1gsrgB9umAURNOJQ1qGknpT97MYyXPQ9PuShTLih3cNePS8tI0xP495tjRatdudPE/3kPx6jO9QwHuB95uXepY42oYsQvsR62kN2oMFQY9JalC1zrA+0XLFV7l89fc/yHSS9dT8F5ipzDEZ6loqwW9N9imU7H4vZi3nqdwhsESSs+LP8QvmNoH7gyMnzBn/kv26LgVRU9tHVwNJHWYH20SCBCLRd8texyFqfwg/oBRYX8wa2hKh4D30W9n55su/Qryvh+GsDMHclnvmznmq3qus+/SUQoLhDgUb3bYXObNAEhUIOewVAmFIp+2NPN/9UVgLZln6u5pLIi9G+d4Cyz1lO0S3qJGvaBJ78zK8As2kprodQS4xEaII1CqvQs/vVH4ePqDrVcIH7Retgas0i9++JReQH5gNqln4bJpj9jUDrsZKXyBstTA8F5BLrRh4sIdtGLo/MjWrZ3khCUqs5eoIJUu25R774GW4twC5Ly0ZsptlFUbJUS1ZLlF9RZofJ63hLCoiiN2cThVm+EZ+IleOndZz3MgMlHOhTSu4v7TsJ4wYtj53g/Hc4NkH3lAU1sR3wfN5lEbnmjH1ZbyfYo3jlRCf3SInbSQPdRGfVBZ/IFZRLzPsp6KEweOeujFeP41JM5sMvztaV//kC/QRiLsoMLtVjb94sUug+WdFO4+Nd1J5CedbtgI2QOBdaxAZWiUj7F/663hox2lqhvLXkQaIOR+B/n1i5MPgXCGCAQ2MWXLRpPVXidJ+28dhKLa0pGoodZunnaxV9NsyMGcThVc4AU6TACtLPOq3khp+0wNSr5KyACj6E+225PZGOCesIONSviLPP0sq1cXFb2OrvHamRqX1TG+LxGMgDPjHjd9+O2r2dI0+vFCRGdyoiDLelRaTRlD6n5Jmy6e6BdYMFx6wHOcmGRj2RS3tBCgk63lFlFDuwIj7FhchXympBBjMxaoxLg6AuVuChwcGjTl5KoKLbmVZ9zMS7W7b4pgmE1gKzhI3uYluRvzi3wT0eg8vincDjZpkPh4yndMXr17NJGTutueT0bsRmOmLCcpXo8BMm7G0+4pr5/niey8psyCtBaM5KEsAshQgxtI7TER/wSYEf07MC2+TG52fLRLGzVbx5HsLZXaJh+gvzE6GlvFQYrW2x2KLFQBfYjehv0Auw0XKswFc3GwkLddy0tq/DiHB2ELZzNviYCqwCoOTc45nwi57cFc4/D2K4tghZB5UDmLX8eTq/aJznS9ki8SrWthsu9lq9/kgm99FBtltV8GgUnwgzRYAs6FsTSlCkGYOIa4FbQt27eg18WzM7u4NTZog2ow3ieZLrMPplIn6sbzT9rr3KC0/ZR/xEYmpYwZxb80eSXu0HKWBSFNisCPtXCYHLjCIxtpFUyDqLv4J0qkoAksWTGa/iJYd21uhdkDGEi+q17al2A7+x7DCe5JL50wZEZ2EZsO7LOw3ldRCREV3ezh6DJdOHmMp7n7JU7c1euZ/AMfvAffUf9UrPYWb1Dl8RsP271sxdXFy3BokYdMf46j/7brCHq1DKy74OFi92+zdJuzHKKhKWqFHJ1xn3SFx/0h5Wjn9Xbul2I3xluBHYvNXY6mdh3jOaNbjhSxatD88Qps0Y5w0ur8OjhWHXrPFGRe/XU9bhWdnG3DjxOHsxt5U/JXzkmT/5VPaLawqXySbHoh9H2xMAsljTyxh93O0V/yMvz2LgwU1vrONLPz2DopOdtWCpHE2LwAvLGUhkf+CYu1qWhG4hyN0WpHejKYEhcl0hoIsZfTBF6kN4G65IZNACrjnnO7khOk+YlkAcGQvkEFRG1myS/2MOYZjL390BbSHrH0KkhwUfv3W09S+S9zoMEWOTUQMI3sjDbEpUuoMUI6B74romH2jC95xf1/0UT71RNjuIHw+jIGfHA0dkFUYfXd+EhjF65j7dxtiduHUbIh6wL7VVRXsXlUIQV0LDT69cFGv6HrmO6Ge7v236RHjAiD7sE+63qEg4OqmHJxq6eQwL08iZSbkSD9xh0wEvFFExu+bMOdxB+B3jwEp/Xw3MqqlhWqh9rtQnrlZ2uy6C3rd3CIj7+5dpQNOcfS11nALq5ttMpeow2bws5rd49lmTAWSAtFVM5GWB8fRn3falKcXYELkfF1T3wqJnwJGihlvnbEtx/8s007pA3i+dPoIsAWrhBGdH1vAi7tx0CBquXJ3dVDRuHttrSDaMq1i0dltnwEeD0EcPigM7TrWO8fLMgequdoxHLud4cpp1FxQK7zozcK8PRJdvPI6tJlAZhFd6SvHisR0879F3idi/GXm7BGuDHFILr/Axjh1rNvAYvh5ZVuVSZo16GF6wf5bsZNqGgjUkQtRNUucnzyJBPrWxznWFhI1/VhueMdP/7ypr2VCXsVnFQLMkRxNbwSXX5blgS3vItuQiQc1v8qNF5AQbAFtOaoZDfZBi3k/rIfPK16LgTORbS2iPLavEjVJGvyyXxVf0E+5tP+R5cqt668C/+/2whwL3MnD1f0jYN1lljpyEIzcW7wXxyeFezZh9MGlmIqhZWiNQkHueptf0TWHfEwfCkuZ/WCi+743z9+FfGCDPPpjI4p1cBPYxOrRvgyb8lfWYY/d/WcYejkM//nLlVlHPBQDBBwfV9IjmddThn+mC9lRQ1W2PSGHEXoMjoV8IgpjuEzlOYVRm95VfZXXVhDqFSGwh/VERU0Tbc1ysqKsIurZd07l5TWzRm4znu3J8B13yRawNumbOcs+257JzIXLPHyFdyIl2HbYpfIfgYMjaaO0iuOhEVXNz693wIqKiTUWKu/NmuDorZhtARJuDxXeEq4i2xosfDZ+VsDHS8O1GIRTuDa/EmTwgGDRuBq3onSnbHkru0zSeUx/TeuhvBsnsloTPj3jme9wRcqOUBTMZLeX9y5O8UQLhy893T3Gox3RIeTOIciZ+0wlU0ux5aqjPi61DE5t8YC9XRGKZn2wXKWbb7aK4GITH1gYSTU8Lur5NzQ8MPRhTFUVTSIZcwf3WtvDufPRwyJtk87Xv6zPNfCIzAtvxrgHIPAsKSkiXsn09zhTa9OveDC0KT+xqY0jjfjEHHeOhc2XZmKRoR35BOCen5QrPQAPQZIq29YhrmfRsCWampU1hd2x1vZaRmRK3YvOLZPiqhKx/2A4nr/Znm3T8iZMW3OIbC4m2IFtWtokYtvBcU4fkjTuMg4S1Hoy8rtGpbIIHh4FJ+3EKXvB/pcIYp7Is+nTIbQW1+BCOsbPVs0Xyv/+J8m6OkbpiOVBJtl6hIDerTtuYM/L05ki6VHaTVtiTO+YU+XCYtKJRpUUkBvUTOq1NDpuYjuAn5Ol/GOSvebPVPkSjwIrrn9Vo9bZ3TAKJcDuo2ehopHe3YPTXqn2eT4jYhhtFud3iX6q1+l+brlNtWLOYdzmbm1EgeYfibHYWLKQP1F75bgydxXsBaJ1f0mRWtLBDS/8QyWtnA1RfxDV7326BV8Ky32yoEjhR3dgHjkH53xywPRQ9hY8pj+R5R0Isz4dnVOcvynuXMvbZ93l0IHjbogKaioSAwSMg3yLhIsvT59qnqFqp24mn1J4BmIqnNsxtfeIHHcNCVZ9tVGin5ELanyv0cx87+VCtKe9wDqTKlTfIieby/x5khMTOvPbOQ/OYfFevpG28MdkKk4mn8AZJfHCZ47E1XQgLeqqkolIxCnKaCFkYzLecnaf1YlekOUmA5+lHQlUvBFWVMiuLldWguOoblS7kRbQqUVnQPPr6gsnyQRdOBlOSGW2+ZEa7Z8eFaFOY6yy1f3UYklQ9FZLTR3yPboJrXf/PjFu9DlN4EGtsT4en5Od8lL+5ensxs1LHl+2GLe8joWPknoh3nbNKpWkbyZlUrStAT0k8lusHcXVIlA81pOE8945cDZ45ncFU6b/RmfF43jBXNSzHfdd9h6HmjreoRUgThDXi0ZAX7v7KFflvY3APIPHJp5GpSLT/84LTnhFUJbnaG/dlkHDl5ven31xKYXIzwLIn70N3gMXJnBEOytOG3h+53Bs3LUMzrt0D6ttRJZ2G06RV/HACwV578LUTyYG8NdgkXh4aA0kCZg6XHu61V6ZNkqRwPEQ30AAPge+SeZrABso58cpmpRs30bsJDI9DucDBY0jFrWU2mjAL9jUxmXLIl18w3B4eIt0yI1qXVtfNEEtC75fV0SrZQpW4TGIkUskF6f27mVCJm3nYCAycS+/Qan6SG7uwDXOIn9r8pXRO++S1xxCzVdPdIoYSPZwOAjdJAqhJ9qvDKv6xiPckclWW1A7Qobht4xAskmG2Abb8Xi1RlNzlFq326xdkZBvKGoWoMONCj325uQ1Xx26Bti+zTDpw/yoJ/PUbm/Wk0waMS7xdKLxqDSG0iqiX4dKQEsWkoZBT7fHsrWRZBQu4D6mbAQlcfydpuJejuxz+0GWiuaazfHQG6kpmu9XWjRJNm1zmIfIF8dAWpZ7RRY4uCbB/OTvxc9ltRLFWLs+AjGLIevSBpxXE/yySdsbyeWbSjcnbm7M52s19AMccIMRsj/DOk11fAwFKlpUTtITiQZc1llfQnYHKalmHQnF2U8FgnOmWZ2+TuThi7hadPHyj+OOA0PC1lmwTLv4D9eH6wHmVHiusbjMrQ53qsk0iWgeUh9H1NpB46+34g6W6Y1HHCVM0KDwPNXKkKJX8Hy1RRlXkVabi9rtsq7oTYdWYStHzWNGnIEINF7LKwOsuAvPuj8SBMphuPn9vgpGOgBYjoM6H0Ua8WD0IhIEB5Rfhf6OViQ4PTSYDfnFamiHoztirh5Uh+Oh/y1xyECQv8IW+i9G3mPLmN5ZO0fWTRit2XzpeN4pJC9OOInI0mQLlk52ajS5o4odHed1ZS6a7lg+8IXpio6s1WSe0pOwtiXzcEbNx8IsrUokICWS3SiKnuLvnm4ZYCwrUO6THjsuH0f+esbxCpgxfOd6M7/JWNaywQGdGlN0lJldsB/A4/0DHyOrTV6Q3+NvAPGgb441IPXlP3SV0/RcSCgwVMlkJTGm5DZSuGgSadhhUzix4/batpXX+R5QNAcfi7dc+Fl1Q9TfGayqUUh6ak9Mymp5F3LLsz1mHw+ZvAyH2zsx3ewWSB46NxKZ9b681rquE6zWRTv1uC91IAiXc2Bo5T2LgFq27S/Aq6+vcNQgTFtLvylaGdi9G/2Y/1r29moKqf9rklo83m5uRdTFRQymbQT9OCbgdrigNGkS5Jkg4XXBw5oSrbtAfIyzhgz/l3/MG7fI8C3wIUd82TwTDhU1gdgD3iexU6EqKVeWf1yRVAbsu5K7UsgmkSBvF9qv0nOMDfY5OoHVDxeMItNFCBH8GpJsovqCT1b03jNTFqHOxMTNv/mUi6SK0+iZ/D6Po1mlIvcewSRxKpj1UlDcy4nb3OPGLjihYlvNfHae7S0Dg6rvfd2AZFKw1JUaj25DolUxKcLOsLLzBgOroeDg3DL8PzfheFaDvgOhEJnDkckGTbZM2gGJR+oGdbiNmkI8sSToBY1f3DoY63DBZsMhlRplRqrDtCpY9FHc0jLjGSldfLjT0Yiu+FonaK611ZjkfeIO2u18+o49Vl63clYREZRp1f82ccein4zqq+brQxYj84va3A6+PYZtbJc5pCqZ6SSToZqhkG+dL3aHFvAJM2FrGLDWgqoNdrtKxLaVcqG2icF2HiNPjHpprwChDfCpYrT30aqhnVtlywVxSYOhxrIY1qsAZBooIGWc4Xidt00OnipR32gN3xQjUzoP6dEUsxYDOiF7siY11TskYqmuIMk3uvlbFO1QcTgpC0eNgSTn2VoYJokWZn2njzsD6DuM0/LjG6lRahtW48aWsPhRC3a5mPdZkf+pvkqpoOI1sekNWino+FPO2M36fSsY3/G4kOgq0vLTOEADOEjDtiC/V0FbNw3kxpp6YFSbyr2kKPi87i0hrst5ujb77oZCUPBvCGF40+WoIDRb1Ls3u4LWkyvNBL6SlHOtJGSgi4IqGY6UrRkSH9YJdW2sbWtaVHDnhfKMynkbmKSqIXGzDgxrR/Gbbg5Vx+f60z25ZucdA2ndoWIJ+aHDo1vkBp2AmBot88jTz2posnXtepa+UCZhnvxhNtqn3EyIOnEiok0spWYASKACy22gC0pTtKLsA7jaT8vU0TgYwGhSsiBY/UqcnZVdU5fC63CEDUUuLBZ8uwuCcp1wrLj/rpkPokd85BpK5EIEf1C6hnGUGwt+ATwEKaU9SYe1y4qGQhijG3IpJULorqb+X8HRsTD62h4GolxvchIjLK3S70VvTzbSPD4VDOZKeJ+Gvs/yUByiX1akbSYAEKUQUQVh2VJz/obS9LDv/RzHuv+xYASKfEngWRepBqEV0weALN3oVXa5qyU3OdVrrsx7booxmqCAufR4Hwb8F8A701Ik2yNAG1ynMGeCdNPMzJeL0rH0rkV245WUCzjnU6RMhjLiPjyAEgdqT5iQwBnc4AIGdhBOyV4xBxbpZFtgAo903mExw+iremFQEzizIyXYOFHJfTndrPEEPr4pp1/wFaCLFNjNa6KdW5rnXcPgHOhR5V3ZGyAxublQJTJXS/c5djs/XUAebTeH2gOLh0WFY17e8qDs/c+6Md8+z/OhWlNjXTR/P2+bjNyE02zEP85Zi2UpPDtzH0gTP/1KZG1Z3zUiS1NnHvMqsBEueWINHYtOnZ1cgaoGO/8Av3W+kweEULSRyHsNfY7EU4JrG70Yq4TaPPBprMNEA8v1F+aCtLH1dvPYQTaqvCtEd9vqBG4LqSkJaiTRncVXVzLrXroYmY7yL5vqOZ8jSTrLOoJTjGkxieR9ZTS6ajtbOwo3LCjKpmyFe5rznbhZeFJx9oXERwhdbEKNrzl4IYTgLHJeH4by1zZag34zF7rDmYMRsbNmUR2vY654qtxcm7aXCI53T4Ekr7/e8YGUGEWVRJuBVDJgAYqxVjySzamV6nTPMY/F9sFe1J5gAVehr8m8oPnllYRgdhLnogxphIqj+PZrgvbBnkZV7xVKYA8CKWZvB5RXgqQn2cFyt0h7kTNWKJf/EfyAB3vkPSFMys37nFgEaK9bD7LrmdaeuYIDCCc/TYMvdU9XgqdzraNK9Sji9ioLbQUVhE8/PKKWw9EZ9lMXYBENpqzsc+pu1viVFhDTvROf9OoN0eCro00Y0Gh+kCJkLhqb5TVSP/HAWNKzsCACcvU22B6Rpf+Nz7yk9Ruaoq9H26afGAj6GWsLzd2Rsu1HHKx3xN3gjBPp/yrxn3W63iy6CHsEySP0JmfbqyfoECsH5s6mh+P26ACFf16nNll+hZGMDRpdYBBUK8R/mfGTCOxYOz0m+IM7sRd3AZSck2Yt4Q0V/1rX1lN+huMFI9elqSjssHEgodCD1Cl/SU90rZOLqwufGWMfzXaKcv4jsoDcwHtFcd+gCeAkSKps6HtE1GsKcSxOZZGPFnsn8AMUz57qF66eqzI72hdoGpTyw/Pn7643mZPvLJTefKxFpeGDRTT/Ch7Ad2SUqoIut0HZJuNGfp/1oFxuV1QT1qspTvHSFb3xwjqq85DvFoa8uW+2SxyF6CVicEnXgiEnKseupZfxSyUwWC5skDx9RP/CXfxnzINVkk4LheM4u4OsGnXaXFjL+39rYS6Cw8ikeyLJ2WQ2x21r6GpBrh7RtSDVzeO29EYgxFQF02/p+MA1FiCCvruzo5vXWdOmF5/XwYJ4AmIItvdBOX9g0E8YzPyrjRIBl1O/Q584LVjHjSNfc4rK0rzzpdf6Qajo9gAkyhnDko9+96P+VwaEOPvRRPm+SY27QZj4Lv2TuAZAzTyUFXDzXef+nnRpu8/13mb0imTGlu3milatoj5hf47ZmrMPMe3UeqBZFheZMcBGhheQQ03ScOvD5UTPa3AfrlRjZAKezr35rL9yFJUaePmLhH4usuHwbSWAyAqrgchm919+aNOFBwQXt5NZGaltVkkx6RkCMpUKxfr7kb9ayL7riS2ABTFELY4Q2/fpQ3x9JWW6n6wa0CxpxZoHGjZzV//CtmoAeTDXcwgwPEfSXhKedvdHAAgCVeaqKGdEPFX/mvUFWVxqpCqWY3sfkKP7Mb2RUbsB9Skdnu9tpdesqkIrHYwi2SBt9hQcftQXJzRv5Ub8S+12OKHthh4WN8RplbMvixm9tXoaMdNYykSM+ylNGg+VJWtFj9Mo1pgNU5sQkMfF6eUsd54a9SLDo17SA7lkNUsT0ZjS50oaVItLjvftJb7AaGGqg0OesSCwdj0cXmByjSBj3OELuXakSssqEHqk1/Dd4vPZ4IfctiKmDHKC4i2ocXvIo346l0a9Cm42YSTMs/0L+/R9MRUjNv7H5FLmqb04MAPq6nV5D5DVovMxf3mvzkLYnwZ/z1ozzu6XfLyTcBFe7ZUmfGrAauiTeN9RkQTmc7l2ciiuEd4gu01w1lmOh+6TdJyPgkvYzaEuGHyidKvCZ1PvH+umeNlCupfpBRhVPONwYmbBTlbu1DUOyQ7rU/48gISaSbC14RbiqzANzoGRKlo85HpC8Z7NQWUZGd6bPg005zA8Z7xy6n5DjSD9a1JZ6Lat2yF4+WP/f0MJSLMYxjbhhiM8HXC0srmxqRygVg7XErnrKaU8IbTKUHo7PA6HW6mn3AXEO1oO3HJzTxtscLpRpwXb1t+nf98dmSS8fSpfUi+GF+1xoyTbeKJbK1/MixzeW1hwcW9j5e5Mp5hMwyxVN0h+jlzfz/dtv+9nUkEG38uz4J7N5WnKXO7qjXC09g9mY9z6r8vNjibUseolXy+oPJTfR1OH+x5MLSL1YF1POOyLhDCJu1/6JRAJsKcvfI4MI3ayswqgUElJzaXawzJY2l3VvuPL15I1m7ny+RhUjQJSyv8uO+zZKvOhR6cWY3Hr+cFlt1heA8PtkktVKrHArP2S+EWSQdSSTgVy9sVFBap4kwDFAqCrSI0YlkXAG5EHJinpihmZGlXVSvX2DislNMLt4sV/9dFB9mp8UdroI7BGrHcHoCcMfN68FbrmMLmQFl5pJaKDorjvBMP1jH3ORCuI2SENLFeM1S6xe5WloC4lpmHwDdJ2m2Ar2V0LCxDd/oGqSyt2M5bKcB3JRHmf0UJiaMDOKpYHDN6rfXOztvcWg/HpTmmMu32CaZ2AODy7Mhfo+ZS9qRIUczNrjcMVViYkyZnhMPEH0HzZwrKw3bYKo9VLUAYBPs2ny17WJ/8FFHcVCxUGdvKmMi6HmmLHk9B0UMGuUUX8+K70uFF59e3OUpVeEXQUxvxBpqpE+mehwrW1F6oDYNZIlRxOTOgNAn5JCvZhlQCaVlQE/juneP0UAGasTgiPiZnHsgGoWPZ1RXHah8yvGRJbLAGsyISbudgmWJyt+DWrPAa+SAewEjeEhtabRXGJejY7kXspZ/L3LEqHGgDGFwDuBlDct7ILEwdUH2P2NC2WCr2O0UCnk1H0CaPSOlHl5Wzspco7spcvfIBEPaEcSDb04PBkIF4kgm4TYA1yMvJLWV7qZzt9cdc3gDOxHWW548SUgbNoA0zC0EXDh0uLHrU7Fitd9fke1R+Te4WBi+fWaqH0QMw12TPx7a99ns1H6Thw0Kiiy1n2TL6SZkPkfhq6t+KyLM8Q/fH5xvg13YPSvrbevMnLfqjgKFR7Je9TUq4JcU5sfoRw2ibNWIUvX5wyX3nIWWy24dm/qfrn6cEEhEg+tnuaDwWTJacZDXkuB/7kkNhrZscYMgdQiIAlO3E7itzUBebqJmD7q1+Bka0XLRitr/uopYv/bmRvbNu1HBs97/1pXhDVj0V0xcGtS/00QzCcl4TwF1BN7fL8B8KR/+rn216oPXm3mJDLBPEO92A/VV5c9D9ZDRKUNIteof7YanjstYDrUG9UBkBH74sWQ6AbDfGo+6b3AqGGwTxVXfWMFPoHXqqzA191MhRXTUOa2gDN59IOY6QrMX0c4l5HYI+n212FkXL8IYBmTSZRihNXNhNsBPgv7k4HiDhESxYevXft5lo0hXwZOOSl1Mu8G7+dUBqmvQ32sxspD2rB7kXKUDYMRyMNX2zLG7Z/nGMdveeeiXNCHhnzFvFEoos8e9DFgUyYVOr6SqlgkncIs/yKHD0UgsK4qsPy5Fy7DMziBbqPCPQ1Xyzgd84pm7OBykwUARvIpEQg1TXP00WbPAuLwdomYdLAft9rrVm3zVv4fYbxPM3nd6nXvwA+juHmy0am37Lrk1DaMxAVtlaP3Fk2bU8dKqfrAw+DVXcv7vQFwQBDYwyomJz88rkg1i1fQjDXlyuwOj7YjvjScJROX4x0uJXnVgxj/XreLiewQ4WMmP1HwsEwxzy9TRgyQdbBPzmc/JbF9+1ZtNSwOlLT2Od8G30GQLf2kaSP16FNHPNhSOGnPyWIdeKPoB7kbE+Tqz6UMnv6Ziw9MfLDvxIUeMVtX8n4YgIuBWicSfLdBhSL+y1wXuQd43jVYY7srw8H4nvfar2z74OP8qunxhIKkzvAyCQp2f09UysHDoLqYAIBSfJ8zDISneFkTDo4uCP041FqlTlhOoc2eHK/tm5GjVMV9c23AXH0KXIjjq3/ekC6axlP5aqy/ma0p8DQXxZPAU5UDYUXokoxOr+0Ne1tC4+4VU7+ErYxRT3oR1tktu9ahZ7r7RgIsPV4VTMqjP50CnKaAbJbrJvfxH9NSy+DaORUvlbtaIJ01UOosPBC6QfphP/0/uvzyK99yqhIAD0LJVyDeeKbPoX1H2FqTzSyzcgyF31gGtGSVuyh1WFOnHPNC+3Td7b/S2EqdhjEyXih3ywlUeriKmWWfXNY6RnU+tDIMiEF+GGHCgHMx0sfPsJTSoNxLzqqRKeT2h+pfjoWGWgBhNlC/Qeri+4up4vt0sb+mkWwVWVAW3vriheawR34ua9KkiGBA1irjTYov8+Z/JL8UH/URaT6WEhIuUyYZhDY0u92ZD8DU9B3SFPwB+tpPy/IcgwNDp7elseJIZTWgYRO93xk67RGkus38REKPUe+9pi2CrSDbjVp5y95Smve7ld1hUk3YVu2p4HzvM6R3TqA04cQJwcLSd4oHEZ1uZ9+eXCpCnFlZWTIltdxIPZ5xS9QNCZUyfr14kRYRY64S5bTzVHMkDA2vNnGMzLiV7pyrpuEJ2fBQetrlTIq6KFNo3RimiB5TqsPtgm3licqqOeTzp5wYDSIg9XjY5jhyBQSkBjPgiiiAP74QvXC19jA1QKG4FRn2VWE7XiyEZMp7TZFNorpnjLBo3YXCsIlkoQ/TOm6866tc6Z26qH5YMLYDurdV++uLwBjkFPRtF5DOrjCCONtBFBgrFW5gh1LSAC99sGFvnJLPDMfNxgKsKN1Yg76BHAWjffc+GM2bTvyJlNagKWM0pC2gxsPMt/1qYtmmlIz0/ltleWdu3dh/Sbm6dGMrJ0+dRZL5RdDVNeLht201gtlRNM/29RItwoZH7TMNDosD33DnMyQ3YanMTO3QDeiJuB1nMrYQUEMPpC9fNayCDTuTn5D1KCe8jfvy2wkcwkOjrjKE6+0AAgTqt2pbFGxJ5ipVAeBbbsKfhmCDbyAJSeAcAmTMWDlp17EXXfWXYnopC6KTfAActL7sHAp0PuyGTxae1ss19B3rJ+ua9oz0i/Kg0NNBnFAAZ2eB/lxYVYVba94r53Xgud9oHjasM5iAz3745nBdG/dbu1eX4oAk8uPOuYIfpKppZJ82TUKejRdK2ZKnt8SPp4BIkxLlScsGQPGzo/J89AFtBIss1bHZBq6uTSy4YbzQhFFVZdEJ/Y9cuF3hYFFY7SFe2RJxOXtaQ7sKNAe8GNCfThlMjWnWe6c2thlPRTpOQJRIzGDA5jKTQUNdkFLZ1EOswgYhNnwZTBPMuWoPQXW2vir/Kmxa/r6HqmKyUW8MjBJPf59KJRb9rhVm7Vo3ENLl8kXVg/rmi6X2dRbwez8IoVTJiNX8UhCLsozRZnO2LvBkUCZrV4fR5wUqtGV1wTq+f89FkTcYdSjPmzYu2W3oSVo9oNqH1vIM1nuPBfQQuZc5yG9o7i4sSnBA6VvfdBi705uQL9zX88YoG+e0Y8b9TaVJb5zAj3YRTyKU1DNHyDAoORI39YH3pfRyPVz7m63Gt95aT2LpYiHWqlUyH1kLMuJy6sXjYWW2YCbB0AtWBfORViA+9GDru+fC6ElMONPj6fatDLCJ8is5dsFhSIFRX+o3vZgbHuA24/A5YPczBqgP/SUGDBakA1cMnebvaAQ8Vbt8uw90ujRO4vwCVftVtYHPV0ARmUjWeY37qyxX7f7bbrtI/eRpiYlfCl1jAfvEfEFq7zEUBXozEeUlGDzu9ZeUlwXXvtYOwKL2BWJ61xwOaeWWwRnRKV2CsHUEKcc5tR+X8t1rORlD4pcYy3LXHAcKKv2IgOg8ltVpz+2smchTJ8fPvh/+c9t0JK5sg7LMSdven/iflC+aMNtDJen+Gw2MHy1H5rlqs3OipXf1cshiRjsnYpeeF2PYCc4BHJK6SQy3j0XTDrt+TrhyOJe0SW/bIgdLeVtdEI7pwwXcFf8AEEfLbdcbrTK/QLlJDKQ17Rm46E6ZaP84+97crBFfz6gziVPFlAf6MU7h5OMzl/bLNZ+R/EFeknoS8ZSY0swtsFIPsOtNDZ6hu3kbpaO0qqFyM8cvuBfRU4cm3tK3GmhNge8iyYQMCBnKURzeP6lkG1o3FlfgnFzfG7iDlnxOJNWXnq/xsddgil1gERhTH/3aNqJ58yDYJnJlqMrfKuwpzAmo7dwA16//8elQPNcoTKFLxDVWVKPu6O6rm5Vmvhb09N7eamOY0bzmJeOGgdvVU5z1Je6z03EnTTE4y90eGNCHI1AlrQePZCXTXBGu+2Y0NWlmppkhH5khazNZmV/j2sogEypNSQaza7u6eStSMX4jh57LvSp/ztGia4SvRjOKyw86aMYTtTL79QKjmtAqZVzbRy6z81bi8arXU8JwcpgGuR4MhPSkX+Uw7BonlV/PhQALTjuQ2mAPkaoDhVTL/sXbVaJp5dZ+uoO2vqCNGDMSFx0V1epuDXIlterZrcYB8tku9M8rJDvN/zSNtc21R41p6QUKCTUJ1HMSdyJiwGignvSwIaPCFtCCmaBlH8aTnB4hz9QR7VCrTJ8up1jVloDEqgZ2arCerg5f1aZ9WjoWxYXvvkXZ70bXCuG+TzUlZth3tg6r5T6ONBaRlQLuRySVjY/GSu/HtcQGMGcodFkkpDDKaQdsCMtid6rmNwE1eKm7lKrxBwzQ4mXWZwDHxSKG1P7NK+e+5W5AwLHaBR1kl4PkEydQ6hO52rTIF5fdOZgMhHcildW9Adj0C3MXBVKSrQwo4tItPCcsgQhbRtZYNZiXy7MIIrgE7B7Vq7EMyLuwDabqg2eZFrF/eIce4hXUQleQRfzJoZCyIrKHhNCFzodY1YzssLki9kj6SPwDqMnIW8VwvpiEJp2093pq7W8kne/3er1UtgzaFOS820RYj4C9LlaJT+vHDd5q1kibv7MAnkZObu6EYqunLcLeBjLOyaqaGTq7ZWvmk8JlNO+FZg33uAK2jgYVLSZEgKbMzB7taQySF0MTYin0JSLNUlrl9kl/N5QXdJ3gHYqf5i87aZ2ZgR4Qd+mS/Rdos1vaSuiaCRBY2Eq8XzLrbZWEnanzFGDQ8ll6pcx5/TkbKZnJPSf+rB3d0/SWi38D526F3qf3zsuZdUSKLfvJYYTLwzqPN7jLvKN9grV/KrmLKUwIKq2XjTC0Q/V1tnjNs8y8umByET9WvujufXEIQ6PlGNUnfnupJRJwHKgPXn4TcjJjRdtsGnXdOeKS8KXSPyac0YpPzHLG26IohFCnncnjORcBvJj2Qtd55c9Nl9TH9ohLKlN3HO0SVOe7ffZAVw7KQ0+jwFPqvfdknR2RZ0TY4aW1myFvIac4avmMdAisRxlOJYSEUAs5HIwoARag8sjjDpsEa1u/iMAcOv1GNJE5y/JtJXmpP1KpCbuimQ+5MnBOMeWO0FVFIRty4VZka0JA8vy0sDH8KLFrWg1XTGX2HHKZNXkEhxclNAXFczgp25MYJZBHJnT5QwaDxzYv2lIZXKdOkBcI8HMyrpFNEXILrkaHPp88N27yzlVeb0mZjXD8u9V8iM3XZX0//PF//uqj+bcTR2ItH4+2u1lpyY7aV5xJFYm4a8LD8Vadw7XCYyuCWMYJGirqD859TgvqdVP2YHu4acQ7raI7JDnq/CRgr+hwhFiwMe59mKI04wtVjDtsvOOaJiehwAWAs/nWA1lorNp7gNGxQN1Rj9elurZ8jWkvAPIE2JDbBHmHAQANZdtY4u3wNvDFzNRu089jxKmxFt0/vSRdQuJPSrf4topbynMXsfn6c2v2xhg4wz7vq+9hcQh/vauLR1ROcFx4jvdvm8rURhywld4XSE3JOgjYyx6gu0UiUkRtLf51KQFqEhCYefy5gUD8jZ7Qa6CMhsPYdUgtAoQapJt4wrgfykmj6tGMyHwHiFZep3VY3+k5W8On9bhJJc4eprS+zOo3JSqOKQbv+1SSt3dflhd1OuJ5qY7biJpLyBteCOKAuW7LJ2KjNapN5F2Qajiu0cyFqyyNaJLOHwpJpdpt1Mew0XZgCXbTRwCgx+0wCLjNI8KEHv9N4DGAk9Zh3AqPBcOrOjFgMqNcc19N/8ldA+I5OqbYMa3bHiqs3anmqtxagr6ebiKLkMbFWoaTFcsznEyN9d3XwnpXx/LgC0lSOPXQDyHq8vjcjQx2azG5P54Zqv/1a9KT1brwcVJohFX0qPvQjy1X+Rfguobk4C3xIzsVuL+bUH41XjWIlFurrjBE2GBVzByA/6Ij7MeP9sJvqfrYcZ5F4COblLruZK4SIlP1GJae6YmTOkkMa1ciG+h7v5B8nnjlM8JVibunwpPJqU8q31GOTPJrRPU4WuHj4TrZpsJ++aUtfu85GHLByq2IMzWIXE8a0HRd2OxYElMNDq4iswVG47hlh7SsbLHNx5rkWk8bnck6G/4AFlTuLuoCTHg7vIOEH2s5HZnxbH13lpGMAs3r8rvnUwPo8ud8QgMeA6gabtp3GmjCyO5oXvZiU5fxcTfMZDCaqCc29m4zRLbOTubqbR7HJw2G2kPwOevgHqXNSXIo+8RYkWL92wXlkwX4tFC4DIwQM2bh26wbJmno1l5WEeqESEyCKGOQe1YpiYYq1Wfnt/khBH8U7qU0pmcF+qTHYAYCYPmfbdtOTBvDUfB7dNyRBQMhcbzWxUDXFEwE5r26PEMkcWiiRbYaUQjJaqL+HslE5snQ0V3ezi5+jAQfhGgNWvtij74IFDalssPTb3At3Ohc77M48sDZwus58/5Y4TGVXhUH1vXEbuTuyMsyHrtOzwrw9pPfeYeqm3BRlqegWv2nsCN39t3YBntDfafmWLkD4x3Rp3FU2cP/Vzkh0gD+TeToT1w4LzFIfL9sRTuKvwSAVJNANkjaeXF5M1T/rLtoY7+Om5UduM3HgzYbbVKQLTE+WWNrbOzUhpm/fmua3SvX3cUyZNXjHhnmY4Aq+KzGMJuz/wlqiWG4lYfUtK8RucQ5XMmtLs7grWyFuUH4rb3RHOhzwCQf2KezkPouXhJM1pWK82bsUjR9eS7ZHimfh2/rd0df8TJv84m3bjhSL84DCPHPNW2jnQtsCpcBHEaMCGoPIPfMUAAg2kTHWLkWEMobJ1JFNR/vDgRoCIBh5ZN/E/SgNUICUeSQK6sm19LRKls+raYAyEUTfEOdKYurQf5yAGoYzHsn10sCAcxL3fa7UHEbJ7qHCb2gRsacWSRhdfmgRBZ4z2nC7C8ca/+hIvma7xwG6oVP1kkhOk1dtWI/xfLfrbIGfXyUNJzUXZbf+Ua7qrGtQpdV5FhYejiuvwvQRmAjPT/73hzVB+O0BMpxdxdB2zxowvEm3QZOgtd7jHBcmY2bTjLluUSPHlKUoQ1tXxLxMKrh3kKi1+fB1y8KrogbevRadMKpFjMggtUp22Cz7d6BgmtMZbfTF7SQVoNPOCegAQucHtoqYuHdb5PozUPG7wb/PsXOkOcmnm638n4U28PvazeOON6nv0uNcUZ7XpweTMRp9EB5MZ7sGwmbqp6AekTPuzLqOeYUetkc8CzE488zJpdrQ/gYzixZQMNwDWPxoV3qHgF+QoizrLz7fXzcTCWI620WeK0esSkuhaOLdR0pi+H5dAjwribt7dm0TUgpmYLFgLFr4x8smNW11DJ4GHuYP97ODlQu2V2LtFwec2ZADJBclAp53fcRyjPSoHlj1tgtTS1vccXxgEk3WK05QoArGp573Cr9K7fYGeecEd2vGEPCPbF4zM3qwODvC3so+f0SyJMc4df6wdzl+z0d9VxJMtsGKo47Q5Ta4gDULYAUHo5AFyJlIkM3Hchwr1qX/QJpwJjwwCuJOcdh7D6q8jkPuJj/tfVFsT+gVqFwZ6rDkr0I8RGeD6YX3lkEwNW4q8QJi5fBsUTqqS2b4Fuzy11d6Qz2+htwk3LoB2bSg3O4dXpBO/XuELGsdn4AOTLrdf9SKRqroNhAzQMvvNAXqrSXBPXvb34Bavur7kWnzcuTpzNEL2bnLunjVdCP9F/1J6Pc0KPtJeKXgbTXOi8bSVCbW0Xuny6PuhZ+siR+JWVSyLGk5uy+l1tRTcDu9gtONNqjU39DyLdHbm3pv+YjCPROoj22gmrZOgSt1D42K3LZ12BmYwBIo4ZaGlo0+E4l2H+NqptzOU87/Nkkfw7zlqin8oZtbScO9Ljbro7GjYRhf5Udqi8WF21v0HLgQ7Kg8FGOyoZvchPFTpxnT/ekjRWClivSdvxg3P6oLj53RVbAtjs60ejx0ehsZ6n2MiofkLLrmbabb5hbiMBxXjaiXKVIcADoR86oVdaSHKm2IIpdNYwCrDirXWstipWiwZczokzNchAfgFTwETnOW8RBWtlDrH4xJbTvuZel4NoR8rRTGzTJRNKWDivFoMLpRwMHK3ZX/ZIDLcQOL3et7RwEvZys50cZudPXZpp2cAwtbzzP0TNZ8qpKEMCFgOWK1+LqTWErMNd2wH4X6A0SO4Mv+8YFnMFVlS/eABF97XFXjJMkiqvEYop4a9n4I0asinjNsDDsjQZlu9RW31RqmEBqXjPlLZfWTdZ18mbBZpbEkLZITeGIrOrUSEDSpGWzryQEAM0I4+2vipiCl/CZtUVNTW1lbmxofe670PQ2d1bAAOJV6q2JBZLNgrax3JnuFazLL8+blAFsofoG/Q4TCZdRrBai6fIDcftNXDTnUxsJQAlsaqXdloT0Kj5R0/J9fHNoKYodssJkXOl85g92GO9YYQRKLwXMhR3FChzYpb9qPAyblRD5ZxQwvR7f18nuGHK5T5FYk8oZRm4di7RYBGBfO2taerA/vDxF76LY7eKsGer6TgTayIJ/xP0tupZrXSz+kexDQ9+iO2fzXpziG5Nlw34bppXSC/ku3D4JVUnUjJ2L51eZJaCggx6o2p2vFSRwAkXwIi/SdcM4AmyZCNIMWHQRfsqvzgY5Oam2ekQt8to1j5RYiRFcAjPZJYVDhq98zie2pwi0JUmu/zS4Mv7cnTXIwHW1IGw6xQFh2jw22fxRWr9Tl6UpcjynKQnU/RMyWM+vTnLZ/d+zkBfI3SNQ9/3gEg3U05tjVQNd+r6wQvGaxlOLwx3KgUYfivAj8pXw12yWt3dNoWZmujFMWcV4HLxNzHW33C8hth5bdObWamZAJkBxsg+Z+y7GRhJGlcFhCqp8Tf8anIBDFidFmEUqyIvIUbll4aNpKDSCiB9V5DJL8dSI0BukClXhTlM5By4GEQ95SWHx/dr2KoscZ0XHhwZ4yVOT5jAp9aE656EgIn+Jhw3zKJiALiqS3RAqLYPeVdap0GB/G2FcFMIlSfeKn2iDVzAch23cNW0pIQT9zB0naDIASLOOubWT1HE6pbJKTXEd2HdQqiYfuP3HpAm9Az9IrKnOiEkWka1wDQNcRtoYDU+INk4quYCHtsuZASzRieLFK4hqUjzu0bu7EfAO54hjVwwCJspSvSbtiq48u1ReDuP5POZOyl/75XLRc4C9N2SJYrt9pXu2kPlLrQ/qpridY2tuvwC6VXqFVucCqbM498VhpE347/xzhN4M2vrOfYQgHKNmD5zZKrIDRhRjp+Jh7AZ6slZY5efPcqJZfgAoaPnATwqzd/KRrbKLUWR+9gEFN9HPf51U0Mdc06w0qAYO6WByQIbqn2tD3mZTE8Jt/VD2ce2+Tn4UhTukvvA9ws+s4kAErsTZV60EE/n1jTqrUgtatlc6DweFhrmrVHuiQBAhCv69WUAKl1WEI+ioPQVyV0B6PWHi/QWFX/xlW9PtXChDNul8C4WLhCpPv1CocBz0JmfZl7U6EqH2GbWkNIsdt7sIll3qoEOUhEgXt1KxH8YQs3ogu6/cheul5goHwJnopTGG6UV6S1EUPLNZxquiMw9fTw5Q/AWkF947wkbalgsXLGG0fPK9rxkPAepAD2aJA9va30+dHldGs4D7zCVRf9LlZNBU4JUzCY7ovW2v6WmRLOo0nMeuT+vMe96EjRLB3FshAmI8NJOpz3Wz31pwL6S5LXOnaisIUEoVGZ+shkBKgGWIsbHaGGYrsmYO2eenIgHY4nKxqnWBDR9IW2T7FaqGTvEx5aFyXbX91kUNlgRK0o9y6svXDyqknYOMbs9HndpC1Eex/o5VyxIiTQRZm0PxS3jRZETZ40HySKsuxmvobi4JxkA9drl2AtT1ZPlNgjCgNn1s9P9V1u9WK0kINMNUGWUJhuI6cgrnMg7x3FA8XEPX2yn4RLArlNEUGTdXydwFmK2Iwgq/k1naFAS0mwzusdkiYRCv3En+UIb6gcGApFf50IKThkf3i7snd8Um44IyWrKksqtvd2QHTkZR8ta5vN8fUUGt51ASGCJ/6rwxCRXUWGokfVvw+MxM7Mgj3lLCRnZ4etCYZIQ6v+vSoMG/c1g7MKtr9UugLLOWj1sYO3VkOpOaYiijAQGPCRYZ0lwnS92qa33a9edtSQiORQnUAe2aVYsHaA9P23nFhklrrwTrc8U8o07pnsHrV3rn/fvmEKxqHS47Jl4TMj55T5jnPBSnrIrLlt7jaEvvBOaF8bZYxHzTYvU1chGwrt/D95e2v4+DHYS2wg9voqoj3TyHXHXvTX5xvbXNcWT35jUgvFO7VsG0F+1yqfDxXwYwfmtoFZyLzkCTskCSHvNlN0/LryJKaajV2meM//Phva92hdsVgCFp0zEdjPANUazrFJ8GSsxPrWvxFTF+jq/aASRRNmlLQI9HXZWuLkJmMTOzVGnYLhNwWwABBLY2oAhJN81uilkAoSGw5Go/641BxFNmKdcOiX2cpKdSE5qAJg9ebNIESKlwyW6kjWIrMwrFh4BBomPHxRZdpiQUYXn1sAN0kBxTqu7y97tL9snGM29bw2t1cjSAjpGaKCkA5nH9ESZQQNNcRAxdOWKQ3NWjCW1QZF5JSOzP+aI4xOD2ZGghrPSTd6OzL7yCValAMYRd0XRN0CrDImeZiRdJCcE+mKgA7Ck4Y1E04v2Y2QDem2B3tw6qFOS0P8f3chAvNXKdWYq5SFonBxraxHCH0HHmW/LVtYYbnXTH0UgG4aGqVrffV74LKroNmEQSJhntXye6LoTNz1QF9Csh82eoh7VaQ5nUzuFS6bNW/V5exV/UNXECFyTzTF4NynfVtcFW0lJEi2AfsFYQNf4tqEtsq3GHifbprReBUozDxgqh96hEX3JDWUIDx/pY7WeGMbHPISscrsvS1tUjFDO1k6kV24HxhjnNt4pciegUnpCGUWqvUdawimY5zR0+XlYHUz3kyD/lYxaWxGJ6RsmKS09TopIGb+t5qLZGC7TsBS1x0/NEYdwrp7O1NZmyv9SqnH79mbTAd9siWfHcGUSLcZPq+OuyDCKh304HIydPHfyULAIbBRFy75NorPbu5eT+iA1Ye3CR71YiGQ+yNQ8982tNZmdM8MiEr6xhOhkzd0Rf1ZhOtORBHPUK2nzrcUOfqfnmb9owddKw3TZUtdbPB7roULGOU/AV/3GzQqDLMCtLuA8C1HVDtI4kBUPMkqCO2nFktr9akr2Vpsaqa5U97BMpw9k1uJTa3GyQ1h+xf8vCqn/QaitprxpfSgTtVOEe07wFmpaJPGe1PitrffL3CpwUtGUhfW+dq6YicQzSKyDMmeQnQfuRGbKyNeUbKnP0GZYsWO5LphyGYTonA7ITbDCdYo28iIMUjmfaoyOd5GJeu2jCttp6dofqvmKU7I4gXizrm3ENAtT9IVQG6Ox4tHa+85OiFJ1jZ2c8xCQCpJsygi6vmeelkCbdHszmB9WKkDeayb/BNuCXz+re9Zr4UYYHKjiovqRO1yRmgC1bau1QSC9VNadWgYARRek4PB/7ApzwF2OGFQ5JWLCfGp/BBtU5oG6PUamVFGJ9r+m2tnaVXmKH6HVCHDva6mEv7UoVVOGL+tnBtaNHgH2tukH1sq5HxPU+/DfV/1va3Z3X35/arBXjPY0Saq5NsodXsP4ETgVlJzgSZ524FqgelJC002CjVJqmuY57t0n+2c9Lw4DPlbnf4vs843/YgtZwyfmv8KrqaPu+VC4lsNukh11HJsSbPixpwLf80O0bEEJCsSlOxueosPa3egCqVEh/RLBvKWXgYA/22DV4h5dX59EmEsjlnOTBix7I7EvMbcGm0tbbQtetKHaPst8CAtc7SCnmYwA6O5d6OnVpj9/3arhYoqnCsBA+z2u/beT6ySBNOFwkhasCTCZDNIjQIQYxYqufB5NPPjPUGmiE99t39i2izxkwa9vvOqpLLKiElbbJNY0dpjpOJqbLbFIEAyCwbQ40et0HSTT2bUKow/lQU3rd8+WEcZxrFGu3e3jbLp+TcLUA3YU1OHnbT5CSVxUci7H3R7wRR/Aqh7+4MKxS7MOFr7ru9o3tjKFl5ldJgL4+rXzN75/UdGmO1sA5FPKVHNSW8pBokatzQGaGR1GMMURYAUyMMnvivb+emB+VDk6mFbavgV5QB0ly3kK4X2Fx1jcaDQlzhIoX5EkHuzogZuX6nYfzNh1DeV8/iVRYhBKPRdbqC8mvzcJMtL4k8D+ugUZwD+XXNeve2Os62j9iH9JMySkHqLTfJosg+Z2CXgpEMXYqjajeZrCvzMxi8/iP/naBfFDo7jsjTpikKs69nskRCAp+VyjYpBPwVmS5wEmI+Oubcp+d5PFk2O8NwXYcdkDc/0U1TvNFyW0HxlVLQcNvlzp8TwfdmPLMa0OWLFd+u6B6sJ29xBlHBx06toyV7FGrNBZ4y00RYT7LE06wkGqWUeqYgp4ISfbiQvPT8jE98xJLMhs7XNv2cv896aAZRkI5Lze8t8rv5VDpXpiAF+3YEdoTI5VrKI0vlsxLa4vR8f/hKcX0mMMHh15fMpjU65i+4+YeYjMmjS3t50FHV2qaeZ5ue3AMh5SCcVaxeliApS6KupSDG6TQ4iJlcS0ui0EgRLZwHU0hMz7fC6/xyIEGyqoLKjERHKvfjhGW68we+YBWyaC2wJKWmkGj+a48HxOrFSAo+ntDbyK3os7CZCsE5Cz4Tp16L2sh28XyAaHFXz49KpO3ydipwh3nz3vYebkT633e3gdqsDbnhEUqf5Q+Hi4z1yJliylMBz/1EFdjtxpNlla6x9a47zTcr8GbvTb1rz2ohzqYW5Z5pq+yrxtJQ45Fe4RJLVQvDftEJDLDi3qN3PRdV+cDl3XmVM73Kf6bkc9v7plmzByfagU0pExDeFB55w7wPGdNh+sTgxAIm6EcIJm+qdNFtwVGB/THdhj7SRNRD2P4KxkW9PrufPNc6LMRMQipuO41fUeLStVvVT8Az4VXdORrf55CuxOm0x/5CAX/oby0OYzg5OC6l1dKxHmHr2M3QffM/wYjSi8L5HmTzriU6weeIWA1rltthR6pHhGb3D6JOAvqRPE80ntEsdX+bBAnq7UU29qA+agcDaKihpQHynr32Tht5B7OBcvodM8GOJYlQ8g7jKhQIAdUishNhO1YCF3MweuQ/6FcsfqdcJJzr7fplf99jwbrzAflp7vmCmIKo0PEKdgqznOPG8uh7TNhEkSb+jv+ZEaD3rKMg/qkptDawuQAqbjH1KpYrV1IlyOCZFGbCujWvxU2wYVKdNg6xiWgMbpKyuw+WTdXwFsCA3JJFIyykPGSQcAM+k6vdgY0iBWg9H1aZbDrJavoA2jE8kEll5bdiwQwAItG3HF83afiyX0isnAlKa294LGjTGh4WQEdJzS+3CEYgHhJZMnq9ZNdQiQ1NMg18lIIX3vDplzH+IcF5jBuPEkmZc4p9aoiq3RE4tZAnKo4VArq9BksGrVasN/PMav698Bv40BXpkROmZaVc6RQniOFim0yDsmALwE533OWxw970UuP8QfKyf8dqe1iDbkUHY21z9CJjtCvNlyaCqiJ7xqE9u4c2LFOmPYtNBDX0o03ldAc0txXb3Exk6JPh3VV5XVdFNYfbQVpfwVyD8sSwtzyJRp2ZpfJAyQ+dAW+OvBDkKsjs1RlSE3y32QEb4Xy46VVTNUGy/g0dwrNYn60M2z1Nq6irQlYtqGvjIFMezwXktFN1wKMTTcgqEaavKeA/igoWPGsU1bI8TiH7wACHZ+B0Bh6SAQT+lLUHfTf1dxd+dxB0GXnL5y5cDKekmXfIxwcVC5EoKRIaGj4QXrzsAG3xKOD5Msyw8JhepH4GgnWL/ICLxHAITNc+/sW1HuWsWXl+pzGc/9YpcM1pFp7jTpF5GWJSrjaA7+VhP1UA3CQX4ZDcck3R+gz75eb8i71qCu6KyAEJGkW8GnkAyJHotaJ1atezPSIRthqtRUp1VJH7Pl5E/KGUMFxs/yAhDdNlK+9yk/OiWlMwXIJZSN6oqcyvd7X36Ykzo07hsFiMHNF4LKvoRBSbBveVZSqaXqoyFFJO+Wzj+cc0ZJWalsirfj9H9qcfmc4AXKERUCdWLvN0SNpO2uU6CFWKkNsbP7bpEDmfqGs96hMmRhhA75/uvRJpSykEdpOfEQUw9gxmQXA+Ef3/PHGv/mXgivdf7QrQnoEpWXDJb5l5TbTAZNCTHflS/6AMs9pXvmDRZjz58HE8CYn672+J0bJLuvIAtEC+woGm47T3LdU2rrqGm1bWaonqJfYdA3QV8QdfxKLPAN1sJPD95L8au3ZGFN+1gtjT/ILjcytN1aCCubbGKWAzfhgdRMWvGA4Tb3tNdARy37HQim20XEDA3NuvHGcqwE/YiEKSr7onJeO5hC3HtysG3R3T2ywaPxoAz+u5wAFQmMgKuN0zpfwNNu9YM4AmjQ03/OQedEsbpb9m+tsgUyak3OHsd4UFY/f8O/992Uq6Xi5eSuOEPpGUtBC2w0NZZWMzwtlFI07qDz4DziI17yKjVix3H0rZhqlOkbi1ikseroYjNBXwTj5Ubso3e1ZwbodZCtCuEgyp0rDB7oc4TayKMdesDu5NQY6qlul+IziUxin2PhbOm2jStIMCEJGFSWfA3z5oayHZmi6eJ+1dxCD5PlC5PJhS/z9rMgj2MxpOkGoZH0fNM0SEpBjDs3oAyGf8ozAsVfsVWpACUFYjDpJBhjWqGAAJz7bkCujo+zDdsTUg/G+3uOiIY1FCYlTT6zlgaE5D+lVlrJtHPOO1nHX3RQ/P7jbyGJtlg+Dl2WYx/G7zVK7W+IwJm3hDBp2GkK9fPyNMQtHBxptgUzSD7ZBtolARj1NrlyRATTSz5P4XPrHhUVs16+XnpuPfB6w+8gsOs+hI2mKhva1FU7BK0EeZ3TK69RjE9RoehR9sNUino8lNyu8snviOhzSq19kn7zW9BwKo9pfxuRY1+sdyAEvChlVVUT+EJ/PBaMMILfbGCAoVjMOpR3DL/rtpCuaprc7+IRu66KoiY2ggV1zw0UzTwEmfTcVnOJhiflyGhSIoQKkpaEcm+2/S6WGTwO3c8iftJar3FlBdhWDS7zpeHXxjRJzY7A4P1sn0y+gJvIC1tRV4OVekiwwmaVEuPJQguieiTZkMCH5i+FCzheceb1QMkNHlJKsZoVKXLG5+QQ7W7PuhA8GF/Q6KAQtzD17QiwVQuJt5aTyA6Wm17eRlexe9FeN6IBHBjtkiFakFhoPe9Q/aFiKTEtJvT8ojBZvgPwz9mv609qveHj3viXXj5DWIPK9JQcLXZI//tCN0s5nGak3SMx1p32G9NkIEnBkwOdSSpTWz4/WsIggiZVT3JOBBquy/je4x3C5aFk/qnQMD14GGrtxIf8s216ZZ7Tp4tgdVx7l/nGWNxXW75tdjfipcuTXswp0rAn2DjIBm8ued8O1qLrsxvLovDQPH2jRjuL3lmL/PNqVyXEuZBhjTuFb3IoOXm9cRKPi97L1CMAuOhTtkW+HkJN3dHcFxGC81qdDGENgDNqOz+gOx+527bSOvst7U1g7xGjGLm/8lAHbeWgYsBq5G0j/hUyeqSTKtXmTujox7rF+lU7PBmbDLfjAGwIHSO3KQvrBUGaznNDNKHW+rDKf3MdjhAgLSU1aZhVchf8vWP9rRgiRBq9JmR6IBAY9DzIbQY5uw/jHxjY2AH+M25BZAVGpE8qGLgbZNwgFmelG6+Govx4VqKRki4f5j7KZ8c3NW5XpsF8PscqHEB6o6JFzLNwU/acfRLRJ7dJs8umZs5W72iRGuUY1V6TDoGMTG+EA0B/Vc18tnoYCtjnT+MiJn3o6I5RmQLzyTDWDFy3n38itCObWk26j627pB5B6himoHtFyKzaaU1iSnWP4AXb5L1yVhNqkJbGzjqZMOPW4Wk1otyQEuBJqVEVLQheEgNKuCfR2osn9AUDcHFVZb//7J3Abk6FRRdjs+cUs+GOHcd+9OjIDcuIfE+ltmOM9C00Q5YZaA26N5WsUHoIVqqHCjgMM9gwGostLm7j8r6qrgLDRKb0g4WGcdsJNXri10+xgQRwTlGHfTjDlCMqF81561AkNlUIDkEQHEzqOg/o4dbJJK12ulQwuyhUMM/KYiZ6Vr7IRVqBdw++0WA1PcUOHPEhv1vSyuEiifWUUfGcN6u7baB62fl4j4DyTp5CxhO+OH8N1wSlXPP2M95B0bdx2Nk6ku/ZmE53kpOZS9xwmWKVNCDkpng77ba1FAVS0bS3tOTK/umez7sIVS0ivBTzs1aIpKwbfzwVp2JYhaCswrw9Fwbg6jDcfIw8ihzXNHEvDCNw0ee6Eaq3zrIvh4L/sdPdfpP4NqOHFshvwYEQaw1dUToce+nERS75Oxu1O3s0KVWaacRmiB+AP2+MsaqxNkraz7XF5YeZVQ/r8gJTYgq3Q9IaoeRFW/e5THymMlzyk/8ommSryMh/X0JCELRQNTCI4efR0eNi/8tB9aN7haXEPENmGSBAMPdI5mwH9Ybct/G1NEBGIA55lVE9hsEUr65vj19/x6mawQaQIUoM/TU86D/fftIT6D8QmasFDK3BfXkDHqvHX+vZUHXUBVjD8J+scIX9L20efk9dxoSTznyqLak7fA2DzdUfkkd8t9WqUcWmNHugnsPABzos3RwKclViEx+x4LJMk24C/0OuPfOZ0YPIRggc5nNK/ixk70BHzumy0bCjNqzZpy7O0/bP94+icaGWleIJ0CzvpXVM1Ss8pWRxMB21wjFFIrlxdoq1bDYZGnH/9lwNPAYRq/X01vUf3+16Ho0LUVjYLEeBjXTBnGB4wIRsh1+pkynYofj7ocGxJWBR5a4/P/fRyCeGTEDohF2h+XRfe4Yg4Y+XBRw1bsg2uJ3kzjL8xj1HxIPW2mizDy1uAOe6zLiwGFVNmNq9q6noF8gLPmNG8GFTRa9V5+AkoO3ADWVGI/LvAujEtQc8xQUm6jGqaRyaMr9nkUDsG1/fnpQMqaNuUsm8c4ePjN6Tu0BjXxpQNJ+8ffRwzXuEasWSAg5dwFrOzCwg/BQhas0Ox9nUU7twOBWWGLoxQOElm1d/INpBEeKKPqPk4VsOlKHcpKVIXQ/HDCsV8A7ifWx2tpRKJLvQ8SFmLwe5eeabTHB2pOcaLfhVMoEIC18900XBsu68XDyPSRxveyvy5Z81UG92WGTvu2PpXjvCs3CSAqk/pR5b0TNYMd47zefwHa81ws/fzTT7cOSR4h7jJ5VnYNOvJzAgDWHxMhaoHCZo5Sta5kaBK2jBNxbjmMFFhCHpvdUfZtjdZf9noi/3/eq28TesL8MG48vkQ+MvdUoLJtAwIonFTtoC9qhudeR0EqlUBkqfoReMdMVr7xTu5Sn7DEbEj4cPsiGh94oa8SyDkTgFDP9cu0f+PeE4O0NOQ16f5cn3oVdP3Wnq82IiSP0Yet4pM85zU+jUFPtMlgUtXSAn7TME8oAQfyF9DhSiz8+4CK8QBk9X6sYMbwCRYRobIyLVNP304vzzciB1+1bTt1/f2XBmX2KQLKGHqRdmOm8oj0Su6y/MY/J2AJzkkexqmxk1bm2lliyLyInP8C5LdphK4UAcGa7S/pQhZUGa06iTe2or8Hof2S3Gy3KDm4R/FSWJHXhXQE33yfqtDbaCGDqs6HDvikuCD01apsHN706cuMEnwMy67DukfjiQFzyqyg/h2XliNmtDYoSC/U41SrdhndwbTszZau6jIPlWjz9bGXz3Ziqt9vQdA/oaMNX9IS8wpdlkzSZE3EVVCM7HnTzUQ6EdQU9yE3/oDATywwaBsKRSwIjRdz0136dZirfiPQ8rVL44t0VEO4cjpJBzh1kfrCqkEbkgTHbif6qDtp5i1qYHnw4Gp/QFu4n04ak3BkzEe6+U45K7w/uZYrOXZUq6/HdFn1X0DquwFIVihndsPILlZr7DLUmg+5/uUTatx6SgKUGipwrfH1nz8uDQWt2fTwhH2KhHp+9+303mkd9FSpkVsfgqVI5u+zOyy6kSZLv/XVilBg84tn1k5DG0OLnP7ibnGEqYpAjDoZgoV7rw562srSNvl36284RjL81nYJMRKF8bMM+Be0C55DXi7h6XBEq5vcjXLwWwXYs2ur96eipQKfueYr73Y+tW9hzn8lRAUYYLH11Y1pbXDa3kKp6c7jQz44Gk83NydoTTKaCTuoplYdc6ShdXUAc7W1Uvw6Csf3k9sYS0uJyOqhaPePmsTlLF3/9k0byUXwPCFO+DZ7idriI/YyOr7G/AGsyDZmI2JP8n2BZAxr61ssF5mO7k+/U2tNPXL2CWoE6ShCzpnssUQswz9JO3OqGtiAB9+WgFJ8WdtkS/xN4aOx4bpEeVRf3SNViNj6CCq7xGMsLALWVQsm1eOkxKol1BAncnffx7lf2OynbEhkY0/zQXBiW4bEFuZh15vxrf/RmJ1qk9ns2bAAlPVByBpb7emcq+dM4dk0ziweuKhc91NSkR724llzXLy1x3DGcGjBCplpBupwfSST35TdAQQMLZgn9DK6xmNBTlxRkzKskRt2xfyLMH8or3hlkA+NZWM5L4E82bM8gHph48NL0rYLV3VdgmI17Ug6ihd0sNoH7xqpfitPvJYGvRp0CBy62MpcNovpSh81Bc6zf/Jsv7oTtezzaeHMItUtjuPGU9Pn0aPgLtVPO6yJwpIddn34VE2pgDNfZ474ELFc+fK5Yr4QOZsVQlrYjAAknAbmF0tzw4EeAgvi8vR+1k9/Fs8KGuE3JBNhRDxJLfPQFl4O+0uxTfkErb7sWp7CF0+pTPvoUTZnAgRYsozVpOyfUHyYxUVFDCpfC1Wia+CPVG5NIv6fKEqrzs9TIHByWgemImIkn1lgo5L/cFZMOwo2qbQ/TgFgDJsBtiJaoJNLbHfpmYvd0enMjjXgHrHjciQAM/6m328r2CRvbXCEoKNLHOcawX57QiwHCDNHRYEEFEdpGSyuCTO2sdGaUF97Hy0UryvLAkAzMASatSRwcMsFuA46rPNC0R/Vjo/v0VHgxrRIcJG8IM9cFBpaajdhvdNkQy0eEouLxN5KuHcdQUgf/fGeVW2el0klL+Bi570zVtw005II9N323mbRbNV5U5hBPDe0RJZNRhyd4n/yqj4cOERdlxEr4UwomKmYTZgshnIvTckVv5D8CVk9fEOW0FYDExW9tkxd4ugJfYAO48Clu8ipRlV1lzcnw/+QxlhRwXqvRS7+4djoVvSf6BoekyzCGGdLsb4sOpzq/X22T2K4wfKtdIqyX1qh1W+A3NTctRKmqJtLjla3e7yKghejqVchPz3Vn+B2gxifysYr1kWJ9r0TV1zTue60KQ1fxxrXKTgSDg1c/T6SGvCGhgbOOyIk+3GaksltWHwI76v7tcnrUMJlzUvVLFiulwPRJJZTlfmUu/vZG1KSMp2yxavZ+JtSTnb0giVMsyh3pwkCwaE6VotiYD22uAH/UJcDh7zff78aSUFJxKug9hQZHql25UvCLPg4JucUj0hLHy99fUgljTEcU+6+MJGrMK/SCf7PeUBMIZB6OmX0Q/HN/UXHdKqPO0j3vd1Qm1Ka0ptX/0s5Jp3S+OMMwQYJHG03d3Vuhq5x02gBC5l8Io8PMxj4W4EkOgpe2i2Lgl/bLN3bKFK5N4n5wTKyPbtZdnKL3Xwzw3PKHj03zvJCQ0+Vuvj3OqON3Cu00WiDsbo0QNDk5ILylE6Yvy6G8pLZlDSlCYQ+jdxpKVdkoFBvOZWrz3gZ9SE++WC8C/AIJmYCR3bRU+Uz0vD/lnLx6IUB+h/eiLTVwuckawH6ux57H5QPYIDt2SxFNNopF0b5eHqtIPPAQ/H+MmilVoERYkNicnnIaodj0c6X2xzjnJx/LCAS+g5aWolkfbJwrsg6gWXa04Ps7VV7xcByu+RaJootUIJTMQ6kbE29mgbZ+WDn7H/3f7OE8SOgRnLnYSUCpeScZlj9lnB22Klnzas6vkJd7ax85DgpP+ARPVAgBye1AigHR8q6tZ+WmLjgzwBNmtdLvOT4MexS52mOTp6C51/rGbXqyyYoiGsm8f2KKETvqLRsu0HcQvbZEP2l9cTy/QXgPJBIt0Bks7UP6TKxqJSbuvdtToMDBEPQDt7LB3GKWBEDmW2yC1hEksfag5iPUaNvVunD6bXe5TvphRD9ydtymyn/hpUKS5ANjJ90b6MLyWlmu1vYzNPfKgTB9eqSUjoQRJ+9Saqixhov299vzO/u2C5YK2blGpD/Y9HJnT2vYPe/VKTTWZErzq9K8gxYy/Mf6FXu9HSjaIC7E6qRj1kyvNrbWvcKzQzWuq0v2Jg05Kn4auPlpRo5a25APAgPZh4Qg0zsQJQPrCU0r8c4lOou2JO0o+QEJlVTZqG5EGAQteKvYolFU8lRraaKxtbnjT1UjCT1XHFSbY/pCzaAaUyINgjOR5k88tcr5xZEBITiFxvL6YXyVaqIZFM9BPE9ocduKlqYC4S/71GbnxezhuGe7XoB52efZh9xbLQ15mzrNhCUcTtXFEFs8A5Yy7PiXHRy5qNDcl0xPyC6uiFZyHGG6LQK3cvhlL+oxunbBySCV5IiBF/TDQAhu4M51BhbK8W+CViIOaQPGDRpwpIer3+Ngzk/MDS9im9onSJCSQVGHNaO7VqE7/Aanw9nwJLLJI9E62XYMVrMfPAR/t9g28aZWVyHH2cvXfIJgOkurLLWRoxdaKA6XE15yvswJZ/rBT920k1s78pl8x664Zx4e7qbL17OXmZ6YEELunGVv3/8HSfq0rV0FBAQI0suishbwlfvftOEfiXXnINrAgeDPBC4e6H2h0qPJmqLIKooCB0eI8ewgs0wrGkB/m/RlHaYO3mTRVKb70t+S0Vs3Z6mPFeR2VDRKBiDoJYxdMLQJizopLaFsmLmQpqYoCnc1DYzgn9ErcDprMNiP/P18IPoXZIJ3/fHN+4q+AdSzRyVR143X3eTPgb7m73Jeifn/FDw782gU58HFyWLsO267cUutBcSSub9Vw9eMFd5y/cR5ztDOeEq39QczE52UF65SLtRtiIDv12hyKz8a8Fq69QV0qdTYnHwKqjIJBqy+4In1l+fWwvpL3pO/OaDG1qR9qg9t29ocgnmFEP4SK2ePXESF2t8hfaqoX4clGA7d6JPVIm9LVd85Epx9h4zX/OPO+Sh7rT3vjAyyE59swIY9KShkJvqOGq7pmWKgDuxTkb9BMLuCD2pVeWrJWgT920zZQnn9EAn6ZCOvxDAQTsAKGGoWRY5qvjqUZehJyZeDe1jU/qExK1Zhg+b6G8ZsWsBlTFMl+na7oPRn/fC2xHGCG7bCfZit+rDxBs9shg9yiXxf+9vvLWzxXJwD6tiutLbnhBaHPNB5NbLrjz0VvNrLhvSdKSQPtEvcl+NyrUiD7jeZ/YfThCGvV67y3hiS8z6XpgrmMRO1aobQfTGn1uZzR8hVQ9imGJ47vPO3ClALYKrFNSQvrIjar5yBSyMZ5FVKqwmHiGjpVCK4AvEU2mvjty81biYyrerxPOQQULdt4kAoHoYSzuX4TaMjyPNCkRioY0Z28cXQGE2lvqJe7LoFiColDuBklasUmrx/H5M5gj1wa0QnivissUlrWnM1A+yfeHEilHCYSV9poD/AHCEOQzQobF74ze7viVmT8qnGvrT3mnh7YBX1qEoRhi7TZHS4GWEZcRMZpmUo+pHN27fPgw1beOcqvUn4WN78DefeZsadETuxk7QvZU0RbY+Q9S+P9NqI7Opj9aGQpSOqPbeQ52c9yiTF9wzurcRXolaAVhTRwi3btuCZU9wdMG9YEfnhL2xhztIZtS3akSmp5c+YdBXdrtMBFCxcEzwB3rpG0tZj4k9ONGqritAbuTRyyFFwked6YsGixAMRZX6lt7vQemoqbAY/NipQxe4BGJWXyX6T3qyj51+QpGNDK3CMyMQ6jxFBnLo6O3Z2NExPZbzg+PpDPnNLevNkZjldfhnuXWAM0BSzQPRcTrx8hn+204/kkWP9c3VZXI60E5V9MFQyRcWPAeW652MyCX4TGDrwQ5gUvpCgi/XiMimvdyRYAXJ/z7UE74xB5ixDD0JuOofVZienFeEPwH5tZ4wsUFlF7WQ+AT1t1xPkoJDc6FBZt2r+fRiEYRaBKhLVcofr4w4QF3oHFC1fixuXlA966Arouoj+QtVC2QU20cXN7w8vW0n33T3SgpT472IcbQJXuFv260AWosM2hKeguVjaIRxPEgNqK+wXgn2CNKhGG9zpOYfCejRejTQZQ56acs2mocez66Kp1j2lgc3Dy/ugb8+lx635Cc1dNc6G6ECkUaYxAoqeegQd3dgSYjLXeyG0VPGcddhWO/s9EnMgkTzpEcwKYDWw36bLNQbL2RR0PAuoDQGgorKNPf2SOy9XIc+q1u7015jC9YPSJcwA/m4sPXQfobLxgsF3LUG7gC3b65MgtCtEYcEkoAbgyTW/IphuGToZukR7vpXZeWfgSUn4MtgATOF+YwZPHPksXWq8f0UWVGKY+ppOUBk9Oelf/E4ggeSm0DL8LLhG4LOJXUyxjOdhOUKB0PFo3plXPjQk9zN19AopegxzvMtsgfWzQXJkocrWAoLrcPHfF+7TW98m3bCojZQgf26zW+7XgxA0eJkOw5nb33jf3Rgo3QRWgYIH09w5GR+3Q2vs3K8LxwNj7DfXnKWrfb1OeNthryXC3Jv8FnOedu5enAWvUt3Hm6KDw82Cq4dxauR6e2Bdpf1g+EG+jym+JkyKPkaRtHnHyrRFIbrKEQbNsaxwmJ2T62CC9m9lAXue/TV42uhEKDZPz/HsL8ye1rQax15bX079nythJO0c5xGbfbH9raIxBvS2CicMKCa+bY/AOpZ9SFdWujNlvdqaf1jgAW1g3IUHRzWMYyFwizNs3ugdqqKXxFFTsI1bT69+6udJzCJJ9r3CQz2+qF2Hz8tU1+sAmg9bE66vxJODreDtTeRHl9MqAsRTh2JWnzjlT62kI1GdhBzzuw2OAg2g0/P8m2Bv7QRKtejXHEux2DlsNaTuDjVNbEyk0V6yOACBRFxwgWPuYw1xdvKXP2QqGr1yPFqq7mWex1QyryqKWendVgCUrpTJSLy+yRGrZ/vsNBRUYqptyKMqVLeqrKK53rX2+PSxu6Q1y2o7nnbmXz/jypz1koG+KgO8c3GPa7yuaYrRilv/4rYCdT9de8uRAkTNKmU2RmdMjCvbyhnVaJZGILMfJNfWh33FPQ6MDAeX2HW+5r8Ae5lghBnq9bMCbtv/0R62NrDXnk4N0mIiffMtmYy+9cHxREri1blPOSl0ecw05YgAQMDFvYUZRULi2igE8pkrD6+XQkH3PhxD/+GS8VY7Yw2QQpVjYVjJx7gJb5QXA4O/DxETG6NYEvc0vyNKZoXyN+/bl8/2Kyy8N5Tr4I7JsxV/+4LlL4xW+VLCmfge7R1R45TJ1/6ZdB5cuwSQ+n2stqXzsKThoqRFzHUVEb03Uapbu0W8hdH+MtElPnZthdLaYYHygAHP0OkR8TTJ8QsQ6u7Rk/gw1H9vyXip+Zp7j0mBkM6Mh6o6q3sTMfNu69MffxmE9xpyLo0qX7nTT+eyPIsjFKN7ixgt1dPFHriQ/cx8+3ZTxHkOhKRjzgGixwOsg4+uUoJnBBmjarOCybJ5Tdi7jRjVUUV1U6jAEu75NL7byS3t2QrBk62ivV+6l98rzNR5HIk12LXVszzOSK35KvXCDAOr09Cs+nhiAd9HtFjkDjNAXs2jE25VFHzjOrTKdqYJ970JYNlBCTcsElfpduqMwTdT5SircKDhCLjhAYzqHxfN41BaCwZh6Pd5R8RrTm/wNRimfupUyOiVB8bmTIzxyehZI42vqvUKjEYgJFgXAbxzKZVuOhrf5bBL/886U403eUWWlNgNuC8dfBrr0/Nv1B9bBe2gsiYJNKnMtflQ0WV3mDW/3wzF4Qp2/Gq2+GhLarDQbqPtwhcVt3X1/HjQSo9jAwatiCZtVJGeDgn3PGBy5uOdBH1bSgBLxSYPKb21JpQ/t9oWDytYQaWa38mQuISwvQr7G134FMf3kGdErEsBOPgOMKszpFTiIX14JzL7alEpG2GmmKRq2e0EP6xORN2ZOpgkqr6BAf7FMxI0Zf+mRFJ0/m68ilNGjqILanvMqvHI8H1PJVCkQvKR1TlXdpXUbmC1xYyR22Vud/wtMdTm4xmexq49ZxFjLsna9oXoXWO2gxfG2u8MnPa1Cjb4vBisQc9bhwAy0FIMrLOpR0eCvO6jdV18A08Trza8mjKD0sUtMnFX+XnnjGS81h9IyzWpskK5c3OOrtipH7puY9PVSJLxkWYuvRK/ZYntnfskN67d/19W+qcSidJNwfFHIWXRVY9DRMNqViScEMoG4Xs8dA4Yx/HAszJjPbA7NDaLuPSdU06btCLRNoIXyGzgn68EOfIQ4YaIMKSgR8PvP5Lvrh9EV/P6q8BJvpbmqklSi2WmQleaNbNnRaxPmvGkhw4lrVaeIDHodA4uBEeFTao+oLv9GzpWowEyeiTwd+Tzq7UP2OS2EwFMcOtCIcaDSk7WsuxEQVnQQA2sHes/TOzTT/g3WaKeJQnF1RqPMgZadP9WsdKKrIcsYdc4nD/olYHY6rpcspl4MPIF/kZ8HUxlmP+HKsVUFxmeWITysG/hAWiE/SMjiKcWk1oMw5oYoTkMz70mXotcSyIlY5DcIEd/RLA3BMggAsDORQy/4LKDuxAbxZth3bS6FFCLK5R7uUW7d3aTfnbOOx7s/rtTO1iNySnfFQcPEuQn8xcTxnGw61rD0uIrbRRAsGUY8PTAeJZNln4yztpSHnKSR7uLlnCJVs7WgHieVJ9r7sp4LuRJaO3q9g8lSvS0FmSbTOUoIOh6ellSmsPjhBXGPi3WM88GvOPdkz2WgWczw3FobZg3EUAYK16rZIOWk//h2W7QReIG9QFZ37qT1Sr9WGRo6daHXtdlLUz+BoeyESPSL7rxqdxngvuT8RLoVNGrqj1s6Pe8GmMK2yShqU7NzaBezty240K5pkgJNgPjgpIRjDurAEhtOMFHatmHoSUugSSWKFHyllQKEVPGnas+c9B5q2yYSyIX81SJSA7QoshMwj/Ae7fEMi09lBYZE+7ArnJUvSW0J6DUgd+K3Y1ZqgZNDX286v0nM1763iqLHJGjvnjU32r2jWN33wPrXdaSLUB3vXiJ3cK1Z+to4XYWepapaCH72AkCItwSOj4elcXpNYMxtIzKZrAOtRZPeur76aJQVBs788AqBV+CQzX/p1woj7GmeVuhXGRIR9SziSxAcWS+59XhNpgh6z+v+FXERRrEbNOesHXFL3fAg5+gE/XESAWpo4fyK8RnsRN70jegVZLulYALgMjRJwrsBnAwY0xfPf5SyS0mzSyVrfF2Eydx8ZkIlIX4SAV82piX0/1TFtUfHqi6XwjgV2cERzGxBT1EWH+mjqFsNogNgN9QhINYJ4hvnefbW2S/co9vq8WHlvyUvVKvdn0ZK1nwU4BPWTviSz9VI14sOAvmHeztRQ/guCGVS75TFJU8XysLuMQw+8OoBJrjBIz64WT27icuKfJ7ZU2Sn+BLgOn6fxbGSEyQJVUJhGmb+pnpk/Z2HJwqfGkRVOPeMjePZuQRVhkPx99QU4vuI8x9gr9H1VTOBGRX4eMKdOpI9fSrRlTreKgXOCmDJZzdBqzAgwhXE1qUNUw5vm5klmO4DNO9SBTE4lkTm1u0wzrzP8JStjBLXdXCIlXG9qIRwcW2QrGIk1X9KUrRtnz41rRpCkcA94S/flk4dyJ8eQrakBNlVbquZDVC1XmuwQInXUveLTGTNdmUw8BUTU62kYys8i00a28UtGpvBq6vgT9UpJiX8EsUf8uXpNaLNiG7DoQjSXOATXSoHLQZTm3FYuyphnGTO/MEIfxfb7RItlH5UtAZcaDQO/r7ZftzZoFULHrcVBcMpLhhyitYq4p4Er2S1opZkec3c46WmpFaaoBO+uM7EGx/R5HzotrKfA5EVVVpXknxO6fKvxxoxvpvwYYT5HXESAkxAk6XKJEfx4W/F/kTIwzY10T7KHVaVt8eTSKwF8N/25sS8OQNPPCOvg758r2DAXK+5rFCT17fdiwkKiMG6RPjX9DeoO+q1ASDt3egehKbr1lLPgwwsWcHf7FPnGxInQ9AM/UG85eTKu9ny7dm7NUWn5QmzYtz5x41wMHZBOXhv5mAPEsZZHZbChxulrAGeR4c3vkdDx+qJDAPmR0UqJlYJrmASeiaqxKPtjqbvgeeIphOMtuqssBg1RHdWPu60PnLSVEhdubnv8iFVSGCSJ/lNsN6/86Zpwa/6IYD7BW1dmpHWRBT82AU3r2hx1KD7B3A0xerrLLxTeUnpy9USkyDSUL2CA2hlB/xqxWt6BwnTqCN480ulET3rKcUL0q0uY9n3qekyz2iQgEI9PiiUUQov33oRsfWuYxAllbsY72YzTKxFiELfibLKokBPF9wHa9FVxEdBgDxlRuz8ToaOXgLzHR0kZi/Q9tlDvj1zo8kiF2dW59WjEOR+qiBAwBJ4Ntu8a+fvPU5kUUHm6KqgFVZy8D3YNFXMVSuXAcn4a4iTdt8vjNhp+7FxqY2whiMzwA1Ln5ERU6rYFRlFW5qi+wymvmYEWDcHgtXj/V7IoN1tf+DFK6hnJw3T/wfEz+Rqn5TnIaarIg2eabNzboXNqsft/X9a0jh7s/HoEiFozYY+Zz7C3P99RPIvRPvQyrmu0Rrrv5LXpoO3Wl/Bkd6KRfGeNf8oA8wucy+fcbM9opqPb+h6CcgK/KmKOETzfU3fEm0PvOHj1tATNcoIxP+OQsm8X04qXtymsHBffvcNd80CsCzyEOZIEwijIlAiO0vonp2/+Mc/TOb3JyJ682+dfqCk+ydGU6zSf66Es9s8v94QD7JRUGvhT3PGyzWYUA+dx4xwg2xzEO9IVYbLvlYBJSS4oppfireqzqqY5SIJAEdAQELsCFOlWFbbKdHr79bqUnRZFjRowI3BuH85/QqDAodWEYES5uwojg69DuyltLixDHEHB60MbXSPVuEvVkWYkN0ThPDa6f6d3xBoE1KbOaxyuglGarGlisDBPWB7rLj0qI76vGdhCXNRfVkq2jNoSu0IQjQkKFUkttqTEGaYOZYjqW0lyrwvk3Jm/9BvsZfqnT77oMl5DQZS8G9SsyfXSNHW61DzkqOEpFYRrtaaoIty+iD/FoShLaQbvFwbiWwv+RBlN7htt7BYcpEsWvVczAKgGkwFopKl0lvcevxVIPJRVkPMoWSNA4QiaBJoSIN+FCKjHnV8grOKCco0TfktI87gBfGCXF3t6wbXaEUznbWwWzrC/5L1sO6K7UlCmBxWhNwfhl5DDIiciwRbmdIxlrEPIgJ5YIpuPNGqljKYiqOBEe0pVmdEr7jlF1+J4N8ZU/E8E1OhRm9iVN+kNK+iPE8aEmuhDsFwhuTRDcPin1SBg6tnm1bqw4WF5UWOi5AytlVUSCUed4zHVduGtFL3eXbLfzHY8XGesSRHT0am6q/QyhgQAGbo/0XW3O2iSG09mWlYP7qN13Kwf5PkJlVmYgrDRwpnE2ZvxkhkgACoycghKRPW5cE2SwgmNwNU+SIMFauftCiRBWOUIUMz9IveIFiJj3yJLzOn5U5Qk1ARvii97nBPTr1zg0KaFtxU6TMZQAN4AoJy+Oj0cbaUP0cgpRcgKOhRXTqZJYr4hiK3EOjUu2/KauzpT8s3aJkaAPsvR5sbxSjAF2b3tGUePWb1SdGEXknz4eVwf+NfZhXInVQtmmARzthGnb5ngHNY8zgMNVnq44k8/hpEWKFfadkIxKTYnBNFFOw7q/Gh2wWO6IC63zdmsjx8aZLS96XzGOJBIEDrxbn9jGs9Hknsx/Lo1BXrHgQjRsfmqn1uhtHP2Xp45ZKMXhNZUdf/ArCkCL3y+7Vt+SXD7nYxzqQ5XDXmGx8rzHBGV2Gd/RN2jGOV05LruVjI1/RgUOovE78wQauxrxJ/CFtyaOI+nXMFHgPgKPYX8uaib1gmwyZMkJjbCI8602Je7V2LwCwcKWlacCCu3O3xQ0YMmn/uxFPKaJNxRrahsh7pvp6F+k+AulKB7pzTztxE4CHwjCZelWysEN7/Cp/V303qpQzWxnKk1z5/Ygx/ryR9QQEr8NaNUICdRUx3MiPI41XxeIsvJtQZt/twfnvSkVkfxvXNdAdkchPvN9grNERbhs0y20xkhmgwi0NlxytvpoxoFhCjen50yhCE6b4phy9PShtoaAiplmWHkfZJ+IqF9W1Wa/w2iS0LoA1rKs0a6BTHv9dQiIPjWmQbHWPvJQqq0Iu1EXyVqhgTFOjqfZUlZw1Usxkcpa6bWqk/URT/QDRpN2MuHHKOlYeMRtFtDjjTpi4U75ZY8hP3Be54ge6k+BXQjZDvcvijfLcO4oYCx34grVNu0HuizCG5Nk/BfO9F1hxFbTV/tpDkUokbxNsLzdIfdSL7Y2yW7GuM35OiKhn7MQ8nEpQcFD5FYZcsiMfio2iEb1wusEV+V6M3CNCDXI7/qg/KlaSE7CNChRvMJa8AN5foNqgy/9B74X6C78XElpH+LWqs4HKaekkGRk4A2M+AlGWGU0pHSNhSkPCpBrnJDjOiGrwWV8US6TpfYI3murdHMx/6vhvY0YEwdzPjtLojTG0f4Zek0BUCsxvpeTgy/UbvTalK8QXxZRk27+XLQtbi8/PV33tHkq/aow4bjEJaZD2dhwR9VBfF/aKTc2AH2d8jKkgkUoQqyBvDtiCrrLm3xEyZEJv/NsRCmIVgFZIMqGtKRJg233bqTALr12fav5KNq1ZpTGiPdPYdk+xK0Z7y5SI5p+pvTUVbB57PBJe5xNfbx9tMWjkS27G077H4cPdt86sx+MUjJM4n8CRq3rmBJ3c5r0qo5gc6v94CbcZHcEKTzzNw4d29swWFwV/woXEWIvxmFmRABsY5QtVEGyC4rDtbEVqvoo9uBYEb1jp3RZVyry9OPzHyiu5RAplqPTnkhtqJFdJzYQg9Z3pdBPZkEDKQrp5+2IuFtrpf2V4EhRGJWxunYqLaHZPRdojPg5UGn/F6PJXK3Tthgz787ugE34/prhEqEs56Nny+U8u122rKYAvJNgk+tRsMa9gKXGJLjUOoYKD4TuvIru8Efdm+1/AnUZw3gWT5kaBxe4l14HbWZow8kvYzKizM0S+12Rng2RGvYi4TexIGkoV8IZx0sTVZFngrAVdCv5D+JdvsIWP3q7OppJyikdwFLv0OFtbnrYkZ3FwJBe/CfJzd4hnuh8OgLo9XReGRn+VJK2tnxOeat8jp2TJPCKq0x0QYu499Up/JBnCUICTp5IpaLRt/gVV7Sg69OLvdeheI7lxJ+TH1RiunUhpZuZIVgIiygkPAWPn7x3zJLD4IlaNDCuZNl8iysd3ub5YbRCe/VgcwLeLarsbkptY1tI1NNqWcMcASljUq/y+y8vXdKL4YDOr3/+VNjKFmfyKe55StcwDdXQJfOI1eqNLczBMRdEBpHeT2XMCrRMictfojR1FVYF216xPfRLewmv005UPNSwvzNwdSAYHHQYLpGLG8r06RAtesSVT2qNQcpQ34+kuEDI5mgu6yB7f67+MplSjp/3EtmPgqn+SvXeInxX0GHO4jKA6F3WGzxGvLLq0qbxpHQY6xECWZgeH8uqKBuKhWtcqtXZ8MXXZGH3qzMMwLBmTCcvSndZ85Y3/g5+wWvwQYZwFLCEHQcbVcWZMro40QKGct7Fqn4UXPJgzcP7O34MK0kL4cHrrdA9eA9a1oURcTLS1ongCdKX5wsaggLidzB2KN2M0PN+aM7XqXxqYR/aKotWjie0+ImaNJD6AXgWT8UMPpOxtTLKxrm1c7yyWiDjX5xStE5rFT278a5gHoq23K2Vwedv1p2NglILLz5Ls/bOb+q9kRy4F0/QCPzK2aPF5R+uEGZPHC0rVYuX8UGBWVL481VQpWhUIwRjoKeWkmLyiPMfPk0DUeU1vWj/IsSXnvZlpta5Xth1jW1c+2FM4kG4Gvu+H6ipiCzNe5jPCNe/triGPOrdI2CDHJlv88mSb8TCW6cSCwIkXW7TEiNPLhUUX6c7mOQl8Xj8oWPZs/OUWkR3JTtq/qZ/j5Kp9zfFKod60IRicHemaD0xHecE0Z0xXmw5DfgEooasmMBAWfXcT2cr14dRO1j/E9prRs4elHUJOvbBdRJdeKfaDhyloh3wRCOHFb6x8WvvteBqtmhwLp0zBkVuzv4rGvJJqZwM2o0vplRcodD70Vhst33x1YOR+/feH4VmCXffpKxIFh594KnOfcmoYQ6CbxTBr/i2XMY6uv3Lnsd9sRkWm53jJYPZte5GeDoPsUDO1kmsEL5gy3ASm5wXOuwYUXAVQcQbrurUd+fzWLByChO7b+UcL1lhBJDmazvoBgttSRLxT7D0Z9nPoTvsiNouWUFVpjnHlYeDoiYGqBMw1E7oxTS6C8jHko32oB1smbWWTWDtF+SPjDaxQaVi+uSHx09Ug7TrzglBTDPiAdMDSAESdbuyXEI0U4W6sWoWEk2zKrIDkH79z44hGj97XX/EekO4BPQAAA=';
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
function start() {
    if (!ready || chosen.size < 2) return false;
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
        decision: 1 + Math.random() * 2,
        boost: 0,
        cooldown: 3 + Math.random() * 5,
        finish: null,
        phase: Math.random() * Math.PI * 2,
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
    if (chosen.size < 2) chosen = new Set([0, 1, 2, 4, 7, 8, 9, 14]);
    $('roster').replaceChildren();
    CARD_ORDER.forEach(id => addCard(id));
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
            r.formTarget = (Math.random() - 0.5) * 0.18;
            r.laneTarget = (Math.random() - 0.5) * 38;
            r.decision = 1.5 + Math.random() * 2.8;
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
