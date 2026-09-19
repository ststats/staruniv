"""티어표 '분석' 탭이 읽을 자체 레이팅을 계산한다: data/eloboard.json → docs/data/elo/index.json

[이 점수가 재는 것]
티어는 "어느 등급에 속해 있는가"를 나타내는 누적 성격의 자리다. 이 레이팅은 그 티어를 다시
줄 세우려는 게 아니라 **같은 티어 안에서 지금 어느 정도인가**를 재는 다른 줄자다.
그래서 점수 옆에는 항상 경기 수를 같이 보여준다 - 12승 3패(80%)와 120승 60패(67%)는
같은 무게가 아니기 때문이다.

[여섯 가지 규칙]
1. 같은 티어끼리 붙은 경기만 센다.
   티어가 다르면 애초에 서로 거의 안 붙는다(실측: 갓~조커는 숫자 티어와의 대전이 0.5~10%).
   한 판이라도 섞이면 다른 티어에서 쌓은 점수가 같은 티어 안 순위를 흔든다.
   (경기 기록 자체는 분석 화면에서 전부 보여준다 - 점수 계산에만 안 쓸 뿐이다.)

2. 지금 티어로 올라온 뒤의 경기만 센다.
   시트의 'N티어 승급' 날짜를 쓴다. 8티어 시절 성적으로 3티어 순위를 매기면 안 되기 때문이다.
   승급일이 적혀 있지 않은 선수는 전체 기간을 쓴다.

3. 시간은 자르지 않고 기울인다.
   "최근 60일만" 같은 칼자름은 60일차와 61일차가 갑자기 달라진다. 대신 반감기로 완만하게
   줄인다 - 연습(스폰)은 90일, 대회·대학대전 같은 업적은 540일. 업적은 오래 남지만
   영원히 그대로는 아니다("지금의 기량"을 재는 표이므로).

4. 형식마다 무게가 다르다.
   개인대회 = 대학대회 2.5 > 대학대전 2 > 미니대전 = 프로리그 = CK 1.5 > 스폰 1.

5. 같은 상대를 반복해 이긴 것은 조금씩만 센다.
   같은 날 여러 판은 다전제 한 경기로 묶고(하루에 같은 사람 열 번 이겨서 점수를 부풀릴 수
   없게), 이미 여러 번 만난 상대는 그 경기의 가중을 낮춘다. 우리 데이터는 "늘 붙는 연습
   상대"가 뚜렷해서(한 상대와만 수백 경기인 경우가 흔하다) 이 보정이 특히 크게 작동한다.
   결과적으로 "몇 판 이겼나"보다 "몇 명을 이겼나"가 무겁다.

6. 표본이 적으면 숨기지 않고 드러낸다.
   기준점(1500)에 가상 경기 PRIOR_GAMES판을 깔아 둔다(베이즈 수축) - 표본이 적으면 자연히
   기준점에 가깝고 경기가 쌓일수록 매끄럽게 제 점수로 풀린다. 구간별로 계단처럼 깎으면
   경계에서 점수가 튀어서 이 방식을 골랐다. 그리고 동티어 MIN_RANKED_GAMES경기에 못 미치면
   순위를 매기지 않고 '표본 부족'으로 따로 표시한다(점수 자체는 그대로 보여준다).

[휴면] 점수와 무관하게 "최근 DORMANT_DAYS일 동안 공식 경기가 하나도 없는가"만 본다
(다른 티어와의 경기도 활동으로 친다 - 활동 여부를 보는 것이지 경쟁력을 보는 게 아니다).
휴면 선수는 순위 모집단에서 빠지지만 분석 화면에서 검색해 보는 것은 된다.

[성장 가속도 🚀] 최근 RISING_RECENT_DAYS일 승률이 그 앞 구간보다 RISING_GAP 이상 높고
양쪽 표본이 충분하면 표시한다. 점수에 보너스를 주지는 않고 "지금 폼이 좋다"는 신호다.

[출력] docs/data/elo/index.json 하나뿐이다.
    { syncedAt, basedOn, cats, catWeights, initialRating, dormantDays, halfLifeDays,
      importantHalfLifeDays, minRankedGames,
      players: { 선수id: { rt:레이팅, tr:티어내순위, ts:티어인원, g:동티어경기수, op:동티어상대수,
                           m,w,l, race:{T:[승,패],...}, cat:[[승,패],...],
                           st:{t,n}, lw, ll, last:최근경기일,
                           dm:휴면?, lo:표본부족?, up:성장가속도? } } }
경기 로그는 따로 만들지 않고 분석 탭이 docs/data/h2h/p/*.json(build_h2h.py 산출물)을 그대로
읽는다 - 같은 내용을 두 벌 갖고 있으면 저장소만 커지고 서로 어긋날 여지만 생긴다.

    python scripts/generate_elo.py
"""

import argparse
import datetime as dt
import os
import sys

from build_h2h import (
    ALIAS_PATH, CAT_LABELS, SRC_PATH,
    link_tier_players, load_json, resolve_tier_members, write_json,
)

OUT_PATH = os.path.join('docs', 'data', 'elo', 'index.json')

INITIAL_RATING = 1500.0
BASE_K = 32.0

# 형식별 중요도 가중치. 코드값은 build_h2h.py의 CAT_LABELS와 같은 eloboard 형식 코드다.
# 목록에 없는 코드(새 형식이 생기거나 빈 값 '')는 기본값 1.0(스폰과 동일)을 쓴다.
CAT_WEIGHTS = {
    'solo_event': 2.5,     # 개인 (개인대회) - 대회와 동률 1순위
    'college_event': 2.5,  # 대회 (대학대회)
    'college_war': 2.0,    # 대학 (대학대전)
    'college_mini': 1.5,   # 미니 (미니대전)
    'pro_league': 1.5,     # 리그 (프로리그)
    'team_event': 1.5,     # CK (팀리그)
    'sponsored': 1.0,      # 스폰
    '': 1.0,                # 기타/미상
}

# [시간 가중] "최근 60일만 본다" 같은 칼자름은 60일차와 61일차 경기가 갑자기 달라진다.
# 대신 연속적으로 줄인다. 연습(스폰)은 최근 폼이 중요하니 빠르게, 대회·대학대전 같은 업적은
# 아주 느리게 준다 - 영원히 그대로 두면 "예전에 잘했던 사람"이 계속 윗자리에 남기 때문이다.
PRACTICE_CATS = {'sponsored', ''}
PRACTICE_HALF_LIFE_DAYS = 90.0
IMPORTANT_HALF_LIFE_DAYS = 540.0
DECAY_FLOOR = 0.15          # 아무리 오래돼도 이만큼은 남긴다(옛 기록이 0이 되면 표본이 사라진다)

# [상대 다양성] 이 사이트만의 보정이다. 우리 데이터는 "늘 붙는 연습 상대"가 뚜렷해서
# (한 선수가 특정 상대와만 수백 경기를 한 경우가 흔하다) 같은 사람을 반복해서 이기는 것만으로
# 점수가 계속 오르면 실제 경쟁력과 멀어진다. 이미 여러 번 만난 상대일수록 그 경기가
# 새로 알려주는 정보가 적다고 보고 가중을 줄인다 - "몇 명을 이겼나"가 "몇 판을 이겼나"보다
# 무겁게 반영된다. (같은 날 여러 판은 이와 별개로 다전제 한 경기로 먼저 묶는다.)
REPEAT_SCALE = 6.0          # 이만큼 다시 만날 때마다 가중이 절반 가까이로 준다
REPEAT_FLOOR = 0.30         # 아무리 자주 만나도 이만큼은 남긴다

# [표본] 점수를 구간별로 계단처럼 깎는 대신, 기준점(1500)에 "가상의 경기"를 몇 판 깔아둔다.
# 표본이 적으면 자연스럽게 기준점에 가깝고, 경기가 쌓일수록 매끄럽게 제 점수로 풀린다.
PRIOR_GAMES = 12.0
# 이 판수에 못 미치면 순위를 매기지 않고 '표본 부족'으로 표시한다(점수는 그대로 보여준다).
MIN_RANKED_GAMES = 10

DORMANT_DAYS = 50           # 이 기간 동안 아무 공식 경기도 없으면 휴면

RISING_RECENT_DAYS = 30     # 성장 가속도: 최근 구간
RISING_BASE_DAYS = 90       # 비교 구간(최근 구간 포함 전체)
RISING_MIN_GAMES = 8        # 양쪽 구간 최소 표본
RISING_GAP = 0.12           # 승률 차이가 이만큼 이상이면 🚀


def expected_score(rating_a, rating_b):
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def parse_date(value):
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def decay_factor(cat_code, days_ago):
    """오래된 경기의 가치를 줄이는 배수. 연습은 빠르게, 중요 경기는 아주 느리게 준다."""
    if days_ago <= 0:
        return 1.0
    half = PRACTICE_HALF_LIFE_DAYS if cat_code in PRACTICE_CATS else IMPORTANT_HALF_LIFE_DAYS
    raw = 0.5 ** (days_ago / half)
    return DECAY_FLOOR + (1.0 - DECAY_FLOOR) * raw


def shrink_factor(games):
    """표본이 적을수록 기준점(1500) 쪽으로 끌어당기는 비율.
    1500점에 가상 경기 PRIOR_GAMES판을 깔아둔 것과 같다 - 12판이면 절반, 50판이면 80%,
    120판이면 91%가 제 점수로 반영된다. 구간을 나눠 계단처럼 깎는 것보다 경계에서 점수가
    튀지 않고, "표본이 쌓여야 높은 점수가 유지된다"는 성질은 그대로다."""
    return games / (games + PRIOR_GAMES) if games else 0.0


def to_series(matches):
    """[다전제 환산] 같은 날·같은 상대·같은 형식의 여러 판을 한 경기로 묶는다.
    돌려주는 값: [{date, opp, cat, wins, losses}, ...] (입력 순서 유지)."""
    series = []
    index = {}
    for date, opp, win, cat in matches:
        key = (date, opp, cat)
        item = index.get(key)
        if item is None:
            item = {'date': date, 'opp': opp, 'cat': cat, 'wins': 0, 'losses': 0}
            index[key] = item
            series.append(item)
        if win:
            item['wins'] += 1
        else:
            item['losses'] += 1
    return series


def repeat_factor(prior_meetings):
    """같은 상대를 이미 여러 번 만났으면 그만큼 가중을 줄인다(상대 다양성 보정)."""
    return max(REPEAT_FLOOR, 1.0 / (1.0 + prior_meetings / REPEAT_SCALE))


def compute_ratings(same_tier_series, today):
    """같은 티어끼리 붙은 경기(다전제로 묶은 것)를 시간순으로 훑어 레이팅을 계산한다.
    한 경기가 레이팅을 움직이는 폭 = BASE_K × 형식 가중치 × 시간 감쇠 × 상대 다양성.
    돌려주는 값: {pid: 레이팅}"""
    rating = {}
    met = {}                                  # (a, b) -> 지금까지 만난 횟수

    def get(pid):
        return rating.setdefault(pid, INITIAL_RATING)

    for s in same_tier_series:
        a, b = s['a'], s['b']
        total = s['wins'] + s['losses']
        if not total:
            continue
        score_a = s['wins'] / total          # 다전제 결과를 0~1 점수로
        ra, rb = get(a), get(b)
        days_ago = (today - s['date']).days if s['date'] else 0
        pair = (a, b)
        weight = (CAT_WEIGHTS.get(s['cat'], CAT_WEIGHTS[''])
                  * decay_factor(s['cat'], days_ago)
                  * repeat_factor(met.get(pair, 0)))
        met[pair] = met.get(pair, 0) + 1
        k = BASE_K * weight
        exp_a = expected_score(ra, rb)
        rating[a] = ra + k * (score_a - exp_a)
        rating[b] = rb + k * ((1 - score_a) - (1 - exp_a))
    return rating


def _before_promotion(day, promoted_on, *pids):
    """둘 중 한 명이라도 아직 그 티어로 승급하기 전이면 True(레이팅에서 제외)."""
    if day is None:
        return False
    return any(promoted_on.get(pid) and day < promoted_on[pid] for pid in pids)


def rising_flag(dated_results, today):
    """최근 구간 승률이 그 앞 구간보다 뚜렷하게 높으면 True(🚀)."""
    recent_cut = today - dt.timedelta(days=RISING_RECENT_DAYS)
    base_cut = today - dt.timedelta(days=RISING_BASE_DAYS)
    recent = [win for date, win in dated_results if date and date > recent_cut]
    prior = [win for date, win in dated_results if date and base_cut < date <= recent_cut]
    if len(recent) < RISING_MIN_GAMES or len(prior) < RISING_MIN_GAMES:
        return False
    return (sum(recent) / len(recent)) - (sum(prior) / len(prior)) >= RISING_GAP


def main():
    ap = argparse.ArgumentParser(description='자체 레이팅 계산 (분석 탭용)')
    ap.add_argument('--src', default=SRC_PATH, help=f'원본 아카이브 경로 (기본 {SRC_PATH})')
    args = ap.parse_args()

    store = load_json(args.src)
    rows = store.get('rows') or []
    players = store.get('players') or {}
    cats = store.get('cats') or []

    tier_date, tier_members = resolve_tier_members(False)
    alias = load_json(ALIAS_PATH, {})
    linked, _missing = link_tier_players(players, tier_members, alias)
    if not linked:
        sys.exit('❌ 티어표 명단과 이어붙인 선수가 0명입니다. build_h2h.py를 먼저 정상적으로 돌려보세요.')

    tier_of = {pid: str(info.get('t', '')) for pid, info in linked.items()}
    # 지금 티어로 승급한 날(시트의 'N티어 승급' 칸). 있으면 그 날 이후 경기만 레이팅에 센다 -
    # 8티어 시절 성적으로 3티어 순위를 매기면 안 되기 때문. 값이 없는 선수는 전체 기간을 쓴다.
    promoted_on = {}
    for pid, info in linked.items():
        day = parse_date(info.get('pr'))
        if day:
            promoted_on[pid] = day
    # 기준일: 아카이브가 마지막으로 동기화된 날(로컬 시계가 아니라 데이터 기준이라야
    # 언제 돌리든 같은 결과가 나온다).
    today = parse_date(store.get('synced_at')) or dt.date.today()

    # 선수별 경기 모으기 (동티어/전체를 한 번에)
    per = {pid: [] for pid in linked}           # pid -> [(date, opp, win, cat_code)]
    same_tier_raw = []                          # (date, a, b, cat, a가 이겼나)
    for r in rows:
        if len(r) < 6:
            continue
        _, date, win_id, lose_id, _map_id, cat_idx = r[:6]
        w, l = str(win_id), str(lose_id)
        cat = cats[cat_idx] if isinstance(cat_idx, int) and 0 <= cat_idx < len(cats) else ''
        day = parse_date(date)
        if w in per:
            per[w].append((day, l, 1, cat))
        if l in per:
            per[l].append((day, w, 0, cat))
        # 둘 다 티어표에 있고 티어가 같을 때만 레이팅 대상.
        # 둘 중 한 명이라도 "그 티어로 올라오기 전"이면 세지 않는다.
        tw, tl = tier_of.get(w), tier_of.get(l)
        if tw and tw == tl and not _before_promotion(day, promoted_on, w, l):
            same_tier_raw.append((day, w, l, cat))

    # [다전제 환산] 같은 날·같은 짝·같은 형식은 한 경기로 묶는다. 짝은 (작은id, 큰id)로
    # 정규화해서 누가 이겼든 같은 묶음에 들어가게 한다.
    bundle = {}
    order = []
    for day, w, l, cat in same_tier_raw:
        a, b = (w, l) if w <= l else (l, w)
        key = (day, a, b, cat)
        item = bundle.get(key)
        if item is None:
            item = {'date': day, 'a': a, 'b': b, 'cat': cat, 'wins': 0, 'losses': 0}
            bundle[key] = item
            order.append(item)
        if w == a:
            item['wins'] += 1        # a 기준 승
        else:
            item['losses'] += 1
    order.sort(key=lambda s: (s['date'] or dt.date.min))
    print(f'  동티어 경기 {len(same_tier_raw):,}건 → 다전제 환산 {len(order):,}경기')

    rating = compute_ratings(order, today)

    # 선수별 요약
    index_players = {}
    dormant_cut = today - dt.timedelta(days=DORMANT_DAYS)
    for pid, matches in per.items():
        if not matches:
            continue
        matches.sort(key=lambda x: (x[0] or dt.date.min))
        wins = sum(1 for m in matches if m[2])
        losses = len(matches) - wins

        by_race = {'T': [0, 0], 'Z': [0, 0], 'P': [0, 0]}
        by_cat = [[0, 0] for _ in cats]
        cur_w = cur_l = longest_w = longest_l = 0
        for day, opp, win, cat in matches:
            if win:
                cur_w += 1
                cur_l = 0
                longest_w = max(longest_w, cur_w)
            else:
                cur_l += 1
                cur_w = 0
                longest_l = max(longest_l, cur_l)
            if cat in cats:
                by_cat[cats.index(cat)][0 if win else 1] += 1
            info = players.get(opp)
            race = info[1] if isinstance(info, list) and len(info) > 1 else ''
            if race in by_race:
                by_race[race][0 if win else 1] += 1

        last_day = matches[-1][0]
        # 레이팅에 실제로 쓰인 경기와 같은 기준(같은 티어 + 승급 이후)으로 센다.
        counted = [(d, opp, win) for d, opp, win, cat in matches
                   if tier_of.get(opp) and tier_of.get(opp) == tier_of.get(pid)
                   and not _before_promotion(d, promoted_on, pid, opp)]
        same_tier = [(d, win) for d, _opp, win in counted]
        # 동티어 상대가 몇 명인지(상대 다양성) - 레이팅 가중에도 쓰이는 개념이라 화면에도 같이 보여준다.
        same_tier_opps = {opp for _d, opp, _w in counted}
        raw = rating.get(pid, INITIAL_RATING)
        adjusted = INITIAL_RATING + (raw - INITIAL_RATING) * shrink_factor(len(same_tier))

        entry = {
            'rt': round(adjusted),
            'g': len(same_tier),
            'op': len(same_tier_opps),
            'm': len(matches), 'w': wins, 'l': losses,
            'race': by_race,
            'cat': by_cat,
            'st': {'t': 'W' if matches[-1][2] else 'L', 'n': cur_w if matches[-1][2] else cur_l},
            'lw': longest_w, 'll': longest_l,
            'last': last_day.isoformat() if last_day else '',
        }
        if not last_day or last_day <= dormant_cut:
            entry['dm'] = 1
        if len(same_tier) < MIN_RANKED_GAMES:
            entry['lo'] = 1                     # 표본 부족 - 순위는 매기지 않는다
        if rising_flag(same_tier, today):
            entry['up'] = 1
        index_players[pid] = entry

    if not index_players:
        sys.exit('❌ 요약할 선수가 0명입니다 - 계산을 멈춥니다(기존 파일 유지).')

    # 티어 내 순위: 휴면이 아니고 동티어 경기가 있는 선수만 모집단에 넣는다.
    by_tier = {}
    for pid, entry in index_players.items():
        t = tier_of.get(pid, '')
        if not t or entry.get('dm') or entry.get('lo'):
            continue
        by_tier.setdefault(t, []).append(pid)
    for t, pids in by_tier.items():
        pids.sort(key=lambda p: (-index_players[p]['rt'], -index_players[p]['g']))
        for rank, pid in enumerate(pids, start=1):
            index_players[pid]['tr'] = rank
            index_players[pid]['ts'] = len(pids)

    index = {
        'syncedAt': store.get('synced_at', ''),
        'tierDate': tier_date,
        'basedOn': today.isoformat(),
        'cats': [CAT_LABELS.get(c, c or '기타') for c in cats],
        'catWeights': {CAT_LABELS.get(c, c or '기타'): CAT_WEIGHTS.get(c, CAT_WEIGHTS['']) for c in cats},
        'initialRating': round(INITIAL_RATING),
        'dormantDays': DORMANT_DAYS,
        'halfLifeDays': round(PRACTICE_HALF_LIFE_DAYS),
        'importantHalfLifeDays': round(IMPORTANT_HALF_LIFE_DAYS),
        'minRankedGames': MIN_RANKED_GAMES,
        'players': index_players,
    }
    write_json(OUT_PATH, index)

    ranked = sum(1 for e in index_players.values() if 'tr' in e)
    dormant = sum(1 for e in index_players.values() if e.get('dm'))
    rising = sum(1 for e in index_players.values() if e.get('up'))
    size = os.path.getsize(OUT_PATH) / 1024
    print(f'✅ {OUT_PATH}: 선수 {len(index_players):,}명 (순위 대상 {ranked:,}명 · '
          f'휴면 {dormant:,}명 · 🚀 {rising}명) · {size:.0f}KB')
    top = sorted((e for e in index_players.values() if e.get('tr') == 1), key=lambda e: -e['rt'])[:3]
    for e in top:
        name = next(k for k, v in index_players.items() if v is e)
        print(f'   티어 1위: {(linked.get(name) or {}).get("n", name)} '
              f'({e["rt"]}점 · 동티어 {e["g"]}경기)')


if __name__ == '__main__':
    main()
