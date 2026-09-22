"""현재 data/db.json을 Supabase PostgreSQL에 한 번에 초기 적재한다.

필수 환경변수:
  SUPABASE_DB_URL=postgresql://...

기본 실행은 사이트 핵심 데이터(db.json)만 이전한다.
ELO까지 이전하려면 --include-elo 를 추가한다.

예:
  python scripts/migrate_to_supabase.py --dry-run
  python scripts/migrate_to_supabase.py
  python scripts/migrate_to_supabase.py --include-elo
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from supabase_data import ELO_COLUMNS, TABLE_COLUMNS, db_rows, elo_rows

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
ELO_PATH = ROOT / "data" / "eloboard.json"


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def copy_replace(cur, table, columns, rows):
    from psycopg import sql
    """한 테이블을 트랜잭션 안에서 통째로 교체한다."""
    cur.execute(sql.SQL("truncate table {} restart identity cascade").format(sql.Identifier(table)))
    if not rows:
        return
    stmt = sql.SQL("copy {} ({}) from stdin").format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, columns)),
    )
    with cur.copy(stmt) as cp:
        for row in rows:
            cp.write_row(row)


def validate(rows):
    # FK 때문에 rounds의 match_no는 matches에 반드시 존재해야 한다.
    match_nos = {r[0] for r in rows["matches"]}
    missing = sorted({r[1] for r in rows["rounds"] if r[1] not in match_nos})
    if missing:
        raise ValueError(f"rounds에 matches에 없는 매치 번호가 있습니다: {missing[:20]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-elo", action="store_true", help="data/eloboard.json도 함께 이전")
    ap.add_argument("--dry-run", action="store_true", help="DB에 쓰지 않고 변환 결과/정합성만 검사")
    args = ap.parse_args()

    db = load_json(DB_PATH)
    rows = db_rows(db)
    validate(rows)

    # 사용자가 요청한 정리 규칙을 눈에 보이게 알려준다.
    raw_birth = [r.get("생년월일") for r in db.get("tierMembers", [])]
    invalid_birth = sum(1 for v in raw_birth if v not in ("", None) and str(v).strip() and not _is_iso_date(v))

    print("=== 핵심 데이터 변환 결과 ===")
    for table in TABLE_COLUMNS:
        print(f"{table:14s} {len(rows[table]):>8,}행")
    print(f"tier_members 생년월일 비정상값 -> NULL: {invalid_birth:,}건")

    elo = None
    elo_data = None
    if args.include_elo:
        if not ELO_PATH.exists():
            raise FileNotFoundError(f"{ELO_PATH} 가 없습니다.")
        elo = load_json(ELO_PATH)
        elo_data = elo_rows(elo)
        print("\n=== ELO 변환 결과 ===")
        for table in ELO_COLUMNS:
            print(f"{table:14s} {len(elo_data[table]):>8,}행")

    if args.dry_run:
        print("\n✅ dry-run 완료: DB에는 아무것도 쓰지 않았습니다.")
        return

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다. Supabase의 PostgreSQL connection string을 넣어주세요.")

    import psycopg

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            # FK 순서: rounds를 먼저 지우면 matches 교체 시 안전하다.
            cur.execute("truncate table public.rounds restart identity")
            cur.execute("truncate table public.matches restart identity cascade")

            # matches/rounds는 위에서 비웠으므로 COPY만 한다.
            for table in ("settings", "teams", "members", "tier_members"):
                copy_replace(cur, table, TABLE_COLUMNS[table], rows[table])
            copy_rows(cur, "matches", TABLE_COLUMNS["matches"], rows["matches"])
            copy_rows(cur, "rounds", TABLE_COLUMNS["rounds"], rows["rounds"])

            if elo_data is not None:
                # ELO FK 순서상 match 먼저 비우고 차원 테이블을 교체한다.
                cur.execute("truncate table public.elo_matches")
                for table in ("elo_categories", "elo_maps", "elo_players"):
                    copy_replace(cur, table, ELO_COLUMNS[table], elo_data[table])
                copy_rows(cur, "elo_matches", ELO_COLUMNS["elo_matches"], elo_data["elo_matches"])

        # with 블록 정상 종료 시 commit

    print("\n✅ Supabase 초기 이전 완료")


def copy_rows(cur, table, columns, rows):
    from psycopg import sql
    if not rows:
        return
    stmt = sql.SQL("copy {} ({}) from stdin").format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, columns)),
    )
    with cur.copy(stmt) as cp:
        for row in rows:
            cp.write_row(row)


def _is_iso_date(value):
    from datetime import date
    try:
        date.fromisoformat(str(value).strip())
        return True
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    main()
