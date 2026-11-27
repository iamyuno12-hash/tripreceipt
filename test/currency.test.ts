import test from 'node:test';
import assert from 'node:assert/strict';
import { convertAmount, convertedTotal, expensesByMonth, paymentDate, summarizeExpenses, sumMoney } from '../src/currency.ts';
import { buildExpenseCsv } from '../src/export/csv.ts';
import type { ExchangeRate, Receipt, Trip } from '../src/types.ts';
import { crossCheck, tripTotal } from '../src/types.ts';

const trip: Trip = { id: 't', name: '여행', destination: '서울', currency: 'KRW', startDate: '2026-01-01', endDate: '2026-12-31', createdAt: '' };
function receipt(currency = 'USD', total = 10): Receipt {
  return { id: 'r', tripId: 't', imageId: null, merchant: '카페', purchasedAt: '2026-11-20T12:00:00', currency,
    total, tax: null, confidence: null, status: 'parsed',
    items: [{ id: 'i', receiptId: 'r', name: '음료', quantity: 1, unitPrice: total, amount: total, category: '식비', lineIndex: 0 }] };
}
function rate(value = 1400): ExchangeRate {
  return { from: 'USD', to: 'KRW', rate: value, requestedDate: '2026-11-20', date: '2026-11-20', source: 'manual', recordedAt: '' };
}

test('서로 다른 단위는 환율 없이는 합치지 않고 환산 대기 수를 반환한다', () => {
  const summary = summarizeExpenses([receipt('KRW', 1000), receipt()], 'KRW');
  assert.equal(summary.total, 1000);
  assert.equal(summary.pending, 1);
  assert.equal(convertedTotal(receipt(), 'KRW'), null);
  assert.throws(() => tripTotal([receipt('KRW', 1000), receipt()]), /환산/);
});

test('고정된 환율로 원금액과 통화를 보존하며 총액·품목을 환산한다', () => {
  const foreign = { ...receipt(), exchangeRates: [rate()] };
  const summary = summarizeExpenses([receipt('KRW', 1000), foreign], 'KRW');
  assert.equal(summary.total, 15000);
  assert.equal(summary.byCategory.get('식비'), 15000);
  assert.equal(summary.pending, 0);
  assert.equal(foreign.total, 10);
  assert.equal(foreign.currency, 'USD');
});

test('결제일·통화·집계 통화에 맞지 않는 이전 환율은 적용하지 않는다', () => {
  const original = { ...receipt(), exchangeRates: [rate()] };
  assert.equal(convertedTotal({ ...original, purchasedAt: '2026-11-21T12:00:00' }, 'KRW'), null);
  assert.equal(convertedTotal({ ...original, currency: 'JPY' }, 'KRW'), null);
  assert.equal(convertedTotal(original, 'EUR'), null);
  assert.equal(convertedTotal({ ...original, exchangeRates: [rate(0)] }, 'KRW'), null);
});

test('통화별 반올림과 소수 합계는 이진 오차로 1센트를 잃지 않는다', () => {
  assert.equal(convertAmount(1.005, 1, 'USD'), 1.01);
  assert.equal(convertAmount(10, 1334.75, 'KRW'), 13348);
  assert.equal(convertAmount(1, 1.5, 'JPY'), 2);
  assert.equal(convertAmount(1, 1.5, 'VND'), 2);
  assert.equal(sumMoney([0.1, 0.2], 'USD'), 0.3);
});

test('달러 금액 검증은 1달러가 아닌 1센트 오차를 허용한다', () => {
  assert.equal(crossCheck({ ...receipt(), total: 10.01 }).matches, true);
  assert.equal(crossCheck({ ...receipt(), total: 10.5 }).matches, false);
});

test('검수 필요 금액은 총액에 포함하되 분류에는 넣지 않고, 내용 대기는 집계하지 않는다', () => {
  const summary = summarizeExpenses([
    { ...receipt(), exchangeRates: [rate()], status: 'needs_review' },
    { ...receipt('KRW', 100), status: 'pending' },
  ], 'KRW');
  assert.equal(summary.total, 14000);
  assert.equal(summary.byCategory.size, 0);
});

test('월별 추이는 영수증 통화가 아닌 여행의 기준 통화로 환산한다', () => {
  const rows = expensesByMonth([trip], [{ ...receipt(), exchangeRates: [rate()] }, receipt('EUR')], 'KRW', new Date(2026, 10, 23));
  assert.equal(rows.length, 13);
  assert.equal(rows.find(row => row.key === '2026-11')?.amount, 14000);
  assert.equal(paymentDate('2026-11-20'), '2026-11-20');
});

test('CSV는 원금액·환산액·환율을 구분하고 영수증 총액은 첫 품목에만 기록한다', () => {
  const r = { ...receipt(), exchangeRates: [rate()], tax: 1 };
  const csv = buildExpenseCsv([trip], [{ ...r, items: [...r.items, { ...r.items[0]!, amount: 0 }] }]);
  const rows = csv.slice(1).split('\r\n').map(line => line.match(/"(?:[^"]|"")*"/g)!.map(value => value.slice(1, -1)));
  const headers = rows[0]!;
  const cell = (row: number, key: string): string | undefined => rows[row]![headers.indexOf(key)];
  assert.equal(cell(1, '통화'), 'USD');
  assert.equal(cell(1, '영수증총액'), '10');
  assert.equal(cell(2, '영수증총액'), '');
  assert.equal(cell(1, '환산영수증총액'), '14000');
  assert.equal(cell(2, '환산영수증총액'), '');
  assert.equal(cell(1, '환산부가세'), '1400');
  assert.equal(cell(1, '적용환율'), '1400');
});

test('환산 대기 CSV는 원본을 남기고 환산값을 빈칸으로 내보낸다', () => {
  const csv = buildExpenseCsv([trip], [receipt()]);
  assert.match(csv, /"환산 대기"/);
  assert.match(csv, /"아니요","USD"/);
  assert.ok(!csv.includes('NaN'));
});
