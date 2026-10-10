"""입력: 티어표 이미지와 DB 명단."""

import io
import os
import re
import urllib.request

from PIL import Image


def load_image(src: str) -> Image.Image:
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={
            'User-Agent': 'Mozilla/5.0 (StarUniv tier-table reader)',
            'Referer': 'https://www.fmkorea.com/'})
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read()
        return Image.open(io.BytesIO(data)).convert('RGB')
    return Image.open(src).convert('RGB')


def db_connect():
    """휴면 선수까지 봐야 해서 공개 읽기 함수 대신 DB에 직접 연결한다(anon은 표 권한이 없다)."""
    import psycopg
    dsn = os.environ.get('SUPABASE_DB_URL')
    if not dsn:
        raise SystemExit('SUPABASE_DB_URL 환경변수가 필요합니다')
    return psycopg.connect(dsn, autocommit=True)


def load_db(conn):
    """티어표 선수 명단 전체(휴면 포함)."""
    cur = conn.execute('select id, nickname, soop_id, race, tier, affiliation from public.tier_members')
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_off_board(conn) -> set:
    return {row[0] for row in conn.execute('select team_name from public.teams where off_board').fetchall()}


def load_candidates(conn):
    """EloBoard에는 있고 우리 명단엔 없는 선수(ststat이 모은다)."""
    cur = conn.execute("select elo_id, nickname, soop_id, race, tier, affiliation, gender from public.tier_member_candidates "
                       "where status = 'pending' and elo_id is not null")
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]
