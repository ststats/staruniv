"""
ststats 프로젝트의 데이터 갱신 오케스트레이터.

fetch_poonggo_data.py와 fetch_eloboard_data.py는 이제 순수하게 "데이터만 가져오는"
함수만 제공합니다(자기가 언제 latest.json/아카이브를 건드릴지는 모릅니다). 이
스크립트가 그 둘을 호출해서 한 번에 조합하고, 아카이브 결정·월 확정·소급 정정·최종
저장까지 전부 책임집니다.

  1. 날짜가 바뀌었으면 어제자 스냅샷을 아카이브로 확정 (아직 아무것도 새로 안 가져온
     상태라, 안전하게 "어제 마지막 상태 그대로" 확정된다)
  2. 달이 바뀌었으면 지난달 마지막 날 아카이브를 별풍선(풍고 재조회) + 스폰전적
     (엘로보드 재조회) 둘 다 확정 - 방금 1번에서 그 아카이브 파일이 이미 만들어져
     있으니 순서 걱정할 필요가 없다
  3. info_updated_at 소급 정정 적용
  4. 오늘자 별풍선/스폰전적을 새로 가져와서 하나로 합쳐 latest.json에 저장

엘로보드 쪽 API 호출이 실패해도 별풍선 데이터는 정상적으로 저장되도록, 엘로보드
관련 호출은 전부 감싸서 실패 시 기존 값을 유지하고 넘어간다.

각 멤버의 elo_id는 members.json에서 그대로 읽어 latest.json/아카이브의 멤버
객체에도 함께 저장한다(out_members 구성부 참고) - EloBoard API가 돌려주는
스폰전적도 elo_id를 키로 쓰므로, 별도 매핑 테이블 없이 그 자리에서 바로 조회해서
매칭할 수 있다.
"""

import sys
import json

from _common import (
    ROOT, DATETIME_FORMAT, kst_now, last_day_of_month, get_month_date_range,
    atomic_write_json, safe_read_json, validate_and_clean_members,
)
from fetch_poonggo_data import fetch_poonggo_monthly
from fetch_eloboard_data import aggregate_period_data

MEMBERS_PATH = ROOT / "data" / "members.json"
OUTPUT_PATH = ROOT / "data" / "latest.json"
ARCHIVE_DIR = ROOT / "data" / "archive"
APPLIED_CORRECTIONS_PATH = ROOT / "data" / "archive_corrections_applied.json"


def archive_previous_day_if_needed(prev_latest: dict, new_date_str: str):
    """날짜가 바뀌면 어제자 latest.json의 마지막 스냅샷을 아카이브로 보관한다.
    prev_latest는 main()이 실행 시작 시점에 이미 읽어둔 latest.json 내용을 그대로
    받는다(파일을 여기서 다시 읽지 않는다 - main()에서 한 번 읽은 걸 재사용)."""
    if not prev_latest:
        return

    prev_date = prev_latest.get("date")
    if not prev_date or prev_date == new_date_str:
        return

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = ARCHIVE_DIR / f"{prev_date}.json"
    if not archive_path.exists():
        atomic_write_json(archive_path, prev_latest)


def apply_member_updates_to_archives(members: list):
    """members.json에 info_updated_at이 있는 멤버의 정보를 그 날짜 이후의 모든 아카이브에 소급 적용합니다.

    한 번이라도 소급 정정 대상이 생기면 그 이후로는 매 실행마다 그 날짜 이후의
    아카이브 전체를 다시 훑게 되는데, 아카이브는 매일 계속 쌓이므로 그대로 두면
    실행 시간이 시간이 갈수록 계속 늘어난다. data/archive_corrections_applied.json에
    "지난번에 이미 완전히 반영한 보정 내용"을 스냅샷으로 남겨두고, 이번 실행에서
    그때랑 완전히 똑같은 사람은 건너뛴다 - 그러면 실제로 새로 생기거나 바뀐
    보정 건에 대해서만, 그 사람의 update_date 이후 아카이브만 훑으면 된다."""
    updates = {}
    for m in members:
        update_date = m.get("info_updated_at")
        if update_date and m.get("id"):
            updates[m["id"]] = {
                "update_date": update_date,
                "team": m.get("team"),
                "tier": m.get("tier"),
                "role": m.get("role"),
                "race": m.get("race"),
                "nickname": m.get("nickname"),
                "elo_id": m.get("elo_id"),
            }

    if not updates or not ARCHIVE_DIR.exists():
        return

    applied = safe_read_json(APPLIED_CORRECTIONS_PATH, default={})

    pending = {mid: upd for mid, upd in updates.items() if applied.get(mid) != upd}
    if not pending:
        return  # 지난번과 완전히 동일한 보정 내용 - 아카이브를 다시 훑을 필요 없음

    earliest_update_date = min(u["update_date"] for u in pending.values())

    for archive_path in ARCHIVE_DIR.glob("*.json"):
        file_date = archive_path.stem  # YYYY-MM-DD
        if file_date < earliest_update_date:
            continue
        changed = False

        arch_data = safe_read_json(archive_path, default=None)
        if arch_data is None:
            continue

        for am in arch_data.get("members", []):
            mid = am.get("id")
            if mid in pending:
                upd = pending[mid]
                if file_date >= upd["update_date"]:
                    for key in ["team", "tier", "role", "race", "nickname", "elo_id"]:
                        if am.get(key) != upd[key]:
                            am[key] = upd[key]
                            changed = True

        if changed:
            atomic_write_json(archive_path, arch_data)
            print(f"[소급적용] {file_date}.json 파일에 멤버 정보 업데이트 반영됨")

    applied.update(pending)
    atomic_write_json(APPLIED_CORRECTIONS_PATH, applied)


def _index_by_elo_id(sponsor_list: list) -> dict:
    """aggregate_period_data()가 돌려준 리스트를 elo_id(문자열)를 키로 하는 dict로
    바꾼다. confirm_previous_month_if_needed()와 main() 둘 다 이 변환이 필요해서
    (완전히 동일한 한 줄이 두 군데에 그대로 중복돼 있었다) 하나로 뺐다."""
    return {item["id"]: item for item in sponsor_list if item.get("id")}


def confirm_previous_month_if_needed(prev_year, prev_month, new_year, new_month, all_ids, now):
    """달이 바뀐 첫 실행에서, 지난달 마지막 날 아카이브 파일 하나에 별풍선(풍고
    재조회)과 스폰전적(엘로보드 재조회) 둘 다 확정 적용한다. archive_previous_day_
    if_needed()가 먼저 호출된 뒤라 이 아카이브 파일은 항상 이미 존재한다."""
    if not prev_year or not prev_month or (prev_year, prev_month) == (new_year, new_month):
        return

    last_day = last_day_of_month(prev_year, prev_month)
    archive_path = ARCHIVE_DIR / f"{prev_year:04d}-{prev_month:02d}-{last_day:02d}.json"
    if not archive_path.exists():
        print(f"[경고] {archive_path.name} 파일이 없어 월 확정을 건너뜁니다.", file=sys.stderr)
        return

    archive = safe_read_json(archive_path, default=None)
    if archive is None:
        print(f"[오류] 아카이브 파일을 읽을 수 없습니다: {archive_path.name}", file=sys.stderr)
        return

    changed = False

    # 별풍선/방송시간/누적시청자 재확정
    print(f"[확정] {prev_year}년 {prev_month}월 별풍선 재조회 중...")
    balloon_data = fetch_poonggo_monthly(prev_year, prev_month, all_ids)
    if balloon_data is None:
        print(f"[경고] {prev_year}년 {prev_month}월 별풍선 재조회 실패 - 기존 값 유지", file=sys.stderr)
    else:
        for m in archive.get("members", []):
            src = balloon_data.get(m.get("id"))
            if src:
                m["balloons"] = src["balloons"]
                m["broadcast_seconds"] = src["broadcast_seconds"]
                m["cumulative_viewers"] = src["cumulative_viewers"]
                changed = True

    # 스폰전적 재확정
    start_date = f"{prev_year:04d}-{prev_month:02d}-01"
    end_date = f"{prev_year:04d}-{prev_month:02d}-{last_day:02d}"
    print(f"[확정] {prev_year}년 {prev_month}월 스폰전적 재조회 중... ({start_date}~{end_date})")
    try:
        sponsor_list = aggregate_period_data(start_date, end_date)
    except Exception as e:
        print(f"[경고] 스폰전적 재조회 중 오류: {e}", file=sys.stderr)
        sponsor_list = []
    if not sponsor_list:
        print(f"[경고] {prev_year}년 {prev_month}월 스폰전적 재조회 결과가 비어있음 - 기존 값 유지", file=sys.stderr)
    else:
        # sponsor_list의 "id"는 elo_id(숫자 문자열)다. archive의 각 멤버는 latest.json이
        # 저장될 때부터 자기 elo_id를 이미 갖고 있으므로(out_members 구성부 참고), 별도
        # 매핑 테이블 없이 archive 멤버의 elo_id로 바로 조회한다.
        lookup = _index_by_elo_id(sponsor_list)
        for m in archive.get("members", []):
            elo_id = m.get("elo_id")
            src = lookup.get(str(elo_id)) if elo_id is not None else None
            if src:
                m["sponsor_wins"] = src["sponsor_wins"]
                m["sponsor_losses"] = src["sponsor_losses"]
                changed = True

    if changed:
        archive["updated_at"] = now.strftime(DATETIME_FORMAT)
        archive["sponsor_updated_at"] = now.strftime(DATETIME_FORMAT)
        atomic_write_json(archive_path, archive)
        print(f"[완료] {archive_path.name} 확정됨")


def main():
    if not MEMBERS_PATH.exists():
        print(f"[오류] {MEMBERS_PATH} 가 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open(MEMBERS_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    # 각 레코드가 최소 스키마(id/nickname)를 만족하는지 검사하고, 문제 있는
    # 레코드는 걸러낸다 - xlsx/EloBoard API/admin.html 중 어느 한 곳이라도
    # 이상한 값을 넣으면(오늘도 숫자 id, 문자열 "null" 등 실제로 있었음) 그
    # 레코드 하나 때문에 전체 갱신이 통째로 죽는 일이 없도록 한다.
    members = validate_and_clean_members(config.get("members", []))
    all_ids = [m["id"] for m in members]  # validate_and_clean_members가 이미 문자열로 강제해둠

    now = kst_now()
    year, month = now.year, now.month
    today_date_str = now.strftime("%Y-%m-%d")
    print(f"[시작] 데이터 갱신 ({now.strftime(DATETIME_FORMAT)})")

    # latest.json은 이번 실행에서 딱 한 번만 읽는다 - "어제까지의" year/month 판단,
    # 날짜 전환 아카이빙, 스폰전적 백업까지 전부 이 한 번의 읽기 결과(prev_latest)를
    # 재사용한다(예전엔 이 셋이 각자 파일을 다시 열어서 같은 파일을 실행마다 3번
    # 읽고 있었다).
    prev_latest = None
    if OUTPUT_PATH.exists():
        prev_latest = safe_read_json(OUTPUT_PATH, default=None)

    prev_year = prev_month = None
    sponsor_updated_at = sponsor_month = None
    existing_sponsor = {}
    if prev_latest:
        prev_year, prev_month = prev_latest.get("year"), prev_latest.get("month")
        sponsor_updated_at = prev_latest.get("sponsor_updated_at")
        sponsor_month = prev_latest.get("sponsor_month")
        for om in prev_latest.get("members", []):
            mid = om.get("id")
            if mid:
                existing_sponsor[mid] = {
                    "sponsor_wins": om.get("sponsor_wins", 0),
                    "sponsor_losses": om.get("sponsor_losses", 0),
                }

    # 1. 날짜 전환 아카이빙 - 아직 오늘자 데이터를 하나도 안 가져온 상태라, 어제
    #    마지막 상태 그대로 안전하게 확정된다.
    archive_previous_day_if_needed(prev_latest, today_date_str)

    # 2. 월 전환 확정 - 별풍선/스폰전적 둘 다, 방금 1번에서 이미 만들어졌을 아카이브에.
    confirm_previous_month_if_needed(prev_year, prev_month, year, month, all_ids, now)

    # 3. 소급 정정 적용
    apply_member_updates_to_archives(members)

    # 4. 오늘자 데이터 새로 수집 (풍고/엘로보드 순서는 이제 상관없다 - 둘 다 latest.json을
    #    직접 안 건드리는 순수 fetch라서)
    print(f"[수집] 풍고 별풍선 ({today_date_str}, {len(all_ids)}명)...")
    balloon_data = fetch_poonggo_monthly(year, month, all_ids)
    if balloon_data is None:
        raise SystemExit("[오류] 별풍선 데이터를 가져오지 못했습니다.")

    sponsor_data = {}
    start_date, end_date = get_month_date_range(now)
    print(f"[수집] 엘로보드 스폰전적 ({start_date}~{end_date})...")
    try:
        sponsor_list = aggregate_period_data(start_date, end_date)
    except Exception as e:
        print(f"[경고] 엘로보드 수집 중 오류: {e} - 기존 스폰전적 유지", file=sys.stderr)
        sponsor_list = []
    if sponsor_list:
        # sponsor_list의 "id"는 elo_id(숫자 문자열) 그대로다. 별도 변환 없이 elo_id를
        # 키로 저장해두고, out_members를 만들 때 각 멤버의 elo_id로 바로 조회한다.
        sponsor_data = _index_by_elo_id(sponsor_list)
        sponsor_updated_at = now.strftime(DATETIME_FORMAT)
        # 실제로 이번달 스폰전적을 성공적으로 가져왔을 때만 sponsor_month를
        # 이번달로 갱신한다 - 수집이 실패한 실행에서는 sponsor_month를 건드리지
        # 않고 그대로 둔다(위에서 prev_latest로부터 읽어온 값 유지). 안 그러면
        # 실제로는 갱신 안 됐는데 "이번달로 확정됨"이라고 잘못 표시돼서, 나중에
        # 진짜 필요한 월 확정 단계를 건너뛰게 된다.
        sponsor_month = f"{year:04d}-{month:02d}"
    else:
        print("[경고] 엘로보드 수집 결과가 비어있음 - 기존 스폰전적 유지", file=sys.stderr)

    out_members = []
    for m in members:
        member_id = m.get("id")
        elo_id = m.get("elo_id")
        bd = balloon_data.get(member_id) if member_id else None
        sd = sponsor_data.get(str(elo_id)) if elo_id is not None else None
        existing = existing_sponsor.get(member_id, {"sponsor_wins": 0, "sponsor_losses": 0})

        out_members.append({
            "id": member_id,
            "elo_id": elo_id,
            "nickname": m.get("nickname") or member_id,
            "role": m.get("role"),
            "team": m.get("team"),
            "race": m.get("race"),
            "tier": m.get("tier"),
            "balloons": bd["balloons"] if bd else 0,
            "broadcast_seconds": bd["broadcast_seconds"] if bd else 0,
            "cumulative_viewers": bd["cumulative_viewers"] if bd else 0,
            "sponsor_wins": sd["sponsor_wins"] if sd else existing["sponsor_wins"],
            "sponsor_losses": sd["sponsor_losses"] if sd else existing["sponsor_losses"],
        })

    result = {
        "updated_at": now.strftime(DATETIME_FORMAT),
        "date": today_date_str,
        "year": year,
        "month": month,
        "members": out_members,
    }
    if sponsor_updated_at:
        result["sponsor_updated_at"] = sponsor_updated_at
    if sponsor_month:
        result["sponsor_month"] = sponsor_month

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(OUTPUT_PATH, result)

    print(f"[완료] {OUTPUT_PATH.name} 갱신됨 (별풍선 {len(balloon_data)}명, 스폰전적 {len(sponsor_data)}명)")


if __name__ == "__main__":
    main()
