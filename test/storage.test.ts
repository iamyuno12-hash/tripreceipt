/**
 * 저장소 계층 테스트.
 *
 * fake-indexeddb 로 Node 에서 실제 IndexedDB 동작(트랜잭션·인덱스·연쇄 삭제)을 검증한다.
 * 백엔드가 없어서 이 계층이 사실상 데이터베이스 전체이므로, 브라우저에서 눈으로
 * 확인하는 것만으로는 부족하다고 보고 테스트를 붙였다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { clearAll, usage, newId, getDB } from '../src/storage/db.ts';
import { createTrip, listTrips, getTrip, updateTrip, deleteTrip } from '../src/storage/trips.ts';
import {
  createReceipt,
  listReceipts,
  getReceipt,
  updateReceipt,
  confirmReceipt,
  deleteReceipt,
  type ItemDraft,
} from '../src/storage/receipts.ts';
import { saveImage, getImage } from '../src/storage/images.ts';
import { setMeta, getMeta, isSampleLoaded } from '../src/storage/meta.ts';
import { loadSample, removeSample } from '../src/storage/seed.ts';

const TRIP = {
  name: '오사카 3박 4일',
  destination: '일본 오사카',
  startDate: '2026-04-11',
  endDate: '2026-04-14',
  currency: 'JPY',
};

function items(...rows: readonly (readonly [string, number])[]): ItemDraft[] {
  return rows.map(([name, amount], i) => ({
    name,
    quantity: 1,
    unitPrice: amount,
    amount,
    category: '식비' as const,
    lineIndex: i,
  }));
}

beforeEach(async () => {
  await clearAll();
});

test('여행을 만들고 다시 읽을 수 있다', async () => {
  const created = await createTrip(TRIP);
  assert.ok(created.id.startsWith('trip_'));
  assert.ok(created.createdAt);

  const fetched = await getTrip(created.id);
  assert.equal(fetched?.name, '오사카 3박 4일');
  assert.equal((await listTrips()).length, 1);
});

test('여행 목록은 시작일 역순이다', async () => {
  await createTrip({ ...TRIP, name: '먼저', startDate: '2026-01-01' });
  await createTrip({ ...TRIP, name: '나중', startDate: '2026-09-01' });
  assert.deepEqual((await listTrips()).map((t) => t.name), ['나중', '먼저']);
});

test('여행을 수정해도 id 와 생성시각은 유지된다', async () => {
  const t = await createTrip(TRIP);
  const updated = await updateTrip(t.id, { name: '오사카 4박 5일', endDate: '2026-04-15' });
  assert.equal(updated.id, t.id);
  assert.equal(updated.createdAt, t.createdAt);
  assert.equal(updated.name, '오사카 4박 5일');
  assert.equal(updated.destination, TRIP.destination, '건드리지 않은 필드가 사라짐');
});

test('없는 여행을 수정하면 오류', async () => {
  await assert.rejects(() => updateTrip('없음', { name: 'x' }), /찾을 수 없습니다/);
});

test('영수증 저장 시 교차검증으로 상태가 자동 판정된다', async () => {
  const trip = await createTrip(TRIP);
  const base = {
    tripId: trip.id,
    imageId: null,
    merchant: '이치란',
    purchasedAt: '2026-04-11T12:40:00.000Z',
    currency: 'JPY',
    tax: null,
    confidence: 0.9,
  };

  const ok = await createReceipt({ ...base, total: 1300, items: items(['라멘', 800], ['계란', 500]) });
  assert.equal(ok.status, 'parsed');

  // "합계" 줄이 품목으로 들어간 경우 -> 검수 필요
  const bad = await createReceipt({
    ...base,
    total: 1300,
    items: items(['라멘', 800], ['계란', 500], ['合計', 1300]),
  });
  assert.equal(bad.status, 'needs_review');
});

test('품목을 고치면 상태가 다시 계산된다', async () => {
  const trip = await createTrip(TRIP);
  const r = await createReceipt({
    tripId: trip.id, imageId: null, merchant: 'x',
    purchasedAt: '2026-04-11T12:40:00.000Z', currency: 'JPY',
    total: 1300, tax: null, confidence: 0.6,
    items: items(['라멘', 800], ['계란', 500], ['合計', 1300]),
  });
  assert.equal(r.status, 'needs_review');

  // 잘못 들어간 합계 줄을 지우면 통과 상태로 돌아와야 한다
  const fixed = await updateReceipt(r.id, { items: items(['라멘', 800], ['계란', 500]) });
  assert.equal(fixed.status, 'parsed');
  assert.equal(fixed.items.length, 2);
  assert.equal(fixed.items[0]?.receiptId, r.id, 'receiptId 가 품목에 채워지지 않음');
});

test('사용자가 확인하면 금액이 안 맞아도 confirmed 로 남는다', async () => {
  const trip = await createTrip(TRIP);
  const r = await createReceipt({
    tripId: trip.id, imageId: null, merchant: 'x',
    purchasedAt: '2026-04-11T12:40:00.000Z', currency: 'JPY',
    total: 1300, tax: null, confidence: 0.5,
    items: items(['라멘', 800]),
  });
  assert.equal(r.status, 'needs_review');

  await confirmReceipt(r.id);
  // 이후 수정이 일어나도 confirmed 를 되돌리지 않는다
  const after = await updateReceipt(r.id, { merchant: '이치란' });
  assert.equal(after.status, 'confirmed');
});

test('영수증은 여행별로 조회되고 결제시각 순으로 정렬된다', async () => {
  const a = await createTrip({ ...TRIP, name: 'A' });
  const b = await createTrip({ ...TRIP, name: 'B' });
  const mk = (tripId: string, at: string, merchant: string) =>
    createReceipt({
      tripId, imageId: null, merchant, purchasedAt: at, currency: 'JPY',
      total: 100, tax: null, confidence: 1, items: items([merchant, 100]),
    });

  await mk(a.id, '2026-04-13T10:00:00.000Z', '나중');
  await mk(a.id, '2026-04-11T10:00:00.000Z', '먼저');
  await mk(b.id, '2026-04-12T10:00:00.000Z', '다른여행');

  assert.deepEqual((await listReceipts(a.id)).map((r) => r.merchant), ['먼저', '나중']);
  assert.equal((await listReceipts(b.id)).length, 1);
});

test('여행을 지우면 그 여행의 영수증과 이미지도 함께 사라진다', async () => {
  const trip = await createTrip(TRIP);
  const imageId = await saveImage(new Blob(['fake'], { type: 'image/jpeg' }));
  await createReceipt({
    tripId: trip.id, imageId, merchant: 'x',
    purchasedAt: '2026-04-11T10:00:00.000Z', currency: 'JPY',
    total: 100, tax: null, confidence: 1, items: items(['a', 100]),
  });

  assert.deepEqual(await usage(), { trips: 1, receipts: 1, images: 1 });

  await deleteTrip(trip.id);

  assert.deepEqual(await usage(), { trips: 0, receipts: 0, images: 0 },
    '고아 레코드가 남음');
  assert.equal(await getImage(imageId), undefined);
});

test('영수증을 지우면 딸린 이미지도 지워진다', async () => {
  const trip = await createTrip(TRIP);
  const imageId = await saveImage(new Blob(['fake'], { type: 'image/png' }));
  const r = await createReceipt({
    tripId: trip.id, imageId, merchant: 'x',
    purchasedAt: '2026-04-11T10:00:00.000Z', currency: 'JPY',
    total: 100, tax: null, confidence: 1, items: items(['a', 100]),
  });

  await deleteReceipt(r.id);
  assert.equal(await getReceipt(r.id), undefined);
  assert.equal(await getImage(imageId), undefined);
});

test('이미지는 Blob 과 MIME 타입을 유지한다', async () => {
  const id = await saveImage(new Blob(['receipt-bytes'], { type: 'image/webp' }));
  const rec = await getImage(id);
  assert.equal(rec?.mimeType, 'image/webp');
  assert.equal(await rec?.blob.text(), 'receipt-bytes');
});

test('meta 는 값을 저장하고 기본값을 돌려준다', async () => {
  assert.equal(await getMeta('없는키', 'fallback'), 'fallback');
  await setMeta('없는키', 42);
  assert.equal(await getMeta('없는키', 0), 42);
});

test('샘플 데이터는 넣고 뺄 수 있고 플래그가 따라간다', async () => {
  assert.equal(await isSampleLoaded(), false);

  await loadSample();
  assert.equal(await isSampleLoaded(), true);
  const after = await usage();
  assert.ok(after.trips > 0 && after.receipts > 0);

  // 사용자가 직접 만든 여행은 샘플 제거에 영향받지 않아야 한다
  const mine = await createTrip({ ...TRIP, name: '내 여행' });

  await removeSample();
  assert.equal(await isSampleLoaded(), false);
  const trips = await listTrips();
  assert.deepEqual(trips.map((t) => t.name), ['내 여행']);
  assert.ok(await getTrip(mine.id));
});

test('전체 삭제는 모든 스토어를 비운다', async () => {
  await loadSample();
  await saveImage(new Blob(['x']));
  await setMeta('k', 'v');

  await clearAll();

  assert.deepEqual(await usage(), { trips: 0, receipts: 0, images: 0 });
  assert.equal(await getMeta('k', null), null);
});

test('스키마에 필요한 스토어와 인덱스가 모두 있다', async () => {
  const db = await getDB();
  assert.deepEqual([...db.objectStoreNames].sort(), ['images', 'meta', 'receipts', 'trips']);

  const tx = db.transaction('receipts');
  assert.deepEqual([...tx.store.indexNames].sort(), ['by-purchasedAt', 'by-trip']);
  await tx.done;
});

test('newId 는 접두사를 붙이고 매번 다른 값을 만든다', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId('trip')));
  assert.equal(ids.size, 200, 'ID 충돌 발생');
  assert.ok([...ids][0]?.startsWith('trip_'));
});
