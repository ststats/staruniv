from __future__ import annotations

import json
from pathlib import Path

from match_link import load_linked_db

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
STATS_PATH = ROOT / "data" / "render_stats.json"
OUT_DIR = ROOT / "docs" / "data"
OUT_PATH = OUT_DIR / "site_data.json"

SITE_MEMBER_FIELDS = [
    "이름", "SOOP ID", "생년월일", "성별", "종족", "티어",
    "직책", "입단일", "퇴단일", "MBTI",
]
SITE_MATCH_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "방식",
    "최종 결과", "세트 결과", "_match_key",
]
SITE_ROUND_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "세트", "라운드",
    "우리 선수", "결과", "상대 선수", "맵", "_match_key", "_mirrored",
]
SITE_PLAYER_STAT_FIELDS = [
    "이름", "대회 전적", "대학 전적", "미니 전적", "CK 전적",
    "테란전 전적", "저그전 전적", "프로토스전 전적", "상대전적",
]

ROLE_ORDER = {
    "총장": 0, "교수": 1, "코치": 2, "매니저": 3,
    "선수": 10, "학생": 10,
}

TIER_ORDER = [
    "갓", "킹", "잭", "스페이드",
    "0티어", "1티어", "2티어", "3티어", "4티어",
    "5티어", "6티어", "7티어", "8티어",
]


def pick(row: dict, fields: list[str]) -> dict:
    return {key: row[key] for key in fields if key in row}


def tier_index(value) -> int:
    text = str(value or "").strip()
    try:
        return TIER_ORDER.index(text)
    except ValueError:
        return 999


def sort_members(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (
            ROLE_ORDER.get(str(row.get("직책") or "선수"), 99),
            tier_index(row.get("티어")),
        ),
    )


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"missing: {DB_PATH}")
    if not STATS_PATH.exists():
        raise SystemExit(f"missing: {STATS_PATH}")

    with STATS_PATH.open("r", encoding="utf-8") as f:
        stats_data = json.load(f)

    db_data, linked_matches, linked_rounds = load_linked_db(str(DB_PATH))

    members = sort_members(db_data.get("members", []))
    matches = sorted(
        linked_matches,
        key=lambda row: str(row.get("날짜", "")),
        reverse=True,
    )
    rounds = sorted(
        linked_rounds,
        key=lambda row: str(row.get("날짜", "")),
        reverse=True,
    )
    member_stats = (
        stats_data.get("member_stats", {}).get("전체", [])
        if isinstance(stats_data, dict)
        else []
    )

    payload = {
        "members": [pick(row, SITE_MEMBER_FIELDS) for row in members],
        "matches": [pick(row, SITE_MATCH_FIELDS) for row in matches],
        "rounds": [pick(row, SITE_ROUND_FIELDS) for row in rounds],
        "playersStats": [pick(row, SITE_PLAYER_STAT_FIELDS) for row in member_stats],
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    temp = OUT_PATH.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temp.replace(OUT_PATH)

    print(
        f"✅ site_data.json 생성 완료: "
        f"members={len(payload['members'])}, "
        f"matches={len(payload['matches'])}, "
        f"rounds={len(payload['rounds'])}, "
        f"playersStats={len(payload['playersStats'])}"
    )


if __name__ == "__main__":
    main()
