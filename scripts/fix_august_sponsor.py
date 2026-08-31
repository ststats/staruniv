"""
8월 누락 스폰전적 소급 적용 스크립트 (일회용)
타임스탬프는 변경하지 않고 오직 스폰전적(승/패)만 덮어씌웁니다.
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
    changed = False

    for m in archive_data.get("members", []):
        elo_id = m.get("elo_id")
        if elo_id is not None:
            src = sponsor_dict.get(str(elo_id))
            if src:
                m["sponsor_wins"] = src["sponsor_wins"]
                m["sponsor_losses"] = src["sponsor_losses"]
                changed = True

    if changed:
        atomic_write_json(archive_path, archive_data)
        print(f"[완료] {archive_path.name} 파일에 8월 스폰전적 정정이 성공적으로 반영되었습니다. (타임스탬프 유지)")
    else:
        print("[알림] 갱신할 내용이 없습니다.")

if __name__ == "__main__":
    main()
