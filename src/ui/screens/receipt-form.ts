/**
 * 영수증 수동 입력·수정 폼.
 *
 * 새로 스캔한 영수증은 OCR 결과를 채운 뒤 이 화면에서 검수한다.
 *
 * 입력하는 동안 품목 합계와 총액 차이를 실시간으로 보여 준다.
 * 교차검증이 왜 필요한지 사용자가 눈으로 바로 알 수 있게 하려는 의도다.
 */
import { el, pageHeader } from '../dom.ts';
import { field, selectField, readForm, errorBox, CURRENCIES } from '../form.ts';
import { money } from '../format.ts';
import { CATEGORIES, AMOUNT_TOLERANCE, type Category } from '../../types.ts';
import { getTrip } from '../../storage/trips.ts';
import {
  createReceipt, getReceipt, updateReceipt, deleteReceipt, type ItemDraft,
} from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { navigate } from '../../router.ts';
import {
  extractReceiptAmounts, extractReceiptDate, extractReceiptItems,
  extractReceiptMerchant, extractReceiptPurchasedAt, groupReceiptLines,
} from '../../parser/receipt-parser.ts';

interface Row {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  category: Category;
  lineIndex?: number;
  quantityInferred?: boolean;
}

function num(v: string | null | undefined): number {
  const n = Number((v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const CATEGORY_RULES: {
  category: Category;
  pattern: RegExp;
}[] = [
  {
    category: '기타',
    pattern: /우체국|우편|국제등기|ems|택배|배송비|postoffice|郵便|送料/i,
  },
  {
    category: '교통',
    pattern: /교통|버스|지하철|택시|기차|열차|철도|승차권|ktx|srt|공항철도|항공|항공권|비행기|렌터카|렌트카|주차|톨게이트|고속도로통행료|uber|grab|taxi|train|subway|railway|flight|airportexpress|電車|地下鉄|新幹線|タクシー/i,
  },
  {
    category: '숙박',
    pattern: /숙박|호텔|모텔|펜션|게스트하우스|호스텔|리조트|에어비앤비|료칸|민박|hotel|motel|hostel|guesthouse|airbnb|ryokan|resort|旅館|ホテル|宿泊/i,
  },
  {
    category: '관광',
    pattern: /관광|입장권|입장료|관람권|박물관|미술관|전망대|테마파크|놀이공원|수족관|동물원|유람선|케이블카|투어|museum|aquarium|themepark|sightseeing|admission|観光|入場券|美術館|博物館/i,
  },
  {
    category: '쇼핑',
    pattern: /쇼핑|편의점|마트|슈퍼마켓|백화점|아울렛|다이소|올리브영|드럭스토어|돈키호테|무인양품|유니클로|의류|옷|신발|가방|화장품|기념품|souvenir|shopping|supermarket|drugstore|donquijote|uniqlo|コンビニ|スーパー|百貨店|お土産/i,
  },
  {
    category: '식비',
    pattern: /식당|음식점|카페|커피|음료|라멘|라면|돈까스|돈카츠|김밥|분식|치킨|피자|햄버거|파스타|초밥|스시|덮밥|국밥|불고기|삼겹살|고기집|베이커리|빵집|디저트|아이스크림|스타벅스|맥도날드|버거킹|롯데리아|투썸|메가커피|restaurant|coffee|cafe|ramen|sushi|pizza|burger|bakery|ラーメン|寿司|レストラン|カフェ/i,
  },
];

function inferCategory(
  merchant: string,
  itemName: string,
): Category {
  const normalizedItem = itemName
    .toLowerCase()
    .replace(/\s+/g, '');

  const normalizedMerchant = merchant
    .toLowerCase()
    .replace(/\s+/g, '');

  // 1. 품목명을 먼저 검사
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(normalizedItem)) {
      return rule.category;
    }
  }

  // 2. 품목명으로 판단할 수 없으면 매장명 검사
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(normalizedMerchant)) {
      return rule.category;
    }
  }

  // 3. 알 수 없는 경우 기타로 분류
  return '기타';
}

function emptyRow(): Row {
  return { name: '', quantity: 1, unitPrice: null, amount: 0, category: '기타' };
}

function localDateTimeValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

export async function renderReceiptForm(params: Record<string, string>): Promise<HTMLElement> {
  const receiptId = params['id'];
  const editing = receiptId !== undefined;

  const existing = editing ? await getReceipt(receiptId) : undefined;
  const tripId = existing?.tripId ?? params['tripId'] ?? '';
  const trip = await getTrip(tripId);

  if (!trip) {
    return el('div', {},
      pageHeader('영수증'),
      el('p', { class: 'empty', text: '여행을 찾을 수 없습니다.' }),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

const ocrRows = existing?.ocr ? groupReceiptLines(existing.ocr) : [];

const fillFromOcr =
  existing?.status === 'pending' &&
  ocrRows.length > 0 &&
  existing.merchant.trim() === '' &&
  existing.items.length === 0 &&
  existing.total === 0;

const parsedItems = fillFromOcr
  ? extractReceiptItems(ocrRows)
  : [];

const merchant = fillFromOcr
  ? extractReceiptMerchant(ocrRows) ?? ''
  : existing?.merchant ?? '';

const rows: Row[] = existing?.items.map((item) => ({
  name: item.name,
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  amount: item.amount,
  category: item.category,
  lineIndex: item.lineIndex,
})) ?? [];

if (fillFromOcr) {
  rows.push(
    ...parsedItems.map((item): Row => ({
      ...item,
      category: inferCategory(merchant, item.name),
    }))
  );
}

if (rows.length === 0) rows.push(emptyRow());

const purchasedAt = fillFromOcr
  ? extractReceiptPurchasedAt(ocrRows) ?? ''
  : localDateTimeValue(existing?.purchasedAt ?? new Date().toISOString());

const dateOnly =
  fillFromOcr && !purchasedAt
    ? extractReceiptDate(ocrRows)
    : null;

const amounts = fillFromOcr
  ? extractReceiptAmounts(ocrRows, parsedItems)
  : null;

const total = amounts
  ? amounts.total
  : existing?.total ?? 0;

  const currency = existing?.currency ?? trip.currency;
  const amountHints: string[] = [];
  if (amounts?.totalInferred) {
    amountHints.push('인쇄된 합계에서 할인을 뺀 금액을 채웠어요. 결제금액을 확인하세요.');
  }
  if (amounts?.pointsUsed != null) {
    amountHints.push('사용한 포인트 ' + money(amounts.pointsUsed, currency));
  }
  if (amounts?.cardPaid != null && amounts.cardPaid !== total) {
    amountHints.push('카드 승인액 ' + money(amounts.cardPaid, currency));
  }
  const itemsBody = el('tbody', {});
  const balance = el('div', { class: 'balance' });
  const errorSlot = el('div', {});

  const totalInput = el('input', {
    class: 'input', id: 'f-total', name: 'total', type: 'number', step: '1', min: '0',
    value: total === null ? '' : String(total), required: true,
  });

  function itemsSum(): number {
    return rows.reduce((s, r) => s + r.amount, 0);
  }

  function refreshBalance(): void {
    const sum = itemsSum();
    if (!totalInput.value) {
      balance.className = 'balance warn';
      balance.replaceChildren(
        el('span', { text: '품목 합계 ' + money(sum, currency) }),
        el('span', { class: 'balance-diff', text: '영수증 총액 확인 필요' }),
      );
      return;
    }
    const stated = num(totalInput.value);
    const diff = stated - sum;
    const ok = Math.abs(diff) <= AMOUNT_TOLERANCE;

    balance.className = ok ? 'balance ok' : 'balance warn';
    balance.replaceChildren(
      el('span', { text: `품목 합계 ${money(sum, currency)}` }),
      el('span', { text: `영수증 총액 ${money(stated, currency)}` }),
      el('span', { class: 'balance-diff',
        text: ok ? '일치' : `차이 ${money(Math.abs(diff), currency)}` }),
    );
  }

  function drawRows(): void {
    itemsBody.replaceChildren(
      ...rows.map((row, idx) =>
        el('tr', {},
          el('td', {},
            el('input', { class: 'input tight', value: row.name, placeholder: '품목명',
              oninput: (e: Event) => { row.name = (e.target as HTMLInputElement).value; } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight qty', type: 'number', min: '1',
              value: row.quantity ?? '',
              placeholder: row.quantity === null ? '확인' : '',
              title: row.quantityInferred ? '금액을 단가로 나누어 계산한 수량입니다.' : '수량',
              'aria-label': '수량',
              oninput: (e: Event) => {
                const input = e.target as HTMLInputElement;
                const quantity = input.valueAsNumber;
                row.quantity = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
                row.quantityInferred = false;
                input.title = '수량';
              } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight amt', type: 'number', min: '0', step: '1',
              value: row.unitPrice ?? '', placeholder: '자동 계산', 'aria-label': '단가',
              oninput: (e: Event) => {
                const input = e.target as HTMLInputElement;
                row.unitPrice = input.value === '' ? null : num(input.value);
              } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight amt', type: 'number', step: '1',
              value: String(row.amount),
              oninput: (e: Event) => {
                row.amount = num((e.target as HTMLInputElement).value);
                refreshBalance();
              } }),
          ),
          el('td', {},
            (() => {
              const sel = el('select', { class: 'input tight' });
              for (const c of CATEGORIES) {
                sel.appendChild(el('option', { value: c, text: c, selected: c === row.category }));
              }
              sel.addEventListener('change', (e) => {
                row.category = (e.target as HTMLSelectElement).value as Category;
              });
              return sel;
            })(),
          ),
          el('td', { class: 'num' },
            el('button', { class: 'btn tiny', type: 'button', title: '이 품목 삭제',
              onclick: () => {
                rows.splice(idx, 1);
                if (rows.length === 0) rows.push(emptyRow());
                drawRows();
                refreshBalance();
              } }, '삭제'),
          ),
        ),
      ),
    );
  }

  drawRows();
  refreshBalance();
  totalInput.addEventListener('input', refreshBalance);

  const form = el('form', { class: 'form', novalidate: 'true' },
    field({ label: '상호', name: 'merchant', required: true,
      value: merchant, placeholder: '예: 이치란 도톤보리점' }),
    el('div', { class: 'field-row' },
      field({ label: '결제 일시', name: 'purchasedAt', type: 'datetime-local',
        value: purchasedAt, required: true, step: '1',
        hint: dateOnly ? '사진에서 읽은 날짜 ' + dateOnly + ' · 시간을 확인해 입력하세요.' : undefined }),
      selectField('통화', 'currency', CURRENCIES, currency),
    ),

    el('h2', { class: 'section-title', text: '품목' }),
    fillFromOcr && parsedItems.some((item) => item.quantityInferred)
      ? el('p', { class: 'field-hint', text: '계산한 수량을 영수증과 대조하세요. ' +
          parsedItems.filter((item) => item.quantityInferred).map((item) => item.name).join(', ') })
      : null,
    el('div', { class: 'table-wrap' },
      el('table', { class: 'items' },
        el('thead', {},
          el('tr', {},
            el('th', { text: '품목' }),
            el('th', { class: 'num', text: '수량' }),
            el('th', { class: 'num', text: '단가' }),
            el('th', { class: 'num', text: '금액' }),
            el('th', { text: '분류' }),
            el('th', { class: 'num', text: '' }),
          ),
        ),
        itemsBody,
      ),
    ),
    el('button', { class: 'btn', type: 'button',
      onclick: () => {
        rows.push(emptyRow());
        drawRows();
      } }, '+ 품목 추가'),

    el('h2', { class: 'section-title', text: '합계' }),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', { class: 'field-label', for: 'f-total', text: '영수증 총액' }),
        totalInput,
        el('span', { class: 'field-hint', text: '영수증에 찍힌 금액을 그대로 입력하세요.' }),
      ),
      field({ label: '부가세 (선택)', name: 'tax', type: 'number', step: '1',
        value: existing?.tax ?? '' }),
    ),
    amountHints.length > 0 ? el('p', { class: 'field-hint', text: amountHints.join(' · ') }) : null,
    balance,
    el('p', { class: 'field-hint',
      text: '품목 합계와 총액이 다르면 "검수 필요" 로 저장됩니다. 그대로 저장해도 됩니다.' }),

    errorSlot,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit' }, editing ? '저장' : '추가'),
      el('a', { class: 'btn',
        href: editing ? `#/receipts/${receiptId}` : `#/trips/${trip.id}` }, '취소'),
    ),
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errorSlot.replaceChildren();
    const v = readForm(form);

    if (!v['merchant']) { errorSlot.replaceChildren(errorBox('상호를 입력하세요.')); return; }

    const date = new Date(v['purchasedAt'] ?? '');
    if (!Number.isFinite(date.getTime())) {
      errorSlot.replaceChildren(errorBox('결제 일시를 입력하세요.'));
      return;
    }
    if (!v['total']) {
      errorSlot.replaceChildren(errorBox('영수증 총액을 입력하세요.'));
      return;
    }

    const items: ItemDraft[] = [];
    for (const [i, r] of rows.entries()) {
      if (r.name.trim() === '' && r.amount === 0) continue;
      if (r.quantity === null) {
        errorSlot.replaceChildren(errorBox(`${i + 1}번째 품목의 수량을 입력하세요.`));
        return;
      }
      items.push({
        name: r.name.trim() || '(이름 없음)',
        quantity: r.quantity,
        unitPrice: r.unitPrice ?? Math.round(r.amount / r.quantity),
        amount: r.amount,
        category: r.category,
        lineIndex: r.lineIndex ?? i,
      });
    }

    const taxRaw = v['tax'] ?? '';
    const draft = {
      tripId: trip.id,
      imageId: existing?.imageId ?? null,
      merchant: v['merchant'] ?? '',
      purchasedAt: date.toISOString(),
      currency: v['currency'] ?? currency,
      total: num(v['total']),
      tax: taxRaw === '' ? null : num(taxRaw),
      // 수기 입력이므로 OCR 신뢰도는 없다
      confidence: existing?.confidence ?? null,
      items,
    };

    void (async () => {
      try {
        if (editing && receiptId !== undefined) {
          await updateReceipt(receiptId, draft);
          navigate(`/receipts/${receiptId}`);
        } else {
          const created = await createReceipt(draft);
          void ensurePersistOnce();
          navigate(`/receipts/${created.id}`);
        }
      } catch (err) {
        errorSlot.replaceChildren(
          errorBox(`저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    })();
  });

  return el('div', {},
    el('a', { class: 'back-link',
      href: editing ? `#/receipts/${receiptId}` : `#/trips/${trip.id}` }, '← 돌아가기'),
    pageHeader(editing ? '영수증 수정' : '영수증 추가', trip.name),
    existing?.ocr && ocrRows.length > 0
      ? el('details', { class: 'ocr-raw', open: existing.items.length === 0 },
          el('summary', { text: `사진에서 읽은 글자 (${existing.ocr.lines.length}개)` }),
          el('pre', { class: 'ocr-raw-text', text: ocrRows.map((g) => g.text).join('\n') }),
        )
      : null,
    form,
    editing && receiptId !== undefined
      ? el('div', { class: 'danger-zone' },
          el('button', { class: 'btn danger', type: 'button',
            onclick: () => {
              if (!confirm('이 영수증을 삭제할까요?')) return;
              void deleteReceipt(receiptId).then(() => navigate(`/trips/${trip.id}`));
            } }, '영수증 삭제'),
        )
      : null,
  );
}
