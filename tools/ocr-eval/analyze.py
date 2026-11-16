"""그리드 결과 채점·선택·교차검증.

사용: python3 analyze.py <data폴더> [정답지 파일]
  정답지 파일을 주면 그것으로 채점하고 결과 파일 이름 뒤에 정답지 이름을 붙인다
  (예: groundtruth-sensitivity.json → results-all-sensitivity.csv). 기본은 <data>/groundtruth.json.
"""
import sys, os, json, glob, csv, statistics, itertools
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); W = sys.argv[1]
from scoring import score_receipt, load_gt
GT_FILE = sys.argv[2] if len(sys.argv) > 2 else f'{W}/groundtruth.json'
SUF = '' if len(sys.argv) <= 2 else '-' + os.path.basename(GT_FILE)[:-5].replace('groundtruth-', '')
GT = load_gt(GT_FILE); R = list(GT)
S = {}   # (variant, receipt) -> score
for f in glob.glob(f'{W}/results/*.json'):
    rec, var = os.path.basename(f)[:-5].split('__')
    if rec not in GT: continue   # 정답지에 없는 영수증(다른 차수) 결과는 건너뛴다
    d = json.load(open(f, encoding='utf-8'))
    s = score_receipt(GT[rec], d['result']); s['ms'] = d['result']['metrics']['totalMs']; S[(var, rec)] = s
variants = sorted({v for v, _ in S})
complete = [v for v in variants if all((v, r) in S for r in R)]

def agg(v, recs):
    xs = [S[(v, r)] for r in recs]
    return dict(num=sum(x['num_hit'] for x in xs), num_n=sum(x['num_total'] for x in xs),
                pair=sum(x['pair_ok'] for x in xs), pair_n=sum(x['pair_total'] for x in xs),
                err=sum(x['item_err_chars'] for x in xs), chars=sum(x['item_chars'] for x in xs),
                exact=sum(x['item_exact'] for x in xs), items=sum(x['item_total'] for x in xs),
                date=sum(x['date_ok'] for x in xs), date_n=sum(x['date_total'] for x in xs), ms=statistics.mean(x['ms'] for x in xs))

# ---- 잡음 기준선: rot 대비 눈에 안 보이는 변화가 만든 흔들림 (영수증별 절대 변화의 합, 최댓값)
noise = {'num': 0, 'pair': 0, 'err': 0}
noise_detail = []
for j in ('jit-shift', 'jit-scale', 'jit-jpeg'):
    if not all((j, r) in S for r in R): continue
    d = {k: sum(abs(S[(j, r)][kk] - S[('rot', r)][kk]) for r in R)
         for k, kk in (('num', 'num_hit'), ('pair', 'pair_ok'), ('err', 'item_err_chars'))}
    noise_detail.append((j, d))
    for k in noise: noise[k] = max(noise[k], d[k])

def choose(cands, recs, tol):
    A = {v: agg(v, recs) for v in cands}
    s1 = [v for v in cands if A[v]['num'] >= max(A[x]['num'] for x in cands) - tol['num']]
    s2 = [v for v in s1 if A[v]['pair'] >= max(A[x]['pair'] for x in s1) - tol['pair']]
    s3 = [v for v in s2 if A[v]['err'] <= min(A[x]['err'] for x in s2) + tol['err']]
    pick = min(s3, key=lambda v: A[v]['ms'])
    return pick, (len(s1), len(s2), len(s3))

grid = [v for v in complete if not v.startswith('jit')]
out = {'n_variants_complete': len(grid), 'noise': noise, 'noise_detail': noise_detail}
if 'rot' in complete and grid:
    pick, funnel = choose(grid, R, noise)
    out['pick'] = pick; out['funnel'] = funnel
    # 4장으로 고르고 남은 1장으로 검증
    loo = []
    for held in R:
        train = [r for r in R if r != held]
        p, _ = choose(grid, train, noise)
        loo.append((held, p, agg(p, [held]), agg('rot', [held]), agg('raw', [held])))
    out['loo'] = loo
    rows = []
    for v in grid:
        a = agg(v, R); rows.append((v, a))
    rows.sort(key=lambda x: (-x[1]['num'], -x[1]['pair'], x[1]['err'], x[1]['ms']))
    out['rows'] = rows
    with open(f'{W}/results-all{SUF}.csv', 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['조합','영수증만 자르기','흑백','톤 보정','선명화','글자 높이(px)','숫자 정확(개)','숫자 전체','숫자 정확도(%)',
                    '줄 맞춤(개)','줄 전체','품목명 오류 글자','품목명 전체 글자','품목명 CER(%)','품목명 완전일치','날짜 정확','평균 처리시간(초)'])
        for v, a in rows:
            if v in ('raw', 'rot'):
                parts = ['원본 그대로' if v == 'raw' else '기울기만', '', '', '', '', '']
            else:
                c, g, t, s_, h = v.split('_')
                parts = [v, '켬' if c[1]=='1' else '끔', '흑백' if g[1]=='1' else '컬러',
                         {'tnone':'없음','tclahe':'대비개선','tillum':'그림자 보정','tbin':'이진화'}[t],
                         '켬' if s_[1]=='1' else '끔', h[1:]]
            w.writerow(parts + [a['num'], a['num_n'], round(100*a['num']/a['num_n'],1), a['pair'], a['pair_n'],
                                a['err'], a['chars'], round(100*a['err']/a['chars'],1), a['exact'], a['date'], round(a['ms']/1000,1)])
json.dump(out, open(f'{W}/analysis{SUF}.json','w',encoding='utf-8'), ensure_ascii=False, indent=1, default=str)

def fmt(v, a):
    return (f"{v:24} 숫자 {a['num']:3}/{a['num_n']} ({100*a['num']/a['num_n']:4.1f}%)  줄 {a['pair']:2}/{a['pair_n']}  "
            f"품목CER {100*a['err']/a['chars']:4.1f}% ({a['err']}/{a['chars']})  완전일치 {a['exact']}/{a['items']}  날짜 {a['date']}/{a['date_n']}  {a['ms']/1000:4.1f}s")
print(f"정답지: {GT_FILE}\n완료된 조합: {len(grid)}")
print('잡음 기준선 (rot 대비):', noise_detail, '→ 허용오차', noise)
if 'rows' in out:
    print('\n[기준선]'); print(' ', fmt('raw (원본)', agg('raw', R))); print(' ', fmt('rot (기울기만)', agg('rot', R)))
    print('\n[상위 12개 (숫자 → 줄 → CER → 시간 순 정렬)]')
    for v, a in out['rows'][:12]: print(' ', fmt(v, a))
    print(f"\n[선택 규칙 적용] 1단계 {out['funnel'][0]}개 → 2단계 {out['funnel'][1]}개 → 3단계 {out['funnel'][2]}개 → 선택: {out['pick']}")
    print(' ', fmt(out['pick'], agg(out['pick'], R)))
    print('\n[4장으로 고르고 남은 1장에서 검증]')
    for held, p, a, b, c in out['loo']:
        print(f"  검증용 {held:18} 선택된 조합 {p:22} | 선택: 숫자 {a['num']}/{a['num_n']} 줄 {a['pair']}/{a['pair_n']} 오류글자 {a['err']}"
              f" | 기울기만: 숫자 {b['num']} 줄 {b['pair']} 오류글자 {b['err']} | 원본: 숫자 {c['num']} 줄 {c['pair']} 오류글자 {c['err']}")
