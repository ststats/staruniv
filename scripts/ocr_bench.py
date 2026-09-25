"""일회성: 티어표 닉네임 글씨 인식기 비교(Tesseract 개선 전처리 · EasyOCR · PaddleOCR). 결과 JSON을 로그로 낸다."""
import json, re, sys, time, urllib.request, io
import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, 'scripts')
import tier_table as tt
import pytesseract

URL = sys.argv[1]
HANGUL = re.compile('[가-힣]')


def clusters(a, bg):
    ink = np.abs(a - bg).sum(axis=2) > 150; cols = ink.any(axis=0); W = a.shape[1]; out = []; x = 0
    while x < W:
        if cols[x]:
            s = x
            while x < W and cols[x:x + 3].any(): x += 1
            out.append((s, x))
        x += 1
    return out


def strip_badge(crop, bg):
    a = np.asarray(crop).astype(int); bgv = np.array(bg); bl = bgv.mean(); lum = a.mean(axis=2)
    cs = clusters(a, bgv)
    if len(cs) < 2: return crop
    dark = lambda s, e: int((lum[:, s:e] < bl - 40).sum())
    if dark(*cs[0]) >= 30: return crop
    for s, e in cs[1:]:
        if dark(s, e) >= 60: return crop.crop((0, 0, max(1, s - 2), crop.height))
    return crop


def soft(crop, bg, scale=4):
    a = np.asarray(crop).astype(np.float32)
    dist = np.abs(a - np.array(bg, dtype=np.float32)).sum(axis=2)
    g = np.clip(255 - dist * 255 / max(200.0, np.percentile(dist, 98)), 0, 255).astype(np.uint8)
    im = Image.fromarray(g, 'L').resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
    return ImageOps.expand(im, border=16, fill=255)


def clean(t):
    return ''.join(ch for ch in tt.split_role(t)[1] if HANGUL.match(ch) or ch.isalnum())


req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGB')
secs = tt.read_image(im, {})
crops = []
for si, sec in enumerate(secs):
    for i, c in enumerate(sec['cards']):
        nxt = min((d['x'] for d in sec['cards'] if d['row'] == c['row'] and d['x'] > c['x']), default=c['x'] + 1000)
        tw = max(40, min(125, nxt - (c['x'] + c['side'] + 5) - 4)); tx = c['x'] + c['side'] + 5
        bg = tuple(int(c['bg'][k:k + 2], 16) for k in (0, 2, 4))
        crop = strip_badge(tt.cut_badge(im.crop((tx, c['y'] + 26, tx + tw, c['y'] + 50))), bg)
        crops.append((f'{si:02d}_{i:02d}', crop, bg))
res = {k: {} for k in ('tess_new', 'easy', 'paddle')}
times = {}

t = time.time()
for key, crop, bg in crops:
    img = soft(crop, bg); out = ''
    for psm in (7, 8, 13):
        out = clean(pytesseract.image_to_string(img, lang='kor', config=f'--psm {psm}'))
        if HANGUL.search(out): break
    res['tess_new'][key] = out
times['tess_new'] = round(time.time() - t, 1)

t = time.time()
import easyocr
reader = easyocr.Reader(['ko', 'en'], gpu=False, verbose=False)
times['easy_load'] = round(time.time() - t, 1); t = time.time()
for key, crop, bg in crops:
    big = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
    res['easy'][key] = clean(''.join(reader.readtext(np.array(big), detail=0, paragraph=True)))
times['easy'] = round(time.time() - t, 1)

t = time.time()
from paddleocr import TextRecognition
model = TextRecognition(model_name='korean_PP-OCRv5_mobile_rec')
times['paddle_load'] = round(time.time() - t, 1); t = time.time()
for key, crop, bg in crops:
    big = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
    out = model.predict(np.array(big)[:, :, ::-1])
    res['paddle'][key] = clean(out[0]['rec_text'] if out else '')
times['paddle'] = round(time.time() - t, 1)

print('BENCH_TIMES', json.dumps(times))
print('BENCH_RESULT', json.dumps(res, ensure_ascii=False))
