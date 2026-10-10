"""Supabase의 경기·세트를 data/db.json(한글 키)으로, 메뉴 설정을 data/nav_config.json으로 내보낸다.

필수 환경변수: SUPABASE_DB_URL
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "db.json"
# 빌드가 페이지에 기본값으로 넣어 첫 방문도 설정 응답을 기다리지 않게 한다.
NAV_PATH = ROOT / "data" / "nav_config.json"


def empty(value):
    """DB NULL -> 빈 문자열."""
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return value


def fetch(conn, query):
    from psycopg.rows import dict_row
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query)
        return cur.fetchall()


def build_db(matches, rounds):
    """write_site_data.py가 쓰는 칸만 담는다."""
    return {
        "matches": [
            {
                "매치 번호": r["match_no"],
                "날짜": empty(r["match_date"]),
                "상대팀": empty(r["opponent_team"]),
                "형식": empty(r["match_format"]),
                "방식": empty(r["method"]),
                "최종 결과": empty(r["final_result"]),
                "세트 결과": empty(r["set_result"]),
            }
            for r in matches
        ],
        "rounds": [
            {
                "매치 번호": r["match_no"],
                "날짜": empty(r["match_date"]),
                "상대팀": empty(r["opponent_team"]),
                "형식": empty(r["match_format"]),
                "세트": empty(r["set_name"]),
                "라운드": empty(r["round_name"]),
                "우리 선수": empty(r["our_player"]),
                "결과": empty(r["result"]),
                "상대 선수": empty(r["opponent_player"]),
                "상대 종족": empty(r["opponent_race"]),
                "맵": empty(r["map_name"]),
                "_mirrored": bool(r["is_mirrored"]),
            }
            for r in rounds
        ],
    }


def main():
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다.")

    import psycopg

    with psycopg.connect(dsn) as conn:
        # 도중에 경기·라운드가 고쳐져도 섞이지 않게 한 스냅숏에서 읽는다.
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = True
        matches = fetch(conn, "select * from public.matches order by source_order")
        rounds = fetch(conn, "select * from public.rounds_effective order by source_order, is_mirrored")
        nav_rows = fetch(conn, "select config_value from public.site_config where config_key = 'nav'")

    required = {"matches": matches, "rounds": rounds}
    missing = [name for name, rows in required.items() if not rows]
    if missing:
        sys.exit(f"❌ Supabase 테이블이 비어 있습니다: {', '.join(missing)}. 기존 db.json은 건드리지 않습니다.")

    db = build_db(matches, rounds)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, OUTPUT_PATH)

    nav = nav_rows[0]["config_value"] if nav_rows else {}
    NAV_PATH.write_text(json.dumps(nav if isinstance(nav, dict) else {}, ensure_ascii=False), encoding="utf-8")

    print("✅ Supabase -> data/db.json 내보내기 완료")
    for key, rows in db.items():
        print(f"   {key:12s}: {len(rows):,}행")


if __name__ == "__main__":
    main()
