import json
import os
import sys

import numpy as np
import pandas as pd

from match_link import load_linked_db

# [리팩토링 메모]
# - link_rounds_to_matches 결과를 build_html.py와 공유한다(load_linked_db, match_link.py 참고).
# - 시즌 판별(get_season)을 행마다 settings 전체를 필터링하던 apply(O(행 x 시즌))에서
#   정렬된 시즌 시작일에 대한 이진 탐색(searchsorted) 한 번(O(행 log 시즌))으로 바꿨다.
#   날짜 컬럼 dtype이 예상과 다르면(타임존 섞임 등) 예전 행 단위 방식으로 자동 fallback한다.
# - 크루표/멤버표가 각자 반복하던 "시즌 목록 만들기 → 시즌별로 잘라내기 → 그룹핑" 골격을
#   _iter_season_frames() 하나로 합쳤고, 시즌마다 불필요하게 하던 DataFrame.copy()를 없앴다.
# - 형식별/종족별 승패 집계는 시즌마다 groupby(...).size() 한 번으로 미리 세어 두고
#   (예전: 팀/선수 x 형식 x 결과마다 boolean 필터를 새로 만듦) 조회만 한다.
# - 출력(render_stats.json)의 키 순서, 정렬 순서(동점 처리 포함), 숫자 포맷은 그대로다.

# 형식 목록을 한 곳에서 관리 (추가/변경 시 여기만 수정)
FORMATS = ['대회', '대학', '미니', 'CK']
RACES = [('T', '테란전'), ('Z', '저그전'), ('P', '프로토스전')]
RESULT_VALUES = ['승', '패', '무', '무승부']

REQUIRED_MATCH_COLS = ['날짜', '상대팀', '형식', '최종 결과']
REQUIRED_ROUND_COLS = ['날짜', '상대팀', '형식', '우리 선수', '결과', '상대 종족', '맵', '상대 선수']
REQUIRED_SETTINGS_COLS = ['시즌', '날짜']
MONEY_COLS = ['펀딩', '지원금', '사비']
TOTAL_SEASON = "전체"
BEFORE_FIRST_SEASON = "이전"

OUTPUT_PATH = 'data/render_stats.json'


# ==========================================
# 공용 헬퍼
# ==========================================
def write_json_atomic(path, obj, **dump_kwargs):
    """임시 파일에 다 쓴 뒤 교체한다 - 중간에 죽어도 기존 파일이 반쯤 잘린 채로 남지 않는다."""
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, **dump_kwargs)
    os.replace(tmp_path, path)


# 눈에 안 보이는데 값은 들어있는 문자들. 시트를 복사·붙여넣기 하다 보면 섞여 들어오는데,
# 빈칸처럼 보이지만 비교(== 'T' 등)에는 걸리지 않아 조용히 통계에서 빠지거나 경고만 울린다.
# 폭 없는 공백(200B~200D), 단어 결합자(2060), BOM(FEFF), 줄바꿈 없는 공백(00A0) 등.
INVISIBLE_CHARS = r'[\u200b-\u200d\u2060\ufeff\u00a0\u180e]'


def clean_str_col(df, col):
    """문자열로 정확히 비교(== '승' 등)하는 컬럼은 양 끝 공백과 보이지 않는 문자를 제거해둔다.
    시트 셀에 실수로 공백이 붙으면('승 ') 비교가 조용히 실패해서 그 경기가
    승패 집계에서 통째로 빠지는 사고로 이어질 수 있다. 보이지 않는 문자만 들어있는 칸은
    빈칸으로 정리되므로, 그런 칸이 '이상한 값'으로 경고에 잡히지도 않는다.
    (결측값은 원래 객체(None/NaN) 그대로 두고, 나머지만 문자열로 바꿔 정리한다.)"""
    if col not in df.columns:
        return
    s = df[col]
    notna = s.notna()
    cleaned = s[notna].astype(str).str.replace(INVISIBLE_CHARS, '', regex=True).str.strip()
    df[col] = s.astype(object).where(~notna, cleaned)


def warn_invalid_values(df, col, valid_values, label):
    """컬럼은 있지만 값 자체가 이상한 경우(오타/형식 오류)는 조용히 통계에서 누락되기
    쉬우므로, 실행을 막지는 않되 몇 건이나 문제인지 미리 경고해준다."""
    if col not in df.columns:
        return
    actual = df[col].dropna().astype(str).str.strip()
    invalid = actual[~actual.isin(valid_values) & (actual != '')]
    if len(invalid) > 0:
        sample = invalid.unique()[:5].tolist()
        print(f"⚠️  {label} '{col}' 값 중 {len(invalid)}건이 예상 값({valid_values})에 없습니다. 예시: {sample}")


def warn_invalid_dates(df, col, label):
    if col not in df.columns:
        return
    parsed = pd.to_datetime(df[col], errors='coerce')
    invalid_count = df[col].notna().sum() - parsed.notna().sum()
    if invalid_count > 0:
        print(f"⚠️  {label} '{col}' 값 중 {invalid_count}건을 날짜로 인식하지 못했습니다.")


def fmt_wl(wins, losses):
    total = wins + losses
    if total == 0: return "-"
    return f"{int(wins)}승 {int(losses)}패"


def fmt_wl_rate(wins, losses):
    total = wins + losses
    if total == 0: return "-"
    return f"{int(wins)}승 {int(losses)}패 ({wins/total*100:.1f}%)"


def fmt_money(value):
    return f"{value:,.0f}" if value > 0 else "-"


def count_by(df, keys):
    """keys 조합별 행 수를 {튜플: 개수} 딕셔너리로 한 번에 센다(키 중 하나라도 결측인 행은
    어떤 비교(== '승' 등)에도 걸리지 않으므로 빠져도 결과가 같다)."""
    if df.empty:
        return {}
    return df.groupby(keys, sort=False).size().to_dict()


def format_breakdown(counts, group_key, formatter):
    """{'{형식} 전적': '...'} 딕셔너리 - 팀표(fmt_wl)/개인표(fmt_wl_rate) 공용."""
    return {
        f'{fmt} 전적': formatter(counts.get((group_key, fmt, '승'), 0), counts.get((group_key, fmt, '패'), 0))
        for fmt in FORMATS
    }


def top_n_wl_summary(group, by_col, result_col='결과', top_n=3):
    """특정 컬럼으로 그룹핑해서 승/패를 세고, 총 전적이 많은 순으로 top_n개를
    'A(N승M패)' 형태로 이어붙인다(맵 전적/상대 전적 공용). 동점일 때의 순서까지
    예전과 똑같이 나오도록 정렬 방식(sort_values 기본값)은 건드리지 않았다."""
    stats = group.groupby(by_col)[result_col].value_counts().unstack(fill_value=0)
    if '승' not in stats: stats['승'] = 0
    if '패' not in stats: stats['패'] = 0
    stats['총전적'] = stats['승'] + stats['패']
    top = stats.sort_values('총전적', ascending=False).head(top_n)
    parts = [f"{key}({row['승']}승{row['패']}패)" for key, row in top.iterrows()]
    return " · ".join(parts) if parts else "-"


# ==========================================
# 데이터 적재 및 검증
# ==========================================
def load_frames():
    try:
        db, linked_matches, linked_rounds = load_linked_db('data/db.json')
    except FileNotFoundError:
        print("❌ data/db.json 파일을 찾을 수 없습니다. update_data.py를 먼저 실행하세요.")
        sys.exit(1)
    except ValueError as e:  # json.JSONDecodeError 포함
        print(f"❌ data/db.json을 읽는 중 오류가 발생했습니다: {e}")
        sys.exit(1)

    df_matches = pd.DataFrame(linked_matches)
    df_rounds = pd.DataFrame(linked_rounds)
    df_settings = pd.DataFrame(db.get('settings', []))
    df_teams = pd.DataFrame(db.get('teams', []))

    # 필수 컬럼이 없으면 아래에서 pandas KeyError로 알아보기 힘들게 죽는 대신,
    # 여기서 미리 원인을 명확히 알려주고 중단한다.
    missing = [
        ("'매치 목록' 시트", [c for c in REQUIRED_MATCH_COLS if c not in df_matches.columns]),
        ("'매치 전적' 시트", [c for c in REQUIRED_ROUND_COLS if c not in df_rounds.columns]),
        ("'설정' 시트", [c for c in REQUIRED_SETTINGS_COLS if c not in df_settings.columns]),
    ]
    if any(cols for _, cols in missing):
        for label, cols in missing:
            if cols:
                print(f"❌ {label}에 필요한 컬럼이 없습니다: {cols}")
        sys.exit(1)

    warn_invalid_values(df_matches, '형식', FORMATS, "'매치 목록' 시트")
    warn_invalid_values(df_rounds, '형식', FORMATS, "'매치 전적' 시트")
    warn_invalid_values(df_matches, '최종 결과', RESULT_VALUES, "'매치 목록' 시트")
    warn_invalid_values(df_rounds, '결과', RESULT_VALUES, "'매치 전적' 시트")
    warn_invalid_dates(df_matches, '날짜', "'매치 목록' 시트")
    warn_invalid_dates(df_rounds, '날짜', "'매치 전적' 시트")

    for col in ['결과', '형식', '세트', '라운드', '우리 선수', '상대 선수', '상대 종족', '맵']:
        clean_str_col(df_rounds, col)
    for col in ['최종 결과', '형식', '상대팀']:
        clean_str_col(df_matches, col)

    # 날짜 포맷팅 및 정렬 (형식이 어긋난 값은 NaT로 처리해 워크플로가 죽지 않도록 함)
    df_settings['날짜'] = pd.to_datetime(df_settings['날짜'], errors='coerce')
    bad_settings = df_settings['날짜'].isna().sum()
    if bad_settings:
        print(f"⚠️ '설정' 시트에 날짜 형식이 잘못된 행이 {bad_settings}개 있습니다. 확인이 필요합니다.")
    df_settings = df_settings.dropna(subset=['날짜']).sort_values('날짜')
    df_matches['날짜'] = pd.to_datetime(df_matches['날짜'], errors='coerce')
    df_rounds['날짜'] = pd.to_datetime(df_rounds['날짜'], errors='coerce')

    df_matches['시즌'] = assign_seasons(df_matches['날짜'], df_settings)
    df_rounds['시즌'] = assign_seasons(df_rounds['날짜'], df_settings)

    return df_matches, df_rounds, df_settings, build_team_sort_key(df_teams)


def build_team_sort_key(df_teams):
    """'팀 목록' 시트(창단일 포함)를 상대팀 정렬에 쓴다. 컬럼: 팀/설립자/창단일/해체일/비고/우승.
    이 시트에 없는 팀이나 창단일이 비어/이상한 값이면 날짜 미상으로 취급해 맨 위로 보낸다.
    '내전'(자체 스크림)은 팀 목록에 없는 대신 캄몬스타즈 창단일을 그대로 쓴다."""
    team_founded = {}
    if '팀' in df_teams.columns and '창단일' in df_teams.columns:
        parsed = pd.to_datetime(df_teams['창단일'], errors='coerce')
        for team_name, founded in zip(df_teams['팀'], parsed):
            team_name = str(team_name or '').strip()
            if team_name and pd.notna(founded):
                team_founded[team_name] = founded

    def team_sort_key(team_name):
        """오래된 팀부터 정렬하기 위한 키. 창단일 미상인 팀은 (0, ...)으로 묶어 항상 맨 위에
        오게 하고, 창단일이 있는 팀은 (1, 날짜)로 묶어 그 안에서 오름차순(오래된 순)으로 정렬한다."""
        name = str(team_name).strip()
        founded = team_founded.get('캄몬스타즈' if name == '내전' else name)
        if founded is None:
            return (0, pd.Timestamp.min)
        return (1, founded)

    return team_sort_key


# ==========================================
# 시즌 판별
# ==========================================
def _season_of(date_val, df_settings):
    """(fallback 전용) 예전 행 단위 시즌 판별 - 벡터 버전이 쓸 수 없는 dtype일 때만 쓴다."""
    if pd.isna(date_val): return TOTAL_SEASON
    valid_seasons = df_settings[df_settings['날짜'] <= date_val]
    if len(valid_seasons) > 0:
        return valid_seasons.iloc[-1]['시즌']
    return BEFORE_FIRST_SEASON


def assign_seasons(dates, df_settings):
    """각 날짜가 속한 시즌 이름을 돌려준다. 규칙은 예전 get_season과 동일하다:
    - 날짜 미상(NaT) → "전체" (전체 집계에만 포함)
    - 첫 시즌 시작일보다 이전 → "이전"
    - 그 외 → 시작일 <= 날짜인 시즌 중 (정렬 순서상) 마지막 시즌
    settings는 이미 날짜순 정렬돼 있으므로 searchsorted(side='right') - 1이 곧
    "날짜 <= 대상인 마지막 행"이다(시작일이 같은 시즌이 여럿이어도 iloc[-1]과 같은 행)."""
    try:
        settings_dates = df_settings['날짜'].to_numpy().astype('datetime64[ns]')
        values = dates.to_numpy().astype('datetime64[ns]')
    except (TypeError, ValueError):
        return dates.apply(lambda d: _season_of(d, df_settings))

    season_names = df_settings['시즌'].to_numpy(dtype=object)
    idx = np.searchsorted(settings_dates, values, side='right') - 1

    result = np.empty(len(values), dtype=object)
    before = idx < 0
    result[before] = BEFORE_FIRST_SEASON
    result[~before] = season_names[idx[~before]]
    result[np.isnat(values)] = TOTAL_SEASON
    return pd.Series(result, index=dates.index, dtype=object)


def _iter_season_frames(df, seasons):
    """("전체", 원본) 다음에 설정 시트 순서대로 (시즌, 그 시즌 행만) 을 돌려준다.
    읽기만 하므로 copy()는 하지 않는다(불리언 인덱싱 결과는 이미 새 DataFrame이다)."""
    for season in seasons:
        yield season, (df if season == TOTAL_SEASON else df[df['시즌'] == season])


# ==========================================
# 🏆 [크루표 통계 산출]
# ==========================================
def build_crew_stats(df_matches, seasons, team_sort_key):
    # 자금 컬럼은 시즌과 무관하므로 숫자 변환을 한 번만 해둔다(없는 컬럼은 None).
    money = {col: (pd.to_numeric(df_matches[col], errors='coerce') if col in df_matches.columns else None)
             for col in MONEY_COLS}

    def money_sum(col, index):
        # 예전 numeric_sum(group, col)과 같은 값(같은 행을 같은 순서로 Series.sum())을 낸다.
        series = money[col]
        return series.loc[index].sum() if series is not None else 0

    crew_result = {}
    for season, df in _iter_season_frames(df_matches, seasons):
        counts = count_by(df, ['상대팀', '형식', '최종 결과'])
        season_stats = []
        for team, group in df.groupby('상대팀'):
            team_data = {'상대': team}
            team_data.update(format_breakdown(counts, team, fmt_wl))
            team_data['상금/펀딩'] = fmt_money(money_sum('펀딩', group.index))
            team_data['상금/지원금'] = fmt_money(money_sum('지원금', group.index))
            team_data['사비'] = fmt_money(money_sum('사비', group.index))
            season_stats.append(team_data)

        season_stats.sort(key=lambda row: team_sort_key(row['상대']))  # 안정 정렬: 동점은 팀 이름순 유지
        crew_result[season] = season_stats
    return crew_result


# ==========================================
# 🥇 [멤버표 통계 산출]
# ==========================================
def build_member_stats(df_rounds, seasons):
    # 종족 비교용 대문자 컬럼을 시즌 루프 밖에서 한 번만 만든다. object로 바꿔서 .str을
    # 쓰면 컬럼 전체가 결측(float dtype)이어도 AttributeError 없이 NaN이 나온다.
    rounds = df_rounds.assign(_race_up=df_rounds['상대 종족'].astype(object).str.upper())

    member_result = {}
    for season, df in _iter_season_frames(rounds, seasons):
        fmt_counts = count_by(df, ['우리 선수', '형식', '결과'])
        race_counts = count_by(df, ['우리 선수', '_race_up', '결과'])
        season_stats = []
        for player, group in df.groupby('우리 선수'):
            if pd.isna(player) or str(player).strip() == "": continue

            player_data = {'이름': str(player).strip()}
            player_data.update(format_breakdown(fmt_counts, player, fmt_wl_rate))

            # 종족전 전적 (T, Z, P) ('결과' 열 사용)
            for race, col_name in RACES:
                wins = race_counts.get((player, race, '승'), 0)
                losses = race_counts.get((player, race, '패'), 0)
                player_data[f'{col_name} 전적'] = fmt_wl_rate(wins, losses)

            player_data['맵 전적'] = top_n_wl_summary(group, '맵')
            player_data['상대전적'] = top_n_wl_summary(group, '상대 선수')
            season_stats.append(player_data)

        member_result[season] = season_stats
    return member_result


def main():
    df_matches, df_rounds, df_settings, team_sort_key = load_frames()
    seasons = [TOTAL_SEASON] + df_settings['시즌'].tolist()

    print("통계 데이터를 집계 중입니다...")
    # 프론트엔드가 바로 쓸 수 있도록 렌더링용 json 생성
    render_data = {
        "crew_stats": build_crew_stats(df_matches, seasons, team_sort_key),
        "member_stats": build_member_stats(df_rounds, seasons),
    }
    write_json_atomic(OUTPUT_PATH, render_data, indent=2)
    print(f"✅ 통계 산출 완료! {OUTPUT_PATH}에 저장되었습니다.")


if __name__ == '__main__':
    main()
