# StarUniv site_data.json fix

이 패치는 현재 `build_html.py`가 `docs/data/site_data.json`을 생성하지 않는 회귀를 우회합니다.

추가:
- scripts/write_site_data.py

수정:
- .github/workflows/update.yml

workflow에서:
1. generate_stats.py
2. build_html.py
3. write_site_data.py
순서로 실행하고, site_data.json 존재를 확인한 뒤에만 배포합니다.

적용 후:
git add -A
git commit -m "Restore StarUniv site data generation"
git pull --rebase origin main
git push origin main
