/**
 * 교차검증 로직 테스트.
 * P5 에서 파서가 이 함수를 그대로 쓰므로, 동작을 여기서 못 박아 둔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossCheck,
  resolveStatus,
  tripTotal,
  totalsByCategory,
  isCountable,
  type Receipt,
  type ReceiptItem,
  type Category,
} from '../src/types.ts';

function item(amount: number, category: Category = '식비', i = 0): ReceiptItem {
  return {
    id: `i${i}`,
    receiptId: 'r1',
    name: `품목${i}`,
    quantity: 1,
    unitPrice: amount,
    amount,
    category,
    lineIndex: i,
  };
}

function receipt(total: number, items: ReceiptItem[], status: Receipt['status'] = 'parsed'): Receipt {
  return {
    id: 'r1',
    tripId: 't1',
    imageId: null,
    merchant: '테스트상점',
    purchasedAt: '2026-05-01T12:00:00.000Z',
    currency: 'KRW',
    total,
    tax: null,
    status,
    confidence: 0.9,
    items,
  };
}

test('품목 합계와 총액이 같으면 검증 통과', () => {
  const r = receipt(13000, [item(8000, '식비', 0), item(5000, '식비', 1)]);
  const result = crossCheck(r);
  assert.equal(result.itemsTotal, 13000);
  assert.equal(result.difference, 0);
  assert.equal(result.matches, true);
});

test('합계 줄이 품목으로 잘못 들어가면 검증 실패로 잡힌다', () => {
  // OCR 이 "합계 13000" 줄을 품목으로 읽어버린 상황
  const r = receipt(13000, [item(8000, '식비', 0), item(5000, '식비', 1), item(13000, '기타', 2)]);
  const result = crossCheck(r);
  assert.equal(result.itemsTotal, 26000);
  assert.equal(result.difference, -13000);
  assert.equal(result.matches, false);
});

test('1원 이내 차이는 반올림으로 보고 통과시킨다', () => {
  assert.equal(crossCheck(receipt(10000, [item(9999)])).matches, true);
  assert.equal(crossCheck(receipt(10002, [item(10000)])).matches, false);
});

test('검증 실패한 영수증은 needs_review 로 넘어간다', () => {
  assert.equal(resolveStatus(receipt(13000, [item(8000), item(5000)])), 'parsed');
  assert.equal(resolveStatus(receipt(13000, [item(8000)])), 'needs_review');
});

test('사용자가 확인한 영수증은 상태를 되돌리지 않는다', () => {
  // 금액이 안 맞아도 사용자가 confirmed 로 바꿨으면 그 판단을 존중한다
  const r = receipt(13000, [item(8000)], 'confirmed');
  assert.equal(resolveStatus(r), 'confirmed');
});

test('인식 전 영수증은 pending 을 유지한다', () => {
  assert.equal(resolveStatus(receipt(0, [], 'pending')), 'pending');
});

test('여행 합계와 카테고리별 집계', () => {
  const rs = [
    receipt(13000, [item(8000, '식비', 0), item(5000, '교통', 1)]),
    { ...receipt(7000, [item(7000, '식비', 2)]), id: 'r2' },
  ];
  assert.equal(tripTotal(rs), 20000);

  const byCat = totalsByCategory(rs);
  assert.equal(byCat.get('식비'), 15000);
  assert.equal(byCat.get('교통'), 5000);
  assert.equal(byCat.get('숙박'), undefined);
});

test('검증 실패·인식 전 영수증은 카테고리 집계에서 빠진다', () => {
  // OCR 이 "합계" 줄을 품목으로 읽은 영수증이 집계를 부풀리지 않아야 한다.
  const good = receipt(13000, [item(8000, '식비', 0), item(5000, '교통', 1)], 'parsed');
  const bad = { ...receipt(3800, [item(3800, '기타', 2)], 'needs_review'), id: 'r2' };
  const notYet = { ...receipt(0, [], 'pending'), id: 'r3' };

  const byCat = totalsByCategory([good, bad, notYet]);
  assert.equal(byCat.get('식비'), 8000);
  assert.equal(byCat.get('교통'), 5000);
  assert.equal(byCat.get('기타'), undefined, '검증 실패 영수증의 품목이 집계에 섞임');

  assert.equal(isCountable(good), true);
  assert.equal(isCountable(bad), false);
  assert.equal(isCountable(notYet), false);
});
