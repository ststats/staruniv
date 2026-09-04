"""
ststats 프로젝트의 스크립트들이 공통으로 쓰는 유틸리티.
"""

import sys
import os
import json
import time
import calendar
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
USER_AGENT = "ststats-bot/1.0 (+https://ststats.github.io)"
HTTP_TIMEOUT_SEC = 30
HTTP_MAX_RETRIES = 3
HTTP_RETRY_BACKOFF_SEC = 3

def kst_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=9)

def to_int(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    try:
        return int(str(value).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0

def last_day_of_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]

def get_month_date_range(dt: datetime) -> tuple:
    last_day = last_day_of_month(dt.year, dt.month)
    return dt.strftime("%Y-%m-01"), dt.strftime(f"%Y-%m-{last_day:02d}")

def fetch_json(url: str, *, method: str = "GET", params=None, data=None, headers=None,
                label: str = "", max_retries: int = HTTP_MAX_RETRIES,
                timeout: int = HTTP_TIMEOUT_SEC, backoff: int = HTTP_RETRY_BACKOFF_SEC):
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
            print(f"[경고] {prefix}응답 파싱 실패: {e} ({attempt}/{max_retries})", file=sys.stderr)

        if attempt < max_retries:
            time.sleep(backoff)
    return None

def atomic_write_json(path: Path, data, **json_kwargs) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    json_kwargs.setdefault("ensure_ascii", False)
    json_kwargs.setdefault("indent", 2)

    fd, tmp_path = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, **json_kwargs)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

def safe_read_json(path: Path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[경고] {path}를 읽을 수 없어 기본값으로 대체합니다: {e}", file=sys.stderr)
        return default

REQUIRED_MEMBER_STRING_FIELDS = ("id", "nickname")
VALID_GENDERS = {"m", "f", None}

def validate_and_clean_members(members: list) -> list:
    cleaned = []
    for idx, m in enumerate(members):
        if not isinstance(m, dict):
            continue
        member_id = m.get("id")
        nickname = m.get("nickname")
        if not member_id or not nickname:
            continue
        m = dict(m)
        m["id"] = str(member_id)
        elo_id = m.get("elo_id")
        if elo_id is not None:
            try:
                m["elo_id"] = int(elo_id)
            except (ValueError, TypeError):
                m["elo_id"] = None
        cleaned.append(m)
    return cleaned

# ---------------------------------------------------------------------------
# 구글 시트 관련 공용 헬퍼 (최적화 및 안정화 적용)
# ---------------------------------------------------------------------------

SHEET_NAME = "members"
SHEET_GENDER_MAP = {"남자": "m", "여자": "f"}
SHEET_GENDER_MAP_REVERSE = {"m": "남자", "f": "여자"}
SHEET_PLACEHOLDER_VALUES = {"체크", "todo", "?", "미정", "", "null", "none", "n/a", "na"}

# API 클라이언트 전역 캐싱 (인증 오버헤드 최소화)
_gspread_client = None

def is_sheet_ready() -> bool:
    return bool(os.environ.get("GOOGLE_CREDENTIALS_JSON")) and bool(os.environ.get("GOOGLE_SHEET_ID"))

def get_gspread_client():
    """gspread/google-auth를 함수 안에서 지연 import한다 - fetch_poonggo_data.py,
    fetch_eloboard_data.py, generate_pages.py, subset_font.py처럼 구글시트를
    전혀 안 쓰는 스크립트가 _common을 import하는 것만으로 gspread가 없다고
    크래시하는 일이 없게 하기 위함이다(워크플로우는 requirements.txt를
    한꺼번에 설치하니 실제로 크래시가 나진 않지만, 불필요하게 강한 결합을
    만들지 않는 게 좋다)."""
    global _gspread_client
    if _gspread_client is not None:
        return _gspread_client

    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not creds_json:
        return None

    import gspread
    from google.oauth2.service_account import Credentials

    creds_dict = json.loads(creds_json)
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    _gspread_client = gspread.authorize(creds)
    return _gspread_client

def get_worksheet():
    gc = get_gspread_client()
    if not gc: return None
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id: return None
    return gc.open_by_key(sheet_id).worksheet(SHEET_NAME)

def sheet_clean(value):
    if isinstance(value, str) and value.strip().lower() in SHEET_PLACEHOLDER_VALUES:
        return None
    return value if value != "" else None

def sheet_format_date(value):
    value = sheet_clean(value)
    if not value:
        return None
    return str(value).strip()

def sheet_parse_date_for_write(value):
    if not value:
        return ""
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return value
    except (ValueError, TypeError):
        return ""

def load_sheet_members() -> dict:
    if not is_sheet_ready(): return {}
    try:
        ws = get_worksheet()
        all_values = ws.get_all_values()
    except Exception as e:
        print(f"[오류] 구글 시트를 읽어오는 중 에러 발생: {e}", file=sys.stderr)
        return {}

    if not all_values or len(all_values) < 2:
        return {}

    rows = {}
    for row_idx, row in enumerate(all_values[1:], start=2):
        row += [''] * (10 - len(row))
        nickname, soop_id, elo_id, birthdate, gender, race, tier, team, role, updated_at = row[:10]

        if not nickname or not soop_id:
            continue

        soop_id = str(soop_id).strip()
        tier = sheet_clean(tier)
        
        try:
            elo_id_str = str(elo_id).strip()
            # 시트 셀 서식/입력 방식에 따라 정수 열이 "6199.0"처럼 소수점
            # 붙은 형태로 올 수 있다(예: 셀이 "숫자" 형식으로 지정된 경우) -
            # int()를 바로 쓰면 이런 값에서 예외가 나서 조용히 None이
            # 되어버리므로, float를 한 번 거쳐서 정수부만 취한다.
            elo_id_int = int(float(elo_id_str)) if elo_id_str else None
        except ValueError:
            elo_id_int = None

        rows[soop_id] = {
            "nickname": nickname.strip(),
            "elo_id": elo_id_int,
            "birthdate": sheet_format_date(birthdate),
            "gender": SHEET_GENDER_MAP.get(gender.strip(), gender.strip()) if gender.strip() else None,
            "race": sheet_clean(race),
            "tier": str(tier) if tier is not None else None,
            "team": sheet_clean(team),
            "role": role.strip() if role else "",
            "info_updated_at": sheet_format_date(updated_at),
        }
    return rows

def write_sheet(update_rows: dict, append_rows: list, delete_ids: set | None = None, clear_info_updated_at: set | None = None) -> None:
    delete_ids = delete_ids or set()
    clear_info_updated_at = clear_info_updated_at or set()
    
    if not (update_rows or append_rows or delete_ids or clear_info_updated_at):
        return

    try:
        ws = get_worksheet()
        if ws is None:
            print("[경고] 구글 시트 인증 정보가 없어 쓰기를 건너뜁니다.", file=sys.stderr)
            return
        all_values = ws.get_all_values()
    except Exception as e:
        # 여기서 실패해도 update_data.py의 나머지 작업(latest.json 저장 등)은
        # 이미 끝난 뒤라, 예외를 그대로 던지면 이미 완료된 작업의 성공 여부까지
        # 덩달아 실패로 보이게 된다. 시트 쓰기만 이번엔 건너뛰고 다음 실행에서
        # 다시 시도되게 한다(신규 미상 등록/수정일 비우기 정도라 하루 늦어져도
        # 치명적이지 않다).
        print(f"[오류] 구글 시트 쓰기 중 에러 발생 - 이번엔 건너뜁니다: {e}", file=sys.stderr)
        return
    
    # 1행(헤더)은 아예 배열에 담지 않고 무시합니다. 2행부터 들어갈 데이터만 조립합니다.
    new_data = []

    if len(all_values) > 1:
        for row in all_values[1:]:
            # 무조건 A~J열(10개) 크기로 맞추어 K열 이후 데이터는 건드리지 않게 방어
            row = (row + [''] * 10)[:10] 
            cell_id = str(row[1]).strip() if row[1] else None

            if cell_id in delete_ids:
                continue

            fields = update_rows.get(cell_id)
            if fields:
                row[0] = fields.get("nickname") or ""
                row[2] = str(fields.get("elo_id")) if fields.get("elo_id") is not None else ""
                row[3] = sheet_parse_date_for_write(fields.get("birthdate"))
                row[4] = SHEET_GENDER_MAP_REVERSE.get(fields.get("gender"), fields.get("gender")) or ""
                row[5] = fields.get("race") or ""
                row[6] = fields.get("tier") or ""
                row[7] = fields.get("team") or ""
                row[8] = fields.get("role") or ""

            if cell_id in clear_info_updated_at:
                row[9] = ""

            new_data.append(row)

    for m in append_rows:
        new_row = [
            m.get("nickname") or "",
            m.get("id") or "",
            str(m.get("elo_id")) if m.get("elo_id") is not None else "",
            sheet_parse_date_for_write(m.get("birthdate")),
            SHEET_GENDER_MAP_REVERSE.get(m.get("gender"), m.get("gender")) or "",
            m.get("race") or "",
            m.get("tier") or "",
            m.get("team") or "",
            m.get("role") or "",
            sheet_parse_date_for_write(m.get("info_updated_at"))
        ]
        new_data.append(new_row)

    # 1. 2행(A2)부터 시작하여 A~J열 영역의 "값"만 덮어씁니다. (1행 헤더와 K열 이후, 모든 서식 완벽 보존)
    if new_data:
        # value_input_option="RAW"를 쓴다 - "USER_ENTERED"였다면 구글시트가
        # 우리가 보낸 문자열을 "사람이 직접 입력한 것"처럼 해석해서, elo_id
        # 같은 숫자처럼 보이는 값은 진짜 숫자 셀로, "수정일" 같은 날짜처럼
        # 보이는 값은 진짜 날짜 셀로 자동 변환해버릴 수 있다. 그러면 나중에
        # 다시 읽어올 때 시트의 로케일/서식 설정에 따라 우리가 쓴 것과 다른
        # 문자열 형태(예: "2026-08-27"이 "2026. 8. 27"로)로 돌아올 위험이
        # 있고, 이 프로젝트는 날짜를 문자열 그대로 비교하는 곳이 많아서
        # (file_date >= upd["update_date"] 등) 이런 왕복 불일치가 치명적이다.
        # RAW는 이런 자동 타입 변환을 안 하고 보낸 문자열 그대로 저장한다.
        ws.update(values=new_data, range_name="A2", value_input_option="RAW")
    
    # 2. 만약 삭제된 인원이 있어서 전체 행 수가 줄었다면 남은 찌꺼기 비우기
    old_data_count = len(all_values) - 1 if len(all_values) > 1 else 0
    new_data_count = len(new_data)
    
    if old_data_count > new_data_count:
        start_clear_row = 2 + new_data_count
        end_clear_row = len(all_values)
        # 찌꺼기가 남은 행의 A~J열 "값"만 명시적으로 삭제합니다. (서식 보존)
        ws.batch_clear([f"A{start_clear_row}:J{end_clear_row}"])
