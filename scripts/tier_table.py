"""펨코 스타 티어표(대학별 카드 이미지 + FA 명단 글)를 읽어 DB 티어표와 비교한다.

    python scripts/tier_table.py --image <이미지 주소 또는 파일> [--fa-text FA명단.txt] [--out 결과.json]

- 이미지: 대학마다 배경색이 다른 구역이 세로로 이어지고, 구역 안에 선수 카드가 격자로 놓인다
  (사진 80px, 오른쪽에 티어 / 직책+닉네임 / 종족 세 줄). 구역을 배경색으로 나누고 카드를 잘라
  Tesseract(무료 OCR, kor+eng)로 읽는다.
- 티어·종족은 정해진 값 중 가장 가까운 것으로 고르고, 닉네임은 같은 대학 DB 명단에서 가장 비슷한
  이름과 맞춘다(OCR 오타를 여기서 거른다). 대학 이름은 카드 선수들이 DB에서 속한 대학으로 정한다.
- FA 명단 글은 '티어｜ T 이름 … Z 이름 … P 이름 …' 형식을 그대로 읽는다.
- 결과: 소속·티어·종족 변동, 닉네임이 다른 선수(확인 필요), 목록에서 빠진 선수.

DB는 공개 읽기(Supabase REST, publishable key)로 tier_members의 공개 칸만 읽는다.
"""
import argparse
import collections
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


def ink_points(crop: Image.Image, bg):
    """글씨 속(채운 부분) 픽셀. 글씨 둘레의 그림자·테두리는 빼야 3과 5처럼 비슷한 모양이 갈린다.
    구역마다 글씨 색이 달라서(주황·노랑·보라·흰색) 가장 진한 색 대비 비율로 자른다."""
    px = crop.load()
    W, H = crop.size
    dist = [[color_dist(px[x, y], bg) for x in range(W)] for y in range(H)]
    top = max(max(row) for row in dist)
    thr = max(120, top * 0.62)
    return [(x, y) for y in range(H) for x in range(W) if dist[y][x] > thr]


def points_bits(pts, box, size) -> str:
    x0, y0, x1, y1 = box
    mask = Image.new('L', (x1 - x0 + 1, y1 - y0 + 1), 0)
    mp = mask.load()
    for x, y in pts:
        if x0 <= x <= x1 and y0 <= y <= y1:
            mp[x - x0, y - y0] = 255
    small = mask.resize(size, Image.BILINEAR)
    return ''.join('1' if v > 96 else '0' for v in small.tobytes())


def glyph_bits(crop: Image.Image, bg, size=(48, 16)) -> str:
    """글씨 전체를 정해진 크기로 줄인 흑백 모양(0/1 문자열). 색이 달라도 모양이 같으면 같다."""
    pts = ink_points(crop, bg)
    if not pts:
        return ''
    return points_bits(pts, (min(p[0] for p in pts), min(p[1] for p in pts),
                             max(p[0] for p in pts), max(p[1] for p in pts)), size)


def lead_bits(crop: Image.Image, bg, size=(16, 24)) -> str:
    """첫 글자(숫자 티어의 숫자)만의 모양. 숫자와 '티'가 붙어 있는 경우가 많아 글자 높이의
    0.55배 폭으로 자른다(이미지로 시험해 가장 잘 갈렸다)."""
    pts = ink_points(crop, bg)
    if not pts:
        return ''
    x0, y0, y1 = min(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)
    return points_bits(pts, (x0, y0, x0 + int((y1 - y0 + 1) * 0.55), y1), size)


def bits_distance(a: str, b: str) -> float:
    if not a or not b or len(a) != len(b):
        return 1.0
    return sum(x != y for x, y in zip(a, b)) / len(a)


PHOTO_SIDE = 12
PHOTO_SAME = 5.0   # 같은 사진을 다시 압축해도 1.7 이하, 서로 다른 선수 사진은 10.6 이상이었다


def photo_hash(photo: Image.Image) -> str:
    """사진 지문: 테두리·▲·New 표시를 피한 안쪽을 12×12 색으로 줄인 값(16진 문자열).
    증명사진 구도가 비슷해서 흑백 64비트 지문으로는 다른 사람끼리 겹쳤다."""
    inner = photo.crop((6, 6, photo.width - 6, photo.height - 6)).resize((PHOTO_SIDE, PHOTO_SIDE), Image.BILINEAR)
    return inner.convert('RGB').tobytes().hex()


def hash_distance(a: str, b: str) -> float:
    """두 사진 지문의 평균 색 차이(0~255)."""
    x, y = bytes.fromhex(a), bytes.fromhex(b)
    if len(x) != len(y):
        return 255.0
    return sum(abs(p - q) for p, q in zip(x, y)) / len(x)


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


def find_photos(im: Image.Image, top: int, bottom: int, bg):
    """구역 안의 사진 칸을 찾는다. 줄·칸 수나 간격을 가정하지 않아서 인원이 늘어 격자가 바뀌어도 된다.

    사진 칸 조건(PHOTO×PHOTO 네모): 안쪽 64×64가 대부분 배경색과 다르고(사진), 바로 왼쪽 세로띠와
    사진-글씨 사이 틈은 배경색이다. 모든 위치를 numpy 면적 합으로 한 번에 따져, 조건을 만족하는 위치
    덩어리마다 한가운데를 사진 자리로 잡는다. 돌려주는 값: (줄, 칸, x, y, 한 변) 목록."""
    W = im.width
    arr = np.asarray(im.crop((0, top, W, bottom)), dtype=np.int16)
    diff = (np.abs(arr - np.array(bg, dtype=np.int16)).sum(axis=2) > 60).astype(np.int32)
    H = diff.shape[0]
    ii = np.zeros((H + 1, W + 1), dtype=np.int32)
    ii[1:, 1:] = diff.cumsum(0).cumsum(1)

    def box(x, y, w, h):
        """모든 (x, y) 격자에 대해 [x, x+w)×[y, y+h) 안의 '배경과 다른' 비율."""
        return (ii[y + h, x + w] - ii[y, x + w] - ii[y + h, x] + ii[y, x]) / (w * h)

    ys = np.arange(HEADER, H - PHOTO - 4)[:, None]
    xs = np.arange(6, W - PHOTO - 8)[None, :]
    inner = box(xs + 8, ys + 8, PHOTO - 16, PHOTO - 16)
    left = box(xs - 5, ys + 8, 3, PHOTO - 16)
    gap = box(xs + PHOTO + 1, ys + 8, 3, PHOTO - 16)
    above = box(xs + 8, ys - 5, PHOTO - 16, 3)
    below = box(xs + 8, ys + PHOTO + 1, PHOTO - 16, 3)
    # New 표시·▲ 테두리가 사진 위·옆으로 조금 튀어나오는 카드가 있어 위·아래 틈은 한쪽만 깨끗해도 된다
    ok = (inner >= 0.7) & (left <= 0.3) & (gap <= 0.3) & ((above <= 0.15) | (below <= 0.15))
    # 조건을 만족하는 위치는 진짜 자리 둘레에 덩어리로 모인다 → 덩어리마다 하나
    pts = list(zip(*np.nonzero(ok)))
    taken = np.zeros_like(ok)
    found = []
    for yy, xx in pts:
        if taken[yy, xx]:
            continue
        y_lo, y_hi, x_lo, x_hi = yy, yy, xx, xx
        stack = [(yy, xx)]
        taken[yy, xx] = True
        while stack:
            cy, cx = stack.pop()
            y_lo, y_hi, x_lo, x_hi = min(y_lo, cy), max(y_hi, cy), min(x_lo, cx), max(x_hi, cx)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < ok.shape[0] and 0 <= nx < ok.shape[1] and ok[ny, nx] and not taken[ny, nx]:
                    taken[ny, nx] = True
                    stack.append((ny, nx))
        x = int(round((x_lo + x_hi) / 2)) + 6
        y = int(round((y_lo + y_hi) / 2)) + HEADER + top
        found.append(refine_edge(im.load(), bg, x, y, PHOTO))
    found.sort(key=lambda p: (p[1], p[0]))
    rows, out = [], []
    for p in found:
        if rows and abs(rows[-1][0][1] - p[1]) <= 20:
            rows[-1].append(p)
        else:
            rows.append([p])
    for r, items in enumerate(rows):
        for c, p in enumerate(sorted(items)):
            out.append((r, c) + p)
    return out


def cards_in_section(im: Image.Image, top: int, bottom: int, memory=None):
    px = im.load()
    bg = px[3, (top + bottom) // 2]
    cards = []
    for row, col, x, y, side in find_photos(im, top, bottom, bg):
        if True:
            # 찾은 네모는 4px 단위라 원래 사진(80px)의 가장자리가 조금 어긋날 수 있다. 크기가 80px에서
            # 크게 벗어나지 않으면 80px로 보고, 글씨 위치는 사진 크기에 비례해 잡는다.
            if abs(side - PHOTO) <= 8:
                side = PHOTO
            photo = im.crop((x, y, x + side, y + side))
            if side != PHOTO:
                photo = photo.resize((PHOTO, PHOTO), Image.LANCZOS)
            tx = x + side + 5
            tier_img = im.crop((tx, y + 2, tx + 125, y + 26))
            name_img = cut_badge(im.crop((tx, y + 26, tx + 125, y + 50)))
            race_img = im.crop((tx, y + 49, tx + 125, y + 72))
            card = {'row': row, 'col': col, 'bg': '%02x%02x%02x' % bg,
                    'tier_bits': glyph_bits(tier_img, bg), 'tier_lead': lead_bits(tier_img, bg),
                    'race_bits': glyph_bits(race_img, bg), 'photo': photo_hash(photo),
                    'photo_shifts': [photo_hash(im.crop((x + dx, y + dy, x + side + dx, y + side + dy)).resize((PHOTO, PHOTO)))
                                     for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]}
            # 기억으로 사진·글씨 모양을 다 아는 카드는 OCR(느리고 틀리기 쉬움)을 건너뛴다
            mem = memory or {}
            tier = classify_tier(card, mem)
            race = classify_race(card, mem)
            known = recall_photo(card, mem)
            if not (tier and race):
                tier_raw, race_raw = ocr(text_mask(tier_img, bg), 'eng+kor'), ocr(text_mask(race_img, bg), 'eng')
            else:
                tier_raw = race_raw = ''
            name_raw = '' if known else ocr(text_mask(name_img, bg), 'kor')
            role, nick = split_role(name_raw)
            card.update({'tier': tier or read_tier(tier_raw), 'race': race or read_race(race_raw),
                         'tier_ocr': read_tier(tier_raw) if tier_raw else None,
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
TEMPLATES_PER_VALUE = 12  # 같은 배경색(구역)·같은 값마다 몇 개까지 기억할지


def load_memory(path=MEMORY_PATH):
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding='utf-8'))
    return {'tier': [], 'race': [], 'photos': []}


def save_memory(memory, path=MEMORY_PATH):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(memory, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def same_colour(card, temps):
    """구역 배경색이 같은(=같은 대학 구역 디자인) 기억 모양을 먼저 쓴다. 글씨 색·대비가 구역마다
    달라서 다른 색 구역의 모양과 비교하면 Protoss와 Terran이 뒤바뀌는 일이 있었다."""
    if not card.get('bg'):
        return temps
    near = [t for t in temps if t.get('bg') and color_dist(hex_rgb(t['bg']), hex_rgb(card['bg'])) < 60]
    return near or temps


def classify_tier(card, memory):
    """전체 모양으로 가장 가까운 티어를 고르고, 숫자 티어면 숫자 모양만 다시 비교한다."""
    temps = same_colour(card, memory.get('tier') or [])
    if not temps or not card.get('tier_bits'):
        return None
    dist, value = min((bits_distance(card['tier_bits'], t['bits']), t['value']) for t in temps)
    if dist > 0.25:
        return None
    if value.isdigit():
        nums = [t for t in temps if t['value'].isdigit() and t.get('lead')]
        if nums:
            value = min((bits_distance(card['tier_lead'], t['lead']), t['value']) for t in nums)[1]
    return value


def classify_race(card, memory):
    temps = same_colour(card, memory.get('race') or [])
    if not temps or not card.get('race_bits'):
        return None
    dist, value = min((bits_distance(card['race_bits'], t['bits']), t['value']) for t in temps)
    return value if dist <= 0.25 else None


_PHOTO_MATRIX = {}


def recall_photo(card, memory):
    """기억한 사진 중 가장 가까운 것. 사진 칸 위치가 1px만 어긋나도 지문이 4~7 달라지므로
    카드를 읽을 때 ±1px 어긋난 지문(card['photo_shifts'])까지 함께 비교한다."""
    photos = memory.get('photos') or []
    if not photos:
        return None
    key = id(photos), len(photos)
    if key not in _PHOTO_MATRIX:
        _PHOTO_MATRIX.clear()
        _PHOTO_MATRIX[key] = np.array([np.frombuffer(bytes.fromhex(p['hash']), dtype=np.uint8) for p in photos],
                                      dtype=np.int16)
    mat = _PHOTO_MATRIX[key]
    best, who = 255.0, None
    for h in [card['photo']] + card.get('photo_shifts', []):
        v = np.frombuffer(bytes.fromhex(h), dtype=np.uint8).astype(np.int16)
        d = np.abs(mat - v).mean(axis=1)
        i = int(d.argmin())
        if d[i] < best:
            best, who = float(d[i]), photos[i]
    return who if best <= PHOTO_SAME else None


def learn(memory, confirmed):
    """confirmed: [(카드, DB 선수)] - 사람이 확인했거나 이름·사진으로 확실히 맞은 짝."""
    def add(kind, value, bits, lead=None, bg=None):
        if not bits:
            return
        same = [t for t in memory[kind] if t['value'] == value and t.get('bg') == bg]
        if any(bits_distance(bits, t['bits']) < 0.02 for t in same) or len(same) >= TEMPLATES_PER_VALUE:
            return
        item = {'value': value, 'bits': bits, 'bg': bg}
        if lead:
            item['lead'] = lead
        memory[kind].append(item)
    for card, r in confirmed:
        add('tier', str(r['tier']), card.get('tier_bits'), card.get('tier_lead'), card.get('bg'))
        add('race', r['race'], card.get('race_bits'), bg=card.get('bg'))
        memory['photos'] = [p for p in memory['photos'] if hash_distance(p['hash'], card['photo']) > PHOTO_SAME]
        memory['photos'].append({'hash': card['photo'], 'soop_id': r.get('soop_id'), 'nickname': r['nickname']})
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
    changes, review = [], []
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
        for r in sec['missing']:
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
