import hashlib
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from jinja2 import Environment, FileSystemLoader

# [리팩토링 메모]
# - 출력 HTML은 임시 파일에 다 쓴 뒤 교체(atomic write)해서,
#   빌드가 중간에 죽어도 반쯤 쓰인 파일이 배포되는 일이 없게 했다.
# - 정적 자산 복사 시 하위 폴더가 섞여 있으면 shutil.copyfile이 IsADirectoryError로 빌드
#   전체를 죽이던 문제를 막았다(파일만 복사).
# - [캐시] 정적 자산 주소에 내용 해시를 붙인다(asset_url: app.js → app.js?v=1a2b3c4d5e).
#   GitHub Pages는 정적 파일을 약 10분간 캐시하므로, 배포 직후 "새 index.html + 옛 app.js"
#   조합을 받는 사용자가 생길 수 있었다. 파일 내용이 바뀌면 주소 자체가 바뀌므로 이런 불일치가
#   생기지 않고, 반대로 안 바뀐 파일은 브라우저 캐시를 그대로 재사용한다.

TEMPLATE_DIR = 'templates'
STATIC_SRC = os.path.join(TEMPLATE_DIR, 'assets')
STATIC_TREE_SRC = os.path.join(TEMPLATE_DIR, 'static')
OUT_DIR = 'docs'
# 메뉴/방송통계 표시 설정은 이제 Supabase site_config에서 런타임에 직접 읽는다.

# ----- 페이지 구성 -----
# [구조 변경] 예전엔 index.html 하나(SPA)였다. 이제 메뉴마다 실제 페이지를 만든다:
#   docs/index.html(홈), docs/schedule/index.html, docs/members/index.html, ...
# 각 페이지는 templates/pages/<id>.html이 templates/base.html(공통 머리/메뉴)을 상속한다.
# 메뉴를 추가하려면 여기 한 줄 + templates/pages/<id>.html + (필요하면) page-<id>.js만 만들면 된다.
# (id, 메뉴 이름, 페이지 제목(None이면 사이트 이름만), 검색/링크 미리보기 설명)
PAGES = [
    ('home', '홈', None, '캄몬스타즈 멤버들의 방송·공지·일정·전적을 한곳에서 보는 스타대학입니다'),
    ('schedule', '일정', '일정', '캄몬스타즈의 다가올 일정과 지나간 일정입니다'),
    ('members', '멤버', '멤버', '캄몬스타즈 멤버들의 현황과 소식입니다'),
    ('records', '전적', '전적', '캄몬스타즈 소속으로 참가한 대회 · 대학 · 미니 · CK 전적입니다'),
    # 티어표는 우리 팀이 아니라 스타 커뮤니티 전체를 보여주는 페이지다. 명단은 Supabase에서
    # 명단은 브라우저가 Supabase tier_members를, 방송 중 여부는 live_broadcasts_current를 직접 읽는다.
    ('tier', '티어표', '티어표', '스타 커뮤니티 전체 티어표입니다. 지금 방송 중인 인원을 함께 보여줍니다'),
    # 영상은 ststat가 Supabase에 동기화하고 브라우저가 직접 읽는다.
    ('video', '영상', '영상', '캄몬스타즈 팬 유튜브 채널의 최신 영상과 추천 영상입니다'),
    ('stats', '방송통계', '방송통계', '캄몬스타즈 멤버들의 이번 달 방송 통계입니다'),
    ('tools', '도구', '도구', '자주 쓰는 도구 모음입니다'),
]
SITE_NAME = '스타대학'
# 대표 주소(검색엔진 대표 URL, 링크 미리보기 이미지 주소에 쓰임 - 절대 주소여야 한다).
# 다른 주소로 배포하면 워크플로 환경변수 SITE_URL로 바꾸면 된다(끝의 / 없이).
SITE_URL = os.environ.get('SITE_URL', 'https://ststats.github.io/staruniv').rstrip('/')
# 링크 미리보기 이미지: 페이지마다 1200×630 PNG(scripts/make_share_images.py로 만들어 저장소에 둔다).
# 카카오톡은 webp 미리보기를 제대로 못 보여 줘서 PNG로 둔다.
def og_image_path(page_id):
    return f'images/share/{page_id}.png'

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
        'og_image_url': f'{SITE_URL}/{quote(og_image_path(page_id))}',
        # 상단 메뉴에서 '홈'은 뺀다 - 왼쪽 로고가 홈 링크라(base.html) 중복이고, 메뉴 칸도
        # 아낀다. 홈 페이지 자체는 PAGES에 그대로 있으니 계속 생성된다.
        # 숨긴 메뉴도 마크업에는 남기고 hidden 속성만 붙인다 - core.js가 런타임에
        # Supabase 설정으로 런타임에 바로 숨기거나 다시 표시할 수 있어야 하기 때문(지워버리면 불가능).
        'nav_items': [{'id': pid, 'label': label, 'href': page_url_path(pid) or './',
                       'hidden': pid in hidden_nav_ids}
                      for pid, label, _, _ in PAGES if pid != 'home'],
        # 방송통계 지표 탭도 메뉴와 같은 방식이다: 마크업에는 남기고 hidden만 붙인다
        # (core.js가 런타임에 Supabase 설정을 읽어 되살릴 수 있어야 한다).
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


# 여러 파일을 이어 붙여 하나로 내보내는 자산. 공개 CSS는 섹션별 파일(templates/assets/style/NN-이름.css)을
# 이름 순서대로 합쳐 docs/style.css로 낸다 - 순서가 곧 우선순위(cascade)이니 번호를 바꿀 때 주의.
BUNDLES = {'style.css': 'style'}


def bundle_text(name):
    folder = os.path.join(STATIC_SRC, BUNDLES[name])
    parts = []
    for filename in sorted(os.listdir(folder)):
        if filename.endswith('.css'):
            with open(os.path.join(folder, filename), encoding='utf-8', newline='') as f:
                parts.append(f.read())
    return ''.join(parts)


def static_asset_versions():
    """templates/assets/ 안 파일별 버전. 템플릿의 asset_url()이 이 값을 쓴다."""
    versions = {name: content_version(bundle_text(name)) for name in BUNDLES}
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
    import json
    with open('data/render_stats.json', 'r', encoding='utf-8') as f:
        return json.load(f)


STATIC_OWNED_DIRS = {'images'}


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
    for name in BUNDLES:
        write_text_atomic(os.path.join(OUT_DIR, name), bundle_text(name), newline='')
        copied.append(name)
    print(f"✅ 정적 자산 {copied} 을(를) docs/로 복사했습니다.")
    if os.path.isdir(STATIC_TREE_SRC):
        for name in sorted(os.listdir(STATIC_TREE_SRC)):
            source = os.path.join(STATIC_TREE_SRC, name)
            target = os.path.join(OUT_DIR, name)
            if os.path.isdir(source):
                os.makedirs(target, exist_ok=True)
                # 원본에 없는 파일을 지우는 건 통째로 templates/static 소유인 폴더(images)만이다.
                # data처럼 빌드가 다른 파일(site_*.json, calendar.png)도 쓰는 폴더는 건드리지 않는다.
                if name in STATIC_OWNED_DIRS:
                    source_files = set(os.listdir(source))
                    for stale in set(os.listdir(target)) - source_files:
                        stale_path = os.path.join(target, stale)
                        if os.path.isfile(stale_path):
                            os.unlink(stale_path)
                shutil.copytree(source, target, dirs_exist_ok=True)
            elif os.path.isfile(source):
                shutil.copyfile(source, target)
        print(f"✅ 정적 폴더를 templates/static에서 docs/로 동기화했습니다.")


def write_search_files():
    """검색엔진용 sitemap.xml·robots.txt. 관리자 화면(admin*.html)은 검색에 안 나오게 막는다.
    GitHub Pages 프로젝트 주소(/staruniv/)의 robots.txt는 검색엔진이 읽지 않으므로(도메인 맨 위만 읽는다)
    관리자 화면에는 base.html의 noindex도 함께 붙인다. robots.txt는 Vercel 주소에서 쓰인다."""
    today = datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d')
    urls = ''.join(
        f'  <url><loc>{SITE_URL}/{page_url_path(page_id)}</loc><lastmod>{today}</lastmod></url>\n'
        for page_id, *_ in PAGES)
    write_text_atomic(os.path.join(OUT_DIR, 'sitemap.xml'),
                      '<?xml version="1.0" encoding="UTF-8"?>\n'
                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '</urlset>\n')
    write_text_atomic(os.path.join(OUT_DIR, 'robots.txt'),
                      'User-agent: *\nDisallow: /admin\nDisallow: /staruniv/admin\n'
                      f'Sitemap: {SITE_URL}/sitemap.xml\n')


def main():
    stats_data = load_inputs()

    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    versions = static_asset_versions()
    env.globals['asset_url'] = make_asset_url(versions)
    common = {'crew_stats': stats_data['crew_stats']}

    os.makedirs(os.path.join(OUT_DIR, 'data'), exist_ok=True)
    # 메뉴·방송통계 탭 숨김은 런타임에 core.js가 Supabase 설정으로 처리하므로 빌드는 모두 표시한다
    for page_id, _, title, description in PAGES:
        html_output = env.get_template(f'pages/{page_id}.html').render(
            **common, **page_context(page_id, title, description))
        out_path = page_output_path(page_id)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        write_text_atomic(out_path, html_output)
        admin_context = page_context(page_id, title, description)
        admin_context.update(admin_mode=True, root='', public_href=page_url_path(page_id) or './')
        for nav in admin_context['nav_items']:
            nav['href'] = f"admin-{nav['id']}.html"
        admin_output = env.get_template(f'pages/{page_id}.html').render(**common, **admin_context)
        admin_name = 'admin.html' if page_id == 'home' else f'admin-{page_id}.html'
        write_text_atomic(os.path.join(OUT_DIR, admin_name), admin_output)
    print(f"✅ 페이지 {len(PAGES)}개 생성: {', '.join(page_output_path(p[0]) for p in PAGES)}")
    write_search_files()

    copy_static_assets()
    # 독립 관리자/멀티뷰어/캄몬라이더도 docs를 직접 원본으로 두지 않는다.
    # templates/standalone을 소스로 관리하고 빌드 때 docs로 복사한 뒤 자산 버전을 붙인다.
    standalone_src_dir = os.path.join(TEMPLATE_DIR, 'standalone')
    for filename in ('multiview.html', 'calmmon-rider.html'):
        source = os.path.join(standalone_src_dir, filename)
        standalone = os.path.join(OUT_DIR, filename)
        if os.path.isfile(source):
            shutil.copyfile(source, standalone)
        elif not os.path.isfile(standalone):
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
