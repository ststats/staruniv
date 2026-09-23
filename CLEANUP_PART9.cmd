@echo off
setlocal
echo [StarUniv Part 9] Removing legacy fallbacks...

if exist docs\data\h2h rmdir /s /q docs\data\h2h
if exist scripts\build_h2h.py del /q scripts\build_h2h.py
if exist scripts\build_ranking.py del /q scripts\build_ranking.py
if exist scripts\sync_eloboard.py del /q scripts\sync_eloboard.py
if exist scripts\elo_supabase.py del /q scripts\elo_supabase.py
if exist scripts\export_elo_supabase.py del /q scripts\export_elo_supabase.py
if exist scripts\sync_videos.py del /q scripts\sync_videos.py

echo.
echo Finished.
echo git status
echo git add -A
echo git commit -m "Remove StarUniv legacy fallbacks"
echo git push origin main
endlocal
