# Supabase 관리자 페이지 v6

`/admin.html`을 GitHub PAT 방식에서 Supabase Auth + RLS 방식으로 교체한다.

## 제공 기능

- Supabase Auth 이메일/비밀번호 관리자 로그인
- 멤버 CRUD
  - `id`: StarUniv 내부 행 ID
  - `name`: 사람 기준 이름
  - `nickname`: 해당 행의 방송/표시 닉네임
  - `soop_id`: SOOP 계정 ID
  - `elo_id`: ELO보드 선수 ID
- 팀 CRUD
- 경기 + 라운드 일괄 저장/삭제
- 티어 명단 CRUD (100명씩 페이지 조회)
- 시즌 설정 CRUD
- ELO 선수 조회(읽기 전용)
- 캘린더 이미지 캡처를 admin.html에서 분리하여 `/schedule/` 기준으로 실행

## 1. DB 정책 설치

Supabase → SQL Editor에서 `supabase/admin.sql` 전체를 실행한다.

## 2. 관리자 Auth 계정 만들기

Supabase → Authentication → Users → Add user에서 이메일/비밀번호 사용자를 하나 만든다.

그 다음 SQL Editor에서 아래의 이메일만 실제 관리자 이메일로 바꿔 실행한다.

```sql
insert into public.admin_users (user_id, role)
select id, 'owner'
from auth.users
where email = 'YOUR_ADMIN_EMAIL@example.com'
on conflict (user_id) do update
set role = excluded.role, is_active = true;
```

## 3. 브라우저용 공개 설정 등록

Supabase → Project Settings/API(또는 Connect/API Keys)에서 다음 두 값을 확인한다.

- Project URL → `SUPABASE_URL`
- Publishable key → `SUPABASE_PUBLISHABLE_KEY`
  - 프로젝트에 publishable key 대신 legacy anon key만 보이면 `SUPABASE_ANON_KEY` Secret을 사용해도 된다.

GitHub Repository → Settings → Secrets and variables → Actions에 등록한다.

권장:

- Repository variable: `SUPABASE_URL`
- Repository secret 또는 variable: `SUPABASE_PUBLISHABLE_KEY`

`SUPABASE_DB_URL`, DB 비밀번호, service_role key는 브라우저 설정에 절대 넣지 않는다.

## 4. 배포

패치 파일을 저장소에 덮어쓴 뒤 커밋/푸시하고, Actions → Update Site → Run workflow를 새로 실행한다.

정상 로그에는 다음 단계가 추가된다.

```text
관리자 브라우저용 Supabase 설정 생성
✅ docs/supabase-config.js 생성 완료
```

그 뒤 `/admin.html`에서 로그인한다.

## 저장 후 사이트 반영

관리자 페이지의 CRUD는 Supabase 원본 DB에는 즉시 반영된다. 현재 공개 사이트는 정적 빌드 구조이므로 `Update Site` workflow가 다음 번 실행될 때 `db.json`/HTML에 반영된다.

즉 현재 흐름은:

```text
/admin.html 저장
  → Supabase 즉시 변경
  → GitHub Actions Update Site
  → db.json / site_data.json / HTML 재생성
  → 공개 사이트 반영
```

다음 단계에서 Supabase Edge Function을 추가하면 저장 직후 `repository_dispatch`로 Update Site를 자동 실행하게 만들 수 있다.
