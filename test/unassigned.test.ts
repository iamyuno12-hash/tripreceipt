import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { clearAll, getDB, DB_VERSION } from '../src/storage/db.ts';
import { createTrip, deleteTrip, listTrips } from '../src/storage/trips.ts';
import { createReceipt, updateReceipt, listReceipts, listAllReceipts, getReceipt, confirmReceipt } from '../src/storage/receipts.ts';
import { saveImage, getImage } from '../src/storage/images.ts';
import { buildExpenseCsv } from '../src/export/csv.ts';
import { convertedTotal, expensesByMonth, summarizeExpenses } from '../src/currency.ts';
import { prepareExchangeRates, saveReceiptRate } from '../src/exchange.ts';
import type { ExchangeRate, OcrSnapshot } from '../src/types.ts';

const tripDraft = { name: '여행', destination: '서울', startDate: '2026-11-20', endDate: '2026-11-23', currency: 'KRW' };
const rate: ExchangeRate = { from: 'USD', to: 'KRW', rate: 1000, requestedDate: '2026-11-20', date: '2026-11-20', source: 'manual', recordedAt: '' };
const draft = () => ({ tripId: null, imageId: null, merchant: '보관함', purchasedAt: '2026-11-20T12:00:00', currency: 'USD', total: 10, tax: 1,
  confidence: null, items: [{ name: '품목', quantity: 1, unitPrice: 10, amount: 10, category: '식비' as const, lineIndex: 0 }] });
const snapshot: OcrSnapshot = { lang: 'korean', lines: [{ text: '원문', score: 0.9, poly: [] }], imageSize: { width: 100, height: 200 },
  passes: 1, angle: 0, textHeight: 20, steps: [], ms: { total: 1, firstPass: 1, preprocess: 0, secondPass: 0 }, recordedAt: '' };
beforeEach(clearAll);

test('기존 스키마에서 미지정 null과 여행별 문자열 인덱스를 함께 조회한다', async () => {
  const trip = await createTrip(tripDraft);
  const unassigned = await createReceipt(draft());
  const assigned = await createReceipt({ ...draft(), tripId: trip.id });
  assert.deepEqual((await listReceipts(null)).map(r => r.id), [unassigned.id]);
  assert.deepEqual((await listReceipts(trip.id)).map(r => r.id), [assigned.id]);
  assert.equal(DB_VERSION, 1);
  assert.equal((await getDB()).version, 1);
  assert.equal((await listTrips()).length, 1);
});

test('여행 지정·해제·다른 여행으로 이동해도 ID·사진·OCR·원래 통화와 금액을 유지한다', async () => {
  const a = await createTrip(tripDraft), b = await createTrip({ ...tripDraft, currency: 'JPY' });
  const imageId = await saveImage(new Blob(['photo'], { type: 'image/png' }));
  const original = await createReceipt({ ...draft(), imageId, ocr: snapshot, exchangeRates: [rate] });
  for (const tripId of [a.id, null, b.id]) {
    const moved = await updateReceipt(original.id, { tripId });
    assert.equal(moved.id, original.id); assert.equal(moved.imageId, imageId); assert.deepEqual(moved.ocr, snapshot);
    assert.equal(moved.total, 10); assert.equal(moved.currency, 'USD'); assert.deepEqual(moved.items, original.items);
    assert.deepEqual(moved.exchangeRates, [rate]); assert.ok(await getImage(imageId));
  }
  assert.equal((await listReceipts(null)).length, 0);
  assert.equal((await listReceipts(a.id)).length, 0);
  assert.equal((await listReceipts(b.id)).length, 1);
});

test('여행 지정 전에는 월별 통계에서 제외되고, 지정 후 기준 통화로 포함된다', async () => {
  const trip = await createTrip(tripDraft);
  const r = await createReceipt({ ...draft(), exchangeRates: [rate] });
  const month = async () => expensesByMonth([trip], await listAllReceipts(), 'KRW', new Date(2026, 10, 23)).at(-1)!.amount;
  assert.equal(await month(), 0);
  await updateReceipt(r.id, { tripId: trip.id }); assert.equal(await month(), 10000);
  await updateReceipt(r.id, { tripId: null }); assert.equal(await month(), 0);
});

test('여행 이동으로 확인 상태를 재판정하고, 내용이 같으면 확인됨을 유지한다', async () => {
  const trip = await createTrip(tripDraft);
  const r = await createReceipt({ ...draft(), total: 12 });
  await confirmReceipt(r.id);
  assert.equal((await updateReceipt(r.id, { tripId: null })).status, 'confirmed');
  assert.equal((await updateReceipt(r.id, { tripId: trip.id })).status, 'needs_review');
});

test('삭제된 여행을 지정하려는 생성·수정은 영수증을 덮어쓰지 않는다', async () => {
  const r = await createReceipt(draft());
  await assert.rejects(createReceipt({ ...draft(), tripId: 'missing' }), /여행/);
  await assert.rejects(updateReceipt(r.id, { tripId: 'missing', total: 99 }), /여행/);
  assert.deepEqual(await getReceipt(r.id), r);
  assert.equal((await listAllReceipts()).length, 1);
});

test('여행 삭제는 미지정 영수증과 사진을 보존하며, 옮긴 영수증은 현재 여행에만 속한다', async () => {
  const a = await createTrip(tripDraft), b = await createTrip(tripDraft);
  const imageId = await saveImage(new Blob(['keep']));
  const unassigned = await createReceipt({ ...draft(), imageId });
  const moved = await createReceipt({ ...draft(), tripId: a.id });
  await updateReceipt(moved.id, { tripId: b.id });
  await deleteTrip(a.id); assert.ok(await getReceipt(moved.id));
  await deleteTrip(b.id); assert.equal(await getReceipt(moved.id), undefined);
  assert.ok(await getReceipt(unassigned.id)); assert.ok(await getImage(imageId));
});

test('전체 CSV는 미지정 원본을 포함하고, 환산·통계 포함 칸은 미지정으로 구분한다', async () => {
  const trip = await createTrip(tripDraft);
  const a = await createReceipt({ ...draft(), tripId: trip.id, exchangeRates: [rate] });
  const u = await createReceipt({ ...draft(), exchangeRates: [rate], items: [...draft().items, { ...draft().items[0]!, amount: 0 }] });
  const assignedCsv = buildExpenseCsv([trip], [a]);
  const full = buildExpenseCsv([trip], [a, u]);
  assert.ok(full.startsWith(assignedCsv + '\r\n'));
  const rows = full.slice(1).split('\r\n').map(line => line.match(/"(?:[^"]|"")*"/g)!.map(s => s.slice(1, -1)));
  const get = (row: number, key: string) => rows[row]![rows[0]!.indexOf(key)];
  assert.equal(get(2, '여행명'), '여행 미지정'); assert.equal(get(2, '여행ID'), '');
  assert.equal(get(2, '통계집계포함'), '아니요'); assert.equal(get(2, '통화'), 'USD');
  assert.equal(get(2, '영수증총액'), '10'); assert.equal(get(3, '영수증총액'), '');
  assert.equal(get(2, '부가세'), '1'); assert.equal(get(2, '집계기준통화'), '');
  assert.equal(get(2, '환산상태'), '여행 미지정'); assert.equal(get(2, '환산영수증총액'), '');
  assert.ok(buildExpenseCsv([], [u]).includes('"여행 미지정"'));
});

test('미지정은 환율을 조회하거나 늦게 도착한 조회를 저장하지 않는다', async () => {
  const trip = await createTrip(tripDraft), r = await createReceipt(draft());
  const oldFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('unexpected fetch'); };
  try {
    assert.deepEqual(await prepareExchangeRates([trip], [r]), [r]);
    assert.deepEqual(await saveReceiptRate(r.id, rate), r); assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('여행 기준 통화가 달라지면 이전 환율을 새 통화 금액으로 잘못 쓰지 않는다', async () => {
  const a = await createTrip(tripDraft), b = await createTrip({ ...tripDraft, currency: 'JPY' });
  const r = await createReceipt({ ...draft(), tripId: a.id, exchangeRates: [rate] });
  assert.equal(convertedTotal(r, 'KRW'), 10000);
  const moved = await updateReceipt(r.id, { tripId: b.id });
  const summary = summarizeExpenses([moved], 'JPY');
  assert.equal(summary.total, 0); assert.equal(summary.pending, 1); assert.equal(summary.byCategory.size, 0);
});
