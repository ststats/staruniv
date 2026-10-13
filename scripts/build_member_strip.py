"""홈 캐러셀의 멤버 얼굴 띠 영상(docs/media/home/members-strip.*)을 만든다.

입력 서명이 배포된 members-strip.json과 같으면 배포본을 그대로 받아 쓴다.
환경변수: SUPABASE_DB_URL, SUPABASE_URL, PAGES_BASE_URL(지금 배포된 사이트 주소)
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
import psycopg
from PIL import Image, ImageDraw, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
REPO_MEDIA = ROOT / 'templates' / 'static'
MODEL = ROOT / 'scripts' / 'assets' / 'face_detection_yunet_2023mar.onnx'
OUT_DIR = ROOT / 'docs' / 'media' / 'home'
NAME = 'members-strip'
FILES = (f'{NAME}.webm', f'{NAME}.mp4', f'{NAME}.jpg', f'{NAME}.json')
FF = imageio_ffmpeg.get_ffmpeg_exe()

# 띠 모양: 칸 높이 · 칸 폭(기울기 제외) · 기울기 · 칸 사이 · 영상 폭 · 초당 장면 수 · 흐르는 속도(px/초)
H, TW, SL, GAP, OW, FPS, SPEED = 426, 354, 68, 8, 1920, 24, 240
CW = TW + SL
PITCH = TW + GAP
BG = '0x13223f'
ZOOM, FACE_Y = 1.18, 0.44  # 얼굴을 담을 때 확대 배율 · 얼굴 중심의 세로 위치(칸 높이 비율)
# 얼굴 검출 비율이 FAR_HIT 미만이거나 얼굴 높이가 FAR_FACE 미만이면 멀리 찍은 영상으로 보고 가운데를 쓴다
# (가까이 찍은 영상은 얼굴이 화면 높이의 40% 안팎이다).
FAR_HIT, FAR_FACE = 0.5, 0.25


def current_members(dsn: str) -> list[dict]:
    with psycopg.connect(dsn) as conn:
        conn.read_only = True
        rows = conn.execute(
            """select btrim(soop_id) as soop_id, coalesce(photo_path, '') as photo_path
                 from public.members
                where left_date is null and coalesce(btrim(soop_id), '') <> ''
                order by joined_date nulls last, source_order"""
        ).fetchall()
    return [{'soop_id': r[0].lower(), 'photo': r[1].strip()} for r in rows]


def media_source(member: dict) -> tuple[str, str]:
    """('file', 경로) 또는 ('url', 주소). 대표 사진이 없으면 SOOP 프로필 사진."""
    photo = member['photo'].split('?')[0]
    if re.fullmatch(r'media/members/[a-z0-9_-]+\.[a-z0-9]+', photo):
        return 'file', str(REPO_MEDIA / photo)
    if photo:
        base = os.environ['SUPABASE_URL'].rstrip('/')
        return 'url', f"{base}/storage/v1/object/public/staruniv-media/{urllib.parse.quote(photo)}"
    sid = member['soop_id']
    return 'url', f'https://stimg.sooplive.com/LOGO/{sid[:2]}/{sid}/m/{sid}.webp'


def signature(members: list[dict]) -> str:
    h = hashlib.sha256()
    for path in (Path(__file__), MODEL):
        h.update(path.read_bytes())
    for m in members:
        kind, src = media_source(m)
        h.update(f"{m['soop_id']}|{m['photo']}|".encode())
        if kind == 'file' and Path(src).is_file():
            h.update(Path(src).read_bytes())
    return h.hexdigest()


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'staruniv-build'}), timeout=60) as r:
        return r.read()


def published(base: str) -> dict[str, bytes] | None:
    """지금 배포된 띠 영상 파일들(없거나 하나라도 못 받으면 None)."""
    if not base:
        return None
    try:
        return {f: fetch(f'{base.rstrip("/")}/media/home/{f}') for f in FILES}
    except Exception as e:  # 처음 배포라 없거나 네트워크 실패
        print(f'   배포된 띠 영상을 받지 못함: {e}')
        return None


class MediaFrames:
    """메모리를 아끼려 프레임을 쌓지 않고 순회마다 다시 디코딩한다."""

    def __init__(self, path: Path, video: bool):
        self.path = path
        self.video = video
        if video:
            self.count, _ = imageio_ffmpeg.count_frames_and_secs(str(path))
            reader = imageio_ffmpeg.read_frames(str(path))
            try:
                self.fps = float(next(reader).get('fps') or FPS)
            finally:
                reader.close()
        else:
            self.count, duration = 0, 0
            with Image.open(path) as image:
                for frame in ImageSequence.Iterator(image):
                    frame.load()  # WebP는 디코딩해야 info에 duration이 채워진다.
                    self.count += 1
                    duration += frame.info.get('duration') or 0
            self.fps = 1000 / (duration / self.count) if self.count > 1 and duration else FPS
        if not self.count:
            raise RuntimeError('영상에 프레임이 없습니다')

    def __len__(self):
        return self.count

    def __iter__(self):
        if not self.video:
            with Image.open(self.path) as image:
                for frame in ImageSequence.Iterator(image):
                    yield np.asarray(frame.convert('RGB'))
            return
        reader = imageio_ffmpeg.read_frames(str(self.path))
        try:
            meta = next(reader)
            w, h = meta['size']
            count = 0
            for data in reader:
                count += 1
                yield np.frombuffer(data, np.uint8).reshape(h, w, 3)
            if count != self.count:
                raise RuntimeError(f'영상 프레임 수가 달라졌습니다: {self.count} → {count}')
        finally:
            reader.close()

    def __getitem__(self, index):
        frames = iter(self)
        try:
            if isinstance(index, slice):
                return list(itertools.islice(frames, *index.indices(self.count)))
            index = index if index >= 0 else self.count + index
            if not 0 <= index < self.count:
                raise IndexError(index)
            return next(itertools.islice(frames, index, index + 1))
        finally:
            frames.close()


def load_frames(kind: str, src: str, tmp: Path) -> tuple[MediaFrames, float]:
    data = Path(src).read_bytes() if kind == 'file' else fetch(src)
    ext = Path(urllib.parse.urlparse(src).path).suffix.lower()
    path = tmp / f'src{ext}'
    path.write_bytes(data)
    frames = MediaFrames(path, ext in ('.mp4', '.webm', '.mov', '.m4v'))
    return frames, frames.fps


def write_tile(frames: MediaFrames, fps: float, detector, out: Path) -> str:
    """얼굴 중앙값이 칸 가운데에 오게 고정 위치로 자른 칸 영상. 돌려주는 값은 로그용."""
    h, w = frames[0].shape[:2]
    detector.setInputSize((w, h))
    sample = frames[:: max(1, len(frames) // 16)]
    xs, ys, sizes = [], [], []
    for fr in sample:
        _, faces = detector.detect(cv2.cvtColor(fr, cv2.COLOR_RGB2BGR))
        if faces is not None and len(faces):
            b = max(faces, key=lambda f: f[2] * f[3])
            xs.append((b[0] + b[2] / 2) / w)
            ys.append((b[1] + b[3] / 2) / h)
            sizes.append(b[3] / h)
    far = len(xs) < FAR_HIT * len(sample) or float(np.median(sizes)) < FAR_FACE
    del sample, fr
    fx, fy = (0.5, 0.5) if far else (float(np.median(xs)), float(np.median(ys)))
    zoom = max(1.0, CW / (w * H / h)) if far else ZOOM
    s = H * zoom / h
    w2, h2 = int(round(w * s)), int(round(h * s))
    x0 = int(round(min(max(fx * w2 - CW / 2, 0), w2 - CW)))
    y0 = int(round(min(max(fy * h2 - (H / 2 if far else H * FACE_Y), 0), h2 - H)))
    p = subprocess.Popen(
        [FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{CW}x{H}', '-r', f'{fps:.4f}',
         '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', str(out)],
        stdin=subprocess.PIPE,
    )
    try:
        for fr in frames:
            big = cv2.resize(fr, (w2, h2), interpolation=cv2.INTER_LANCZOS4)
            p.stdin.write(np.ascontiguousarray(big[y0 : y0 + H, x0 : x0 + CW]).tobytes())
        p.stdin.close()
        if p.wait(timeout=120):
            raise RuntimeError('칸 영상 인코딩 실패')
    finally:
        if p.poll() is None:
            p.kill()
            p.wait()
        if not p.stdin.closed:
            try:
                p.stdin.close()
            except OSError:
                pass
    return '멀리 찍은 영상: 가운데' if far else f'얼굴 {fx:.2f},{fy:.2f}'


def render(members: list[dict], tmp: Path) -> None:
    detector = cv2.FaceDetectorYN.create(str(MODEL), '', (320, 320), 0.6, 0.3, 5000)
    tiles = []
    for m in members:
        try:
            frames, fps = load_frames(*media_source(m), tmp)
            tile = tmp / f"tile-{len(tiles)}.mp4"
            note = write_tile(frames, fps, detector, tile)
            tiles.append(tile)
            print(f"   {m['soop_id']}: {len(frames)}장면 · {note}")
        except Exception as e:
            # 멤버가 빠진 영상에 완성 서명을 붙이지 않도록 전체를 실패시킨다.
            raise RuntimeError(f"{m['soop_id']} 칸 생성 실패: {e}") from e
    if not tiles:
        raise RuntimeError('담을 멤버가 없습니다')

    n = len(tiles)
    width = n * PITCH
    frames_total = max(1, round(width / SPEED * FPS))
    seconds = frames_total / FPS
    speed = width / seconds  # 한 바퀴가 정수 장면에 맞아야 이음매 없이 반복된다
    offset = OW // 2 - CW // 2  # 0초에 첫 칸이 화면 가운데
    mask = tmp / 'mask.png'
    img = Image.new('L', (CW, H), 0)
    ImageDraw.Draw(img).polygon([(SL, 0), (CW, 0), (CW - SL, H), (0, H)], fill=255)
    img.save(mask)

    inputs = []
    for t in tiles:
        inputs += ['-stream_loop', '-1', '-i', str(t)]
    inputs += ['-loop', '1', '-i', str(mask)]
    graph = [
        f'color=c={BG}:s={OW}x{H}:r={FPS}:d={seconds:.4f}[bg]',
        f'[{n}:v]format=gray,split={n}' + ''.join(f'[m{i}]' for i in range(n)),
    ]
    prev = 'bg'
    for i in range(n):
        graph.append(
            f'[{i}:v]fps={FPS},format=yuva420p,trim=duration={seconds:.4f},setpts=PTS-STARTPTS[t{i}];'
            f'[t{i}][m{i}]alphamerge[a{i}]'
        )
        graph.append(
            f"[{prev}][a{i}]overlay=x='mod({i * PITCH + offset}-{speed:.6f}*t+{CW}\\,{width})-{CW}':y=0:eval=frame[o{i}]"
        )
        prev = f'o{i}'
    graph.append(f'[{prev}]trim=end_frame={frames_total},format=yuv420p[out]')
    script = tmp / 'graph.txt'
    script.write_text(';'.join(graph))
    master = tmp / 'master.mp4'
    q = [FF, '-hide_banner', '-loglevel', 'error', '-y']
    subprocess.run(
        q + inputs + ['-filter_complex_script', str(script), '-map', '[out]', '-an',
                      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', str(master)],
        check=True,
    )
    subprocess.run(
        q + ['-i', str(master), '-an', '-c:v', 'libaom-av1', '-crf', '40', '-b:v', '0', '-cpu-used', '8',
             '-row-mt', '1', '-tiles', '2x1', '-pix_fmt', 'yuv420p', str(tmp / FILES[0])],
        check=True,
    )
    subprocess.run(
        q + ['-i', str(master), '-an', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'film', '-crf', '29',
             '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(tmp / FILES[1])],
        check=True,
    )
    subprocess.run(q + ['-i', str(master), '-frames:v', '1', '-q:v', '4', str(tmp / FILES[2])], check=True)


def main() -> None:
    dsn = os.environ.get('SUPABASE_DB_URL')
    if not dsn:
        sys.exit('❌ SUPABASE_DB_URL 환경변수가 없습니다.')
    base = os.environ.get('PAGES_BASE_URL', '')
    members = current_members(dsn)
    sig = signature(members)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    live = published(base)
    if live and json.loads(live[FILES[3]]).get('signature') == sig:
        for name, data in live.items():
            (OUT_DIR / name).write_bytes(data)
        print(f'✅ 멤버 띠 영상: 바뀐 것이 없어 배포된 영상을 그대로 씀({len(members)}명)')
        return

    print(f'멤버 띠 영상 만드는 중({len(members)}명)')
    try:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            render(members, tmp)
            (tmp / FILES[3]).write_text(json.dumps({'signature': sig, 'members': [m['soop_id'] for m in members]}))
            for name in FILES:
                (OUT_DIR / name).write_bytes((tmp / name).read_bytes())
        sizes = ', '.join(f'{n} {(OUT_DIR / n).stat().st_size / 1e6:.1f}MB' for n in FILES[:2])
        print(f'✅ 멤버 띠 영상을 새로 만듦: {sizes}')
    except Exception as e:
        if live:
            for name, data in live.items():
                (OUT_DIR / name).write_bytes(data)
        sys.exit(f'❌ 멤버 띠 영상을 만들지 못함: {e}' + (' - 배포된 영상을 그대로 둠' if live else ''))


if __name__ == '__main__':
    main()
