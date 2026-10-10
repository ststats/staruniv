"""카드 칸 그림의 특징: 글씨 칸 잉크 농도, 닉네임 칸 거리, 사진 지문."""

import base64
import zlib
from functools import lru_cache

import numpy as np
from PIL import Image


def glyph_feat(crop: Image.Image, bg, width: int) -> np.ndarray:
    """글씨 칸을 원본 크기 그대로 0~1 잉크 농도로 바꾼다. 늘리면 재압축 잡음에 크게 흔들린다.

    글씨 색이 구역마다 달라 상위 2%를 1로 맞춘다."""
    a = np.asarray(crop, dtype=np.float32)
    d = np.abs(a - np.array(bg, dtype=np.float32)).sum(axis=2)
    f = np.clip(d / max(120.0, float(np.percentile(d, 98))), 0, 1)
    out = np.zeros((f.shape[0], width), dtype=np.float32)
    out[:, :min(width, f.shape[1])] = f[:, :width]
    return out


def name_distance(a: np.ndarray, b: np.ndarray) -> float:
    """다른 잉크 양 ÷ 전체 잉크 양(±1px 허용). 칸 대부분이 빈 바탕이라 평균 차이로는 글자 하나가 묻힌다."""
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


@lru_cache(maxsize=512)
def unpack_feat(s: str, shape) -> np.ndarray:
    """캐시로 공유하므로 읽기 전용 배열을 돌려준다."""
    feat = np.frombuffer(zlib.decompress(base64.b64decode(s)), dtype=np.uint8).reshape(shape).astype(np.float32) / 255
    feat.setflags(write=False)
    return feat


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


def nearest(feat: np.ndarray, cands, width=None, detail=False):
    """cands: [(특징 배열, 값)] 중 가장 가까운 값(detail=True면 여유·차순위도).
    압축 잡음은 모든 후보에 똑같이 끼어 문턱보다 '가장 가까운 후보'가 안정적이다."""
    if not cands:
        return (None, 1.0, None, 1.0) if detail else (None, 1.0)
    best = _distances(feat, cands, width)
    i = int(best.argmin())
    value, dist = cands[i][1], float(best[i])
    if not detail:
        return value, dist
    # 동점은 후보 순서를 유지한다.
    others = [j for j, cand in enumerate(cands) if cand[1] != value]
    if not others:
        return value, dist, None, 1.0
    alt = others[int(best[others].argmin())]
    return value, dist, cands[alt][1], float(best[alt]) - dist


PHOTO_SIDE = 32
PHOTO_SAME = 8.0   # 같은 사진 재압축은 3.3 이하, 다른 선수끼리는 12 이상


def photo_hash(photo: Image.Image) -> str:
    """테두리·▲·New 표시를 피한 안쪽을 32×32 색으로 줄인 지문(base64)."""
    inner = photo.crop((6, 6, photo.width - 6, photo.height - 6)).resize((PHOTO_SIDE, PHOTO_SIDE), Image.BILINEAR)
    return base64.b64encode(inner.convert('RGB').tobytes()).decode()


def _photo_vec(h: str):
    return np.frombuffer(base64.b64decode(h), dtype=np.uint8).astype(np.int16)


def hash_distance(a: str, b: str) -> float:
    """두 사진 지문의 평균 색 차이(0~255)."""
    x, y = _photo_vec(a), _photo_vec(b)
    return float(np.abs(x - y).mean()) if x.shape == y.shape else 255.0
