"""링크 미리보기(카톡·디스코드 등) 이미지를 페이지마다 1200×630 PNG로 만든다.

결과는 templates/static/images/share/<페이지>.png 에 저장하고 저장소에 올린다(빌드 때마다 만들지 않는다).
페이지 이름·설명(build_html.PAGES)이나 모양을 바꿨을 때만 다시 실행한다:

    python scripts/make_share_images.py            # 크롬으로 PNG까지
    python scripts/make_share_images.py --html DIR # 카드 HTML만 DIR에 쓴다(다른 도구로 찍을 때)
"""
import html
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from build_html import PAGES  # noqa: E402
from capture_calendar import crop_png_height, find_chrome, run_chrome  # noqa: E402

W, H = 1200, 630
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'templates', 'static')
OUT_DIR = os.path.join(STATIC_DIR, 'images', 'share')
LOGO = os.path.join(STATIC_DIR, 'images', '캄몬스타즈.webp')
FONT_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css'

# 페이지 머리 위 영문 라벨(pages/*.html의 data-label)과 같게 둔다
EYEBROW = {
    'home': 'CALM MONSTARZ · STAR UNIVERSITY',
    'schedule': 'SCHEDULE',
    'members': 'ROSTER',
    'records': 'RECORDS',
    'tier': 'STARCRAFT TIERS',
    'video': 'VIDEO',
    'stats': 'BROADCAST ANALYTICS',
    'tools': 'UTILITY CONSOLE',
}


def card_html(page_id: str, title: str, description: str) -> str:
    logo_url = 'file://' + LOGO
    return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" href="{FONT_CSS}">
<style>
* {{ margin: 0; box-sizing: border-box; }}
html, body {{ width: {W}px; height: {H}px; overflow: hidden; }}
body {{
  font-family: "Pretendard", sans-serif; color: #fff; background: #14264a;
  background-image: radial-gradient(90% 120% at 100% 0%, rgba(59,130,255,.28), transparent 60%),
    repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 1px, transparent 1px 10px);
  position: relative; padding: 64px 72px;
}}
.logo {{ font-size: 40px; font-weight: 800; letter-spacing: -.02em; }}
.logo b {{ color: #3d82ff; font-weight: 800; }}
.eyebrow {{ margin-top: 92px; font-size: 22px; font-weight: 600; letter-spacing: .18em; color: rgba(255,255,255,.62); }}
h1 {{ margin-top: 14px; font-size: 112px; font-weight: 800; line-height: 1.05; letter-spacing: -.03em; }}
p {{ margin-top: 26px; max-width: 760px; font-size: 30px; font-weight: 500; line-height: 1.4; color: rgba(255,255,255,.78); word-break: keep-all;
     display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }}
.team {{ position: absolute; right: 64px; top: 50%; width: 300px; height: 300px; transform: translateY(-42%);
         background: url("{logo_url}") center / contain no-repeat; opacity: .95; }}
.bar {{ position: absolute; left: 0; right: 0; bottom: 0; height: 12px; background: #055df3; }}
.url {{ position: absolute; right: 72px; bottom: 40px; font-size: 22px; font-weight: 600; color: rgba(255,255,255,.5); }}
</style></head>
<body data-capture-height="{H}" data-capture-viewport="{W}x{H}">
<div class="logo">스타<b>대학</b></div>
<div class="eyebrow">{html.escape(EYEBROW.get(page_id, ''))}</div>
<h1>{html.escape(title)}</h1>
<p>{html.escape(description)}</p>
<div class="team"></div>
<div class="url">ststats.github.io/staruniv</div>
<div class="bar"></div>
</body></html>"""


def cards():
    for page_id, _label, title, description in PAGES:
        yield page_id, card_html(page_id, title or '캄몬스타즈', description)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == '--html':
        os.makedirs(sys.argv[2], exist_ok=True)
        for page_id, text in cards():
            with open(os.path.join(sys.argv[2], f'{page_id}.html'), 'w', encoding='utf-8') as f:
                f.write(text)
        return
    chrome = find_chrome()
    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for page_id, text in cards():
            src = os.path.join(tmp, f'{page_id}.html')
            with open(src, 'w', encoding='utf-8') as f:
                f.write(text)
            out = os.path.join(OUT_DIR, f'{page_id}.png')
            # 새 헤드리스 크롬은 창보다 조금 작게 그리므로 창을 키워 찍고 잘라낸다(capture_calendar와 같은 방식)
            run_chrome(chrome, H + 200, f'--screenshot={out}', '--allow-file-access-from-files', url='file://' + src, width=W)
            crop_png_height(Path(out), H)
            print('✅', out)


if __name__ == '__main__':
    main()
