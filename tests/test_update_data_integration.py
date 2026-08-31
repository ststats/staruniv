"""
update_data.py의 main() 전체 흐름을 실제 파일(임시 디렉터리)로 돌려보는 통합
테스트. 단위 테스트(test_update_data.py)는 개별 함수만 검증하는데, main()이
그 함수들을 실제로 올바른 순서/조합으로 엮어 쓰는지는 여기서 확인한다.

네트워크가 필요한 부분(fetch_poonggo_monthly, aggregate_period_data)은
monkeypatch로 가짜 함수로 바꿔치기해서, 순수하게 오케스트레이션 로직만
검증한다.
"""

import json
import datetime

import update_data


def _members_json(*, id="a1", elo_id=1, nickname="닉네임", team="JSA", broken=False):
    members = [{
        "id": id, "elo_id": elo_id, "nickname": nickname, "birthdate": None,
        "gender": "m", "race": "테란", "tier": "갓", "team": team, "role": "",
        "info_updated_at": None,
    }]
    if broken:
        members.append({"id": "", "nickname": None})  # 스키마 검증에서 걸러져야 함
    return {"members": members}


def _setup(tmp_path, monkeypatch, members_data=None):
    (tmp_path / "data" / "archive").mkdir(parents=True)
    members_path = tmp_path / "data" / "members.json"
    output_path = tmp_path / "data" / "latest.json"
    archive_dir = tmp_path / "data" / "archive"
    applied_path = tmp_path / "data" / "archive_corrections_applied.json"

    with open(members_path, "w", encoding="utf-8") as f:
        json.dump(members_data or _members_json(), f, ensure_ascii=False)

    monkeypatch.setattr(update_data, "MEMBERS_PATH", members_path)
    monkeypatch.setattr(update_data, "OUTPUT_PATH", output_path)
    monkeypatch.setattr(update_data, "ARCHIVE_DIR", archive_dir)
    monkeypatch.setattr(update_data, "APPLIED_CORRECTIONS_PATH", applied_path)

    return members_path, output_path, archive_dir


class TestMainEndToEnd:
    def test_first_run_creates_latest_json(self, tmp_path, monkeypatch):
        """members.json만 있는 첫 실행 - latest.json이 새로 만들어져야 한다."""
        _, output_path, _ = _setup(tmp_path, monkeypatch)

        monkeypatch.setattr(update_data, "fetch_poonggo_monthly",
                             lambda year, month, ids: {"a1": {"balloons": 100, "broadcast_seconds": 10, "cumulative_viewers": 5}})
        monkeypatch.setattr(update_data, "aggregate_period_data",
                             lambda start, end: [{"id": "1", "sponsor_wins": 3, "sponsor_losses": 1}])

        update_data.main()

        assert output_path.exists()
        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert result["members"][0]["id"] == "a1"
        assert result["members"][0]["balloons"] == 100
        assert result["members"][0]["sponsor_wins"] == 3

    def test_broken_member_record_does_not_crash_whole_run(self, tmp_path, monkeypatch):
        """schema 검증 없이 예전 코드였다면 m["nickname"] 직접 인덱싱에서
        죽었을 상황 - 이제는 문제 있는 레코드만 걸러지고 나머지는 정상 처리돼야
        한다."""
        _, output_path, _ = _setup(tmp_path, monkeypatch, members_data=_members_json(broken=True))

        monkeypatch.setattr(update_data, "fetch_poonggo_monthly",
                             lambda year, month, ids: {"a1": {"balloons": 50, "broadcast_seconds": 5, "cumulative_viewers": 2}})
        monkeypatch.setattr(update_data, "aggregate_period_data", lambda start, end: [])

        update_data.main()  # 예외 없이 끝나야 함

        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert len(result["members"]) == 1  # 망가진 레코드는 제외되고 정상 1명만 남음
        assert result["members"][0]["id"] == "a1"

    def test_balloon_fetch_failure_aborts_without_partial_write(self, tmp_path, monkeypatch):
        """별풍선 수집 자체가 실패하면(fetch_poonggo_monthly가 None 반환) latest.json을
        불완전한 상태로 쓰지 않고 종료해야 한다."""
        _, output_path, _ = _setup(tmp_path, monkeypatch)

        monkeypatch.setattr(update_data, "fetch_poonggo_monthly", lambda year, month, ids: None)
        monkeypatch.setattr(update_data, "aggregate_period_data", lambda start, end: [])

        try:
            update_data.main()
            assert False, "SystemExit가 발생했어야 함"
        except SystemExit:
            pass

        assert not output_path.exists()

    def test_date_change_archives_previous_snapshot(self, tmp_path, monkeypatch):
        """latest.json에 어제 날짜가 찍혀있으면, 오늘 실행에서 그 스냅샷이
        아카이브로 옮겨져야 한다."""
        members_path, output_path, archive_dir = _setup(tmp_path, monkeypatch)

        # "어제" 이미 존재했던 latest.json 시뮬레이션
        yesterday_snapshot = {
            "date": "2020-01-01", "year": 2020, "month": 1,
            "members": [{"id": "a1", "nickname": "닉네임", "balloons": 999,
                         "broadcast_seconds": 0, "cumulative_viewers": 0,
                         "sponsor_wins": 0, "sponsor_losses": 0}],
        }
        output_path.write_text(json.dumps(yesterday_snapshot), encoding="utf-8")

        monkeypatch.setattr(update_data, "fetch_poonggo_monthly",
                             lambda year, month, ids: {"a1": {"balloons": 100, "broadcast_seconds": 10, "cumulative_viewers": 5}})
        monkeypatch.setattr(update_data, "aggregate_period_data", lambda start, end: [])

        update_data.main()

        archived = archive_dir / "2020-01-01.json"
        assert archived.exists()
        archived_data = json.loads(archived.read_text(encoding="utf-8"))
        assert archived_data["members"][0]["balloons"] == 999  # 어제 스냅샷 그대로 보존

    def test_sponsor_stats_reset_on_month_change_when_collection_fails(self, tmp_path, monkeypatch):
        """8/31->9/1처럼 달이 바뀐 첫 실행에서 엘로보드 수집이 실패하면(sponsor_list
        비어있음), "기존 값 유지" 폴백이 지난달 누적치를 새 달 데이터인 것처럼
        그대로 보여주면 안 된다 - 0승 0패로 리셋돼야 한다."""
        members_path, output_path, archive_dir = _setup(tmp_path, monkeypatch)

        # "어제"(8/31) 상태: 8월 스폰전적 20승 5패가 쌓여있음
        yesterday_snapshot = {
            "date": "2026-08-31", "year": 2026, "month": 8,
            "sponsor_month": "2026-08", "sponsor_updated_at": "2026-08-31 23:00:00",
            "members": [{"id": "a1", "elo_id": 1, "nickname": "닉네임", "balloons": 100,
                         "broadcast_seconds": 10, "cumulative_viewers": 5,
                         "sponsor_wins": 20, "sponsor_losses": 5}],
        }
        output_path.write_text(json.dumps(yesterday_snapshot, ensure_ascii=False), encoding="utf-8")

        monkeypatch.setattr(update_data, "kst_now", lambda: datetime.datetime(2026, 9, 1, 1, 0, 0))
        monkeypatch.setattr(update_data, "fetch_poonggo_monthly",
                             lambda year, month, ids: {"a1": {"balloons": 0, "broadcast_seconds": 0, "cumulative_viewers": 0}})
        monkeypatch.setattr(update_data, "aggregate_period_data", lambda start, end: [])  # 9월 첫날, 수집 실패

        update_data.main()

        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert result["members"][0]["sponsor_wins"] == 0
        assert result["members"][0]["sponsor_losses"] == 0

    def test_sponsor_stats_preserved_within_same_month_when_collection_fails(self, tmp_path, monkeypatch):
        """같은 달 안에서 수집이 실패하면(위와 대조) 기존 값이 정상적으로
        보존돼야 한다 - 위 테스트가 "무조건 리셋"이 아니라 "월이 바뀔 때만
        리셋"임을 확인하기 위한 대조군."""
        members_path, output_path, archive_dir = _setup(tmp_path, monkeypatch)

        yesterday_snapshot = {
            "date": "2026-09-14", "year": 2026, "month": 9,
            "sponsor_month": "2026-09", "sponsor_updated_at": "2026-09-14 23:00:00",
            "members": [{"id": "a1", "elo_id": 1, "nickname": "닉네임", "balloons": 100,
                         "broadcast_seconds": 10, "cumulative_viewers": 5,
                         "sponsor_wins": 10, "sponsor_losses": 3}],
        }
        output_path.write_text(json.dumps(yesterday_snapshot, ensure_ascii=False), encoding="utf-8")

        monkeypatch.setattr(update_data, "kst_now", lambda: datetime.datetime(2026, 9, 15, 1, 0, 0))
        monkeypatch.setattr(update_data, "fetch_poonggo_monthly",
                             lambda year, month, ids: {"a1": {"balloons": 0, "broadcast_seconds": 0, "cumulative_viewers": 0}})
        monkeypatch.setattr(update_data, "aggregate_period_data", lambda start, end: [])

        update_data.main()

        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert result["members"][0]["sponsor_wins"] == 10
        assert result["members"][0]["sponsor_losses"] == 3
