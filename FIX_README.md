# StarUniv 방송통계 Supabase 수정

## 원인

StarUniv `core.js`의 `fetchSynergyData()`가 여전히 Synergy의 구형 GitHub Pages JSON을 읽고 있었습니다.

- `data/dates.js`
- `data/daily/YYYY-MM-DD.json`

Synergy Part 9에서 이 파일들을 삭제했기 때문에 StarUniv 방송통계가 404로 실패했습니다.

## 수정 내용

- `synergy_daily_dates`에서 최신 날짜 조회
- `daily_member_stats`에서 해당 날짜 통계 직접 조회
- 1000행 제한을 피하도록 페이지 단위 전체 조회
- SOOP ID로 StarUniv 멤버와 매칭
- `publicSupabaseClient()` 공용 함수 추가
- 방송통계/멤버/티어 페이지에 Supabase JS와 `supabase-config.js` 로드
- Part 9 상대전적의 `publicSupabaseClient()` 의존성도 함께 정상화

## 적용

ZIP을 StarUniv 루트에 덮어쓴 뒤:

```cmd
git add -A
git commit -m "Fix StarUniv Supabase broadcast stats"
git pull --rebase origin main
git push origin main
```

별도 SQL은 필요 없습니다.
Synergy Part 8의 public read policy/view가 이미 적용되어 있으면 됩니다.
