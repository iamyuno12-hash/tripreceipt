"""일본어 영수증: 한국어 모델 결과 vs 다른 인식 모델 결과.

사용: python3 ja_compare.py <data폴더> <다른모델 결과 폴더> [조합,조합,...]
  <data>/results/ 는 한국어 모델 결과, <다른모델 결과 폴더> 는 같은 이미지를 다른 모델로 돌린 결과.
  다른 모델 결과는 모델만 바꾼 임시 빌드로 만든다 (README '일본어 모델 비교').
  여기서는 일본어 글자 칸도 채점한다. 반각 가타카나(ﾊﾟﾝ)와 전각(パン)은 NFKC 로 같은 글자로 본다.
"""
import sys, os, json, copy, unicodedata, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import scoring
scoring.norm = lambda s: re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))
W, OTHER = sys.argv[1], sys.argv[2]
VARS = (sys.argv[3] if len(sys.argv) > 3 else 'raw,rot,c1_g0_tnone_s0_h32').split(',')
GT = scoring.load_gt(f'{W}/groundtruth.json')
LANG_NOTE = '일본어 — 한국어 인식 모델이 읽을 수 없는 글자라 채점 제외'
JA = [k for k in GT if any(c.get('note') == LANG_NOTE for row in GT[k] for c in row)]
def unlock(rows):
    rows = copy.deepcopy(rows)
    for r in rows:
        for c in r:
            if c.get('note') == LANG_NOTE: c.pop('uncertain'); c.pop('note')
    return rows
tot = {}
for r in JA:
    g = unlock(GT[r])
    for v in VARS:
        for model, d in (('한국어', f'{W}/results'), ('다른모델', OTHER)):
            f = f'{d}/{r}__{v}.json'
            if not os.path.exists(f): continue
            s = scoring.score_receipt(g, json.load(open(f))['result'])
            t = tot.setdefault((v, model), [0] * 8)
            for i, k in enumerate(('num_hit', 'num_total', 'pair_ok', 'pair_total', 'item_err_chars', 'item_chars', 'date_ok', 'date_total')): t[i] += s[k]
            print(f"{r:14} {v:20} {model:4}  숫자 {s['num_hit']:2}/{s['num_total']:2}  줄 {s['pair_ok']:2}/{s['pair_total']:2}  "
                  f"품목 오류글자 {s['item_err_chars']:3}/{s['item_chars']:3}  날짜 {s['date_ok']}/{s['date_total']}")
print(f'\n[합계 — 일본어 {len(JA)}장]')
for (v, model), t in tot.items():
    print(f"  {v:20} {model:4}  숫자 {t[0]}/{t[1]}  줄 {t[2]}/{t[3]}  품목 오류글자 {t[4]}/{t[5]}  날짜 {t[6]}/{t[7]}")
