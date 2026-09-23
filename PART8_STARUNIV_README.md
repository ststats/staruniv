# Part 8 - StarUniv web cleanup

1. Overlay this patch on StarUniv.
2. Run `supabase/web_cutover.sql` once in Supabase SQL Editor.
3. Commit/push.
4. Run `Build StarUniv web` once manually.
5. Open Tier > 상대전적. It now uses Supabase first and falls back to existing `docs/data/h2h` only if Supabase fails.
6. After validation, delete files listed in `REMOVE_FILES.txt`.

The web workflow no longer collects YouTube/EloBoard or calculates H2H/ranking. Those belong to `ststat`.
`generate_stats.py` remains because it calculates StarUniv's own internal match/round presentation stats, which has not yet been moved to ststat.
