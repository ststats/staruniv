# StarUniv 최종 Supabase 적용

이 패치는 이전의 **직접 Supabase 조회 + 일정/휴방/메뉴 + 연혁/미디어** 패치를 한 번에 합친 최종본입니다.

## 1. 코드 덮어쓰기
이 ZIP의 파일/폴더를 기존 StarUniv 프로젝트 루트에 그대로 덮어씁니다. 폴더 자체를 한 단계 더 넣지 말고 `templates`, `docs`, `scripts`, `supabase`가 기존 프로젝트의 같은 경로와 겹치게 복사하세요.

## 2. Supabase SQL은 `setup.sql` 하나만 실행
Supabase Dashboard → **SQL Editor → New query** 에서 아래 파일 전체를 붙여넣고 Run 합니다.

`supabase/setup.sql`

최종 적용에서는 `schema.sql`, `admin.sql`, `live_content.sql`, `content_media.sql`, `public_read.sql`을 따로 실행할 필요가 없습니다. `setup.sql` 안에 모두 순서대로 포함되어 있습니다.

이 SQL은 다음을 준비합니다.
- 멤버 / 팀 / 전적 / 라운드 / 티어 기본 테이블과 RLS
- 관리자 판별 및 CRUD 정책
- 캘린더 일정 `calendar_events`
- 휴방 `calendar_off_air`
- 메뉴 설정 `site_config`
- 연혁 `history_entries`
- 팀 로고 경로 `teams.logo_path`
- 선택형 멤버 커스텀 이미지 `members.avatar_path`
- 공개 Storage 버킷 `staruniv-media`
- Storage 관리자 업로드/수정/삭제 정책
- 공개 사이트 최소 SELECT 권한
- 기존 `calendar.json`, `nav.json`, `history.json` 기준 초기 데이터 시드

`setup.sql`은 기존 운영 데이터가 있는 환경에서도 다시 실행할 수 있도록 작성되어 있습니다. 다만 `live_content.sql`에서 캘린더/메뉴 초기값은 같은 키/ID에 대해 upsert하므로, **이미 Supabase 관리자에서 캘린더나 메뉴를 운영 중이라면 실행 전에 DB 백업을 권장**합니다.

## 3. 관리자 계정 등록 확인
기존 관리자 계정이 이미 동작하면 건드릴 필요 없습니다. 처음 설치하는 경우 `supabase/admin.sql` 하단의 설명에 따라 Supabase Authentication 사용자를 `admin_users`에 등록해야 합니다. `setup.sql`은 관리자 테이블/정책을 만들지만 어떤 이메일을 관리자로 지정할지는 자동으로 알 수 없어서 계정 지정만 수동입니다.

## 4. 기존 Git 이미지까지 Storage로 옮기기 (선택)
SQL 적용 후 기존 연혁 이미지와 팀 로고를 Supabase Storage로 실제 이전하려면 프로젝트 루트에서 1회 실행합니다.

PowerShell:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
python scripts/migrate_content_media.py
```

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저 JS, HTML, GitHub 저장소에 넣지 마세요. 로컬 마이그레이션 실행에만 사용합니다.

이 스크립트를 실행하지 않아도 사이트는 동작합니다. 팀 로고/연혁 이미지는 Storage에 없으면 기존 Git 정적 파일로 fallback합니다. 멤버 사진은 커스텀 이미지가 없으면 기존 SOOP 프로필을 사용합니다.

## 5. 배포
이번에는 프론트/관리자 코드 자체가 바뀌므로 수정 파일을 Git에 커밋/푸시하여 한 번 배포해야 합니다.

```bash
git add .
git commit -m "Finalize direct Supabase content backend"
git push
```

그 이후 운영 데이터는 관리자에서 저장하면 Supabase에 바로 반영되며, 일정/휴방/메뉴/연혁/멤버/전적/티어/운영 이미지 변경 때문에 GitHub Actions로 JSON을 다시 굽는 과정은 필요하지 않습니다.

## 6. 적용 확인
배포 후 아래를 확인하세요.
- 일정 페이지: 기존 일정과 휴방 표시
- 관리자 일정/휴방: 추가/수정/삭제 후 새로고침 없이 DB 반영
- 메뉴 설정: 저장 후 공개 사이트에서 반영
- 연혁: DB 연혁 및 YouTube 링크 표시
- 팀 로고: Storage 업로드 로고 우선, 없으면 기존 Git 로고
- 멤버 프로필: 커스텀 Storage 이미지 우선, 없으면 SOOP 프로필
- 전적/라운드/티어: 정적 JSON보다 Supabase 직접 조회 우선

## 유지하는 정적 자산
CSS, JS, 고정 SVG, UI 아이콘, 폰트, 파비콘, 배경 장식 등 **디자인/코드 자산은 Git에 유지**합니다. Supabase로 옮긴 것은 운영자가 수정하는 데이터와 미디어입니다.
