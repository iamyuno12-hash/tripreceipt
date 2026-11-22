/** 환율과 집계의 공통 규칙. 원본 영수증 금액은 바꾸지 않는다. */
import { currencyDigits, isCountable, type Category, type ExchangeRate, type Receipt, type Trip } from './types.ts';
export { currencyDigits } from './types.ts';

/** 소수 문자열을 정수 비율로 바꿔, 환산과 반올림 중 이진 부동소수 오차를 피한다. */
function decimal(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error('유효하지 않은 금액입니다.');
  const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
  const digits = (mantissa.split('.')[1] ?? '').length - Number(exponent);
  const integer = BigInt(mantissa.replace('.', ''));
  return digits >= 0 ? [integer, 10n ** BigInt(digits)] : [integer * 10n ** BigInt(-digits), 1n];
}

function roundedUnits(amount: number, rate: number, currency: string): bigint {
  const [a, ad] = decimal(amount);
  const [r, rd] = decimal(rate);
  const numerator = a * r * 10n ** BigInt(currencyDigits(currency));
  const denominator = ad * rd;
  const sign = numerator < 0n ? -1n : 1n;
  return sign * ((sign * numerator * 2n + denominator) / (denominator * 2n));
}

export function convertAmount(amount: number, rate: number, currency: string): number {
  return Number(roundedUnits(amount, rate, currency)) / 10 ** currencyDigits(currency);
}

export function sumMoney(amounts: readonly number[], currency: string): number {
  return Number(amounts.reduce((sum, amount) => sum + roundedUnits(amount, 1, currency), 0n)) /
    10 ** currencyDigits(currency);
}

/** UI에 표시하는 결제일과 동일하게 로컬 달력 날짜를 사용한다. 날짜만 있는 값은 그대로 둔다. */
export function paymentDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function validRate(rate: ExchangeRate, from: string, to: string, date: string): boolean {
  return rate.from === from && rate.to === to && rate.requestedDate === date &&
    Number.isFinite(rate.rate) && rate.rate > 0;
}

export function receiptRate(receipt: Receipt, currency: string): ExchangeRate | undefined {
  return receipt.exchangeRates?.find(rate => validRate(rate, receipt.currency, currency, paymentDate(receipt.purchasedAt)));
}

export function convertedTotal(receipt: Receipt, currency: string): number | null {
  if (receipt.currency === currency) return convertAmount(receipt.total, 1, currency);
  const rate = receiptRate(receipt, currency);
  return rate ? convertAmount(receipt.total, rate.rate, currency) : null;
}

export interface ExpenseSummary {
  readonly total: number;
  readonly pending: number;
  readonly converted: number;
  readonly byCategory: Map<Category, number>;
}

/** 모든 화면이 같은 환산 규칙을 쓴다. 검수 전 금액은 총액에만, 검수된 품목만 분류에 포함한다. */
export function summarizeExpenses(receipts: readonly Receipt[], currency: string): ExpenseSummary {
  const amounts: number[] = [];
  const categories = new Map<Category, number[]>();
  let pending = 0;
  let converted = 0;
  for (const receipt of receipts) {
    if (receipt.status === 'pending') continue;
    const amount = convertedTotal(receipt, currency);
    if (amount === null) { pending++; continue; }
    amounts.push(amount);
    if (receipt.currency !== currency) converted++;
    if (!isCountable(receipt)) continue;
    const rate = receipt.currency === currency ? 1 : receiptRate(receipt, currency)!.rate;
    for (const item of receipt.items) {
      const values = categories.get(item.category) ?? [];
      values.push(convertAmount(item.amount, rate, currency));
      categories.set(item.category, values);
    }
  }
  return {
    total: sumMoney(amounts, currency), pending, converted,
    byCategory: new Map([...categories].map(([category, values]) => [category, sumMoney(values, currency)])),
  };
}

/** 전체 추이도 각 여행의 집계 통화로 환산한 뒤 같은 기준 통화끼리 모은다. */
export function expensesByMonth(trips: readonly Trip[], receipts: readonly Receipt[], currency: string, today = new Date()): Array<{ key: string; amount: number }> {
  const months = new Map<string, number[]>();
  const eligibleTrips = new Set(trips.filter(trip => trip.currency === currency).map(trip => trip.id));
  for (let ago = 12; ago >= 0; ago--) {
    const date = new Date(today.getFullYear(), today.getMonth() - ago, 1);
    months.set(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, []);
  }
  for (const receipt of receipts) {
    if (!eligibleTrips.has(receipt.tripId) || !isCountable(receipt)) continue;
    const values = months.get(paymentDate(receipt.purchasedAt).slice(0, 7));
    const amount = convertedTotal(receipt, currency);
    if (values && amount !== null) values.push(amount);
  }
  return [...months].map(([key, values]) => ({ key, amount: sumMoney(values, currency) }));
}
