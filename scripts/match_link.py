"""
'매치 목록'과 '매치 전적(라운드)' 시트에는 같은 날 같은 상대와 여러 번 붙었을 때
이를 구분할 별도의 '회차' 컬럼이 없다. (예: 연합팀과 하루에 CK를 2~3번 치른 경우)

이 모듈은 시트에 기록된 순서를 기준으로 각 매치/라운드에 고유한 매치 순번을 부여해서,
같은 (날짜, 상대팀)이라도 서로 다른 경기의 라운드가 섞이지 않도록 한다.

- 매치: (날짜, 상대팀)별로 등장 순서대로 0, 1, 2... 순번 부여
- 라운드: 같은 (날짜, 상대팀) 안에서 '세트' 값이 현재 경기 안에서 이미 등장했던
  값으로 되돌아가는 지점(예: 1세트→2세트→슈에까지 갔다가 다시 1세트)을
  새 경기의 시작으로 판단해 같은 방식으로 순번 부여.
  ('라운드' 번호 리셋만으로 판단하면 안 된다 - 같은 경기 안에서 2세트/슈에로
  넘어갈 때도 라운드가 1라부터 다시 시작하기 때문에, 그걸로만 보면 2세트/슈에가
  엉뚱하게 새 경기로 분류돼서 상세보기에서 빠져버린다. '세트' 값이 비어 있는
  옛날 데이터를 위한 fallback으로만 라운드 번호 리셋 방식을 남겨둔다.)

두 순번이 시트 입력 순서상 서로 대응한다는 가정 하에 동작하는 임시방편이며,
'매치 목록'/'매치 전적' 시트에 정식 회차 컬럼이 추가되면 이 로직은 필요 없어진다.

* '형식'은 이제 '매치 전적' 시트에 자체 컬럼으로 들어오므로, 라운드에 값이 있으면
  그대로 신뢰해서 쓴다. 매치와 매칭해 형식을 채우는 건 그 값이 비어 있는
  (컬럼 추가 이전의) 과거 데이터를 위한 fallback으로만 남겨둔다.

* '내전'(상대팀이 우리 크루 자체인 스크림) 라운드는 시트에 세트당 한 줄만
  기록된다(예: A가 이겼다는 관점으로 '우리 선수'=A, '상대 선수'=B). 이 한 줄만
  가지고 개인 통계를 집계하면 진 쪽(B)은 자기 이름으로는 이 세트가 전혀
  집계되지 않는다(개인 승패, 종족전, 맵 전적, 최근 전적 모두 누락).
  그래서 내전 라운드마다 '우리 선수'/'상대 선수'를 뒤집고 결과를 반전시킨
  '미러' 라운드를 하나 더 만들어 함께 반환한다. 미러 라운드는 '_mirrored': True로
  표시해두는데, 팀 매치 상세보기(세트별 목록)는 원본 한 줄만 보여줘야 하므로
  프론트엔드에서 이 플래그를 보고 걸러낸다(app.js의 renderTeamMatchesList 참고).
  미러 라운드의 '상대 종족'은 원래 '우리 선수'의 종족을 멤버 목록에서 찾아 채운다.
"""


def _extract_round_num(round_str):
    """'1R'~'11R', 'ACE', 빈값(번외) 등 다양한 표기를 지원한다. 문자열에서
    숫자만 뽑아내는 방식이라 접미사가 'R'이든 '라'든(구 데이터 호환) 상관없이
    동작한다. 'ACE'나 빈값처럼 숫자를 뽑을 수 없으면 None을 반환하고,
    그 경우 라운드 리셋 판단은 '세트' 값 변화만으로 하게 된다."""
    s = str(round_str or '').strip()
    digits = ''.join(ch for ch in s if ch.isdigit())
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _race_to_code(race_full):
    """멤버 시트의 '종족'(테란/저그/프로토스 전체 단어)을 라운드 시트가 쓰는
    'T'/'Z'/'P' 코드로 변환한다 (app.js의 raceShortLabel과 동일한 규칙)."""
    race_full = str(race_full or '')
    if '테란' in race_full:
        return 'T'
    if '저그' in race_full:
        return 'Z'
    if '프로토스' in race_full:
        return 'P'
    return ''


def _flip_result(res):
    res = str(res or '').strip()
    if res == '승':
        return '패'
    if res == '패':
        return '승'
    return res  # 무/무승부/빈값 등은 그대로


def _build_mirrored_rounds(rounds, members):
    """_match_key까지 부여된 rounds 중 내전 라운드를 뒤집은 사본 리스트를 만든다."""
    race_by_name = {}
    for m in (members or []):
        name = str(m.get('이름') or '').strip()
        if name:
            race_by_name[name] = m.get('종족')

    mirrors = []
    for r in rounds:
        opponent_team = str(r.get('상대팀') or '').strip()
        our_player = str(r.get('우리 선수') or '').strip()
        opp_player = str(r.get('상대 선수') or '').strip()
        if opponent_team != '내전' or not our_player or not opp_player:
            continue

        mirror = dict(r)
        mirror['우리 선수'] = opp_player
        mirror['상대 선수'] = our_player
        mirror['결과'] = _flip_result(r.get('결과'))
        mirror['상대 종족'] = _race_to_code(race_by_name.get(our_player, ''))
        mirror['_mirrored'] = True
        mirrors.append(mirror)
    return mirrors


def link_rounds_to_matches(matches, rounds, members=None):
    """matches, rounds(dict 리스트)를 받아 각 항목에 '_match_key'를 붙이고,
    라운드에 '형식'이 비어 있으면 대응하는 매치의 '형식'으로 채워서
    (matches_copy, rounds_copy)로 반환한다. 라운드에 '형식'이 이미 있으면 그대로 둔다.
    members(멤버 목록, 선택)를 넘기면 내전 라운드에 대해 반대편 관점의 미러 라운드를
    함께 만들어 rounds_copy에 포함시킨다 (미러 라운드는 '_mirrored': True)."""
    matches = [dict(m) for m in matches]
    rounds = [dict(r) for r in rounds]

    # 1. 매치에 순번 부여
    match_seq_counter = {}
    match_by_key = {}
    for m in matches:
        key = (m.get('날짜'), m.get('상대팀'))
        seq = match_seq_counter.get(key, 0)
        match_seq_counter[key] = seq + 1
        m_key = f"{key[0]}__{key[1]}__{seq}"
        m['_match_key'] = m_key
        match_by_key[m_key] = m

    # 2. 라운드에 순번 부여
    round_seq_counter = {}
    seen_sets_in_chunk = {}   # key -> 현재 경기(chunk) 안에서 이미 등장한 '세트' 값들
    last_set_name = {}       # key -> 직전 라운드의 '세트' 값 (같은 세트 안의 다음 라운드인지 판단용)
    last_round_num = {}      # key -> 직전 라운드 번호 ('세트' 값이 없는 옛날 데이터의 fallback 판단용)

    for r in rounds:
        key = (r.get('날짜'), r.get('상대팀'))
        set_name = str(r.get('세트') or '').strip()
        num = _extract_round_num(r.get('라운드'))
        seq = round_seq_counter.get(key, 0)

        # '세트' 값이 있으면 그것으로 새 경기 여부를 1차 판단한다:
        #  - '세트' 값이 바뀌었으면: 지금 이 경기(chunk) 안에서 이미 등장했던 값으로
        #    되돌아간 것이면 새 경기, 처음 보는 값이면 같은 경기 안의 다음 세트로 진행.
        #  - '세트' 값이 직전 라운드와 동일하면: 보통은 같은 세트 안의 다음 라운드지만,
        #    '단일'/'끝장전'처럼 세트값이 경기 내내 안 바뀌는 형식에서는 라운드 번호가
        #    줄어드는 것(예: 9R 다음에 다시 1R)이 재대결의 유일한 신호이므로 그걸로 판단한다.
        # 'ACE'/빈 라운드처럼 번호를 못 뽑는 라운드가 중간에 껴 있어도 어차피 그 라운드
        # 자체가 리셋 판단에 안 쓰이면(직전 라운드가 됐을 때만 prev_num으로 쓰임) 문제없다.
        # '세트' 값이 아예 없는 옛날 데이터에서는 처음부터 라운드 번호 리셋으로 판단한다.
        if set_name:
            prev_set = last_set_name.get(key)
            if set_name != prev_set:
                seen = seen_sets_in_chunk.get(key, set())
                is_new_match = set_name in seen
            else:
                prev_num = last_round_num.get(key)
                is_new_match = prev_num is not None and num is not None and num <= prev_num
        else:
            prev_num = last_round_num.get(key)
            is_new_match = prev_num is not None and num is not None and num <= prev_num

        if is_new_match:
            seq += 1
            round_seq_counter[key] = seq
            seen_sets_in_chunk[key] = set()

        if set_name:
            seen_sets_in_chunk.setdefault(key, set()).add(set_name)
            last_set_name[key] = set_name
        last_round_num[key] = num

        m_key = f"{key[0]}__{key[1]}__{seq}"
        r['_match_key'] = m_key

        # 라운드 자체에 형식 값이 없을 때만 매치에서 유추해서 채운다 (fallback)
        existing_fmt = str(r.get('형식', '')).strip()
        if not existing_fmt:
            matched = match_by_key.get(m_key)
            r['형식'] = matched.get('형식', '') if matched else ''

    # 3. 내전 라운드는 반대편 관점의 미러 라운드를 만들어 추가한다.
    #    (_match_key가 이미 원본과 동일하게 붙어 있으므로 미러도 같은 매치로 묶인다)
    rounds = rounds + _build_mirrored_rounds(rounds, members)

    return matches, rounds

