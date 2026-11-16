"""정답지 대조표: 왼쪽은 바로 세운 영수증 사진, 오른쪽은 정답지 내용."""
import sys, json, cv2, numpy as np; HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__)); sys.path.insert(0, HERE); W = sys.argv[1]
from PIL import Image, ImageDraw, ImageFont
from pipeline import first_pass_stats, rotate, receipt_rect
import os; os.makedirs(f'{W}/sheet', exist_ok=True)
FONT = os.environ.get('CJK_FONT', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')  # 한글 글꼴 경로 (fonts-noto-cjk)
f = ImageFont.truetype(FONT, 26); fb = ImageFont.truetype(FONT, 34); fs = ImageFont.truetype(FONT, 20)
GT = {k: v for k, v in json.load(open(f'{W}/groundtruth.json', encoding='utf-8')).items() if not k.startswith('_')}
KCOL = {'merchant': (90,60,160), 'date': (20,110,160), 'item': (20,20,20), 'label': (110,110,110), 'num': (20,130,60), 'code': (150,100,20)}
KNAME = {'merchant':'상호','date':'일시','item':'품목','label':'라벨','num':'숫자','code':'코드'}
for n, rows in GT.items():
    im = cv2.imread(f'{W}/photos/{n}.jpg'); a, _ = first_pass_stats(f'{W}/prev/{n}.raw.json')
    up = rotate(im, a, (255,255,255)); r = receipt_rect(rotate(im, a, (0,0,0)))
    if r: up = up[r[1]:r[3], r[0]:r[2]]
    H = 1900; s = H / up.shape[0]
    photo = Image.fromarray(cv2.cvtColor(cv2.resize(up, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))
    panel = Image.new('RGB', (1100, 6000), 'white'); d = ImageDraw.Draw(panel)
    d.text((30, 20), f'{n} 정답지', font=fb, fill=(0,0,0))
    lx = 30
    for k, v in KNAME.items():
        d.text((lx, 70), v, font=fs, fill=KCOL[k]); lx += d.textlength(v, font=fs) + 18
    d.text((lx + 10, 70), '· 회색 글씨 = 채점 제외', font=fs, fill=(170,170,170))
    # 제외 사유는 번호로 묶어 맨 위에 한 번만 적는다 (같은 사유가 여러 칸에 반복되면 표가 길어져 잘리므로)
    notes = []
    for row in rows:
        for c in row:
            if c.get('note') and c['note'] not in notes: notes.append(c['note'])
    MARK = '①②③④⑤⑥⑦⑧⑨'
    y = 110
    for i, nt in enumerate(notes):
        d.text((30, y), f'{MARK[i]} {nt}', font=fs, fill=(170,90,40)); y += 28
    x0 = 30; y += 14
    for row in rows:
        x = x0
        for c in row:
            t = c['t'] + (f" ({MARK[notes.index(c['note'])]}제외)" if c.get('note') else (' (제외)' if c.get('uncertain') else ''))
            col = (180,180,180) if c.get('uncertain') else KCOL[c['k']]
            d.text((x, y), t, font=f, fill=col); x += d.textlength(t, font=f) + 34
        y += 38
    panel = panel.crop((0, 0, 1100, max(H, y + 20)))   # 정답이 길면 사진보다 길게 둔다 (잘리지 않게)
    sheet = Image.new('RGB', (photo.width + panel.width + 20, max(H, panel.height)), 'white')
    sheet.paste(photo, (0, 0)); sheet.paste(panel, (photo.width + 20, 0))
    sheet.save(f'{W}/sheet/sheet-{n}.jpg', quality=88); print('  ', n, sheet.size)
