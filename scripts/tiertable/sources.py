"""입력: 티어표 이미지와 DB 명단(공개 읽기)."""

import io
import json
import os
import re
import urllib.request

from PIL import Image

from .layout import ROOT


def load_image(src: str) -> Image.Image:
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={
            'User-Agent': 'Mozilla/5.0 (StarUniv tier-table reader)',
            'Referer': 'https://www.fmkorea.com/'})
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read()
        return Image.open(io.BytesIO(data)).convert('RGB')
    return Image.open(src).convert('RGB')


def supabase_config():
    url, key = os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_PUBLISHABLE_KEY')
    if url and key:
        return url.rstrip('/'), key
    cfg = (ROOT / 'docs' / 'supabase-config.js')
    if cfg.exists():
        text = cfg.read_text(encoding='utf-8')
        u = re.search(r'url:\s*"([^"]+)"', text)
        k = re.search(r'key:\s*"([^"]+)"', text)
        if u and k:
            return u.group(1).rstrip('/'), k.group(1)
    raise SystemExit('SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY가 필요합니다(또는 빌드된 docs/supabase-config.js)')


def load_db():
    url, key = supabase_config()
    rows, offset = [], 0
    while True:
        q = f'{url}/rest/v1/tier_members?select=nickname,soop_id,race,tier,affiliation&order=source_order.asc,soop_id.asc&offset={offset}&limit=1000'
        req = urllib.request.Request(q, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=60) as res:
            batch = json.load(res)
        rows += batch
        if len(batch) < 1000:
            return rows
        offset += 1000
