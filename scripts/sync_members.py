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
    api_data = fetch_json(TIERS_URL, label="엘로보드 티어 목록")
    if api_data is None:
        sys.exit(1)

    api_players = flatten_players(api_data)
    
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
        return

    if updates or appends:
        write_sheet(updates, appends)
        print(f"[완료] 구글 시트 갱신됨 (기존 정보 갱신 {len(updates)}명, 신규 추가 {len(appends)}명)")
    else:
        print("[완료] 변경 없음")

if __name__ == "__main__":
    main()
