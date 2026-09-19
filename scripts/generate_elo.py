"""티어표 '분석' 탭이 읽을 자체 레이팅을 계산한다: data/eloboard.json → docs/data/elo/index.json

[철학] "꾸준함은 기본, 지금의 기량이 순위를 결정한다"
단순 승률이 아니라 (1) 같은 티어 안에서의 경쟁력, (2) 중요 경기의 업적, (3) 최근의 폼,
(4) 표본의 신뢰도를 함께 본다. 아래 네 가지가 그 네 축이다.

1. [동일 티어 경기만 센다]
   티어가 다르면 애초에 서로 거의 붙지 않는다(실측: 명칭 티어 갓~조커는 숫자 티어와의
   맞대결이 0.5~10%뿐이다). 그런데도 한 판이라도 섞이면, 다른 티어를 상대로 쌓은 점수가
   같은 티어 안 순위를 흔든다. 그래서 레이팅은 "같은 티어끼리 붙은 경기"만으로 계산한다.
   (경기 기록 자체는 분석 탭에서 전부 보여준다 - 점수 계산에만 안 쓸 뿐이다.)

2. [중요 경기는 가치가 줄지 않는다 / 연습은 최근 것이 더 값지다]
   대회·대학대전 같은 중요 경기의 승리는 커리어에 남는 업적이라 시간이 지나도 그대로 센다.
   반면 스폰(연습)은 "지금 폼"을 보는 지표라 오래될수록 완만하게 값이 준다
   (반감기 DECAY_HALF_LIFE_DAYS일 - 90일 전 스폰 승리는 어제 승리의 절반만큼 반영).

3. [다전제 환산]
   같은 날 같은 상대와 여러 판을 하면 그건 사실상 다전제 한 판이다. 판마다 따로 세면
   "하루에 같은 사람 열 번 이기기"로 점수를 부풀릴 수 있어서, 하루·상대·형식이 같은 묶음은
   승률 하나짜리 결과 한 경기로 환산한다.

4. [표본이 적으면 점수를 깎는다]
   10경기도 안 되는 레이팅은 우연이 대부분이다. 기준선(1500)쪽으로 끌어당겨서
   "표본이 쌓여야 높은 점수가 유지된다"는 걸 점수 자체에 반영한다(penalty_factor 참고).
   다만 중요 경기를 IMPORTANT_EXEMPT_GAMES번 이상 뛴 선수는 이미 검증된 것으로 보고 면제한다.

[휴면] 점수와 무관하게 "최근 DORMANT_DAYS일 동안 공식 경기가 하나도 없는가"만 본다
(다른 티어와의 경기도 활동으로 친다 - 활동 여부를 보는 것이지 경쟁력을 보는 게 아니다).
휴면 선수는 티어 내 순위 모집단에서 빠진다(순위가 유령으로 채워지지 않게). 대신 분석
화면에서 검색해 보는 것 자체는 된다.

[성장 가속도 🚀] 최근 RISING_RECENT_DAYS일 승률이 그 앞 구간보다 RISING_GAP 이상 높고
양쪽 표본이 충분하면 표시한다. 점수에 보너스를 주지는 않고, "지금 폼이 좋다"는 신호다.

[출력] docs/data/elo/index.json 하나뿐이다.
    { syncedAt, cats, catWeights, initialRating, dormantDays,
      players: { 선수id: { rt:레이팅, tr:티어내순위, ts:티어인원, g:동티어경기수,
                           m,w,l, race:{T:[승,패],...}, cat:[[승,패],...],
                           st:{t,n}, lw, ll, last:최근경기일, dm:휴면?, up:성장가속도? } } }
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

# 시간이 지나면 값이 주는 형식(=연습). 여기 없는 형식은 "업적"이라 감쇠하지 않는다.
DECAY_CATS = {'sponsored', ''}
DECAY_HALF_LIFE_DAYS = 90.0
DECAY_FLOOR = 0.15          # 아무리 오래돼도 이만큼은 남긴다(옛 기록이 0이 되면 표본이 사라진다)

# 중요 경기 = 감쇠하지 않는 형식. 페널티 면제 판정에 쓴다.
IMPORTANT_EXEMPT_GAMES = 3
PENALTY_FREE_GAMES = 30     # 이 판수부터는 깎지 않는다

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
    """오래된 연습 경기의 가치를 줄이는 배수(중요 경기는 항상 1.0)."""
    if cat_code not in DECAY_CATS or days_ago <= 0:
        return 1.0
    raw = 0.5 ** (days_ago / DECAY_HALF_LIFE_DAYS)
    return DECAY_FLOOR + (1.0 - DECAY_FLOOR) * raw


def penalty_factor(games, important_games):
    """표본이 적을 때 레이팅을 기준선 쪽으로 끌어당기는 비율(1.0이면 그대로 둔다).
    구간: 10판 미만은 최대 80%까지 깎고, 10~19판은 30%, 20~29판은 완만하게 풀어
    30판부터 그대로 둔다. 중요 경기를 충분히 뛴 선수는 표본이 10판만 넘으면 면제한다."""
    if games >= PENALTY_FREE_GAMES:
        return 1.0
    if games >= 10 and important_games >= IMPORTANT_EXEMPT_GAMES:
        return 1.0
    if games < 10:
        return 0.20 + 0.05 * games          # 0판 0.20 → 9판 0.65
    if games < 20:
        return 0.70
    return 0.70 + 0.03 * (games - 20)       # 20판 0.70 → 29판 0.97


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


def compute_ratings(same_tier_series, today):
    """같은 티어끼리 붙은 경기(다전제로 묶은 것)를 시간순으로 훑어 레이팅을 계산한다.
    한 경기가 레이팅을 움직이는 폭 = BASE_K × 형식 가중치 × 시간 감쇠.
    돌려주는 값: {pid: 레이팅}"""
    rating = {}

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
        weight = CAT_WEIGHTS.get(s['cat'], CAT_WEIGHTS['']) * decay_factor(s['cat'], days_ago)
        k = BASE_K * weight
        exp_a = expected_score(ra, rb)
        rating[a] = ra + k * (score_a - exp_a)
        rating[b] = rb + k * ((1 - score_a) - (1 - exp_a))
    return rating


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
        # 둘 다 티어표에 있고 티어가 같을 때만 레이팅 대상
        tw, tl = tier_of.get(w), tier_of.get(l)
        if tw and tw == tl:
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
        same_tier = [(d, win) for d, opp, win, cat in matches if tier_of.get(opp) and tier_of.get(opp) == tier_of.get(pid)]
        important = sum(1 for _d, _o, _w, cat in matches
                        if tier_of.get(_o) == tier_of.get(pid) and cat not in DECAY_CATS)
        raw = rating.get(pid, INITIAL_RATING)
        factor = penalty_factor(len(same_tier), important)
        adjusted = INITIAL_RATING + (raw - INITIAL_RATING) * factor

        entry = {
            'rt': round(adjusted),
            'g': len(same_tier),
            'm': len(matches), 'w': wins, 'l': losses,
            'race': by_race,
            'cat': by_cat,
            'st': {'t': 'W' if matches[-1][2] else 'L', 'n': cur_w if matches[-1][2] else cur_l},
            'lw': longest_w, 'll': longest_l,
            'last': last_day.isoformat() if last_day else '',
        }
        if not last_day or last_day <= dormant_cut:
            entry['dm'] = 1
        if rising_flag(same_tier, today):
            entry['up'] = 1
        index_players[pid] = entry

    if not index_players:
        sys.exit('❌ 요약할 선수가 0명입니다 - 계산을 멈춥니다(기존 파일 유지).')

    # 티어 내 순위: 휴면이 아니고 동티어 경기가 있는 선수만 모집단에 넣는다.
    by_tier = {}
    for pid, entry in index_players.items():
        t = tier_of.get(pid, '')
        if not t or entry.get('dm') or not entry['g']:
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
        'halfLifeDays': round(DECAY_HALF_LIFE_DAYS),
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
