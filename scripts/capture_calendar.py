"""공개 일정 페이지의 캡처 화면을 docs/data/calendar.png 한 장으로 찍는다.

외부 자동화가 이 주소(…/data/calendar.png)를 가져가므로 빌드 때마다 새로 찍는다.
예전에는 Node + puppeteer(크롬을 따로 받아 옴)로 찍었는데, GitHub 러너에는 크롬이 이미 깔려 있어서
크롬 명령만으로 찍는다. 창 높이를 미리 알 수 없으니 두 번 띄운다:
  1) --dump-dom으로 다 그려진 DOM을 받아, 페이지가 적어 둔 높이(body[data-capture-height])와
     실제 화면 크기(body[data-capture-viewport])를 읽고
  2) 그 높이가 다 들어가게 창을 열어 --screenshot으로 찍은 뒤, 아래 남는 줄을 잘라낸다.
새 헤드리스 크롬은 창 크기보다 화면이 조금(지금은 87px) 작게 그려지는데 스크린샷은 창 크기로
나온다 - 그 차이를 1)에서 재서 창을 그만큼 키우고, 남는 아래쪽은 잘라 없앤다.
--virtual-time-budget은 네트워크(Supabase 일정·글꼴·사진)가 끝날 때까지 시간을 멈춰 두므로
데이터를 다 받은 뒤의 화면이 찍힌다. 결과는 어드민 '달력 이미지 저장'과 같은 폭 804px 배치다.
"""
from __future__ import annotations

import functools
import http.server
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = DOCS / "data" / "calendar.png"
WIDTH = 804
PORT = int(os.getenv("CAPTURE_PORT", "8791"))
URL = f"http://127.0.0.1:{PORT}/schedule/?capture=calendar"


def find_chrome() -> str:
    for name in (os.getenv("CHROME"), "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if name and (shutil.which(name) or Path(name).exists()):
            return shutil.which(name) or name
    raise SystemExit("크롬을 찾지 못했습니다(CHROME 환경변수로 경로를 지정할 수 있습니다).")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


def serve() -> http.server.ThreadingHTTPServer:
    handler = functools.partial(QuietHandler, directory=str(DOCS))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_chrome(chrome: str, height: int, *args: str) -> subprocess.CompletedProcess:
    cmd = [
        chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size={WIDTH},{height}",
        "--virtual-time-budget=30000", *shlex.split(os.getenv("CHROME_FLAGS", "")), *args, URL,
    ]
    # 달력의 '오늘'은 브라우저 시계로 정해진다. GitHub 러너는 UTC라 한국 자정~오전 9시에 돌리면
    # 전날이 오늘로 찍힌다 - 크롬을 한국 시간으로 띄운다.
    env = {**os.environ, "TZ": os.getenv("CAPTURE_TZ", "Asia/Seoul")}
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=env)


def crop_png_height(path: Path, height: int) -> None:
    """PNG를 위에서부터 height줄만 남긴다(파이썬 기본 모듈만 쓴다).
    PNG의 줄 필터는 윗줄만 참조하므로 아래 줄을 버려도 남은 줄은 그대로 풀린다."""
    data = path.read_bytes()
    pos, chunks = 8, []
    while pos < len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        chunks.append((data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]))
        pos += 12 + length
    ihdr = next(body for kind, body in chunks if kind == b"IHDR")
    width, old_height = int.from_bytes(ihdr[0:4], "big"), int.from_bytes(ihdr[4:8], "big")
    bit_depth, color_type, interlace = ihdr[8], ihdr[9], ihdr[12]
    if height >= old_height:
        return
    if bit_depth != 8 or interlace or color_type not in (2, 6):
        raise SystemExit(f"자를 수 없는 PNG 형식입니다(bit {bit_depth}, color {color_type}, interlace {interlace}).")
    row = 1 + width * (4 if color_type == 6 else 3)
    raw = zlib.decompress(b"".join(body for kind, body in chunks if kind == b"IDAT"))[: row * height]

    def chunk(kind: bytes, body: bytes) -> bytes:
        return len(body).to_bytes(4, "big") + kind + body + zlib.crc32(kind + body).to_bytes(4, "big")

    new_ihdr = ihdr[:4] + height.to_bytes(4, "big") + ihdr[8:]
    path.write_bytes(data[:8] + chunk(b"IHDR", new_ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main() -> None:
    chrome = find_chrome()
    server = serve()
    try:
        probe_height = 2000
        dom = run_chrome(chrome, probe_height, "--dump-dom")
        height = re.search(r'data-capture-height="(\d+)"', dom.stdout)
        viewport = re.search(r'data-capture-viewport="(\d+)x(\d+)"', dom.stdout)
        if not height or not viewport:
            sys.stderr.write(dom.stderr[-2000:])
            raise SystemExit("달력이 다 그려지지 않아 높이를 알 수 없습니다.")
        height = int(height.group(1))
        if int(viewport.group(1)) != WIDTH:
            raise SystemExit(f"화면 폭이 {WIDTH}px이 아니라 {viewport.group(1)}px로 그려졌습니다.")
        missing = probe_height - int(viewport.group(2))   # 창보다 작게 그려지는 높이
        tmp = OUT.with_suffix(".tmp.png")
        shot = run_chrome(chrome, height + missing, f"--screenshot={tmp}")
        if not tmp.exists() or tmp.stat().st_size == 0:
            sys.stderr.write(shot.stderr[-2000:])
            raise SystemExit("캡처 파일이 만들어지지 않았습니다.")
        crop_png_height(tmp, height)
        tmp.replace(OUT)
        print(f"✅ docs/data/calendar.png 캡처 완료 ({WIDTH}x{height})")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
