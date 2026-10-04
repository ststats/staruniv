from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from match_link import load_linked_db

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
OUT_DIR = ROOT / "docs" / "data"
# 전적 묶음(site_records.json): 경기·세트와 선수별 통산 전적(계산값). 멤버 목록·프로필은 파일이 아니라
# 공개 읽기 함수(supabase/staruniv.sql 2번 api_site_members·api_member_profiles)가 그때그때 돌려준다.
OUT_PATHS = {
    "records": OUT_DIR / "site_records.json",
}
SITE_MATCH_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "방식",
    "최종 결과", "세트 결과", "_match_key",
]
SITE_ROUND_FIELDS = [
    "매치 번호", "날짜", "상대팀", "형식", "세트", "라운드",
    "우리 선수", "결과", "상대 선수", "맵", "_match_key", "_mirrored",
]
# 전적 페이지 개인 요약(도넛·합계)이 쓰는 선수별 통산 전적: 형식별 + 상대 종족별
STAT_FORMATS = ["대회", "대학", "미니", "CK"]
STAT_RACES = [("T", "테란전"), ("Z", "저그전"), ("P", "프로토스전")]
# 복사·붙여넣기로 섞여 드는 안 보이는 문자(폭 없는 공백·BOM·줄바꿈 없는 공백 등). '승 '처럼 끝에 붙으면
# 비교에서 조용히 빠지므로 양 끝 공백과 함께 지우고 센다.
INVISIBLE_CHARS = re.compile(r"[​-‍⁠﻿ ᠎]")

def clean(value) -> str:
    return "" if value is None else INVISIBLE_CHARS.sub("", str(value)).strip()


# 상대 종족 → T/Z/P(종족전 통계 칸). DB는 '테란'처럼 저장한다(staruniv.sql 11번); 예전 T/Z/P 표기도 받는다.
RACE_CODE = {"테란": "T", "저그": "Z", "프로토스": "P", "T": "T", "Z": "Z", "P": "P",
             "TERRAN": "T", "ZERG": "Z", "PROTOSS": "P", "토스": "P"}


def race_code(value) -> str:
    text = clean(value)
    return RACE_CODE.get(text.upper(), RACE_CODE.get(text, text.upper()))


def fmt_wl_rate(wins: int, losses: int) -> str:
    total = wins + losses
    return f"{wins}승 {losses}패 ({wins / total * 100:.1f}%)" if total else "-"


def player_stats(rounds: list[dict]) -> list[dict]:
    """선수(우리 선수)별 통산 '승 N패 (율%)' - 형식별(대회·대학·미니·CK)과 상대 종족별. 이름순."""
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
        return fmt_wl_rate(counts[(name, kind, key, "승")], counts[(name, kind, key, "패")])

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
    _db, linked_matches, linked_rounds = load_linked_db(str(DB_PATH))

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

    print(
        f"✅ 사이트 데이터(전적) 생성 완료: "
        f"matches={len(records_payload['matches'])}, "
        f"rounds={len(records_payload['rounds'])}, "
        f"playersStats={len(records_payload['playersStats'])}"
    )


if __name__ == "__main__":
    main()
