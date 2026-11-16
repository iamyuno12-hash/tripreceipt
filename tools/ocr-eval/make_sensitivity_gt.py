"""민감도 분석용 정답지 만들기.

육미안(r1) 세트 메뉴의 하위 항목 줄(단가 0 · 수량 1 · 금액 0, 4줄 × 3 = 12개 숫자)은
눈에 안 보이는 변화(2px 이동, JPEG 재압축)만으로도 2~6개 사이를 오가서 조합 비교를 흔든다.
이 줄들을 채점에서 빼고(uncertain) 결론이 그대로인지 확인하기 위한 정답지를 만든다.
사용: python3 make_sensitivity_gt.py <data폴더>   →  <data>/groundtruth-sensitivity.json
"""
import sys, json
W = sys.argv[1]
gt = json.load(open(f'{W}/groundtruth.json', encoding='utf-8'))
n = 0
for row in gt['r1-yukmian']:
    if [c['k'] for c in row] == ['num'] * 3 and [c['t'] for c in row] == ['0', '1', '0']:
        for c in row:
            c['uncertain'] = True; c['note'] = '세트 하위 메뉴 ₩0 — 결과가 불안정해 민감도 분석에서 제외'; n += 1
assert n == 12, n
json.dump(gt, open(f'{W}/groundtruth-sensitivity.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{n}개 숫자 제외 → {W}/groundtruth-sensitivity.json')
