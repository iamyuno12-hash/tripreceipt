"""채점기 자체가 의도대로 동작하는지 확인하는 테스트."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring import semiglobal, standalone_numbers, num_value, score_receipt

def check(name, got, want):
    ok = got == want
    print(f"  {'통과' if ok else '실패'}  {name}:  결과={got!r}" + ('' if ok else f'  기대={want!r}'))
    return ok

def box(text, x, y, w=100, h=30):
    return {'text': text, 'centerY': y, 'minX': x, 'maxX': x + w,
            'poly': [{'x': x, 'y': y - h/2}, {'x': x + w, 'y': y - h/2}, {'x': x + w, 'y': y + h/2}, {'x': x, 'y': y + h/2}]}

r = []
print('[글자 오류율]')
r.append(check('완전히 같음 → 0', semiglobal('솥밥', '솥밥')[0], 0))
r.append(check('한 글자 틀림 → 1', semiglobal('솥밥', '솔밥')[0], 1))
r.append(check('앞에 붙은 다른 칸은 오류 아님', semiglobal('첫수확조생햇귤3kg', '01*첫수확조생햇귤3kg')[0], 0))
r.append(check('구간 안에 끼어든 글자는 오류', semiglobal('꿀꽈배기', '꿀꽈X배기')[0], 1))
r.append(check('빠진 글자도 오류', semiglobal('꿀꽈배기', '꿀배기')[0], 1))
print('[숫자 뽑기]')
r.append(check("'2인분'의 2 는 금액 아님", [v for v, _ in standalone_numbers('돼지갈비 2인분')], []))
r.append(check("'500mL' 은 금액 아님", [v for v, _ in standalone_numbers('테라 500mL')], []))
r.append(check('라벨에 붙은 금액은 인정', [v for v, _ in standalone_numbers('합계78,800원')], ['78800']))
r.append(check('음수 부호 유지', [v for v, _ in standalone_numbers('S포인트회원 할인 -5,000')], ['-5000']))
r.append(check('날짜·시각은 제외', [v for v, _ in standalone_numbers('[구매]2026-11-0616:39')], []))
r.append(check('전화번호 제외', [v for v, _ in standalone_numbers('(031)888-1234')], []))
r.append(check('13자리 바코드 제외', [v for v, _ in standalone_numbers('8801043036177')], []))
r.append(check('한 상자의 여러 숫자', [v for v, _ in standalone_numbers('1,440  1  1,440')], ['1440', '1', '1440']))
r.append(check("단위가 바로 붙은 수량 '14개' 는 인정", [v for v, _ in standalone_numbers('8,000  14개  0  112,000')], ['8000', '14', '0', '112000']))
r.append(check("'3개입' 처럼 뒤에 글자가 더 붙으면 제외", [v for v, _ in standalone_numbers('치약걸이(3개입)')], []))
r.append(check('괄호 금액 (4,000)', [v for v, _ in standalone_numbers('1  (4,000)')], ['1', '4000']))
r.append(check('엔화 기호 ¥', [v for v, _ in standalone_numbers('¥2,846')], ['2846']))
r.append(check("1,000 과 11,000 은 다름", num_value('11,000') == num_value('1,000'), False))
print('[통합: 정답 2줄짜리 가짜 영수증]')
gt = [[{'t': '테라 500mL', 'k': 'item'}, {'t': '4,900', 'k': 'num'}, {'t': '2', 'k': 'num'}, {'t': '9,800', 'k': 'num'}],
      [{'t': '합계', 'k': 'label'}, {'t': '78,800', 'k': 'num'}]]
res = {'lines': [box('테라 500mL', 0, 100), box('4,900', 300, 100), box('9,800', 600, 100),   # 수량 2 를 못 읽음
                 box('합계', 0, 200), box('78,800원', 600, 260)]}                              # 합계 금액이 다른 줄
s = score_receipt(gt, res)
r.append(check('숫자 4개 중 3개 (수량 2 누락; 2인분의 2 같은 대체 없음)', (s['num_hit'], s['num_total']), (3, 4)))
r.append(check('품목명 완전 일치', s['item_exact'], 1))
r.append(check('줄 맞춤: 테라↔9,800 은 맞고 합계↔78,800 은 다른 줄', [p['ok'] for p in s['pairs']], [True, False]))
print(f"\n{sum(r)}/{len(r)} 통과")
sys.exit(0 if all(r) else 1)
