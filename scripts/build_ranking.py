"""티어 안 순위(티어랭킹)를 계산해 docs/data/h2h/index.json에 적어 넣는다.

build_h2h.py가 index.json을 만든 뒤에 돌린다(그 파일을 읽어서 순위 필드만 덧붙인다).

[왜 그냥 Elo를 돌리지 않는가]
이 판은 티어끼리만 논다. 실측하면 이렇다:

    카드군끼리(갓~스페이드)   105,785경기
    숫자군끼리(0~베이비)      230,232경기
    카드군 ↔ 숫자군             2,009경기   ← 두 덩어리를 잇는 전부

갓·킹·잭·조커는 경기의 99.5~100%를 카드군하고만 치고, 3티어 아래는 카드군과 한 경기도
안 한다. 이 상태에서 전원 1500으로 출발하는 보통 Elo를 돌리면 두 덩어리가 각자 1500
근처에서 퍼질 뿐이라, 경기 수가 많은 숫자군이 위로 떠버린다. 실제로 그렇게 나왔다:

    갓 1758 · 킹 1674 · 잭 1509 · 조커 1410   vs   0티어 1819 · 1티어 1803 · 2티어 1753

각 군 안에서는 순서가 완벽했다(갓>킹>잭>조커, 0>1>…>8>베이비). 어긋난 건 두 군의
절대 높이뿐이다. K값이나 공식을 바꿔서 될 문제가 아니라, 연결망이 끊겨 있어서 생기는
구조적인 문제다.

[휴면·체크 선수를 어떻게 둘 것인가 - 여기서 한 번 크게 틀렸다]
티어가 안 매겨진 사람(체크 380명 + 티어표 밖 143명)도 경기 상대로는 계속 나온다. 처음엔
이들을 '미분류'라는 티어 하나로 묶고 다른 티어와 똑같은 prior를 걸었는데, 미분류는 실력
구간이 아니라 '아직 안 매김'이라 실력이 전 구간에 퍼져 있다. 좁은 prior로 한데 묶으니
이들이 가짜 닻이 되어 두 덩어리를 엉뚱한 자리에 고정시켰다. 실측으로 확인한 값
(스페이드 vs 0티어 1,204경기에서 스페이드 54.1% 승 = 약 +28점)과 비교하면:

    미분류도 좁은 prior(σ=0.5)      스페이드 - 0티어 = -232점   ← 완전히 뒤집힘
    미분류 prior 풀기(σ=3.0)        스페이드 - 0티어 =  -52점
    + 3판 미만 미분류를 다리에서 뺌   스페이드 - 0티어 =   -4점   ← 채택
    미분류 경기를 아예 뺌            스페이드 - 0티어 =  +74점   (다리가 2,009경기뿐이라 튄다)

그래서 미분류는 (1) prior를 넓게 풀어 각자 자유롭게 두고, (2) 가중 3판도 안 둔 사람의
경기는 아예 빼고 맞춘다. 판 수가 그것밖에 안 되면 그 선수의 실력 위치를 알 수 없고,
위치를 모르는 사람을 두 덩어리 사이의 다리로 쓰면 없는 정보를 지어내는 셈이 된다.
(이 선택으로 티어 안 순위도 평균 0.5계단, 최대 6계단 움직였다 - 고칠 값어치가 있었다)

[그래서 2단으로 나눈다]

    선수 실력 θ = (티어 기준선 m) + (티어 안 편차 δ)

  · m은 티어 간 맞대결에서 추정한다. 데이터가 티어 사이 간격을 알려주므로(스페이드 vs
    0티어 1,204경기에서 54.1% 등) 두 군이 공중에 뜨지 않고 한 사다리에 묶인다.
  · δ는 주로 같은 티어끼리의 경기에서 정해진다. 화면에 띄우는 티어 안 순위가 이 δ 순서다.
  · δ에는 0으로 당기는 prior를 걸어, 표본이 적은 선수가 티어 꼭대기나 바닥으로 튀지 않고
    가운데에 놓이게 한다(예전 레이팅이 몇 판 안 한 사람 때문에 이상해졌던 자리다).

순위를 티어 안에서만 매기므로, 두 군의 절대 높이에 오차가 남아도 순위에는 영향이 없다.
(그 오차 때문에 전체 통합 순위는 내보내지 않는다 - 다리가 2,009경기뿐이라 카드군과
숫자군의 경계는 믿을 만하지 않다)

[순위는 θ가 아니라 '보수 추정'으로 매긴다 - 여기서도 한 번 틀렸다]
처음엔 θ 순서 그대로 줄을 세웠더니 스페이드티어 1위가 최근 1년에 2판 둔 사람이었다.
버그는 아니었다 - 그 사람은 옛날 전적으로 +0.163을 실제로 벌었다. 문제는 티어 안 편차의
폭이 좁아서(스페이드티어 δ 중앙값 +0.022) 13판짜리 추정과 870판짜리 추정을 같은 확신으로
줄 세운 것이었다. 그래서 순위는 θ에서 그 추정의 표준오차를 뺀 값으로 매긴다:

    순위 점수 = θ - 표준오차,   표준오차 = 1 / sqrt(prior 정밀도 + Σ w·p(1-p))

표본이 두꺼우면 표준오차가 작아 제자리를 지키고(짭제 0.069), 얇으면 아래로 내려간다
(유민 0.410). 갓·킹티어 상위권은 그대로였고, 스페이드티어 1위만 2판짜리에서 68판짜리로
바뀌었다. 여기에 '최근 1년 MIN_RECENT_GAMES판 이상'이라는 눈에 보이는 문턱을 하나 더 둬서,
사실상 안 둔 사람은 순위에 올리지 않고 '기록 없음'으로 남긴다.

[경기 가중치]
형식마다 중요도가 다르고(개인대회=대학대회 > 대학대전 > 미니대전 > 프로리그=CK > 스폰),
오래된 경기는 지금 실력을 덜 말해준다(반감기 12개월). 두 가중치를 곱해 경기마다 붙인다.
스폰은 전체의 73%라 가중치를 0.15까지 낮춰도 여전히 가장 큰 덩어리지만, 그대로 두면
사실상 스폰 랭킹이 되므로 이 정도는 눌러야 한다.

[계산량]
37.5만 경기를 (승자, 패자) 쌍으로 접으면 45,862개다. 같은 쌍의 가중치는 그냥 더하면
되므로(로그가능도가 쌍에만 의존한다) 손실이 없다. 선수 1,249명 + 티어 16개짜리 볼록
문제라 scipy L-BFGS로 1초 안에 끝난다. 직접 짠 경사하강으로도 같은 답에 닿지만,
두 덩어리를 잇는 방향은 기울기가 0.2%밖에 안 돼서 수렴을 눈으로 확인하기 어렵다 -
수렴 판정을 옵티마이저에 맡기려고 L-BFGS를 쓴다.
"""

import argparse
import bisect
import datetime as dt
import io
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import minimize

SRC_PATH = os.path.join('data', 'eloboard.json')
INDEX_PATH = os.path.join('docs', 'data', 'h2h', 'index.json')
# 레이팅 변화 그래프용. 분석 탭에서만 읽으므로 index.json과 따로 둔다(티어표만 보러 온
# 사람이 받지 않게).
HISTORY_PATH = os.path.join('docs', 'data', 'h2h', 'rating.json')
HISTORY_MONTHS = 18         # 월별 전적 그래프와 같은 개월 수

# 티어 사다리. build_h2h.py / core.js의 TIER_ORDER와 같은 순서여야 한다.
TIER_ORDER = ['갓', '킹', '잭', '조커', '스페이드', '0', '1', '2', '3', '4', '5', '6', '7', '8', '베이비']
# 아직 티어를 안 매긴 사람(체크)과 티어표 밖 상대. 순위는 안 내지만 노드로는 넣는다 -
# 이 사람들과의 경기도 실력 정보이고, 티어 간 연결을 조금이나마 더 이어준다.
UNRANKED = '미분류'

# 형식 가중치. 키는 eloboard 원본 코드(scripts/build_h2h.py의 CAT_LABELS와 같은 코드다).
CAT_WEIGHT = {
    'solo_event': 1.0,      # 개인대회
    'college_event': 1.0,   # 대학대회
    'college_war': 0.8,     # 대학대전
    'college_mini': 0.6,    # 미니대전
    'pro_league': 0.4,      # 프로리그
    'team_event': 0.4,      # CK
    'sponsored': 0.15,      # 스폰
    '': 0.15,               # 기타
}
DEFAULT_CAT_WEIGHT = 0.15

HALF_LIFE_DAYS = 365.0      # 최근 가중치 반감기(12개월)
RECENT_DAYS = 365           # 순위를 매길 때 보는 최근 기간
MIN_RECENT_GAMES = 10       # 이 기간에 이보다 적게 뒀으면 순위에서 빼고 '기록 없음'
# 순위 점수에서 표준오차를 몇 배 빼는가. 1.0이면 '한 시그마 보수적으로'다.
SE_PENALTY = 1.0

# δ에 거는 prior의 폭(표준편차). 로짓 단위에서 티어 한 칸 차이가 약 0.36이고
# (실측 1칸 차 승률 58.8%), 티어 안 편차는 그보다 작아야 자연스럽다.
SIGMA_DELTA = 0.5
# 미분류는 실력 구간이 아니라 '안 매김'이라 전 구간에 퍼져 있다. 좁게 묶으면 가짜 닻이
# 되므로 사실상 자유롭게 둔다(위 주석 참고).
SIGMA_UNRANKED = 3.0
# 미분류 선수 중 가중 경기 수가 이보다 적은 사람의 경기는 맞출 때 뺀다.
MIN_UNRANKED_GAMES = 3.0
# m은 자유롭게 두되(티어 간격을 데이터가 정하게), 수치 안정용으로만 아주 약하게 묶는다.
LAMBDA_M = 1e-6

# 로짓을 Elo스러운 점수로 바꿀 때 쓰는 배율/기준점. 화면에는 순위만 쓰지만,
# 나중에 점수를 보여주고 싶을 때를 위해 같이 내보낸다.
SCORE_SCALE = 400.0 / math.log(10)
SCORE_BASE = 1500.0


def load_json(path):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)


def tier_of(entry):
    """index.json의 선수 한 명에서 티어를 꺼낸다. 사다리에 없는 값은 전부 미분류."""
    t = str((entry or {}).get('t') or '').strip()
    return t if t in TIER_ORDER else UNRANKED


def build_pairs(rows, cats, today):
    """경기 행을 (승자, 패자) 쌍별 가중치 합으로 접는다.

    반환: (승자 인덱스 배열, 패자 인덱스 배열, 가중치 배열, 선수id 목록,
           선수별 가중 경기 수, 선수별 최근 경기일)
    """
    cat_w = [CAT_WEIGHT.get(c, DEFAULT_CAT_WEIGHT) for c in cats]
    pair_w = {}
    seen = {}            # 선수id -> 노드 번호
    order = []
    weight_sum = {}      # 노드 번호 -> 가중 경기 수
    last_day = {}        # 노드 번호 -> 최근 경기 날짜(문자열)

    def node(pid):
        key = str(pid)
        if key not in seen:
            seen[key] = len(order)
            order.append(key)
        return seen[key]

    for r in rows:
        if len(r) < 6:
            continue
        _, date, win, lose, _map, cat = r[:6]
        try:
            day = dt.date.fromisoformat(str(date)[:10])
        except ValueError:
            continue
        age = (today - day).days
        if age < 0:
            age = 0
        w = 0.5 ** (age / HALF_LIFE_DAYS)
        w *= cat_w[cat] if isinstance(cat, int) and 0 <= cat < len(cat_w) else DEFAULT_CAT_WEIGHT
        if w <= 0:
            continue
        i, j = node(win), node(lose)
        pair_w[(i, j)] = pair_w.get((i, j), 0.0) + w
        for n in (i, j):
            weight_sum[n] = weight_sum.get(n, 0.0) + w
            if str(date) > last_day.get(n, ''):
                last_day[n] = str(date)

    keys = list(pair_w.keys())
    wi = np.fromiter((k[0] for k in keys), dtype=np.int64, count=len(keys))
    li = np.fromiter((k[1] for k in keys), dtype=np.int64, count=len(keys))
    ww = np.fromiter((pair_w[k] for k in keys), dtype=np.float64, count=len(keys))
    n = len(order)
    wsum = np.zeros(n)
    for k, v in weight_sum.items():
        wsum[k] = v
    return wi, li, ww, order, wsum, last_day


def solve_at(rows, cats, as_of, players, t_pos, n_tiers):
    """as_of 시점까지의 경기만으로 한 번 맞춘다. 반환: (선수id -> 점수) 사전.

    최근 가중치의 기준일도 as_of로 잡는다 - 그래야 '그때 기준의 실력'이 나온다.
    """
    wi, li, ww, order, wsum, last_day = build_pairs(rows, cats, as_of)
    if not len(ww):
        return {}
    n = len(order)
    tier_idx = np.fromiter(
        (t_pos[tier_of(players.get(pid))] for pid in order), dtype=np.int64, count=n)
    unranked = tier_idx == t_pos[UNRANKED]
    thin = unranked & (wsum < MIN_UNRANKED_GAMES)
    keep = ~(thin[wi] | thin[li])
    lam = np.where(unranked, 1.0 / SIGMA_UNRANKED ** 2, 1.0 / SIGMA_DELTA ** 2)
    m, delta = fit(wi[keep], li[keep], ww[keep], tier_idx, lam, n, n_tiers)
    theta = m[tier_idx] + delta

    cutoff = (as_of - dt.timedelta(days=RECENT_DAYS)).isoformat()
    out = {}
    for k, pid in enumerate(order):
        entry = players.get(pid)
        if entry is None or tier_of(entry) == UNRANKED:
            continue
        if last_day.get(k, '') < cutoff:
            continue
        out[pid] = round(float(theta[k]) * SCORE_SCALE + SCORE_BASE)
    return out


def month_ends(last_day, count):
    """마지막 경기일부터 거슬러 올라가며 각 달의 말일을 count개 만든다(오름차순)."""
    y, mth = last_day.year, last_day.month
    out = []
    for _ in range(count):
        nxt = dt.date(y + (mth == 12), 1 if mth == 12 else mth + 1, 1)
        out.append(min(nxt - dt.timedelta(days=1), last_day))
        mth -= 1
        if mth == 0:
            y, mth = y - 1, 12
    return list(reversed(out))


def build_history(rows, cats, players, t_pos, n_tiers, last_day):
    """달마다 그 시점까지의 경기로 다시 맞춰 '그때의 점수'를 모은다.

    한 번 맞추는 데 1초 남짓이라 18개월이면 40초쯤 걸린다. 매일 도는 빌드에서
    이 정도면 감당할 만하고, 대신 지나간 달의 값이 매번 똑같이 재현된다.
    """
    dated = sorted(rows, key=lambda r: str(r[1])[:10])
    days = [str(r[1])[:10] for r in dated]
    months = month_ends(last_day, HISTORY_MONTHS)
    series = {}
    keys = []
    for i, end in enumerate(months):
        cut = bisect.bisect_right(days, end.isoformat())
        if cut < 100:
            continue
        scores = solve_at(dated[:cut], cats, end, players, t_pos, n_tiers)
        keys.append(end.strftime('%Y-%m'))
        for pid, sc in scores.items():
            series.setdefault(pid, {})[end.strftime('%Y-%m')] = sc
    # 달마다 값이 없을 수 있으므로(그 달에 쉬었으면) 자리를 null로 채워 길이를 맞춘다
    out = {pid: [vals.get(k) for k in keys] for pid, vals in series.items()}
    # 값이 하나뿐이면 선을 그릴 수 없다 - 파일만 키우므로 뺀다
    out = {pid: v for pid, v in out.items() if sum(x is not None for x in v) >= 2}
    return keys, out


def fit(wi, li, ww, tier_idx, lam, n_players, n_tiers):
    """θ = m[티어] + δ 를 가중 로지스틱 최대가능도로 맞춘다(볼록 문제).

    P(i가 j를 이김) = sigmoid(θ_i - θ_j)
    최소화: -Σ w·log sigmoid(θ_i - θ_j) + (1/2)Σ λ_i·δ_i² + (λ_m/2)Σm²

    lam은 선수별 prior 정밀도(1/σ²)다 - 티어가 있는 사람은 좁게, 미분류는 넓게 준다.
    """
    def fun_grad(x):
        delta, m = x[:n_players], x[n_players:]
        theta = m[tier_idx] + delta
        d = np.clip(theta[wi] - theta[li], -60, 60)
        # -log sigmoid(d) = log(1 + e^-d). logaddexp로 넘침 없이 계산한다.
        f = float(np.sum(ww * np.logaddexp(0.0, -d))
                  + 0.5 * np.sum(lam * delta ** 2)
                  + 0.5 * LAMBDA_M * np.sum(m ** 2))
        # 1 - sigmoid(d) = sigmoid(-d)
        resid = ww / (1.0 + np.exp(d))
        g_theta = np.zeros(n_players)
        np.add.at(g_theta, wi, -resid)
        np.add.at(g_theta, li, resid)
        return f, np.concatenate([
            g_theta + lam * delta,
            np.bincount(tier_idx, weights=g_theta, minlength=n_tiers) + LAMBDA_M * m,
        ])

    res = minimize(fun_grad, np.zeros(n_players + n_tiers), jac=True, method='L-BFGS-B',
                   options={'maxiter': 20000, 'maxfun': 40000, 'ftol': 1e-14, 'gtol': 1e-9})
    if not res.success:
        print(f'   ⚠️ 최적화가 수렴했다고 보고하지 않았습니다: {res.message}')
    delta, m = res.x[:n_players].copy(), res.x[n_players:].copy()
    # θ는 전체를 같이 밀어도 똑같다(차이만 의미가 있다). 티어 기준선의 평균을 0에 묶어
    # 값이 매번 다른 자리에 서지 않게 한다(미분류는 실력 구간이 아니라 평균에서 뺀다).
    m -= m[:len(TIER_ORDER)].mean()
    return m, delta


def main():
    ap = argparse.ArgumentParser(description='티어 안 순위(티어랭킹) 계산')
    ap.add_argument('--src', default=SRC_PATH, help=f'전적 아카이브 (기본 {SRC_PATH})')
    ap.add_argument('--index', default=INDEX_PATH, help=f'상대전적 index.json (기본 {INDEX_PATH})')
    ap.add_argument('--dry-run', action='store_true', help='파일에 쓰지 않고 결과만 찍는다')
    ap.add_argument('--top', type=int, default=0, help='티어별 상위 N명을 찍어본다')
    ap.add_argument('--no-history', action='store_true',
                    help='레이팅 변화(월별 스냅샷) 계산을 건너뛴다')
    args = ap.parse_args()

    if not os.path.exists(args.src) or not os.path.exists(args.index):
        print(f'ℹ️ {args.src} 또는 {args.index} 가 없어 티어랭킹을 건너뜁니다.')
        return 0

    store = load_json(args.src)
    index = load_json(args.index)
    rows = store.get('rows') or []
    cats = store.get('cats') or []
    players = index.get('players') or {}
    if not rows or not players:
        print('ℹ️ 전적이나 선수 목록이 비어 있어 티어랭킹을 건너뜁니다.')
        return 0

    # 기준일은 아카이브의 마지막 경기일로 잡는다. 오늘 날짜로 하면 수집이 며칠 밀렸을 때
    # 최근 가중치가 통째로 깎여서, 코드를 안 고쳤는데 순위가 흔들린다.
    today = max(dt.date.fromisoformat(str(r[1])[:10]) for r in rows if len(r) > 1)

    wi, li, ww, order, wsum, last_day = build_pairs(rows, cats, today)
    n = len(order)

    tiers = TIER_ORDER + [UNRANKED]
    t_pos = {t: i for i, t in enumerate(tiers)}
    tier_idx = np.fromiter(
        (t_pos[tier_of(players.get(pid))] for pid in order), dtype=np.int64, count=n)

    # 미분류 중 판 수가 너무 적은 사람의 경기는 뺀다. 실력 위치를 모르는 사람을
    # 티어 사이의 다리로 쓰면 없는 정보를 지어내게 된다(맨 위 주석의 표 참고).
    unranked = tier_idx == t_pos[UNRANKED]
    thin = unranked & (wsum < MIN_UNRANKED_GAMES)
    keep = ~(thin[wi] | thin[li])
    dropped_pairs = int((~keep).sum())
    wi, li, ww = wi[keep], li[keep], ww[keep]

    lam = np.where(unranked, 1.0 / SIGMA_UNRANKED ** 2, 1.0 / SIGMA_DELTA ** 2)
    m, delta = fit(wi, li, ww, tier_idx, lam, n, len(tiers))
    theta = m[tier_idx] + delta

    # 추정의 표준오차. 로지스틱 로그가능도의 대각 헤시안이 prior 정밀도 + Σ w·p(1-p)다.
    # 많이 둘수록 커지고(=확신), 표준오차는 그 역제곱근이다.
    d = np.clip(theta[wi] - theta[li], -60, 60)
    p_hat = 1.0 / (1.0 + np.exp(-d))
    info = ww * p_hat * (1.0 - p_hat)
    prec = lam.copy()
    np.add.at(prec, wi, info)
    np.add.at(prec, li, info)
    se = 1.0 / np.sqrt(prec)
    score = theta - SE_PENALTY * se        # 순위는 이 보수 추정으로 매긴다

    # 최근 RECENT_DAYS 안에 실제로 몇 판 뒀는지(가중치 없는 날것). 눈에 보이는 문턱이라
    # 가중치가 아니라 판 수 그대로 센다.
    cutoff_day = (today - dt.timedelta(days=RECENT_DAYS)).isoformat()
    recent_games = {}
    for r in rows:
        if len(r) < 6 or str(r[1])[:10] < cutoff_day:
            continue
        for pid in (str(r[2]), str(r[3])):
            recent_games[pid] = recent_games.get(pid, 0) + 1

    # 순위 대상: 티어가 매겨져 있고(=지금 티어표에 있고), 최근 RECENT_DAYS 안에
    # MIN_RECENT_GAMES판 이상 둔 선수. 휴면인 사람은 맞출 때는 상대로 쓰지만 순위에는 안 올린다.
    ranked = {}          # 티어 -> [(순위점수, 선수id)]
    skipped_recent = skipped_thin = 0
    for k, pid in enumerate(order):
        entry = players.get(pid)
        if entry is None:
            continue                       # 티어표 밖 상대(others)
        t = tier_of(entry)
        if t == UNRANKED:
            continue
        n_recent = recent_games.get(pid, 0)
        if n_recent == 0:
            skipped_recent += 1
            continue
        if n_recent < MIN_RECENT_GAMES:
            skipped_thin += 1
            continue
        ranked.setdefault(t, []).append((score[k], pid))

    tier_sizes = {}
    for t, lst in ranked.items():
        lst.sort(key=lambda x: -x[0])
        tier_sizes[t] = len(lst)
        for rank, (_score, pid) in enumerate(lst, start=1):
            players[pid]['k'] = rank

    # 다시 돌릴 때 옛 순위가 남지 않게, 이번에 순위를 못 받은 사람은 지운다.
    ranked_ids = {pid for lst in ranked.values() for _s, pid in lst}
    for pid, entry in players.items():
        if pid not in ranked_ids:
            entry.pop('k', None)

    index['ranking'] = {
        'asOf': today.isoformat(),
        'halfLifeDays': int(HALF_LIFE_DAYS),
        'recentDays': RECENT_DAYS,
        'minRecentGames': MIN_RECENT_GAMES,
        # 티어별 순위 인원. 뱃지의 '3위/16명'에서 분모로 쓴다.
        'tierCounts': {t: tier_sizes[t] for t in TIER_ORDER if t in tier_sizes},
        # 티어 기준선(로짓). 화면에는 안 쓰지만 간격이 뒤집혔는지 확인할 때 본다.
        'tierLevels': {t: round(float(m[t_pos[t]]) * SCORE_SCALE + SCORE_BASE, 1) for t in TIER_ORDER},
    }

    total = sum(tier_sizes.values())
    print(f'✅ 티어랭킹: {total:,}명 순위 매김 '
          f'(최근 {RECENT_DAYS}일 경기 없음 {skipped_recent:,}명 · '
          f'{MIN_RECENT_GAMES}판 미만 {skipped_thin:,}명)')
    print(f'   기준일 {today} · 반감기 {int(HALF_LIFE_DAYS)}일 · 쌍 {len(ww):,}개'
          f' (판 적은 미분류 제외 {dropped_pairs:,}쌍)')
    print('   티어 기준선(높을수록 강함):')
    for t in TIER_ORDER:
        if t in tier_sizes:
            print(f'     {t:>4}티어 {tier_sizes[t]:4d}명  {m[t_pos[t]] * SCORE_SCALE + SCORE_BASE:7.1f}')

    # 사람이 매긴 티어와 데이터가 가리키는 티어가 다른 사람을 알려준다.
    # 갓·킹은 '지금 실력 상위 N명'이 아니라 '대회에 올라간 명단'이라 어긋남이 많다
    # (실측: 킹 51.9% · 갓 37.5% vs 잭 3.4% · 1티어 0%). 순위는 사람이 매긴 티어
    # 안에서 그대로 매기고, 이 목록은 티어표를 갱신할 때 참고하라고 로그로만 남긴다.
    levels = np.array([m[t_pos[t]] for t in TIER_ORDER])
    pos = {pid: k for k, pid in enumerate(order)}
    off = []
    for t, lst in ranked.items():
        for _s, pid in lst:
            k = pos[pid]
            fit_t = TIER_ORDER[int(np.argmin(np.abs(levels - theta[k])))]
            if fit_t != t:
                off.append((TIER_ORDER.index(t) - TIER_ORDER.index(fit_t),
                            players[pid].get('n', pid), t, fit_t))
    if off:
        off.sort(key=lambda x: -abs(x[0]))
        print(f'   ℹ️ 사람이 매긴 티어와 데이터가 어긋난 선수 {len(off)}명 (상위 10명):')
        for gap, nm, t, fit_t in off[:10]:
            arrow = '↑' if gap > 0 else '↓'
            print(f'      {nm} : {t}티어 → 데이터는 {fit_t}티어 {arrow}{abs(gap)}칸')

    if args.top:
        name = lambda pid: players[pid].get('n', pid)
        print()
        for t in TIER_ORDER:
            if t not in ranked:
                continue
            head = ' · '.join(f'{i}위 {name(pid)}' for i, (_s, pid) in enumerate(ranked[t][:args.top], 1))
            print(f'   {t:>4}티어: {head}')

    if args.dry_run:
        print('   (--dry-run: 파일에 쓰지 않았습니다)')
        return 0

    tmp = args.index + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, args.index)

    if not args.no_history:
        months, series = build_history(rows, cats, players, t_pos, len(tiers), today)
        payload = {'asOf': today.isoformat(), 'months': months, 'players': series}
        tmp = HISTORY_PATH + '.tmp'
        with io.open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, HISTORY_PATH)
        size = os.path.getsize(HISTORY_PATH) / 1024
        print(f'✅ 레이팅 변화: {len(series):,}명 · {len(months)}개월 · {size:.0f}KB'
              f' → {HISTORY_PATH}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
