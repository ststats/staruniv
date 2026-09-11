import json
import os
import shutil
import sys
from urllib.parse import quote

from jinja2 import Environment, FileSystemLoader

from match_link import load_linked_db

# [리팩토링 메모]
# - link_rounds_to_matches를 여기서 다시 돌리지 않고, generate_stats.py가 같은 db.json으로
#   이미 계산해 둔 결과를 load_linked_db()로 재사용한다(db.json이 바뀌었으면 자동 재계산).
# - 출력 파일(index.html, site_data.json)은 임시 파일에 다 쓴 뒤 교체(atomic write)해서,
#   빌드가 중간에 죽어도 반쯤 쓰인 파일이 배포되는 일이 없게 했다.
# - 정적 자산 복사 시 하위 폴더가 섞여 있으면 shutil.copyfile이 IsADirectoryError로 빌드
#   전체를 죽이던 문제를 막았다(파일만 복사).
# - 템플릿의 팀 로고 파일명 규칙('내전'→캄몬스타즈, URL 인코딩)을 app.js의 teamLogoHtml과
#   똑같이 맞추는 team_logo_src 필터를 추가했다(예전엔 템플릿에 규칙이 따로 박혀 있었다).

TEMPLATE_DIR = 'templates'
STATIC_SRC = os.path.join(TEMPLATE_DIR, 'assets')
OUT_DIR = 'docs'

# app.js의 TIER_ORDER와 완전히 동일한 순서 - 멤버카드 그리드 정렬이랑 아바타 바
# 정렬이 서로 다르게 나오지 않도록 여기서도 같은 기준을 쓴다. (참고: app.js의
# tierIndex()는 목록에 없는 값이면 배열 길이를 반환해 맨 뒤로 보내는데, 여기서도
# 동일하게 처리한다.)
TIER_ORDER = ['갓', '킹', '잭', '조커', '스페이드', '0', '1', '2', '3', '4', '5', '6', '7', '8', '베이비']
_TIER_INDEX = {tier: i for i, tier in enumerate(TIER_ORDER)}  # list.index()의 O(n) 탐색 대신 O(1) 조회
ROLE_ORDER = {'감독': 1, '코치': 2, '선수': 3}

# 자기 자신과 붙는 '내전'은 상대 로고 대신 우리 팀 로고를 쓴다 (app.js의 teamLogoHtml과 동일).
OWN_TEAM_LOGO_NAME = '캄몬스타즈'
# encodeURIComponent가 인코딩하지 않는 문자 중 urllib.parse.quote가 기본으로 인코딩하는 것들
# (영숫자와 -_.~ 는 quote도 원래 그대로 둔다).
_URI_COMPONENT_SAFE = "!'()*"


def tier_index(tier):
    return _TIER_INDEX.get(str(tier) if tier is not None else '', len(TIER_ORDER))


def sort_members(members):
    return sorted(members, key=lambda x: (
        ROLE_ORDER.get(x.get('직책', '선수'), 99),
        tier_index(x.get('티어'))
    ))


def team_logo_src(team_name):
    """images/{팀이름}.webp 경로. JS의 encodeURIComponent와 같은 문자 집합만 남기고
    인코딩해서, 템플릿이 그린 로고와 app.js가 그린 로고가 항상 같은 URL을 가리키게 한다."""
    name = str(team_name or '').strip()
    file_name = OWN_TEAM_LOGO_NAME if name == '내전' else name
    return f"images/{quote(file_name, safe=_URI_COMPONENT_SAFE)}.webp"


def write_text_atomic(path, text):
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp_path, path)


def write_json_atomic(path, obj):
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp_path, path)


def load_inputs():
    try:
        with open('data/render_stats.json', 'r', encoding='utf-8') as f:
            stats_data = json.load(f)
        db_data, linked_matches, linked_rounds = load_linked_db('data/db.json')
    except FileNotFoundError:
        print("❌ JSON 파일이 없습니다.")
        sys.exit(1)
    except ValueError as e:  # json.JSONDecodeError 포함 - 파일이 깨졌을 때 원인을 바로 알 수 있게
        print(f"❌ JSON 파일을 읽는 중 오류가 발생했습니다: {e}")
        sys.exit(1)
    return stats_data, db_data, linked_matches, linked_rounds


def copy_static_assets():
    """정적 자산(CSS/JS 등)은 데이터와 무관하게 그대로 복사.
    templates/assets/ 아래에 두고 소스로 관리, 빌드마다 docs/로 동기화.
    (여기 주석에 파일명을 나열하지 않는 이유: 예전에 update.yml의 git add가
    파일명을 하나하나 나열하는 방식이라 새 파일을 추가하고 그 목록에 반영하는 걸
    깜빡해 배포가 안 됐던 적이 있다 - 같은 실수를 반복하지 않도록 여기서도
    "폴더 안의 전부"로만 설명한다.)"""
    if not os.path.isdir(STATIC_SRC):
        return
    copied = []
    for filename in sorted(os.listdir(STATIC_SRC)):
        src = os.path.join(STATIC_SRC, filename)
        if not os.path.isfile(src):  # 하위 폴더 등은 건너뜀(copyfile이 예외로 빌드를 죽이지 않도록)
            continue
        shutil.copyfile(src, os.path.join(OUT_DIR, filename))
        copied.append(filename)
    print(f"✅ 정적 자산 {copied} 을(를) docs/로 복사했습니다.")


def main():
    stats_data, db_data, linked_matches, linked_rounds = load_inputs()

    sorted_members = sort_members(db_data.get('members', []))

    # 최신 경기가 위로 오도록 역순 정렬 (팀 경기, 개인 라운드 경기)
    # (같은 날짜끼리는 시트 입력 순서가 유지된다 - sorted는 reverse=True여도 안정 정렬)
    matches_list = sorted(linked_matches, key=lambda x: str(x.get('날짜', '')), reverse=True)
    rounds_list = sorted(linked_rounds, key=lambda x: str(x.get('날짜', '')), reverse=True)

    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    env.filters['team_logo_src'] = team_logo_src
    template = env.get_template('index.html')
    html_output = template.render(crew_stats=stats_data['crew_stats'])

    os.makedirs(os.path.join(OUT_DIR, 'data'), exist_ok=True)
    write_text_atomic(os.path.join(OUT_DIR, 'index.html'), html_output)

    # 멤버/매치/라운드/개인통계는 경기가 쌓일수록 계속 커지는 데이터라, index.html에
    # 직접 박아넣지 않고 별도 JSON으로 빼서 브라우저가 비동기로 fetch하게 한다.
    # (초기 HTML 용량이 데이터량과 무관하게 항상 일정하게 유지됨)
    site_data = {
        'members': sorted_members,
        'matches': matches_list,
        'rounds': rounds_list,
        'playersStats': stats_data['member_stats']['전체'],
    }
    site_data_path = os.path.join(OUT_DIR, 'data', 'site_data.json')
    write_json_atomic(site_data_path, site_data)
    print(f"✅ site_data.json 저장 완료 ({os.path.getsize(site_data_path) / 1024:.1f} KB)")

    copy_static_assets()
    print("✅ 성공적으로 화이트&블루 통합 웹페이지가 구워졌습니다!")


if __name__ == '__main__':
    main()
