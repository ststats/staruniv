"""펨코 스타 티어표(대학별 카드 이미지 + FA 명단 글)를 읽어 DB 티어표와 비교한다.

    python scripts/tier_table.py --image <이미지 주소 또는 파일> [--fa-text FA명단.txt] [--out 결과.json] [--learn]

카드의 사진 지문·티어·종족 글씨를 기억(data/tier_table_memory.json)과 맞추고, 처음 보는 것은 OCR로 읽는다.
결과는 변동(changes)과 사람이 확인할 것(review). DB는 SUPABASE_DB_URL로 연결한다.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

from tiertable.cards import read_image
from tiertable.compare import compare, match_sections
from tiertable.fa import read_fa_text
from tiertable.job import run_job
from tiertable.memory import MEMORY_PATH, learn, load_memory, save_memory
from tiertable.sources import db_connect, load_candidates, load_db, load_image, load_off_board


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--image', help='티어표 이미지 주소 또는 파일')
    ap.add_argument('--job', help='tier_update_jobs 작업 번호(GitHub Actions에서 실행, SUPABASE_DB_URL 필요)')
    ap.add_argument('--fa-text', help='FA 명단 글(텍스트 파일)')
    ap.add_argument('--out', help='결과 JSON 파일')
    ap.add_argument('--memory', default=str(MEMORY_PATH), help='기억 파일(사진 지문·글씨 모양)')
    ap.add_argument('--learn', action='store_true',
                    help='이번 결과 중 확실한 짝(이름 유사도 0.8 이상·사진 일치)을 기억에 더한다. '
                         '변동이 맞는지 확인한 뒤에 쓴다(관리자 화면에서는 반영 때 자동)')
    args = ap.parse_args()
    if args.job:
        if not re.fullmatch(r'\d+', args.job):
            raise SystemExit('작업 번호는 숫자여야 합니다')
        run_job(int(args.job))
        return
    if not args.image:
        ap.error('--image 또는 --job이 필요합니다')
    im = load_image(args.image)
    if im.width != 1100:
        im = im.resize((1100, round(im.height * 1100 / im.width)), Image.LANCZOS)
    memory = load_memory(args.memory)
    sections = read_image(im, memory)
    fa = read_fa_text(Path(args.fa_text).read_text(encoding='utf-8')) if args.fa_text else []
    with db_connect() as conn:
        db = load_db(conn)
        result = compare(sections, fa, db, load_candidates(conn), load_off_board(conn))
    if args.learn:
        confirmed = [(c, hit[0]) for sec in match_sections(sections, db)
                     for i, c in enumerate(sec['cards']) for hit in [sec['match'].get(i)] if hit and hit[1] >= 0.8]
        save_memory(learn(memory, confirmed), args.memory)
        print(f'기억에 더함: 카드 {len(confirmed)}장 → 사진 {len(memory["photos"])}·티어 모양 {len(memory["tier"])}·종족 모양 {len(memory["race"])}',
              file=sys.stderr)
    result['sections'] = sections
    result['fa'] = fa
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
    for c in result['changes']:
        print('변동', c['team'], c['nickname'], c['diff'])
    for r in result['review']:
        print('확인', r)
    print(f"카드 {sum(len(s['cards']) for s in sections)}장, FA {len(fa)}명, 변동 {len(result['changes'])}건, 확인 {len(result['review'])}건",
          file=sys.stderr)


if __name__ == '__main__':
    main()
