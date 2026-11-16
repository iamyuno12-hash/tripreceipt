"""결과 JSON 하나를 정답지로 채점하고 틀린 곳을 보여준다.
사용: python3 score_one.py <data폴더> <결과.json> <영수증 이름>
  결과.json 은 앱의 '설정 > OCR 테스트' 화면에서 '결과 JSON 저장' 으로 받은 파일."""
import sys, os, json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring import score_receipt, load_gt
data, result, name = sys.argv[1:4]
gt = load_gt(os.path.join(data, 'groundtruth.json'))[name]
s = score_receipt(gt, json.load(open(result, encoding='utf-8'))['result'])
print(f"숫자 {s['num_hit']}/{s['num_total']}  품목명 오류 글자 {s['item_err_chars']}/{s['item_chars']} "
      f"(CER {100*s['item_err_chars']/max(1,s['item_chars']):.1f}%)  줄 맞춤 {s['pair_ok']}/{s['pair_total']}  날짜 {s['date_ok']}/{s['date_total']}")
for it in s['items']:
    if it['cer'] > 0: print(f"  품목 '{it['gt']}' → '{it['read']}'")
if s['num_missed']: print('  못 읽은 숫자:', s['num_missed'])
for p in s['pairs']:
    if not p['ok']: print(f"  줄 실패: {p['anchor']} ↔ {p['amount']} ({p['why']})")
