"""Supabase PostgreSQL의 핵심 테이블을 기존 data/db.json 형식으로 내보낸다.

기존 generate_stats.py / build_html.py가 전혀 바뀌지 않도록 한글 JSON 키를 복원한다.
필수 환경변수: SUPABASE_DB_URL
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "db.json"


def empty(value):
    """DB NULL -> 기존 JSON의 빈 문자열."""
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return value


def number_or_text(value):
    """DB에 text로 둔 혼합형 칼럼을 기존 JSON의 int/string 형태로 복원한다."""
    value = empty(value)
    if value == "":
        return ""
    s = str(value).strip()
    if s and (s.isdigit() or (s.startswith("-") and s[1:].isdigit())):
        try:
            return int(s)
        except ValueError:
            pass
    return value


def gender_text(value):
    """공개 페이지는 성별을 '남자'/'여자'로 비교한다(홈 방송 카드, 방송통계 남녀 표).
    관리자에서 '남'/'여' 같은 줄임말로 저장된 값도 같은 표기로 맞춘다."""
    raw = empty(value)
    if raw is None:
        return raw
    text = str(raw).strip()
    if text in ("남", "남성", "남자") or text.upper() in ("M", "MALE"):
        return "남자"
    if text in ("여", "여성", "여자") or text.upper() in ("F", "FEMALE"):
        return "여자"
    return raw


def fetch(conn, query):
    from psycopg.rows import dict_row
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query)
        return cur.fetchall()


def build_db(settings, teams, members, matches, rounds, tier_members):
    return {
        "settings": [
            {"시즌": empty(r["season"]), "날짜": empty(r["start_date"])}
            for r in settings
        ],
        "teams": [
            {
                "팀": empty(r["team_name"]),
                "설립자": empty(r["founders"]),
                "창단일": empty(r["founded_date"]),
                "해체일": empty(r["disbanded_date"]),
                "비고": empty(r["note"]),
                "우승": empty(r["championship"]),
            }
            for r in teams
        ],
        "members": [
            {
                # 기존 사이트에서 members의 "이름"은 표시 닉네임으로 사용한다.
                "이름": empty(r["nickname"]),
                "SOOP ID": number_or_text(r["soop_id"]),
                "생년월일": empty(r["birth_date"]),
                "성별": gender_text(r["gender"]),
                "종족": empty(r["race"]),
                "입단 티어": number_or_text(r["join_tier"]),
                "티어": number_or_text(r["tier"]),
                "직책": empty(r["role"]),
                "입단일": empty(r["joined_date"]),
                "퇴단일": empty(r["left_date"]),
                "MBTI": empty(r["mbti"]),
                "YouTube": empty(r.get("youtube_url")),
            }
            for r in members
        ],
        "matches": [
            {
                "매치 번호": r["match_no"],
                "날짜": empty(r["match_date"]),
                "상대팀": empty(r["opponent_team"]),
                "형식": empty(r["match_format"]),
                "방식": empty(r["method"]),
                "최종 결과": empty(r["final_result"]),
                "세트 결과": empty(r["set_result"]),
                "득실": empty(r["score_diff"]),
                "펀딩": number_or_text(r["funding"]),
                "지원금": number_or_text(r["support_amount"]),
                "사비": number_or_text(r["personal_amount"]),
                "도전미션": number_or_text(r["challenge_mission"]),
            }
            for r in matches
        ],
        "rounds": [
            {
                "매치 번호": r["match_no"],
                "날짜": empty(r["match_date"]),
                "상대팀": empty(r["opponent_team"]),
                "형식": empty(r["match_format"]),
                "세트": empty(r["set_name"]),
                "라운드": empty(r["round_name"]),
                "우리 선수": empty(r["our_player"]),
                "우리 종족": empty(r["our_race"]),
                "우리 티어": number_or_text(r["our_tier"]),
                "결과": empty(r["result"]),
                "상대 선수": empty(r["opponent_player"]),
                "상대 종족": empty(r["opponent_race"]),
                "상대 티어": number_or_text(r["opponent_tier"]),
                "맵": empty(r["map_name"]),
                "_mirrored": bool(r["is_mirrored"]),
            }
            for r in rounds
        ],
        "tierMembers": [
            {
                "이름": empty(r["name"]),
                "닉네임": empty(r["nickname"]),
                "SOOP ID": number_or_text(r["soop_id"]),
                "ELO ID": empty(r["elo_id"]),
                "생년월일": empty(r["birth_date"]),
                "성별": empty(r["gender"]),
                "종족": empty(r["race"]),
                "티어": number_or_text(r["tier"]),
                "소속": empty(r["affiliation"]),
                "직책": empty(r["role"]),
                "수정일": empty(r["modified_at"]),
                "연혁": empty(r["history"]),
                "시작": empty(r["started_on"]),
                "ELO 등록": empty(r["elo_registered"]),
                "티어표 등록": empty(r["tier_table_registered"]),
                "8티어 승급": empty(r["promoted_tier_8"]),
                "7티어 승급": empty(r["promoted_tier_7"]),
                "6티어 승급": empty(r["promoted_tier_6"]),
                "5티어 승급": empty(r["promoted_tier_5"]),
                "4티어 승급": empty(r["promoted_tier_4"]),
                "3티어 승급": empty(r["promoted_tier_3"]),
                "2티어 승급": empty(r["promoted_tier_2"]),
                "1티어 승급": empty(r["promoted_tier_1"]),
                "0티어 승급": empty(r["promoted_tier_0"]),
            }
            for r in tier_members
        ],
    }


def main():
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("❌ SUPABASE_DB_URL 환경변수가 없습니다.")

    import psycopg

    with psycopg.connect(dsn) as conn:
        # 여러 표를 한 읽기 시점에서 읽는다(내보내는 도중 관리자가 경기·라운드를 고쳐도
        # 경기는 옛 값, 라운드는 새 값처럼 섞이지 않게). 읽기만 하므로 read only.
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = True
        settings = fetch(conn, "select * from public.settings order by source_order")
        teams = fetch(conn, "select * from public.teams order by source_order")
        members = fetch(conn, "select * from public.members order by source_order")
        matches = fetch(conn, "select * from public.matches order by source_order")
        rounds = fetch(conn, "select * from public.rounds_effective order by source_order, is_mirrored")
        tier_members = fetch(conn, "select * from public.tier_members order by source_order")

    required = {
        "settings": settings,
        "teams": teams,
        "members": members,
        "matches": matches,
        "rounds": rounds,
        "tier_members": tier_members,
    }
    missing = [name for name, rows in required.items() if not rows]
    if missing:
        sys.exit(f"❌ Supabase 테이블이 비어 있습니다: {', '.join(missing)}. 기존 db.json은 건드리지 않습니다.")

    db = build_db(settings, teams, members, matches, rounds, tier_members)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, OUTPUT_PATH)

    print("✅ Supabase -> data/db.json 내보내기 완료")
    for key, rows in db.items():
        print(f"   {key:12s}: {len(rows):,}행")


if __name__ == "__main__":
    main()
