"""
ststats 프로젝트의 엘로보드(ELO) 스폰전적 fetch 모듈.

이전에는 ZenRows(안티봇 우회 프록시) + JS 주입으로 게시판 HTML을 긁어서
afreecatv 핸들을 정규식으로 추출하는 방식이었으나, EloBoard가 공식 API
(eloboard.co.kr/api/matches)를 제공하면서 player_id(=members.json의
elo_id) 기준으로 직접 조회하는 방식으로 교체되었다. 매칭 키가
"afreecatv id" -> "elo_id(숫자)"로 바뀐 만큼, 호출부인 update_data.py도
elo_id <-> id 매핑 테이블을 거쳐서 이 함수의 반환값을 소비한다.

날짜 포맷은 API의 played_on 필드와 문자열 비교가 되도록 "YYYY-MM-DD"
(ISO, 대시 포함)를 그대로 쓴다 - get_month_date_range()는 _common.py로
옮겨졌다(포맷이 바뀌었으니 update_data.py의 수동 날짜 조합 로직과 함께
한 곳에서 관리하기 위함).

HTTP 요청/재시도는 _common.fetch_json()에 맡긴다 - fetch_poonggo_data.py와
동일한 타임아웃/재시도 횟수/백오프 간격을 쓰도록 통일했다(자체 재시도 루프를
따로 두지 않는다).
"""

import time
import sys

from _common import fetch_json
from collections import defaultdict

PAGE_LIMIT = 200
SLEEP_BETWEEN_PAGES_SEC = 0.5
# 이론상 API 응답이 정렬 가정과 다르게 오거나(더 이상 과거로 못 내려가는 상태)
# 종료 조건이 어긋나면 while True가 끝없이 돌면서 워크플로우 전체 시간(25분
# 타임아웃)을 다 잡아먹을 수 있다 - 그러면 그날은 별풍선 수집도, 페이지 생성도,
# 커밋도 전혀 안 된다. 충분히 넉넉하지만(200명 x 2000페이지 = 40만 건) 무한
# 루프는 막아주는 상한선을 둔다.
MAX_PAGES = 2000


def aggregate_period_data(start_date: str, end_date: str) -> list:
    """EloBoard API가 제공하는 player_id(elo_id)를 직접 사용하여
    지정된 기간(YYYY-MM-DD ~ YYYY-MM-DD)의 스폰전적을 합산한다.

    반환하는 각 항목의 "id"는 afreecatv 핸들이 아니라 elo_id(숫자를
    문자열화한 것)이다 - 호출부에서 members.json의 elo_id와 매칭해야 한다.

    API가 최신 -> 과거 순으로 정렬해서 내려준다고 가정하고, start_date보다
    이른 매치를 만나는 즉시 탐색을 중단한다(정렬이 바뀌면 이 가정이 깨지니
    유의).

    페이지 요청이 fetch_json()의 재시도를 다 소진해도 실패하면, 지금까지 모은
    데이터가 불완전하다는 걸 명확히 경고로 남기고 빈 리스트를 반환한다(부분
    데이터를 "정상 수집 결과"인 것처럼 조용히 반환하지 않기 위함 - 호출부인
    update_data.py는 빈 리스트를 "이번엔 실패, 기존 값 유지"로 처리한다).
    한 참가자 레코드가 예상과 다른 형태여도 그 레코드만 건너뛰고 나머지는
    계속 집계한다.
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

    return [v for v in combined_dict.values() if v["id"] is not None]
