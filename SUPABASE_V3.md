# Supabase v3 — ELO도 Supabase 원본으로 전환

이 버전에서는 `elo_categories`, `elo_maps`, `elo_players`, `elo_matches`가 ELO의 원본입니다.
`data/eloboard.json`은 `build_h2h.py` / `build_ranking.py` 호환을 위해 Actions 실행 중 Supabase에서 재생성하는 캐시입니다.

## 바뀐 파일

- `.github/workflows/update.yml`
- `.gitignore`
- `scripts/sync_eloboard.py`
- `scripts/export_elo_supabase.py` (신규)
- `scripts/elo_supabase.py` (신규)

DB 스키마 변경은 없습니다. 기존 v2의 `elo_*` 테이블을 그대로 사용합니다.

## 기존 저장소에 덮어쓴 뒤 한 번만 실행

Windows CMD 기준:

```bat
git rm --cached --ignore-unmatch build/linked_db.json
git rm --cached --ignore-unmatch data/eloboard.json

git add .gitignore
git add .github\workflows\update.yml
git add scripts\sync_eloboard.py
git add scripts\export_elo_supabase.py
git add scripts\elo_supabase.py
git add SUPABASE_V3.md

git commit -m "Use Supabase as ELO source"
git pull --rebase origin main
git push
```

`git rm --cached`는 로컬 파일 자체를 삭제하지 않고 Git 추적만 해제합니다.

## 로컬 확인

같은 CMD 창에 `SUPABASE_DB_URL`이 설정되어 있다면:

```bat
python scripts\export_elo_supabase.py
```

정상 예시:

```text
✅ Supabase ELO -> data/eloboard.json 내보내기 완료
   elo_matches : 375,877행
   elo_players : 1,248명
   ...
```

그 다음 기존 빌드 호환 확인:

```bat
python scripts\build_h2h.py
python scripts\build_ranking.py
```

## Actions에서 달라지는 흐름

```text
Supabase core tables ──> data/db.json

Supabase elo_* ──> data/eloboard.json (임시 캐시)
                        │
eloboard API ── 최신분 ─┴─> elo_* UPSERT
                        │
                        └─> build_h2h.py / build_ranking.py
```

ELO API가 일시적으로 실패하면 Supabase에서 먼저 만든 스냅샷을 그대로 사용하여 사이트 빌드를 계속합니다.
증분 수집이 중간에 끊기면 일부 경기만 DB에 넣지 않고 전체 변경을 버려서 `max(id)`가 앞서가는 문제를 막습니다.

## Actions 성공 여부 확인

새 `Run workflow`를 실행한 뒤 로그에 아래 단계가 보여야 합니다.

```text
Supabase에서 ELO 캐시 만들기
ELO 최신분을 Supabase에 증분 저장
상대전적 파일 만들기
티어랭킹 계산
```

마지막 `git status`에는 아래 두 파일이 더 이상 나오지 않는 것이 정상입니다.

```text
build/linked_db.json
data/eloboard.json
```

## Supabase 행 수 확인 SQL

```sql
select 'elo_categories' as table_name, count(*) as row_count from public.elo_categories
union all
select 'elo_maps', count(*) from public.elo_maps
union all
select 'elo_players', count(*) from public.elo_players
union all
select 'elo_matches', count(*) from public.elo_matches;
```
