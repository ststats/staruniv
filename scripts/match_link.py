"""
'매치 목록'과 '매치 전적(라운드)' 시트를 서로 연결한다. 각 매치/라운드에 같은
'_match_key'를 붙여서, 같은 날 같은 상대와 여러 번 붙어도 라운드가 섞이지 않게 한다.

[연결 방식]
1) 기본 - '매치 번호' 컬럼(시트 1열)을 그대로 신뢰해서 연결한다.
   번호 매김이 두 가지일 수 있어 자동으로 가려낸다:
     - 전체 통짜 번호(1, 2, 3... 시트 전체에서 유일) -> 번호만으로 연결.
       날짜나 상대팀을 잘못 적어도 번호만 맞으면 정확히 붙는다.
     - 날짜별 회차(날마다 1부터 다시 시작) -> (날짜, 상대팀, 번호)로 연결.
   '매치 목록'의 번호가 전부 유일하면 전자, 겹치는 번호가 있으면 후자로 판단한다.
2) 대체 - 번호 칸이 비어 있는 줄(컬럼 추가 이전의 과거 데이터)만 예전 추론 방식을 쓴다.
   시트에 적힌 순서를 보고, 같은 (날짜, 상대팀) 안에서 '세트' 값이 이미 나왔던 값으로
   되돌아가면 새 경기로 판단한다. ('라운드' 번호 리셋만으로 판단하면 안 된다 - 같은 경기
   안에서 2세트/슈에로 넘어갈 때도 라운드가 1라부터 다시 시작하기 때문. 세트 값이 아예
   없는 더 옛날 데이터를 위해서만 라운드 번호 리셋을 본다.)

* '형식'은 '매치 전적' 시트에 자체 컬럼으로 들어오므로 값이 있으면 그대로 신뢰한다.
  매치에서 가져와 채우는 건 값이 비어 있는 과거 데이터용 대체 수단이다.

* '내전'(상대팀이 우리 크루 자체인 스크림) 라운드는 시트에 세트당 한 줄만 기록된다
  (예: A가 이겼다는 관점으로 '우리 선수'=A, '상대 선수'=B). 이 한 줄만 가지고 개인 통계를
  집계하면 진 쪽(B)은 자기 이름으로 이 세트가 전혀 집계되지 않는다(개인 승패, 종족전,
  맵 전적, 최근 전적 모두 누락). 그래서 내전 라운드마다 '우리 선수'/'상대 선수'를 뒤집고
  결과를 반전시킨 '미러' 라운드를 하나 더 만들어 함께 반환한다. 미러 라운드는
  '_mirrored': True로 표시해두는데, 팀 매치 상세보기(세트별 목록)는 원본 한 줄만 보여줘야
  하므로 프론트엔드에서 이 플래그를 보고 걸러낸다(page-records.js의 roundsForMatch 참고).
  미러 라운드의 '상대 종족'은 원래 '우리 선수'의 종족을 멤버 목록에서 찾아 채운다.

[리팩토링 메모]
- 예전에는 매치 번호 컬럼이 없어서 시트 입력 순서만으로 회차를 추론했다. 이제 시트에
  정식 번호가 생겼으므로 그 값을 1순위로 쓰고, 추론 로직은 번호가 빈 과거 줄에만 적용한다.
- generate_stats.py와 build_html.py가 똑같은 db.json으로 link_rounds_to_matches를 각자
  한 번씩 돌리던 중복을 없애기 위해 load_linked_db()를 둔다. db.json 원본 바이트의 해시를
  키로 결과를 build/linked_db.json에 캐시하고, 해시가 다르면 무조건 다시 계산한다.
"""

import hashlib
import json
import os

# 파이프라인 중간 산출물 캐시 위치. update.yml은 data/*.json과 docs/ 일부만 git add
# 하므로 build/ 아래 파일은 커밋되지 않는다(저장소 용량이 늘지 않음).
LINKED_CACHE_PATH = os.path.join('build', 'linked_db.json')
# 캐시 포맷을 바꾸면 이 값을 올린다 - 버전이 다르면 옛 캐시는 무시하고 다시 계산한다.
_LINKED_CACHE_VERSION = 2   # 연결 규칙이 바뀌면 올린다(옛 캐시 자동 무효화)


def _extract_round_num(round_str):
    """'1R'~'11R', 'ACE', 빈값(번외) 등 다양한 표기를 지원한다. 문자열에서
    숫자만 뽑아내는 방식이라 접미사가 'R'이든 '라'든(구 데이터 호환) 상관없이
    동작한다. 'ACE'나 빈값처럼 숫자를 뽑을 수 없으면 None을 반환하고,
    그 경우 라운드 리셋 판단은 '세트' 값 변화만으로 하게 된다."""
    digits = ''.join(ch for ch in str(round_str or '').strip() if ch.isdigit())
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:  # 유니코드 숫자(예: '²')처럼 isdigit()은 참인데 int()가 거부하는 경우
        return None


# 멤버 시트의 '종족'(전체 단어) -> 라운드 시트가 쓰는 코드. 순서가 곧 우선순위다
# (app.js의 raceShortLabel과 동일한 규칙: 먼저 포함되는 단어가 이긴다).
_RACE_CODES = (('테란', 'T'), ('저그', 'Z'), ('프로토스', 'P'))


def _race_to_code(race_full):
    """멤버 시트의 '종족'(테란/저그/프로토스 전체 단어)을 라운드 시트가 쓰는
    'T'/'Z'/'P' 코드로 변환한다 (app.js의 raceShortLabel과 동일한 규칙)."""
    race_full = str(race_full or '')
    for word, code in _RACE_CODES:
        if word in race_full:
            return code
    return ''


_FLIP_RESULT = {'승': '패', '패': '승'}


def _flip_result(res):
    res = str(res or '').strip()
    return _FLIP_RESULT.get(res, res)  # 무/무승부/빈값 등은 그대로


def _build_mirrored_rounds(rounds, members):
    """_match_key까지 부여된 rounds 중 내전 라운드를 뒤집은 사본 리스트를 만든다."""
    # 이름 -> 종족 조회 테이블을 한 번만 만들어 두고(O(M)), 라운드마다 O(1)로 찾는다.
    race_by_name = {}
    for m in (members or []):
        name = str(m.get('이름') or '').strip()
        if name:
            race_by_name[name] = m.get('종족')

    mirrors = []
    for r in rounds:
        if str(r.get('상대팀') or '').strip() != '내전':
            continue
        our_player = str(r.get('우리 선수') or '').strip()
        opp_player = str(r.get('상대 선수') or '').strip()
        if not our_player or not opp_player:
            continue

        mirror = dict(r)
        mirror['우리 선수'] = opp_player
        mirror['상대 선수'] = our_player
        mirror['결과'] = _flip_result(r.get('결과'))
        mirror['상대 종족'] = _race_to_code(race_by_name.get(our_player, ''))
        mirror['_mirrored'] = True
        mirrors.append(mirror)
    return mirrors


# '매치 번호' 컬럼 이름 후보. 시트에서 실제로 쓰는 이름 하나만 있으면 된다
# (띄어쓰기/표기가 조금 달라도 붙도록 몇 가지를 함께 둔다).
MATCH_NO_COLUMNS = ('매치 번호', '매치번호', '매치 No', '매치No', '경기 번호', '경기번호', '번호')

# '라운드' 컬럼 이름 후보. 시트 헤더에 오타('라운이드')가 있어도 화면에 라운드가
# 안 나오는 사고로 이어지지 않도록 후보를 몇 개 두고, 표준 이름('라운드')으로 옮겨 담는다.
# (표준 이름이 아니면 빌드 로그에 경고를 남기니, 시트 헤더를 고치는 편이 낫다.)
ROUND_COLUMN = '라운드'
ROUND_COLUMN_CANDIDATES = ('라운드', '라운이드', '라운 드', '라운드수', '라운')


def _find_column(rows, candidates):
    """행 목록에서 후보 이름 중 실제로 쓰이는 컬럼 이름을 찾는다(없으면 None)."""
    if not rows:
        return None
    columns = rows[0].keys()
    for name in candidates:
        if name in columns:
            return name
    return None


def _find_match_no_column(rows):
    return _find_column(rows, MATCH_NO_COLUMNS)


def _normalize_round_column(rounds):
    """라운드 컬럼 헤더가 표준 이름이 아니면 표준 이름으로도 값을 넣어 준다.
    프론트엔드(세트 상세의 '1세트 1R' 표기)와 과거 데이터 추론이 모두 '라운드'를 보기 때문에,
    헤더 오타 하나로 화면에서 라운드가 통째로 사라지는 것을 막는다. 반환값은 실제 헤더 이름."""
    found = _find_column(rounds, ROUND_COLUMN_CANDIDATES)
    if found and found != ROUND_COLUMN:
        for r in rounds:
            r.setdefault(ROUND_COLUMN, r.get(found))
        print(f"⚠️ '매치 전적' 시트의 라운드 컬럼 이름이 '{found}'입니다. "
              f"'{ROUND_COLUMN}'로 고쳐주세요(지금은 코드가 대신 맞춰 넣었습니다).")
    return found


def _match_no(row, column):
    """매치 번호를 문자열로 정규화한다. 시트에서 숫자로 읽히면 1과 1.0이 섞일 수 있어
    정수로 떨어지는 값은 정수 표기로 통일한다. 빈 칸이면 ''."""
    if not column:
        return ''
    value = row.get(column)
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _make_match_key(key, seq):
    return f"{key[0]}__{key[1]}__{seq}"


class _SequenceState:
    """(날짜, 상대팀) 하나에 대한 라운드 순번 추론 상태."""
    __slots__ = ('seq', 'seen_sets', 'last_set', 'last_num')

    def __init__(self):
        self.seq = 0                # 지금 몇 번째 경기(chunk)인지
        self.seen_sets = set()      # 현재 경기 안에서 이미 등장한 '세트' 값들
        self.last_set = None        # 직전 라운드의 '세트' 값 (같은 세트 안의 다음 라운드인지 판단용)
        self.last_num = None        # 직전 라운드 번호 ('세트' 값이 없는 옛날 데이터의 fallback 판단용)


class _RoundSequencer:
    """라운드를 시트 순서대로 하나씩 넣으면 그 라운드가 속한 매치 순번을 돌려준다."""

    def __init__(self):
        self._states = {}

    @staticmethod
    def _is_new_match(st, set_name, num):
        # '세트' 값이 있고 바뀌었으면: 지금 이 경기(chunk) 안에서 이미 등장했던 값으로
        # 되돌아간 것이면 새 경기, 처음 보는 값이면 같은 경기 안의 다음 세트로 진행.
        if set_name and set_name != st.last_set:
            return set_name in st.seen_sets
        # 그 외의 경우(세트 값이 직전과 같거나, 세트 값 자체가 없는 옛날 데이터)는
        # 라운드 번호가 줄어드는 것(예: 9R 다음에 다시 1R)만으로 재대결을 판단한다 -
        # '단일'/'끝장전'처럼 세트값이 경기 내내 안 바뀌는 형식에서는 이게 유일한 신호다.
        # 'ACE'/빈 라운드처럼 번호를 못 뽑는 라운드가 중간에 껴 있어도 어차피 그 라운드
        # 자체가 리셋 판단에 안 쓰이면(직전 라운드가 됐을 때만 last_num으로 쓰임) 문제없다.
        return st.last_num is not None and num is not None and num <= st.last_num

    def assign(self, key, set_name, num):
        st = self._states.get(key)
        if st is None:
            st = self._states[key] = _SequenceState()

        if self._is_new_match(st, set_name, num):
            st.seq += 1
            st.seen_sets = set()

        if set_name:
            st.seen_sets.add(set_name)
            st.last_set = set_name
        st.last_num = num
        return st.seq


def link_rounds_to_matches(matches, rounds, members=None):
    """matches, rounds(dict 리스트)를 받아 각 항목에 '_match_key'를 붙이고,
    라운드에 '형식'이 비어 있으면 대응하는 매치의 '형식'으로 채워서
    (matches_copy, rounds_copy)로 반환한다. 라운드에 '형식'이 이미 있으면 그대로 둔다.
    members(멤버 목록, 선택)를 넘기면 내전 라운드에 대해 반대편 관점의 미러 라운드를
    함께 만들어 rounds_copy에 포함시킨다 (미러 라운드는 '_mirrored': True).
    입력 리스트/딕셔너리는 절대 변경하지 않는다(얕은 복사본에만 키를 추가)."""
    matches = [dict(m) for m in (matches or [])]
    rounds = [dict(r) for r in (rounds or [])]

    match_no_col = _find_match_no_column(matches)
    round_no_col = _find_match_no_column(rounds)
    _normalize_round_column(rounds)

    # 번호 매김 방식 판별: '매치 목록'의 번호가 전부 유일하면 시트 전체 통짜 번호,
    # 같은 번호가 여러 줄에 있으면 날짜별로 다시 시작하는 회차 번호로 본다.
    match_nos = [_match_no(m, match_no_col) for m in matches]
    filled_nos = [n for n in match_nos if n]
    global_numbering = bool(filled_nos) and len(set(filled_nos)) == len(filled_nos)

    def numbered_key(row, no):
        # 통짜 번호면 번호만으로 연결한다(날짜/상대팀 오타가 있어도 정확히 붙는다).
        # 날짜별 회차면 날짜와 상대팀까지 묶어야 서로 다른 경기가 구분된다.
        if global_numbering:
            return f"no__{no}"
        return f"{row.get('날짜')}__{row.get('상대팀')}__no{no}"

    # 1. 매치에 키 부여 (번호가 있으면 번호로, 없으면 예전 방식대로 등장 순서로)
    match_seq_counter = {}
    match_by_key = {}
    for m, no in zip(matches, match_nos):
        if no:
            m_key = numbered_key(m, no)
        else:
            key = (m.get('날짜'), m.get('상대팀'))
            seq = match_seq_counter.get(key, 0)
            match_seq_counter[key] = seq + 1
            m_key = _make_match_key(key, seq)
        m['_match_key'] = m_key
        match_by_key[m_key] = m

    # 2. 라운드에 키 부여
    sequencer = _RoundSequencer()
    rounds_without_no = 0
    format_conflicts = []   # 매치와 라운드의 '형식'이 서로 다른 경우
    for r in rounds:
        no = _match_no(r, round_no_col)
        if no:
            m_key = numbered_key(r, no)
        else:
            # 번호가 빈 과거 데이터: 시트 순서 기반 추론으로 대체
            rounds_without_no += 1
            key = (r.get('날짜'), r.get('상대팀'))
            set_name = str(r.get('세트') or '').strip()
            seq = sequencer.assign(key, set_name, _extract_round_num(r.get('라운드')))
            m_key = _make_match_key(key, seq)
        r['_match_key'] = m_key

        # 라운드 자체에 형식 값이 없을 때만 매치에서 유추해서 채운다 (fallback)
        round_fmt = str(r.get('형식', '')).strip()
        matched = match_by_key.get(m_key)
        if not round_fmt:
            r['형식'] = matched.get('형식', '') if matched else ''
        elif matched:
            match_fmt = str(matched.get('형식', '')).strip()
            # 값이 둘 다 있는데 서로 다르면 둘 중 하나가 오타다. 라운드 값을 함부로 덮어쓰지 않고
            # (어느 쪽이 맞는지는 사람만 안다) 어긋난 건수만 모아 아래에서 알려준다.
            if match_fmt and match_fmt != round_fmt:
                format_conflicts.append((m_key, matched, match_fmt, round_fmt))

    _report_linking(match_no_col, round_no_col, global_numbering, matches, rounds,
                    match_by_key, rounds_without_no, match_nos, format_conflicts)

    # 3. 내전 라운드는 반대편 관점의 미러 라운드를 만들어 추가한다.
    #    (_match_key가 이미 원본과 동일하게 붙어 있으므로 미러도 같은 매치로 묶인다)
    rounds = rounds + _build_mirrored_rounds(rounds, members)

    return matches, rounds


def _report_linking(match_no_col, round_no_col, global_numbering, matches, rounds,
                    match_by_key, rounds_without_no, match_nos, format_conflicts=()):
    """연결이 어떻게 됐는지 빌드 로그에 남긴다. 시트에 오타가 나면 조용히 빠지는 대신
    여기서 바로 드러나게 하는 것이 목적이다."""
    if not match_no_col:
        print("ℹ️ '매치 목록'에 매치 번호 컬럼이 없어 예전 방식(시트 순서 추론)으로 연결합니다.")
        return

    mode = '시트 전체 통짜 번호' if global_numbering else '날짜별 회차 번호'
    print(f"ℹ️ 매치 번호('{match_no_col}')로 연결합니다 - {mode}")

    if not round_no_col:
        print("⚠️ '매치 전적' 시트에는 매치 번호 컬럼이 없습니다. 라운드는 예전 방식으로 연결됩니다.")
    elif rounds_without_no:
        print(f"⚠️ '매치 전적' {rounds_without_no}행에 매치 번호가 비어 있어 그 행만 예전 방식으로 연결했습니다.")

    missing_no = sum(1 for n in match_nos if not n)
    if missing_no:
        print(f"⚠️ '매치 목록' {missing_no}행에 매치 번호가 비어 있습니다.")

    # 어느 매치에도 붙지 못한 라운드(번호 오타 등)를 찾아 알려준다.
    orphans = {}
    for r in rounds:
        if r['_match_key'] not in match_by_key:
            orphans.setdefault(r['_match_key'], 0)
            orphans[r['_match_key']] += 1
    if orphans:
        sample = list(orphans.items())[:5]
        print(f"⚠️ 대응하는 매치를 찾지 못한 라운드가 {sum(orphans.values())}행 있습니다(번호 오타일 수 있음). "
              f"예시: {[f'{k} x{v}' for k, v in sample]}")

    # 매치와 라운드의 '형식'이 서로 다른 경우 - 한쪽이 오타이므로 시트를 고쳐야 한다.
    if format_conflicts:
        by_match = {}
        for m_key, match, match_fmt, round_fmt in format_conflicts:
            entry = by_match.setdefault(m_key, {'match': match, 'match_fmt': match_fmt, 'round_fmts': {}})
            entry['round_fmts'][round_fmt] = entry['round_fmts'].get(round_fmt, 0) + 1
        print(f"⚠️ 매치와 세트의 '형식'이 어긋난 매치가 {len(by_match)}건 있습니다(둘 중 하나가 오타):")
        for entry in list(by_match.values())[:5]:
            m = entry['match']
            detail = ', '.join(f"{fmt} {cnt}행" for fmt, cnt in entry['round_fmts'].items())
            print(f"   {m.get('날짜')} vs {m.get('상대팀')} - 매치 목록은 '{entry['match_fmt']}', 매치 전적은 {detail}")

    # 라운드가 하나도 없는 매치(전적 미입력)도 알려준다.
    used_keys = {r['_match_key'] for r in rounds}
    empty = [m for m in matches if m['_match_key'] not in used_keys]
    if empty:
        sample = [f"{m.get('날짜')} vs {m.get('상대팀')}" for m in empty[:5]]
        print(f"ℹ️ 세트 기록이 없는 매치가 {len(empty)}건 있습니다. 예시: {sample}")


def _file_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def load_linked_db(db_path='data/db.json', cache_path=LINKED_CACHE_PATH):
    """db.json을 읽고 link_rounds_to_matches 결과까지 붙여 (db, matches, rounds)로 반환한다.

    같은 db.json(바이트 단위로 동일)에 대해 이미 계산해 둔 결과가 캐시에 있으면
    그걸 그대로 쓰고, 없거나 해시가 다르면 새로 계산해서 캐시에 저장한다. 캐시는
    순수한 최적화일 뿐이라 읽기/쓰기에 실패해도 조용히 무시하고 정상 계산 결과를 돌려준다.
    FileNotFoundError(db.json 자체가 없음)는 호출부가 처리하도록 그대로 올려보낸다."""
    db_hash = _file_sha256(db_path)
    with open(db_path, 'r', encoding='utf-8') as f:
        db = json.load(f)

    try:
        with open(cache_path, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        if cached.get('version') == _LINKED_CACHE_VERSION and cached.get('db_sha256') == db_hash:
            return db, cached['matches'], cached['rounds']
    except (OSError, ValueError, KeyError, AttributeError):
        pass  # 캐시가 없거나 깨졌으면 아래에서 새로 계산

    matches, rounds = link_rounds_to_matches(db.get('matches', []), db.get('rounds', []), db.get('members', []))

    try:
        os.makedirs(os.path.dirname(cache_path) or '.', exist_ok=True)
        tmp_path = cache_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump({'version': _LINKED_CACHE_VERSION, 'db_sha256': db_hash,
                       'matches': matches, 'rounds': rounds}, f, ensure_ascii=False)
        os.replace(tmp_path, cache_path)
    except OSError as e:
        print(f"⚠️ 매치 연결 결과 캐시를 저장하지 못했습니다(동작에는 영향 없음): {e}")

    return db, matches, rounds
