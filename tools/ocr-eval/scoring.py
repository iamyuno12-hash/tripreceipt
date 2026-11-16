"""OCR 채점기.

입력: 정답지(groundtruth.json) 와 OCR 결과(앱의 'OCR 테스트' 화면이 저장하는 JSON).
지표 4개 — 모두 정답지와 직접 비교한다. 모델이 매기는 '신뢰도'는 쓰지 않는다.

  1. 숫자 정확도 (num_recall)
     정답의 금액·수량 중 OCR 이 한 자리도 틀리지 않고 읽은 비율.
     - 쉼표·마침표·'원'은 무시하고 숫자와 부호만 비교한다. '-5,000' 을 '5,000' 으로 읽으면 오답.
     - 같은 값이 여러 번 있으면 개수까지 맞아야 한다 (정답에 1,000 이 14번이면 OCR 에도 14번).
     - 품목명 안의 숫자('2인분'의 2, '500mL'의 500)나 날짜·전화번호·바코드는 금액 후보에서 뺀다.
       단, 수량 단위가 바로 붙은 수량('14개')은 인정한다 (2차 실험에서 추가, 1차 5장 결과에는 영향 없음 — 확인함).
       글자에 붙어 있는 숫자를 세면 '2인분'의 2 가 테라 수량 2 를 대신 채워 점수가 부풀기 때문.

  2. 품목명 글자 오류율 (item_cer, 낮을수록 좋음)
     CER = (삽입 + 삭제 + 치환 최소 횟수) / 정답 글자 수. OCR 연구에서 쓰는 표준 지표다.
     - 띄어쓰기는 무시한다.
     - OCR 이 옆 칸과 붙여 읽은 경우('01*첫수확…')를 대비해, OCR 글자 중 정답과 가장 잘 맞는
       구간만 비교한다. 그 구간 '안'의 남는 글자·빠진 글자·틀린 글자는 모두 오류로 센다.
     - 한 칸이 둘로 쪼개져 읽힌 경우('합' / '계::')를 대비해, 같은 줄에서 바로 옆 상자끼리 이어 붙인 것도 후보로 본다.
     - OCR 글자 하나는 정답 하나에만 쓸 수 있다 (한 상자로 두 정답을 동시에 채우지 못함).
     - 못 찾으면 CER = 1 (전부 틀림).

  3. 줄 맞춤 (pair_rate)
     품목명(또는 바코드·라벨)과 그 줄의 '마지막 금액'이 OCR 결과에서 같은 줄에 있는가.
     파서가 '이 금액이 이 품목 것'이라고 판단할 수 있는지를 본다.
     - 같은 줄 = 두 상자의 세로 중심 차이가 글자 높이(중앙값)의 절반 미만.
     - 기준 상자는 CER 0.34 이하로 찾아진 경우만 인정. 금액 상자는 값이 정확히 같아야 한다.
     - 숫자만 있는 줄(육미안 세트 하위 메뉴의 0 1 0)은 기준이 없어 제외한다.

  4. 날짜 (date_ok): 거래일시가 띄어쓰기 빼고 한 글자도 안 틀렸는가.
"""
import json, re, statistics, unicodedata
from collections import Counter

PAIR_ANCHOR_MAX_CER = 0.34

def norm(s: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', s))

# ---------------------------------------------------------------- 숫자
PHONE_RE = re.compile(r'\(?\d{2,4}\)?\s*\d{3,4}-\d{4}')
DATE_RE  = re.compile(r'\d{4}[-./]\d{1,2}[-./]\d{1,2}(\s*\d{1,2}:\d{2}(:\d{2})?)?|\d{1,2}:\d{2}(:\d{2})?')
# 수량 단위 '개'(한국어)·'個'(일본어)가 바로 붙은 수량('14개')은 인정한다. '3개입'·'2인분' 처럼 뒤에 글자가 더 붙으면 제외.
NUM_RE   = re.compile(r'(?<![\w\-])-?\d[\d,.]*(?:(?![\w\-])|(?=[개個](?!\w)))')

def num_value(s: str) -> str:
    """'-5,000' -> '-5000', '78,800원' -> '78800'"""
    s = s.strip().rstrip('원')
    neg = s.startswith('-')
    digits = re.sub(r'[^\d]', '', s)
    return ('-' if neg else '') + digits.lstrip('0') if digits.strip('0') else ('0' if digits else '')

def standalone_numbers(text: str):
    """상자 하나에서 '혼자 서 있는' 숫자만 뽑는다.
    앞뒤가 공백·괄호·콜론·'원'·문장 끝이면 인정, 글자/하이픈에 붙어 있으면 제외.
    한글 라벨 바로 뒤에 붙은 금액('합계78,800원')은 인정한다."""
    t = unicodedata.normalize('NFC', text)
    t = DATE_RE.sub(' ', t)
    t = PHONE_RE.sub(' ', t)
    t = re.sub(r'원', ' ', t)
    t = re.sub(r'(?<=[가-힣:/])(?=-?\d)', ' ', t)      # '합계78,800' -> '합계 78,800'
    out = []
    for m in NUM_RE.finditer(t):
        raw = m.group(0).rstrip('.,')
        if re.search(r'\d-\d', raw): continue           # 전화·사업자번호
        v = num_value(raw)
        if v and len(v.lstrip('-')) <= 9:                # 바코드(13자리) 제외
            out.append((v, m.start()))
    return out

# ---------------------------------------------------------------- 편집거리
def semiglobal(gt: str, txt: str):
    """정답 gt 를 OCR 문자열 txt 의 '가장 잘 맞는 구간'에 맞춘 편집거리.
    txt 앞뒤의 남는 글자는 공짜, 구간 안의 차이는 전부 오류.  반환: (거리, 시작, 끝)"""
    n, m = len(gt), len(txt)
    INF = 10**9
    prev = [0] * (m + 1); start_prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [INF] * m; start_cur = [0] * (m + 1)
        for j in range(1, m + 1):
            c = txt[j-1]
            sub = prev[j-1] + (0 if (c == gt[i-1] and c != '\0') else 1)
            dele = prev[j] + 1
            ins = cur[j-1] + 1
            best = min(sub, dele, ins); cur[j] = best
            start_cur[j] = start_prev[j-1] if best == sub else (start_prev[j] if best == dele else start_cur[j-1])
        start_cur[0] = 0
        prev, start_prev = cur, start_cur
    j = min(range(m + 1), key=lambda k: prev[k]) if m else 0
    return prev[j], start_prev[j], j

# ---------------------------------------------------------------- 상자/후보
def boxes_of(result):
    L = result['lines']
    hs = [max(p['y'] for p in l['poly']) - min(p['y'] for p in l['poly']) for l in L] or [1]
    h = statistics.median(hs)
    bx = [{'i': i, 'text': l['text'], 'n': norm(l['text']), 'cy': l['centerY'],
           'x0': l['minX'], 'x1': l['maxX']} for i, l in enumerate(L)]
    return bx, h

def candidates(bx, h):
    """단일 상자 + 같은 줄에서 바로 오른쪽 상자 1개를 이어 붙인 것."""
    cands = [[b] for b in bx]
    for a in bx:
        right = [b for b in bx if b is not a and abs(b['cy'] - a['cy']) < 0.5 * h
                 and b['x0'] >= a['x0'] and b['x0'] - a['x1'] < 6 * h]
        if right:
            cands.append([a, min(right, key=lambda b: b['x0'])])
    return cands

def cand_text(c, used):
    chars, owners = [], []
    for b in c:
        for k, ch in enumerate(b['n']):
            chars.append('\0' if (b['i'], k) in used else ch); owners.append((b['i'], k))
    return ''.join(chars), owners

# ---------------------------------------------------------------- 채점
def score_receipt(gt_rows, result):
    bx, h = boxes_of(result)
    by_i = {b['i']: b for b in bx}
    cands = candidates(bx, h)
    used = set()

    # (1) 글자 칸: 품목명·라벨·상호·날짜·코드 — 잘 맞는 것부터 1:1 배정
    text_cells = [(ri, ci, c) for ri, row in enumerate(gt_rows) for ci, c in enumerate(row)
                  if c['k'] != 'num' and not c.get('uncertain')]
    def best_for(cell):
        g = norm(cell['t']); best = (len(g), None, None)
        for cnd in cands:
            txt, owners = cand_text(cnd, used)
            if not txt: continue
            d, s, e = semiglobal(g, txt)
            if d < best[0]: best = (d, owners[s:e], cnd)
        return best
    pending = list(text_cells); assigned = {}
    while pending:
        scored = [(best_for(c), (ri, ci, c)) for ri, ci, c in pending]
        (d, span, cnd), (ri, ci, c) = min(scored, key=lambda x: x[0][0] / max(1, len(norm(x[1][2]['t']))))
        g = norm(c['t'])
        assigned[(ri, ci)] = {'gt': c['t'], 'kind': c['k'], 'cer': min(1.0, d / len(g)),
                              'read': ''.join(by_i[o[0]]['n'][o[1]] for o in span) if span else '',
                              'box': (span[0][0] if span else None)}
        if span and d < len(g): used.update(span)
        pending.remove((ri, ci, c))

    # (2) 숫자: 혼자 선 숫자만, 개수까지
    ocr_nums = [(v, b['i']) for b in bx for v, _ in standalone_numbers(b['text'])]
    gt_nums = [num_value(c['t']) for row in gt_rows for c in row if c['k'] == 'num' and not c.get('uncertain')]
    pool = Counter(v for v, _ in ocr_nums)
    hit = Counter(); miss = []
    for v in gt_nums:
        if pool[v] > 0: pool[v] -= 1; hit[v] += 1
        else: miss.append(v)

    # (3) 줄 맞춤: 기준 상자 ↔ 그 줄 마지막 금액
    pairs = []; used_num_boxes = set()
    for ri, row in enumerate(gt_rows):
        nums = [c for c in row if c['k'] == 'num']
        anchors = [(ci, c) for ci, c in enumerate(row) if c['k'] != 'num' and not c.get('uncertain')]
        if not nums or not anchors: continue
        ci, ac = anchors[0]; a = assigned.get((ri, ci))
        want = num_value(nums[-1]['t'])
        ok = False; why = ''
        if not a or a['box'] is None or a['cer'] > PAIR_ANCHOR_MAX_CER:
            why = '기준 글자를 못 찾음'
        else:
            ay = by_i[a['box']]['cy']
            cand = [(abs(by_i[i]['cy'] - ay), i) for v, i in ocr_nums
                    if v == want and i != a['box'] and i not in used_num_boxes]
            if not cand: why = '금액을 못 읽음'
            else:
                dy, i = min(cand)
                if dy < 0.5 * h: ok = True; used_num_boxes.add(i)
                else: why = f'다른 줄에 있음 (세로 {dy/h:.1f}줄 차이)'
        pairs.append({'row': ri, 'anchor': ac['t'], 'amount': nums[-1]['t'], 'ok': ok, 'why': why})

    items = [v for v in assigned.values() if v['kind'] == 'item']
    dates = [v for v in assigned.values() if v['kind'] == 'date']
    return {
        'num_total': len(gt_nums), 'num_hit': sum(hit.values()), 'num_missed': miss,
        'item_total': len(items), 'item_err_chars': sum(round(v['cer'] * len(norm(v['gt']))) for v in items),
        'item_chars': sum(len(norm(v['gt'])) for v in items),
        'item_exact': sum(1 for v in items if v['cer'] == 0),
        'items': [{'gt': v['gt'], 'read': v['read'], 'cer': round(v['cer'], 3)} for v in items],
        'pair_total': len(pairs), 'pair_ok': sum(p['ok'] for p in pairs), 'pairs': pairs,
        'date_ok': sum(1 for v in dates if v['cer'] == 0), 'date_total': len(dates),
        'boxes': len(bx), 'text_height': h,
    }

def load_gt(path):
    g = json.load(open(path, encoding='utf-8'))
    return {k: v for k, v in g.items() if not k.startswith('_')}
