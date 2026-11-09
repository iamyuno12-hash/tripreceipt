/**
 * 영수증 CRUD.
 *
 * 저장 직전에 항상 교차검증을 돌려 status 를 다시 계산한다(resolveStatus).
 * 그래야 "품목을 고쳤는데 상태가 그대로" 같은 어긋남이 생기지 않는다.
 * P5 의 검수 화면도 이 경로를 그대로 쓴다.
 */
import { resolveStatus, type Receipt, type ReceiptItem } from '../types.ts';
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

export async function listReceipts(tripId: string): Promise<Receipt[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('receipts', 'by-trip', tripId);
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
  await db.add('receipts', receipt);
  return receipt;
}

export async function updateReceipt(
  id: string,
  patch: Partial<Omit<ReceiptDraft, 'items'>> & { items?: readonly ItemDraft[] },
): Promise<Receipt> {
  const db = await getDB();
  const existing = await db.get('receipts', id);
  if (!existing) throw new Error(`영수증을 찾을 수 없습니다: ${id}`);

  const merged: Receipt = {
    ...existing,
    ...patch,
    items: patch.items ? materialize(id, patch.items) : existing.items,
  };
  const updated: Receipt = { ...merged, status: resolveStatus(merged) };

  await db.put('receipts', updated);
  return updated;
}

/** 사용자가 검수를 마쳤다고 표시한다. 금액이 안 맞아도 사용자의 판단을 존중한다. */
export async function confirmReceipt(id: string): Promise<Receipt> {
  const db = await getDB();
  const existing = await db.get('receipts', id);
  if (!existing) throw new Error(`영수증을 찾을 수 없습니다: ${id}`);
  const updated: Receipt = { ...existing, status: 'confirmed' };
  await db.put('receipts', updated);
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
