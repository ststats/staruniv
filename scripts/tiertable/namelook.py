"""닉네임 그림 확인: 카드 이름 칸이 DB 닉네임을 같은 모양 글꼴로 그린 그림과 닮았는지 본다.

글자를 읽는(OCR) 대신 '이 이름이 맞는가'만 확인해, OCR이 '방늬이이'처럼 잘못 읽어도 닉네임 변경으로 올리지 않는다.
표 글꼴은 Apple SD 산돌고딕 Neo인데 리눅스에서 쓸 수 없어, 그 대체용으로 만든 Pretendard(OFL)로 그린다.
실측(티어표 1장, 이름 확실한 카드 135장): 그대로인 이름 135장 모두 통과, 다른 이름이었다고 친 675번 모두 걸러냄.
"""

from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .layout import ROLES, ROOT


FONT = ROOT / "scripts" / "assets" / "fonts" / "Pretendard-Bold.otf"
LOOK_H = 32  # 비교할 때 맞추는 글씨 높이(px)
LOOK_MIN = 0.5  # 이 점수 이상 닮아야 같은 이름. 실측 같은 이름은 대부분 0.6 이상
LOOK_SLACK = 0.02  # OCR이 읽은 글씨 그림보다 이만큼까지 덜 닮아도 같은 이름으로 본다


def _fit(ink: np.ndarray):
    """잉크가 있는 곳만 오려 높이를 LOOK_H로 맞춘다."""
    ys, xs = np.nonzero(ink > 0.35)
    if not len(xs):
        return None
    a = ink[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    w = max(1, round(a.shape[1] * LOOK_H / a.shape[0]))
    return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((w, LOOK_H), Image.LANCZOS), np.float32) / 255


def card_look(crop: Image.Image, bg):
    """카드 이름 칸(배지를 뗀 것) → 비교용 잉크 그림."""
    a = np.asarray(crop.convert("RGB"), dtype=np.float32)
    d = np.abs(a - np.array(bg, dtype=np.float32)).sum(axis=2)
    return _fit(np.clip(d / max(200.0, float(np.percentile(d, 98))), 0, 1))


@lru_cache(maxsize=4096)
def text_look(text: str):
    font = ImageFont.truetype(str(FONT), 48)
    img = Image.new("L", (48 * len(text) + 40, 90), 0)
    ImageDraw.Draw(img).text((10, 10), text, font=font, fill=255)
    return _fit(np.asarray(img, np.float32) / 255)


def look_score(look, text: str) -> float:
    """두 그림의 정규화 상관. 폭이 30% 넘게 다르면 다른 이름으로 본다."""
    other = text_look(text) if text else None
    if look is None or other is None:
        return 0.0
    ratio = look.shape[1] / other.shape[1]
    if not 0.7 <= ratio <= 1.43:
        return 0.0
    b = np.asarray(Image.fromarray((other * 255).astype(np.uint8)).resize((look.shape[1], LOOK_H), Image.LANCZOS))
    x, y = look - look.mean(), b.astype(np.float32) / 255
    y -= y.mean()
    return float((x * y).sum() / np.sqrt((x * x).sum() * (y * y).sum() + 1e-9)) * min(ratio, 1 / ratio) ** 0.5


def looks_same(card, nickname: str, role: str = "") -> bool:
    """카드 이름 칸이 nickname으로 보이는가. 직책(교수 등)이 앞에 붙는 카드는 붙여 그려 본다."""
    look = card.get("name_look")
    if look is None:
        return False
    roles = {card.get("role") or "", role if role in ROLES else ""}
    best = max(look_score(look, f"{p} {nickname}" if p else nickname) for p in roles)
    ocr = card.get("nickname_ocr") or ""
    read = look_score(look, f"{card['role']} {ocr}" if card.get("role") else ocr)
    return best >= LOOK_MIN and best >= read - LOOK_SLACK
