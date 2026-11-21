import { groupLinesByY, lineTolerance, toTextLines, type GroupedLine } from '../ocr/lines.ts';
import type { OcrSnapshot } from '../types.ts';

export interface ParsedReceiptItem {
  readonly name: string;
  readonly unitPrice: number | null;
  readonly quantity: number | null;
  readonly quantityInferred: boolean;
  readonly amount: number;
  readonly lineIndex: number;
}

export interface ParsedReceiptAmounts {
  readonly total: number | null;
  readonly printedTotal: number | null;
  readonly subtotal: number | null;
  readonly discount: number | null;
  readonly paidTotal: number | null;
  readonly cardPaid: number | null;
  readonly pointsUsed: number | null;
  readonly totalInferred: boolean;
}

interface PurchaseDate {
  readonly date: string;
  readonly dateTime: string | null;
}

interface ItemFields {
  readonly name: string;
  readonly unitPrice: number | null;
  readonly quantity: string | undefined;
  readonly amount: number;
}

const MONEY = /[¥₩]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:円|원)?/.source;
const MONEY_ONLY = new RegExp('^' + MONEY + '$');
const QUANTITY = /\d+(?:개|個|点|点分|통|通)?/.source;
const QUANTITY_ONLY = new RegExp('^(' + QUANTITY + ')$');

const PRICE_ROW = new RegExp(
  '^(?:(.+?)\\s+)?(' + MONEY + ')\\s+(' + QUANTITY + '|\\d+[-‐–]\\d+)\\s+(' + MONEY + ')$',
);
const PRICE_ROW_WITHOUT_QUANTITY = new RegExp('^(.+?)\\s{2,}(' + MONEY + ')\\s+(' + MONEY + ')$');
const DISCOUNT_ROW = new RegExp(
  '^(?:(.+?)\\s+)?(' + MONEY + ')\\s+(' + QUANTITY + ')\\s+[-−]?' + MONEY + '\\s+(' + MONEY + ')$',
);
const QUANTITY_AMOUNT_ROW = new RegExp('^(.+?)\\s+(' + QUANTITY + ')\\s+(' + MONEY + ')$');
const QUANTITY_AMOUNT_ONLY = new RegExp('^(' + QUANTITY + ')\\s+(' + MONEY + ')$');
const AMOUNT_ROW = new RegExp('^(.+?)\\s+(' + MONEY + ')$');
const CHARGE_ROW = new RegExp(
  '^([\\p{L}]+)[:=]?(?:\\((?:即納|즉납|税込|税抜)\\))?([-−]?' + MONEY + ')$', 'u',
);
const EMBEDDED_CARD_AMOUNT = new RegExp(
  '(?:승인번호\\s*:?\\s*\\d+\\s+(?:금액|金額)|(?:^|[\\s,])(?:승인금액|カード利用額))\\s*:?\\s*(' + MONEY + ')$',
);
const PRODUCT_CODE_ROW = /^(0\d{4,13})(?:\s+|$)(.*)$/;
const DISCOUNT_DETAIL = new RegExp('^\\**\\s*할인\\s*내역\\s*:?\\s*일반\\s*할인\\s*:?\\s*(' + MONEY + ')$');
const DAMAGED_TOTAL_ROW = new RegExp('^합[^\\d]{0,2}계[^\\d]{0,14}액[^\\d]{0,3}(' + MONEY + ')$');
const REGISTRATION = /\d{3}\s*-\s*\d{2}\s*-\s*\d{5}(?!\d)/;
const MERCHANT_LABEL = /^[\[(]?(?:매\s*장\s*명|상\s*호(?:\s*명)?|가맹점\s*명|店舗名|加盟店名|店名)(?:[\])]\s*:?\s*|\s*:\s*|\s+|$)/;
const TRANSACTION_DATE = /^(?:매출일|결제일|거래일|접수일|승인일|구매일|ご利用日|利用日|取引日|購入日|お買上日)/;
const NON_TRANSACTION_DATE = /^(?:출력일|발행일|인쇄일|유효기간|有効期限|発行日|印刷日)/;
const DATE_TIME = /(?<!\d)(\d{2}|\d{4})\s*[-./년年]\s*(\d{1,2})\s*[-./월月]\s*(\d{1,2})(?:\s*[일日])?(?:\s*\([월화수목금토일月火水木金土日](?:曜(?:日)?)?\))?(?:[ T]*(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?![\d:])/;
const FOOTER = /^(?:합계(?:금액)?|총액|총요금|수납요금|총판매수량|상품금액|공급가액|과세(?:금액|물품가액)|부가세|면세금액|할인금액|할인요금|실결제금액|최종결제금액|결제금액|카드승인액|카드승인금액|신용카드승인|승인금액|받을금액|받은금액|멤버십포인트|小計|合計(?:金額)?|総合計|税込合計|決済金額|お支払(?:い)?(?:金額)?|お預(?:かり|り)?|お釣り?|消費税|売上票)(?=[:(¥₩\d]|$)/;

type Layout = 'price' | 'discount' | 'amount';

function clean(text: string): string {
  return text.normalize('NFKC').trim()
    .replace(/(\d)\s*,\s*(?=\d{3}(?!\d))/g, '$1,')
    .replace(/([¥₩])\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+(?=円|원|개(?:\s|$)|個(?:\s|$)|点(?:\s|$))/g, '$1');
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function readMoney(value: string | undefined): number | null {
  if (value === undefined || !MONEY_ONLY.test(value)) return null;
  const amount = Number(value.replace(/[,¥₩円원]/g, ''));
  return Number.isSafeInteger(amount) ? amount : null;
}

function findLayout(text: string): Layout | null {
  const label = compact(text);
  const hasName = /상품명|제품명|품목명|품명|메뉴명|商品名|品名|品目/.test(label);
  const hasPrice = /단가|単価/.test(label);
  const hasQuantity = /수량|数量|個数/.test(label);
  if (!hasName || !(hasPrice || hasQuantity) || !/금액|金額|가격/.test(label)) return null;
  if (/할인|値引/.test(label)) return 'discount';
  return hasPrice ? 'price' : 'amount';
}

function isFooter(text: string): boolean {
  const label = compact(text).replace(/^[*[(]+/, '');
  return FOOTER.test(label) || label.startsWith('할인내역') || DAMAGED_TOTAL_ROW.test(label);
}

function isCardHeading(text: string): boolean {
  return /신용카드승인|카드결제내역|(?:NFC|Credit)?Payment売上票|カード売上票/i.test(compact(text));
}

function itemName(text: string): string | null {
  const name = text.replace(/^\d{2,14}\s+(?=\D)/, '').trim();
  if (!/\p{L}/u.test(name) || isFooter(name) || isCardHeading(name) || findLayout(name)) return null;
  if (/^(?:금액|金額|할인|받을|받은|전화|사업자|승인|접수|출력|발송인|배달조회|등록번호|加盟店|決済|領収書|TEL|HTTPS?[:/]|WWW\.)/i.test(name)) return null;
  if (/^(?:가입|고객|회원|주문|전표|단말기|카드|가맹점|영수증)번호/.test(compact(name))) return null;
  if (DATE_TIME.test(name) || REGISTRATION.test(name) || /^\d{2,4}\s*-\s*\d{3,4}\s*-\s*\d{4}/.test(name)) return null;
  if (/^(?:\d[\d,.]*\s*)+(?:[¥₩円원개個点통通]\s*)*$/.test(name)) return null;
  return name;
}

function priceFields(match: RegExpExecArray | null): ItemFields | null {
  if (!match) return null;
  const [, name = '', unitPriceText, quantity, amountText] = match;
  const unitPrice = readMoney(unitPriceText);
  const amount = readMoney(amountText);
  if (unitPrice === null || amount === null) return null;
  return { name, unitPrice, quantity, amount };
}

function amountFields(match: RegExpExecArray | null): ItemFields | null {
  if (!match) return null;
  const amount = readMoney(match.at(-1));
  if (amount === null) return null;
  return { name: match[1] ?? '', unitPrice: null,
    quantity: match.length === 4 ? match[2] : undefined, amount };
}

function readItemFields(text: string, layout: Layout | null): ItemFields | null {
  if (layout === 'discount') {
    return priceFields(DISCOUNT_ROW.exec(text)) ??
      priceFields(PRICE_ROW.exec(text)) ??
      amountFields(QUANTITY_AMOUNT_ROW.exec(text));
  }
  if (layout === 'amount') {
    return amountFields(QUANTITY_AMOUNT_ROW.exec(text)) ?? amountFields(AMOUNT_ROW.exec(text));
  }

  const priced = priceFields(PRICE_ROW.exec(text));
  if (priced) return priced;
  if (layout === 'price') {
    const match = PRICE_ROW_WITHOUT_QUANTITY.exec(text);
    if (match) {
      const unitPrice = readMoney(match[2]);
      const amount = readMoney(match[3]);
      if (unitPrice !== null && amount !== null) {
        return { name: match[1] ?? '', unitPrice, quantity: undefined, amount };
      }
    }
  }

  // 헤더 없이 단가·수량이 생략된 행은 인쇄된 통화 표기가 있을 때만 후보로 삼는다.
  const match = AMOUNT_ROW.exec(text);
  return /[¥₩円원]/.test(match?.[2] ?? '') ? amountFields(match) : null;
}

function collectCharges(rows: readonly GroupedLine[]) {
  const values = new Map<string, Set<number>>();
  let inCardSection = false;

  function add(label: string, amount: number): void {
    const amounts = values.get(label) ?? new Set<number>();
    amounts.add(amount);
    values.set(label, amounts);
  }

  for (const [index, row] of rows.entries()) {
    const normalized = clean(row.text);
    const text = compact(normalized).replace(/^\[([\p{L}]+)\]/u, '$1:');
    if (isCardHeading(text)) inCardSection = true;
    const detailDiscount = readMoney(DISCOUNT_DETAIL.exec(normalized)?.[1]);
    if (detailDiscount !== null) add('일반할인내역', detailDiscount);

    const nextAmount = readMoney(compact(clean(rows[index + 1]?.text ?? '')));
    const splitLabel = nextAmount !== null && /^[\p{L}]+:?$/u.test(text);
    const [, label, value] = CHARGE_ROW.exec(splitLabel ? text + nextAmount : text) ?? [];
    if (inCardSection) {
      const embeddedAmount = readMoney(EMBEDDED_CARD_AMOUNT.exec(normalized)?.[1]);
      if (embeddedAmount !== null) add('카드승인금액', embeddedAmount);
    }
    if (!label || !value) continue;
    if (/^[-−]/.test(value) && !/할인|포인트|値引|割引|ポイント/.test(label)) continue;
    const amount = readMoney(value.replace(/^[-−]/, ''));
    if (amount === null) continue;

    const key = inCardSection && /^(?:금액|金額|승인금액|カード利用額)$/.test(label)
      ? '카드승인금액' : label;
    add(key, amount);
  }

  return (...labels: string[]): number | null => {
    for (const label of labels) {
      const amounts = values.get(label);
      if (amounts?.size === 1) return amounts.values().next().value ?? null;
      if (amounts && amounts.size > 1) return null;
    }
    return null;
  };
}

function printedCharge(read: ReturnType<typeof collectCharges>): number | null {
  return read('합계금액', '총액', '합계', '결제금액', '받을금액',
    '合計金額', '税込合計', '総合計', '合計', '決済金額');
}

function discountCharge(read: ReturnType<typeof collectCharges>): number | null {
  return read('할인금액', '할인요금', '値引額', '割引額', '値引', '일반할인내역');
}

function recoverPrintedCharge(
  rows: readonly GroupedLine[],
  sum: number,
  discount: number | null,
): number | null {
  if (discount === null || discount <= 0 || sum <= 0) return null;

  const candidates = new Set<number>();
  for (const row of rows) {
    const amount = readMoney(DAMAGED_TOTAL_ROW.exec(compact(clean(row.text)))?.[1]);
    if (amount !== null) candidates.add(amount);
  }
  return candidates.size === 1 && candidates.has(sum + discount) ? sum + discount : null;
}

function recoverCodeItems(
  rows: readonly GroupedLine[],
  texts: readonly string[],
  headerIndex: number,
): ParsedReceiptItem[] | null {
  const codes: { index: number; payload: string }[] = [];
  for (let index = headerIndex + 1; index < texts.length; index++) {
    const text = texts[index] ?? '';
    if (isFooter(text) || isCardHeading(text)) break;
    const match = PRODUCT_CODE_ROW.exec(text);
    if (match) codes.push({ index, payload: match[2] ?? '' });
  }
  if (codes.length < 2 || codes.every(({ payload }) => PRICE_ROW.test(payload))) return null;

  const titles = new Map<number, string>();
  const candidates: { item: ParsedReceiptItem; reconstructed: boolean }[] = [];
  for (const [offset, { index, payload }] of codes.entries()) {
    if (index <= headerIndex + 1) continue;
    const nameIndex = index - 1;
    const name = itemName(titles.get(nameIndex) ?? texts[nameIndex] ?? '');
    if (!name) continue;

    let fields = priceFields(PRICE_ROW.exec(payload));
    let reconstructed = titles.has(nameIndex);
    if (!fields) {
      const next = texts[index + 1] ?? '';
      if (payload === '') {
        const nextFields = priceFields(PRICE_ROW.exec(next));
        if (nextFields?.name === '') fields = nextFields;
      } else {
        const unitPrice = readMoney(payload);
        const direct = QUANTITY_AMOUNT_ONLY.exec(next);
        // 다음 품목명 줄에 붙은 숫자는 바로 아래에 다음 상품코드가 있을 때만 연결한다.
        const attached = codes[offset + 1]?.index === index + 2
          ? QUANTITY_AMOUNT_ROW.exec(next) : null;
        const nextTitle = attached?.[1] ? itemName(attached[1]) : null;
        const quantity = direct?.[1] ?? (nextTitle ? attached?.[2] : undefined);
        const amount = readMoney(direct?.[2] ?? (nextTitle ? attached?.[3] : undefined));
        if (unitPrice !== null && quantity && amount !== null) {
          fields = { name: '', unitPrice, quantity, amount };
          if (nextTitle) titles.set(index + 1, nextTitle);
        }
      }
      reconstructed = true;
    }
    if (!fields || fields.name !== '' || fields.unitPrice === null) continue;
    const quantity = Number.parseInt(fields.quantity ?? '', 10);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !QUANTITY_ONLY.test(fields.quantity ?? '') || fields.amount > quantity * fields.unitPrice) continue;
    candidates.push({
      reconstructed,
      item: { name, unitPrice: fields.unitPrice, quantity, amount: fields.amount,
        quantityInferred: false, lineIndex: nameIndex },
    });
  }

  const items = candidates.map(({ item }) => item);
  const sum = items.reduce((value, item) => value + item.amount, 0);
  const read = collectCharges(rows);
  const printed = printedCharge(read);
  const discount = discountCharge(read);
  const corroborated = items.length === codes.length && sum > 0 && (
    printed === sum ||
    (printed !== null && discount !== null && printed - discount === sum) ||
    (printed === null && recoverPrintedCharge(rows, sum, discount) !== null)
  );
  return corroborated ? items : candidates.filter((entry) => !entry.reconstructed).map(({ item }) => item);
}

function extractSingleEmsItem(rows: readonly GroupedLine[]): ParsedReceiptItem[] {
  const amount = collectCharges(rows)('수납요금');
  const lineIndex = rows.findIndex((row) => /\d.*EMS$/i.test(clean(row.text)));
  if (amount === null || lineIndex === -1) return [];

  const summary = rows.slice(lineIndex + 1).map((row) => compact(clean(row.text)))
    .find((text) => /^합계:?1통:?/.test(text));
  const unitPrice = readMoney(summary?.replace(/^합계:?1통:?/, ''));
  if (unitPrice === null || amount > unitPrice) return [];
  return [{ name: 'EMS 국제우편', unitPrice, quantity: 1, amount, quantityInferred: false, lineIndex }];
}

export function groupReceiptLines(ocr: OcrSnapshot): GroupedLine[] {
  const lines = toTextLines(ocr.lines);
  return groupLinesByY(lines, lineTolerance(lines));
}

export function extractReceiptItems(rows: readonly GroupedLine[]): ParsedReceiptItem[] {
  const texts = rows.map((row) => clean(row.text));
  const headerIndex = texts.findIndex((text) => findLayout(text) !== null);
  const layout = findLayout(texts[headerIndex] ?? '');
  if (layout === 'price') {
    const codeItems = recoverCodeItems(rows, texts, headerIndex);
    if (codeItems !== null) return codeItems;
  }
  const items: ParsedReceiptItem[] = [];

  for (let index = headerIndex + 1; index < texts.length; index++) {
    const text = texts[index] ?? '';
    if (isFooter(text) || isCardHeading(text)) break;

    const fields = readItemFields(text, layout);
    if (!fields) continue;
    const usesPrevious = fields.name === '' || /^\d{4,14}$/.test(fields.name);
    const previous = index > headerIndex + 1 ? texts[index - 1] ?? '' : '';
    if (usesPrevious && (!previous || readItemFields(previous, layout))) continue;

    const name = itemName(usesPrevious ? previous : fields.name);
    if (name === null) continue;
    const parsedQuantity = QUANTITY_ONLY.test(fields.quantity ?? '')
      ? Number.parseInt(fields.quantity ?? '', 10) : NaN;
    const knownQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
    const inferred = fields.unitPrice && fields.unitPrice > 0 ? fields.amount / fields.unitPrice : NaN;
    const quantityInferred = !knownQuantity && Number.isSafeInteger(inferred) && inferred > 0;
    const quantity = knownQuantity ? parsedQuantity : quantityInferred ? inferred : null;

    items.push({ name, unitPrice: fields.unitPrice, quantity, quantityInferred,
      amount: fields.amount, lineIndex: usesPrevious ? index - 1 : index });
  }

  return items.length > 0 ? items : extractSingleEmsItem(rows);
}

export function extractReceiptAmounts(
  rows: readonly GroupedLine[],
  items = extractReceiptItems(rows),
): ParsedReceiptAmounts {
  const read = collectCharges(rows);
  const paidTotal = read('수납요금', '실결제금액', '최종결제금액', '差引合計', 'お支払金額', 'お支払い金額');
  const subtotal = read('소계', '상품금액', '총요금', '小計');
  const discount = discountCharge(read);
  const cardPaid = read('카드승인금액', '카드승인액', 'カード利用額');
  const pointsUsed = read('멤버십포인트', '포인트사용', 'ポイント利用', '利用ポイント');

  const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const printedTotal = printedCharge(read) ??
    (paidTotal === null ? recoverPrintedCharge(rows, itemsTotal, discount) : null);
  const totalInferred = paidTotal === null && printedTotal !== null && discount !== null &&
    discount > 0 && items.length > 0 && itemsTotal > 0 && printedTotal - discount === itemsTotal;

  return { total: paidTotal ?? (totalInferred ? itemsTotal : printedTotal),
    printedTotal, subtotal, discount, paidTotal, cardPaid, pointsUsed, totalInferred };
}

export function extractReceiptTotal(rows: readonly GroupedLine[]): number | null {
  return extractReceiptAmounts(rows).total;
}

function headingRows(rows: readonly GroupedLine[]): string[] {
  const texts = rows.map((row) => clean(row.text));
  const headerIndex = texts.findIndex((text) => findLayout(text) !== null);
  return texts.slice(0, headerIndex === -1 ? 16 : headerIndex);
}

function merchantName(text: string): string | null {
  const name = itemName(text);
  if (!name || /^(?:\[|영\s*수\s*증|현금영수증|領収書|レシート|주소|住所|대표자|登録番号|\(재출력\))/.test(name)) return null;
  return name;
}

export function extractReceiptMerchant(rows: readonly GroupedLine[]): string | null {
  const heading = headingRows(rows);
  for (const [index, text] of heading.entries()) {
    const label = MERCHANT_LABEL.exec(text)?.[0];
    const registration = REGISTRATION.exec(text);
    if (label) {
      const value = text.slice(label.length).trim();
      const end = REGISTRATION.exec(value)?.index ?? value.length;
      const name = merchantName(value.slice(0, end).replace(/[/|]\s*$/, '') || heading[index + 1] || '');
      if (name) return name;
    }
    if (registration && /^[\[(]?(?:사업자(?:\s*등록)?(?:\s*번호)?[\])]?[\s:]*)?\d{3}/.test(text)) {
      const name = merchantName(heading[index - 1] ?? '');
      if (name) return name;
    }
    if (registration && /[/|]\s*$/.test(text.slice(0, registration.index))) {
      const name = merchantName(text.slice(0, registration.index).replace(/[/|]\s*$/, ''));
      if (name) return name;
    }
  }

  for (const [index, text] of heading.entries()) {
    if (/^<?(?:https?:\/\/)?(?:www\.)/i.test(text)) {
      const name = merchantName(heading[index - 1] ?? '');
      if (name) return name;
    }
    if (compact(text) === '領収書' || compact(text) === 'レシート') {
      const name = merchantName(heading[index + 1] ?? '');
      if (name) return name;
    }
  }

  const shopNames = heading.filter((text) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}].*店$/u.test(text),
  ).map(merchantName).filter((name) => name !== null);
  return shopNames.length === 1 ? shopNames[0] ?? null : null;
}

function readPurchaseDate(rows: readonly GroupedLine[]): PurchaseDate | null {
  let best: PurchaseDate | null = null;
  let bestRank = 0;

  // 승인 일자가 결제 정보 아래에 인쇄되는 영수증도 있어 전체 줄을 확인한다.
  for (const row of rows) {
    const text = clean(row.text);
    const label = compact(text).replace(/^[\[(]/, '');
    if (NON_TRANSACTION_DATE.test(label)) continue;
    const isTransactionDate = TRANSACTION_DATE.test(label);
    const shortNumeric = isTransactionDate ? /(?:[:\s]|\])(\d{4})(\d{2})(\d{2})(?!\d)/.exec(text) : null;
    const [, yearText, month, day, hour, minute, second = '00'] = DATE_TIME.exec(text) ?? shortNumeric ?? [];
    if (!yearText || !month || !day || (yearText.length === 2 && !isTransactionDate)) continue;

    const year = yearText.length === 2 ? '20' + yearText : yearText;
    const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    const dateTime = hour && minute ? date + 'T' + hour.padStart(2, '0') + ':' + minute + ':' + second : null;
    const check = new Date((dateTime ?? date + 'T00:00:00') + 'Z');
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 19) !== (dateTime ?? date + 'T00:00:00')) continue;

    const rank = (isTransactionDate ? 2 : 0) + (dateTime ? 2 : 1);
    if (rank > bestRank) {
      best = { date, dateTime };
      bestRank = rank;
    }
  }

  return best;
}

export function extractReceiptDate(rows: readonly GroupedLine[]): string | null {
  return readPurchaseDate(rows)?.date ?? null;
}

/** 브라우저 datetime-local에 표시할 시각. 날짜만 읽힌 경우에는 시각을 만들지 않는다. */
export function extractReceiptPurchasedAt(rows: readonly GroupedLine[]): string | null {
  return readPurchaseDate(rows)?.dateTime ?? null;
}
