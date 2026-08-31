"""
data/members.xlsx (사람이 직접 관리하는 엑셀 명단)와 data/members.json을 양방향으로
동기화하는 스크립트. sync_members.py(EloBoard 티어 API로 병합)와 같은 성격 - 전부
update-stats.yml 안에서 매일 자동으로 돌아도 안전하도록 "통째로 덮어쓰기"가 아니라
"id 기준 병합"으로 동작한다.

1단계 (xlsx -> json, 기존 로직):
  - xlsx에 있는 사람 -> members.json에 이미 있으면 nickname/elo_id/birthdate/gender/
    race/tier/team/role을 xlsx 값으로 갱신한다.
  - info_updated_at은 xlsx의 "수정일" 컬럼에서 가져오되, **그 셀이 비어있으면
    건드리지 않고 기존 값을 그대로 보존한다.** ("수정일"을 채운 사람만 xlsx가
    기준이 되고, 안 채운 대다수는 admin.html 등에서 넣어둔 기존 값이 매일 자동
    실행 때마다 null로 리셋되는 걸 막기 위함 - "수정일" 컬럼이 아직 전원 공란인
    상태에서 무조건 덮어쓰면 기존에 쌓아둔 값이 하루 만에 전부 날아간다.)
  - xlsx에 있는데 members.json엔 없는 사람 -> 새로 추가(info_updated_at은 "수정일"
    셀 값 또는 없으면 null).
  - members.json에는 있는데 xlsx엔 없는 사람 -> 이 단계에서는 그대로 둔다(삭제
    하지 않는다).

2단계 (json -> xlsx, 신규):
  - 1단계가 끝난 시점의 members.json 기준으로, xlsx에는 없던 사람(admin.html이나
    sync_members.py가 추가한 사람 등)을 xlsx 맨 아래에 새 행으로 추가한다.
  - 채워 넣는 건 xlsx가 갖고 있는 10개 컬럼(이름/SOOP ID/ELO ID/생년월일/성별/
    종족/티어/소속/직책/수정일)뿐이다. 그 뒤에 있는 엑셀 전용 관리 컬럼(연혁/
    시작일/ELO 등록일/티어표 등록일/각 티어 승급일 등)은 members.json에 대응
    정보가 아예 없으므로 빈 칸으로 남긴다 - 사람이 나중에 직접 채워야 한다.
  - 기존 행은 절대 건드리지 않는다(값 수정도, 서식도) - 새 행 추가만 한다.

엑셀 시트("members") 컬럼 매핑:
  이름 <-> nickname, SOOP ID <-> id, ELO ID <-> elo_id, 생년월일 <-> birthdate,
  성별(남자/여자) <-> gender(m/f), 종족 <-> race, 티어 <-> tier(문자열로 통일),
  소속 <-> team, 직책 <-> role(비어있으면 ""), 수정일 <-> info_updated_at
  (단, info_updated_at은 위에서 설명한 "비어있으면 보존" 예외 적용)

"체크"처럼 확인 전 임시로 박아둔 문자열은 xlsx -> json 방향에서 null로 정규화한다
(README 컨벤션). json -> xlsx 방향에서는 반대로 None 값을 빈 칸으로 남긴다(다시
"체크" 같은 임시 문자열을 만들어내지 않는다).

xlsx 파일 자체가 없으면(아직 한 번도 안 올려졌거나 매일 자동 실행 중 일시적으로
빠진 경우) 두 방향 다 에러로 죽지 않고 조용히 건너뛴다 - members.json은 원래
xlsx 없이도 정상 운영되던 파일이라, 이 스크립트가 optional한 보강 소스로
취급되어야 한다.

실행:
  python scripts/convert_members_xlsx.py --dry-run   (미리보기, 파일 안 바꿈)
  python scripts/convert_members_xlsx.py             (실제 반영)
"""

import sys
import json
import argparse
from datetime import datetime

from openpyxl import load_workbook

from _common import ROOT

XLSX_PATH = ROOT / "data" / "members.xlsx"
MEMBERS_PATH = ROOT / "data" / "members.json"
SHEET_NAME = "members"

GENDER_MAP = {"남자": "m", "여자": "f"}
GENDER_MAP_REVERSE = {"m": "남자", "f": "여자"}
PLACEHOLDER_VALUES = {"체크", "todo", "?", "미정", "", "null", "none", "n/a", "na"}


def clean(value):
    """"체크"/"null"류 임시 문자열이나 빈 문자열을 null로 정규화한다(대소문자
    구분 안 함). 그 외 값은 그대로 통과."""
    if isinstance(value, str) and value.strip().lower() in PLACEHOLDER_VALUES:
        return None
    return value


def format_birthdate(value):
    value = clean(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    return str(value).strip() or None


def parse_birthdate_for_xlsx(value):
    """members.json의 "YYYY-MM-DD" 문자열을 엑셀에 넣을 datetime으로 되돌린다.
    형식이 안 맞거나 None이면 빈 칸(None)으로 남긴다 - 억지로 문자열을 넣지
    않는다(엑셀 원본이 datetime 타입 셀을 쓰고 있어서 형식을 맞춰준다)."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def parse_xlsx_members(ws) -> list:
    rows = []
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        nickname, soop_id, elo_id, birthdate, gender, race, tier, team, role, updated_at = row[:10]

        if not nickname or not soop_id:
            print(f"[건너뜀] {row_idx}행: 이름 또는 SOOP ID가 비어있음", file=sys.stderr)
            continue

        # SOOP ID가 순수 숫자면(예: "163830") 엑셀/openpyxl이 문자열이 아니라
        # int로 읽어들인다 - 그대로 두면 members.json에 숫자로 저장되고, 나중에
        # ",".join(all_ids) 같은 문자열 전제 코드가 TypeError로 죽는다. 항상
        # 문자열로 강제해서 이 문제를 원천 차단한다.
        soop_id = str(soop_id)

        tier = clean(tier)
        rows.append({
            "id": soop_id,
            "nickname": nickname,
            "elo_id": elo_id if elo_id is not None else None,
            "birthdate": format_birthdate(birthdate),
            "gender": GENDER_MAP.get(gender, gender),
            "race": clean(race),
            "tier": str(tier) if tier is not None else None,
            "team": clean(team),
            "role": role if role else "",
            "info_updated_at": format_birthdate(updated_at),  # 날짜 포맷 규칙이 생년월일과 동일해서 재사용
        })
    return rows


def append_missing_to_xlsx(missing_members: list) -> None:
    """members.json에는 있는데 xlsx엔 없던 멤버들을 xlsx 맨 아래에 새 행으로
    추가한다. 기존 행/서식은 절대 안 건드리고, ws.append()로 새 행만 붙인다."""
    wb = load_workbook(XLSX_PATH)  # data_only=False (기본값) - 저장을 위해 별도로 다시 연다
    ws = wb[SHEET_NAME]

    for m in missing_members:
        gender_kr = GENDER_MAP_REVERSE.get(m.get("gender"), m.get("gender"))
        ws.append((
            m.get("nickname"),
            m.get("id"),
            m.get("elo_id"),
            parse_birthdate_for_xlsx(m.get("birthdate")),
            gender_kr,
            m.get("race"),
            m.get("tier"),
            m.get("team"),
            m.get("role") or None,
            parse_birthdate_for_xlsx(m.get("info_updated_at")),
        ))

    wb.save(XLSX_PATH)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 결과만 출력")
    args = parser.parse_args()

    if not XLSX_PATH.exists():
        print(f"[건너뜀] {XLSX_PATH} 가 없습니다 - members.json은 그대로 둡니다.", file=sys.stderr)
        return

    wb = load_workbook(XLSX_PATH, data_only=True)
    if SHEET_NAME not in wb.sheetnames:
        print(f"[오류] '{SHEET_NAME}' 시트를 찾을 수 없습니다. (있는 시트: {wb.sheetnames})", file=sys.stderr)
        sys.exit(1)

    xlsx_rows = parse_xlsx_members(wb[SHEET_NAME])
    xlsx_ids = {row["id"] for row in xlsx_rows}
    print(f"[준비] {XLSX_PATH.name}에서 {len(xlsx_rows)}명 확인")

    local_data = {"members": []}
    if MEMBERS_PATH.exists():
        with open(MEMBERS_PATH, "r", encoding="utf-8") as f:
            local_data = json.load(f)

    # 예전 버그로 인해 이미 members.json에 숫자 타입 id가 저장돼있을 수 있다
    # (순수 숫자로만 된 SOOP ID를 엑셀에서 텍스트 서식 없이 읽은 경우). 그대로
    # 두면 xlsx가 주는 문자열 id랑 매칭이 안 돼서 같은 사람이 중복으로 추가될
    # 수 있으므로, 여기서 전부 문자열로 정규화하고 넘어간다.
    normalized_count = 0
    for m in local_data.get("members", []):
        if m.get("id") is not None and not isinstance(m["id"], str):
            m["id"] = str(m["id"])
            normalized_count += 1
    if normalized_count:
        print(f"[정리] members.json에서 숫자 타입 id {normalized_count}개를 문자열로 정규화함", file=sys.stderr)

    member_map = {m["id"]: m for m in local_data.get("members", []) if m.get("id")}

    # 1단계: xlsx -> json
    updated, added = [], []
    for row in xlsx_rows:
        soop_id = row["id"]
        existing = member_map.get(soop_id)
        xlsx_info_updated_at = row["info_updated_at"]
        core_fields = {k: v for k, v in row.items() if k not in ("id", "info_updated_at")}

        if existing:
            before = {k: existing.get(k) for k in core_fields}
            before_info_updated_at = existing.get("info_updated_at")
            existing.update(core_fields)

            info_changed = False
            if xlsx_info_updated_at is not None and before_info_updated_at != xlsx_info_updated_at:
                existing["info_updated_at"] = xlsx_info_updated_at
                info_changed = True
            # "수정일" 셀이 비어있으면(xlsx_info_updated_at is None) 기존 값을 그대로
            # 둔다 - admin.html 등에서 넣어둔 값이 매일 자동 실행 때마다 지워지지
            # 않게 하기 위함.

            if before != core_fields or info_changed:
                if info_changed:
                    before["info_updated_at"] = before_info_updated_at
                    core_fields["info_updated_at"] = existing["info_updated_at"]
                updated.append((soop_id, before, core_fields))
        else:
            new_member = dict(row)  # id/core_fields/info_updated_at(수정일 값 또는 None) 전부 포함
            local_data.setdefault("members", []).append(new_member)
            member_map[soop_id] = new_member
            added.append((soop_id, row["nickname"]))

    # 2단계: json -> xlsx (xlsx엔 없었던 사람들)
    missing_from_xlsx = [m for m in local_data.get("members", []) if m.get("id") not in xlsx_ids]

    if args.dry_run:
        for soop_id, before, after in updated:
            print(f"  [json 갱신 예정] {soop_id}: {before} -> {after}")
        for soop_id, nickname in added:
            print(f"  [json 추가 예정] {soop_id} ({nickname})")
        for m in missing_from_xlsx:
            print(f"  [xlsx 추가 예정] {m.get('id')} ({m.get('nickname')})")
        print(f"[dry-run 완료] json 갱신 {len(updated)}명 / json 추가 {len(added)}명 / "
              f"xlsx 추가 {len(missing_from_xlsx)}명 (파일은 안 건드림)")
        return

    with open(MEMBERS_PATH, "w", encoding="utf-8") as f:
        json.dump(local_data, f, ensure_ascii=False, indent=2)
    print(f"[완료] members.json 병합됨 (기존 정보 갱신 {len(updated)}명, 신규 추가 {len(added)}명, "
          f"총 {len(local_data['members'])}명)")

    if missing_from_xlsx:
        append_missing_to_xlsx(missing_from_xlsx)
        print(f"[완료] members.xlsx에 {len(missing_from_xlsx)}명 추가됨")
    else:
        print("[완료] xlsx에 추가할 신규 인원 없음")


if __name__ == "__main__":
    main()
