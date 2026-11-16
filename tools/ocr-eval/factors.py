"""요인별 효과·영수증별 분포. 사용: python3 factors.py <data폴더> [정답지 파일]"""
import sys, os, json, glob, statistics
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); W = sys.argv[1]
from scoring import score_receipt, load_gt
from collections import defaultdict, Counter
GT_FILE = sys.argv[2] if len(sys.argv) > 2 else f'{W}/groundtruth.json'
GT = load_gt(GT_FILE); R = list(GT)
S = {}
for f in glob.glob(f'{W}/results/*.json'):
    rec, var = os.path.basename(f)[:-5].split('__')
    if rec not in GT: continue   # 정답지에 없는 영수증(다른 차수) 결과는 건너뛴다
    d = json.load(open(f, encoding='utf-8'))
    s = score_receipt(GT[rec], d['result']); s['ms'] = d['result']['metrics']['totalMs']; S[(var, rec)] = s
grid = sorted({v for v, _ in S if v.startswith('c')})
def tot(v, k): return sum(S[(v, r)][k] for r in R)
N = {k: tot('rot', k) for k in ('num_total', 'pair_total', 'item_chars')}
print('정답지:', GT_FILE)
print('[요인별 평균 — 나머지 요인은 모든 조합에 걸쳐 평균]')
names = {0:('영수증만 자르기',{'c0':'끔','c1':'켬'}),1:('색',{'g0':'컬러','g1':'흑백'}),
         2:('톤 보정',{'tnone':'없음','tclahe':'대비개선','tillum':'그림자 보정','tbin':'이진화'}),
         3:('선명화',{'s0':'끔','s1':'켬'}),4:('글자 높이',{'h32':'32px','h48':'48px','h64':'64px'})}
for i,(title,levels) in names.items():
    print(f'  {title}')
    for lv, kr in levels.items():
        vs = [v for v in grid if v.split('_')[i] == lv]
        if i == 1: vs = [v for v in vs if 'tbin' not in v]          # 이진화는 흑백 전용이라 색 비교에서 뺌
        if not vs: continue
        m = lambda k: statistics.mean(tot(v, k) for v in vs)
        print(f"    {kr:8} ({len(vs):2}개 조합)  숫자 {m('num_hit'):5.1f}/{N['num_total']}  줄 {m('pair_ok'):4.1f}/{N['pair_total']}  품목 오류글자 {m('item_err_chars'):4.1f}/{N['item_chars']}  시간 {statistics.mean(statistics.mean(S[(v,r)]['ms'] for r in R) for v in vs)/1000:4.1f}s")
print(f'\n[영수증별 숫자 정확 개수 분포 — {len(grid)}개 조합]')
for r in R:
    c = Counter(S[(v, r)]['num_hit'] for v in grid)
    print(f"  {r:20} 정답 {S[(grid[0], r)]['num_total']:2}개 | 기울기만 {S[('rot', r)]['num_hit']:2} | 조합별: " + '  '.join(f'{k}개×{c[k]}' for k in sorted(c)))
print('\n[육미안: 세트 하위 메뉴의 0·1 (12개) 를 몇 개 읽었나]')
for v in ['raw','rot','jit-shift','jit-scale','jit-jpeg','c1_g0_tnone_s0_h32','c1_g1_tclahe_s0_h32','c0_g0_tnone_s0_h48','c0_g1_tnone_s0_h48']:
    if (v, 'r1-yukmian') not in S: continue
    s = S[(v, 'r1-yukmian')]; miss = Counter(s['num_missed'])
    small = 12 - miss['0'] - miss['1']
    print(f"  {v:22} 0·1 {small:2}/12   못 읽은 숫자 {s['num_missed']}")
