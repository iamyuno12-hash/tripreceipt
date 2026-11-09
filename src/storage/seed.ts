/**
 * 샘플 데이터 적재·제거.
 *
 * 앱은 기본적으로 빈 상태로 시작한다. 사용자가 명시적으로 넣기를 눌렀을 때만
 * 샘플이 들어가고, 들어가 있는 동안에는 플래그가 켜져 화면에 배너가 뜬다.
 * 실제 인식 결과와 섞여 보이지 않게 하려는 의도다.
 */
import { TRIPS, RECEIPTS } from '../data/sample.ts';
import { getDB } from './db.ts';
import { setMeta, deleteMeta, SAMPLE_FLAG } from './meta.ts';

export async function loadSample(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts'], 'readwrite');
  for (const trip of TRIPS) await tx.objectStore('trips').put(trip);
  for (const receipt of RECEIPTS) await tx.objectStore('receipts').put(receipt);
  await tx.done;
  await setMeta(SAMPLE_FLAG, true);
}

/** 샘플만 골라 지운다. 사용자가 직접 만든 데이터는 건드리지 않는다. */
export async function removeSample(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts'], 'readwrite');
  for (const receipt of RECEIPTS) await tx.objectStore('receipts').delete(receipt.id);
  for (const trip of TRIPS) await tx.objectStore('trips').delete(trip.id);
  await tx.done;
  await deleteMeta(SAMPLE_FLAG);
}

/** 샘플 데이터에 속하는 여행인지 (화면에서 배지를 붙일 때 쓴다) */
export function isSampleTrip(id: string): boolean {
  return TRIPS.some((t) => t.id === id);
}
