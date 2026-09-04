# STSTATS

스타 방송을 하는 스트리머들의 통계를 자동으로 모아서 보여주는 사이트.

## 뭘 보여주나

- **별풍선 / 방송시간 / 누적시청자** — 풍고(poonggo.com) API
- **스폰전적(스폰판수)** — EloBoard(eloboard.co.kr) API

## 데이터가 도는 방식

- 로스터 원본은 **Google Sheets**에서 100% 관리됩니다. (기존 엑셀 파일 및 admin.html 삭제 완료)
- 매일 GitHub Actions가 돌면서: 시트 동기화 → 풍고/EloBoard 수집 → 날짜별 아카이브 저장 → 사이트 페이지 생성
- 달이 바뀌면 지난달 데이터를 한 번 더 재조회해서 확정치로 갱신
- 사람 정보(팀/티어 등)를 나중에 고치면, "수정일"을 시트에 넣어서 과거 기록까지 소급 정정 가능
- EloBoard에 새 elo_id가 나타나면 "미상" 임시 프로필을 구글 시트에 자동 등록(관리자가 나중에 채움)

## 환경 변수 (Secrets)
GitHub Actions 구동을 위해 다음 항목이 설정되어야 합니다:
- `GOOGLE_CREDENTIALS_JSON`: 서비스 계정 JSON
- `GOOGLE_SHEET_ID`: 시트 ID

## 수동 갱신

저장소 → Actions → **Update all stats** → Run workflow
