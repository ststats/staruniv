from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from match_link import load_linked_db

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
OUT_DIR = ROOT / "docs" / "data"
# 방송통계 TOP 대표 영상·사진: 저장소 파일 templates/static/media/members/<SOOP ID>.<확장자>(빌드 때 docs/로 복사).
# 어드민에서 올린 대표 사진(members.photo_path)이 있으면 그쪽이 먼저다.
MEMBER_MEDIA_DIR = ROOT / "templates" / "static" / "media" / "members"
MEMBER_MEDIA_EXTS = (".mp4", ".webm", ".webp", ".gif", ".jpg", ".jpeg", ".png")
OUT_PATHS = {
    "shell": OUT_DIR / "site_shell.json",
    "records": OUT_DIR / "site_records.json",
}

# '입단 티어'는 프로필 활동기간 줄, 'ELO ID'는 프로필 전적 분석 버튼, '대표 사진'은 방송통계 TOP 칸이 쓴다
# (여기 없으면 사이트에 안 넘어가서 안 보인다)
SITE_MEMBER_FIELDS = [
    "이름", "SOOP ID", "ELO ID", "생년월일", "성별", "종족", "티어", "입단 티어",
    "직책", "입단일", "퇴단일", "MBTI", "YouTube", "대표 사진",
]
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


def clean(value) -> str:
    return "" if value is None else INVISIBLE_CHARS.sub("", str(value)).strip()


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
        counts[(name, "race", clean(row.get("상대 종족")).upper(), result)] += 1

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


def member_media_url(soop_id) -> str:
    """SOOP ID의 대표 파일 주소(사이트 기준 상대 경로, 내용이 바뀌면 주소도 바뀌게 ?v=해시). 없으면 빈 문자열."""
    sid = str(soop_id or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]+", sid):
        return ""
    for ext in MEMBER_MEDIA_EXTS:
        path = MEMBER_MEDIA_DIR / f"{sid}{ext}"
        if path.is_file():
            digest = hashlib.sha1(path.read_bytes()).hexdigest()[:10]
            return f"media/members/{sid}{ext}?v={digest}"
    return ""


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"missing: {DB_PATH}")
    db_data, linked_matches, linked_rounds = load_linked_db(str(DB_PATH))

    members = sort_members(db_data.get("members", []))
    for row in members:
        # 어드민에서 올린 것(Storage 경로)이 먼저, 없으면 저장소 파일
        row["대표 사진"] = row.get("대표 사진") or member_media_url(row.get("SOOP ID"))
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

    shell_payload = {
        "members": [pick(row, SITE_MEMBER_FIELDS) for row in members],
        "matchCount": len(matches),
        # 내전은 양쪽 선수 기록을 위해 세트를 뒤집은 복제본(_mirrored)이 한 벌 더 있다 - 세트 수에서는 뺀다
        "roundCount": sum(1 for row in rounds if not row.get("_mirrored")),
    }
    records_payload = {
        "matches": [pick(row, SITE_MATCH_FIELDS) for row in matches],
        "rounds": [pick(row, SITE_ROUND_FIELDS) for row in rounds],
        "playersStats": player_stats(linked_rounds),
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
