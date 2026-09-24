# StarUniv (스타대학)

캄몬스타즈 공개 사이트와 관리자 화면 저장소입니다. 데이터는 공유 Supabase에 있고,
외부 데이터 수집·계산은 [`ststat`](https://github.com/ststats/ststat) 저장소가 맡습니다.

## 한눈에 보기

| 무엇 | 어디서 | 사이트 반영 |
|---|---|---|
| 일정·휴방, 연혁, 티어표, 티어 랭킹, 영상, 방송통계(시너지) | Supabase를 브라우저가 바로 읽음 | 저장 즉시 |
| 멤버 목록, 캄몬 전적(매치·세트), 홈 누적 수치 | 빌드 때 `docs/data/site_shell.json`·`site_records.json`으로 만듦 | 스타유니브 빌드 후 |
| 달력 사진 `docs/data/calendar.png`(외부 자동화가 가져감) | 빌드 때 크롬으로 캡처 | 스타유니브 빌드 후 |
| EloBoard 경기·티어 랭킹 계산, 풍고 방송통계, 유튜브 영상 수집 | `ststat` 파이프라인 | 파이프라인 후 |

## 자동 실행

| 무엇 | 언제 | 방법 |
|---|---|---|
| 스타유니브 빌드(`.github/workflows/update.yml`) | 매일 00:05·12:05(한국 시간) | 외부 크론이 `workflow_dispatch` 호출 |
| 〃 | `templates/`·`scripts/` 등을 main에 올릴 때 | push |
| 〃 | 어드민 일정 화면 **"달력 사진 갱신"** 버튼 | Supabase 함수가 GitHub에 요청(아래 설정) |
| ststat 파이프라인(`run-pipeline.yml`) | 외부 크론 | `workflow_dispatch` |

빌드는 30초 안팎입니다: Supabase에서 멤버·전적을 내보내고 → 통계·HTML·사이트 데이터를 만들고 →
달력을 캡처하고(`scripts/capture_calendar.py`, 러너에 깔린 크롬 사용, 한국 시간 기준) →
결과(`docs/`)를 GitHub Pages에 바로 배포합니다. **빌드 결과는 저장소에 커밋하지 않습니다**
(저장소 Settings → Pages → Source: GitHub Actions). 사이트: https://ststats.github.io/staruniv/

`https://staruniv.vercel.app/`도 같은 사이트입니다. Vercel은 빌드 결과를 만들지 않고, `vercel.json`이 모든 주소를
GitHub Pages로 넘깁니다(rewrite). 그래서 늘 Pages와 같은 최신 내용입니다. Vercel 프로젝트 설정(Root Directory가
`docs`인지 저장소 루트인지)에 따라 읽는 위치가 달라서 `vercel.json`과 `docs/vercel.json`을 똑같이 둡니다.
Vercel 무료 플랜은 하루 배포 횟수 제한이 있어서, `ignoreCommand`로 이 파일이 바뀐 커밋만 배포하게 해 두었습니다.
`rewrites`가 아니라 `routes`를 씁니다. `rewrites`는 Vercel이 먼저 자기 파일을 찾아 폴더 주소(`/`, `/members/`)에서 404를 내기 때문입니다.

달력 사진 주소는 `https://ststats.github.io/staruniv/data/calendar.png`이고, 커뮤니티용 Cloudflare Worker가
이 주소를 가져갑니다. 캡처가 실패하면 직전에 배포된 사진을 그대로 다시 배포합니다.

## 관리자

- 주소: 공개 페이지 이름 앞에 `admin-`(홈은 `admin.html`). 공개 페이지를 어드민 모드로 빌드한 것이고, Supabase 로그인 후 관리자만 편집할 수 있습니다.
- 어드민 홈 맨 위 **운영 현황**: 최근 파이프라인 결과, ELO 경기 수·범위, 테이블 건수.
- 멤버·전적을 고친 뒤 공개 사이트에 바로 보이게 하려면 빌드를 한 번 돌리세요(Actions → Build StarUniv web → Run workflow, 또는 "달력 사진 갱신" 버튼).

### "달력 사진 갱신" 버튼 설정(한 번만)

1. GitHub에서 fine-grained 토큰 발급: 저장소 `ststats/staruniv`만, 권한 **Actions: Read and write**
2. Supabase SQL 편집기: `select vault.create_secret('<토큰>', 'github_actions_token');`
3. `supabase/calendar_capture.sql` 실행

토큰 교체: `select vault.update_secret((select id from vault.secrets where name = 'github_actions_token'), '<새 토큰>');`

## 로컬에서 빌드·확인

```bash
python -m pip install -r requirements.txt
python scripts/export_supabase.py     # SUPABASE_DB_URL 필요. 없으면 data/db.json 캐시를 그대로 씀
python scripts/generate_stats.py
python scripts/build_html.py          # templates → docs (HTML, 자산 복사, 캐시용 ?v=해시)
python scripts/write_site_data.py     # docs/data/site_shell.json · site_records.json
npm test                              # node --test (의존성 없음)
```

- 원본은 `templates/`입니다. `docs/`는 빌드 결과(저장소에 없음, `.gitignore`)라 직접 고치지 않습니다. `templates/static/`은 그대로 복사됩니다.
- 티어 순서·직책 순서는 `templates/assets/core.js` 맨 위 `SITE_ORDER` 한 곳에서만 고칩니다(파이썬 빌드도 읽음).
- 공개 CSS는 `templates/assets/style/`의 섹션 파일(`01-tokens.css` … `18-tools-entry.css`)이고, 빌드가 이름 순서대로
  합쳐 `docs/style.css`로 냅니다. **번호 순서가 곧 우선순위**라, 부품을 고칠 때는 뒤에 새 규칙을 덧붙이지 말고
  그 부품 파일의 원래 규칙을 고칩니다. `14-surfaces.css`는 남색 면의 색 변수만 두는 곳입니다. 어드민 CSS는 `admin.css`.
- 화면 문구는 끝에 마침표·말줄임표(`.` `...` `…`)를 붙이지 않습니다. 관리자가 입력한 히어로 설명도 표시할 때 끝을 지웁니다.
- `npm test`가 같은 선택자 규칙이 두 번 생기거나, 안 쓰는 클래스 규칙이 남거나, 문구 끝에 마침표가 붙으면 실패합니다(`.github/workflows/test.yml`).

## GitHub·Supabase 설정 값

| 이름 | 종류 | 쓰는 곳 |
|---|---|---|
| `SUPABASE_DB_URL` | Actions secret | 빌드의 Supabase 내보내기 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Actions variable/secret | 브라우저용 `supabase-config.js` |
| `github_actions_token` | Supabase Vault | "달력 사진 갱신" 버튼 |

## Supabase SQL

- 공유 DB의 파이프라인 스키마와 공개 뷰: `ststat/migrations`
- 이 저장소 `supabase/`: `setup.sql`(관리자 테이블·RPC 초기 설치), `public_read.sql`(공개 읽기 권한),
  `admin_inline_editor.sql`, `admin_elo_stats.sql`, `calendar_capture.sql`(달력 사진 갱신 버튼)

## 지켜야 할 것

- **EloBoard 요청 간격은 최소 2초**(운영자 요청). ststat 코드에서 2초 미만으로 못 내리게 막혀 있습니다.
- `calendar.png` 파일 이름·주소는 외부 자동화가 쓰므로 바꾸지 않습니다.

## 참고 문서

분석·설계 기록은 [`notes/`](notes/)에 있습니다(구조 분석, 성능·어드민 검토, 티어 랭킹 모델).
