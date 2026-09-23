# Part 9 — StarUniv 최종 컷오버

상대전적/랭킹은 이제 Supabase만 사용합니다.

적용:
1. ZIP을 StarUniv 루트에 덮어쓰기
2. `CLEANUP_PART9.cmd` 실행
3. `git status`
4. `git add -A`
5. `git commit -m "Remove StarUniv legacy fallbacks"`
6. `git push origin main`

삭제 대상:
- docs/data/h2h/**
- scripts/build_h2h.py
- scripts/build_ranking.py
- scripts/sync_eloboard.py
- scripts/elo_supabase.py
- scripts/export_elo_supabase.py
- scripts/sync_videos.py

유지:
- scripts/export_supabase.py
- scripts/generate_stats.py
- scripts/match_link.py
- scripts/build_html.py
- scripts/write_supabase_browser_config.py
