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
import { createTaxField } from '../tax-field.ts';
import { createReceiptImage } from '../receipt-image.ts';
import { createExchangeField } from '../exchange-field.ts';
import { currencyDigits, sumMoney } from '../../currency.ts';
import { CATEGORIES, amountTolerance, type Category } from '../../types.ts';
import { listTrips } from '../../storage/trips.ts';
import {
  createReceipt, getReceipt, updateReceipt, type ItemDraft,
} from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { navigate } from '../../router.ts';
import { travelPath } from '../travel-state.ts';
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

function emptyRow(category: Category = '기타'): Row {
  return { name: '', quantity: 1, unitPrice: null, amount: 0, category };
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
  const trips = await listTrips();
  const tripId = existing ? existing.tripId : params['tripId'] || null;
  const trip = trips.find(t => t.id === tripId);

  if ((editing && !existing) || (tripId && !trip)) {
    return el('div', {},
      pageHeader('영수증'),
      el('p', { class: 'empty', text: editing && !existing ? '영수증을 찾을 수 없습니다.' : '여행을 찾을 수 없습니다.' }),
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

const parsedItems = extractReceiptItems(ocrRows);
const ocrMerchant = extractReceiptMerchant(ocrRows);
const ocrDateTime = extractReceiptPurchasedAt(ocrRows);
const ocrAmounts = extractReceiptAmounts(ocrRows, parsedItems);

const merchant = fillFromOcr
  ? ocrMerchant ?? ''
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
  ? ocrDateTime ?? ''
  : localDateTimeValue(existing?.purchasedAt ?? new Date().toISOString());

const dateOnly =
  fillFromOcr && !purchasedAt
    ? extractReceiptDate(ocrRows)
    : null;

const amounts = fillFromOcr
  ? ocrAmounts
  : null;

const total = amounts
  ? amounts.total
  : existing?.status === 'pending' && existing.items.length === 0 && existing.total === 0
    ? null
    : existing?.total ?? null;

  const currency = existing?.currency ?? trip?.currency ?? (CURRENCIES.some(([code]) => code === params['currency']) ? params['currency']! : 'KRW');
  const tripField = selectField('여행', 'receiptTrip', [['', '여행 미지정'], ...trips.map(t => [t.id, t.name] as const)], tripId ?? '');
  const tripInput = tripField.querySelector<HTMLSelectElement>('select')!;
  const currentTrip = () => trips.find(t => t.id === tripInput.value);
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
    class: 'input', id: 'f-total', name: 'total', type: 'number', step: 'any', min: '0',
    value: total === null ? '' : String(total), required: true,
  });
  const currencyField = selectField('결제 통화', 'currency', CURRENCIES, currency);
  const currencyInput = currencyField.querySelector<HTMLSelectElement>('select')!;
  const taxField = createTaxField(totalInput, currencyInput, existing?.tax ?? null);
  let refreshOcr = (): void => {};
  let totalFromItems = total === null;
  let updatingTotal = false;

  function notifyTotalChange(): void {
    updatingTotal = true;
    try { totalInput.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { updatingTotal = false; }
  }

  function itemsSum(): number {
    return sumMoney(rows.map(row => row.amount), currencyInput.value);
  }

  function refreshBalance(): void {
    const sum = itemsSum();
    const currency = currencyInput.value;
    if (totalFromItems) {
      const next = rows.some(row => row.name.trim() || row.amount !== 0) ? String(sum) : '';
      if (totalInput.value !== next) {
        totalInput.value = next;
        notifyTotalChange();
      }
    }
    if (!totalInput.value || (num(totalInput.value) === 0 && !rows.some(row => row.name.trim() || row.amount > 0))) {
      balance.className = 'balance warn';
      balance.replaceChildren(
        el('span', { text: '품목 합계 ' + money(sum, currency) }),
        el('span', { class: 'balance-diff', text: '영수증 총액 확인 필요' }),
      );
      return;
    }
    const stated = num(totalInput.value);
    const diff = stated - sum;
    const ok = Math.abs(diff) <= amountTolerance(currency) + Number.EPSILON * Math.max(1, stated, sum) * 4;

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
      ...rows.map((row, idx) => {
        const amountInput = el('input', {
          class: 'input tight amt', type: 'number', step: 'any',
          value: String(row.amount), 'aria-label': '금액',
          oninput: (e: Event) => {
            row.amount = num((e.target as HTMLInputElement).value);
            refreshBalance();
          },
        });

        // 금액을 직접 고칠 때는 단가를 유지한다. 수량·단가를 바꿀 때만 다시 계산한다.
        const recalculateAmount = (): void => {
          if (row.quantity === null || row.unitPrice === null) return;
          row.amount = row.quantity * row.unitPrice;
          amountInput.value = String(row.amount);
          refreshBalance();
        };

        return el('tr', {},
          el('td', {},
            el('input', { class: 'input tight', value: row.name, placeholder: '품목명',
              oninput: (e: Event) => { row.name = (e.target as HTMLInputElement).value; refreshBalance(); } }),
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
                recalculateAmount();
              } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight amt', type: 'number', min: '0', step: 'any',
              value: row.unitPrice ?? '', placeholder: '저장 시 계산', 'aria-label': '단가',
              oninput: (e: Event) => {
                const input = e.target as HTMLInputElement;
                row.unitPrice = input.value === '' ? null : num(input.value);
                recalculateAmount();
              } }),
          ),
          el('td', { class: 'num' },
            amountInput,
          ),
          el('td', {},
            (() => {
              const sel = el('select', { class: 'input tight', 'aria-label': '분류' });
              for (const c of CATEGORIES) {
                sel.appendChild(el('option', { value: c, text: c, selected: c === row.category }));
              }
              sel.addEventListener('change', (e) => {
                row.category = (e.target as HTMLSelectElement).value as Category;
              });
              return el('div', { class: 'item-category-wrap' }, sel);
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
        );
      }),
    );
    refreshBalance();
    refreshOcr();
  }

  drawRows();
  totalInput.addEventListener('input', () => {
    if (!updatingTotal) totalFromItems = totalInput.value === '' && !totalInput.validity.badInput;
    refreshBalance();
  });
  currencyInput.addEventListener('change', refreshBalance);

  const form = el('form', { class: 'form', novalidate: 'true' },
    tripField,
    field({ label: '상호', name: 'merchant', required: true,
      value: merchant, placeholder: '예: 이치란 도톤보리점' }),
    el('div', { class: 'field-row' },
      field({ label: '결제 일시', name: 'purchasedAt', type: 'datetime-local',
        value: purchasedAt, required: true, step: '1',
        hint: dateOnly ? '사진에서 읽은 날짜 ' + dateOnly + ' · 시간을 확인해 입력하세요.' : undefined }),
      currencyField,
    ),

    el('h2', { class: 'section-title', text: '품목' }),
    el('p', { class: 'field-hint',
      text: '수량·단가를 바꾸면 금액이 다시 계산됩니다. 금액은 할인 등을 반영해 직접 고칠 수 있으며, 이때 단가는 유지됩니다. 단가를 비워 두면 저장할 때 금액÷수량으로 채웁니다.' }),
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
        rows.push(emptyRow(rows.at(-1)?.category));
        drawRows();
      } }, '+ 품목 추가'),

    el('h2', { class: 'section-title', text: '합계' }),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'f-total', text: '영수증 총액' }),
      totalInput,
      el('span', { class: 'field-hint', text: '비워 두면 품목 합계로 채워집니다. 직접 입력한 총액은 유지되며, 총액을 바꿔도 품목 금액은 바뀌지 않습니다.' }),
    ),
    taxField.element,
    amountHints.length > 0 ? el('p', { class: 'field-hint', text: amountHints.join(' · ') }) : null,
    balance,
    el('p', { class: 'field-hint',
      text: '품목 합계와 총액이 다르면 "검수 필요" 로 저장됩니다. 그대로 저장해도 됩니다.' }),

    errorSlot,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit' }, editing ? '저장' : '추가'),
      el('a', { class: 'btn',
        href: editing ? `#/receipts/${receiptId}` : `#${travelPath(tripId)}` }, '취소'),
    ),
  );

  const dateInput = form.querySelector<HTMLInputElement>('[name="purchasedAt"]')!;
  const merchantInput = form.querySelector<HTMLInputElement>('[name="merchant"]')!;
  const exchange = createExchangeField(currencyInput, dateInput, totalInput, trip?.currency ?? null, existing?.exchangeRates);
  const subtitle = el('p', { class: 'subtitle', text: trip?.name ?? '여행 미지정' });
  tripInput.addEventListener('change', () => {
    subtitle.textContent = currentTrip()?.name ?? '여행 미지정';
    exchange.setTarget(currentTrip()?.currency ?? null);
  });
  form.querySelector('.field-row')!.after(exchange.element);

  // 저장된 OCR 원문을 다시 추출한다. 결과가 없는 필드는 현재 입력을 보존한다.
  const ocrItemRows = (): Row[] => parsedItems.map(item => ({ ...item, category: inferCategory(ocrMerchant ?? '', item.name) }));
  const rowKey = (values: readonly Row[]): string => JSON.stringify(values
    .filter(row => row.name.trim() || row.amount !== 0)
    .map(row => [row.name.trim(), row.quantity, row.unitPrice, row.amount, row.category]));
  const canApply = !!(ocrMerchant || ocrDateTime || parsedItems.length || ocrAmounts.total !== null);
  const ocrMessage = el('span', { class: 'field-hint', role: 'status' });
  const ocrButton = el('button', { class: 'btn', type: 'button', 'data-action': 'apply-ocr',
    onclick: () => {
      const hasInput = !!((ocrMerchant && merchantInput.value.trim()) ||
        (parsedItems.length && rows.some(row => row.name.trim() || row.amount !== 0 || row.unitPrice !== null || row.quantity !== 1)) ||
        (ocrAmounts.total !== null && num(totalInput.value) !== 0) ||
        (ocrDateTime && dateInput.value && (existing?.merchant || existing?.items.length || existing?.total || new Date(dateInput.value).getTime() !== new Date(purchasedAt).getTime())));
      if (hasInput && !confirm('현재 입력한 상호·결제 일시·품목·총액 중 OCR로 추출된 항목을 바꿀까요? 기존 입력을 덮어쓰며, 저장을 눌러야 적용됩니다.')) return;
      if (ocrMerchant) merchantInput.value = ocrMerchant;
      if (ocrDateTime) dateInput.value = ocrDateTime;
      if (ocrAmounts.total !== null) {
        totalFromItems = false;
        totalInput.value = String(ocrAmounts.total);
      }
      if (parsedItems.length) { rows.splice(0, rows.length, ...ocrItemRows()); drawRows(); }
      notifyTotalChange();
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      refreshBalance();
      refreshOcr();
      ocrMessage.textContent = 'OCR 결과를 입력 칸에 반영했어요. 저장을 눌러야 영수증에 적용됩니다.';
    } }, 'OCR 결과 반영');
  refreshOcr = () => {
    const differs = (ocrMerchant && merchantInput.value.trim() !== ocrMerchant) ||
      (ocrDateTime && new Date(dateInput.value).getTime() !== new Date(ocrDateTime).getTime()) ||
      (parsedItems.length && rowKey(rows) !== rowKey(ocrItemRows())) ||
      (ocrAmounts.total !== null && (totalInput.value === '' || num(totalInput.value) !== ocrAmounts.total));
    ocrButton.disabled = !canApply || !differs;
    ocrMessage.textContent = !canApply ? '저장된 글자에서 자동으로 채울 항목을 찾지 못했어요. 사진과 글자를 보며 직접 입력하세요.'
      : !differs ? 'OCR 추출 결과가 입력되어 있어요.' : '저장된 OCR 결과로 입력 칸을 다시 채울 수 있어요.';
  };
  form.addEventListener('input', refreshOcr);
  form.addEventListener('change', refreshOcr);
  refreshOcr();
  if (existing?.ocr) form.prepend(el('div', { class: 'ocr-apply' }, ocrButton, ocrMessage));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errorSlot.replaceChildren();
    refreshBalance();
    const v = readForm(form);

    if (!v['merchant']) { errorSlot.replaceChildren(errorBox('상호를 입력하세요.')); return; }

    const date = new Date(v['purchasedAt'] ?? '');
    if (!Number.isFinite(date.getTime())) {
      errorSlot.replaceChildren(errorBox('결제 일시를 입력하세요.'));
      return;
    }
    if (!Number.isFinite(totalInput.valueAsNumber) || totalInput.valueAsNumber <= 0) {
      alert('영수증 총액은 0보다 큰 금액으로 입력하세요.');
      totalInput.focus();
      return;
    }
    const taxError = taxField.validate();
    if (taxError) {
      errorSlot.replaceChildren(errorBox(taxError));
      return;
    }
    const exchangeError = exchange.validate();
    if (exchangeError) { errorSlot.replaceChildren(errorBox(exchangeError)); return; }

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
        unitPrice: r.unitPrice ?? Number((r.amount / r.quantity).toFixed(currencyDigits(currencyInput.value))),
        amount: r.amount,
        category: r.category,
        lineIndex: r.lineIndex ?? i,
      });
    }

    const taxRaw = taxField.input.value;
    const draft = {
      tripId: tripInput.value || null,
      imageId: existing?.imageId ?? null,
      merchant: v['merchant'] ?? '',
      purchasedAt: date.toISOString(),
      currency: v['currency'] ?? currency,
      total: num(v['total']),
      tax: taxRaw === '' ? null : num(taxRaw),
      // 수기 입력이므로 OCR 신뢰도는 없다
      confidence: existing?.confidence ?? null,
      items,
      exchangeRates: exchange.rates(),
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
      href: editing ? `#/receipts/${receiptId}` : `#${travelPath(tripId)}` }, '← 돌아가기'),
    el('header', { class: 'page-header' }, el('h1', { text: editing ? '영수증 수정' : '영수증 추가' }), subtitle),
    existing?.imageId ? createReceiptImage(existing.imageId) : null,
    existing?.ocr && ocrRows.length > 0
      ? el('details', { class: 'ocr-raw' },
          el('summary', { text: `사진에서 읽은 글자 (${existing.ocr.lines.length}개)` }),
          el('pre', { class: 'ocr-raw-text', text: ocrRows.map((g) => g.text).join('\n') }),
        )
      : null,
    form,
  );
}
