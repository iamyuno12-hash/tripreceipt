/** 날짜별 참고환율 조회·캐시·영수증별 고정값 저장. 사진이나 상호는 전송하지 않는다. */
import type { ExchangeRate, Receipt, Trip } from './types.ts';
import { hasReceiptContent } from './types.ts';
import { paymentDate, receiptRate, validRate } from './currency.ts';
import { getMeta, setMeta } from './storage/meta.ts';
import { getDB } from './storage/db.ts';

const requests = new Map<string, Promise<ExchangeRate>>();
const failedUntil = new Map<string, number>();

export async function lookupExchangeRate(from: string, to: string, date: string, retry = false): Promise<ExchangeRate> {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('통화와 결제일을 확인하세요.');
  if (date > paymentDate(new Date().toISOString())) throw new Error('미래 날짜의 환율은 직접 입력하세요.');
  const key = `exchange:v1:${from}:${to}:${date}`;
  const cached = await getMeta<ExchangeRate | null>(key, null);
  if (cached && validRate(cached, from, to, date)) return cached;
  if (!retry && (failedUntil.get(key) ?? 0) > Date.now()) throw new Error('환율을 불러오지 못했습니다. 직접 입력하거나 다시 조회하세요.');
  if (requests.has(key)) return requests.get(key)!;
  const task = (async (): Promise<ExchangeRate> => {
    try {
      if (globalThis.navigator?.onLine === false) throw new Error('오프라인입니다. 저장된 환율을 사용하거나 직접 입력하세요.');
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}?date=${date}`, {
        signal: AbortSignal.timeout(6000), credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error('해당 날짜의 환율을 불러오지 못했습니다.');
      const data = await response.json() as Record<string, unknown>;
      const observation = typeof data['date'] === 'string' ? data['date'] : '';
      const age = (Date.parse(date) - Date.parse(observation)) / 86_400_000;
      if (data['base'] !== from || data['quote'] !== to || typeof data['rate'] !== 'number' ||
          !Number.isFinite(data['rate']) || data['rate'] <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(observation) ||
          !Number.isFinite(age) || age < 0 || age > 14) throw new Error('유효한 날짜별 환율이 없습니다. 직접 입력하세요.');
      const result: ExchangeRate = { from, to, rate: data['rate'], requestedDate: date, date: observation,
        source: 'frankfurter', recordedAt: new Date().toISOString() };
      await setMeta(key, result);
      failedUntil.delete(key);
      return result;
    } catch (error) {
      failedUntil.set(key, Date.now() + 60_000);
      throw error;
    } finally { requests.delete(key); }
  })();
  requests.set(key, task);
  return task;
}

/** 늦게 끝난 조회가 그 사이 수정된 내용·확인 상태를 덮어쓰지 않도록 트랜잭션 안에서 재확인한다. */
export async function saveReceiptRate(id: string, rate: ExchangeRate): Promise<Receipt | undefined> {
  const db = await getDB();
  const tx = db.transaction(['receipts', 'trips'], 'readwrite');
  const receipt = await tx.objectStore('receipts').get(id);
  const trip = receipt ? await tx.objectStore('trips').get(receipt.tripId) : undefined;
  if (!receipt || !trip || !validRate(rate, receipt.currency, trip.currency, paymentDate(receipt.purchasedAt))) {
    await tx.done;
    return receipt;
  }
  // 수동 입력 또는 먼저 저장된 고정 환율이 항상 우선한다.
  if (receiptRate(receipt, trip.currency)) { await tx.done; return receipt; }
  const updated = { ...receipt, exchangeRates: [...(receipt.exchangeRates ?? []), rate] };
  await tx.objectStore('receipts').put(updated);
  await tx.done;
  return updated;
}

/** 기존 영수증과 기준 통화 변경도 자동 보완한다. 조회 실패해도 화면·저장은 계속 쓸 수 있다. */
export async function prepareExchangeRates(trips: readonly Trip[], receipts: readonly Receipt[]): Promise<Receipt[]> {
  const byId = new Map(trips.map(trip => [trip.id, trip]));
  return Promise.all(receipts.map(async receipt => {
    const trip = byId.get(receipt.tripId);
    if (!trip || !hasReceiptContent(receipt) || receipt.currency === trip.currency || receiptRate(receipt, trip.currency)) return receipt;
    try {
      const rate = await lookupExchangeRate(receipt.currency, trip.currency, paymentDate(receipt.purchasedAt));
      return await saveReceiptRate(receipt.id, rate) ?? receipt;
    } catch { return receipt; }
  }));
}
