"""이미지 → 카드: 대학 구역을 나누고, 카드 자리를 찾아 사진·티어·닉네임·종족을 읽는다."""

import difflib
import re

import numpy as np
from PIL import Image, ImageOps

from .features import glyph_feat, name_distance, pack_feat, photo_hash, unpack_feat
from .layout import HEADER, NAME_BOX, NAME_SAME, PHOTO, RACES, RACE_BOX, ROLES, TIER_BOX, TIER_WORDS
from .memory import classify_race, classify_tier, name_reads, recall_photo


try:
    import pytesseract
except ImportError:  # pragma: no cover - 설치 안내
    pytesseract = None
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


def ocr(img: Image.Image, lang: str) -> str:
    if pytesseract is None:
        raise SystemExit('pytesseract가 필요합니다: pip install pytesseract (tesseract-ocr, tesseract-ocr-kor 설치)')
    return pytesseract.image_to_string(img, lang=lang, config='--psm 7').strip()


def _word_spans(a, bg):
    """글씨가 있는 열을 단어(묶음) 단위 [시작, 끝) 목록으로. 3px 넘게 비면 다른 단어."""
    ink = np.abs(a - bg).sum(axis=2) > 150
    cols = ink.any(axis=0)
    spans, x, W = [], 0, a.shape[1]
    while x < W:
        if cols[x]:
            s = x
            while x < W and cols[x:x + 3].any():
                x += 1
            spans.append((s, x))
        x += 1
    return spans


def strip_badge(crop: Image.Image, bg) -> Image.Image:
    """닉네임 뒤 '학생회장'·'인턴' 뱃지(검은 글씨 + 밝은 테두리)를 잘라 낸다.
    이름 글씨가 밝은 구역에서, 뒤쪽 단어에 바탕보다 어두운 점이 많으면 뱃지다. 이름 글씨 자체가
    어두운 구역(노란 바탕 등)은 뱃지를 구분할 수 없어 그대로 둔다(그 구역엔 앞에 직책이 붙는다)."""
    a = np.asarray(crop.convert('RGB')).astype(int)
    bgv = np.array(bg)
    lum = a.mean(axis=2)
    spans = _word_spans(a, bgv)
    if len(spans) < 2:
        return crop
    dark = lambda s, e: int((lum[:, s:e] < bgv.mean() - 40).sum())
    if dark(*spans[0]) >= 30:
        return crop
    for s, e in spans[1:]:
        if dark(s, e) >= 60:
            return crop.crop((0, 0, max(1, s - 2), crop.height))
    return crop


def name_ink(crop: Image.Image, bg, scale=4) -> Image.Image:
    """닉네임 OCR용: 흑백으로 딱 자르지 않고 바탕과 다른 정도를 회색 농도로 남긴 채 4배로 키운다.
    작은 한글은 글자 가장자리의 흐린 점이 획을 구분하는 단서라, 이진화(text_mask)보다 훨씬 잘 읽는다
    (2026-09-25 티어표 219장: 정답률 63% → 95%, 시간 같음)."""
    a = np.asarray(crop.convert('RGB')).astype(np.float32)
    dist = np.abs(a - np.array(bg, dtype=np.float32)).sum(axis=2)
    g = np.clip(255 - dist * 255 / max(200.0, float(np.percentile(dist, 98))), 0, 255).astype(np.uint8)
    im = Image.fromarray(g, 'L').resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
    return ImageOps.expand(im, border=16, fill=255)


_HANGUL = re.compile('[가-힣]')


def read_name(crop: Image.Image, bg):
    """(직책, 닉네임, 읽은 글씨). 한 줄로 못 읽으면(짧은 이름이 빈칸으로 나오는 경우) 읽는 방식을 바꿔 다시 본다."""
    img = name_ink(strip_badge(cut_badge(crop), bg), bg)
    raw, role, nick = '', '', ''
    for psm in (7, 8, 13):
        raw = pytesseract.image_to_string(img, lang='kor', config=f'--psm {psm}').strip() if pytesseract else ''
        role, nick = split_role(raw)
        nick = ''.join(ch for ch in nick if _HANGUL.match(ch) or ch.isalnum())
        if _HANGUL.search(nick):
            break
    return role, nick, raw


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
        # 찾은 네모는 4px 단위라 원래 사진(80px)의 가장자리가 조금 어긋날 수 있다. 크기가 80px에서
        # 크게 벗어나지 않으면 80px로 보고, 글씨 위치는 사진 크기에 비례해 잡는다.
        if abs(side - PHOTO) <= 8:
            side = PHOTO
        photo = im.crop((x, y, x + side, y + side))
        if side != PHOTO:
            photo = photo.resize((PHOTO, PHOTO), Image.LANCZOS)
        tx = x + side + 5
        tier_img = im.crop((tx, y + 2, tx + tw, y + 2 + TIER_BOX[1]))
        name_img = im.crop((tx, y + 26, tx + tw, y + 50))
        name_f = glyph_feat(name_img, bg, NAME_BOX[0])
        race_img = im.crop((tx, y + 49, tx + tw, y + 49 + RACE_BOX[1]))
        tier_f, race_f = glyph_feat(tier_img, bg, TIER_BOX[0]), glyph_feat(race_img, bg, RACE_BOX[0])
        card = {'row': row, 'col': col, 'x': x, 'y': y, 'side': side, 'bg': '%02x%02x%02x' % bg,
                'tier_feat': pack_feat(tier_f), 'race_feat': pack_feat(race_f), 'name_feat': pack_feat(name_f),
                'photo': photo_hash(photo),
                'photo_shifts': [photo_hash(im.crop((x + dx, y + dy, x + side + dx, y + side + dy)).resize((PHOTO, PHOTO)))
                                 for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2) if dx or dy]}
        mem = memory or {}
        known = recall_photo(card, mem)
        # 기억한 글씨(아는 선수면 그 선수의 지난번 글씨 포함) 중 가장 가까운 값. 기억이 없으면 OCR
        tier, tier_margin, tier_alt = classify_tier(tier_f, mem, known, detail=True)
        race, race_margin, race_alt = classify_race(race_f, mem, known, detail=True)
        tier_raw = ocr(text_mask(tier_img, bg), 'eng+kor') if not tier else ''
        race_raw = ocr(text_mask(race_img, bg), 'eng') if not race else ''
        # 닉네임 글씨는 사진으로 아는 선수도 늘 읽는다 - 사진만 보고 넘어가면 닉네임 변경(박쭈이 → 쭈이)을
        # 놓친다. 지난번까지 이 선수 카드를 읽은 글씨(name_read, 최근 몇 개)와 같으면
        # 글자 인식이 조금 틀렸더라도 바뀐 게 아니다(기억한 닉네임을 쓴다). 다르면 읽은 글씨를 그대로 넘겨
        # 비교 단계에서 '닉네임 변경' 후보가 된다.
        # 아는 선수이고 닉네임 칸 그림이 지난번과 같으면 이름도 같다 - 글씨를 읽지 않는다.
        # 그림이 다르면(또는 기억한 그림이 없으면) 읽어서, 지난번에 읽은 글씨와 비교한다.
        if known and known.get('name_feat') and name_distance(
                name_f, unpack_feat(known['name_feat'], (NAME_BOX[1], NAME_BOX[0]))) <= NAME_SAME:
            role, nick, name_raw = '', known['nickname'], ''
            card['name_read'] = known.get('name_read') or ''
            card['name_unchanged'] = True
        else:
            role, nick, name_raw = read_name(name_img, bg)
            card['name_read'] = nick
            if known and nick and nick in name_reads(known):
                nick = known['nickname']
                card['name_unchanged'] = True
        # 기억 글씨로 읽었으면 두 번째 후보와의 여유(작으면 비교 단계에서 '확인 필요'), OCR로 읽었으면 표시만
        card['tier_read'] = {'margin': round(tier_margin, 4), 'alt': tier_alt} if tier else {'ocr': True}
        card['race_read'] = {'margin': round(race_margin, 4), 'alt': race_alt} if race else {'ocr': True}
        card.update({'tier': tier or read_tier(tier_raw), 'race': race or read_race(race_raw),
                     'role': role, 'nickname_ocr': nick or (known['nickname'] if known else ''),
                     'raw': {'tier': tier_raw, 'name': name_raw, 'race': race_raw}})
        if known:
            card['known'] = {'soop_id': known.get('soop_id'), 'nickname': known['nickname']}
        cards.append(card)
    return cards


def title_image(im: Image.Image, top: int):
    """구역 머리의 대학 이름(로고 오른쪽 큰 글씨)만 흑백으로 오려 낸다."""
    bg = np.asarray(im.getpixel((3, top + 5))).astype(int)
    a = np.asarray(im.crop((300, top + 22, im.width, top + 95))).astype(int)
    # 이름은 흰 글씨 또는 검은 글씨(바탕이 밝은 대학)
    ink = (np.abs(a - bg).sum(2) > 150) & ((a.min(2) > 190) | (a.max(2) < 70))
    cols = np.where(ink.sum(0) > 0)[0]
    if not len(cols):
        return None
    # 오른쪽 끝 글자부터 왼쪽으로 좁은 틈(글자 사이)만 이어 붙인다: 로고는 넓은 틈으로 떨어져 있어 빠진다
    right = left = cols[-1]
    for x in cols[::-1]:
        if left - x > 16:
            break
        left = x
    return ImageOps.expand(Image.fromarray(np.where(ink[:, left:right + 1], 0, 255).astype('uint8')), 20, 255)


def read_title(im: Image.Image, top: int):
    """대학 이름 글씨 후보(한글 전용·한영 두 가지로 읽는다. 둘 중 잘 읽히는 쪽이 대학마다 다르다)."""
    img = title_image(im, top)
    if img is None:
        return []
    out = []
    for lang in ('kor', 'kor+eng'):
        text = re.sub(r'[^0-9A-Za-z가-힣]', '', ocr(img, lang))
        if text and text not in out:
            out.append(text)
    return out


def read_image(im: Image.Image, memory=None):
    return [{'y': (top, bottom), 'title_ocr': read_title(im, top), 'cards': cards_in_section(im, top, bottom, memory)}
            for top, bottom in split_sections(im)]
