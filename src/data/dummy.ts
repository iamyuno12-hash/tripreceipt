/**
 * P1 화면 확인용 더미 데이터.
 *
 * P2 에서 IndexedDB 로 교체된다. 그때 이 파일은 "처음 실행 시 넣어주는 예시 데이터"
 * 로만 남기거나 삭제한다.
 *
 * 일부러 교차검증에 걸리는 영수증(needs_review)을 하나 섞어 두었다.
 * 검수 화면을 더미 상태에서도 확인할 수 있어야 하기 때문이다.
 */
import type { Receipt, ReceiptItem, Trip, Category } from '../types.ts';

export const TRIPS: readonly Trip[] = [
  {
    id: 't1',
    name: '오사카 3박 4일',
    destination: '일본 오사카',
    startDate: '2026-04-11',
    endDate: '2026-04-14',
    currency: 'JPY',
    createdAt: '2026-04-01T09:00:00.000Z',
  },
  {
    id: 't2',
    name: '제주 워크숍',
    destination: '제주',
    startDate: '2026-05-23',
    endDate: '2026-05-25',
    currency: 'KRW',
    createdAt: '2026-05-10T09:00:00.000Z',
  },
];

function mkItems(
  receiptId: string,
  rows: readonly (readonly [string, number, number, Category])[],
): ReceiptItem[] {
  return rows.map(([name, quantity, amount, category], i) => ({
    id: `${receiptId}-i${i}`,
    receiptId,
    name,
    quantity,
    unitPrice: Math.round(amount / quantity),
    amount,
    category,
    lineIndex: i,
  }));
}

export const RECEIPTS: readonly Receipt[] = [
  {
    id: 'r1',
    tripId: 't1',
    imageId: null,
    merchant: '이치란 도톤보리점',
    purchasedAt: '2026-04-11T12:40:00.000Z',
    currency: 'JPY',
    total: 2480,
    tax: 225,
    status: 'confirmed',
    confidence: 0.94,
    items: mkItems('r1', [
      ['天然とんこつラーメン', 2, 1960, '식비'],
      ['替玉', 1, 190, '식비'],
      ['半熟塩ゆでたまご', 2, 330, '식비'],
    ]),
  },
  {
    id: 'r2',
    tripId: 't1',
    imageId: null,
    merchant: 'ドン・キホーテ 道頓堀店',
    purchasedAt: '2026-04-12T20:15:00.000Z',
    currency: 'JPY',
    total: 6820,
    tax: 620,
    status: 'parsed',
    confidence: 0.88,
    items: mkItems('r2', [
      ['ロイズ 生チョコレート', 3, 2940, '쇼핑'],
      ['龍角散のど飴', 2, 760, '쇼핑'],
      ['メラノCC 美容液', 1, 1580, '쇼핑'],
      ['キットカット 抹茶', 4, 1540, '쇼핑'],
    ]),
  },
  {
    // 교차검증 실패 예시: OCR 이 "小計 3800" 줄을 품목으로 읽은 상황.
    // 품목 합계 7600 ≠ 총액 3800 → needs_review
    id: 'r3',
    tripId: 't1',
    imageId: null,
    merchant: '大阪市交通局',
    purchasedAt: '2026-04-13T09:05:00.000Z',
    currency: 'JPY',
    total: 3800,
    tax: null,
    status: 'needs_review',
    confidence: 0.61,
    items: mkItems('r3', [
      ['1日乗車券', 2, 1600, '교통'],
      ['地下鉄 片道', 4, 2200, '교통'],
      ['小計', 1, 3800, '기타'],
    ]),
  },
  {
    id: 'r4',
    tripId: 't2',
    imageId: null,
    merchant: '제주 흑돼지 맛집',
    purchasedAt: '2026-05-23T19:30:00.000Z',
    currency: 'KRW',
    total: 86000,
    tax: 7818,
    status: 'confirmed',
    confidence: 0.96,
    items: mkItems('r4', [
      ['흑돼지 오겹살 200g', 4, 68000, '식비'],
      ['된장찌개', 2, 12000, '식비'],
      ['소주', 2, 6000, '식비'],
    ]),
  },
  {
    id: 'r5',
    tripId: 't2',
    imageId: null,
    merchant: '제주렌터카',
    purchasedAt: '2026-05-23T10:00:00.000Z',
    currency: 'KRW',
    total: 135000,
    tax: 12273,
    status: 'parsed',
    confidence: 0.91,
    items: mkItems('r5', [
      ['아반떼 3일 대여', 1, 117000, '교통'],
      ['완전자차 보험', 1, 18000, '교통'],
    ]),
  },
  {
    id: 'r6',
    tripId: 't2',
    imageId: null,
    merchant: '',
    purchasedAt: '2026-05-24T13:20:00.000Z',
    currency: 'KRW',
    total: 0,
    tax: null,
    status: 'pending',
    confidence: null,
    items: [],
  },
];

export function tripsWithReceipts(): { trip: Trip; receipts: Receipt[] }[] {
  return TRIPS.map((trip) => ({
    trip,
    receipts: RECEIPTS.filter((r) => r.tripId === trip.id),
  }));
}

export function findTrip(id: string): Trip | undefined {
  return TRIPS.find((t) => t.id === id);
}

export function receiptsOf(tripId: string): Receipt[] {
  return RECEIPTS.filter((r) => r.tripId === tripId);
}

export function findReceipt(id: string): Receipt | undefined {
  return RECEIPTS.find((r) => r.id === id);
}
