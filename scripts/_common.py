"""
ststats 프로젝트의 스크립트들이 공통으로 쓰는 유틸리티.

fetch_poonggo_data.py, fetch_eloboard_data.py, download_font.py, generate_pages.py
전부 여기서 ROOT 경로와 시간/숫자 관련 헬퍼를 가져다 쓴다. 이전에는 스크립트마다
kst_now()/_to_int()/DATETIME_FORMAT을 똑같이 복사해서 갖고 있었는데, 하나만
고치고 나머지를 깜빡하는 실수를 막기 위해 한 곳으로 모았다.

HTTP 재시도 로직도 마찬가지 이유로 여기 있다 - fetch_poonggo_data.py(urllib)와
fetch_eloboard_data.py(requests)가 각자 따로 재시도 루프를 갖고 있었는데(그나마
풍고 쪽은 재시도 사이에 대기(backoff)도 없어서 실패하자마자 곧바로 재요청하는
차이까지 있었다), fetch_json() 하나로 합쳐서 두 스크립트가 동일한 타임아웃/재시도
횟수/백오프 간격, 동일한 형태의 경고 로그를 쓰게 했다.
"""

import sys
import time
import calendar
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

# scripts/_common.py 기준으로 두 단계 위(레포 루트)
ROOT = Path(__file__).resolve().parent.parent

DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"

# 외부 사이트에 요청 보낼 때 공통으로 쓰는 User-Agent. 자동화된 요청임을 정직하게
# 밝힌다(사전에 정식 이용 허가를 받은 풍고 API 기준으로 정한 문구이며, 다른
# 스크립트에서도 동일하게 재사용한다).
USER_AGENT = "ststats-bot/1.0 (+https://ststats.github.io)"

# fetch_json()의 기본값. 두 fetch 스크립트가 동일한 값을 쓰도록 여기 한 곳에서만
# 관리한다 - 서버 쪽 사정(타임아웃 늘려야 한다든가)이 바뀌면 여기만 고치면 된다.
HTTP_TIMEOUT_SEC = 30
HTTP_MAX_RETRIES = 3
HTTP_RETRY_BACKOFF_SEC = 3


def kst_now() -> datetime:
    """한국 표준시(KST, UTC+9) 기준 현재 시각."""
    return datetime.now(timezone.utc) + timedelta(hours=9)


def to_int(value) -> int:
    """API 응답 등에서 온 값을 정수로 안전하게 변환. 콤마 섞인 문자열("1,234")이나
    None도 처리하고, 변환 불가능하면 0을 반환한다(예외로 전체 스크립트가 죽지 않도록)."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    try:
        return int(str(value).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0


def last_day_of_month(year: int, month: int) -> int:
    """그 해/달의 마지막 날짜(28~31)를 반환한다. fetch_poonggo_data.py와
    fetch_eloboard_data.py 둘 다 "달이 바뀐 첫 실행에서 지난달 마지막 날 아카이브를
    확정한다" 로직에서 이 계산이 필요해서 공용으로 뺐다."""
    return calendar.monthrange(year, month)[1]


def get_month_date_range(dt: datetime) -> tuple:
    """지정된 datetime 객체의 월 기준 시작일과 마지막 일을 "YYYY-MM-DD" 형태로
    반환한다. 원래 fetch_eloboard_data.py 안에 있던 함수였는데, 그 스크립트가
    HTML 스크래핑에서 EloBoard 공식 API(player_id 기반) 호출로 바뀌면서 날짜
    포맷도 "YYYYMMDD"(POST 파라미터용)에서 "YYYY-MM-DD"(API의 played_on과
    문자열 비교가 되는 ISO 포맷)로 함께 바뀌었다. update_data.py도 이 함수를
    가져다 쓰므로, 한쪽만 고치고 다른 쪽을 깜빡하는 일이 없도록 공용 모듈로
    옮겼다."""
    last_day = last_day_of_month(dt.year, dt.month)
    return dt.strftime("%Y-%m-01"), dt.strftime(f"%Y-%m-{last_day:02d}")


def fetch_json(url: str, *, method: str = "GET", params=None, data=None, headers=None,
                label: str = "", max_retries: int = HTTP_MAX_RETRIES,
                timeout: int = HTTP_TIMEOUT_SEC, backoff: int = HTTP_RETRY_BACKOFF_SEC):
    """JSON을 응답하는 API를 재시도와 함께 호출하는 공용 헬퍼.

    최대 max_retries번까지 시도하며, HTTP 오류/네트워크 예외/JSON 파싱 실패를
    전부 잡아서 경고 로그를 남기고 backoff초 뒤 재시도한다. 재시도를 다 소진하면
    예외를 던지는 대신 None을 반환한다 - 호출부가 "이번 요청은 실패, 기존 값
    유지"로 자연스럽게 처리할 수 있도록(부분 데이터를 정상 결과처럼 흘려보내지
    않기 위함이기도 하다).

    label은 로그 메시지 앞에 붙는 짧은 식별자(예: "풍고(2025-06, 30명분)",
    "엘로보드(offset=200)") - 여러 요청이 동시에/연달아 실패했을 때 로그에서
    어느 요청인지 구분하기 위함이다.
    """
    req_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    prefix = f"{label} " if label else ""

    for attempt in range(1, max_retries + 1):
        try:
            response = requests.request(
                method, url, params=params, data=data, headers=req_headers, timeout=timeout
            )
            if response.status_code != 200:
                print(f"[경고] {prefix}HTTP {response.status_code} 응답 ({attempt}/{max_retries})", file=sys.stderr)
            else:
                return response.json()
        except requests.RequestException as e:
            print(f"[경고] {prefix}요청 실패: {e} ({attempt}/{max_retries})", file=sys.stderr)
        except ValueError as e:
            # response.json() 파싱 실패 (JSONDecodeError는 ValueError의 하위클래스)
            print(f"[경고] {prefix}응답 파싱 실패: {e} ({attempt}/{max_retries})", file=sys.stderr)

        if attempt < max_retries:
            time.sleep(backoff)

    return None
