"""Actions 작업 모드: tier_update_jobs에서 요청을 읽고 결과를 쓴다(SUPABASE_DB_URL)."""

import sys

from PIL import Image

from .cards import read_image
from .compare import compare
from .fa import read_fa_text
from .memory import MEMORY_PATH, learn, load_memory
from .sources import db_connect, load_candidates, load_db, load_image, load_off_board


# name_feat·name_read까지 기억해야 늘 틀리게 읽히는 닉네임이 매번 '닉네임 변경'으로 뜨지 않는다.
PHOTO_COLS = ('soop_id', 'nickname', 'hash', 'tier', 'race', 'tier_feat', 'race_feat', 'name_read', 'name_feat')


def load_memory_sql(conn):
    """DB의 기억을 읽는다. 비어 있으면 저장소의 기억 파일로 채운다."""
    memory = {'tier': [], 'race': [], 'photos': []}
    for kind, value, feat, bg in conn.execute('select kind, value, feat, bg from public.tier_memory_glyphs order by id'):
        memory[kind].append({'value': value, 'feat': feat, 'bg': bg})
    cur = conn.execute(f'select {", ".join(PHOTO_COLS)} from public.tier_memory_photos order by id')
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
    with conn.transaction(), conn.cursor() as c:
        c.execute('delete from public.tier_memory_glyphs')
        c.execute('delete from public.tier_memory_photos')
        c.executemany('insert into public.tier_memory_glyphs (kind, value, feat, bg) values (%s, %s, %s, %s)',
                      [(k, t['value'], t['feat'], t.get('bg')) for k in ('tier', 'race') for t in memory[k]])
        c.executemany(f'insert into public.tier_memory_photos ({", ".join(PHOTO_COLS)}) '
                      f'values ({", ".join(["%s"] * len(PHOTO_COLS))})',
                      [tuple(p.get(k) for k in PHOTO_COLS) for p in memory['photos']])


def learn_applied(conn, memory):
    """관리자가 반영한 작업의 확인된 카드를 기억에 더하고 배운 작업 수를 돌려준다."""
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


KEEP_RESULTS = 5   # 결과는 작업당 약 1.6MB라 최근 몇 개만 남긴다


def prune_results(conn):
    """학습이 끝났거나 실패했거나 한 달 넘게 반영하지 않은 작업의 결과를 비운다(applied는 남는다)."""
    cur = conn.execute('update public.tier_update_jobs set result = null '
                       'where result is not null and id not in '
                       '(select id from public.tier_update_jobs order by id desc limit %s) '
                       "and (learned_at is not null or status = 'failed' "
                       "or (status = 'done' and created_at < now() - interval '30 days'))", (KEEP_RESULTS,))
    if cur.rowcount:
        print(f'오래된 분석 결과 {cur.rowcount}개를 비움', file=sys.stderr)


def run_job(job_id: int):
    with db_connect() as conn:
        _run_job(conn, job_id)


def _run_job(conn, job_id: int):
    from psycopg.types.json import Jsonb
    row = conn.execute('select * from public.claim_tier_analysis(%s)', (job_id,)).fetchone()
    if not row:
        raise SystemExit(f'작업 {job_id}이 없거나 이미 처리 중입니다')
    image_url, fa_text, run_token = row
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
        db = load_db(conn)
        result = compare(sections, fa, db, load_candidates(conn), load_off_board(conn))
        # ±2px 지문은 읽을 때만 쓰므로 저장에서 뺀다
        result['sections'] = [{'y': s['y'], 'cards': [{k: v for k, v in c.items() if k not in ('photo_shifts', 'raw')}
                                                       for c in s['cards']]} for s in sections]
        result['fa'] = fa
        result['image'] = {'url': image_url, 'scale': scale}
        saved = conn.execute('select public.finish_tier_analysis(%s, %s, %s, %s)',
                             (job_id, run_token, Jsonb(result), None)).fetchone()[0]
        if not saved:
            raise RuntimeError('실행권이 만료되었거나 다른 실행으로 교체되어 분석 결과를 저장하지 않았습니다')
        print(f"작업 {job_id}: 카드 {sum(len(s['cards']) for s in sections)}장, 변동 {len(result['changes'])}건, "
              f"확인 {len(result['review'])}건", file=sys.stderr)
    except Exception as e:  # 실패를 관리자 화면에 보이게 작업에 남긴다
        conn.execute('select public.finish_tier_analysis(%s, %s, %s, %s)',
                     (job_id, run_token, None, f'{type(e).__name__}: {e}'[:1000]))
        raise
