"""올해·내년 한국 공휴일(holidays 라이브러리)을 public.holidays에 source='auto'로 맞춘다.

수동 등록일(source='manual')은 건드리지 않는다. 필수 환경변수: SUPABASE_DB_URL
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import holidays
import psycopg

KST = timezone(timedelta(hours=9))


def korean_holidays(years: list[int]) -> dict[str, str]:
    """{'YYYY-MM-DD': 이름}. 같은 날 이름이 둘이면 '; '로 이어진다."""
    return {day.isoformat(): name for day, name in holidays.KR(years=years, language="ko").items()}


def main() -> None:
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다.")
    this_year = datetime.now(KST).year
    years = [this_year, this_year + 1]
    wanted = korean_holidays(years)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.executemany(
            """insert into public.holidays (day, name, source, updated_at) values (%s, %s, 'auto', now())
               on conflict (day) do update set name = excluded.name, updated_at = now()
               where public.holidays.source = 'auto' and public.holidays.name is distinct from excluded.name""",
            sorted(wanted.items()),
        )
        cur.execute(
            """delete from public.holidays
               where source = 'auto' and extract(year from day)::int = any(%s) and not (day::text = any(%s))""",
            (years, list(wanted)),
        )
        removed = cur.rowcount
    print(f"✅ 공휴일 맞춤: {years[0]}~{years[1]}년 {len(wanted)}일(자동분 중 빠진 날 {removed}일 삭제)")


if __name__ == "__main__":
    main()
