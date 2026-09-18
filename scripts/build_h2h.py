"""상대전적 탭이 읽을 파일을 만든다: data/eloboard.json(원본 아카이브) → docs/data/h2h/

[왜 쪼개는가]
원본 아카이브는 37.5만 건 14MB다. 상대전적은 "선수 두 명"만 보면 되는 화면이라, 그걸 통째로
받게 하면 휴대폰에서 한 화면 보려고 14MB를 받는 셈이 된다. 그래서 선수별로 잘라 둔다.

    docs/data/h2h/index.json      - 검색용 선수 목록 + 맵·대회 사전 (한 번만 받는다)
    docs/data/h2h/p/<선수id>.json - 그 선수의 모든 경기 (선수를 고를 때 한 개씩 받는다)

선수 한 명 파일은 평균 1~2천 경기라 30~60KB다. 두 명을 고르면 둘 중 한 명의 파일만 있으면
상대전적이 나오지만(행에 상대 id가 있다), 프로필 카드에 각자 전체 승률도 보여줘야 해서 둘 다 받는다.

[티어표와 잇기]
검색 대상은 티어표(시너지 명단)에 있는 선수다. 시너지 명단에 eloboard 선수 번호(elo_id)가
들어 있으므로 그 번호로 잇는다. elo_id가 비어 있는 선수만 이름으로 맞춰보고(공백·대소문자 무시),
그래도 못 찾으면 docs/data/h2h_alias.json 에 {"시너지 닉네임": "eloboard 이름"} 으로 적어주면 된다.

[대회 이름] eloboard는 형식을 영문 코드로 준다(sponsored, college_war ...). 화면에 그대로 쓰면
읽기 어려워서 아래 CAT_LABELS로 우리말 이름을 붙인다. 목록에 없는 코드는 원문 그대로 둔다.

    python scripts/build_h2h.py            # 시너지 명단을 받아서 만든다
    python scripts/build_h2h.py --offline  # 명단을 못 받으면 이름/종족만으로 만든다(로컬 테스트)
"""

import argparse
import json
import os
import re
import shutil
import sys
import urllib.request

SRC_PATH = os.path.join('data', 'eloboard.json')
OUT_DIR = os.path.join('docs', 'data', 'h2h')
ALIAS_PATH = os.path.join('docs', 'data', 'h2h_alias.json')
SYNERGY_BASE = 'https://ststats.github.io/synergy'
HIDDEN_TEAMS = {'휴면'}          # page-tier.js의 TIER_HIDDEN_TEAMS와 같은 기준

# eloboard 형식 코드 → 화면에 쓸 이름 (2026-09 기준 건수: 스폰 27.6만 · 프로리그 3.8만 ·
# 개인 대회 2.7만 · 팀 대회 2.8만 · 대학 미니 3.4천 · 대학 대회 2.1천 · 대학대전 1.7천)
# 적어둔 차례가 곧 보여줄 차례다(나중에 형식 필터를 붙이면 이 순서로 나온다).
CAT_LABELS = {
    'sponsored': '스폰',
    'pro_league': '리그',
    'solo_event': '개인',
    'team_event': 'CK',
    'college_event': '대회',
    'college_mini': '미니',
    'college_war': '대학',
    '': '기타',
}


def norm(name):
    """이름 맞추기용 키. 공백·기호를 빼고 소문자로."""
    return re.sub(r'[\s_.\-]+', '', str(name or '')).lower()


def load_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        if default is None:
            sys.exit(f'❌ {path} 이 없습니다. 먼저 scripts/sync_eloboard.py 를 돌려주세요.')
        return default
    except ValueError as e:
        sys.exit(f'❌ {path} 이 깨졌습니다: {e}')


def http_json(url):
    with urllib.request.urlopen(url, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


DB_PATH = os.path.join('data', 'db.json')


def sheet_tier_members():
    """구글시트 members 시트(= 티어표 원본)에서 명단을 읽는다.
    시너지 명단과 달리 휴면·FA까지 다 들어 있어서, 상대전적에서 찾을 수 있는 선수가 훨씬 많다.
    돌려주는 모양은 fetch_tier_members()와 같다."""
    db = load_json(DB_PATH, {})
    out = []
    for r in db.get('tierMembers') or []:
        elo = str(r.get('ELO ID', '') or '').strip()
        nickname = str(r.get('닉네임', '') or '').strip() or str(r.get('이름', '') or '').strip()
        if not nickname:
            continue
        out.append({
            'id': str(r.get('SOOP ID', '') or '').strip(),
            'nickname': nickname,
            'elo_id': elo,
            'team': str(r.get('소속', '') or '').strip(),
            'tier': str(r.get('티어', '') or '').strip(),
            'race': str(r.get('종족', '') or '').strip(),
        })
    return out


def fetch_tier_members():
    """(예비) 시너지가 매일 공개하는 명단. 시트를 아직 안 채운 저장소에서만 쓴다."""
    with urllib.request.urlopen(f'{SYNERGY_BASE}/data/dates.js', timeout=30) as res:
        text = res.read().decode('utf-8')
    m = re.search(r'window\.AVAILABLE_DATES\s*=\s*(\[[^\]]*\])', text)
    if not m:
        raise ValueError('dates.js 형식을 읽을 수 없습니다')
    dates = json.loads(m.group(1))
    if not dates:
        raise ValueError('사용 가능한 날짜가 없습니다')
    data = http_json(f'{SYNERGY_BASE}/data/daily/{dates[0]}.json')
    out = []
    for m2 in (data.get('members') or []):
        team = str(m2.get('team') or '').strip()
        if not m2.get('id') or not team or team in HIDDEN_TEAMS:
            continue
        out.append({
            'id': str(m2['id']).strip(),
            'nickname': str(m2.get('nickname') or '').strip(),
            'elo_id': str(m2.get('elo_id') or '').strip(),   # eloboard 선수 번호(이게 있으면 바로 이어진다)
            'team': team,
            'tier': m2.get('tier'),
            'race': str(m2.get('race') or '').strip(),
        })
    return dates[0], out


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description='상대전적 데이터 만들기')
    ap.add_argument('--offline', action='store_true', help='시너지 명단 없이 만든다(로컬 테스트)')
    ap.add_argument('--src', default=SRC_PATH, help=f'원본 아카이브 경로 (기본 {SRC_PATH})')
    args = ap.parse_args()

    store = load_json(args.src)
    rows = store.get('rows') or []
    players = store.get('players') or {}       # { "id": [이름, 주종족] }
    maps = store.get('maps') or {}
    cats = store.get('cats') or []

    tier_date, tier_members = '', []
    if not args.offline:
        tier_members = sheet_tier_members()
        if tier_members:
            print(f'  명단: 구글시트 members 시트 {len(tier_members):,}명')
        else:
            try:                                 # 시트가 아직 없는 저장소 - 예전처럼 시너지에서
                tier_date, tier_members = fetch_tier_members()
                print(f'  명단: 시너지 {len(tier_members):,}명 (구글시트 members 시트가 비어 있음)')
            except Exception as e:               # 명단을 못 받아도 파일은 만든다(이름만으로)
                print(f'⚠️ 명단을 받지 못했습니다({e}). 이름/종족만으로 만듭니다.')

    alias = load_json(ALIAS_PATH, {})           # { 시너지 닉네임: eloboard 이름 }
    by_norm = {}
    for pid, info in players.items():
        by_norm.setdefault(norm(info[0] if isinstance(info, list) else info), pid)

    # 시너지 명단 ↔ eloboard 선수 잇기: elo_id가 먼저, 없으면 이름으로
    linked = {}                                  # pid -> {tier, team, soop}
    missing = []
    by_eloid, by_name = 0, 0
    for m in tier_members:
        pid = ''
        if m.get('elo_id') and m['elo_id'] in players:
            pid, by_eloid = m['elo_id'], by_eloid + 1
        else:
            want = alias.get(m['nickname']) or m['nickname']
            pid = by_norm.get(norm(want), '')
            if pid:
                by_name += 1
        if not pid:
            missing.append(m['nickname'])
            continue
        # 이름은 티어표(시너지) 닉네임을 쓴다 - 사이트 다른 화면과 같은 이름으로 보이게.
        linked[pid] = {'n': m['nickname'], 'tm': m['team'], 's': m['id'],
                       **({'t': m['tier']} if m['tier'] not in (None, '') else {})}
    if tier_members:
        print(f'  잇기: elo_id {by_eloid}명 · 이름 {by_name}명 · 못 찾음 {len(missing)}명 (명단 {len(tier_members)}명)')

    # 티어표 선수의 경기만 선수별로 모은다. 행: [경기id, 날짜, 승자, 패자, 맵, 대회]
    # 명단을 못 받았는데도 그냥 진행하면 eloboard 전체 선수(수천 명)로 파일을 만들어
    # 저장소에 수천 개 파일을 쏟아붓는다. 그럴 바엔 이번 실행을 멈추고 기존 파일을 남긴다.
    if not linked and not args.offline:
        # 왜 0명인지 바로 알 수 있게 양쪽 상태를 찍어준다.
        sample = lambda names: ', '.join(list(names)[:8]) or '(없음)'
        print('❌ 티어표 명단과 이어붙인 선수가 0명입니다. 기존 파일을 그대로 두고 멈춥니다.')
        print(f'   · 명단: {len(tier_members)}명   예) {sample(m["nickname"] for m in tier_members)}')
        print(f'   · eloboard 선수: {len(players)}명   예) {sample((v[0] if isinstance(v, list) else v) for v in players.values())}')
        if not players:
            print('   → 아카이브에 선수가 없습니다. scripts/sync_eloboard.py 가 제대로 받았는지 먼저 확인해주세요.')
        elif not tier_members:
            print('   → 명단이 비어 있습니다. 구글시트 members 시트와 data/db.json 을 확인해주세요.')
        else:
            print('   → 양쪽 다 있는데 하나도 안 맞습니다. 명단의 ELO ID가 비어 있다면')
            print('      docs/data/h2h_alias.json 에 {"시너지 닉네임": "eloboard 이름"} 으로 몇 명 적어주세요.')
        sys.exit(1)
    target = set(linked) if linked else set(players)
    per = {pid: [] for pid in target}
    names_used = set()
    for r in rows:
        if len(r) < 6:
            continue
        _, date, win, lose, map_id, cat = r[:6]
        # 선수 id는 사전 키(문자열)에 맞춘다 - 원본 행은 숫자다
        for me, opp, res in ((str(win), str(lose), 1), (str(lose), str(win), 0)):
            if me in per:
                per[me].append([date, opp, res, map_id, cat])
                names_used.add(opp)

    # 선수 파일은 새 폴더에 전부 쓴 뒤 마지막에 바꿔치기한다. 예전처럼 먼저 지우고 쓰면
    # 도중에 죽었을 때 '절반만 있는' 폴더가 그대로 커밋돼 상대전적이 404가 난다.
    out_players = os.path.join(OUT_DIR, 'p')
    tmp_players = out_players + '.new'
    if os.path.isdir(tmp_players):
        shutil.rmtree(tmp_players)

    index_players = {}
    for pid, matches in per.items():
        if not matches:
            continue
        matches.sort(key=lambda x: x[0], reverse=True)          # 최신 경기가 앞
        info = players.get(pid) or players.get(str(pid)) or ['', '']
        name = info[0] if isinstance(info, list) else str(info)
        race = (info[1] if isinstance(info, list) and len(info) > 1 else '') or ''
        wins = sum(1 for x in matches if x[2])
        link = linked.get(pid, {})
        index_players[str(pid)] = {
            'n': name, 'r': race, 'm': len(matches), 'w': wins, 'd': matches[0][0],
            **link,
            # 티어표 닉네임과 eloboard 이름이 다르면 둘 다 남긴다(검색에서 양쪽 다 걸리게).
            **({'en': name} if link.get('n') and link['n'] != name else {}),
        }
        write_json(os.path.join(tmp_players, f'{pid}.json'), {'id': str(pid), 'rows': matches})

    # 상대 이름 사전: 티어표 밖 선수도 경기 목록에 이름이 나와야 한다
    others = {}
    for pid in names_used:
        key = str(pid)
        if key in index_players:
            continue
        info = players.get(key)
        if info:
            others[key] = info[0] if isinstance(info, list) else str(info)

    index = {
        'syncedAt': store.get('synced_at', ''),
        'tierDate': tier_date,
        'count': store.get('count', len(rows)),
        # 형식은 우리말 이름으로 바꿔 내보낸다(행에는 번호만 들어가므로 순서는 그대로 둔다)
        'cats': [CAT_LABELS.get(c, c or '기타') for c in cats],
        # 형식 보여줄 차례(CAT_LABELS에 적은 순서). 행의 형식 번호는 위 cats 자리 그대로다.
        'catOrder': [CAT_LABELS.get(c, c) for c in CAT_LABELS if CAT_LABELS.get(c, c) in
                     {CAT_LABELS.get(x, x or '기타') for x in cats}],
        'maps': maps,
        'players': index_players,
        'others': others,
    }
    write_json(os.path.join(OUT_DIR, 'index.json'), index)

    # 여기까지 왔으면 선수 파일이 전부 만들어졌다. 이제야 옛 폴더를 지우고 새 폴더로 바꾼다.
    if os.path.isdir(tmp_players):
        if os.path.isdir(out_players):
            shutil.rmtree(out_players)              # 명단에서 빠진 선수 파일이 남지 않게
        os.replace(tmp_players, out_players)

    size = os.path.getsize(os.path.join(OUT_DIR, 'index.json')) / 1024
    print(f'✅ {OUT_DIR}: 선수 {len(index_players):,}명 · 경기 {len(rows):,}건 · index {size:.0f}KB')
    if missing:
        print(f'   ℹ️ eloboard에서 못 찾은 티어표 선수 {len(missing)}명: {", ".join(missing[:15])}'
              f'{" ..." if len(missing) > 15 else ""}')
        print(f'      이름이 다르면 {ALIAS_PATH} 에 {{"시너지 닉네임": "eloboard 이름"}} 으로 적어주세요.')


if __name__ == '__main__':
    main()
