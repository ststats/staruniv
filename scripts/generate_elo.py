"""티어표 '분석' 탭이 읽을 자체 레이팅(Elo)을 계산한다: data/eloboard.json → docs/data/elo/

[왜 자체 레이팅인가]
eloboard 원본에는 선수별 레이팅 수치가 없고 승/패 기록만 있다. 37.5만 건이 쌓여 있으니
그걸로 직접 Elo를 계산해서 "누가 더 잘하는가"를 숫자 하나로 비교할 수 있게 만든다.

[형식별 가중치]
스폰(캐주얼)이 27.6만 건으로 전체의 73%를 차지한다. 가중치 없이 그대로 계산하면 레이팅이
사실상 스폰 결과로만 정해진다. 그래서 형식마다 중요도에 따라 K값(한 경기가 레이팅을 얼마나
움직이는지)에 배수를 곱한다 - 판수가 적어도 중요한 대회의 결과가 더 크게 반영되게.
중요도(운영자 지정): 개인 = 대회(대학대회) > 대학(대학대전) > 리그(프로리그) > 미니(대학미니)
> CK(팀대회) > 스폰. CAT_WEIGHTS 값만 바꾸면 다음 빌드부터 바로 반영된다.

[계산 범위 ≠ 노출 범위]
레이팅 계산 자체는 eloboard 전체 선수(휴면 포함, 수천 명)를 대상으로 한다 - 은퇴한
강자에게 이긴 기록도 그 강자의 레이팅에 반영돼야 정확하기 때문이다. 반면 사이트에 순위표로
"노출"하는 건 티어표 소속이 '휴면'이 아닌 선수만이다(약 300명 - build_h2h.py가 쓰는
"티어표에 연결된 1,100명"보다 좁은 부분집합). 이렇게 나누면 나중에 노출 기준이 바뀌어도
(예: 300명이 아니라 400명으로) 레이팅을 다시 계산할 필요 없이 필터만 바꾸면 된다.

[출력]
    docs/data/elo/index.json      - 노출 대상(휴면 제외) 선수 요약: 레이팅·순위·전적·연승 등 (한 번만 받는다)
    docs/data/elo/p/<샤드시작id>.json - 그 샤드 선수들의 "경기별 레이팅 변화" 로그
                                          ({ "<선수id>": [[날짜,상대,이김,맵,대회,경기후레이팅], ...], ... })
        h2h와 달리 오래된 경기가 앞(시간순 그대로) - 추세 그래프가 그대로 쓸 수 있게.
    샤드 나누는 방식은 build_h2h.py의 build_shards()를 그대로 재사용한다(용량 기준 빈 패킹).

    python scripts/generate_elo.py            # 티어표 명단을 받아서 만든다
    python scripts/generate_elo.py --offline  # 명단을 못 받으면 만들지 않고 멈춘다(휴면 필터에 팀 정보가 필요)
"""

import argparse
import json
import os
import shutil
import sys

from build_h2h import (
    ALIAS_PATH, CAT_LABELS, SRC_PATH,
    build_shards, link_tier_players, load_json, resolve_tier_members, write_json,
    _pid_num, _pid_sort_key,
)

OUT_DIR = os.path.join('docs', 'data', 'elo')
HIDDEN_TEAMS = {'휴면'}           # 순위표에 안 보여줄 팀(=계산엔 포함, 노출만 제외)

# 표준 Elo 초기값·기본 K. 기본 K는 흔히 쓰는 24~32 범위 중 32(변동이 좀 더 빠른 쪽)로 잡았다.
INITIAL_RATING = 1500.0
BASE_K = 32.0
# 판수가 적은 선수는 K를 키워 레이팅이 실력에 더 빨리 수렴하게 한다(체스 레이팅에서 흔한
# "프로비저널" 처리와 같은 아이디어). 30판을 넘기면 보통 K로 돌아온다.
PROVISIONAL_GAMES = 30
PROVISIONAL_MULT = 1.5

# 형식별 중요도 가중치. 코드값은 build_h2h.py의 CAT_LABELS와 같은 eloboard 형식 코드다.
# 목록에 없는 코드(새 형식이 생기거나 빈 값 '')는 기본값 1.0(스폰과 동일)을 쓴다.
CAT_WEIGHTS = {
    'solo_event': 3.0,     # 개인
    'college_event': 3.0,  # 대회 (대학대회) - 개인과 동률 1순위
    'college_war': 2.5,    # 대학 (대학대전)
    'pro_league': 2.0,     # 리그 (프로리그)
    'college_mini': 1.5,   # 미니 (대학미니)
    'team_event': 1.5,     # CK (팀대회)
    'sponsored': 1.0,      # 스폰
    '': 1.0,                # 기타/미상
}


def expected_score(rating_a, rating_b):
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def compute_ratings(rows, cats):
    """전체 선수(휴면 포함) 대상으로 시간순 Elo를 계산한다.
    돌려주는 값: (rating: {pid: float}, per_player_log: {pid: [[날짜,상대,이김,맵,대회,레이팅후], ...]})
    per_player_log는 이 함수 안에서 시간순으로 순회하며 그대로 append하므로 이미 오래된 경기가
    앞이다(따로 정렬할 필요가 없다 - h2h처럼 나중에 reverse하지 않는다)."""
    rating = {}
    games = {}
    log = {}

    def get_rating(pid):
        return rating.setdefault(pid, INITIAL_RATING)

    def k_for(pid, weight):
        n = games.get(pid, 0)
        mult = PROVISIONAL_MULT if n < PROVISIONAL_GAMES else 1.0
        return BASE_K * weight * mult

    # 실제 경기 날짜(date) 오름차순 = 시간순(오래된 경기 먼저). id는 "아카이브에 들어온 순서"라
    # 과거 기록을 나중에 입력하는 경우가 섞여 있어 날짜와 어긋난다(실측: id는 근접한데 날짜가
    # 2019년과 2026년으로 널뛰는 행들이 있었다) - id로 정렬하면 Elo가 실제와 다른 순서로
    # 계산돼 버린다. 날짜가 같은 경기끼리는 id로 안정 정렬한다(동률 순서를 결정적으로 만들
    # 뿐, 결과에 큰 영향은 없다).
    for r in sorted(rows, key=lambda r: (str(r[1]), r[0])):
        if len(r) < 6:
            continue
        _, date, win_id, lose_id, map_id, cat_idx = r[:6]
        w, l = str(win_id), str(lose_id)
        rw, rl = get_rating(w), get_rating(l)
        cat_code = cats[cat_idx] if isinstance(cat_idx, int) and 0 <= cat_idx < len(cats) else ''
        weight = CAT_WEIGHTS.get(cat_code, CAT_WEIGHTS[''])
        exp_w = expected_score(rw, rl)

        new_rw = rw + k_for(w, weight) * (1 - exp_w)
        new_rl = rl + k_for(l, weight) * (0 - (1 - exp_w))
        rating[w], rating[l] = new_rw, new_rl
        games[w] = games.get(w, 0) + 1
        games[l] = games.get(l, 0) + 1

        log.setdefault(w, []).append([date, l, 1, map_id, cat_idx, round(new_rw)])
        log.setdefault(l, []).append([date, w, 0, map_id, cat_idx, round(new_rl)])

    return rating, log


def summarize(matches, cats, players):
    """한 선수의 경기 로그(시간순)에서 순위표에 보여줄 요약 통계를 뽑는다."""
    wins = sum(1 for m in matches if m[2])
    losses = len(matches) - wins

    streak_type, streak_len = '', 0
    longest_win = longest_lose = 0
    cur_win = cur_lose = 0
    by_race = {'T': [0, 0], 'Z': [0, 0], 'P': [0, 0]}
    by_cat = [[0, 0] for _ in cats]
    for date, opp, win, map_id, cat_idx, rating_after in matches:
        if win:
            cur_win += 1
            cur_lose = 0
            longest_win = max(longest_win, cur_win)
        else:
            cur_lose += 1
            cur_win = 0
            longest_lose = max(longest_lose, cur_lose)
        if isinstance(cat_idx, int) and 0 <= cat_idx < len(cats):
            by_cat[cat_idx][0 if win else 1] += 1
        opp_info = players.get(opp) or players.get(str(opp))
        opp_race = opp_info[1] if isinstance(opp_info, list) and len(opp_info) > 1 else ''
        if opp_race in by_race:
            by_race[opp_race][0 if win else 1] += 1

    if matches:
        streak_type = 'W' if matches[-1][2] else 'L'
        streak_len = cur_win if streak_type == 'W' else cur_lose

    return {
        'm': len(matches), 'w': wins, 'l': losses,
        'streak': {'t': streak_type, 'n': streak_len},
        'lw': longest_win, 'll': longest_lose,
        'race': by_race,
        'cat': by_cat,
        'rating': matches[-1][5] if matches else round(INITIAL_RATING),
    }


def main():
    ap = argparse.ArgumentParser(description='자체 Elo 레이팅 계산')
    ap.add_argument('--offline', action='store_true',
                    help='명단 없이는 휴면 필터를 할 수 없으므로, 이 모드에선 만들지 않고 멈춘다')
    ap.add_argument('--src', default=SRC_PATH, help=f'원본 아카이브 경로 (기본 {SRC_PATH})')
    args = ap.parse_args()

    if args.offline:
        sys.exit('ℹ️ --offline: 티어표 명단(휴면 필터)이 필요해 자체 레이팅은 만들지 않습니다.')

    store = load_json(args.src)
    rows = store.get('rows') or []
    players = store.get('players') or {}
    cats = store.get('cats') or []
    maps = store.get('maps') or {}

    tier_date, tier_members = resolve_tier_members(args.offline)
    alias = load_json(ALIAS_PATH, {})
    linked, _missing = link_tier_players(players, tier_members, alias)
    if not linked:
        sys.exit('❌ 티어표 명단과 이어붙인 선수가 0명입니다. build_h2h.py를 먼저 정상적으로 돌려보세요.')

    # 계산은 전체 선수(휴면 포함) 대상, 노출은 휴면이 아닌 선수만.
    active = {pid: info for pid, info in linked.items() if info.get('tm') not in HIDDEN_TEAMS}
    print(f'  티어표 연결 {len(linked):,}명 중 휴면 제외 {len(active):,}명을 순위표에 노출합니다.')

    print('  전체 경기를 시간순으로 훑어 레이팅을 계산합니다...')
    _rating, log = compute_ratings(rows, cats)

    out_players = os.path.join(OUT_DIR, 'p')
    tmp_players = out_players + '.new'
    if os.path.isdir(tmp_players):
        shutil.rmtree(tmp_players)

    index_players = {}
    per_sorted = []
    names_used = set()          # 상대로 나온 모든 선수id(활성 명단 밖 상대도 이름은 보여줘야 한다)
    for pid, info in sorted(active.items(), key=lambda kv: _pid_sort_key(kv[0])):
        matches = log.get(pid, [])
        if not matches:
            continue
        stat = summarize(matches, cats, players)
        player_info = players.get(pid) or players.get(str(pid)) or ['', '']
        name_elo = player_info[0] if isinstance(player_info, list) else str(player_info)
        race = (player_info[1] if isinstance(player_info, list) and len(player_info) > 1 else '') or ''
        index_players[str(pid)] = {
            'n': info['n'], 'tm': info.get('tm', ''), 's': info.get('s', ''), 'r': race,
            **({'t': info['t']} if 't' in info else {}),
            **({'g': info['g']} if 'g' in info else {}),
            **({'en': name_elo} if info.get('n') and info['n'] != name_elo else {}),
            **stat,
        }
        per_sorted.append((str(pid), matches))
        names_used.update(str(m[1]) for m in matches)

    if not index_players:
        sys.exit('❌ 휴면 제외 선수 중 경기 기록이 있는 사람이 0명입니다 - 계산을 멈춥니다(기존 파일 유지).')

    # 상대 이름 사전: 활성 명단 밖 상대(휴면·미연결 등)도 경기 목록에 이름이 나와야 한다
    # (h2h의 index.json 'others'와 같은 목적).
    others = {}
    for pid in names_used:
        if pid in index_players:
            continue
        info = players.get(pid)
        if info:
            others[pid] = info[0] if isinstance(info, list) else str(info)

    # 순위: 전체 레이팅 내림차순, 동점이면 판수가 많은 쪽이 위(더 검증된 기록이므로).
    # [주의] 명칭 티어와 숫자 티어는 경기 상대가 거의 안 겹쳐서(전체 교차 4.67%) 하나의
    # 척도로 비교할 근거가 얇다. 다만 서브티어별로 뜯어보면 균일하지 않다 - 갓~조커는
    # 숫자티어 상대 비중이 0.5~10.3%로 자기들끼리 붙지만, 스페이드는 47.5%가 숫자티어
    # 상대다(사실상 혼성 구간). 그래서 스페이드는 '명칭 티어(프로급)'이 아니라 숫자 티어
    # 쪽('일반')으로 묶는다 - 실제로 붙는 상대를 기준으로 나눈 것이다.
    # 'rank'(전체)는 참고용으로만 남기고, 실질적인 순위는 'divisionRank'(같은 급 안에서의
    # 순위)를 쓴다.
    NAMED_TIERS = {'갓', '킹', '잭', '조커'}

    def bracket_of(player):
        t = str(player.get('t', ''))
        if not t:
            return None
        return 'named' if t in NAMED_TIERS else 'numeric'

    ranked = sorted(index_players.items(), key=lambda kv: (-kv[1]['rating'], -kv[1]['m']))
    for rank, (pid, _p) in enumerate(ranked, start=1):
        index_players[pid]['rank'] = rank

    def rank_within(key_fn, out_field):
        groups = {}
        for pid, _p in ranked:               # ranked가 이미 레이팅순이라 그대로 훑으면 그룹 내 순위도 맞다
            key = key_fn(index_players[pid])
            if key in (None, ''):
                continue
            groups.setdefault(key, []).append(pid)
        for pids in groups.values():
            for i, pid in enumerate(pids, start=1):
                index_players[pid][out_field] = i

    rank_within(lambda p: p.get('t'), 'tierRank')       # 티어 내 순위(가장 정확 - 같은 티어면 서로 자주 붙는다)
    rank_within(bracket_of, 'divisionRank')             # 급(명칭/숫자 티어) 내 순위

    shard_bounds = []
    for entries in build_shards(per_sorted):
        start_pid = min(entries, key=_pid_sort_key)
        shard_bounds.append(_pid_num(start_pid) if _pid_num(start_pid) is not None else start_pid)
        write_json(os.path.join(tmp_players, f'{start_pid}.json'), entries)

    index = {
        'syncedAt': store.get('synced_at', ''),
        'tierDate': tier_date,
        'count': len(index_players),
        'shardBounds': shard_bounds,
        'cats': [CAT_LABELS.get(c, c or '기타') for c in cats],
        'catWeights': {CAT_LABELS.get(c, c or '기타'): CAT_WEIGHTS.get(c, CAT_WEIGHTS['']) for c in cats},
        'initialRating': round(INITIAL_RATING),
        'maps': maps,
        'players': index_players,
        'others': others,
    }
    write_json(os.path.join(OUT_DIR, 'index.json'), index)

    if os.path.isdir(tmp_players):
        if os.path.isdir(out_players):
            shutil.rmtree(out_players)
        os.replace(tmp_players, out_players)

    size = os.path.getsize(os.path.join(OUT_DIR, 'index.json')) / 1024
    top = ranked[0][1] if ranked else None
    print(f'✅ {OUT_DIR}: 순위표 {len(index_players):,}명 · 샤드 {len(shard_bounds)}개 · index {size:.0f}KB')
    if top:
        print(f'   1위: {top["n"]} (레이팅 {top["rating"]}, {top["m"]}전 {top["w"]}승 {top["l"]}패)')


if __name__ == '__main__':
    main()
