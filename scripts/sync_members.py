"""
EloBoard의 티어 목록 API(/api/tiers)를 조회해서 data/members.json을 최신 정보로
동기화하는 스크립트. members.js(Node.js로 작성된 원본)를 이 레포의 나머지 스크립트와
스타일을 맞춰 Python으로 옮긴 것 - 공용 HTTP 재시도 헬퍼(_common.fetch_json)를 쓰고,
로그 형식([시작]/[완료]/[경고])도 update_data.py 등과 통일했다.

동작:
1. EloBoard API에서 티어별 플레이어 목록을 가져와 평탄화(flatten)한다
   (API 구조 예시: {{"tiers": [{{"key": "god", "label": "갓", "players": [...]}}, ...]}})
2. soop_id(=members.json의 "id") 기준으로 기존 멤버와 매칭:
   - 이미 있는 멤버 -> nickname/race/tier/team을 API 값으로 갱신할지는 파일 맨 위
     UPDATE_EXISTING_* 스위치로 필드별 on/off 가능(기본: 닉네임은 꺼짐, 나머지는 켜짐).
     elo_id/birthdate/gender/role/info_updated_at처럼 이 프로젝트에서 사람이 직접
     관리하는 필드는 이 스위치들과 무관하게 항상 건드리지 않는다.
   - 없는 멤버 -> 새로 추가. 이 스위치들과 무관하게 항상 API 값으로 채운다.
     birthdate는 확인 전이므로 "체크" 같은 임시 문자열이 아니라 null로 넣는다
     (README에 정리된 프로젝트 컨벤션 - null이 아닌 임시 문자열은 나중에 실제
     값으로 채우는 걸 잊기 쉬워서 지양한다).
3. members.json에 그대로 다시 저장한다.

members.json은 admin.html에서 사람이 직접 관리하는 원본 파일이지만, update-stats.yml
안에서 매일 자동으로도 실행된다(Update data 스텝보다 먼저 돌아서, 그날 새로 추가된
멤버의 별풍선/스폰전적도 같은 날 바로 수집되게 한다). 그 자동 실행은
continue-on-error로 감싸져 있어서, 이 스크립트가 실패해도(엘로보드 API 일시 장애 등)
나머지 데이터 수집엔 영향을 주지 않는다. 필요하면 .github/workflows/sync-members.yml로
수동 실행 + dry-run 미리보기도 가능하다.

실행:
  python scripts/sync_members.py --dry-run   (미리보기, 파일 안 바꿈)
  python scripts/sync_members.py             (실제 반영)
"""

import sys
import argparse

from _common import ROOT, fetch_json, atomic_write_json, safe_read_json, validate_and_clean_members

MEMBERS_PATH = ROOT / "data" / "members.json"
TIERS_URL = "https://eloboard.co.kr/api/tiers"

# 기존 멤버(이미 members.json에 있는 사람)를 API 값으로 갱신할지 필드별로 켜고 끄는
# 스위치. False로 두면 그 필드는 API에 뭐가 오든 기존 값을 그대로 유지한다.
# (신규 멤버 추가에는 영향 없음 - 새로 추가되는 사람은 항상 API 값으로 채워진다.)
UPDATE_EXISTING_NICKNAME = False
UPDATE_EXISTING_RACE = False
UPDATE_EXISTING_TIER = False
UPDATE_EXISTING_TEAM = False

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
    """argv=None이면 sys.argv[1:]를 읽는다 - convert_members_xlsx.py와 같은 이유로,
    테스트에서 main(argv=[])처럼 명시적으로 넘기면 pytest 자체 옵션(-v 등)과
    충돌하지 않는다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 변경될 내용만 출력")
    args = parser.parse_args(argv)

    local_data = {"members": []}
    if MEMBERS_PATH.exists():
        local_data = safe_read_json(MEMBERS_PATH, default={"members": []})

    local_data["members"] = validate_and_clean_members(local_data.get("members", []))
    member_map = {m["id"]: m for m in local_data["members"]}

    print(f"[시작] {TIERS_URL} 조회 중...")
    api_data = fetch_json(TIERS_URL, label="엘로보드 티어 목록")
    if api_data is None:
        print("[오류] 엘로보드 API 조회 실패 - members.json을 건드리지 않고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    api_players = flatten_players(api_data)
    print(f"[준비] API에서 {len(api_players)}명 확인, 기존 members.json엔 {len(member_map)}명")

    updated, added = [], []
    for api_player in api_players:
        soop_id = api_player.get("soop_id")
        if not soop_id:
            continue

        converted_race = RACE_MAP.get(api_player.get("race"), api_player.get("race"))
        team_name = api_player.get("college") or ""

        existing = member_map.get(soop_id)
        if existing:
            before = (existing.get("nickname"), existing.get("race"), existing.get("tier"), existing.get("team"))
            if UPDATE_EXISTING_NICKNAME:
                existing["nickname"] = api_player.get("name") or existing.get("nickname")
            if UPDATE_EXISTING_RACE:
                existing["race"] = converted_race or existing.get("race")
            if UPDATE_EXISTING_TIER:
                existing["tier"] = api_player.get("current_tier") or existing.get("tier")
            if UPDATE_EXISTING_TEAM:
                existing["team"] = team_name if team_name != "" else existing.get("team")
            # elo_id/birthdate/gender/role/info_updated_at은 이 스위치들과 무관하게
            # 항상 사람이 직접 관리하는 필드라 여기서 절대 안 건드린다.
            after = (existing.get("nickname"), existing.get("race"), existing.get("tier"), existing.get("team"))
            if before != after:
                updated.append((soop_id, before, after))
        else:
            new_member = {
                "nickname": api_player.get("name"),
                "id": soop_id,
                "elo_id": api_player.get("player_id"),
                "birthdate": None,
                "gender": "f" if api_player.get("division") == "women" else "m",
                "race": converted_race,
                "tier": api_player.get("current_tier"),
                "team": team_name,
                "role": "",
                "info_updated_at": None,
            }
            local_data.setdefault("members", []).append(new_member)
            member_map[soop_id] = new_member
            added.append((soop_id, new_member["nickname"]))

    if args.dry_run:
        for soop_id, before, after in updated:
            print(f"  [갱신 예정] {soop_id}: {before} -> {after}")
        for soop_id, nickname in added:
            print(f"  [추가 예정] {soop_id} ({nickname})")
        print(f"[dry-run 완료] 갱신 {len(updated)}명, 신규 추가 {len(added)}명 (파일은 안 건드림)")
        return

    atomic_write_json(MEMBERS_PATH, local_data)

    print(f"[완료] members.json 갱신됨 (기존 정보 갱신 {len(updated)}명, 신규 추가 {len(added)}명)")


if __name__ == "__main__":
    main()
