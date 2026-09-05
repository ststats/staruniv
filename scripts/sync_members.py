"""
EloBoard의 티어 목록 API(/api/tiers)를 조회해서 구글 시트를 최신 정보로 동기화하는 스크립트.
"""

import sys
import argparse

from _common import fetch_json, is_sheet_ready, load_sheet_members, write_sheet

TIERS_URL = "https://eloboard.co.kr/api/tiers"

UPDATE_EXISTING_NICKNAME = False
UPDATE_EXISTING_RACE = False
UPDATE_EXISTING_TIER = False
UPDATE_EXISTING_TEAM = False

RACE_MAP = {
    "T": "테란",
    "Z": "저그",
    "P": "프로토스",
    "R": "랜덤",
}

def normalize_tier(label):
    if isinstance(label, str) and label.endswith("티어"):
        return label[:-len("티어")].strip()
    return label

def flatten_players(api_data: dict) -> list:
    players = []
    for tier_obj in api_data.get("tiers") or []:
        tier_label = normalize_tier(tier_obj.get("label"))
        for player in tier_obj.get("players") or []:
            players.append({**player, "current_tier": tier_label})
    return players

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="파일을 실제로 바꾸지 않고 변경될 내용만 출력")
    args = parser.parse_args(argv)

    if not is_sheet_ready():
        print("[오류] 구글 시트 자격 증명이 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    member_map = load_sheet_members()
    # soop_id 대소문자/공백 차이 때문에 이미 있는 사람을 "신규"로 오판해서
    # 매 실행마다 같은 사람이 중복으로 계속 추가되는 걸 막기 위해, 소문자로
    # 정규화한 키로도 조회할 수 있게 별도 맵을 만든다. 시트에 실제로 저장된
    # 원래 대소문자는 그대로 보존해야 하므로(정규화된 키로 덮어쓰면 안 됨),
    # 조회는 정규화된 키로 하되 갱신은 항상 시트에 있던 원래 soop_id를 쓴다.
    normalized_to_original = {sid.strip().lower(): sid for sid in member_map}

    api_data = fetch_json(TIERS_URL, label="엘로보드 티어 목록")
    if api_data is None:
        sys.exit(1)

    api_players = flatten_players(api_data)
    
    updates = {}
    appends = []
    # API가 같은 선수를 여러 티어 그룹(예: 부문/시즌별 그룹)에 중복으로
    # 내려주는 경우, 매번 시트 스냅샷(member_map/normalized_to_original)만
    # 보고 "없는 사람"으로 판단하면 같은 사람이 이번 한 번의 실행 안에서만도
    # appends에 여러 번 쌓여 중복 행으로 추가되어버린다. 이번 실행에서 이미
    # 추가 예정으로 잡은 soop_id(정규화된 키)를 별도로 기억해뒀다가, 같은
    # 사람이 또 나오면 건너뛴다.
    pending_normalized_ids = set()
    for api_player in api_players:
        soop_id = api_player.get("soop_id")
        if not soop_id:
            continue

        normalized_id = soop_id.strip().lower()
        converted_race = RACE_MAP.get(api_player.get("race"), api_player.get("race"))
        team_name = api_player.get("college") or ""

        # API가 주는 soop_id의 대소문자/공백이 시트에 저장된 것과 다를 수 있어서,
        # 정규화된 키로 먼저 조회하고, 찾았으면 시트에 있던 원래 키를 그대로 쓴다
        # (updates 딕셔너리의 키가 write_sheet()에서 실제 행을 찾는 기준이라,
        # 여기서 원래 키를 안 쓰면 기존 행을 못 찾고 또 새 행으로 추가돼버린다).
        original_soop_id = normalized_to_original.get(normalized_id)
        existing = member_map.get(original_soop_id) if original_soop_id else None
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
            
            after = (new_fields.get("nickname"), new_fields.get("race"), new_fields.get("tier"), new_fields.get("team"))
            if before != after:
                updates[original_soop_id] = new_fields
        else:
            if normalized_id in pending_normalized_ids:
                # 이번 실행에서 이미 같은 사람을 신규로 추가하기로 했다
                # (API가 같은 선수를 여러 그룹에 중복으로 내려준 경우).
                # 또 추가하면 중복 행이 생기므로 건너뛴다.
                continue
            pending_normalized_ids.add(normalized_id)
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
        print(f"[dry-run 완료] 갱신 {len(updates)}명, 신규 추가 {len(appends)}명 (구글 시트는 안 건드림)")
        return

    if updates or appends:
        write_sheet(updates, appends)
        print(f"[완료] 구글 시트 갱신됨 (기존 정보 갱신 {len(updates)}명, 신규 추가 {len(appends)}명)")
    else:
        print("[완료] 변경 없음")

if __name__ == "__main__":
    main()
