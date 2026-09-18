import hashlib
import json
import os
import re
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
# - [캐시] 정적 자산 주소에 내용 해시를 붙인다(asset_url: app.js → app.js?v=1a2b3c4d5e).
#   GitHub Pages는 정적 파일을 약 10분간 캐시하므로, 배포 직후 "새 index.html + 옛 app.js"
#   조합을 받는 사용자가 생길 수 있었다. 파일 내용이 바뀌면 주소 자체가 바뀌므로 이런 불일치가
#   생기지 않고, 반대로 안 바뀐 파일은 브라우저 캐시를 그대로 재사용한다.
#   site_data.json도 같은 방식으로 버전을 <meta name="site-data-version">에 넣어,
#   app.js가 매번 no-store로 새로 받지 않고 버전이 바뀔 때만 새로 받게 했다.

TEMPLATE_DIR = 'templates'
STATIC_SRC = os.path.join(TEMPLATE_DIR, 'assets')
OUT_DIR = 'docs'
# 상단 메뉴에서 숨길 항목 목록. 어드민 페이지(admin.html)가 GitHub에 직접 써서 고친다.
# 빌드가 이 파일을 읽는 이유: 숨긴 메뉴를 HTML에 처음부터 hidden으로 내보내면, 페이지를
# 열 때 잠깐 보였다가 사라지는 깜빡임이 없다. core.js도 런타임에 같은 파일을 다시 읽어
# 반영하므로(다음 빌드를 기다리지 않아도 즉시 적용), 두 경로가 항상 같은 결론에 도달한다.
NAV_FILE = os.path.join(OUT_DIR, 'data', 'nav.json')

# ----- 페이지 구성 -----
# [구조 변경] 예전엔 index.html 하나(SPA)였다. 이제 메뉴마다 실제 페이지를 만든다:
#   docs/index.html(홈), docs/schedule/index.html, docs/members/index.html, ...
# 각 페이지는 templates/pages/<id>.html이 templates/base.html(공통 머리/메뉴)을 상속한다.
# 메뉴를 추가하려면 여기 한 줄 + templates/pages/<id>.html + (필요하면) page-<id>.js만 만들면 된다.
# (id, 메뉴 이름, 페이지 제목(None이면 사이트 이름만), 검색/링크 미리보기 설명)
PAGES = [
    ('home', '홈', None, '캄몬스타즈 멤버들의 방송·공지·일정·전적을 한곳에서 보는 스타대학입니다.'),
    ('schedule', '일정', '일정', '캄몬스타즈의 다가올 일정과 지나간 일정입니다.'),
    ('members', '멤버', '멤버', '캄몬스타즈 멤버들의 현황과 소식입니다.'),
    ('records', '전적', '전적', '캄몬스타즈 소속으로 참가한 대회 · 대학 · 미니 · CK 전적입니다.'),
    # 티어표는 우리 팀이 아니라 스타 커뮤니티 전체를 보여주는 페이지다. 명단은 시너지가
    # 매일 만들어 공개하는 것을 page-tier.js가 그대로 읽고(우리 db.json과 무관),
    # 방송 중 여부는 시너지 워커에서 받아온다. 그래서 이 빌드 스크립트가 넘겨줄 데이터는 없다.
    ('tier', '티어표', '티어표', '스타 커뮤니티 전체 티어표입니다. 지금 방송 중인 인원을 함께 보여줍니다.'),
    # 영상은 어드민이 등록한 유튜브 채널의 최신 영상(data/videos.json, scripts/sync_videos.py)을 브라우저가 직접 읽는다.
    ('video', '영상', '영상', '캄몬스타즈 팬 유튜브 채널의 최신 영상과 추천 영상입니다.'),
    ('stats', '방송통계', '방송통계', '캄몬스타즈 멤버들의 이번 달 방송 통계입니다.'),
    ('tools', '도구', '도구', '자주 쓰는 도구 모음입니다.'),
]
SITE_NAME = '스타대학'
# 대표 주소(검색엔진 대표 URL, 링크 미리보기 이미지 주소에 쓰임 - 절대 주소여야 한다).
# 다른 주소로 배포하면 워크플로 환경변수 SITE_URL로 바꾸면 된다(끝의 / 없이).
SITE_URL = os.environ.get('SITE_URL', 'https://ststats.github.io/staruniv').rstrip('/')
# 링크 미리보기 이미지. 가로 1200×630 PNG/JPG를 따로 만들어 images/에 넣고 이 값을 바꾸면 더 잘 보인다.
OG_IMAGE_PATH = 'images/캄몬스타즈.webp'

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


def load_nav_config():
    """어드민이 관리하는 표시/숨김 설정(docs/data/nav.json)을 읽어
    (숨길 메뉴 id, 숨길 방송통계 지표 탭) 두 집합으로 돌려준다.
    파일이 없거나 깨져 있으면 "아무것도 숨기지 않음"으로 돌아간다 - 메뉴가 사라지는 쪽보다
    다 보이는 쪽이 안전한 실패다."""
    try:
        with open(NAV_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError) as e:
        if not isinstance(e, FileNotFoundError):
            print(f"⚠️ {NAV_FILE} 을 읽을 수 없어 메뉴를 모두 표시합니다: {e}")
        return set(), set()
    ids = {str(x) for x in data.get('hidden', []) if isinstance(x, (str, int))}
    tabs = {str(x) for x in data.get('statsTabs', []) if isinstance(x, (str, int))}
    return ids, tabs


# ---------------------------------------------------------------------------
# docs/data/site_data.json 에 담을 칸 (여기 없는 칸은 배포본에서 빠진다)
# ---------------------------------------------------------------------------
# 사이트는 정적 페이지라, 브라우저가 받아 그리는 데이터는 누구나 그대로 내려받을 수 있다.
# 그래서 "화면에 안 쓰는 값은 아예 안 내보낸다"가 유일한 가리기 방법이다.
# (시트와 data/db.json에는 그대로 남아 있고, 배포 폴더로만 안 나간다)
SITE_MEMBER_FIELDS = ['이름', 'SOOP ID', '생년월일', '성별', '종족', '티어', '직책', '입단일', '퇴단일', 'MBTI']
SITE_MATCH_FIELDS = ['매치 번호', '날짜', '상대팀', '형식', '방식', '최종 결과', '세트 결과', '_match_key']
SITE_ROUND_FIELDS = ['매치 번호', '날짜', '상대팀', '형식', '세트', '라운드',
                     '우리 선수', '결과', '상대 선수', '맵', '_match_key', '_mirrored']
SITE_PLAYER_STAT_FIELDS = ['이름', '대회 전적', '대학 전적', '미니 전적', 'CK 전적',
                           '테란전 전적', '저그전 전적', '프로토스전 전적', '상대전적']


def pick(row, fields):
    """정해둔 칸만 남긴 새 dict. 값이 없는 칸은 넣지 않는다(파일 크기도 줄어든다)."""
    return {k: row[k] for k in fields if k in row}


def page_output_path(page_id):
    return os.path.join(OUT_DIR, 'index.html') if page_id == 'home' else os.path.join(OUT_DIR, page_id, 'index.html')


def page_url_path(page_id):
    """사이트 루트 기준 상대 경로('' 또는 'records/'). 메뉴 링크와 대표 주소에 쓴다."""
    return '' if page_id == 'home' else f'{page_id}/'


def page_context(page_id, title, description, hidden_nav_ids=frozenset(), hidden_stats_tabs=frozenset()):
    """페이지별로 달라지는 템플릿 값(제목/설명/대표 주소/<base>/메뉴 링크)."""
    return {
        'page_id': page_id,
        # 하위 폴더 페이지는 <base href="../">로 모든 상대 경로를 사이트 루트 기준으로 맞춘다
        'root': '' if page_id == 'home' else '../',
        'full_title': f'{title} | {SITE_NAME}' if title else SITE_NAME,
        'description': description,
        'canonical_url': f'{SITE_URL}/{page_url_path(page_id)}',
        'og_image_url': f'{SITE_URL}/{quote(OG_IMAGE_PATH)}',
        # 상단 메뉴에서 '홈'은 뺀다 - 왼쪽 로고가 홈 링크라(base.html) 중복이고, 메뉴 칸도
        # 아낀다. 홈 페이지 자체는 PAGES에 그대로 있으니 계속 생성된다.
        # 숨긴 메뉴도 마크업에는 남기고 hidden 속성만 붙인다 - core.js가 런타임에
        # nav.json을 다시 읽어 다시 보이게 할 수 있어야 하기 때문(지워버리면 불가능).
        'nav_items': [{'id': pid, 'label': label, 'href': page_url_path(pid) or './',
                       'hidden': pid in hidden_nav_ids}
                      for pid, label, _, _ in PAGES if pid != 'home'],
        # 방송통계 지표 탭도 메뉴와 같은 방식이다: 마크업에는 남기고 hidden만 붙인다
        # (core.js가 런타임에 nav.json을 다시 읽어 되살릴 수 있어야 한다).
        'hidden_stats_tabs': hidden_stats_tabs,
    }


def write_text_atomic(path, text, newline=None):
    # newline=''이면 text의 줄바꿈(CRLF/LF)을 손대지 않고 그대로 쓴다.
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8', newline=newline) as f:
        f.write(text)
    os.replace(tmp_path, path)


def content_version(data):
    """캐시 무효화용 짧은 버전 문자열(내용 해시 앞 10자리). 내용이 같으면 항상 같은 값."""
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()[:10]


def static_asset_versions():
    """templates/assets/ 안 파일별 버전. 템플릿의 asset_url()이 이 값을 쓴다."""
    versions = {}
    if os.path.isdir(STATIC_SRC):
        for filename in os.listdir(STATIC_SRC):
            path = os.path.join(STATIC_SRC, filename)
            if os.path.isfile(path):
                with open(path, 'rb') as f:
                    versions[filename] = content_version(f.read())
    return versions


def make_asset_url(versions):
    def asset_url(filename):
        version = versions.get(filename)
        if version is None:
            # 템플릿이 없는 파일을 가리키면 조용히 404가 나는 대신 빌드 로그로 바로 알 수 있게 한다
            print(f"⚠️ asset_url: templates/assets/{filename} 파일이 없습니다. 버전 없이 출력합니다.")
            return filename
        return f"{filename}?v={version}"
    return asset_url


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

    # 멤버/매치/라운드/개인통계는 경기가 쌓일수록 계속 커지는 데이터라, index.html에
    # 직접 박아넣지 않고 별도 JSON으로 빼서 브라우저가 비동기로 fetch하게 한다.
    # (초기 HTML 용량이 데이터량과 무관하게 항상 일정하게 유지됨)
    # 버전(해시)을 index.html에 넣어야 하므로 템플릿 렌더링보다 먼저 직렬화한다.
    # 배포 폴더(docs/)에 올라가는 JSON은 인터넷에 그대로 공개된다. 그래서 화면에 실제로 쓰는
    # 칸만 골라 담는다 - 시트에는 있지만 사이트가 안 쓰는 칸(펀딩·지원금·사비 같은 금액, 도전미션,
    # 라운드별 종족·티어 등)은 여기서 걸러진다. 화면에 새 칸을 쓰기 시작하면 여기 목록에 추가한다.
    site_data = {
        'members': [pick(m, SITE_MEMBER_FIELDS) for m in sorted_members],
        'matches': [pick(m, SITE_MATCH_FIELDS) for m in matches_list],
        'rounds': [pick(r, SITE_ROUND_FIELDS) for r in rounds_list],
        'playersStats': [pick(p, SITE_PLAYER_STAT_FIELDS) for p in stats_data['member_stats']['전체']],
    }
    site_data_text = json.dumps(site_data, ensure_ascii=False)

    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    env.filters['team_logo_src'] = team_logo_src
    versions = static_asset_versions()
    env.globals['asset_url'] = make_asset_url(versions)
    common = {'crew_stats': stats_data['crew_stats'], 'site_data_version': content_version(site_data_text)}

    os.makedirs(os.path.join(OUT_DIR, 'data'), exist_ok=True)
    hidden_nav_ids, hidden_stats_tabs = load_nav_config()
    if hidden_nav_ids:
        print(f"ℹ️ 상단 메뉴에서 숨김: {', '.join(sorted(hidden_nav_ids))}")
    if hidden_stats_tabs:
        print(f"ℹ️ 방송통계 지표 탭에서 숨김: {', '.join(sorted(hidden_stats_tabs))}")
    for page_id, _, title, description in PAGES:
        html_output = env.get_template(f'pages/{page_id}.html').render(
            **common, **page_context(page_id, title, description, hidden_nav_ids, hidden_stats_tabs))
        out_path = page_output_path(page_id)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        write_text_atomic(out_path, html_output)
    print(f"✅ 페이지 {len(PAGES)}개 생성: {', '.join(page_output_path(p[0]) for p in PAGES)}")

    site_data_path = os.path.join(OUT_DIR, 'data', 'site_data.json')
    write_text_atomic(site_data_path, site_data_text)
    print(f"✅ site_data.json 저장 완료 ({os.path.getsize(site_data_path) / 1024:.1f} KB)")

    copy_static_assets()
    # 독립 관리자/멀티뷰어도 일반 페이지와 같은 자산 버전을 사용한다.
    # 오래 캐시된 CSS/캘린더 스크립트가 새 HTML과 섞이지 않도록 한다.
    for filename in ('admin.html', 'multiview.html'):
        standalone = os.path.join(OUT_DIR, filename)
        if not os.path.isfile(standalone):
            continue
        # 손으로 관리하는 파일이라 원래 줄바꿈 형식(CRLF)을 지킨다. 기본 모드로 읽고 쓰면
        # CRLF가 LF로 바뀌어, 캐시 해시 한 줄만 바뀌어도 파일 전체가 바뀐 것으로 커밋된다.
        with open(standalone, encoding='utf-8', newline='') as f:
            html = f.read()
        for asset, version in versions.items():
            html = re.sub(r'((?:src|href)=")' + re.escape(asset) + r'(?:\?v=[a-f0-9]+)?"',
                          lambda match: f'{match.group(1)}{asset}?v={version}"', html)
        write_text_atomic(standalone, html, newline='')
    print("✅ 성공적으로 화이트&블루 통합 웹페이지가 구워졌습니다!")


if __name__ == '__main__':
    main()
