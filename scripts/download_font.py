"""
docs/fonts/PretendardVariable.woff2 파일을 최초 1회만 CDN에서 받아 레포 안에
self-host해두는 스크립트. 이미 파일이 있으면 아무것도 안 하고 바로 종료하므로
워크플로우가 몇 번을 다시 돌아도 안전하다 (실제 다운로드는 딱 1번뿐).

CDN 링크를 <link>로 직접 거는 대신 폰트 파일을 레포에 넣어 같은 도메인(GitHub
Pages)에서 서빙하면, 외부 CDN 왕복 시간이 없어져서 페이지 로드시 폰트가 늦게
적용되며 깜빡이는 현상(FOUT)이 크게 줄어든다.

폰트 파일의 정확한 경로를 하드코딩하지 않고, 공식 CSS 파일 안에서 실제 파일
경로를 정규식으로 뽑아 상대경로 -> 절대 URL로 변환해서 받는다. Pretendard
배포 구조가 모노레포라 버전이 바뀌면 경로가 달라질 수 있는데, 이렇게 하면
CDN이 실제로 안내하는 경로를 그대로 따라가므로 버전이 바뀌어도(CSS_URL의
버전 태그만 맞으면) 안전하게 최신 파일을 받는다.

HTTP 요청은 requests를 쓴다 - fetch_poonggo_data.py/fetch_eloboard_data.py도
전부 requests(+_common.fetch_json)로 통일되어 있어서 프로젝트 안에 urllib과
requests가 섞여 있지 않도록 맞췄다. 다만 이 스크립트는 1회성 초기 설정용이라
재시도 로직(_common.fetch_json)까지는 안 쓴다 - 실패하면 그냥 워크플로우
스텝이 실패하고 다음 실행 때 다시 시도되면 충분하다.

실행: python scripts/download_font.py
"""

import re
import sys
import requests
from urllib.parse import urljoin

from _common import ROOT, USER_AGENT

FONT_DIR = ROOT / "docs" / "fonts"
FONT_PATH = FONT_DIR / "PretendardVariable.woff2"
CSS_URL = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
HEADERS = {"User-Agent": USER_AGENT}
TIMEOUT_SEC = 30


def main():
    if FONT_PATH.exists():
        print(f"[건너뜀] {FONT_PATH} 이미 있음 - 다운로드 생략")
        return

    print(f"[조회] {CSS_URL} 에서 실제 폰트 파일 경로 확인 중...")
    css_resp = requests.get(CSS_URL, headers=HEADERS, timeout=TIMEOUT_SEC)
    css_resp.raise_for_status()
    css = css_resp.text

    match = re.search(r"url\(['\"]?([^'\")]+\.woff2)['\"]?\)", css)
    if not match:
        print("[오류] CSS 안에서 .woff2 경로를 찾지 못함 - Pretendard 배포 구조가 바뀐 것 같음",
              file=sys.stderr)
        sys.exit(1)

    font_url = urljoin(CSS_URL, match.group(1))
    print(f"[다운로드] {font_url}")

    font_resp = requests.get(font_url, headers=HEADERS, timeout=TIMEOUT_SEC)
    font_resp.raise_for_status()
    font_bytes = font_resp.content

    if len(font_bytes) < 10_000:
        # 정상적인 가변폰트 파일이면 최소 수백 KB는 되어야 함 - 너무 작으면
        # HTML 에러 페이지 같은 걸 잘못 받은 것일 가능성이 높아 저장을 막는다.
        print(f"[오류] 받은 파일이 너무 작음 ({len(font_bytes)} bytes) - 저장하지 않음",
              file=sys.stderr)
        sys.exit(1)

    FONT_DIR.mkdir(parents=True, exist_ok=True)
    with open(FONT_PATH, "wb") as f:
        f.write(font_bytes)
    print(f"[완료] {FONT_PATH} 저장됨 ({len(font_bytes):,} bytes)")


if __name__ == "__main__":
    main()
