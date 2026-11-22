import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { clearAll } from '../src/storage/db.ts';
import { createTrip, updateTrip } from '../src/storage/trips.ts';
import { createReceipt, getReceipt, updateReceipt, confirmReceipt } from '../src/storage/receipts.ts';
import { lookupExchangeRate, prepareExchangeRates, saveReceiptRate } from '../src/exchange.ts';
import { convertedTotal } from '../src/currency.ts';

const originalFetch = globalThis.fetch;
beforeEach(async () => { await clearAll(); });
afterEach(() => { globalThis.fetch = originalFetch; });

test('날짜별 조회·중복 요청 공유·영구 캐시를 사용하고 휴일의 실제 제공일을 저장한다', async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.match(String(input), /usd\/krw\?date=2026-01-04$/);
    assert.equal(init?.credentials, 'omit');
    return new Response(JSON.stringify({ date: '2026-01-02', base: 'USD', quote: 'KRW', rate: 1400 }));
  };
  const [a, b] = await Promise.all([lookupExchangeRate('USD', 'KRW', '2026-01-04'), lookupExchangeRate('USD', 'KRW', '2026-01-04')]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.date, '2026-01-02');
  assert.equal(a.requestedDate, '2026-01-04');
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await lookupExchangeRate('USD', 'KRW', '2026-01-04'), a);
});

test('응답 통화·날짜·환율이 유효하지 않으면 자동 적용하지 않는다', async () => {
  for (const data of [
    { date: '2026-01-05', base: 'EUR', quote: 'KRW', rate: 1400 },
    { date: '2026-01-06', base: 'USD', quote: 'KRW', rate: 1400 },
    { date: '2026-01-05', base: 'USD', quote: 'KRW', rate: 0 },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(data));
    await assert.rejects(lookupExchangeRate('USD', 'KRW', '2026-01-05', true), /유효한/);
  }
});

test('조회 실패는 영수증 저장을 막지 않으며 다음 조회로 복구할 수 있다', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const trip = await createTrip({ name: '여행', destination: '서울', startDate: '2026-01-07', endDate: '2026-01-07', currency: 'KRW' });
  const r = await createReceipt({ tripId: trip.id, imageId: null, merchant: '카페', purchasedAt: '2026-01-07T12:00:00', currency: 'USD', total: 10, tax: null, confidence: null,
    items: [{ name: '음료', quantity: 1, unitPrice: 10, amount: 10, category: '식비', lineIndex: 0 }] });
  const pending = await prepareExchangeRates([trip], [r]);
  assert.equal(convertedTotal(pending[0]!, 'KRW'), null);
  assert.equal((await getReceipt(r.id))?.total, 10);
  globalThis.fetch = async () => new Response(JSON.stringify({ date: '2026-01-07', base: 'USD', quote: 'KRW', rate: 1400 }));
  const rate = await lookupExchangeRate('USD', 'KRW', '2026-01-07', true);
  await confirmReceipt(r.id);
  await saveReceiptRate(r.id, rate);
  const saved = (await getReceipt(r.id))!;
  assert.equal(saved.status, 'confirmed');
  assert.equal(convertedTotal(saved, 'KRW'), 14000);
  assert.equal(saved.total, 10);
  const changedTrip = await updateTrip(trip.id, { currency: 'JPY' });
  globalThis.fetch = async () => new Response(JSON.stringify({ date: '2026-01-07', base: 'USD', quote: 'JPY', rate: 150 }));
  const revalued = (await prepareExchangeRates([changedTrip], [saved]))[0]!;
  assert.equal(convertedTotal(revalued, 'JPY'), 1500);
  assert.equal(convertedTotal(revalued, 'KRW'), 14000);
});

test('늦은 조회는 수정된 통화·금액·확인 상태를 덮어쓰지 않는다', async () => {
  const trip = await createTrip({ name: '여행', destination: '서울', startDate: '2026-01-08', endDate: '2026-01-08', currency: 'KRW' });
  const r = await createReceipt({ tripId: trip.id, imageId: null, merchant: '카페', purchasedAt: '2026-01-08T12:00:00', currency: 'USD', total: 10, tax: null, confidence: null,
    items: [{ name: '음료', quantity: 1, unitPrice: 10, amount: 10, category: '식비', lineIndex: 0 }] });
  await updateReceipt(r.id, { currency: 'EUR', total: 20 });
  await saveReceiptRate(r.id, { from: 'USD', to: 'KRW', rate: 1400, date: '2026-01-08', requestedDate: '2026-01-08', source: 'frankfurter', recordedAt: '' });
  const saved = (await getReceipt(r.id))!;
  assert.equal(saved.currency, 'EUR');
  assert.equal(saved.total, 20);
  assert.equal(saved.exchangeRates, undefined);
});
