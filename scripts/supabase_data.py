"""StarUniv의 기존 JSON 키와 Supabase 컬럼 사이의 변환 규칙.

사이트의 나머지 코드는 당분간 한글 키의 data/db.json을 계속 사용한다.
이 모듈에서만 DB 컬럼명을 영문 snake_case로 변환한다.
"""
from __future__ import annotations

from datetime import date


def blank_to_none(value):
    return None if value == "" or value is None else value


def clean_date(value):
    """정상 ISO 날짜만 date로 변환. '체크' 같은 값은 NULL 처리한다."""
    if value == "" or value is None:
        return None
    try:
        return date.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None


def as_text(value):
    if value == "" or value is None:
        return None
    return str(value)


def as_int_or_none(value):
    if value == "" or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def db_rows(db):
    """data/db.json -> {table_name: [tuple, ...]}.

    tuple 순서는 supabase/schema.sql 및 TABLE_COLUMNS와 반드시 같아야 한다.
    """
    out = {}

    out["settings"] = [
        (i, as_text(r.get("시즌")) or "", clean_date(r.get("날짜")))
        for i, r in enumerate(db.get("settings", []))
    ]

    out["teams"] = [
        (
            i,
            as_text(r.get("팀")) or "",
            as_text(r.get("설립자")),
            clean_date(r.get("창단일")),
            clean_date(r.get("해체일")),
            as_text(r.get("비고")),
            as_text(r.get("우승")),
        )
        for i, r in enumerate(db.get("teams", []))
    ]

    # members의 기존 "이름"은 실제로 해당 멤버 행에서 사용한 닉네임이다.
    # 사람의 기준 name / ELO ID는 tierMembers의 SOOP ID를 기준으로 연결한다.
    # 예: 진땅콩 T, 진땅콩 두 행은 그대로 유지하지만
    #     name=진땅콩, soop_id=wlswn6565, elo_id=775를 공유할 수 있다.
    tier_by_soop = {
        str(r.get("SOOP ID")).strip(): r
        for r in db.get("tierMembers", [])
        if r.get("SOOP ID") not in ("", None)
    }

    member_rows = []
    for i, r in enumerate(db.get("members", [])):
        nickname = as_text(r.get("이름")) or ""
        soop_id = as_text(r.get("SOOP ID"))
        canonical = tier_by_soop.get(str(soop_id).strip()) if soop_id else None
        name = as_text(canonical.get("이름")) if canonical else None
        elo_id = as_int_or_none(canonical.get("ELO ID")) if canonical else None
        member_rows.append((
            i,
            name or nickname,
            nickname,
            soop_id,
            elo_id,
            clean_date(r.get("생년월일")),
            as_text(r.get("성별")),
            as_text(r.get("종족")),
            as_text(r.get("입단 티어")),
            as_text(r.get("티어")),
            as_text(r.get("직책")),
            clean_date(r.get("입단일")),
            clean_date(r.get("퇴단일")),
            as_text(r.get("MBTI")),
        ))
    out["members"] = member_rows

    out["matches"] = [
        (
            int(r.get("매치 번호")),
            i,
            clean_date(r.get("날짜")),
            as_text(r.get("상대팀")) or "",
            as_text(r.get("형식")),
            as_text(r.get("방식")),
            as_text(r.get("최종 결과")),
            as_text(r.get("세트 결과")),
            as_text(r.get("득실")),
            as_text(r.get("펀딩")),
            as_text(r.get("지원금")),
            as_text(r.get("사비")),
            as_text(r.get("도전미션")),
        )
        for i, r in enumerate(db.get("matches", []))
    ]

    out["rounds"] = [
        (
            i,
            int(r.get("매치 번호")),
            clean_date(r.get("날짜")),
            as_text(r.get("상대팀")),
            as_text(r.get("형식")),
            as_text(r.get("세트")),
            as_text(r.get("라운드")),
            as_text(r.get("우리 선수")),
            as_text(r.get("우리 종족")),
            as_text(r.get("우리 티어")),
            as_text(r.get("결과")),
            as_text(r.get("상대 선수")),
            as_text(r.get("상대 종족")),
            as_text(r.get("상대 티어")),
            as_text(r.get("맵")),
        )
        for i, r in enumerate(db.get("rounds", []))
    ]

    out["tier_members"] = [
        (
            i,
            as_text(r.get("이름")),
            as_text(r.get("닉네임")) or "",
            as_text(r.get("SOOP ID")),
            as_int_or_none(r.get("ELO ID")),
            clean_date(r.get("생년월일")),  # '체크' 등은 NULL
            as_text(r.get("성별")),
            as_text(r.get("종족")),
            as_text(r.get("티어")),
            as_text(r.get("소속")),
            as_text(r.get("직책")),
            as_text(r.get("수정일")),
            as_text(r.get("연혁")),
            as_text(r.get("시작")),
            # 아래 둘은 한 셀에 날짜가 여러 개 들어간 행이 있어 text 보존
            as_text(r.get("ELO 등록")),
            as_text(r.get("티어표 등록")),
            as_text(r.get("8티어 승급")),
            as_text(r.get("7티어 승급")),
            as_text(r.get("6티어 승급")),
            as_text(r.get("5티어 승급")),
            as_text(r.get("4티어 승급")),
            as_text(r.get("3티어 승급")),
            as_text(r.get("2티어 승급")),
            as_text(r.get("1티어 승급")),
            as_text(r.get("0티어 승급")),
        )
        for i, r in enumerate(db.get("tierMembers", []))
    ]
    return out


TABLE_COLUMNS = {
    "settings": ["source_order", "season", "start_date"],
    "teams": ["source_order", "team_name", "founders", "founded_date", "disbanded_date", "note", "championship"],
    "members": ["source_order", "name", "nickname", "soop_id", "elo_id", "birth_date", "gender", "race", "join_tier", "tier", "role", "joined_date", "left_date", "mbti"],
    "matches": ["match_no", "source_order", "match_date", "opponent_team", "match_format", "method", "final_result", "set_result", "score_diff", "funding", "support_amount", "personal_amount", "challenge_mission"],
    "rounds": ["source_order", "match_no", "match_date", "opponent_team", "match_format", "set_name", "round_name", "our_player", "our_race", "our_tier", "result", "opponent_player", "opponent_race", "opponent_tier", "map_name"],
    "tier_members": ["source_order", "name", "nickname", "soop_id", "elo_id", "birth_date", "gender", "race", "tier", "affiliation", "role", "modified_at", "history", "started_on", "elo_registered", "tier_table_registered", "promoted_tier_8", "promoted_tier_7", "promoted_tier_6", "promoted_tier_5", "promoted_tier_4", "promoted_tier_3", "promoted_tier_2", "promoted_tier_1", "promoted_tier_0"],
}


def elo_rows(elo):
    categories = [(i, str(name)) for i, name in enumerate(elo.get("cats", []))]
    maps = [(int(k), str(v)) for k, v in elo.get("maps", {}).items()]
    players = [(int(k), str(v[0]), str(v[1]) if len(v) > 1 and v[1] else None) for k, v in elo.get("players", {}).items()]
    matches = [
        (
            int(row[0]),
            clean_date(row[1]),
            as_int_or_none(row[2]),
            as_int_or_none(row[3]),
            as_int_or_none(row[4]),
            int(row[5]),
        )
        for row in elo.get("rows", [])
    ]
    return {
        "elo_categories": categories,
        "elo_maps": maps,
        "elo_players": players,
        "elo_matches": matches,
    }


ELO_COLUMNS = {
    "elo_categories": ["category_id", "name"],
    "elo_maps": ["map_id", "name"],
    "elo_players": ["elo_id", "name", "race"],
    "elo_matches": ["elo_match_id", "match_date", "winner_elo_id", "loser_elo_id", "map_id", "category_id"],
}


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
