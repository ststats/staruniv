"""
EloBoard의 티어 목록 API(/api/tiers)를 조회해서 data/members.xlsx를 최신
정보로 동기화하는 스크립트.

data/members.xlsx가 로스터의 유일한 원본이므로(members.json은
convert_members_xlsx.py가 xlsx로부터 매번 새로 파생시키는 결과물), 이
스크립트도 xlsx를 직접 읽고 쓴다. members.json은 여기서 아예 건드리지 않는다
- update-stats.yml에서 이 스크립트 다음에 convert_members_xlsx.py가 돌면서
자동으로 반영된다.

동작:
1. EloBoard API에서 티어별 플레이어 목록을 가져와 평탄화(flatten)한다
   (API 구조 예시: {{"tiers": [{{"key": "god", "label": "갓", "players": [...]}}, ...]}})
2. soop_id 기준으로 xlsx의 기존 행과 매칭:
   - 이미 있는 사람 -> nickname/race/tier/team을 API 값으로 갱신할지는 파일 맨 위
     UPDATE_EXISTING_* 스위치로 필드별 on/off 가능(기본: 닉네임은 꺼짐, 나머지는 켜짐).
     elo_id/birthdate/gender/role/수정일처럼 사람이 직접 관리하는 필드는 이
     스위치들과 무관하게 항상 건드리지 않는다.
   - 없는 사람 -> xlsx에 새 행으로 추가. 이 스위치들과 무관하게 항상 API 값으로 채운다.
     birthdate는 확인 전이므로 "체크" 같은 임시 문자열이 아니라 빈 칸으로 남긴다.
3. 바뀐 게 있으면 xlsx에 다시 저장한다.

xlsx가 아예 없으면(최초 셋업 전) 에러로 종료한다 - 이 경우엔 사람이 먼저
엑셀 파일을 만들어야 한다.

실행:
  python scripts/sync_members.py --dry-run   (미리보기, 파일 안 바꿈)
  python scripts/sync_members.py             (실제 반영)
"""

import sys
import argparse

from _common import fetch_json, XLSX_PATH, load_xlsx_members, write_xlsx

TIERS_URL = "https://eloboard.co.kr/api/tiers"

# 기존 사람(이미 xlsx에 있는 사람)을 API 값으로 갱신할지 필드별로 켜고 끄는
# 스위치. False로 두면 그 필드는 API에 뭐가 오든 기존 값을 그대로 유지한다.
# (신규 추가에는 영향 없음 - 새로 추가되는 사람은 항상 API 값으로 채워진다.)
UPDATE_EXISTING_NICKNAME = False
UPDATE_EXISTING_RACE = True
UPDATE_EXISTING_TIER = True
UPDATE_EXISTING_TEAM = True

# race 값 변환 맵 (필요에 따라 추가/수정)
RACE_MAP = {
    "T": "테란",
    "Z": "저그",
    "P": "프로토스",
    "R": "랜덤",
}


def normalize_tier(label):
    """API가 주는 티어 label에서 "티어" 접미사를 뗀다 - 예: "1티어" -> "1".
    이 프로젝트의 tier 값은 "갓/킹/잭/조커/스페이드/0~8/유스"처럼 접미사 없는
    형태를 쓰기 때문(README 참고). "갓"처럼 애초에 "티어"가 안 붙은 label은
    그대로 통과된다."""
    if isinstance(label, str) and label.endswith("티어"):
        return label[:-len("티어")].strip()
    return label


def flatten_players(api_data: dict) -> list:
    """API 구조는 티어별 그룹 형태이므로 모든 플레이어를 하나의 리스트로 펼치면서
    각 플레이어에 current_tier(그 그룹의 label, "티어" 접미사는 뗀 값)를 붙여준다."""
    players = []
    for tier_obj in api_data.get("tiers") or []:
        tier_label = normalize_tier(tier_obj.get("label"))
        for player in tier_obj.get("players") or []:
            players.append({**player, "current_tier": tier_label})
    return players


def main(argv=None):
    """argv=None이면 sys.argv[1:]를 읽는다 - 테스트에서 main(argv=[])처럼
    명시적으로 넘기면 pytest 자체 옵션(-v 등)과 충돌하지 않는다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 변경될 내용만 출력")
    args = parser.parse_args(argv)

    if not XLSX_PATH.exists():
        print(f"[오류] {XLSX_PATH}가 없습니다. 먼저 엑셀 파일을 만들어주세요.", file=sys.stderr)
        sys.exit(1)

    member_map = load_xlsx_members()

    print(f"[시작] {TIERS_URL} 조회 중...")
    api_data = fetch_json(TIERS_URL, label="엘로보드 티어 목록")
    if api_data is None:
        print("[오류] 엘로보드 API 조회 실패 - xlsx를 건드리지 않고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    api_players = flatten_players(api_data)
    print(f"[준비] API에서 {len(api_players)}명 확인, 기존 xlsx엔 {len(member_map)}명")

    updates = {}
    appends = []
    for api_player in api_players:
        soop_id = api_player.get("soop_id")
        if not soop_id:
            continue

        converted_race = RACE_MAP.get(api_player.get("race"), api_player.get("race"))
        team_name = api_player.get("college") or ""

        existing = member_map.get(soop_id)
        if existing:
            before = (existing.get("nickname"), existing.get("race"), existing.get("tier"), existing.get("team"))
            new_fields = dict(existing)
            if UPDATE_EXISTING_NICKNAME:
                new_fields["nickname"] = api_player.get("name") or existing.get("nickname")
            if UPDATE_EXISTING_RACE:
                new_fields["race"] = converted_race or existing.get("race")
            if UPDATE_EXISTING_TIER:
                new_fields["tier"] = api_player.get("current_tier") or existing.get("tier")
            if UPDATE_EXISTING_TEAM:
                new_fields["team"] = team_name if team_name != "" else existing.get("team")
            # elo_id/birthdate/gender/role/수정일은 이 스위치들과 무관하게
            # 항상 사람이 직접 관리하는 필드라 여기서 절대 안 건드린다
            # (dict(existing)로 복사해왔으니 손 안 댄 필드는 원래 값 그대로다).
            after = (new_fields.get("nickname"), new_fields.get("race"), new_fields.get("tier"), new_fields.get("team"))
            if before != after:
                updates[soop_id] = new_fields
        else:
            new_member = {
                "id": soop_id,
                "nickname": api_player.get("name"),
                "elo_id": api_player.get("player_id"),
                "birthdate": None,
                "gender": "f" if api_player.get("division") == "women" else "m",
                "race": converted_race,
                "tier": api_player.get("current_tier"),
                "team": team_name,
                "role": "",
                "info_updated_at": None,
            }
            appends.append(new_member)

    if args.dry_run:
        for soop_id, fields in updates.items():
            print(f"  [갱신 예정] {soop_id}: -> {fields}")
        for m in appends:
            print(f"  [추가 예정] {m['id']} ({m['nickname']})")
        print(f"[dry-run 완료] 갱신 {len(updates)}명, 신규 추가 {len(appends)}명 (파일은 안 건드림)")
        return

    if updates or appends:
        write_xlsx(updates, appends)
        print(f"[완료] members.xlsx 갱신됨 (기존 정보 갱신 {len(updates)}명, 신규 추가 {len(appends)}명)")
    else:
        print("[완료] 변경 없음")


if __name__ == "__main__":
    main()
