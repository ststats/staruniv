"""Apply the browser's least-privilege Supabase read grants.

The migration is idempotent and uses SUPABASE_DB_URL. It grants only the columns
read by the public site; existing authenticated administrator policies are unchanged.
"""
import os
from pathlib import Path

import psycopg


def main():
    dsn = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not dsn:
        raise SystemExit("SUPABASE_DB_URL 환경변수가 필요합니다.")
    sql_path = Path(__file__).resolve().parents[1] / "supabase" / "public_read.sql"
    with psycopg.connect(dsn) as conn:
        conn.execute(sql_path.read_text(encoding="utf-8"))
    print("✅ Supabase 공개 읽기 권한을 적용했습니다.")


if __name__ == "__main__":
    main()

