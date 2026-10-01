"""Actions 작업 모드: tier_update_jobs에서 요청을 읽고 결과를 쓴다(SUPABASE_DB_URL)."""

import os
import sys

from PIL import Image

from .cards import read_image
from .compare import compare
from .fa import read_fa_text
from .memory import MEMORY_PATH, learn, load_memory
from .sources import load_image


def db_connect():
    import psycopg
    dsn = os.environ.get('SUPABASE_DB_URL')
    if not dsn:
        raise SystemExit('SUPABASE_DB_URL 환경변수가 필요합니다')
    return psycopg.connect(dsn, autocommit=True)


def load_db_sql(conn):
    cur = conn.execute('select id, nickname, soop_id, race, tier, affiliation from public.tier_members')
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_off_board_sql(conn) -> set:
    """현황판에 아직 없는 대학(teams.off_board). 칸이 아직 없으면(SQL 적용 전) 빈 집합."""
    has = conn.execute("select 1 from information_schema.columns where table_schema = 'public' "
                       "and table_name = 'teams' and column_name = 'off_board'").fetchone()
    if not has:
        return set()
    return {row[0] for row in conn.execute('select team_name from public.teams where off_board').fetchall()}


def load_candidates_sql(conn):
    """ststat이 모아 둔 ELO 대기 명단(EloBoard에는 있고 우리 명단엔 없는 선수). 표가 없으면 빈 목록."""
    try:
        cur = conn.execute("select elo_id, nickname, soop_id, race, tier, affiliation, gender from public.tier_member_candidates "
                           "where status = 'pending' and elo_id is not null")
    except Exception:
        conn.rollback()
        return []
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


PHOTO_COLS = ('soop_id', 'nickname', 'hash', 'tier', 'race', 'tier_feat', 'race_feat')
PHOTO_NAME_COLS = ('name_read', 'name_feat')


def photo_cols(conn):
    """사진 기억 칸. 닉네임 칸 그림·읽은 글씨(name_feat·name_read)는 SQL 적용 뒤에만 있다 - 없으면 빼고 쓴다.
    예전엔 이 둘을 저장하지 않아 매번 기억이 비어, 늘 틀리게 읽히는 닉네임이 매번 '닉네임 변경'으로 떴다."""
    have = {r[0] for r in conn.execute("select column_name from information_schema.columns where table_schema = 'public' "
                                        "and table_name = 'tier_memory_photos'").fetchall()}
    return PHOTO_COLS + tuple(k for k in PHOTO_NAME_COLS if k in have)


def load_memory_sql(conn):
    """DB의 기억을 읽는다. 처음(비어 있음)이면 저장소의 기억 파일로 채워 넣는다."""
    memory = {'tier': [], 'race': [], 'photos': []}
    for kind, value, feat, bg in conn.execute('select kind, value, feat, bg from public.tier_memory_glyphs order by id'):
        memory[kind].append({'value': value, 'feat': feat, 'bg': bg})
    cur = conn.execute(f'select {", ".join(photo_cols(conn))} from public.tier_memory_photos order by id')
    cols = [c.name for c in cur.description]
    memory['photos'] = [dict(zip(cols, row)) for row in cur.fetchall()]
    if not memory['photos'] and not memory['tier'] and MEMORY_PATH.exists():
        seed = load_memory(MEMORY_PATH)
        with conn.cursor() as c:
            c.executemany('insert into public.tier_memory_glyphs (kind, value, feat, bg) values (%s, %s, %s, %s)',
                          [(k, t['value'], t['feat'], t.get('bg')) for k in ('tier', 'race') for t in seed[k]])
            c.executemany('insert into public.tier_memory_photos (soop_id, nickname, hash, tier, race, tier_feat, race_feat) '
                          'values (%s, %s, %s, %s, %s, %s, %s)',
                          [(p.get('soop_id'), p['nickname'], p['hash'], p.get('tier'), p.get('race'),
                            p.get('tier_feat'), p.get('race_feat')) for p in seed['photos']])
        print(f"기억을 저장소 파일로 처음 채움: 사진 {len(seed['photos'])}", file=sys.stderr)
        return seed
    return memory


def save_memory_sql(conn, memory):
    """기억 전체를 DB에 다시 쓴다(한 트랜잭션)."""
    with conn.transaction(), conn.cursor() as c:
        c.execute('delete from public.tier_memory_glyphs')
        c.execute('delete from public.tier_memory_photos')
        c.executemany('insert into public.tier_memory_glyphs (kind, value, feat, bg) values (%s, %s, %s, %s)',
                      [(k, t['value'], t['feat'], t.get('bg')) for k in ('tier', 'race') for t in memory[k]])
        cols = photo_cols(conn)
        c.executemany(f'insert into public.tier_memory_photos ({", ".join(cols)}) '
                      f'values ({", ".join(["%s"] * len(cols))})',
                      [tuple(p.get(k) for k in cols) for p in memory['photos']])


def learn_applied(conn, memory):
    """관리자가 반영한 작업의 확인된 카드(사진·글씨 ↔ 선수)를 기억에 더한다. 반환: 배운 작업 수."""
    rows = conn.execute('select id, result, applied from public.tier_update_jobs '
                        'where status = %s and learned_at is null order by id', ('applied',)).fetchall()
    for job_id, result, applied in rows:
        sections = (result or {}).get('sections') or []
        confirmed = []
        for c in (applied or {}).get('confirmed') or []:
            si, i = c['ref']
            if si < len(sections) and i < len(sections[si]['cards']) and c.get('nickname'):
                confirmed.append((sections[si]['cards'][i], c))
        learn(memory, confirmed)
        print(f'작업 {job_id}에서 배움: 카드 {len(confirmed)}장', file=sys.stderr)
    if rows:
        save_memory_sql(conn, memory)
        conn.execute('update public.tier_update_jobs set learned_at = now() where id = any(%s)', ([r[0] for r in rows],))
    return len(rows)


KEEP_RESULTS = 5   # 최근 작업 몇 개는 결과(카드 사진·글씨 특징, 작업당 약 1.6MB)를 남긴다


def prune_results(conn):
    """오래된 작업의 분석 결과를 비운다. 반영 기록(applied)은 남는다.
    학습이 끝났거나 실패한 작업, 그리고 한 달 넘게 반영하지 않은 작업만."""
    cur = conn.execute('update public.tier_update_jobs set result = null '
                       'where result is not null and id not in '
                       '(select id from public.tier_update_jobs order by id desc limit %s) '
                       "and (learned_at is not null or status = 'failed' "
                       "or (status = 'done' and created_at < now() - interval '30 days'))", (KEEP_RESULTS,))
    if cur.rowcount:
        print(f'오래된 분석 결과 {cur.rowcount}개를 비움', file=sys.stderr)


def run_job(job_id: int):
    from psycopg.types.json import Jsonb
    conn = db_connect()
    row = conn.execute('update public.tier_update_jobs set status = %s, started_at = now(), error = null '
                       'where id = %s and status in (%s, %s) returning image_url, fa_text',
                       ('running', job_id, 'queued', 'failed')).fetchone()
    if not row:
        raise SystemExit(f'작업 {job_id}이 없거나 이미 처리 중입니다')
    image_url, fa_text = row
    try:
        im = load_image(image_url)
        scale = im.width / 1100
        if im.width != 1100:
            im = im.resize((1100, round(im.height * 1100 / im.width)), Image.LANCZOS)
        memory = load_memory_sql(conn)
        learn_applied(conn, memory)
        prune_results(conn)
        sections = read_image(im, memory)
        fa = read_fa_text(fa_text or '')
        db = load_db_sql(conn)
        result = compare(sections, fa, db, load_candidates_sql(conn), load_off_board_sql(conn))
        # 반영 때 기억할 사진·글씨 특징만 남긴다(±2px 지문 24개는 읽을 때만 쓰므로 뺀다)
        result['sections'] = [{'y': s['y'], 'cards': [{k: v for k, v in c.items() if k not in ('photo_shifts', 'raw')}
                                                       for c in s['cards']]} for s in sections]
        result['fa'] = fa
        result['image'] = {'url': image_url, 'scale': scale}
        conn.execute('update public.tier_update_jobs set status = %s, result = %s, finished_at = now() where id = %s',
                     ('done', Jsonb(result), job_id))
        print(f"작업 {job_id}: 카드 {sum(len(s['cards']) for s in sections)}장, 변동 {len(result['changes'])}건, "
              f"확인 {len(result['review'])}건", file=sys.stderr)
    except Exception as e:  # 실패도 작업에 남겨 관리자 화면에서 보이게
        conn.execute('update public.tier_update_jobs set status = %s, error = %s, finished_at = now() where id = %s',
                     ('failed', f'{type(e).__name__}: {e}'[:1000], job_id))
        raise
