/**
 * 영수증 원본 이미지 저장.
 *
 * P3 에서 촬영·선택한 이미지가 여기로 들어간다. P2 에서는 저장소만 먼저 만들어 둔다.
 * Blob 을 그대로 넣는 이유는 base64 로 바꾸면 용량이 약 1.33배로 늘기 때문이다.
 */
import { getDB, newId, type ImageRecord } from './db.ts';

export async function saveImage(blob: Blob): Promise<string> {
  const record: ImageRecord = {
    id: newId('img'),
    blob,
    mimeType: blob.type || 'image/jpeg',
    createdAt: new Date().toISOString(),
  };
  const db = await getDB();
  await db.add('images', record);
  return record.id;
}

export async function getImage(id: string): Promise<ImageRecord | undefined> {
  const db = await getDB();
  return db.get('images', id);
}

/**
 * 화면에 표시할 수 있는 URL 을 만든다.
 * 사용이 끝나면 반드시 revoke 를 호출해야 메모리가 회수된다.
 */
export async function imageObjectURL(
  id: string,
): Promise<{ url: string; revoke: () => void } | null> {
  const record = await getImage(id);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function deleteImage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('images', id);
}
