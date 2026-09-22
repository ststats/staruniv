# StarUniv 최종 Supabase 적용

이 수정본은 운영 데이터를 다음처럼 정확히 분리합니다.

- **연혁**: 연혁 항목 하나. 사진과 YouTube URL은 각 연혁에 선택 첨부
- **영상**: 별도 영상 탭. 팬튜브 채널 / 자동 수집 영상 / `보자` 추천 영상
- **도구 > 외부도구**: 기존 어드민에서 관리하던 외부 링크
- **도구 > 멀티뷰어 / 엔트리 / 캄몬라이더**: DB 대상 아님. 기존 Git 코드 유지
- 일정 / 휴방 / 메뉴 / 멤버 / 전적 / 티어: Supabase 직접 조회
- 고정 CSS / JS / SVG / 아이콘 / 파비콘 등 디자인 자산: Git 유지

## 1. 파일 덮어쓰기
ZIP 안의 파일을 기존 StarUniv 프로젝트 루트에 덮어씁니다. ZIP 폴더 자체를 넣지 말고 `templates`, `scripts`, `supabase`, `docs` 등이 기존 같은 경로와 겹치게 복사합니다.

## 2. SQL은 `supabase/setup.sql` 하나만 실행
Supabase Dashboard → **SQL Editor → New query**에서 `supabase/setup.sql` 전체를 실행합니다.

이 파일 하나에 다음이 포함됩니다.

- 기존 핵심 데이터 테이블/RLS/관리자 정책
- `calendar_events`, `calendar_off_air`, `site_config`
- `history_entries` + 연혁 사진용 Storage
- 팀 로고 / 선택형 멤버 커스텀 프로필
- `video_channels`, `videos`, `video_picks`
- `external_tools`
- 공개 사이트용 최소 SELECT 정책
- 현재 JSON 기준 일정/휴방/메뉴/연혁/영상/외부도구 초기 시드

기존 개별 SQL은 참고/부분 적용용입니다. 최종 적용에서는 `setup.sql`만 실행하면 됩니다.

## 3. 영상 자동 동기화
`scripts/sync_videos.py`는 `SUPABASE_DB_URL`이 있으면 영상 채널/추천/숨김 설정을 Supabase에서 읽고, 수집 결과를 `videos` 테이블에 직접 UPSERT합니다. `docs/data/videos.json`은 장애 대비 fallback 스냅샷으로만 남습니다.

현재 GitHub Actions는 영상 단계에 이미 `SUPABASE_DB_URL`을 넘기므로 기존 Secret이 설정돼 있다면 별도 변경이 필요 없습니다.

## 4. 기존 이미지 Storage 이전 (선택)
기존 연혁 사진/팀 로고까지 Storage로 실제 복사하려면 1회 실행합니다.

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
python scripts/migrate_content_media.py
```

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저 코드나 Git에 넣지 마세요. 이 스크립트를 실행하지 않아도 기존 Git 이미지 fallback으로 사이트는 동작합니다.

## 5. 배포
이번 코드 변경은 한 번 Git 배포가 필요합니다. 이후 관리자에서 바꾸는 운영 데이터는 Git 재빌드 없이 바로 반영됩니다.

```bash
git add .
git commit -m "Finalize Supabase live content"
git push origin main
```

## 6. 확인할 것

- **연혁 관리**: 연혁 추가/수정/삭제, 선택 사진/YouTube URL
- **영상 관리**: 팬튜브 채널, 보자 추천, 수집 영상 숨김/표시
- **외부도구 관리**: `도구 > 외부도구` 링크 추가/수정/삭제 후 즉시 반영
- **멀티뷰어**: 이전과 동일하게 동작하며 관리자 데이터와 무관
- 일정/휴방/메뉴/멤버/전적/티어: Supabase 우선 조회

정적 JSON은 마이그레이션 전 또는 Supabase 장애 시 fallback 용도만 유지합니다.
