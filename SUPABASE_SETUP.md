# StarUniv Supabase 1차 이전

현재 사이트의 화면/통계 코드는 그대로 두고, 데이터 원본만 Google Sheets에서 Supabase로 바꾸는 단계입니다.
커뮤니티/로그인은 아직 추가하지 않습니다.

## 1. Supabase 프로젝트 만들기

Free 프로젝트를 하나 만든 뒤 SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.

현재 테이블에는 RLS만 켜고 공개 정책은 만들지 않습니다. 따라서 브라우저의 anon/authenticated 사용자가 운영 데이터를 직접 쓰지 못합니다.

## 2. DB 연결 문자열 준비

Supabase Dashboard의 Connect 메뉴에서 PostgreSQL connection string을 복사합니다.
GitHub Actions에서 사용할 예정이므로 GitHub에서 접속 가능한 pooler connection string을 권장합니다.

로컬에서는 예를 들어:

```bash
export SUPABASE_DB_URL='postgresql://...'
```

Windows PowerShell:

```powershell
$env:SUPABASE_DB_URL='postgresql://...'
```

> 이 문자열에는 DB 비밀번호가 들어가므로 코드에 직접 적거나 커밋하면 안 됩니다.

## 3. 먼저 검사만 하기

DB 연결 없이 현재 JSON이 정상적으로 변환되는지 확인할 수 있습니다.

```bash
python scripts/migrate_to_supabase.py --dry-run
```

`tierMembers`의 생년월일에서 `체크` 등 올바른 날짜가 아닌 값은 `NULL`로 정리됩니다.
`ELO 등록`, `티어표 등록`처럼 한 칸에 날짜가 여러 개 들어간 기록은 손실 방지를 위해 text로 보존합니다.

## 4. 핵심 데이터 최초 업로드

```bash
python scripts/migrate_to_supabase.py
```

업로드되는 테이블:

- settings
- teams
- members
- matches
- rounds
- tier_members

이 스크립트는 초기 이전/전체 재동기화용입니다. 대상 테이블 내용을 현재 `data/db.json` 기준으로 교체합니다.

## 5. Supabase -> 기존 db.json 테스트

기존 파일을 백업한 뒤:

```bash
cp data/db.json data/db.before-supabase.json
python scripts/export_supabase.py
```

그 다음 기존 빌드를 그대로 실행합니다.

```bash
python scripts/generate_stats.py
python scripts/build_html.py
```

사이트가 동일하게 생성되면 1차 이전이 완료된 것입니다.

## 6. GitHub Secret 추가

저장소의 **Settings -> Secrets and variables -> Actions -> Repository secrets** 에 다음 Secret을 추가합니다.

- `SUPABASE_DB_URL`

`update.yml`은 이 Secret이 있으면 Supabase에서 `data/db.json`을 만들고, 없으면 기존 Google Sheet 방식을 그대로 사용합니다.
전환이 확인되기 전까지 Google 관련 Secret을 삭제할 필요가 없습니다.

## 7. ELO는 2차로 이전

핵심 데이터가 정상 동작한 뒤 원하면 현재 `data/eloboard.json`까지 넣습니다.

```bash
python scripts/migrate_to_supabase.py --include-elo
```

추가 테이블:

- elo_categories
- elo_maps
- elo_players
- elo_matches

현재 사이트의 ELO 증분 수집/상대전적 생성은 아직 기존 `data/eloboard.json`을 사용합니다. 핵심 DB 전환을 확인한 다음 ELO 동기화 방향을 별도로 바꾸는 것이 안전합니다.

## 멤버 ID / 이름 규칙

`members` 테이블에서는 식별자를 다음처럼 구분합니다.

- `id`: StarUniv DB 내부 행 PK. 외부 사이트 ID로 사용하지 않음.
- `soop_id`: SOOP 계정 ID.
- `elo_id`: ELO보드 선수 ID. `eloboard.json`의 `players` 객체 key가 원본에서는 단순 `id`처럼 보이지만 DB에는 `elo_id`로 저장.
- `name`: 같은 사람의 기준 이름. `tierMembers`에서 같은 `SOOP ID`의 `이름`을 가져옴.
- `nickname`: 해당 멤버 행에서 실제 사용한 표시/방송 닉네임. 기존 `members[].이름`이 여기에 들어감.

멤버 행은 합치지 않습니다. 예를 들어 같은 SOOP 계정 `wlswn6565`가 과거 `진땅콩 T`, 이후 `진땅콩`으로 각각 별도 행에 존재하면 두 행을 그대로 유지합니다. 두 행은 서로 다른 `members.id`를 갖지만 `name=진땅콩`, `soop_id=wlswn6565`, `elo_id=775`를 공유할 수 있습니다.
