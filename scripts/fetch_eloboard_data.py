"""
ststats 프로젝트의 엘로보드(ELO) 스폰전적 fetch 모듈.

이전에는 ZenRows(안티봇 우회 프록시) + JS 주입으로 게시판 HTML을 긁어서
afreecatv 핸들을 정규식으로 추출하는 방식이었으나, EloBoard가 공식 API
(eloboard.co.kr/api/matches)를 제공하면서 player_id(=members.json의
elo_id) 기준으로 직접 조회하는 방식으로 교체되었다. 

+ 추가 업데이트: 전적을 수집하는 과정에서 기존 members.json에 없는 
새로운 elo_id가 발견될 경우, 누락을 방지하기 위해 빈칸으로 채워진 
임시 프로필을 자동으로 생성하여 members.json에 추가합니다.
"""

import time
import sys

from _common import ROOT, fetch_json, safe_read_json, atomic_write_json
from collections import defaultdict

PAGE_LIMIT = 200
SLEEP_BETWEEN_PAGES_SEC = 0.5
MAX_PAGES = 2000
MEMBERS_PATH = ROOT / "data" / "members.json"


def _add_unknown_elo_players(combined_dict: dict) -> None:
    """
    수집된 전적의 elo_id 중 members.json에 없는 신규 ID가 있다면
    빈칸 프로필을 자동으로 생성하여 추가합니다.
    """
    local_data = safe_read_json(MEMBERS_PATH, default={"members": []})
    members = local_data.get("members", [])
    
    # 숫자형이나 문자형 elo_id 모두 안전하게 비교하기 위해 문자열로 변환하여 추출
    existing_elo_ids = {str(m.get("elo_id")) for m in members if m.get("elo_id")}
    
    added_count = 0
    
    for elo_id_str in combined_dict.keys():
        if elo_id_str not in existing_elo_ids and elo_id_str != "None":
            new_member = {
                "nickname": f"미상(elo_{elo_id_str})",
                "id": "",  # 아프리카TV 아이디 빈칸
                "elo_id": int(elo_id_str),
                "birthdate": None,
                "gender": "", # 성별 빈칸
                "race": "",   # 종족 빈칸
                "tier": "",   # 티어 빈칸
                "team": "",   # 소속 팀 빈칸
                "role": "",
                "info_updated_at": None
            }
            members.append(new_member)
            existing_elo_ids.add(elo_id_str)
            added_count += 1
            print(f"[알림] 새로운 임시 프로필 추가됨: {new_member['nickname']}")

    if added_count > 0:
        local_data["members"] = members
        atomic_write_json(MEMBERS_PATH, local_data)
        print(f"[완료] 총 {added_count}명의 신규 임시 프로필이 members.json에 추가되었습니다.")


def aggregate_period_data(start_date: str, end_date: str) -> list:
    """EloBoard API가 제공하는 player_id(elo_id)를 직접 사용하여
    지정된 기간(YYYY-MM-DD ~ YYYY-MM-DD)의 스폰전적을 합산한다.

    반환하는 각 항목의 "id"는 afreecatv 핸들이 아니라 elo_id(숫자를
    문자열화한 것)이다 - 호출부에서 members.json의 elo_id와 매칭해야 한다.

    API가 최신 -> 과거 순으로 정렬해서 내려준다고 가정하고, start_date보다
    이른 매치를 만나는 즉시 탐색을 중단한다.
    """
    offset = 0
    page_count = 0
    combined_dict = defaultdict(lambda: {"id": None, "sponsor_wins": 0, "sponsor_losses": 0})

    print(f"[요청] {start_date} ~ {end_date} 기간 전적 수집 시작...")

    while True:
        page_count += 1
        if page_count > MAX_PAGES:
            print(f"[오류] {MAX_PAGES}페이지를 넘겨도 종료 조건에 도달 못 함 - "
                  f"정렬 가정이 깨졌거나 API 문제로 보입니다. 지금까지 모은 데이터는 "
                  f"불완전하므로 이번 수집 전체를 실패 처리합니다.", file=sys.stderr)
            return []

        url = f"https://eloboard.co.kr/api/matches?limit={PAGE_LIMIT}&offset={offset}"
        matches = fetch_json(url, label=f"엘로보드(offset={offset})")
        if matches is None:
            print(f"[오류] offset={offset} 페이지를 재시도해도 가져오지 못함 - "
                  f"지금까지 모은 데이터는 불완전하므로 이번 수집 전체를 실패 처리합니다.", file=sys.stderr)
            return []

        if not matches:
            break

        reached_start = False
        for match in matches:
            played_on = match.get("played_on", "")

            if played_on > end_date:
                # 아직 기간 이후(더 최신) 데이터 - 계속 넘어간다
                continue
            elif played_on < start_date:
                # 기간보다 과거 데이터에 도달 - 더 볼 필요 없이 종료
                print(f"[완료] {start_date} 이전 데이터 도달. 탐색을 종료합니다.")
                reached_start = True
                break
            else:
                for p in match.get("participants", []):
                    try:
                        elo_id = str(p["player_id"])
                        result = p["result"]
                    except (KeyError, TypeError) as e:
                        print(f"[경고] 형식이 예상과 다른 참가자 레코드 건너뜀: {e} ({p!r})", file=sys.stderr)
                        continue

                    if combined_dict[elo_id]["id"] is None:
                        combined_dict[elo_id]["id"] = elo_id

                    if result == "win":
                        combined_dict[elo_id]["sponsor_wins"] += 1
                    else:
                        combined_dict[elo_id]["sponsor_losses"] += 1

        if reached_start:
            break

        offset += PAGE_LIMIT
        time.sleep(SLEEP_BETWEEN_PAGES_SEC)

    # 전적 수집이 끝난 직후 신규 인원 등록 로직 실행
    _add_unknown_elo_players(combined_dict)

    return [v for v in combined_dict.values() if v["id"] is not None]
