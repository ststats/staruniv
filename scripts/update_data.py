import json
import os
import sys
import time

import gspread
from gspread.utils import numericise_all

# [리팩토링 메모]
# - 스크립트 본문을 main()으로 감싸 import 시 부작용(네트워크 호출)이 없게 했다.
# - 구글 API 호출 2번(시트 목록, batchGet)에 할당량 초과(429)/일시 오류(5xx)용
#   재시도(지수 백오프)를 붙였다. 워크플로를 짧은 간격으로 여러 번 돌려도 한 번의
#   일시적 오류로 파이프라인 전체가 실패하지 않는다.
# - 인증 정보 JSON이 깨져 있을 때 json 모듈의 난해한 예외 대신 원인을 알려주고 종료한다.
# - db.json은 임시 파일에 다 쓴 뒤 교체(atomic write)한다. 저장 도중 죽어도 이전 db.json이
#   반쯤 잘린 채로 남지 않는다. 출력 내용(키/값/들여쓰기)은 예전과 바이트 단위로 동일하다.

# 시트 이름(구글 시트)과 딕셔너리에 들어갈 Key 이름(JSON) 매핑
SHEET_MAPPING = {
    '설정': 'settings',
    '팀 목록': 'teams',
    '멤버 목록': 'members',
    '매치 목록': 'matches',
    '매치 전적': 'rounds'
}

# 시트별 필수 컬럼 - 이 컬럼이 없으면 이후 통계 산출(generate_stats.py)이
# KeyError로 조용히 죽기 때문에, 여기서 미리 잡아서 명확한 경고를 남긴다.
REQUIRED_COLUMNS = {
    'settings': ['시즌', '날짜'],
    'members': ['이름'],
    'matches': ['날짜', '상대팀', '형식', '최종 결과'],
    'rounds': ['날짜', '상대팀', '형식', '우리 선수', '결과', '상대 종족', '맵'],
}

OUTPUT_PATH = 'data/db.json'

# 재시도 대상 HTTP 상태 코드: 할당량 초과 + 서버 측 일시 오류
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 4
_BACKOFF_BASE_SEC = 2


def _status_of(err):
    response = getattr(err, 'response', None)
    return getattr(response, 'status_code', None)


def with_retry(label, fn):
    """구글 API 호출을 재시도(2초, 4초, 8초 대기)로 감싼다. 재시도해도 소용없는 오류
    (권한 없음 403, 시트 없음 404 등)는 즉시 그대로 올려보낸다."""
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return fn()
        except gspread.exceptions.APIError as e:
            status = _status_of(e)
            if status not in _RETRYABLE_STATUS or attempt == _MAX_ATTEMPTS:
                raise
            wait = _BACKOFF_BASE_SEC ** attempt
            print(f"⚠️ {label} 실패(HTTP {status}) - {wait}초 후 재시도합니다 ({attempt}/{_MAX_ATTEMPTS - 1})")
            time.sleep(wait)


def rows_to_records(rows):
    """batchGet이 돌려주는 원본 2차원 배열(첫 행이 헤더)을
    gspread.get_all_records()와 동일한 규칙으로 dict 리스트로 변환한다.
    - 짧은 행은 빈 문자열로 채워 헤더 길이에 맞춘다 (시트에서 뒷칸이 비면
      values.get API가 그 칸부터는 아예 반환을 안 하기 때문).
    - numericise_all()로 숫자처럼 보이는 셀은 int/float로 변환한다
      (get_all_records()도 내부적으로 이 함수를 쓴다 - 동작을 그대로 맞추기 위함).
    """
    if not rows:
        return []
    header = rows[0]
    width = len(header)
    records = []
    for row in rows[1:]:
        padded = row + [''] * (width - len(row)) if len(row) < width else row[:width]
        records.append(dict(zip(header, numericise_all(padded))))
    return records


def warn_missing_columns(sheet_name, key_name, records):
    needed = REQUIRED_COLUMNS.get(key_name)
    if not needed or not records:
        return
    missing = [col for col in needed if col not in records[0]]
    if not missing:
        return
    print(f"⚠️ '{sheet_name}' 시트에 예상 컬럼이 없습니다: {missing} — 통계 산출 단계에서 오류가 날 수 있습니다.")
    # 헤더 셀에 공백이 섞여 있어서('날짜 ') 못 찾는 경우가 흔하므로, 그런 경우엔 원인을 짚어준다.
    stripped_headers = {str(h).strip(): h for h in records[0]}
    for col in missing:
        if col in stripped_headers:
            print(f"   ↳ '{stripped_headers[col]}' 헤더에 앞뒤 공백이 있는 것 같습니다. 시트에서 공백을 지워주세요.")


def open_spreadsheet():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    sheet_id = os.environ.get('GOOGLE_SHEET_ID')
    if not creds_json or not sheet_id:
        raise ValueError("GitHub Secrets 환경 변수가 제대로 설정되지 않았습니다.")
    try:
        creds_dict = json.loads(creds_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"GOOGLE_CREDENTIALS_JSON이 올바른 JSON 형식이 아닙니다: {e}") from None

    gc = gspread.service_account_from_dict(creds_dict)
    return with_retry('스프레드시트 열기', lambda: gc.open_by_key(sheet_id))


def fetch_all_sheets(spreadsheet):
    """시트별로 worksheet() + get_all_records()를 각각 부르면(최대 시트 수 x 2회) API
    호출이 늘어나서 짧은 시간에 여러 번 돌리면 구글시트 할당량(쿼터)에 걸릴 수 있다.
    1) 실제 존재하는 시트 목록 조회(1회 호출)로 없는 시트를 먼저 걸러내고,
    2) 존재하는 시트만 batchGet 한 번으로 다 같이 가져온다(1회 호출).
    전체 5개 시트를 가져오는 데 API 호출이 딱 2번이면 끝난다."""
    existing_titles = {ws.title for ws in with_retry('시트 목록 조회', spreadsheet.worksheets)}

    valid_sheets = {name: key for name, key in SHEET_MAPPING.items() if name in existing_titles}
    for name in SHEET_MAPPING:
        if name not in existing_titles:
            print(f"❌ '{name}' 시트를 찾을 수 없습니다. 이름을 확인해주세요.")

    db_dict = {}
    if not valid_sheets:
        return db_dict

    ranges = [f"'{name}'" for name in valid_sheets]
    batch_result = with_retry('시트 데이터 일괄 조회', lambda: spreadsheet.values_batch_get(ranges))
    value_ranges = batch_result.get('valueRanges', [])
    if len(value_ranges) != len(valid_sheets):
        # batchGet은 요청 순서대로 결과를 돌려주므로 개수가 다르면 매핑이 어긋난다 - 조용히
        # 엉뚱한 시트 데이터를 다른 키에 넣는 대신 여기서 멈춘다.
        raise RuntimeError(f"batchGet 결과 개수({len(value_ranges)})가 요청한 시트 수({len(valid_sheets)})와 다릅니다.")

    for (sheet_name, key_name), value_range in zip(valid_sheets.items(), value_ranges):
        records = rows_to_records(value_range.get('values', []))
        db_dict[key_name] = records
        print(f"✅ '{sheet_name}' 시트 불러오기 완료! ({len(records)}행)")
        warn_missing_columns(sheet_name, key_name, records)
    return db_dict


def save_db(db_dict):
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    tmp_path = OUTPUT_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(db_dict, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, OUTPUT_PATH)


def main():
    spreadsheet = open_spreadsheet()
    print("데이터를 불러오는 중...")
    db_dict = fetch_all_sheets(spreadsheet)
    save_db(db_dict)
    print("\n🎉 모든 데이터가 data/db.json 파일 하나로 통합되어 성공적으로 저장되었습니다!")


if __name__ == '__main__':
    try:
        main()
    except ValueError as e:
        print(f"❌ {e}")
        sys.exit(1)
