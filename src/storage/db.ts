/**
 * IndexedDB 연결과 스키마 정의.
 *
 * 백엔드가 없으므로 이 파일이 사실상 이 프로젝트의 "데이터베이스 스키마"다.
 * 제안서의 SQLite 설계를 브라우저 저장소로 옮긴 것이다.
 *
 * 설계 메모
 * - 품목(items)은 영수증 문서 안에 포함시켰다. 품목은 항상 영수증과 함께 읽고 쓰이고,
 *   한 영수증의 품목 전체를 한 트랜잭션으로 교체하는 편이 교차검증과 맞물려 안전하다.
 * - 이미지는 별도 스토어로 분리했다. 영수증 목록을 그릴 때 수 MB 짜리 Blob 까지
 *   같이 읽히면 안 되기 때문이다.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Receipt, Trip } from '../types.ts';

export const DB_NAME = 'tripreceipt';
export const DB_VERSION = 1;

export interface MetaRecord {
  readonly key: string;
  readonly value: unknown;
}

export interface ImageRecord {
  readonly id: string;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly createdAt: string;
}

export interface TripReceiptDB extends DBSchema {
  trips: {
    key: string;
    value: Trip;
    indexes: { 'by-startDate': string };
  };
  receipts: {
    key: string;
    value: Receipt;
    indexes: { 'by-trip': string; 'by-purchasedAt': string };
  };
  images: {
    key: string;
    value: ImageRecord;
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<TripReceiptDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<TripReceiptDB>> {
  dbPromise ??= openDB<TripReceiptDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // 버전을 올릴 때는 이 블록에 if (oldVersion < N) 단계를 덧붙인다.
      // 기존 사용자의 데이터를 지우지 않고 넘어가기 위함이다.
      if (oldVersion < 1) {
        const trips = db.createObjectStore('trips', { keyPath: 'id' });
        trips.createIndex('by-startDate', 'startDate');

        const receipts = db.createObjectStore('receipts', { keyPath: 'id' });
        receipts.createIndex('by-trip', 'tripId');
        receipts.createIndex('by-purchasedAt', 'purchasedAt');

        db.createObjectStore('images', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
    blocked() {
      console.warn('다른 탭이 이전 버전의 DB 를 열고 있어 업그레이드가 대기 중입니다.');
    },
    blocking() {
      // 다른 탭이 업그레이드를 시도하면 이 탭의 연결을 닫아 길을 터 준다.
      void getDB().then((db) => db.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** 테스트에서 연결을 초기화할 때 쓴다. */
export function resetDBHandle(): void {
  dbPromise = null;
}

/** 고유 ID. crypto.randomUUID 가 없는 환경을 대비한 대체 경로를 둔다. */
export function newId(prefix: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}

/** 저장된 모든 데이터를 지운다. 설정 화면의 "전체 삭제" 가 쓴다. */
export async function clearAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts', 'images', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('trips').clear(),
    tx.objectStore('receipts').clear(),
    tx.objectStore('images').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}

export interface UsageSummary {
  readonly trips: number;
  readonly receipts: number;
  readonly images: number;
}

export async function usage(): Promise<UsageSummary> {
  const db = await getDB();
  const [trips, receipts, images] = await Promise.all([
    db.count('trips'),
    db.count('receipts'),
    db.count('images'),
  ]);
  return { trips, receipts, images };
}
