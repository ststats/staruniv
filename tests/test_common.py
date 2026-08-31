from datetime import datetime

from _common import to_int, last_day_of_month, get_month_date_range


class TestToInt:
    def test_plain_int(self):
        assert to_int(42) == 42

    def test_float_truncates(self):
        assert to_int(3.9) == 3

    def test_none_becomes_zero(self):
        assert to_int(None) == 0

    def test_comma_separated_string(self):
        assert to_int("1,234") == 1234

    def test_string_with_whitespace(self):
        assert to_int("  57  ") == 57

    def test_empty_string_becomes_zero(self):
        assert to_int("") == 0

    def test_garbage_string_becomes_zero(self):
        # 예외로 스크립트 전체가 죽으면 안 되므로, 파싱 불가능한 값은 0으로
        # 안전하게 떨어져야 한다(update_data.py 등이 API 응답의 별풍선/방송시간
        # 필드를 이걸로 변환하는데, 그 값들이 항상 깨끗하다는 보장이 없다).
        assert to_int("모름") == 0

    def test_none_like_string_becomes_zero(self):
        assert to_int("null") == 0


class TestLastDayOfMonth:
    def test_31_day_month(self):
        assert last_day_of_month(2026, 8) == 31

    def test_30_day_month(self):
        assert last_day_of_month(2026, 4) == 30

    def test_february_non_leap_year(self):
        assert last_day_of_month(2026, 2) == 28

    def test_february_leap_year(self):
        assert last_day_of_month(2024, 2) == 29


class TestGetMonthDateRange:
    def test_returns_first_and_last_day_iso_format(self):
        dt = datetime(2026, 8, 15)
        start, end = get_month_date_range(dt)
        assert start == "2026-08-01"
        assert end == "2026-08-31"

    def test_short_month(self):
        dt = datetime(2026, 4, 1)
        start, end = get_month_date_range(dt)
        assert start == "2026-04-01"
        assert end == "2026-04-30"

    def test_format_matches_eloboard_api_comparison_format(self):
        # fetch_eloboard_data.py의 aggregate_period_data()가 API의 played_on
        # 필드와 문자열 비교를 하므로, 대시(-) 포함 ISO 형식이어야 한다
        # ("YYYYMMDD"였던 예전 포맷으로 되돌아가면 그 비교가 조용히 깨진다).
        dt = datetime(2026, 8, 15)
        start, end = get_month_date_range(dt)
        assert "-" in start and "-" in end
        assert len(start) == len(end) == 10
