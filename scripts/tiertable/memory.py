"""기억(학습): 확인된 카드의 사진 지문·티어/종족 글씨 모양을 쌓아 두고 다음 갱신 때 쓴다."""

import json
from pathlib import Path

import numpy as np

from .features import PHOTO_SAME, _photo_vec, hash_distance, nearest, unpack_feat
from .layout import DIGIT_W, RACE_BOX, ROOT, TIER_BOX


MEMORY_PATH = ROOT / 'data' / 'tier_table_memory.json'
TEMPLATES_PER_VALUE = 30


def load_memory(path=MEMORY_PATH):
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding='utf-8'))
    return {'tier': [], 'race': [], 'photos': []}


def save_memory(memory, path=MEMORY_PATH):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(memory, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')


def _cands(memory, kind, known):
    shape = (TIER_BOX[1], TIER_BOX[0]) if kind == 'tier' else (RACE_BOX[1], RACE_BOX[0])
    out = [(unpack_feat(t['feat'], shape), t['value']) for t in memory.get(kind) or []]
    if known and known.get(kind + '_feat'):
        # 종족미정(null)은 ''로 둬야 '못 읽음'(None)과 구분된다
        out.append((unpack_feat(known[kind + '_feat'], shape), known[kind] or ''))
    return out


def classify_tier(feat, memory, known=None, detail=False):
    """숫자 티어면 숫자 부분만 숫자 후보끼리 다시 비교한다. detail=True면 (값, 여유, 두 번째 후보)."""
    cands = _cands(memory, 'tier', known)
    value, dist, alt, margin = nearest(feat, cands, detail=True)
    if value is None or dist > 0.25:
        return (None, None, None) if detail else None
    if value.isdigit():
        cands = [c for c in cands if c[1].isdigit()]
        value, dist, alt, margin = nearest(feat, cands, DIGIT_W, detail=True)
    if not detail:
        return value
    return value, margin, alt


def classify_race(feat, memory, known=None, detail=False):
    cands = _cands(memory, 'race', known)
    value, dist, alt, margin = nearest(feat, cands, detail=True)
    value = value if value is not None and dist <= 0.25 else None
    if not detail:
        return value
    if value is None:
        return None, None, None
    return value, margin, alt


_PHOTO_MATRIX = {}


def recall_photo(card, memory):
    """기억한 사진 중 가장 가까운 것. 1px만 어긋나도 지문이 4~7 달라져 ±2px 지문까지 비교한다."""
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


NAME_READS_KEEP = 5   # 줄바꿈으로 이어 name_read 한 칸에 둔다


def name_reads(entry) -> list:
    return [x for x in str((entry or {}).get('name_read') or '').split('\n') if x]


def learn(memory, confirmed):
    """confirmed: [(카드, DB 선수)]. 글씨는 값마다 구역 색이 다양하게, 사진은 선수마다 최신 하나."""
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
        add('race', r['race'] or '', card.get('race_feat'), card.get('bg'))
        same_player = [p for p in memory['photos'] if hash_distance(p['hash'], card['photo']) <= PHOTO_SAME
                       or (r.get('soop_id') and p.get('soop_id') == r.get('soop_id'))]
        # OCR이 같은 카드를 '주이'·'쑤이'처럼 번갈아 읽어 지난번 글씨도 이어 둔다
        reads = name_reads(card)
        for p in same_player:
            if p.get('nickname') == r['nickname']:
                reads += name_reads(p)
        reads = list(dict.fromkeys(x for x in reads if x))[:NAME_READS_KEEP]
        memory['photos'] = [p for p in memory['photos'] if not any(p is q for q in same_player)]
        memory['photos'].append({'hash': card['photo'], 'soop_id': r.get('soop_id'), 'nickname': r['nickname'],
                                 'tier': str(r['tier']), 'race': r['race'],
                                 'tier_feat': card.get('tier_feat'), 'race_feat': card.get('race_feat'),
                                 'name_read': '\n'.join(reads) or None, 'name_feat': card.get('name_feat')})
    return memory
