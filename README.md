# StarUniv

StarUniv 관리자와 정적 웹사이트 저장소입니다.

- 관리자는 공유 Supabase의 일정, 멤버, 경기, 로스터, 영상 설정을 편집합니다.
- `ststat`가 EloBoard, Poonggo, YouTube 데이터와 파생 통계를 갱신합니다.
- 브라우저는 변동이 큰 티어·Elo·방송·영상 데이터를 Supabase에서 직접 읽습니다.
- 멤버·내부 경기 화면은 Supabase export로 만든 `docs/data/site_data.json`을 사용합니다.

## 웹 빌드

```powershell
python -m pip install -r requirements.txt
python scripts/export_supabase.py
python scripts/generate_stats.py
python scripts/build_html.py
python scripts/write_site_data.py
```

GitHub Actions는 수동 실행과 관련 소스 변경으로 웹을 다시 빌드합니다. 운영 주기 실행은 외부 크론이 `workflow_dispatch`를 호출합니다. 필요한 설정은 `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`입니다.

공유 DB의 파이프라인 스키마와 공개 뷰는 `ststat/migrations`에서 관리합니다. 이 저장소의 `supabase/setup.sql`은 StarUniv 관리자 기본 테이블과 RPC의 초기 설치용입니다.
