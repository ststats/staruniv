"""카드 칸 그림의 특징: 글씨 칸 잉크 농도, 닉네임 칸 거리, 사진 지문."""

import base64
import zlib

import numpy as np
from PIL import Image


def glyph_feat(crop: Image.Image, bg, width: int) -> np.ndarray:
    """글씨 칸을 늘리거나 줄이지 않고 그대로, 배경색과 다른 정도(0~1 잉크 농도)로 바꾼다.

    처음엔 글씨 테두리 상자에 맞춰 늘린 흑백 모양을 썼는데, 이미지를 다시 압축하면 가장자리 1px만
    바뀌어도 모양 전체가 달라졌다(같은 글씨끼리 차이 0.32). 고정 칸 농도로 바꾸니 0.04 안쪽이다.
    글씨 색이 구역마다 달라 가장 진한 쪽(상위 2%)을 1로 맞춘다."""
    a = np.asarray(crop, dtype=np.float32)
    d = np.abs(a - np.array(bg, dtype=np.float32)).sum(axis=2)
    f = np.clip(d / max(120.0, float(np.percentile(d, 98))), 0, 1)
    out = np.zeros((f.shape[0], width), dtype=np.float32)
    out[:, :min(width, f.shape[1])] = f[:, :width]
    return out


def name_distance(a: np.ndarray, b: np.ndarray) -> float:
    """두 닉네임 칸 그림의 차이: 다른 잉크 양 ÷ 전체 잉크 양(±1px 어긋남 허용). 칸 대부분이 빈 바탕이라
    평균 차이로는 글자 하나 차이가 묻힌다 - 잉크 양으로 나눠야 이름이 달라진 게 드러난다."""
    best = 9.0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            sh = np.roll(np.roll(b, dy, 0), dx, 1)
            num = np.abs(a - sh)[2:-2, 2:-2].sum()
            den = (a[2:-2, 2:-2].sum() + sh[2:-2, 2:-2].sum()) / 2
            best = min(best, float(num / max(den, 1e-6)))
    return best


def pack_feat(f: np.ndarray) -> str:
    return base64.b64encode(zlib.compress((f * 255).astype(np.uint8).tobytes(), 9)).decode()


def unpack_feat(s: str, shape) -> np.ndarray:
    return np.frombuffer(zlib.decompress(base64.b64decode(s)), dtype=np.uint8).reshape(shape).astype(np.float32) / 255


def _distances(feat: np.ndarray, cands, width=None) -> np.ndarray:
    """후보마다 ±1px 어긋남을 허용한 평균 차이."""
    w = width or feat.shape[1]
    stack = np.stack([c[0][:, :w] for c in cands])
    best = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            sh = np.roll(np.roll(feat[:, :w], dy, 0), dx, 1)
            d = np.abs(stack - sh)[:, 2:-2, 2:-2].mean(axis=(1, 2))
            best = d if best is None else np.minimum(best, d)
    return best


def nearest(feat: np.ndarray, cands, width=None):
    """cands: [(특징 배열, 값)]. ±1px 어긋남을 허용한 평균 차이가 가장 작은 값.
    한 값이 넘는 기준(문턱) 대신 '어느 기억 글씨와 가장 가까운가'로 정한다 - 압축 잡음은 모든 후보와의
    차이에 똑같이 끼어서, 문턱은 흔들려도 가장 가까운 후보는 그대로다(다시 압축해도 219/219)."""
    if not cands:
        return None, 1.0
    best = _distances(feat, cands, width)
    i = int(best.argmin())
    return cands[i][1], float(best[i])


def runner_up(feat: np.ndarray, cands, value, width=None):
    """value 다음으로 가까운 다른 값과, 두 값의 차이(여유). 다른 값 후보가 없으면 (None, 1.0)."""
    others = [c for c in cands if c[1] != value]
    if not others:
        return None, 1.0
    alt, alt_d = nearest(feat, others, width)
    return alt, alt_d - nearest(feat, [c for c in cands if c[1] == value], width)[1]


PHOTO_SIDE = 32
PHOTO_SAME = 8.0   # 아래 main의 --calibrate로 잰 값에 맞춘다(같은 사진 재압축 vs 다른 선수 사진)


def photo_hash(photo: Image.Image) -> str:
    """사진 지문: 테두리·▲·New 표시를 피한 안쪽 68px을 32×32 색으로 줄인 값(base64).
    처음엔 12×12로 줄였는데 여유가 작아(1px 어긋나면 흔들림) 크게 했다."""
    inner = photo.crop((6, 6, photo.width - 6, photo.height - 6)).resize((PHOTO_SIDE, PHOTO_SIDE), Image.BILINEAR)
    return base64.b64encode(inner.convert('RGB').tobytes()).decode()


def _photo_vec(h: str):
    return np.frombuffer(base64.b64decode(h), dtype=np.uint8).astype(np.int16)


def hash_distance(a: str, b: str) -> float:
    """두 사진 지문의 평균 색 차이(0~255)."""
    x, y = _photo_vec(a), _photo_vec(b)
    return float(np.abs(x - y).mean()) if x.shape == y.shape else 255.0
