"""matches와 rounds를 매치 번호로 만든 '_match_key'(no__<번호>)로 잇는다.

라운드 '형식'이 매치와 다르면 한쪽이 오타라 덮어쓰지 않고 로그에 알린다.
"""

import json


def _match_key(row):
    """JSON에서 1.0처럼 읽혀도 1과 같은 키가 되게 정수로 맞춘다."""
    no = row.get('매치 번호')
    if isinstance(no, float) and no.is_integer():
        no = int(no)
    if isinstance(no, bool) or not isinstance(no, (int, str)):
        raise ValueError('유효한 매치 번호가 필요합니다')
    try:
        no = int(no)
    except ValueError as exc:
        raise ValueError('유효한 매치 번호가 필요합니다') from exc
    return f"no__{no}"


def link_rounds_to_matches(matches, rounds):
    """'_match_key'를 붙이고 라운드의 빈 '형식'을 채운 복사본을 돌려준다. 입력은 바꾸지 않는다."""
    matches = [dict(m) for m in (matches or [])]
    rounds = [dict(r) for r in (rounds or [])]
    match_by_key = {}
    for m in matches:
        m['_match_key'] = _match_key(m)
        if m['_match_key'] in match_by_key:
            raise ValueError(f"중복 매치 번호: {m['_match_key']}")
        match_by_key[m['_match_key']] = m

    format_conflicts = {}
    for r in rounds:
        r['_match_key'] = _match_key(r)
        matched = match_by_key.get(r['_match_key'])
        if matched is None:
            raise ValueError(f"연결할 매치가 없는 라운드: {r['_match_key']}")
        round_fmt = str(r.get('형식', '')).strip()
        if not round_fmt:
            r['형식'] = matched.get('형식', '')
        else:
            match_fmt = str(matched.get('형식', '')).strip()
            if match_fmt and match_fmt != round_fmt:
                counts = format_conflicts.setdefault(r['_match_key'], {})
                counts[round_fmt] = counts.get(round_fmt, 0) + 1

    _report(matches, rounds, match_by_key, format_conflicts)
    return matches, rounds


def _report(matches, rounds, match_by_key, format_conflicts):
    if format_conflicts:
        print(f"⚠️ 매치와 세트의 '형식'이 어긋난 매치가 {len(format_conflicts)}건 있습니다(둘 중 하나가 오타):")
        for key, counts in list(format_conflicts.items())[:5]:
            m = match_by_key[key]
            detail = ', '.join(f"{fmt} {cnt}행" for fmt, cnt in counts.items())
            print(f"   {m.get('날짜')} vs {m.get('상대팀')} - 매치 목록은 '{m.get('형식')}', 매치 전적은 {detail}")
    used = {r['_match_key'] for r in rounds}
    empty = [m for m in matches if m['_match_key'] not in used]
    if empty:
        sample = [f"{m.get('날짜')} vs {m.get('상대팀')}" for m in empty[:5]]
        print(f"ℹ️ 세트 기록이 없는 매치가 {len(empty)}건 있습니다. 예시: {sample}")


def load_linked_db(db_path='data/db.json'):
    with open(db_path, 'r', encoding='utf-8') as f:
        db = json.load(f)
    return link_rounds_to_matches(db.get('matches', []), db.get('rounds', []))
