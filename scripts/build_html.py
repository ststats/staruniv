import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

from jinja2 import Environment, FileSystemLoader

# 템플릿으로 docs/ 정적 페이지를 만든다.
# 자산 주소에 내용 해시(?v=)를 붙인다 - Pages 캐시(약 10분) 동안 새 HTML과 이전 JS가 섞이지 않게.

TEMPLATE_DIR = 'templates'
STATIC_SRC = os.path.join(TEMPLATE_DIR, 'assets')
STATIC_TREE_SRC = os.path.join(TEMPLATE_DIR, 'static')
OUT_DIR = 'docs'
# preconnect용. 로컬 빌드처럼 SUPABASE_URL이 없으면 태그를 넣지 않는다.
_supabase = urlsplit((os.environ.get('SUPABASE_URL') or '').strip())
SUPABASE_ORIGIN = f'https://{_supabase.netloc}' if _supabase.scheme == 'https' and _supabase.netloc else ''

# ----- 페이지 구성 -----
# (id, 메뉴 이름, 페이지 제목(None이면 사이트 이름만), 검색/링크 미리보기 설명)
PAGES = [
    ('home', '홈', None, '캄몬스타즈 멤버들의 방송·공지·일정·전적을 한곳에서 보는 스타대학입니다'),
    ('schedule', '일정', '일정', '캄몬스타즈의 다가올 일정과 지나간 일정입니다'),
    ('members', '멤버', '멤버', '캄몬스타즈 멤버들의 현황과 소식입니다'),
    ('records', '전적', '전적', '캄몬스타즈 소속으로 참가한 대회 · 대학 · 미니 · CK 전적입니다'),
    ('tier', '티어표', '티어표', '스타 커뮤니티 전체 티어표입니다. 지금 방송 중인 인원을 함께 보여줍니다'),
    ('video', '영상', '영상', '캄몬스타즈 팬 유튜브 채널의 최신 영상과 추천 영상입니다'),
    ('stats', '방송통계', '방송통계', '캄몬스타즈 멤버들의 이번 달 방송 통계입니다'),
    ('tools', '도구', '도구', '자주 쓰는 도구 모음입니다'),
]
SITE_NAME = '스타대학'
# canonical·미리보기 이미지용이라 절대 주소여야 한다(끝의 / 없이).
SITE_URL = os.environ.get('SITE_URL', 'https://ststats.github.io/staruniv').rstrip('/')
# 카카오톡이 webp 미리보기를 못 보여 줘서 PNG로 둔다.
def og_image_path(page_id):
    return f'images/share/{page_id}.png'

def page_output_path(page_id):
    return os.path.join(OUT_DIR, 'index.html') if page_id == 'home' else os.path.join(OUT_DIR, page_id, 'index.html')


def page_url_path(page_id):
    """사이트 루트 기준 상대 경로('' 또는 'records/')."""
    return '' if page_id == 'home' else f'{page_id}/'


def page_context(page_id, title, description):
    return {
        'page_id': page_id,
        'supabase_origin': SUPABASE_ORIGIN,
        # 하위 폴더 페이지는 <base href="../">로 모든 상대 경로를 사이트 루트 기준으로 맞춘다
        'root': '' if page_id == 'home' else '../',
        'full_title': f'{title} | {SITE_NAME}' if title else SITE_NAME,
        'description': description,
        'canonical_url': f'{SITE_URL}/{page_url_path(page_id)}',
        'og_image_url': f'{SITE_URL}/{quote(og_image_path(page_id))}',
        # '홈'은 로고가 링크라 메뉴에서 뺀다. 메뉴 숨김은 core.js가 런타임 설정으로 처리한다.
        'nav_items': [{'id': pid, 'label': label, 'href': page_url_path(pid) or './'}
                      for pid, label, _, _ in PAGES if pid != 'home'],
    }


def write_text_atomic(path, text, newline=None):
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8', newline=newline) as f:
        f.write(text)
    os.replace(tmp_path, path)


def content_version(data):
    """캐시 무효화용 버전(내용 해시 앞 10자리)."""
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()[:10]


# 번들 안에서 섹션 파일 번호 순서(=캐스케이드 순서)를 유지한다.
STYLE_SECTIONS = sorted(Path(STATIC_SRC, 'style').glob('*.css'))
BUNDLES = {
    'style-notches.css': ['00-notches.css'],
    'style.css': [p.name for p in STYLE_SECTIONS if int(p.name[:2]) <= 5],
    'style-shared.css': [p.name for p in STYLE_SECTIONS if 14 <= int(p.name[:2]) <= 17 or p.name.startswith('19-')],
    **{f'style-{p.stem[3:]}.css': [p.name] for p in STYLE_SECTIONS if 6 <= int(p.name[:2]) <= 13 or p.name.startswith('18-')},
}
PAGE_STYLES = {
    'home': ['home'], 'members': ['home', 'members'], 'schedule': ['schedule'],
    'records': ['records'], 'tier': ['tools-entry'], 'video': ['video'],
    'stats': ['stats'], 'tools': ['tools'],
}


def page_styles(page_id):
    wanted = {f'style-{name}.css' for name in PAGE_STYLES[page_id]} | {'style-tier.css'}
    middle = [name for name in BUNDLES if name in wanted and name != 'style-tools-entry.css']
    return ['style.css', *middle, 'style-shared.css', *(['style-tools-entry.css'] if page_id == 'tier' else [])]


def bundle_text(name):
    folder = os.path.join(STATIC_SRC, 'style')
    parts = []
    for filename in BUNDLES[name]:
        with open(os.path.join(folder, filename), encoding='utf-8', newline='') as f:
            parts.append(f.read())
    return ''.join(parts)


def static_asset_versions():
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
            # 조용한 404 대신 빌드 로그에 드러나게 한다
            print(f"⚠️ asset_url: templates/assets/{filename} 파일이 없습니다. 버전 없이 출력합니다.")
            return filename
        return f"{filename}?v={version}"
    return asset_url


def standalone_html(versions):
    pages = {}
    standalone_src_dir = os.path.join(TEMPLATE_DIR, 'standalone')
    for filename in ('multiview.html', 'calmmon-rider.html', 'webp-maker.html'):
        source = os.path.join(standalone_src_dir, filename)
        with open(source, encoding='utf-8') as f:
            html = f.read()
        for asset, version in versions.items():
            html = re.sub(r'((?:src|href)=")' + re.escape(asset) + r'(?:\?v=[a-f0-9]+)?"',
                          lambda match: f'{match.group(1)}{asset}?v={version}"', html)
        pages[filename] = html
    return pages


def copy_static_assets():
    """정적 자산을 복사하고, 목록에서 빠졌고 손대지 않은 이전 생성 파일만 지운다."""
    output = Path(OUT_DIR).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / '.static-assets.json'
    previous = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    if not isinstance(previous, dict):
        raise ValueError('정적 자산 생성 목록 형식이 올바르지 않습니다')

    def target_path(name):
        target = (output / name).resolve()
        if not target.is_relative_to(output) or target == output or target == manifest:
            raise ValueError(f'출력 폴더 밖이거나 예약된 정적 자산 경로: {name}')
        return target

    # 목록이 잘못됐으면 아무것도 쓰기 전에 멈춘다.
    for name in previous:
        target_path(name)
    sources = {p.name: p for p in sorted(Path(STATIC_SRC).glob('*')) if p.is_file()}
    for name in BUNDLES:
        sources[name] = bundle_text(name).encode('utf-8')
    tree = Path(STATIC_TREE_SRC)
    sources.update({p.relative_to(tree).as_posix(): p for p in sorted(tree.rglob('*')) if p.is_file()})
    # 404는 아무 깊이의 경로에서 뜨므로 상대 경로 CSS 대신 노치 토큰을 인라인한다.
    if '404.html' in sources:
        sources['404.html'] = sources['404.html'].read_text(encoding='utf-8').replace(
            '/* SHARED_NOTCH_TOKENS */', bundle_text('style-notches.css')).encode('utf-8')
    targets = {name: target_path(name) for name in sources}
    current = {}
    for name, source in sources.items():
        target = targets[name]
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=f'.{target.name}.', suffix='.tmp', delete=False) as handle:
            temp = Path(handle.name)
        try:
            if isinstance(source, Path):
                shutil.copyfile(source, temp)
            else:
                temp.write_bytes(source)
            with temp.open('rb') as handle:
                current[name] = hashlib.file_digest(handle, 'sha256').hexdigest()
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
    for name in previous.keys() - current.keys():
        stale = target_path(name)
        if not stale.is_file():
            continue
        with stale.open('rb') as handle:
            unchanged = hashlib.file_digest(handle, 'sha256').hexdigest() == previous[name]
        if not unchanged:
            print(f'⚠️ 수동 변경된 이전 생성 파일을 보존합니다: {name}')
            continue
        stale.unlink()
        parent = stale.parent
        while parent != output and parent.is_relative_to(output):
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    write_text_atomic(str(manifest), json.dumps(current, ensure_ascii=False, sort_keys=True), newline='')
    print(f'✅ 정적 자산 {len(current)}개를 생성 목록 기준으로 동기화했습니다.')


def write_search_files():
    """sitemap.xml·robots.txt. Pages 하위 경로의 robots.txt는 읽히지 않아 관리자 화면은 noindex도 붙인다."""
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


def nav_config_default():
    """export_supabase.py가 받아 둔 메뉴 설정 JSON. 없으면 ''(브라우저가 받을 때까지 기다린다)."""
    path = os.path.join('data', 'nav_config.json')
    if not os.path.exists(path):
        return ''
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return ''
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')) if isinstance(data, dict) else ''


def site_data_version():
    """데이터 파일별 내용 해시('records:ab12…'). api.js가 주소에 붙여 바뀐 파일만 새로 받는다."""
    parts = []
    for part in ('records',):
        path = os.path.join(OUT_DIR, 'data', f'site_{part}_v2.json')
        if os.path.exists(path):
            with open(path, 'rb') as f:
                parts.append(f'{part}:{content_version(f.read())}')
    return ','.join(parts)


def main():
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    versions = static_asset_versions()
    env.globals['asset_url'] = make_asset_url(versions)
    env.globals['page_styles'] = page_styles
    standalone_pages = standalone_html(versions)
    # iframe 주소에도 해시를 붙여 vercel.json의 1년 캐시를 쓴다.
    rider_html = standalone_pages.get('calmmon-rider.html')
    env.globals['rider_url'] = ('calmmon-rider.html?v=' + content_version(rider_html.encode('utf-8'))
                                if rider_html is not None else 'calmmon-rider.html')
    webp_html = standalone_pages.get('webp-maker.html')
    env.globals['webp_url'] = ('webp-maker.html?v=' + content_version(webp_html.encode('utf-8'))
                               if webp_html is not None else 'webp-maker.html')

    os.makedirs(os.path.join(OUT_DIR, 'data'), exist_ok=True)
    env.globals['site_data_version'] = site_data_version()
    env.globals['nav_config_default'] = nav_config_default()
    for page_id, _, title, description in PAGES:
        html_output = env.get_template(f'pages/{page_id}.html').render(
            **page_context(page_id, title, description))
        out_path = page_output_path(page_id)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        write_text_atomic(out_path, html_output)
        admin_context = page_context(page_id, title, description)
        admin_context.update(admin_mode=True, root='', public_href=page_url_path(page_id) or './')
        for nav in admin_context['nav_items']:
            nav['href'] = f"admin-{nav['id']}.html"
        admin_output = env.get_template(f'pages/{page_id}.html').render(**admin_context)
        admin_name = 'admin.html' if page_id == 'home' else f'admin-{page_id}.html'
        write_text_atomic(os.path.join(OUT_DIR, admin_name), admin_output)
    print(f"✅ 페이지 {len(PAGES)}개 생성: {', '.join(page_output_path(p[0]) for p in PAGES)}")
    write_search_files()

    copy_static_assets()
    for filename, html in standalone_pages.items():
        write_text_atomic(os.path.join(OUT_DIR, filename), html)
    print("✅ 성공적으로 화이트&블루 통합 웹페이지가 구워졌습니다!")


if __name__ == '__main__':
    main()
