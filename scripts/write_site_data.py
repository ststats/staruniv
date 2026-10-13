"""data/db.json으로 전적 묶음(docs/data/site_records_v2.json)을 만든다."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from match_link import load_linked_db

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
OUT_DIR = ROOT / "docs" / "data"
OUT_PATHS = {
    "records": OUT_DIR / "site_records_v2.json",
}
SITE_MATCH_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "방식",
    "최종 결과", "세트 결과", "_match_key",
]
SITE_ROUND_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "세트", "라운드",
    "우리 선수", "결과", "상대 선수", "맵", "_match_key", "_mirrored",
]
STAT_FORMATS = ["대회", "대학", "미니", "CK"]
STAT_RACES = [("T", "테란전"), ("Z", "저그전"), ("P", "프로토스전")]
# 붙여넣기로 섞여 드는 폭 없는 공백·BOM 등. '승'에 붙으면 집계에서 조용히 빠진다.
INVISIBLE_CHARS = re.compile(r"[​-‍⁠﻿ ᠎]")

def clean(value) -> str:
    return "" if value is None else INVISIBLE_CHARS.sub("", str(value)).strip()


# DB가 저장할 때 종족 이름을 이 셋으로 맞춘다(staruniv.sql 10번).
RACE_CODE = {"테란": "T", "저그": "Z", "프로토스": "P"}


def race_code(value) -> str:
    return RACE_CODE.get(clean(value), "")


def player_stats(rounds: list[dict]) -> list[dict]:
    """선수별 형식별·상대 종족별 승패 수."""
    counts: Counter = Counter()
    players = set()
    for row in rounds:
        name = clean(row.get("우리 선수"))
        if not name:
            continue
        players.add(name)
        result = clean(row.get("결과"))
        counts[(name, "fmt", clean(row.get("형식")), result)] += 1
        counts[(name, "race", race_code(row.get("상대 종족")), result)] += 1

    def wl(name, kind, key):
        return {"wins": counts[(name, kind, key, "승")], "losses": counts[(name, kind, key, "패")]}

    return [
        {
            "이름": name,
            **{f"{fmt} 전적": wl(name, "fmt", fmt) for fmt in STAT_FORMATS},
            **{f"{label} 전적": wl(name, "race", race) for race, label in STAT_RACES},
        }
        for name in sorted(players)
    ]


def pick(row: dict, fields: list[str]) -> dict:
    return {key: row[key] for key in fields if key in row}


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"missing: {DB_PATH}")
    linked_matches, linked_rounds = load_linked_db(str(DB_PATH))

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

    records_payload = {
        "schemaVersion": 2,
        "matches": [pick(row, SITE_MATCH_FIELDS) for row in matches],
        "rounds": [pick(row, SITE_ROUND_FIELDS) for row in rounds],
        "playersStats": player_stats(linked_rounds),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in (("records", records_payload),):
        path = OUT_PATHS[name]
        temp = path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temp.replace(path)

    (OUT_DIR / 'site_records.json').unlink(missing_ok=True)

    print(
        f"✅ 사이트 데이터(전적) 생성 완료: "
        f"matches={len(records_payload['matches'])}, "
        f"rounds={len(records_payload['rounds'])}, "
        f"playersStats={len(records_payload['playersStats'])}"
    )


if __name__ == "__main__":
    main()
