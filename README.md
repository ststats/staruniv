# staruniv

스타크래프트 대학 리그의 방송·일정·전적·티어표를 보여주는 정적 사이트입니다.
GitHub Pages(`docs/`)로 배포되고, GitHub Actions가 주기적으로 데이터를 모아 사이트를 다시 빌드·커밋합니다.

## 데이터 흐름

```
Supabase ───────────────> 브라우저 공개 데이터 + data/*.json (계산용 캐시)
eloboard.co.kr ─────────> Supabase ELO ──> H2H/통계 계산
유튜브 RSS/API ─────────> Supabase videos
templates/ + 계산 결과 ─> docs/ (GitHub Pages 배포물)
```

1. **Supabase → `data/db.json`** ([scripts/export_supabase.py](scripts/export_supabase.py)) - 설정/팀/멤버/매치/라운드/티어멤버를 빌드용 JSON으로 내보냄
2. **Supabase ELO → `data/eloboard.json`** ([scripts/export_elo_supabase.py](scripts/export_elo_supabase.py)) - ELO 원본을 빌드용 캐시로 내보냄
3. **eloboard 최신 전적 → Supabase** ([scripts/sync_eloboard.py](scripts/sync_eloboard.py)) - 새 경기만 `elo_*` 테이블에 증분 저장
4. **상대전적 파일 생성** ([scripts/build_h2h.py](scripts/build_h2h.py)) - `docs/data/h2h/`로 선수 단위 분리
5. **티어랭킹 계산** ([scripts/build_ranking.py](scripts/build_ranking.py))
6. **통계 산출** ([scripts/generate_stats.py](scripts/generate_stats.py)) → `data/render_stats.json`
7. **페이지 빌드** ([scripts/build_html.py](scripts/build_html.py)) - `templates/`를 Jinja2로 렌더링해 `docs/*.html` 생성
8. **유튜브 영상 목록** ([scripts/sync_videos.py](scripts/sync_videos.py)) → Supabase `videos`
9. **캘린더 이미지 캡처** ([capture.js](capture.js)) - Puppeteer로 공개 `/schedule/` 페이지를 렌더링해 `docs/data/calendar.png` 생성

운영 데이터의 원본은 Supabase입니다. `data/db.json`과 `data/eloboard.json`은 기존 계산/빌드 코드와의 호환을 위한 캐시입니다.

전체 순서와 실패 시 동작은 [.github/workflows/update.yml](.github/workflows/update.yml) 참고.

## 디렉터리 구조

```
data/            빌드 캐시(db.json, eloboard.json 등) - 원본은 Supabase
docs/            GitHub Pages 배포 루트(HTML/자산 + H2H 파생 데이터 + 캘린더 이미지)
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

로컬에서 최신 운영 데이터로 빌드하려면 먼저 `SUPABASE_DB_URL` 환경변수를 설정합니다.

```bash
python scripts/export_supabase.py      # Supabase -> data/db.json
python scripts/export_elo_supabase.py  # Supabase ELO -> data/eloboard.json
python scripts/build_h2h.py            # -> docs/data/h2h/
python scripts/build_ranking.py
python scripts/generate_stats.py       # -> data/render_stats.json
python scripts/build_html.py           # -> docs/*.html
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
`data/eloboard.json`은 이제 Git에서 추적하지 않지만 `docs/data/h2h/**` 같은 생성물이 계속
커밋되므로 장기간 운영하면 `.git` 저장소가 커질 수 있습니다. `git count-objects -vH`로
확인해서 부담스러워지면 Actions 탭에서 **Squash Git History** 워크플로를 손으로 실행하세요. 이전 커밋 이력을
전부 지우고 현재 상태를 커밋 1개로 압축하는 **되돌릴 수 없는 작업**이라 자동 스케줄로
돌리지 않고, 실수 방지를 위해 `SQUASH`를 직접 입력해야 실행됩니다. 자세한 내용은
[.github/workflows/squash-history.yml](.github/workflows/squash-history.yml) 참고.
실행 후에는 이 저장소를 이미 clone/fork한 사람 모두 다시 clone해야 합니다.

### Supabase 초기 설정과 관리자

새 Supabase 프로젝트에서는 SQL Editor에서 `supabase/setup.sql`을 실행합니다. 이어서
Authentication에 이메일/비밀번호 사용자를 만들고, 그 사용자의 UUID를 `admin_users`에
등록합니다. 공개 사이트와 `/admin.html`은 Supabase의 publishable key로 접속하며 실제 읽기·쓰기
권한은 RLS 정책이 제한합니다. DB 비밀번호와 service role key는 브라우저 설정에 넣지 않습니다.

Actions에는 `SUPABASE_DB_URL` secret, `SUPABASE_URL` variable,
`SUPABASE_PUBLISHABLE_KEY` secret 또는 variable을 등록합니다. 관리자에서 저장한 운영 데이터는
Supabase에 즉시 반영되고 공개 사이트도 다음 조회부터 직접 읽습니다. Actions 빌드는 장애 대비
정적 JSON과 배포 HTML을 갱신합니다.

## 워크플로 수동/자동 실행

- **Update Site**: Actions 탭에서 수동 실행하거나, 외부 크론에서
  `repository_dispatch`(`event_type: update`)로 호출합니다. 어드민에서 저장해도 이 워크플로는
  자동으로 돌지 않습니다(다음 크론 실행 때 함께 반영됨).
- **Squash Git History**: 위 "유지보수" 참고. 항상 수동 실행.

## 환경변수 / Secrets

| 이름 | 필수 | 용도 |
|---|---|---|
| `GH_TOKEN` | 선택 | Actions 기본 토큰으로 push할 수 없을 때 사용할 저장소 범위 PAT |
| `SUPABASE_DB_URL` | **필수** | 운영 데이터 및 ELO 원본 PostgreSQL 연결 문자열 |
| `SUPABASE_URL` | **필수** | 공개 브라우저 클라이언트의 Supabase 프로젝트 URL |
| `SUPABASE_PUBLISHABLE_KEY` | **필수** | 공개 브라우저 클라이언트 키(RLS로 권한 제한) |
| `YOUTUBE_API_KEY` | 선택 | 없으면 RSS로 최신 15개만 수집 |
| `SITE_URL` | 선택 | 배포 주소가 기본값(`https://ststats.github.io/staruniv`)과 다르면 지정 |
