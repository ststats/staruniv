import json

import update_data
from update_data import _index_by_elo_id, apply_member_updates_to_archives


class TestIndexByEloId:
    def test_indexes_by_id_field(self):
        sponsor_list = [
            {"id": "3", "sponsor_wins": 5, "sponsor_losses": 2},
            {"id": "10", "sponsor_wins": 1, "sponsor_losses": 1},
        ]
        result = _index_by_elo_id(sponsor_list)
        assert result["3"]["sponsor_wins"] == 5
        assert result["10"]["sponsor_losses"] == 1

    def test_skips_entries_without_id(self):
        sponsor_list = [{"id": None, "sponsor_wins": 1}, {"sponsor_wins": 2}]
        assert _index_by_elo_id(sponsor_list) == {}

    def test_empty_list_returns_empty_dict(self):
        assert _index_by_elo_id([]) == {}


class TestApplyMemberUpdatesToArchives:
    """소급 정정(info_updated_at)이 아카이브에 반영되는지, 그리고 이미 반영한
    내용은 다음 실행에서 건너뛰는지(archive_corrections_applied.json 스냅샷)."""

    def _setup(self, tmp_path, monkeypatch):
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()
        applied_path = tmp_path / "archive_corrections_applied.json"
        monkeypatch.setattr(update_data, "ARCHIVE_DIR", archive_dir)
        monkeypatch.setattr(update_data, "APPLIED_CORRECTIONS_PATH", applied_path)
        return archive_dir, applied_path

    def _write_archive(self, archive_dir, date_str, members):
        with open(archive_dir / f"{date_str}.json", "w", encoding="utf-8") as f:
            json.dump({"date": date_str, "members": members}, f, ensure_ascii=False)

    def _read_archive(self, archive_dir, date_str):
        with open(archive_dir / f"{date_str}.json", encoding="utf-8") as f:
            return json.load(f)

    def test_applies_correction_to_archives_on_or_after_update_date(self, tmp_path, monkeypatch):
        archive_dir, _ = self._setup(tmp_path, monkeypatch)
        self._write_archive(archive_dir, "2026-08-15", [
            {"id": "a1", "nickname": "예전닉네임", "team": "예전팀", "tier": "0",
             "role": "", "race": "저그", "elo_id": 1},
        ])
        members = [{"id": "a1", "nickname": "새닉네임", "team": "새팀", "tier": "갓",
                    "role": "", "race": "테란", "elo_id": 1, "info_updated_at": "2026-08-01"}]

        apply_member_updates_to_archives(members)

        result = self._read_archive(archive_dir, "2026-08-15")
        assert result["members"][0]["nickname"] == "새닉네임"
        assert result["members"][0]["team"] == "새팀"

    def test_does_not_apply_to_archives_before_update_date(self, tmp_path, monkeypatch):
        archive_dir, _ = self._setup(tmp_path, monkeypatch)
        self._write_archive(archive_dir, "2026-07-01", [
            {"id": "a1", "nickname": "예전닉네임", "team": "예전팀", "tier": "0",
             "role": "", "race": "저그", "elo_id": 1},
        ])
        members = [{"id": "a1", "nickname": "새닉네임", "team": "새팀", "tier": "갓",
                    "role": "", "race": "테란", "elo_id": 1, "info_updated_at": "2026-08-01"}]

        apply_member_updates_to_archives(members)

        # update_date(2026-08-01)보다 이른 아카이브(2026-07-01)는 그대로여야 함
        result = self._read_archive(archive_dir, "2026-07-01")
        assert result["members"][0]["nickname"] == "예전닉네임"

    def test_second_run_with_identical_correction_skips_rescan(self, tmp_path, monkeypatch):
        """핵심 최적화: 완전히 동일한 보정 내용이면 두 번째 실행은 아카이브를
        다시 읽지도/쓰지도 않아야 한다(파일 mtime으로 확인)."""
        archive_dir, applied_path = self._setup(tmp_path, monkeypatch)
        self._write_archive(archive_dir, "2026-08-15", [
            {"id": "a1", "nickname": "예전닉네임", "team": "예전팀", "tier": "0",
             "role": "", "race": "저그", "elo_id": 1},
        ])
        members = [{"id": "a1", "nickname": "새닉네임", "team": "새팀", "tier": "갓",
                    "role": "", "race": "테란", "elo_id": 1, "info_updated_at": "2026-08-01"}]

        apply_member_updates_to_archives(members)
        assert applied_path.exists()  # 1차 실행 후 스냅샷 파일이 생겨야 함

        archive_file = archive_dir / "2026-08-15.json"
        mtime_after_first_run = archive_file.stat().st_mtime_ns

        apply_member_updates_to_archives(members)  # 2차: 완전히 동일한 members

        assert archive_file.stat().st_mtime_ns == mtime_after_first_run  # 안 건드려짐

    def test_changed_correction_reapplies(self, tmp_path, monkeypatch):
        """스냅샷에 있어도, 이번엔 값이 달라졌으면 다시 반영해야 한다."""
        archive_dir, _ = self._setup(tmp_path, monkeypatch)
        self._write_archive(archive_dir, "2026-08-15", [
            {"id": "a1", "nickname": "예전닉네임", "team": "예전팀", "tier": "0",
             "role": "", "race": "저그", "elo_id": 1},
        ])
        members = [{"id": "a1", "nickname": "닉A", "team": "팀A", "tier": "갓",
                    "role": "", "race": "테란", "elo_id": 1, "info_updated_at": "2026-08-01"}]
        apply_member_updates_to_archives(members)

        members[0]["team"] = "팀B"  # 보정 내용이 바뀜
        apply_member_updates_to_archives(members)

        result = self._read_archive(archive_dir, "2026-08-15")
        assert result["members"][0]["team"] == "팀B"

    def test_no_info_updated_at_members_does_nothing(self, tmp_path, monkeypatch):
        archive_dir, applied_path = self._setup(tmp_path, monkeypatch)
        self._write_archive(archive_dir, "2026-08-15", [{"id": "a1", "nickname": "그대로"}])
        members = [{"id": "a1", "nickname": "다른닉네임", "info_updated_at": None}]

        apply_member_updates_to_archives(members)

        assert not applied_path.exists()  # 소급 정정 대상이 없으면 스냅샷 파일도 안 생김
        result = self._read_archive(archive_dir, "2026-08-15")
        assert result["members"][0]["nickname"] == "그대로"
