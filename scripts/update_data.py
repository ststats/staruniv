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
from datetime import datetime, timedelta

from _common import (
    ROOT, DATETIME_FORMAT, kst_now, last_day_of_month, get_month_date_range,
    atomic_write_json, safe_read_json, validate_and_clean_members,
    XLSX_PATH, load_xlsx_members, write_xlsx,
)
from fetch_poonggo_data import fetch_poonggo_monthly
from fetch_eloboard_data import aggregate_period_data

MEMBERS_PATH = ROOT / "data" / "members.json"
OUTPUT_PATH = ROOT / "data" / "latest.json"
ARCHIVE_DIR = ROOT / "data" / "archive"
APPLIED_CORRECTIONS_PATH = ROOT / "data" / "archive_corrections_applied.json"
# archive_corrections_applied.json이 무한정 커지지 않도록, 더 이상 안 쓰이는
# 기록을 이 기간(개월) 지나면 정리한다 - _prune_stale_corrections 참고.
PRUNE_GRACE_MONTHS = 6


def _collect_unknown_elo_players(sponsor_list: list, existing_elo_ids: set) -> dict:
    """엘로보드에서 수집된 스폰전적(aggregate_period_data()의 반환값)의 elo_id
    중 existing_elo_ids에 없는 신규 ID를 찾아, elo_id(문자열)를 키로 하는
    빈칸 프로필 dict를 반환한다.

    xlsx를 직접 열고/쓰지 않는 순수 함수다 - 한 번의 워크플로우 실행 안에서
    이 함수가 여러 번(월 확정용 재조회 + 오늘자 수집, confirm_previous_month_
    if_needed()와 main() 양쪽) 불릴 수 있는데, 매번 xlsx를 열고 파싱하고
    저장하면 무거운 파일 I/O가 불필요하게 여러 번 발생한다. 대신 여기서는
    메모리 상의 existing_elo_ids 집합만 갱신하고(발견한 신규 id를 즉시
    추가해서, 이 함수를 두 번 이상 연달아 불러도 같은 elo_id가 중복으로
    안 담긴다), 실제 xlsx 쓰기는 호출부(main())가 모든 호출이 끝난 뒤 딱
    한 번만 처리한다.

    리스트가 아니라 elo_id 키의 dict로 반환하는 이유: existing_elo_ids로
    이미 중복을 막고 있지만, 혹시 모를 예상 밖의 타이밍/API 이슈로 같은
    elo_id가 여러 경로로 유입되더라도 dict는 같은 키에 다시 쓰면 그냥
    덮어써질 뿐이라 중복 생성 자체가 구조적으로 불가능하다(리스트였다면
    append가 반복될 경우 같은 사람이 여러 번 들어갈 수 있었다)."""
    new_members = {}
    for item in sponsor_list:
        elo_id_str = item.get("id")
        if elo_id_str and elo_id_str not in existing_elo_ids:
            new_member = {
                "id": f"elo_{elo_id_str}",  # 아프리카TV 아이디 빈칸
                "nickname": f"미상(elo_{elo_id_str})",
                "elo_id": int(elo_id_str),
                "birthdate": None,
                "gender": "",  # 성별 빈칸
                "race": "",    # 종족 빈칸
                "tier": "",    # 티어 빈칸
                "team": "",    # 소속 팀 빈칸
                "role": "",
                "info_updated_at": None,
            }
            new_members[elo_id_str] = new_member
            existing_elo_ids.add(elo_id_str)
            print(f"[알림] 새로운 임시 프로필 발견됨: {new_member['nickname']}")
    return new_members


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


def _prune_stale_corrections(applied: dict, updates: dict, today_date_str: str) -> dict:
    """archive_corrections_applied.json이 무한정 커지는 걸 막기 위한 정리(gc).

    applied에 있는데 updates(현재 로스터에서 여전히 info_updated_at이 설정된
    사람들)에는 없는 항목만 정리 대상 후보로 삼는다 - 아직 updates에 남아있는
    항목을 지우면, 다음 실행에서 캐시 미스로 똑같은 아카이브를 또 훑게 되어
    캐시를 두는 의미 자체가 없어진다(속도 최적화가 무력화됨). 후보 중에서도
    update_date가 PRUNE_GRACE_MONTHS 이상 지난 것만 실제로 지운다 - 방금 막
    로스터에서 빠진 사람의 정보가 어떤 이유로든 다시 필요해지는 극단적인
    경우에 대비한 안전판이다."""
    cutoff = (
        datetime.strptime(today_date_str, "%Y-%m-%d") - timedelta(days=PRUNE_GRACE_MONTHS * 30)
    ).strftime("%Y-%m-%d")
    pruned = {}
    removed = 0
    for mid, upd in applied.items():
        if mid in updates or upd.get("update_date", "") >= cutoff:
            pruned[mid] = upd
        else:
            removed += 1
    if removed:
        print(f"[정리] archive_corrections_applied.json에서 오래된 기록 {removed}건 정리됨")
    return pruned


def apply_member_updates_to_archives(members: list, today_date_str: str):
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
    applied = _prune_stale_corrections(applied, updates, today_date_str)
    atomic_write_json(APPLIED_CORRECTIONS_PATH, applied)


def _index_by_elo_id(sponsor_list: list) -> dict:
    """aggregate_period_data()가 돌려준 리스트를 elo_id(문자열)를 키로 하는 dict로
    바꾼다. confirm_previous_month_if_needed()와 main() 둘 다 이 변환이 필요해서
    (완전히 동일한 한 줄이 두 군데에 그대로 중복돼 있었다) 하나로 뺐다."""
    return {item["id"]: item for item in sponsor_list if item.get("id")}


def confirm_previous_month_if_needed(prev_year, prev_month, new_year, new_month, all_ids, now, existing_elo_ids, new_members_acc):
    """달이 바뀐 첫 실행에서, 지난달 마지막 날 아카이브 파일 하나에 별풍선(풍고
    재조회)과 스폰전적(엘로보드 재조회) 둘 다 확정 적용한다. archive_previous_day_
    if_needed()가 먼저 호출된 뒤라 이 아카이브 파일은 항상 이미 존재한다.

    existing_elo_ids/new_members_acc는 main()이 xlsx를 딱 한 번만 읽고
    쓰기 위해 넘겨주는 공유 상태다 - 자세한 이유는 _collect_unknown_elo_players
    참고."""
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
    sponsor_changed = False

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
        new_members_acc.update(_collect_unknown_elo_players(sponsor_list, existing_elo_ids))
        # sponsor_list의 "id"는 elo_id(숫자 문자열)다. archive의 각 멤버는 latest.json이
        # 저장될 때부터 자기 elo_id를 이미 갖고 있으므로(out_members 구성부 참고), 별도
        # 매핑 테이블 없이 archive 멤버의 elo_id로 바로 조회한다.
        #
        # 재조회가 성공했는데(sponsor_list가 비어있지 않은데) 특정 멤버가 lookup에
        # 없는 경우 -> 그 달에 그 사람은 진짜 0판이라는 뜻이다(API가 참가자만
        # 돌려주고 0판인 사람은 아예 안 준다). 이런 사람의 기존 값을 그대로
        # 놔두면(예전 코드), 한 번 잘못된 값이 섞여 들어갔을 때(예: 부분적으로만
        # 매칭된 조회 결과) 그 이후 "성공"한 조회에서도 계속 대물림되는 문제가
        # 있었다 - 그래서 재조회가 성공한 이상 매칭 안 된 사람은 명시적으로
        # 0승 0패로 확정한다(기존 값을 참조하지 않음). 재조회 자체가 실패했을
        # 때(위 if not sponsor_list 분기)만 기존 값을 그대로 보존한다.
        lookup = _index_by_elo_id(sponsor_list)
        for m in archive.get("members", []):
            elo_id = m.get("elo_id")
            src = lookup.get(str(elo_id)) if elo_id is not None else None
            new_wins = src["sponsor_wins"] if src else 0
            new_losses = src["sponsor_losses"] if src else 0
            if m.get("sponsor_wins") != new_wins or m.get("sponsor_losses") != new_losses:
                m["sponsor_wins"] = new_wins
                m["sponsor_losses"] = new_losses
                changed = True
                sponsor_changed = True

    if changed:
        archive["updated_at"] = now.strftime(DATETIME_FORMAT)
        if sponsor_changed:
            # 별풍선 재확정만 성공하고 스폰전적은 실패했을 수도 있어서(위의 각 경고
            # 참고), updated_at 하나로는 스폰전적이 실제로 언제 확정됐는지 구분이
            # 안 됐다. latest.json이 이미 쓰고 있는 것과 같은 방식으로 스폰전적
            # 확정 시각을 따로 남긴다.
            archive["sponsor_updated_at"] = now.strftime(DATETIME_FORMAT)
        atomic_write_json(archive_path, archive)
        print(f"[완료] {archive_path.name} 확정됨 (별풍선 반영: {changed}, 스폰전적 반영: {sponsor_changed})")
    else:
        print(f"[정보] {archive_path.name} - 별풍선/스폰전적 둘 다 반영할 변경사항 없음 (기존 값 그대로 유지)")


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
        # 폴백용 "기존 스폰전적"은 그게 이번 달 것일 때만 의미가 있다. 예를 들어
        # 8/31->9/1로 넘어가는 첫 실행에서 엘로보드 조회가 실패하면, prev_latest는
        # 아직 8월 누적치를 들고 있는데 그걸 그대로 폴백으로 쓰면 "9월인데 8월
        # 스폰전적이 그대로 보이는" 상태가 된다 - sponsor_month가 이번 달과 다르면
        # 아예 채우지 않아서, 아래 existing_sponsor.get(...)의 기본값(0승 0패)이
        # 대신 쓰이게 한다.
        current_month_str = f"{year:04d}-{month:02d}"
        if sponsor_month == current_month_str:
            for om in prev_latest.get("members", []):
                mid = om.get("id")
                if mid:
                    existing_sponsor[mid] = {
                        "sponsor_wins": om.get("sponsor_wins", 0),
                        "sponsor_losses": om.get("sponsor_losses", 0),
                    }

    # xlsx는 이번 실행에서 딱 한 번만 읽고(existing_elo_ids), 신규 인원이
    # 있으면 이 실행이 끝날 때 딱 한 번만 쓴다(new_members_acc) -
    # confirm_previous_month_if_needed()와 아래 오늘자 수집 둘 다 신규
    # elo_id를 발견할 수 있는데, 그때마다 xlsx를 열고/파싱하고/저장하면
    # 무거운 파일 I/O가 불필요하게 여러 번 발생한다.
    existing_elo_ids = set()
    if XLSX_PATH.exists():
        existing_elo_ids = {
            str(fields["elo_id"]) for fields in load_xlsx_members().values()
            if fields.get("elo_id") is not None
        }
    else:
        print("[경고] members.xlsx가 없어 신규 인원 자동 등록을 건너뜁니다.", file=sys.stderr)
    new_members_acc = {}

    # 1. 날짜 전환 아카이빙 - 아직 오늘자 데이터를 하나도 안 가져온 상태라, 어제
    #    마지막 상태 그대로 안전하게 확정된다.
    archive_previous_day_if_needed(prev_latest, today_date_str)

    # 2. 월 전환 확정 - 별풍선/스폰전적 둘 다, 방금 1번에서 이미 만들어졌을 아카이브에.
    confirm_previous_month_if_needed(prev_year, prev_month, year, month, all_ids, now, existing_elo_ids, new_members_acc)

    # 3. 소급 정정 적용
    apply_member_updates_to_archives(members, today_date_str)

    # 4. 오늘자 데이터 새로 수집 (풍고/엘로보드 순서는 이제 상관없다 - 둘 다 latest.json을
    #    직접 안 건드리는 순수 fetch라서)
    print(f"[수집] 풍고 별풍선 ({today_date_str}, {len(all_ids)}명)...")
    balloon_data = fetch_poonggo_monthly(year, month, all_ids)
    if balloon_data is None:
        raise SystemExit("[오류] 별풍선 데이터를 가져오지 못했습니다.")

    sponsor_data = {}
    sponsor_collection_succeeded = False
    start_date, end_date = get_month_date_range(now)
    print(f"[수집] 엘로보드 스폰전적 ({start_date}~{end_date})...")
    try:
        sponsor_list = aggregate_period_data(start_date, end_date)
    except Exception as e:
        print(f"[경고] 엘로보드 수집 중 오류: {e} - 기존 스폰전적 유지", file=sys.stderr)
        sponsor_list = []
    if sponsor_list:
        new_members_acc.update(_collect_unknown_elo_players(sponsor_list, existing_elo_ids))
        # sponsor_list의 "id"는 elo_id(숫자 문자열) 그대로다. 별도 변환 없이 elo_id를
        # 키로 저장해두고, out_members를 만들 때 각 멤버의 elo_id로 바로 조회한다.
        sponsor_data = _index_by_elo_id(sponsor_list)
        sponsor_collection_succeeded = True
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

        if sd:
            sponsor_wins, sponsor_losses = sd["sponsor_wins"], sd["sponsor_losses"]
        elif sponsor_collection_succeeded:
            # 이번 조회는 성공했는데(sponsor_list가 비어있지 않았는데) 이 사람만
            # 없음 -> 그 달 진짜 0판이라는 뜻이다(API가 참가자만 돌려주고 0판인
            # 사람은 아예 안 준다). existing(기존 값)을 참조하지 않고 명시적으로
            # 0으로 확정한다 - 그래야 한 번 잘못된 값이 섞여 들어가도(예: 이전에
            # 일부만 매칭된 조회) 다음 성공한 조회에서 저절로 정정된다.
            sponsor_wins, sponsor_losses = 0, 0
        else:
            # 이번 조회 자체가 실패했을 때만 기존 값을 그대로 보존한다.
            existing = existing_sponsor.get(member_id, {"sponsor_wins": 0, "sponsor_losses": 0})
            sponsor_wins, sponsor_losses = existing["sponsor_wins"], existing["sponsor_losses"]

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
            "sponsor_wins": sponsor_wins,
            "sponsor_losses": sponsor_losses,
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

    # 이번 실행 동안 발견된 신규 elo_id가 있으면(월 확정 재조회 + 오늘자 수집
    # 둘 다에서 나온 걸 다 모아서) 여기서 딱 한 번만 xlsx에 쓴다.
    if new_members_acc:
        write_xlsx({}, list(new_members_acc.values()))
        print(f"[완료] 총 {len(new_members_acc)}명의 신규 임시 프로필이 members.xlsx에 추가되었습니다.")


if __name__ == "__main__":
    main()
