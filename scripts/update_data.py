import os
import json
import gspread
from gspread.utils import numericise_all

# 1. GitHub Secrets 환경 변수 가져오기
creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
sheet_id = os.environ.get('GOOGLE_SHEET_ID')

if not creds_json or not sheet_id:
    raise ValueError("GitHub Secrets 환경 변수가 제대로 설정되지 않았습니다.")

# 2. 구글 시트 연결
creds_dict = json.loads(creds_json)
gc = gspread.service_account_from_dict(creds_dict)
spreadsheet = gc.open_by_key(sheet_id)

# 3. 데이터 통합을 위한 딕셔너리 생성
db_dict = {}

# 시트 이름(구글 시트)과 딕셔너리에 들어갈 Key 이름(JSON) 매핑
sheet_mapping = {
    '설정': 'settings',
    '팀 목록': 'teams',
    '멤버 목록': 'members',
    '매치 목록': 'matches',
    '매치 전적': 'rounds'
}

# 시트별 필수 컬럼 - 이 컬럼이 없으면 이후 통계 산출(generate_stats.py)이
# KeyError로 조용히 죽기 때문에, 여기서 미리 잡아서 명확한 경고를 남긴다.
required_columns = {
    'settings': ['시즌', '날짜'],
    'members': ['이름'],
    'matches': ['날짜', '상대팀', '형식', '최종 결과'],
    'rounds': ['날짜', '상대팀', '형식', '우리 선수', '결과', '상대 종족', '맵'],
}


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
        padded = numericise_all(padded)
        records.append(dict(zip(header, padded)))
    return records


print("데이터를 불러오는 중...")

# 시트별로 worksheet() + get_all_records()를 각각 부르면(최대 시트 수 x 2회) API
# 호출이 늘어나서 짧은 시간에 여러 번 돌리면 구글시트 할당량(쿼터)에 걸릴 수 있다.
# 1) 실제 존재하는 시트 목록 조회(1회 호출)로 없는 시트를 먼저 걸러내고,
# 2) 존재하는 시트만 batchGet 한 번으로 다 같이 가져온다(1회 호출).
# 전체 5개 시트를 가져오는 데 API 호출이 딱 2번이면 끝난다.
existing_titles = {ws.title for ws in spreadsheet.worksheets()}

valid_sheets = {name: key for name, key in sheet_mapping.items() if name in existing_titles}
for name in sheet_mapping:
    if name not in existing_titles:
        print(f"❌ '{name}' 시트를 찾을 수 없습니다. 이름을 확인해주세요.")

if valid_sheets:
    ranges = [f"'{name}'" for name in valid_sheets]
    batch_result = spreadsheet.values_batch_get(ranges)
    value_ranges = batch_result.get('valueRanges', [])

    for (sheet_name, key_name), value_range in zip(valid_sheets.items(), value_ranges):
        records = rows_to_records(value_range.get('values', []))
        db_dict[key_name] = records
        print(f"✅ '{sheet_name}' 시트 불러오기 완료! ({len(records)}행)")

        needed = required_columns.get(key_name)
        if needed and records:
            missing = [col for col in needed if col not in records[0]]
            if missing:
                print(f"⚠️ '{sheet_name}' 시트에 예상 컬럼이 없습니다: {missing} — 통계 산출 단계에서 오류가 날 수 있습니다.")

# 4. 저장할 폴더 생성
os.makedirs('data', exist_ok=True)

# 5. 하나의 db.json 파일로 통합 저장
with open('data/db.json', 'w', encoding='utf-8') as f:
    json.dump(db_dict, f, ensure_ascii=False, indent=2)

print("\n🎉 모든 데이터가 data/db.json 파일 하나로 통합되어 성공적으로 저장되었습니다!")