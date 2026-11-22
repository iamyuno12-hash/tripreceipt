import { convertedTotal, receiptRate, type ExpenseSummary } from '../currency.ts';
import type { Receipt } from '../types.ts';
import { el } from './dom.ts';
import { money } from './format.ts';

export function expenseText(summary: ExpenseSummary, currency: string): string {
  const prefix = summary.pending ? '집계 가능액 ' : summary.converted ? '약 ' : '';
  return prefix + money(summary.total, currency);
}

export function conversionNote(receipt: Receipt, currency: string, detail = false): HTMLElement | null {
  if (receipt.currency === currency || receipt.status === 'pending') return null;
  const value = convertedTotal(receipt, currency);
  const rate = receiptRate(receipt, currency);
  return el('span', { class: 'conversion-note' },
    el('span', { text: value === null ? `환산 대기 · ${currency} 환율 입력 필요` : `환산액 약 ${money(value, currency)}` }),
    detail && rate ? el('span', { class: 'field-hint',
      text: `1 ${rate.from} = ${rate.rate.toLocaleString('ko-KR', { maximumFractionDigits: 10 })} ${rate.to} · ${rate.date} · ${rate.source === 'manual' ? '직접 입력' : 'Frankfurter 참고환율'}` }) : null,
  );
}
