# Supabase-only 전환

이 버전부터 운영 데이터 원본은 Supabase 하나입니다.

## 제거되는 Google Sheet 의존성

- GitHub Actions의 Google Sheet fallback
- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`
- `gspread` Python 패키지
- `scripts/update_data.py`

## 패치 적용 후 1회 실행

Windows CMD 기준:

```bat
git rm --ignore-unmatch scripts\update_data.py
git add .github\workflows\update.yml requirements.txt README.md SUPABASE_SETUP.md SUPABASE_ONLY.md
git add scripts\build_h2h.py scripts\build_html.py scripts\generate_stats.py scripts\match_link.py
git add templates\assets templates\pages\schedule.html templates\standalone\admin.html
git status
git commit -m "Remove Google Sheet data source"
git pull --rebase origin main
git push
```

그 다음 GitHub Actions의 **Update Site**를 새로 실행합니다.

## GitHub Secrets 정리

`Settings -> Secrets and variables -> Actions`에서 아래 두 Secret은 더 이상 사용하지 않으므로 삭제해도 됩니다.

- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`

남겨야 하는 핵심 Secret:

- `SUPABASE_DB_URL`

## 정상 로그

Update Site 실행 시 아래 순서가 보여야 합니다.

1. `Supabase 연결 확인`
2. `Supabase에서 핵심 데이터 받기`
3. `Supabase에서 ELO 캐시 만들기`
4. `ELO 최신분을 Supabase에 증분 저장`
5. 상대전적 / 티어랭킹 / 통계 / 페이지 빌드

`구글 시트에서 최신 데이터 받기` 단계는 더 이상 존재하지 않습니다.
