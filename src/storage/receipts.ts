/**
 * 영수증 CRUD.
 *
 * 저장 직전에 항상 교차검증을 돌려 status 를 다시 계산한다(resolveStatus).
 * 그래야 "품목을 고쳤는데 상태가 그대로" 같은 어긋남이 생기지 않는다.
 * P5 의 검수 화면도 이 경로를 그대로 쓴다.
 */
import { hasReceiptContent, resolveStatus, type Receipt, type ReceiptItem } from '../types.ts';
import { getDB, newId } from './db.ts';

/** 저장 전 단계의 품목. id 와 receiptId 는 저장 시점에 채운다. */
export type ItemDraft = Omit<ReceiptItem, 'id' | 'receiptId'>;

export type ReceiptDraft = Omit<Receipt, 'id' | 'items' | 'status'> & {
  readonly items: readonly ItemDraft[];
  /** 지정하지 않으면 교차검증 결과로 자동 판정한다 */
  readonly status?: Receipt['status'];
};

function materialize(receiptId: string, items: readonly ItemDraft[]): ReceiptItem[] {
  return items.map((item, i) => ({
    ...item,
    id: `${receiptId}_i${i}`,
    receiptId,
    lineIndex: item.lineIndex ?? i,
  }));
}

/** id·OCR 원문·환율 등 메타데이터는 검수한 내용의 변경으로 세지 않는다. */
function contentKey(r: Receipt): string {
  return JSON.stringify([
    r.tripId, r.imageId, r.merchant, new Date(r.purchasedAt).getTime(), r.currency, r.total, r.tax,
    r.items.map(i => [i.name, i.quantity, i.unitPrice, i.amount, i.category]),
  ]);
}

export async function listReceipts(tripId: string | null): Promise<Receipt[]> {
  const db = await getDB();
  // null은 IndexedDB 인덱스 키가 아니므로 미지정 보관함은 전체에서 고른다.
  const rows = tripId === null ? (await db.getAll('receipts')).filter(r => r.tripId === null)
    : await db.getAllFromIndex('receipts', 'by-trip', tripId);
  return rows.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
}

export async function listAllReceipts(): Promise<Receipt[]> {
  const db = await getDB();
  return db.getAll('receipts');
}

export async function getReceipt(id: string): Promise<Receipt | undefined> {
  const db = await getDB();
  return db.get('receipts', id);
}

export async function createReceipt(draft: ReceiptDraft): Promise<Receipt> {
  const id = newId('rcpt');
  const base: Receipt = {
    ...draft,
    id,
    items: materialize(id, draft.items),
    status: draft.status ?? 'parsed',
  };
  // 교차검증으로 최종 상태 판정
  const receipt: Receipt = { ...base, status: resolveStatus(base) };

  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts'], 'readwrite');
  if (receipt.tripId !== null && !await tx.objectStore('trips').get(receipt.tripId)) {
    await tx.done;
    throw new Error('여행을 찾을 수 없습니다. 여행을 다시 선택하세요.');
  }
  await tx.objectStore('receipts').add(receipt);
  await tx.done;
  return receipt;
}

export async function updateReceipt(
  id: string,
  patch: Partial<Omit<ReceiptDraft, 'items'>> & { items?: readonly ItemDraft[] },
): Promise<Receipt> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'receipts'], 'readwrite');
  const existing = await tx.objectStore('receipts').get(id);
  if (!existing) throw new Error(`영수증을 찾을 수 없습니다: ${id}`);

  const merged: Receipt = {
    ...existing,
    ...patch,
    items: patch.items ? materialize(id, patch.items) : existing.items,
  };
  if (merged.tripId !== null && !await tx.objectStore('trips').get(merged.tripId)) {
    await tx.done;
    throw new Error('여행을 찾을 수 없습니다. 여행을 다시 선택하세요.');
  }
  const changed = contentKey(existing) !== contentKey(merged);
  const candidate = existing.status === 'confirmed' && changed
    ? { ...merged, status: 'parsed' as const }
    : merged;
  const updated: Receipt = { ...candidate, status: resolveStatus(candidate) };

  await tx.objectStore('receipts').put(updated);
  await tx.done;
  return updated;
}

/** 사용자가 검수를 마쳤다고 표시한다. 금액이 안 맞아도 사용자의 판단을 존중한다. */
export async function confirmReceipt(id: string): Promise<Receipt> {
  const db = await getDB();
  const tx = db.transaction('receipts', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) throw new Error(`영수증을 찾을 수 없습니다: ${id}`);
  if (!hasReceiptContent(existing)) throw new Error('내용을 저장한 뒤 확인 완료로 표시하세요.');
  const updated: Receipt = { ...existing, status: 'confirmed' };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['receipts', 'images'], 'readwrite');
  const existing = await tx.objectStore('receipts').get(id);
  if (existing?.imageId) await tx.objectStore('images').delete(existing.imageId);
  await tx.objectStore('receipts').delete(id);
  await tx.done;
}
