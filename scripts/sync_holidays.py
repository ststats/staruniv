"""올해·내년 한국 공휴일을 public.holidays에 자동으로 맞춘다(정기 빌드가 하루 두 번 돌린다).

공휴일은 파이썬 holidays 라이브러리가 계산한다(음력 명절·대체공휴일·선거일·임시공휴일 중 라이브러리에 들어간 것).
라이브러리가 계산한 날은 source='auto'로 넣고 이름을 맞추며, 그 해의 자동분 중 라이브러리에 없는 날은 지운다.
관리자가 손으로 넣은 날(source='manual', 일정 > 공휴일 관리)은 건드리지 않는다 - 라이브러리에 아직 없는
임시공휴일은 그렇게 더한다. 실패해도 빌드는 계속된다(달력은 DB에 있던 공휴일을 그대로 보여 준다).

필수 환경변수: SUPABASE_DB_URL
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import holidays
import psycopg

KST = timezone(timedelta(hours=9))


def korean_holidays(years: list[int]) -> dict[str, str]:
    """{'YYYY-MM-DD': 이름} - 같은 날에 이름이 둘이면 라이브러리가 '; '로 이어 준다."""
    return {day.isoformat(): name for day, name in holidays.KR(years=years, language="ko").items()}


def main() -> None:
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다.")
    this_year = datetime.now(KST).year
    years = [this_year, this_year + 1]
    wanted = korean_holidays(years)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # 손으로 넣은 날은 자동분으로 바꾸지 않는다(이름도 관리자가 적은 그대로)
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
