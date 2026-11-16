"""2차 영수증으로 1차에서 고른 조합을 검증한다 (처음 보는 영수증에서도 맞는가).

사용: python3 heldout.py <data폴더> [조합,조합,...] [--from 6]
  --from N : 번호가 N 이상인 영수증(r6-…, r7-…)을 2차로 본다. 기본 6.
  일본어 영수증(정답지 note 에 '일본어'가 있는 칸이 있는 영수증)은 따로 합계를 낸다.
"""
import sys, os, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from scoring import score_receipt, load_gt
ap = argparse.ArgumentParser(); ap.add_argument('data'); ap.add_argument('variants', nargs='?', default='raw,rot,c1_g0_tnone_s0_h32')
ap.add_argument('--from', dest='start', type=int, default=6); A = ap.parse_args(); W = A.data
GT = load_gt(f'{W}/groundtruth.json')
NEW = sorted([k for k in GT if int(k.split('-')[0][1:]) >= A.start], key=lambda k: int(k.split('-')[0][1:]))
JA = {k for k in NEW if any('일본어' in (c.get('note') or '') for row in GT[k] for c in row)}
VARS = A.variants.split(',')
S = {}
for v in VARS:
    for r in NEW:
        f = f'{W}/results/{r}__{v}.json'
        if os.path.exists(f):
            d = json.load(open(f)); s = score_receipt(GT[r], d['result']); s['ms'] = d['result']['metrics']['totalMs']; S[(v, r)] = s
def line(v, recs):
    xs = [S[(v, r)] for r in recs if (v, r) in S]
    if len(xs) < len(recs): return f'  {v:22} (미완료 {len(xs)}/{len(recs)})'
    g = lambda k: sum(x[k] for x in xs)
    cer = 100 * g('item_err_chars') / max(1, g('item_chars'))
    return (f"  {v:22} 숫자 {g('num_hit'):3}/{g('num_total')}  줄 {g('pair_ok'):2}/{g('pair_total')}  "
            f"품목 오류글자 {g('item_err_chars'):3}/{g('item_chars')} ({cer:4.1f}%)  날짜 {g('date_ok')}/{g('date_total')}  "
            f"평균 {sum(x['ms'] for x in xs)/len(xs)/1000:4.1f}s")
KO = [r for r in NEW if r not in JA]; JP = [r for r in NEW if r in JA]
for label, recs in ((f'한국어 {len(KO)}장', KO), (f'일본어 {len(JP)}장', JP), (f'전체 {len(NEW)}장', NEW)):
    if not recs: continue
    print(f'[{label}]')
    for v in VARS: print(line(v, recs))
print('\n[영수증별]  숫자 / 줄 / 품목 오류글자')
for r in NEW:
    print(f'  {r:18}', ' | '.join(f"{v[:12]:12} {S[(v,r)]['num_hit']:2}/{S[(v,r)]['num_total']:2} {S[(v,r)]['pair_ok']:2}/{S[(v,r)]['pair_total']:2} {S[(v,r)]['item_err_chars']:3}" for v in VARS if (v, r) in S))
