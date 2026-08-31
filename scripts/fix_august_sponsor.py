"""
8월 누락 스폰전적 소급 적용 스크립트 (일회용)
타임스탬프는 변경하지 않고 오직 스폰전적(승/패)만 덮어씌웁니다.

재조회가 성공했는데(sponsor_list가 비어있지 않은데) 특정 멤버가 결과에 없는
경우 -> 그 사람은 8월에 진짜 0판이라는 뜻이다(API가 참가자만 돌려주고 0판인
사람은 아예 안 준다). 이런 사람을 그냥 안 건드리고 넘어가면, 결측 사고 기간에
잘못 섞여 들어간 값이 그대로 남을 수 있어서, 매칭 안 된 사람도 명시적으로
0승 0패로 확정한다.
"""
import sys
from _common import ROOT, safe_read_json, atomic_write_json
from fetch_eloboard_data import aggregate_period_data


def main():
    start_date = "2026-08-01"
    end_date = "2026-08-31"
    archive_path = ROOT / "data" / "archive" / "2026-08-31.json"
    if not archive_path.exists():
        print(f"[오류] 아카이브 파일이 없습니다: {archive_path}")
        sys.exit(1)
    archive_data = safe_read_json(archive_path)
    if not archive_data:
        print("[오류] 아카이브 파일을 읽을 수 없습니다.")
        sys.exit(1)
    print(f"[수집] {start_date} ~ {end_date} 엘로보드 스폰전적 재조회 중...")

    try:
        sponsor_list = aggregate_period_data(start_date, end_date)
    except Exception as e:
        print(f"[오류] 엘로보드 수집 중 예외 발생: {e}")
        sys.exit(1)
    if not sponsor_list:
        print("[경고] 수집된 데이터가 없습니다. 스크립트를 종료합니다.")
        sys.exit(1)

    sponsor_dict = {item["id"]: item for item in sponsor_list if item.get("id")}
    changed = 0
    for m in archive_data.get("members", []):
        elo_id = m.get("elo_id")
        if elo_id is None:
            continue
        src = sponsor_dict.get(str(elo_id))
        new_wins = src["sponsor_wins"] if src else 0
        new_losses = src["sponsor_losses"] if src else 0
        old_wins, old_losses = m.get("sponsor_wins"), m.get("sponsor_losses")
        if old_wins != new_wins or old_losses != new_losses:
            print(f"  {m.get('nickname', m.get('id'))}: {old_wins}승{old_losses}패 -> {new_wins}승{new_losses}패")
            m["sponsor_wins"] = new_wins
            m["sponsor_losses"] = new_losses
            changed += 1

    if changed:
        atomic_write_json(archive_path, archive_data)
        print(f"[완료] {archive_path.name} 파일에 8월 스폰전적 정정이 성공적으로 반영되었습니다. "
              f"({changed}명 변경, 타임스탬프 유지)")
    else:
        print("[알림] 갱신할 내용이 없습니다.")


if __name__ == "__main__":
    main()
