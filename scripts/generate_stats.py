import json
import os
import pandas as pd
from match_link import link_rounds_to_matches

# 1. db.json 불러오기
try:
    with open('data/db.json', 'r', encoding='utf-8') as f:
        db = json.load(f)
except FileNotFoundError:
    print("❌ data/db.json 파일을 찾을 수 없습니다. update_data.py를 먼저 실행하세요.")
    exit(1)

# '팀 목록' 시트(창단일 포함)를 상대팀 정렬에 쓴다. 컬럼: 팀/설립자/창단일/해체일/비고/우승.
# 이 시트에 없는 팀이나 창단일이 비어/이상한 값이면 날짜 미상으로 취급해 맨 위로 보낸다.
# '내전'(자체 스크림)은 팀 목록에 없는 대신 캄몬스타즈 창단일을 그대로 쓴다.
df_teams = pd.DataFrame(db.get('teams', []))
team_founded = {}
if '팀' in df_teams.columns and '창단일' in df_teams.columns:
    parsed = pd.to_datetime(df_teams['창단일'], errors='coerce')
    for team_name, founded in zip(df_teams['팀'], parsed):
        team_name = str(team_name or '').strip()
        if team_name and pd.notna(founded):
            team_founded[team_name] = founded

def team_sort_key(team_name):
    """오래된 팀부터 정렬하기 위한 키. 창단일 미상(팀 목록에 없거나 값이 비정상)인
    팀은 (0, ...)으로 묶어 항상 맨 위에 오게 하고, 창단일이 있는 팀은 (1, 날짜)로
    묶어 그 안에서 오름차순(오래된 순)으로 정렬한다."""
    lookup_name = '캄몬스타즈' if str(team_name).strip() == '내전' else str(team_name).strip()
    founded = team_founded.get(lookup_name)
    if founded is None:
        return (0, pd.Timestamp.min)
    return (1, founded)

# 같은 날 같은 상대와 여러 경기를 치른 경우를 구분하기 위해 매치/라운드에
# 고유 순번을 부여하고, 라운드에 형식을 채운다 (자세한 내용은 match_link.py 참고)
linked_matches, linked_rounds = link_rounds_to_matches(db.get('matches', []), db.get('rounds', []), db.get('members', []))

# 리스트 딕셔너리를 Pandas DataFrame으로 변환
df_matches = pd.DataFrame(linked_matches)
df_rounds = pd.DataFrame(linked_rounds)
df_settings = pd.DataFrame(db.get('settings', []))

# 형식 목록을 한 곳에서 관리 (추가/변경 시 여기만 수정)
FORMATS = ['대회', '대학', '미니', 'CK']

# 필수 컬럼이 없으면 아래에서 pandas KeyError로 알아보기 힘들게 죽는 대신,
# 여기서 미리 원인을 명확히 알려주고 중단한다.
REQUIRED_MATCH_COLS = ['날짜', '상대팀', '형식', '최종 결과']
REQUIRED_ROUND_COLS = ['날짜', '상대팀', '형식', '우리 선수', '결과', '상대 종족', '맵', '상대 선수']
missing_match_cols = [c for c in REQUIRED_MATCH_COLS if c not in df_matches.columns]
missing_round_cols = [c for c in REQUIRED_ROUND_COLS if c not in df_rounds.columns]
if missing_match_cols or missing_round_cols:
    if missing_match_cols:
        print(f"❌ '매치 목록' 시트에 필요한 컬럼이 없습니다: {missing_match_cols}")
    if missing_round_cols:
        print(f"❌ '매치 전적' 시트에 필요한 컬럼이 없습니다: {missing_round_cols}")
    exit(1)

# 컬럼은 있지만 값 자체가 이상한 경우(오타/형식 오류)는 조용히 통계에서 누락되기
# 쉬우므로, 실행을 막지는 않되 몇 건이나 문제인지 미리 경고해준다.
def warn_invalid_values(df, col, valid_values, label):
    if col not in df.columns:
        return
    actual = df[col].dropna().apply(lambda v: str(v).strip())
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

warn_invalid_values(df_matches, '형식', FORMATS, "'매치 목록' 시트")
warn_invalid_values(df_rounds, '형식', FORMATS, "'매치 전적' 시트")
warn_invalid_values(df_matches, '최종 결과', ['승', '패', '무', '무승부'], "'매치 목록' 시트")
warn_invalid_values(df_rounds, '결과', ['승', '패', '무', '무승부'], "'매치 전적' 시트")
warn_invalid_dates(df_matches, '날짜', "'매치 목록' 시트")
warn_invalid_dates(df_rounds, '날짜', "'매치 전적' 시트")

def numeric_sum(df, col):
    """컬럼이 아예 없을 수도 있는 선택적 숫자 필드(펀딩/지원금/사비 등)를 안전하게 합산."""
    return pd.to_numeric(df[col], errors='coerce').sum() if col in df.columns else 0

def clean_str_col(df, col):
    """문자열로 정확히 비교(== '승' 등)하는 컬럼은 양 끝 공백을 제거해둔다.
    시트 셀에 실수로 공백이 붙으면('승 ') 비교가 조용히 실패해서 그 경기가
    승패 집계에서 통째로 빠지는 사고로 이어질 수 있다."""
    if col in df.columns:
        df[col] = df[col].apply(lambda v: str(v).strip() if pd.notna(v) else v)

for col in ['결과', '형식', '세트', '라운드', '우리 선수', '상대 선수', '상대 종족', '맵']:
    clean_str_col(df_rounds, col)
for col in ['최종 결과', '형식', '상대팀']:
    clean_str_col(df_matches, col)

# 날짜 포맷팅 및 정렬 (형식이 어긋난 값은 NaT로 처리해 워크플로가 죽지 않도록 함)
df_settings['날짜'] = pd.to_datetime(df_settings['날짜'], errors='coerce')
if df_settings['날짜'].isna().any():
    print(f"⚠️ '설정' 시트에 날짜 형식이 잘못된 행이 {df_settings['날짜'].isna().sum()}개 있습니다. 확인이 필요합니다.")
df_settings = df_settings.dropna(subset=['날짜']).sort_values('날짜')
df_matches['날짜'] = pd.to_datetime(df_matches['날짜'], errors='coerce')
df_rounds['날짜'] = pd.to_datetime(df_rounds['날짜'], errors='coerce')

# 2. 시즌 판별 함수
def get_season(date_val):
    if pd.isna(date_val): return "전체"
    valid_seasons = df_settings[df_settings['날짜'] <= date_val]
    if len(valid_seasons) > 0:
        return valid_seasons.iloc[-1]['시즌']
    return "이전"

df_matches['시즌'] = df_matches['날짜'].apply(get_season)
df_rounds['시즌'] = df_rounds['날짜'].apply(get_season)

# 3. 승패 텍스트 포맷팅 헬퍼
def fmt_wl(wins, losses):
    total = wins + losses
    if total == 0: return "-"
    return f"{int(wins)}승 {int(losses)}패"

def fmt_wl_rate(wins, losses):
    total = wins + losses
    if total == 0: return "-"
    return f"{int(wins)}승 {int(losses)}패 ({wins/total*100:.1f}%)"

# 팀표(최종 결과 컬럼)와 개인표(결과 컬럼)가 "FORMATS 각각에 대해 승/패를 세서
# {'{형식} 전적': 문자열} 딕셔너리를 만드는" 로직을 완전히 동일하게 반복하고
# 있었다 - 결과 컬럼 이름과 표시 방식(fmt_wl 승패만 vs fmt_wl_rate 승률까지)만
# 다르므로 그 둘만 인자로 받는 공용 함수로 뺐다.
def format_breakdown_by_format(group, result_col, formatter):
    breakdown = {}
    for fmt in FORMATS:
        fmt_group = group[group['형식'] == fmt]
        wins = (fmt_group[result_col] == '승').sum()
        losses = (fmt_group[result_col] == '패').sum()
        breakdown[f'{fmt} 전적'] = formatter(wins, losses)
    return breakdown

# 맵 전적/상대 전적이 "특정 컬럼으로 그룹핑해서 승/패를 세고, 총 전적이 많은
# 순으로 top_n개를 'A(N승M패)' 형태로 이어붙이는" 로직을 완전히 동일하게
# 반복하고 있었다 - 그룹핑 기준 컬럼만 다르므로 그것만 인자로 받는다.
def top_n_wl_summary(group, by_col, result_col='결과', top_n=3):
    stats = group.groupby(by_col)[result_col].value_counts().unstack(fill_value=0)
    if '승' not in stats: stats['승'] = 0
    if '패' not in stats: stats['패'] = 0
    stats['총전적'] = stats['승'] + stats['패']
    top = stats.sort_values('총전적', ascending=False).head(top_n)
    parts = [f"{key}({row['승']}승{row['패']}패)" for key, row in top.iterrows()]
    return " · ".join(parts) if parts else "-"

# ==========================================
# 🏆 [크루표 통계 산출]
# ==========================================
def build_crew_stats():
    crew_result = {}
    seasons = ["전체"] + df_settings['시즌'].tolist()
    
    for season in seasons:
        df = df_matches.copy()
        if season != "전체":
            df = df[df['시즌'] == season]
            
        season_stats = []
        for team, group in df.groupby('상대팀'):
            team_data = {'상대': team}
            team_data.update(format_breakdown_by_format(group, '최종 결과', fmt_wl))

            # 자금 정보 계산 (숫자가 없거나 컬럼 자체가 없어도 죽지 않게 처리)
            funding = numeric_sum(group, '펀딩')
            support = numeric_sum(group, '지원금')
            sabi = numeric_sum(group, '사비')
            
            team_data['상금/펀딩'] = f"{funding:,.0f}" if funding > 0 else "-"
            team_data['상금/지원금'] = f"{support:,.0f}" if support > 0 else "-"
            team_data['사비'] = f"{sabi:,.0f}" if sabi > 0 else "-"
            
            season_stats.append(team_data)

        season_stats.sort(key=lambda row: team_sort_key(row['상대']))
        crew_result[season] = season_stats
    return crew_result

# ==========================================
# 🥇 [멤버표 통계 산출]
# ==========================================
def build_member_stats():
    member_result = {}
    seasons = ["전체"] + df_settings['시즌'].tolist()
    
    for season in seasons:
        df = df_rounds.copy()
        if season != "전체":
            df = df[df['시즌'] == season]
            
        season_stats = []
        for player, group in df.groupby('우리 선수'):
            if pd.isna(player) or str(player).strip() == "": continue
            
            player_data = {'이름': str(player).strip()}
            player_data.update(format_breakdown_by_format(group, '결과', fmt_wl_rate))

            # 종족전 전적 (T, Z, P) ('결과' 열 사용)
            for race, col_name in [('T', '테란전'), ('Z', '저그전'), ('P', '프로토스전')]:
                race_group = group[group['상대 종족'].str.upper() == race]
                wins = (race_group['결과'] == '승').sum()
                losses = (race_group['결과'] == '패').sum()
                player_data[f'{col_name} 전적'] = fmt_wl_rate(wins, losses)

            player_data['맵 전적'] = top_n_wl_summary(group, '맵')
            player_data['상대전적'] = top_n_wl_summary(group, '상대 선수')

            season_stats.append(player_data)
            
        member_result[season] = season_stats
    return member_result

# 4. 집계 및 JSON 저장
print("통계 데이터를 집계 중입니다...")
crew_data = build_crew_stats()
member_data = build_member_stats()

# 프론트엔드가 바로 쓸 수 있도록 렌더링용 json 생성
render_data = {
    "crew_stats": crew_data,
    "member_stats": member_data
}

with open('data/render_stats.json', 'w', encoding='utf-8') as f:
    json.dump(render_data, f, ensure_ascii=False, indent=2)

print("✅ 통계 산출 완료! data/render_stats.json에 저장되었습니다.")
