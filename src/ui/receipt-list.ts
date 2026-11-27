import type { Receipt } from '../types.ts';
import { crossCheck } from '../types.ts';
import { el } from './dom.ts';
import { money, dateTime } from './format.ts';
import { conversionNote } from './exchange-display.ts';

const LABELS: Record<Receipt['status'], string> = {
  pending: '인식 대기', parsed: '인식 완료', needs_review: '검수 필요', confirmed: '확인됨',
};

export function receiptRow(receipt: Receipt, currency: string | null, onOpen: () => void): HTMLElement {
  const check = crossCheck(receipt);
  return el('a', { class: 'card receipt-row', href: `#/receipts/${receipt.id}`,
    'data-receipt-id': receipt.id, onclick: onOpen },
    el('div', { class: 'receipt-main' },
      el('span', { class: 'receipt-merchant', text: receipt.merchant || '(상호 미인식)' }),
      el('span', { class: 'receipt-date', text: dateTime(receipt.purchasedAt) }),
    ),
    el('div', { class: 'receipt-side' },
      el('span', { class: 'receipt-amount', text: receipt.status === 'pending' ? '—' : money(receipt.total, receipt.currency) }),
      currency ? conversionNote(receipt, currency) : null,
      el('span', { class: `status status-${receipt.status}`, text: LABELS[receipt.status] }),
    ),
    receipt.status === 'needs_review' ? el('p', { class: 'receipt-warn',
      text: `품목 합계 ${money(check.itemsTotal, receipt.currency)} 와 총액이 ${money(Math.abs(check.difference), receipt.currency)} 차이납니다` }) : null,
  );
}
