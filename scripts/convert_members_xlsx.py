"""
구글 시트가 로스터의 유일한 원본(source of truth)이다.
members.json은 이 구글 시트로부터 매번 새로 만들어지는 파생 결과물일 뿐이다.
"""

import sys
import argparse

from _common import (
    ROOT, atomic_write_json, validate_and_clean_members,
    is_sheet_ready, load_sheet_members
)

MEMBERS_PATH = ROOT / "data" / "members.json"

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 결과만 출력")
    args = parser.parse_args(argv)

    if not is_sheet_ready():
        print("[알림] 구글 시트 설정이 없어 건너뜁니다.")
        return

    sheet_rows = load_sheet_members()
    if not sheet_rows:
        print("[경고] 시트에서 읽은 인원이 0명입니다 - members.json을 건드리지 않고 종료합니다.", file=sys.stderr)
        return

    members = []
    for soop_id, fields in sheet_rows.items():
        m = dict(fields)
        m["id"] = soop_id
        members.append(m)

    members = validate_and_clean_members(members)
    print(f"[준비] 구글 시트에서 {len(members)}명 확인")

    if args.dry_run:
        print(f"[dry-run 완료] {len(members)}명 - 파일은 안 건드림")
        return

    atomic_write_json(MEMBERS_PATH, {"members": members})
    print(f"[완료] 구글 시트({len(members)}명) -> members.json 동기화됨")

if __name__ == "__main__":
    main()
