# STSTATS

스타 방송을 하는 스트리머들의 통계를 자동으로 모아서 보여주는 사이트.

## 뭘 보여주나

- **별풍선 / 방송시간 / 누적시청자** — 풍고(poonggo.com) API
- **스폰전적(스폰판수)** — EloBoard(eloboard.co.kr) API

매일 자동으로 수집해서 세 종류 페이지로 보여줌:

| 페이지 | 내용 |
|---|---|
| 전체 페이지 | 모든 팀 비교 그리드 + FA 명단 + 라이브 방송 중 표시 |
| 팀별 페이지 | 팀 하나만 떼서 보는 화면 |
| 개인 프로필 | 인원별 성별/생일/소속/직책/종족/티어 + 지표 4개 |

날짜/지표는 드롭다운으로 즉시 전환(새로고침 없음).

## 파일 구조

```
├── requirements.txt
├── data/
│   ├── members.xlsx          ← 로스터 원본
│   ├── members.json          ← (자동생성) xlsx로부터 변환
│   ├── latest.json           ← (자동생성) 오늘자 수집 결과
│   └── archive/YYYY-MM-DD.json  ← (자동생성) 날짜별 스냅샷
├── scripts/
│   ├── _common.py                  ← 공용 유틸(HTTP 재시도, xlsx 헬퍼 등)
│   ├── convert_members_xlsx.py     ← xlsx -> json 변환
│   ├── sync_members.py             ← EloBoard 티어 API로 신규 멤버 자동 추가
│   ├── fetch_poonggo_data.py       ← 풍고 API 수집(순수 함수)
│   ├── fetch_eloboard_data.py      ← EloBoard API 수집(순수 함수)
│   ├── update_data.py              ← 위 둘을 조율하는 메인 오케스트레이터
│   ├── generate_pages.py           ← 페이지 HTML 생성(Jinja2로 templates/ 조립)
│   ├── subset_font.py              ← 폰트 서브셋 생성
│   └── templates/
│       ├── page.html.j2  ← HTML 뼈대
│       ├── style.css     ← 전체 CSS
│       ├── mobile.css    ← 모바일 CSS
│       └── app.js.j2     ← 클라이언트 JS 전체
├── docs/                      ← GitHub Pages가 서빙하는 실제 사이트
│   ├── index.html / team.html / profile.html / admin.html
│   ├── data/daily/YYYY-MM-DD.json  ← 브라우저가 fetch하는 원본 데이터
│   ├── fonts/PretendardVariable.woff2
│   └── logos/{팀이름}.webp
└── .github/workflows/update-stats.yml  ← 전체 갱신 파이프라인
```

## 데이터가 도는 방식

- 로스터 원본은 `members.xlsx` 하나 — 엑셀로 직접 고치거나, `admin.html`(브라우저에서
  바로 GitHub에 커밋)로 관리
- 매일 GitHub Actions가 돌면서: 로스터 동기화 → 풍고/EloBoard 수집 → 날짜별 아카이브
  저장 → 사이트 페이지 생성
- 달이 바뀌면 지난달 데이터를 한 번 더 재조회해서 확정치로 갱신
- 사람 정보(팀/티어 등)를 나중에 고치면, "수정일"을 넣어서 과거 기록까지 소급 정정 가능
- EloBoard에 새 elo_id가 나타나면 "미상" 임시 프로필을 자동 등록(관리자가 나중에 채움)

## 그 외 기능

- 팀 로고 자동 표시, 팀별 순위 + 전달 대비 변동(▲▼)
- 라이브 방송 중 표시 — Cloudflare Worker + KV로 별도 운영(이 저장소 밖 인프라)
- 모바일 대응, 자체 호스팅 폰트(서브셋으로 용량 최소화)

## 수동 갱신

저장소 → Actions → **Update all stats** → Run workflow
