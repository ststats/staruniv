# staruniv (스타대학)

스타크래프트 대학 리그 팀 "캄몬스타즈"의 방송·일정·전적·티어표를 보여주는 정적 사이트입니다.
GitHub Pages(`docs/`)로 배포되고, GitHub Actions가 주기적으로 데이터를 모아 사이트를 다시 빌드·커밋합니다.

## 데이터 흐름

```
구글 시트 ────────┐
eloboard.co.kr ───┼──> data/*.json (원본) ──> scripts/*.py ──> docs/*.html, docs/data/*.json
유튜브 RSS/API ────┘                                                  (GitHub Pages 배포물)
```

1. **구글 시트 → `data/db.json`** ([scripts/update_data.py](scripts/update_data.py)) - 설정/팀/멤버/매치/라운드/티어멤버 시트를 통합
2. **eloboard 전적 → `data/eloboard.json`** ([scripts/sync_eloboard.py](scripts/sync_eloboard.py)) - 최초 1회 전체 수집, 이후 증분(매일 몇십 건)
3. **상대전적 파일 생성** ([scripts/build_h2h.py](scripts/build_h2h.py)) - `docs/data/h2h/`로 선수 단위 분리(아래 참고)
4. **자체 레이팅 계산** ([scripts/generate_elo.py](scripts/generate_elo.py)) → `docs/data/elo/index.json` (티어표 '분석' 탭이 쓰는 요약. 경기 로그는 3번 산출물을 그대로 재사용한다)
5. **통계 산출** ([scripts/generate_stats.py](scripts/generate_stats.py)) → `data/render_stats.json`
6. **페이지 빌드** ([scripts/build_html.py](scripts/build_html.py)) - `templates/`를 Jinja2로 렌더링해 `docs/*.html` 생성
7. **유튜브 영상 목록** ([scripts/sync_videos.py](scripts/sync_videos.py)) → `docs/data/videos.json`
8. **캘린더 이미지 캡처** ([capture.js](capture.js)) - Puppeteer로 `admin.html`을 렌더링해 `docs/data/calendar.png` 생성

전체 순서와 실패 시 동작은 [.github/workflows/update.yml](.github/workflows/update.yml) 참고(각 단계가 독립적이라 하나가 실패해도 나머지는 진행됨).

## 디렉터리 구조

```
data/            원본 데이터(db.json, eloboard.json 등) - 비공개 산출물, docs/보다 상위 소스
docs/            GitHub Pages 배포 루트(빌드 결과물 + 정적 자산)
templates/       Jinja2 템플릿 + 프론트엔드 자산 원본(build_html.py가 docs/로 복사)
scripts/         파이썬 파이프라인 스크립트
.github/workflows/  자동화 워크플로(update.yml, squash-history.yml)
capture.js       캘린더 이미지 캡처(Puppeteer)
```

## 로컬에서 실행하기

```bash
python -m venv .venv && .venv\Scripts\activate   # Windows. macOS/Linux는 source .venv/bin/activate
pip install -r requirements.txt
npm install   # capture.js(Puppeteer)용
```

구글 시트 연동은 `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_SHEET_ID` 환경변수가 있어야 동작합니다. 없어도
저장소에 이미 있는 `data/db.json`으로 아래 단계는 그대로 돌릴 수 있습니다.

```bash
python scripts/build_h2h.py          # data/eloboard.json + data/db.json -> docs/data/h2h/
python scripts/generate_stats.py     # data/db.json -> data/render_stats.json
python scripts/build_html.py         # -> docs/*.html
```

로컬에서 결과를 보려면 `docs/`를 정적 서버로 띄우면 됩니다(`python -m http.server --directory docs`).
`file://`로 직접 열면 `fetch`가 막혀 데이터가 안 불러와집니다.

## 상대전적(H2H) 샤딩

`docs/data/h2h/p/`는 선수 한 명당 파일 하나를 두지 않고, `scripts/build_h2h.py`가 선수 id
순서대로 묶어(용량이 `SHARD_TARGET_BYTES`를 넘기기 전까지) 저장합니다. 자세한 이유와
동작 방식은 [build_h2h.py](scripts/build_h2h.py) 상단 docstring과 `build_shards()` 주석 참고.
고정 폭으로 묶으면 활동이 많은 선수의 구간이 수 MB로 불어나는 문제가 있어 용량 기준
빈 패킹으로 바꿨습니다.

## 유지보수

### git 히스토리 정리 (수동)
`data/eloboard.json`과 `docs/data/h2h/**`가 매일 자동 커밋되면서 `.git` 저장소 용량이
계속 늘어납니다. `git count-objects -vH`로 확인해서 부담스러워지면(반기~연 1회 정도)
Actions 탭에서 **Squash Git History** 워크플로를 손으로 실행하세요. 이전 커밋 이력을
전부 지우고 현재 상태를 커밋 1개로 압축하는 **되돌릴 수 없는 작업**이라 자동 스케줄로
돌리지 않고, 실수 방지를 위해 `SQUASH`를 직접 입력해야 실행됩니다. 자세한 내용은
[.github/workflows/squash-history.yml](.github/workflows/squash-history.yml) 참고.
실행 후에는 이 저장소를 이미 clone/fork한 사람 모두 다시 clone해야 합니다.

### 자체 레이팅 산정 기준
티어표 '분석' 탭의 레이팅은 **티어와는 다른 줄자**입니다. 티어가 "어느 등급에 속해 있는가"라면
이 점수는 **같은 티어 안에서 지금 어느 정도인가**를 봅니다(그래서 점수 옆에 늘 경기 수를 같이 적습니다 —
12승 3패와 120승 60패는 같은 무게가 아니니까요). 여섯 가지 규칙으로 계산합니다.

1. 같은 티어끼리 붙은 경기만 셉니다(티어 간 대전은 전체의 5%도 안 돼 섞으면 척도가 흔들립니다).
2. 시트의 'N티어 승급' 날짜를 읽어 **지금 티어로 올라온 뒤**의 경기만 셉니다.
3. 기간을 자르는 대신 반감기로 기울입니다(스폰 90일, 대회·대학대전 같은 중요 경기 540일).
4. 형식마다 무게가 다릅니다(개인·대회 2.5 > 대학 2 > 미니·리그·CK 1.5 > 스폰 1).
5. 같은 날 여러 판은 다전제 한 경기로 묶고, 이미 여러 번 만난 상대는 가중을 낮춥니다
   (우리 데이터는 한 상대와만 수백 경기인 경우가 흔해서 "몇 판 이겼나"보다 "몇 명을 이겼나"를 봅니다).
6. 표본이 적으면 기준점(1500)에 가깝게 두고(베이즈 수축), 동티어 10경기 미만은 순위를 매기지 않고
   '표본 부족'으로 표시합니다. 최근 50일간 경기가 없으면 휴면으로 보고 순위 모집단에서 뺍니다.

상수와 근거는 [scripts/generate_elo.py](scripts/generate_elo.py) 상단 docstring에 정리돼 있습니다.

### admin.html 보안 주의
`docs/admin.html`은 GitHub Pages로 공개된 페이지지만, 여기서 입력한 GitHub 토큰으로
브라우저가 직접 저장소에 커밋합니다. 저장소 전체에 쓰기 권한이 있는 토큰을 여기 붙여넣지
말고, 가능하면 이 저장소로 범위를 좁힌 Fine-grained PAT을 쓰세요. 토큰은 `sessionStorage`에만
남고 탭을 닫으면 사라집니다.

## 워크플로 수동/자동 실행

- **Update Site**: Actions 탭에서 수동 실행하거나, 외부 크론에서
  `repository_dispatch`(`event_type: update`)로 호출합니다. 어드민에서 저장해도 이 워크플로는
  자동으로 돌지 않습니다(다음 크론 실행 때 함께 반영됨).
- **Squash Git History**: 위 "유지보수" 참고. 항상 수동 실행.

## 환경변수 / Secrets

| 이름 | 필수 | 용도 |
|---|---|---|
| `GH_TOKEN` | 권장 | 커밋 push, admin.html의 GitHub API 최신 일정 조회용 PAT |
| `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON` | 선택 | 구글 시트 연동(둘 다 있어야 동작) |
| `YOUTUBE_API_KEY` | 선택 | 없으면 RSS로 최신 15개만 수집 |
| `SITE_URL` | 선택 | 배포 주소가 기본값(`https://ststats.github.io/staruniv`)과 다르면 지정 |
