"""앱 안에서 실제로 돌린 결과(OCR 테스트 화면 '앱 처리 사용')를 채점하고, 평가 때의 조합과 나란히 놓는다.

사용: python3 compare_app.py <data폴더> <앱결과폴더> [<앱결과폴더2> ...] [--ref raw,rot,c1_g1_tnone_s0_h32]
  앱 결과 폴더: runner.mjs 를 OCR_MODE=app 또는 app-noskip 으로 돌린 출력 (<이름>.json)
  --ref: <data>/results/ 에 있는 평가 때 조합 (전처리한 이미지를 한 번 인식한 결과)
  시간: 앱 결과는 1차 인식 + 전처리 + 2차 인식을 모두 더한 값, 평가 조합은 인식 1회 값.
"""
import sys, os, json, argparse, statistics
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from scoring import score_receipt, load_gt
ap = argparse.ArgumentParser(); ap.add_argument('data'); ap.add_argument('apps', nargs='+')
ap.add_argument('--ref', default='raw,rot,c1_g1_tnone_s0_h32'); A = ap.parse_args(); W = A.data
GT = load_gt(f'{W}/groundtruth.json')
R = sorted(GT, key=lambda k: int(k.split('-')[0][1:]))

def load(kind, name, r):
    f = f'{name}/{r}.json' if kind == 'app' else f'{W}/results/{r}__{name}.json'
    if not os.path.exists(f): return None
    d = json.load(open(f, encoding='utf-8'))
    s = score_receipt(GT[r], d['result'])
    pre = d.get('preprocess') or {}
    s['sec'] = (pre.get('ms', {}).get('total') if kind == 'app' and pre else d['result']['metrics']['totalMs']) / 1000
    s['passes'] = pre.get('passes', 1) if kind == 'app' else 1
    s['angle'] = pre.get('angle')
    return s

cols = [('ref', v) for v in A.ref.split(',') if v] + [('app', a) for a in A.apps]
S = {(k, n, r): load(k, n, r) for k, n in cols for r in R}
label = lambda k, n: n if k == 'ref' else f'앱:{os.path.basename(n.rstrip("/"))}'
print(f'{"":30} 숫자 /{sum(S[(cols[0][0], cols[0][1], r)]["num_total"] for r in R if S[(cols[0][0], cols[0][1], r)])}  줄  품목오류글자  날짜  평균시간  인식횟수')
for k, n in cols:
    xs = [S[(k, n, r)] for r in R]
    if any(x is None for x in xs):
        print(f'  {label(k, n):28} (미완료 {sum(x is not None for x in xs)}/{len(R)})'); continue
    g = lambda key: sum(x[key] for x in xs)
    print(f"  {label(k, n):28} {g('num_hit'):4}  {g('pair_ok'):3}/{g('pair_total')}  {g('item_err_chars'):4}/{g('item_chars')}"
          f"  {g('date_ok'):2}/{g('date_total')}  {statistics.mean(x['sec'] for x in xs):5.1f}s  {statistics.mean(x['passes'] for x in xs):.1f}")
print('\n[영수증별]  숫자 / 줄 / 품목오류글자 / 초')
for r in R:
    cells = []
    for k, n in cols:
        x = S[(k, n, r)]
        cells.append(f"{label(k, n)[:14]:14} " + ('-' if x is None else f"{x['num_hit']:2}/{x['num_total']:2} {x['pair_ok']:2}/{x['pair_total']:2} {x['item_err_chars']:3} {x['sec']:4.1f}s" + (f" ({x['passes']}회, {x['angle']:+.1f}°)" if k == 'app' and x['angle'] is not None else '')))
    print(f'  {r:18}', ' | '.join(cells))
