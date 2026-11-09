/** 앱 설정과 플래그. key-value 한 쌍씩 저장한다. */
import { getDB } from './db.ts';

export const SAMPLE_FLAG = 'sampleDataLoaded';

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const row = await db.get('meta', key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDB();
  await db.delete('meta', key);
}

/** 지금 들어 있는 데이터에 샘플이 섞여 있는가. 화면 상단 배너 표시에 쓴다. */
export function isSampleLoaded(): Promise<boolean> {
  return getMeta(SAMPLE_FLAG, false);
}
