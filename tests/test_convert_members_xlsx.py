from datetime import datetime

from convert_members_xlsx import clean, format_date, parse_date_for_xlsx, core, resolve_conflict


class TestClean:
    def test_placeholder_strings_become_none(self):
        for placeholder in ["체크", "TODO", "todo", "?", "미정", "", "null", "NULL", "None", "n/a"]:
            assert clean(placeholder) is None, f"{placeholder!r}가 None이 아님"

    def test_placeholder_with_surrounding_whitespace(self):
        assert clean("  null  ") is None

    def test_real_value_passes_through(self):
        assert clean("테란") == "테란"

    def test_non_string_passes_through(self):
        # 숫자/None 등 문자열이 아닌 값은 애초에 플레이스홀더 판정 대상이 아니다
        assert clean(3) == 3
        assert clean(None) is None


class TestFormatDate:
    def test_datetime_converts_to_iso_string(self):
        assert format_date(datetime(1992, 6, 15)) == "1992-06-15"

    def test_none_stays_none(self):
        assert format_date(None) is None

    def test_placeholder_string_becomes_none(self):
        assert format_date("체크") is None
        assert format_date("null") is None

    def test_iso_string_passes_through(self):
        assert format_date("1992-06-15") == "1992-06-15"


class TestParseDateForXlsx:
    def test_valid_iso_string_becomes_datetime(self):
        result = parse_date_for_xlsx("1992-06-15")
        assert result == datetime(1992, 6, 15)

    def test_none_becomes_none(self):
        assert parse_date_for_xlsx(None) is None

    def test_empty_string_becomes_none(self):
        assert parse_date_for_xlsx("") is None

    def test_malformed_string_becomes_none_not_exception(self):
        # 형식이 안 맞아도 예외로 스크립트가 죽으면 안 되고, 그냥 빈 칸으로
        # 남겨야 한다(엑셀 새 행 추가 로직이 이 값을 그대로 셀에 넣으므로).
        assert parse_date_for_xlsx("잘못된날짜") is None


class TestCore:
    def test_extracts_only_core_fields(self):
        fields = {
            "nickname": "홍길동", "elo_id": 1, "birthdate": "2000-01-01",
            "gender": "m", "race": "테란", "tier": "갓", "team": "JSA", "role": "",
            "info_updated_at": "2026-01-01",  # core에는 안 들어가야 함
            "sponsor_wins": 5,  # core가 아닌 필드가 섞여 들어와도 무시돼야 함
        }
        result = core(fields)
        assert "info_updated_at" not in result
        assert "sponsor_wins" not in result
        assert result["nickname"] == "홍길동"
        assert result["team"] == "JSA"

    def test_missing_field_becomes_none(self):
        result = core({"nickname": "홍길동"})
        assert result["team"] is None


class TestResolveConflict:
    """xlsx<->json 3-way 병합의 핵심 - 어느 쪽이 이기는지 판단하는 로직."""

    FIELDS_A = {"nickname": "A", "team": "T1"}
    FIELDS_B = {"nickname": "B", "team": "T2"}

    def test_no_baseline_first_run_xlsx_wins(self):
        # 스냅샷이 아예 없는 첫 실행 - 하위 호환으로 xlsx가 기본 채택돼야 한다
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_B, None)
        assert winner == self.FIELDS_A
        assert is_conflict is False

    def test_neither_changed_xlsx_wins_no_conflict(self):
        # 둘 다 baseline이랑 똑같음 -> 아무것도 안 바뀐 상태, 충돌 아님
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_A, self.FIELDS_A)
        assert winner == self.FIELDS_A
        assert is_conflict is False

    def test_only_xlsx_changed_xlsx_wins(self):
        # baseline == json이지만 xlsx만 달라짐 -> xlsx가 이김 (엑셀에서 직접 고친 경우)
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_B, self.FIELDS_B)
        assert winner == self.FIELDS_A
        assert is_conflict is False

    def test_only_json_changed_json_wins(self):
        # baseline == xlsx이지만 json만 달라짐 -> json이 이김 (admin.html에서 고친 경우)
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_B, self.FIELDS_A)
        assert winner == self.FIELDS_B
        assert is_conflict is False

    def test_both_changed_differently_is_conflict_xlsx_wins(self):
        # 둘 다 baseline이랑 다르고, 서로도 다름 -> 충돌. xlsx를 기본 채택하되
        # is_conflict=True로 호출부가 경고를 남길 수 있게 한다.
        baseline = {"nickname": "OLD", "team": "T0"}
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_B, baseline)
        assert winner == self.FIELDS_A
        assert is_conflict is True

    def test_both_changed_to_same_value_no_conflict(self):
        # 둘 다 baseline이랑 다르지만, 서로는 같은 값으로 수렴 -> 충돌 아님
        baseline = {"nickname": "OLD", "team": "T0"}
        winner, is_conflict = resolve_conflict(self.FIELDS_A, self.FIELDS_A, baseline)
        assert winner == self.FIELDS_A
        assert is_conflict is False
