import os, json
from jinja2 import Environment, FileSystemLoader

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates_dir = os.path.join(base_dir, 'templates')
docs_dir = os.path.join(base_dir, 'docs')

env = Environment(loader=FileSystemLoader(templates_dir))

with open(os.path.join(base_dir, 'data', 'site_data.json'), 'r', encoding='utf-8') as f:
    site_data = json.load(f)

pages = [
    ('pages/home.html', 'index.html'),
    ('pages/schedule.html', 'schedule/index.html'),
    ('pages/members.html', 'members/index.html'),
    ('pages/records.html', 'records/index.html'),
    ('pages/stats.html', 'stats/index.html'),
    ('pages/tier.html', 'tier/index.html'),
    ('pages/tools.html', 'tools/index.html'),
]

for tpl_name, out_name in pages:
    tpl = env.get_template(tpl_name)
    rendered = tpl.render(site=site_data)
    out_path = os.path.join(docs_dir, out_name)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(rendered)
    print(f"Rendered: {out_name}")
