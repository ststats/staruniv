"""펨코 스타 티어표(대학별 카드 이미지 + FA 명단 글)를 읽어 DB 티어표와 비교한다.

    python scripts/tier_table.py --image <이미지 주소 또는 파일> [--fa-text FA명단.txt] [--out 결과.json] [--learn]

1. 이미지를 배경색으로 대학 구역에 나누고, 구역마다 카드 자리를 찾는다. 줄·칸 수나 간격을 가정하지
   않는다(깔끔한 카드로 줄·칸 선을 알아낸 뒤 교차점을 다시 본다) - 인원이 늘어 배치가 바뀌어도 된다.
2. 카드마다 사진 지문(32×32 색)과 티어·종족 글씨(늘리지 않은 원본 칸의 잉크 농도)를 만든다.
3. 기억(data/tier_table_memory.json)과 비교한다.
   - 사진이 같으면 같은 선수(다른 선수끼리는 12 이상, 같은 사진은 다시 압축·2px 어긋나도 3.3 이하).
   - 티어·종족은 기억한 글씨(그 선수의 지난번 글씨 포함) 중 가장 가까운 값. 안 바뀐 카드는 다시
     압축해도 219/219 그대로, 처음 보는 글씨(승급 등)는 약 95%라 변동으로 올려 사람이 확인한다.
   - 기억에 없으면 Tesseract OCR(무료)로 읽고, 닉네임은 같은 대학 DB 명단에서 비슷한 이름과 맞춘다.
4. FA 명단 글은 '티어｜ T 이름 … Z 이름 … P 이름 …' 형식을 그대로 읽는다.
5. 결과: 소속·티어·종족 변동(changes), 사람이 확인할 것(review: 처음 보는 카드·표에서 빠짐 등).
   --learn: 이번 결과의 확실한 짝을 기억에 더한다(관리자 화면에서는 반영할 때 자동으로).

DB는 공개 읽기(Supabase REST, publishable key)로 tier_members의 공개 칸만 읽는다.
"""
import argparse
import base64
import collections
import zlib
import difflib
import io
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

try:
    import pytesseract
except ImportError:  # pragma: no cover - 설치 안내
    pytesseract = None

ROOT = Path(__file__).resolve().parents[1]

TIER_WORDS = {'god': '갓', 'king': '킹', 'jack': '잭', 'joker': '조커', 'spade': '스페이드', 'baby': '베이비', 'check': '체크'}
RACES = {'protoss': '프로토스', 'terran': '테란', 'zerg': '저그'}
ROLES = ('이사장', '부총장', '총장', '교수', '코치', '대장', '수장', '단장')

# 카드 모양(원본 폭 1100px 기준): 사진 80px, 사진 오른쪽 5px부터 글씨 세 줄(티어·직책+닉네임·종족).
# 카드 위치는 고정값을 쓰지 않고 구역마다 사진 칸을 찾아서 정한다 - 인원이 늘어 줄·칸 수나 간격이
# 바뀌어도 그대로 읽힌다. 구역 머리(대학 로고·인원 수)는 위쪽 HEADER px 안에 있어 사진 찾기에서 뺀다.
PHOTO, HEADER = 80, 125
TIER_BOX, RACE_BOX = (120, 24), (120, 23)   # 티어·종족 글씨 칸(폭, 높이): 늘리지 않고 원본 크기로 비교
DIGIT_W = 22                                # 숫자 티어의 숫자 부분 폭


# ---------------------------------------------------------------------------
# 입력
# ---------------------------------------------------------------------------
def load_image(src: str) -> Image.Image:
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={
            'User-Agent': 'Mozilla/5.0 (StarUniv tier-table reader)',
            'Referer': 'https://www.fmkorea.com/'})
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read()
        return Image.open(io.BytesIO(data)).convert('RGB')
    return Image.open(src).convert('RGB')


def supabase_config():
    url, key = os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_PUBLISHABLE_KEY')
    if url and key:
        return url.rstrip('/'), key
    cfg = (ROOT / 'docs' / 'supabase-config.js')
    if cfg.exists():
        text = cfg.read_text(encoding='utf-8')
        u = re.search(r'url:\s*"([^"]+)"', text)
        k = re.search(r'key:\s*"([^"]+)"', text)
        if u and k:
            return u.group(1).rstrip('/'), k.group(1)
    raise SystemExit('SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY가 필요합니다(또는 빌드된 docs/supabase-config.js)')


def load_db():
    url, key = supabase_config()
    rows, offset = [], 0
    while True:
        q = f'{url}/rest/v1/tier_members?select=nickname,soop_id,race,tier,affiliation&order=source_order.asc,soop_id.asc&offset={offset}&limit=1000'
        req = urllib.request.Request(q, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=60) as res:
            batch = json.load(res)
        rows += batch
        if len(batch) < 1000:
            return rows
        offset += 1000


# ---------------------------------------------------------------------------
# 이미지 → 카드
# ---------------------------------------------------------------------------
def color_dist(a, b):
    return sum(abs(x - y) for x, y in zip(a, b))


def split_sections(im: Image.Image):
    """왼쪽 끝 세로줄의 배경색이 바뀌는 곳에서 대학 구역을 나눈다."""
    px = im.load()
    W, H = im.size
    bounds, start, prev = [], 0, px[3, 0]
    for y in range(1, H):
        c = px[3, y]
        if color_dist(c, prev) > 40:
            if y - start > 150:
                bounds.append((start, y))
            start = y
        prev = c
    if H - start > 150:
        bounds.append((start, H))
    return bounds


def text_mask(crop: Image.Image, bg, scale=3) -> Image.Image:
    """배경색에서 멀리 떨어진 픽셀을 검은 글씨로, 나머지를 흰 바탕으로 만든다(OCR용)."""
    px = crop.load()
    W, H = crop.size
    out = Image.new('L', (W, H), 255)
    op = out.load()
    for y in range(H):
        for x in range(W):
            if color_dist(px[x, y], bg) > 150:
                op[x, y] = 0
    out = out.resize((W * scale, H * scale), Image.LANCZOS)
    return ImageOps.expand(out, border=12, fill=255)


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


def pack_feat(f: np.ndarray) -> str:
    return base64.b64encode(zlib.compress((f * 255).astype(np.uint8).tobytes(), 9)).decode()


def unpack_feat(s: str, shape) -> np.ndarray:
    return np.frombuffer(zlib.decompress(base64.b64decode(s)), dtype=np.uint8).reshape(shape).astype(np.float32) / 255


def nearest(feat: np.ndarray, cands, width=None):
    """cands: [(특징 배열, 값)]. ±1px 어긋남을 허용한 평균 차이가 가장 작은 값.
    한 값이 넘는 기준(문턱) 대신 '어느 기억 글씨와 가장 가까운가'로 정한다 - 압축 잡음은 모든 후보와의
    차이에 똑같이 끼어서, 문턱은 흔들려도 가장 가까운 후보는 그대로다(다시 압축해도 219/219)."""
    if not cands:
        return None, 1.0
    w = width or feat.shape[1]
    stack = np.stack([c[0][:, :w] for c in cands])
    best = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            sh = np.roll(np.roll(feat[:, :w], dy, 0), dx, 1)
            d = np.abs(stack - sh)[:, 2:-2, 2:-2].mean(axis=(1, 2))
            best = d if best is None else np.minimum(best, d)
    i = int(best.argmin())
    return cands[i][1], float(best[i])


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


def ocr(img: Image.Image, lang: str) -> str:
    if pytesseract is None:
        raise SystemExit('pytesseract가 필요합니다: pip install pytesseract (tesseract-ocr, tesseract-ocr-kor 설치)')
    return pytesseract.image_to_string(img, lang=lang, config='--psm 7').strip()


def cut_badge(crop: Image.Image) -> Image.Image:
    """닉네임 뒤에 붙는 흰 상자 뱃지(인턴·학생회장)를 잘라 낸다."""
    px = crop.load()
    W, H = crop.size
    for x in range(W):
        white = sum(1 for y in range(H) if min(px[x, y]) > 235)
        if white > H * 0.6:
            return crop.crop((0, 0, max(1, x - 2), H))
    return crop


def read_tier(text: str):
    t = text.lower().replace(' ', '')
    for word, tier in TIER_WORDS.items():
        if word in t:
            return tier
    m = re.search(r'(\d)', t)
    if m:
        return m.group(1)
    best = difflib.get_close_matches(t[:6], list(TIER_WORDS), n=1, cutoff=0.4)
    return TIER_WORDS[best[0]] if best else None


def read_race(text: str):
    t = re.sub(r'[^a-z]', '', text.lower())
    best = difflib.get_close_matches(t, list(RACES), n=1, cutoff=0.3)
    return RACES[best[0]] if best else None


def split_role(text: str):
    t = re.sub(r'\s+', ' ', text).strip()
    for role in ROLES:
        if t.startswith(role):
            return role, t[len(role):].strip()
    return '', t.replace(' ', '')


def refine_edge(px, bg, x, y, side):
    """4px 단위로 찾은 사진 칸의 왼쪽·위 가장자리를 1px 단위로 맞춘다(사진 지문이 어긋나지 않게)."""
    def filled_col(cx):
        return sum(color_dist(px[cx, cy], bg) > 60 for cy in range(y + side // 4, y + side * 3 // 4)) > side * 0.4
    def filled_row(cy):
        return sum(color_dist(px[cx, cy], bg) > 60 for cx in range(x + side // 4, x + side * 3 // 4)) > side * 0.4
    left = next((cx for cx in range(x - 4, x + 5) if filled_col(cx)), x)
    upper = next((cy for cy in range(y - 4, y + 5) if filled_row(cy)), y)
    return left, upper, side


def _diff_integral(im, top, bottom, bg):
    W = im.width
    arr = np.asarray(im.crop((0, top, W, bottom)), dtype=np.int16)
    diff = (np.abs(arr - np.array(bg, dtype=np.int16)).sum(axis=2) > 60).astype(np.int32)
    H = diff.shape[0]
    ii = np.zeros((H + 1, W + 1), dtype=np.int32)
    ii[1:, 1:] = diff.cumsum(0).cumsum(1)

    def box(x, y, w, h):
        """[x, x+w)×[y, y+h) 안에서 배경과 다른 픽셀 비율(구역 안 좌표, 배열로도 된다)."""
        return (ii[y + h, x + w] - ii[y, x + w] - ii[y + h, x] + ii[y, x]) / (w * h)
    return box, H, W


def _cluster(values, tol):
    """가까운 값끼리 묶어 묶음마다 가장 흔한 값(중앙값)을 돌려준다."""
    groups = []
    for v in sorted(values):
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sorted(g)[len(g) // 2] for g in groups]


def _extend(lines, lo, hi):
    """바둑판 간격으로 줄(칸)을 채운다. ▲ 표시 카드만 있는 줄·칸은 1)에서 못 찾을 수 있어서,
    찾은 줄 사이 빈 곳과 양 끝 바깥을 같은 간격으로 이어 본다(없는 자리는 3)에서 걸러진다)."""
    if len(lines) < 2:
        return lines
    step = sorted(b - a for a, b in zip(lines, lines[1:]))[0]
    out = []
    for a, b in zip(lines, lines[1:]):
        out.append(a)
        n = round((b - a) / step)
        out += [a + round((b - a) * k / n) for k in range(1, n)]
    out.append(lines[-1])
    while out[0] - step >= lo:
        out.insert(0, out[0] - step)
    while out[-1] + step <= hi:
        out.append(out[-1] + step)
    return out


def find_photos(im: Image.Image, top: int, bottom: int, bg):
    """구역 안의 사진 칸을 찾는다. 줄·칸 수나 간격은 가정하지 않는다(인원이 늘어 격자가 바뀌어도 된다).

    1) 깔끔한 카드부터: 안쪽 64×64가 대부분 배경과 다르고, 사진 둘레 네 방향 틈(왼쪽·오른쪽 글씨 사이·
       위·아래)이 모두 배경색인 자리. ▲ 테두리·New 표시가 튀어나온 카드는 여기서 빠질 수 있다.
    2) 1)의 자리들로 줄(y)과 칸(x) 위치를 알아낸다. 카드는 늘 바둑판처럼 맞춰 놓이므로, 한 줄·한 칸에
       깔끔한 카드가 하나만 있어도 그 줄·칸 전체 위치를 안다.
    3) 모든 줄×칸 교차점을 느슨한 조건(사진 안쪽 절반 이상 + 오른쪽에 글씨)으로 다시 본다.
    돌려주는 값: (줄, 칸, x, y, 한 변) 목록."""
    box, H, W = _diff_integral(im, top, bottom, bg)
    ys = np.arange(HEADER, H - PHOTO - 4)[:, None]
    xs = np.arange(6, W - PHOTO - 8)[None, :]
    ok = ((box(xs + 8, ys + 8, PHOTO - 16, PHOTO - 16) >= 0.7)
          & (box(xs - 5, ys + 8, 3, PHOTO - 16) <= 0.15)
          & (box(xs + PHOTO + 1, ys + 8, 3, PHOTO - 16) <= 0.2)
          & (box(xs + 8, ys - 5, PHOTO - 16, 3) <= 0.15)
          & (box(xs + 8, ys + PHOTO + 1, PHOTO - 16, 3) <= 0.15))
    px = im.load()
    clean = []
    taken = np.zeros_like(ok)
    for yy, xx in zip(*np.nonzero(ok)):
        if taken[yy, xx]:
            continue
        stack, cells = [(yy, xx)], []
        taken[yy, xx] = True
        while stack:
            cy, cx = stack.pop()
            cells.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < ok.shape[0] and 0 <= nx < ok.shape[1] and ok[ny, nx] and not taken[ny, nx]:
                    taken[ny, nx] = True
                    stack.append((ny, nx))
        cy = sorted(c[0] for c in cells)[len(cells) // 2]
        cx = sorted(c[1] for c in cells)[len(cells) // 2]
        clean.append(refine_edge(px, bg, int(cx) + 6, int(cy) + HEADER + top, PHOTO))
    if not clean:
        return []
    col_x = _extend(_cluster([p[0] for p in clean], 10), 6, W - PHOTO - 90)
    row_y = _extend(_cluster([p[1] for p in clean], 10), top + HEADER, bottom - PHOTO - 2)
    out = []
    for r, y in enumerate(row_y):
        for c, x in enumerate(col_x):
            hit = next((p for p in clean if abs(p[0] - x) <= 4 and abs(p[1] - y) <= 4), None)
            if hit is None:
                ly = y - top
                if ly + PHOTO + 2 > H or x + PHOTO + 90 > W:
                    continue
                photo_ok = box(x + 8, ly + 8, PHOTO - 16, PHOTO - 16) >= 0.5
                text_ok = box(x + PHOTO + 5, ly + 2, 60, PHOTO - 8) >= 0.04   # 오른쪽 세 줄 글씨
                if not (photo_ok and text_ok):
                    continue
                hit = refine_edge(px, bg, x, y, PHOTO)
            out.append((r, c) + hit)
    return out


def cards_in_section(im: Image.Image, top: int, bottom: int, memory=None):
    px = im.load()
    bg = px[3, (top + bottom) // 2]
    cards = []
    spots = find_photos(im, top, bottom, bg)
    for row, col, x, y, side in spots:
        # 글씨 칸 폭: 같은 줄 다음 카드 사진 앞까지(최대 125px). 칸 간격이 좁은 배치에서 옆 사진이 섞이지 않게
        nxt = min((p[2] for p in spots if p[0] == row and p[2] > x), default=x + 1000)
        tw = max(40, min(125, nxt - (x + side + 5) - 4))
        if True:
            # 찾은 네모는 4px 단위라 원래 사진(80px)의 가장자리가 조금 어긋날 수 있다. 크기가 80px에서
            # 크게 벗어나지 않으면 80px로 보고, 글씨 위치는 사진 크기에 비례해 잡는다.
            if abs(side - PHOTO) <= 8:
                side = PHOTO
            photo = im.crop((x, y, x + side, y + side))
            if side != PHOTO:
                photo = photo.resize((PHOTO, PHOTO), Image.LANCZOS)
            tx = x + side + 5
            tier_img = im.crop((tx, y + 2, tx + tw, y + 2 + TIER_BOX[1]))
            name_img = cut_badge(im.crop((tx, y + 26, tx + tw, y + 50)))
            race_img = im.crop((tx, y + 49, tx + tw, y + 49 + RACE_BOX[1]))
            tier_f, race_f = glyph_feat(tier_img, bg, TIER_BOX[0]), glyph_feat(race_img, bg, RACE_BOX[0])
            card = {'row': row, 'col': col, 'bg': '%02x%02x%02x' % bg,
                    'tier_feat': pack_feat(tier_f), 'race_feat': pack_feat(race_f), 'photo': photo_hash(photo),
                    'photo_shifts': [photo_hash(im.crop((x + dx, y + dy, x + side + dx, y + side + dy)).resize((PHOTO, PHOTO)))
                                     for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2) if dx or dy]}
            mem = memory or {}
            known = recall_photo(card, mem)
            # 기억한 글씨(아는 선수면 그 선수의 지난번 글씨 포함) 중 가장 가까운 값. 기억이 없으면 OCR
            tier = classify_tier(tier_f, mem, known)
            race = classify_race(race_f, mem, known)
            tier_raw = ocr(text_mask(tier_img, bg), 'eng+kor') if not tier else ''
            race_raw = ocr(text_mask(race_img, bg), 'eng') if not race else ''
            name_raw = '' if known else ocr(text_mask(name_img, bg), 'kor')
            role, nick = split_role(name_raw)
            card.update({'tier': tier or read_tier(tier_raw), 'race': race or read_race(race_raw),
                         'role': role, 'nickname_ocr': nick or (known['nickname'] if known else ''),
                         'raw': {'tier': tier_raw, 'name': name_raw, 'race': race_raw}})
            if known:
                card['known'] = {'soop_id': known.get('soop_id'), 'nickname': known['nickname']}
            cards.append(card)
    return cards


def read_image(im: Image.Image, memory=None):
    return [{'y': (top, bottom), 'cards': cards_in_section(im, top, bottom, memory)} for top, bottom in split_sections(im)]


# ---------------------------------------------------------------------------
# 기억(학습): 확인된 카드의 사진 지문·티어/종족 글씨 모양을 쌓아 두고 다음 갱신 때 쓴다
# ---------------------------------------------------------------------------
MEMORY_PATH = ROOT / 'data' / 'tier_table_memory.json'
TEMPLATES_PER_VALUE = 30  # 값마다 기억할 글씨 수(구역 색이 다양하게)


def load_memory(path=MEMORY_PATH):
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding='utf-8'))
    return {'tier': [], 'race': [], 'photos': []}


def save_memory(memory, path=MEMORY_PATH):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(memory, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')


def _cands(memory, kind, known):
    """비교 후보: 기억한 글씨 전부 + 사진으로 아는 선수면 그 선수의 지난번 글씨."""
    shape = (TIER_BOX[1], TIER_BOX[0]) if kind == 'tier' else (RACE_BOX[1], RACE_BOX[0])
    out = [(unpack_feat(t['feat'], shape), t['value']) for t in memory.get(kind) or []]
    if known and known.get(kind + '_feat'):
        out.append((unpack_feat(known[kind + '_feat'], shape), known[kind]))
    return out


def classify_tier(feat, memory, known=None):
    """티어 칸 전체로 가장 가까운 값을 고르고, 숫자 티어면 숫자 부분만 숫자 후보끼리 다시 비교한다."""
    cands = _cands(memory, 'tier', known)
    value, dist = nearest(feat, cands)
    if value is None or dist > 0.25:
        return None
    if value.isdigit():
        value = nearest(feat, [c for c in cands if c[1].isdigit()], DIGIT_W)[0]
    return value


def classify_race(feat, memory, known=None):
    value, dist = nearest(feat, _cands(memory, 'race', known))
    return value if value and dist <= 0.25 else None


_PHOTO_MATRIX = {}


def recall_photo(card, memory):
    """기억한 사진 중 가장 가까운 것. 사진 칸 위치가 1px만 어긋나도 지문이 4~7 달라지므로
    카드를 읽을 때 ±2px 어긋난 지문(card['photo_shifts'])까지 함께 비교한다."""
    photos = memory.get('photos') or []
    if not photos:
        return None
    key = id(photos), len(photos)
    if key not in _PHOTO_MATRIX:
        _PHOTO_MATRIX.clear()
        _PHOTO_MATRIX[key] = np.array([_photo_vec(p['hash']) for p in photos], dtype=np.int16)
    mat = _PHOTO_MATRIX[key]
    best, who = 255.0, None
    for h in [card['photo']] + card.get('photo_shifts', []):
        v = _photo_vec(h)
        d = np.abs(mat - v).mean(axis=1)
        i = int(d.argmin())
        if d[i] < best:
            best, who = float(d[i]), photos[i]
    return who if best <= PHOTO_SAME else None


def learn(memory, confirmed):
    """confirmed: [(카드, DB 선수)] - 사람이 확인했거나 이름·사진으로 확실히 맞은 짝.
    글씨는 값마다 TEMPLATES_PER_VALUE개까지(아직 없는 구역 색을 먼저), 사진은 선수마다 최신 하나."""
    shapes = {'tier': (TIER_BOX[1], TIER_BOX[0]), 'race': (RACE_BOX[1], RACE_BOX[0])}

    def add(kind, value, feat, bg):
        if not feat:
            return
        same = [t for t in memory[kind] if t['value'] == value]
        new = unpack_feat(feat, shapes[kind])
        if any(nearest(new, [(unpack_feat(t['feat'], shapes[kind]), 0)])[1] < 0.01 for t in same):
            return
        if len(same) >= TEMPLATES_PER_VALUE and any(t.get('bg') == bg for t in same):
            return
        memory[kind].append({'value': value, 'feat': feat, 'bg': bg})
    for card, r in confirmed:
        add('tier', str(r['tier']), card.get('tier_feat'), card.get('bg'))
        add('race', r['race'], card.get('race_feat'), card.get('bg'))
        memory['photos'] = [p for p in memory['photos'] if hash_distance(p['hash'], card['photo']) > PHOTO_SAME
                            and not (r.get('soop_id') and p.get('soop_id') == r.get('soop_id'))]
        memory['photos'].append({'hash': card['photo'], 'soop_id': r.get('soop_id'), 'nickname': r['nickname'],
                                 'tier': str(r['tier']), 'race': r['race'],
                                 'tier_feat': card.get('tier_feat'), 'race_feat': card.get('race_feat')})
    return memory


# ---------------------------------------------------------------------------
# FA 명단 글
# ---------------------------------------------------------------------------
FA_TIER = {'갓티어': '갓', '킹티어': '킹', '잭티어': '잭', '조커요': '조커', '조커티어': '조커',
           '스페읻': '스페이드', '스페이드': '스페이드', 'BABY': '베이비', '베이비': '베이비'}


def read_fa_text(text: str):
    out, tier, race = [], None, None
    for line in text.splitlines():
        line = line.strip()
        if not line or 'FA 인원' in line:
            continue
        if '｜' in line or '|' in line:
            head, line = re.split(r'[｜|]', line, maxsplit=1)
            head = head.strip()
            tier = FA_TIER.get(head, re.sub(r'티어$', '', head).strip())
        for tok in line.split():
            if tok in ('T', 'Z', 'P'):
                race = {'T': '테란', 'Z': '저그', 'P': '프로토스'}[tok]
            elif tier and race:
                out.append({'tier': tier, 'race': race, 'nickname': tok})
    return out


# ---------------------------------------------------------------------------
# DB와 맞추기
# ---------------------------------------------------------------------------
def similarity(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def match_sections(sections, db):
    """각 구역의 카드를 DB 선수와 맞추고, 구역의 대학을 정한다."""
    by_team = collections.defaultdict(list)
    for r in db:
        by_team[r['affiliation']].append(r)
    teams = [t for t in by_team if t not in ('휴면', 'FA', None, '')]
    results = []
    for sec in sections:
        cards = sec['cards']
        # 대학: 카드 닉네임과 가장 많이 맞는 대학
        def team_score(team):
            names = [r['nickname'] for r in by_team[team]]
            return sum(max((similarity(c['nickname_ocr'], n) for n in names), default=0) for c in cards)
        team = max(teams, key=team_score) if cards else None
        pool = list(by_team.get(team, []))
        used_c, used_r, match = set(), set(), {}
        # 1) 사진으로 아는 선수: 소속이 바뀌었어도(다른 대학·FA) 바로 찾는다
        for i, c in enumerate(cards):
            known = c.get('known')
            if not known:
                continue
            r = next((x for x in db if known.get('soop_id') and x.get('soop_id') == known['soop_id']), None) \
                or next((x for x in db if x['nickname'] == known['nickname']), None)
            if r is None:
                continue
            used_c.add(i)
            match[i] = (r, 1.0)
            for j, p in enumerate(pool):
                if p is r:
                    used_r.add(j)
        # 2) 나머지는 이름이 비슷한 순으로 짝을 짓는다(한 DB 선수는 한 카드에만)
        pairs = sorted(((similarity(c['nickname_ocr'], r['nickname']) + (0.15 if c['tier'] == str(r['tier']) else 0)
                         + (0.1 if c['race'] == r['race'] else 0), i, j)
                        for i, c in enumerate(cards) for j, r in enumerate(pool)), reverse=True)
        for score, i, j in pairs:
            if i in used_c or j in used_r or score < 0.45:
                continue
            used_c.add(i); used_r.add(j); match[i] = (pool[j], score)
        results.append({'team': team, 'cards': cards, 'match': match,
                        'missing': [pool[j] for j in range(len(pool)) if j not in used_r]})
    return results


def compare(sections, fa, db):
    changes, review, missing = [], [], []
    matched_ids = set()
    for sec in match_sections(sections, db):
        team = sec['team']
        for i, card in enumerate(sec['cards']):
            hit = sec['match'].get(i)
            if not hit:
                # 같은 대학에 없는 선수: DB 전체에서 찾는다(이적·신규)
                best = max(db, key=lambda r: similarity(card['nickname_ocr'], r['nickname']))
                if similarity(card['nickname_ocr'], best['nickname']) >= 0.75:
                    hit = (best, 0)
                else:
                    review.append({'type': '신규 또는 인식 실패', 'team': team, 'card': card})
                    continue
            r = hit[0]
            matched_ids.add(id(r))
            diff = {}
            if r['affiliation'] != team:
                diff['affiliation'] = [r['affiliation'], team]
            if card['tier'] and str(r['tier']) != card['tier']:
                diff['tier'] = [r['tier'], card['tier']]
            if card['race'] and r['race'] != card['race']:
                diff['race'] = [r['race'], card['race']]
            if diff:
                changes.append({'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': team, 'diff': diff,
                                'ocr': card['nickname_ocr']})
        missing += [(team, r) for r in sec['missing']]
    # 다른 구역에서 찾은 선수(이적)는 원래 대학에서 '빠짐'으로 보이지 않게
    for team, r in missing:
        if id(r) not in matched_ids:
            review.append({'type': '표에서 빠짐', 'team': team, 'nickname': r['nickname'], 'tier': r['tier']})
    fa_rows = [r for r in db if r['affiliation'] == 'FA']
    fa_seen = set()
    for f in fa:
        exact = [r for r in db if r['nickname'] == f['nickname']]
        r = next((x for x in exact if x['affiliation'] == 'FA'), exact[0] if exact else None)
        if r is None:
            review.append({'type': 'FA 명단에만 있음(신규 또는 닉네임 변경)', **f})
            continue
        fa_seen.add(id(r))
        diff = {}
        if r['affiliation'] != 'FA':
            diff['affiliation'] = [r['affiliation'], 'FA']
        if str(r['tier']) != f['tier']:
            diff['tier'] = [r['tier'], f['tier']]
        if r['race'] != f['race']:
            diff['race'] = [r['race'], f['race']]
        if diff:
            changes.append({'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': 'FA', 'diff': diff})
    if fa:
        for r in fa_rows:
            if id(r) not in fa_seen and id(r) not in matched_ids:
                review.append({'type': 'FA 명단에서 빠짐', 'nickname': r['nickname'], 'tier': r['tier']})
    return {'changes': changes, 'review': review}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--image', required=True, help='티어표 이미지 주소 또는 파일')
    ap.add_argument('--fa-text', help='FA 명단 글(텍스트 파일)')
    ap.add_argument('--out', help='결과 JSON 파일')
    ap.add_argument('--memory', default=str(MEMORY_PATH), help='기억 파일(사진 지문·글씨 모양)')
    ap.add_argument('--learn', action='store_true',
                    help='이번 결과 중 확실한 짝(이름 유사도 0.8 이상·사진 일치)을 기억에 더한다. '
                         '변동이 맞는지 확인한 뒤에 쓴다(관리자 화면에서는 반영 때 자동)')
    args = ap.parse_args()
    im = load_image(args.image)
    if im.width != 1100:
        im = im.resize((1100, round(im.height * 1100 / im.width)), Image.LANCZOS)
    memory = load_memory(args.memory)
    sections = read_image(im, memory)
    fa = read_fa_text(Path(args.fa_text).read_text(encoding='utf-8')) if args.fa_text else []
    db = load_db()
    result = compare(sections, fa, db)
    if args.learn:
        confirmed = [(c, hit[0]) for sec in match_sections(sections, db)
                     for i, c in enumerate(sec['cards']) for hit in [sec['match'].get(i)] if hit and hit[1] >= 0.8]
        save_memory(learn(memory, confirmed), args.memory)
        print(f'기억에 더함: 카드 {len(confirmed)}장 → 사진 {len(memory["photos"])}·티어 모양 {len(memory["tier"])}·종족 모양 {len(memory["race"])}',
              file=sys.stderr)
    result['sections'] = sections
    result['fa'] = fa
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
    for c in result['changes']:
        print('변동', c['team'], c['nickname'], c['diff'])
    brief = lambda c: {k: c[k] for k in ('row', 'col', 'tier', 'race', 'role', 'nickname_ocr') if k in c}
    for r in result['review']:
        print('확인', {k: (brief(v) if k == 'card' else v) for k, v in r.items()})
    print(f"카드 {sum(len(s['cards']) for s in sections)}장, FA {len(fa)}명, 변동 {len(result['changes'])}건, 확인 {len(result['review'])}건",
          file=sys.stderr)


if __name__ == '__main__':
    main()
