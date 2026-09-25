from __future__ import annotations

import json
import re
from pathlib import Path

from match_link import load_linked_db

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
STATS_PATH = ROOT / "data" / "render_stats.json"
OUT_DIR = ROOT / "docs" / "data"
OUT_PATHS = {
    "shell": OUT_DIR / "site_shell.json",
    "records": OUT_DIR / "site_records.json",
}

SITE_MEMBER_FIELDS = [
    "이름", "SOOP ID", "생년월일", "성별", "종족", "티어",
    "직책", "입단일", "퇴단일", "MBTI", "YouTube",
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

# 멤버 순서: 멤버 현황 페이지(page-members.js)와 같다 - 감독 → 코치 → 선수 → 그 밖의 직책,
# 같은 직책 안에서는 티어 높은 순, 같은 티어면 입단순(같은 날이면 이름순). 선택 바(멤버 공지·개인 전적)가 이 순서를 그대로 쓴다.
# (예전 키는 총장/교수였고 티어도 '3티어' 꼴만 알아서, 감독이 맨 뒤로 가고 선수는 티어순이 안 됐다.)
def load_site_order() -> dict:
    """core.js 맨 위 SITE_ORDER 블록(티어·직책 순서)을 읽는다 - 순서는 거기 한 곳에서만 고친다."""
    text = (ROOT / "templates" / "assets" / "core.js").read_text(encoding="utf-8")
    match = re.search(r"const SITE_ORDER = (\{.*?\n\});", text, re.S)
    if not match:
        raise SystemExit("core.js에서 SITE_ORDER를 찾지 못했습니다.")
    return json.loads(match.group(1))


SITE_ORDER = load_site_order()
ROLE_ORDER = {role: i for i, role in enumerate(SITE_ORDER["roles"])}
TIER_ORDER = SITE_ORDER["tiers"]   # DB에는 '3'처럼 숫자만 들어 있다


def pick(row: dict, fields: list[str]) -> dict:
    return {key: row[key] for key in fields if key in row}


def tier_index(value) -> int:
    text = str(value or "").strip().removesuffix("티어")
    try:
        return TIER_ORDER.index(text)
    except ValueError:
        return len(TIER_ORDER)


def sort_members(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (
            ROLE_ORDER.get(str(row.get("직책") or "선수"), len(ROLE_ORDER)),
            tier_index(row.get("티어")),
            str(row.get("입단일") or "9999"),
            str(row.get("이름") or ""),
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

    shell_payload = {
        "members": [pick(row, SITE_MEMBER_FIELDS) for row in members],
        "matchCount": len(matches),
        # 내전은 양쪽 선수 기록을 위해 세트를 뒤집은 복제본(_mirrored)이 한 벌 더 있다 - 세트 수에서는 뺀다
        "roundCount": sum(1 for row in rounds if not row.get("_mirrored")),
    }
    records_payload = {
        "matches": [pick(row, SITE_MATCH_FIELDS) for row in matches],
        "rounds": [pick(row, SITE_ROUND_FIELDS) for row in rounds],
        "playersStats": [pick(row, SITE_PLAYER_STAT_FIELDS) for row in member_stats],
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in (("shell", shell_payload), ("records", records_payload)):
        path = OUT_PATHS[name]
        temp = path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temp.replace(path)

    print(
        f"✅ 사이트 데이터 분리 생성 완료: "
        f"members={len(shell_payload['members'])}, "
        f"matches={len(records_payload['matches'])}, "
        f"rounds={len(records_payload['rounds'])}, "
        f"playersStats={len(records_payload['playersStats'])}"
    )


if __name__ == "__main__":
    main()
