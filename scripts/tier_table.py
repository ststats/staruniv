"""펨코 스타 티어표(대학별 카드 이미지 + FA 명단 글)를 읽어 DB 티어표와 비교한다.

    python scripts/tier_table.py --image <이미지 주소 또는 파일> [--fa-text FA명단.txt] [--out 결과.json] [--learn]

1. 이미지를 배경색으로 대학 구역에 나누고, 구역마다 카드 자리를 찾는다. 줄·칸 수나 간격을 가정하지
   않는다(깔끔한 카드로 줄·칸 선을 알아낸 뒤 교차점을 다시 본다) - 인원이 늘어 배치가 바뀌어도 된다.
2. 카드마다 사진 지문(32×32 색)과 티어·종족 글씨(늘리지 않은 원본 칸의 잉크 농도)를 만든다.
3. 기억(data/tier_table_memory.json)과 비교한다.
   - 사진이 같으면 같은 선수(다른 선수끼리는 12 이상, 같은 사진은 다시 압축·2px 어긋나도 3.3 이하).
   - 티어·종족은 기억한 글씨(그 선수의 지난번 글씨 포함) 중 가장 가까운 값. 안 바뀐 카드는 다시
     압축해도 219/219 그대로, 처음 보는 글씨(승급 등)는 약 95%라 변동으로 올려 사람이 확인한다.
   - 기억에 없으면 Tesseract OCR(무료)로 읽고, 닉네임은 같은 대학 DB 명단에서 비슷한 이름과 맞춘다.
4. FA 명단 글은 '티어｜ T 이름 … Z 이름 … P 이름 …' 형식을 그대로 읽는다.
5. 결과: 소속·티어·종족 변동(changes), 사람이 확인할 것(review: 처음 보는 카드·표에서 빠짐 등).
   티어·종족 글씨를 못 읽었거나 비슷한 글씨와 헷갈리면(UNSURE_MARGIN) 안 바뀐 것으로 읽혔어도 '확인 필요'
   변동으로 올린다. 관리자가 값을 고쳐 반영하면 그 카드 글씨를 고친 값으로 기억한다(다음부터 바로 읽음).
   --learn: 이번 결과의 확실한 짝을 기억에 더한다(관리자 화면에서는 반영할 때 자동으로).

DB는 공개 읽기(Supabase REST, publishable key)로 tier_members의 공개 칸만 읽는다.
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
from tiertable.sources import load_db, load_image


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
    db = load_db()
    result = compare(sections, fa, db)
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
