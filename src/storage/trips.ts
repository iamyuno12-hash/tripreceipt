/** 여행 CRUD. */
import type { Trip } from '../types.ts';
import { getDB, newId } from './db.ts';

export type TripDraft = Omit<Trip, 'id' | 'createdAt'>;

export async function listTrips(): Promise<Trip[]> {
  const db = await getDB();
  // 최근 여행이 위로 오도록 시작일 역순
  const all = await db.getAllFromIndex('trips', 'by-startDate');
  return all.reverse();
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const db = await getDB();
  return db.get('trips', id);
}

export async function createTrip(draft: TripDraft): Promise<Trip> {
  const trip: Trip = { ...draft, id: newId('trip'), createdAt: new Date().toISOString() };
  const db = await getDB();
  await db.add('trips', trip);
  return trip;
}

export async function updateTrip(id: string, patch: Partial<TripDraft>): Promise<Trip> {
  const db = await getDB();
  const existing = await db.get('trips', id);
  if (!existing) throw new Error(`여행을 찾을 수 없습니다: ${id}`);
  const updated: Trip = { ...existing, ...patch };
  await db.put('trips', updated);
  return updated;
}

/**
 * 여행을 지우면 그 여행의 영수증과 이미지도 함께 지운다.
 * 고아 레코드가 남으면 저장 공간만 차지하고 어디서도 보이지 않기 때문이다.
 */
export async function deleteTrip(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts', 'images'], 'readwrite');
  const receipts = await tx.objectStore('receipts').index('by-trip').getAll(id);

  for (const receipt of receipts) {
    if (receipt.imageId) await tx.objectStore('images').delete(receipt.imageId);
    await tx.objectStore('receipts').delete(receipt.id);
  }
  await tx.objectStore('trips').delete(id);
  await tx.done;
}
