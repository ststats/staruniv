import os, json

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates_dir = os.path.join(base_dir, 'templates')
docs_dir = os.path.join(base_dir, 'docs')
data_dir = os.path.join(base_dir, 'data')
docs_data_dir = os.path.join(docs_dir, 'data')

from jinja2 import Environment, FileSystemLoader
env = Environment(loader=FileSystemLoader(templates_dir))

# Jinja2 템플릿 내 asset_url() 함수 및 필터 정의 (UndefinedError 방지)
def asset_url(path):
    if not path:
        return ''
    if path.startswith('http://') or path.startswith('https://'):
        return path
    clean = path.lstrip('/')
    return f"/{clean}"

env.globals['asset_url'] = asset_url
env.filters['asset_url'] = asset_url
env.globals['static_url'] = asset_url
env.globals['url_for'] = lambda endpoint, **values: f"/{values.get('filename', endpoint).lstrip('/')}"

# 데이터 로드 (db.json 우선, 없을 경우 site_data.json)
site_data = {}
db_path = os.path.join(data_dir, 'db.json')
site_data_path = os.path.join(data_dir, 'site_data.json')

if os.path.exists(db_path):
    with open(db_path, 'r', encoding='utf-8') as f:
        site_data = json.load(f)
elif os.path.exists(site_data_path):
    with open(site_data_path, 'r', encoding='utf-8') as f:
        site_data = json.load(f)

# 통계 데이터 로드
stats_data = {}
stats_path = os.path.join(data_dir, 'render_stats.json')
if os.path.exists(stats_path):
    with open(stats_path, 'r', encoding='utf-8') as f:
        stats_data = json.load(f)

pages = [
    ('pages/home.html', 'index.html'),
    ('pages/schedule.html', 'schedule/index.html'),
    ('pages/members.html', 'members/index.html'),
    ('pages/records.html', 'records/index.html'),
    ('pages/stats.html', 'stats/index.html'),
    ('pages/tier.html', 'tier/index.html'),
    ('pages/tools.html', 'tools/index.html'),
    ('pages/multiview.html', 'multiview.html'),
]

for tpl_name, out_name in pages:
    tpl_file = os.path.join(templates_dir, tpl_name)
    if not os.path.exists(tpl_file):
        continue
    tpl = env.get_template(tpl_name)
    rendered = tpl.render(
        site=site_data,
        db=site_data,
        stats=stats_data,
        asset_url=asset_url
    )
    out_path = os.path.join(docs_dir, out_name)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(rendered)
    print(f"Rendered: {out_name}")

# templates/assets 동기화
assets_src = os.path.join(templates_dir, 'assets')
assets_dst = os.path.join(docs_dir, 'assets')
if os.path.exists(assets_src):
    os.makedirs(assets_dst, exist_ok=True)
    for item in os.listdir(assets_src):
        s = os.path.join(assets_src, item)
        if os.path.isfile(s):
            with open(s, 'rb') as rf:
                content = rf.read()
            with open(os.path.join(assets_dst, item), 'wb') as wf:
                wf.write(content)
            with open(os.path.join(docs_dir, item), 'wb') as wf:
                wf.write(content)

# docs/data 동기화
os.makedirs(docs_data_dir, exist_ok=True)
for item in ['site_data.json', 'db.json', 'render_stats.json']:
    src_file = os.path.join(data_dir, item)
    if os.path.exists(src_file):
        with open(src_file, 'rb') as rf:
            content = rf.read()
        with open(os.path.join(docs_data_dir, item), 'wb') as wf:
            wf.write(content)

print("Build completed & all assets/data synchronized successfully.")
