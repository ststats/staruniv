"""Supabase elo_* 테이블을 기존 data/eloboard.json 형식으로 내보낸다.

이 파일은 이제 원본 데이터가 아니라 build_h2h.py/build_ranking.py 호환용 캐시다.
필수 환경변수: SUPABASE_DB_URL
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "eloboard.json"
FETCH_SIZE = 10000
KST = dt.timezone(dt.timedelta(hours=9))


def _fetch_all(conn, query):
    with conn.cursor() as cur:
        cur.execute(query)
        return cur.fetchall()


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main():
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다.")

    import psycopg

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT_PATH.with_suffix(".json.tmp")

    with psycopg.connect(dsn) as conn:
        cat_rows = _fetch_all(
            conn,
            "select category_id, name from public.elo_categories order by category_id",
        )
        map_rows = _fetch_all(
            conn,
            "select map_id, name from public.elo_maps order by map_id",
        )
        player_rows = _fetch_all(
            conn,
            "select elo_id, name, race from public.elo_players order by elo_id",
        )
        with conn.cursor() as cur:
            cur.execute("select count(*), max(elo_match_id) from public.elo_matches")
            count, max_id = cur.fetchone()

        if not count:
            sys.exit("❌ Supabase elo_matches가 비어 있습니다. 기존 data/eloboard.json은 건드리지 않습니다.")

        ids = [int(r[0]) for r in cat_rows]
        expected = list(range(len(ids)))
        if ids != expected:
            sys.exit(
                "❌ elo_categories.category_id가 0부터 연속이어야 합니다. "
                f"현재: {ids[:20]}"
            )

        cats = [str(r[1]) for r in cat_rows]
        maps = {str(r[0]): str(r[1]) for r in map_rows}
        players = {
            str(r[0]): [str(r[1]), str(r[2]) if r[2] else ""]
            for r in player_rows
        }
        synced_at = dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")

        with tmp.open("w", encoding="utf-8", newline="") as f:
            f.write("{")
            f.write('"synced_at":' + _json(synced_at))
            f.write(',"max_id":' + str(int(max_id or 0)))
            f.write(',"count":' + str(int(count)))
            f.write(',"cats":' + _json(cats))
            f.write(',"maps":' + _json(maps))
            f.write(',"players":' + _json(players))
            f.write(',"rows":[')

            first = True
            exported_count = 0
            # 전체 행을 한꺼번에 메모리에 올리지 않고 서버 커서로 끝까지 스트리밍한다.
            with conn.cursor(name="elo_export") as cur:
                cur.execute(
                    """
                    select elo_match_id, match_date, winner_elo_id, loser_elo_id, map_id, category_id
                    from public.elo_matches
                    order by elo_match_id desc
                    """
                )
                while True:
                    batch = cur.fetchmany(FETCH_SIZE)
                    if not batch:
                        break
                    for row in batch:
                        packed = [
                            int(row[0]),
                            row[1].isoformat() if row[1] is not None else "",
                            int(row[2]) if row[2] is not None else None,
                            int(row[3]) if row[3] is not None else None,
                            int(row[4]) if row[4] is not None else None,
                            int(row[5]),
                        ]
                        if not first:
                            f.write(",")
                        f.write(_json(packed))
                        first = False
                        exported_count += 1

            f.write("]}")

    if exported_count != int(count):
        try:
            tmp.unlink(missing_ok=True)
        finally:
            sys.exit(
                "❌ ELO 캐시 검증 실패: "
                f"DB exact count={int(count):,}, streamed={exported_count:,}. 기존 캐시는 유지합니다."
            )

    os.replace(tmp, OUTPUT_PATH)
    size_mb = OUTPUT_PATH.stat().st_size / 1048576
    print("✅ Supabase ELO -> data/eloboard.json 내보내기 완료")
    print(f"   elo_matches : {int(count):,}행 (streamed {exported_count:,}행, 검증 완료)")
    print(f"   elo_players : {len(players):,}명")
    print(f"   elo_maps    : {len(maps):,}개")
    print(f"   categories  : {len(cats):,}개")
    print(f"   max_id      : {int(max_id or 0):,}")
    print(f"   cache size  : {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
