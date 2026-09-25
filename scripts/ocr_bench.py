"""일회성: PaddleOCR에 이미지 손질(회색 농도 확대)을 더하면 얼마나 읽는지 비교한다."""
import io, json, re, sys, time, urllib.request
import numpy as np
from PIL import Image
sys.path.insert(0, 'scripts')
import tier_table as tt

TRUTH = json.load(open('scripts/_ocr_truth.json', encoding='utf-8'))
HANGUL = re.compile('[가-힣]')
clean = lambda t: ''.join(ch for ch in tt.split_role(t)[1] if HANGUL.match(ch) or ch.isalnum())
req = urllib.request.Request(sys.argv[1], headers={'User-Agent': 'Mozilla/5.0'})
im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGB')
secs = tt.read_image(im, {})
crops = []
for si, sec in enumerate(secs):
    for i, c in enumerate(sec['cards']):
        nxt = min((d['x'] for d in sec['cards'] if d['row'] == c['row'] and d['x'] > c['x']), default=c['x'] + 1000)
        tw = max(40, min(125, nxt - (c['x'] + c['side'] + 5) - 4)); tx = c['x'] + c['side'] + 5
        bg = tuple(int(c['bg'][k:k + 2], 16) for k in (0, 2, 4))
        crop = tt.strip_badge(tt.cut_badge(im.crop((tx, c['y'] + 26, tx + tw, c['y'] + 50))), bg)
        crops.append((f'{si:02d}_{i:02d}', crop, bg, c['nickname_ocr']))

from paddleocr import TextRecognition
t = time.time(); model = TextRecognition(model_name='korean_PP-OCRv5_mobile_rec'); load = time.time() - t


def paddle(img):
    arr = np.array(img.convert('RGB'))[:, :, ::-1]
    out = model.predict(arr)
    return clean(out[0]['rec_text'] if out else '')


variants = {
    '원본x2': lambda c, bg: c.resize((c.width * 2, c.height * 2), Image.LANCZOS),
    '원본x3': lambda c, bg: c.resize((c.width * 3, c.height * 3), Image.LANCZOS),
    '손질x2': lambda c, bg: tt.name_ink(c, bg, 2),
    '손질x3': lambda c, bg: tt.name_ink(c, bg, 3),
    '손질x4': lambda c, bg: tt.name_ink(c, bg, 4),
}
report = {'paddle_load_s': round(load, 1)}
reads = {}
for name, f in variants.items():
    t = time.time(); r = {k: paddle(f(c, bg)) for k, c, bg, _ in crops}
    ok = sum(1 for k in TRUTH if r.get(k) == TRUTH[k])
    report[name] = {'ok': ok, 'of': len(TRUTH), 's': round(time.time() - t, 1)}
    reads[name] = r
tess = {k: n for k, _, _, n in crops}
report['tesseract_new'] = {'ok': sum(1 for k in TRUTH if tess.get(k) == TRUTH[k]), 'of': len(TRUTH)}
best = max(variants, key=lambda n: report[n]['ok'])
report['both(best+tess)'] = sum(1 for k in TRUTH if TRUTH[k] in (tess.get(k), reads[best].get(k)))
report['best_wrong'] = [(k, reads[best][k], TRUTH[k]) for k in TRUTH if reads[best][k] != TRUTH[k]]
print('BENCH', json.dumps(report, ensure_ascii=False))
