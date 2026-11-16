"""전처리 조합 이미지 생성.

사용: python3 make_grid.py <data폴더> [--only 이름,이름,...] [--no-sharpen] [--list 출력목록]
  --only        이 영수증들만 (기본: 정답지에 있는 전부)
  --no-sharpen  선명화 켬 조합을 뺀다 (1차 실험에서 효과가 없어서 2차 실험은 이것으로 돌렸다)
"""
import sys, os, json, argparse, itertools, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from pipeline import run
ap = argparse.ArgumentParser(); ap.add_argument('data'); ap.add_argument('--only'); ap.add_argument('--no-sharpen', action='store_true')
ap.add_argument('--list'); A = ap.parse_args(); W = A.data
if A.only: R = A.only.split(',')
else:
    R = [k for k in json.load(open(f'{W}/groundtruth.json', encoding='utf-8')) if not k.startswith('_')]
os.makedirs(f'{W}/variants', exist_ok=True)
SH = [0] if A.no_sharpen else [0, 1]
combos = [('raw', dict(rotate_on=False)), ('rot', dict())]
for c, g, t, s, h in itertools.product([0,1],[0,1],['none','clahe','illum'],SH,[32,48,64]):
    combos.append((f'c{c}_g{g}_t{t}_s{s}_h{h}', dict(crop=bool(c), gray=bool(g), tone=t, sharpen=bool(s), text_h=h)))
for c, s, h in itertools.product([0,1],SH,[32,48,64]):
    combos.append((f'c{c}_g1_tbin_s{s}_h{h}', dict(crop=bool(c), gray=True, tone='binarize', sharpen=bool(s), text_h=h)))
lst = []
# 잡음 기준선: 눈에 안 보이는 변화(2px 이동, 3% 축소, JPEG 재압축)만 준 이미지
for n in R:
    base = run(f'{W}/photos/{n}.jpg', f'{W}/prev/{n}.raw.json')
    for tag, im in (('jit-shift', base[2:, 2:]),
                    ('jit-scale', cv2.resize(base, None, fx=0.97, fy=0.97, interpolation=cv2.INTER_AREA)),
                    ('jit-jpeg', cv2.imdecode(cv2.imencode('.jpg', base, [cv2.IMWRITE_JPEG_QUALITY, 95])[1], cv2.IMREAD_COLOR))):
        p = f'{W}/variants/{n}__{tag}.png'; cv2.imwrite(p, im); lst.append(p)
for name, kw in combos:
    for n in R:
        p = f'{W}/variants/{n}__{name}.png'
        cv2.imwrite(p, run(f'{W}/photos/{n}.jpg', f'{W}/prev/{n}.raw.json', **kw)); lst.append(p)
# 기준선 2개와 잡음 측정을 먼저, 그다음 조합 순서로 (중간에 끊겨도 끝난 조합은 5장이 다 있게)
FIRST = ('__raw.', '__rot.', '__c1_g0_tnone_s0_h32.')   # 기준선 2개와 1차 실험에서 고른 조합
lst = [p for p in lst if any(t in p for t in FIRST)] + [p for p in lst if '__jit' in p] + \
      [p for p in lst if not any(t in p for t in FIRST) and '__jit' not in p]
open(A.list or f'{W}/variants/list.txt','w').write('\n'.join(lst) + '\n')
print(len(combos), '조합 ×', len(R), '장 +', 3*len(R), '잡음 측정 =', len(lst), '장')
