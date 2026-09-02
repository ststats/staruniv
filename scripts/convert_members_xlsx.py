"""
data/members.xlsx가 로스터의 유일한 원본(source of truth)이다. members.json은
이 xlsx로부터 매번 새로 만들어지는 파생 결과물일 뿐이다.

예전엔 xlsx와 members.json 양쪽에서 다 편집 가능해서("admin.html은 json을
직접 고침") 3-way 병합/충돌 판단이 필요했는데, admin.html도 이제 xlsx를 직접
읽고 쓰도록 바뀌면서 편집 창구가 xlsx 하나로 통일됐다 - 그래서 병합/충돌
해소 로직 자체가 필요 없어졌고, 이 스크립트는 그냥 "지금 xlsx에 있는 내용
그대로 json을 다시 씀" 한 방향뿐이다.

엑셀 시트("members") 컬럼 매핑:
  이름 <-> nickname, SOOP ID <-> id, ELO ID <-> elo_id, 생년월일 <-> birthdate,
  성별(남자/여자) <-> gender(m/f), 종족 <-> race, 티어 <-> tier(문자열로 통일),
  소속 <-> team, 직책 <-> role(비어있으면 ""), 수정일 <-> info_updated_at

xlsx 파일 자체가 없으면 에러로 죽지 않고 조용히 건너뛴다(최초 실행 등).

실행:
  python scripts/convert_members_xlsx.py --dry-run   (미리보기, 파일 안 바꿈)
  python scripts/convert_members_xlsx.py             (실제 반영)
"""

import sys
import argparse

from _common import (
    ROOT, atomic_write_json, validate_and_clean_members,
    XLSX_PATH, load_xlsx_members,
)

MEMBERS_PATH = ROOT / "data" / "members.json"


def main(argv=None):
    """argv=None이면 sys.argv[1:]를 읽는다 - pytest 같은 테스트 러너에서
    main(argv=[])처럼 명시적으로 넘기면 pytest 자체 옵션(-v 등)과 안 부딪힌다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 결과만 출력")
    args = parser.parse_args(argv)

    if not XLSX_PATH.exists():
        print(f"[알림] {XLSX_PATH}가 없어 건너뜁니다.")
        return

    xlsx_rows = load_xlsx_members()
    if not xlsx_rows:
        print("[경고] xlsx에서 읽은 인원이 0명입니다 - members.json을 건드리지 않고 종료합니다.", file=sys.stderr)
        return

    members = []
    for soop_id, fields in xlsx_rows.items():
        m = dict(fields)
        m["id"] = soop_id
        members.append(m)

    members = validate_and_clean_members(members)
    print(f"[준비] members.xlsx에서 {len(members)}명 확인")

    if args.dry_run:
        print(f"[dry-run 완료] {len(members)}명 - 파일은 안 건드림")
        return

    atomic_write_json(MEMBERS_PATH, {"members": members})
    print(f"[완료] members.xlsx({len(members)}명) -> members.json 동기화됨")


if __name__ == "__main__":
    main()
