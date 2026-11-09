/**
 * 영수증 수동 입력·수정 폼.
 *
 * P4 전까지는 OCR 이 없으므로 이 폼이 유일한 입력 경로다.
 * P5 의 검수 화면이 이 품목 편집 UI 를 그대로 재사용한다.
 *
 * 입력하는 동안 품목 합계와 총액 차이를 실시간으로 보여 준다.
 * 교차검증이 왜 필요한지 사용자가 눈으로 바로 알 수 있게 하려는 의도다.
 */
import { el, pageHeader } from '../dom.ts';
import { field, selectField, readForm, errorBox, CURRENCIES } from '../form.ts';
import { money } from '../format.ts';
import { CATEGORIES, AMOUNT_TOLERANCE, type Category } from '../../types.ts';
import { getTrip } from '../../storage/trips.ts';
import {
  createReceipt, getReceipt, updateReceipt, deleteReceipt, type ItemDraft,
} from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { navigate } from '../../router.ts';

interface Row {
  name: string;
  quantity: number;
  amount: number;
  category: Category;
}

function num(v: string | null | undefined): number {
  const n = Number((v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function renderReceiptForm(params: Record<string, string>): Promise<HTMLElement> {
  const receiptId = params['id'];
  const editing = receiptId !== undefined;

  const existing = editing ? await getReceipt(receiptId) : undefined;
  const tripId = existing?.tripId ?? params['tripId'] ?? '';
  const trip = await getTrip(tripId);

  if (!trip) {
    return el('div', {},
      pageHeader('영수증'),
      el('p', { class: 'empty', text: '여행을 찾을 수 없습니다.' }),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

  const rows: Row[] = existing
    ? existing.items.map((i) => ({
        name: i.name, quantity: i.quantity, amount: i.amount, category: i.category,
      }))
    : [{ name: '', quantity: 1, amount: 0, category: '식비' }];

  const currency = existing?.currency ?? trip.currency;
  const itemsBody = el('tbody', {});
  const balance = el('div', { class: 'balance' });
  const errorSlot = el('div', {});

  const totalInput = el('input', {
    class: 'input', id: 'f-total', name: 'total', type: 'number', step: '1', min: '0',
    value: String(existing?.total ?? 0), required: true,
  });

  function itemsSum(): number {
    return rows.reduce((s, r) => s + r.amount, 0);
  }

  function refreshBalance(): void {
    const sum = itemsSum();
    const stated = num(totalInput.value);
    const diff = stated - sum;
    const ok = Math.abs(diff) <= AMOUNT_TOLERANCE;

    balance.className = ok ? 'balance ok' : 'balance warn';
    balance.replaceChildren(
      el('span', { text: `품목 합계 ${money(sum, currency)}` }),
      el('span', { text: `영수증 총액 ${money(stated, currency)}` }),
      el('span', { class: 'balance-diff',
        text: ok ? '일치' : `차이 ${money(Math.abs(diff), currency)}` }),
    );
  }

  function drawRows(): void {
    itemsBody.replaceChildren(
      ...rows.map((row, idx) =>
        el('tr', {},
          el('td', {},
            el('input', { class: 'input tight', value: row.name, placeholder: '품목명',
              oninput: (e: Event) => { row.name = (e.target as HTMLInputElement).value; } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight qty', type: 'number', min: '1',
              value: String(row.quantity),
              oninput: (e: Event) => {
                row.quantity = Math.max(1, num((e.target as HTMLInputElement).value));
              } }),
          ),
          el('td', { class: 'num' },
            el('input', { class: 'input tight amt', type: 'number', step: '1',
              value: String(row.amount),
              oninput: (e: Event) => {
                row.amount = num((e.target as HTMLInputElement).value);
                refreshBalance();
              } }),
          ),
          el('td', {},
            (() => {
              const sel = el('select', { class: 'input tight' });
              for (const c of CATEGORIES) {
                sel.appendChild(el('option', { value: c, text: c, selected: c === row.category }));
              }
              sel.addEventListener('change', (e) => {
                row.category = (e.target as HTMLSelectElement).value as Category;
              });
              return sel;
            })(),
          ),
          el('td', { class: 'num' },
            el('button', { class: 'btn tiny', type: 'button', title: '이 품목 삭제',
              onclick: () => {
                rows.splice(idx, 1);
                if (rows.length === 0) rows.push({ name: '', quantity: 1, amount: 0, category: '식비' });
                drawRows();
                refreshBalance();
              } }, '삭제'),
          ),
        ),
      ),
    );
  }

  drawRows();
  refreshBalance();
  totalInput.addEventListener('input', refreshBalance);

  const form = el('form', { class: 'form', novalidate: 'true' },
    field({ label: '상호', name: 'merchant', required: true,
      value: existing?.merchant ?? '', placeholder: '예: 이치란 도톤보리점' }),
    el('div', { class: 'field-row' },
      field({ label: '결제 일시', name: 'purchasedAt', type: 'datetime-local',
        value: (existing?.purchasedAt ?? new Date().toISOString()).slice(0, 16), required: true }),
      selectField('통화', 'currency', CURRENCIES, currency),
    ),

    el('h2', { class: 'section-title', text: '품목' }),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'items' },
        el('thead', {},
          el('tr', {},
            el('th', { text: '품목' }),
            el('th', { class: 'num', text: '수량' }),
            el('th', { class: 'num', text: '금액' }),
            el('th', { text: '분류' }),
            el('th', { class: 'num', text: '' }),
          ),
        ),
        itemsBody,
      ),
    ),
    el('button', { class: 'btn', type: 'button',
      onclick: () => {
        rows.push({ name: '', quantity: 1, amount: 0, category: '식비' });
        drawRows();
      } }, '+ 품목 추가'),

    el('h2', { class: 'section-title', text: '합계' }),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', { class: 'field-label', for: 'f-total', text: '영수증 총액' }),
        totalInput,
        el('span', { class: 'field-hint', text: '영수증에 찍힌 금액을 그대로 입력하세요.' }),
      ),
      field({ label: '부가세 (선택)', name: 'tax', type: 'number', step: '1',
        value: existing?.tax ?? '' }),
    ),
    balance,
    el('p', { class: 'field-hint',
      text: '품목 합계와 총액이 다르면 "검수 필요" 로 저장됩니다. 그대로 저장해도 됩니다.' }),

    errorSlot,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit' }, editing ? '저장' : '추가'),
      el('a', { class: 'btn',
        href: editing ? `#/receipts/${receiptId}` : `#/trips/${trip.id}` }, '취소'),
    ),
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errorSlot.replaceChildren();
    const v = readForm(form);

    if (!v['merchant']) { errorSlot.replaceChildren(errorBox('상호를 입력하세요.')); return; }

    const items: ItemDraft[] = rows
      .filter((r) => r.name.trim() !== '' || r.amount !== 0)
      .map((r, i) => ({
        name: r.name.trim() || '(이름 없음)',
        quantity: r.quantity,
        unitPrice: r.quantity > 0 ? Math.round(r.amount / r.quantity) : r.amount,
        amount: r.amount,
        category: r.category,
        lineIndex: i,
      }));

    const taxRaw = v['tax'] ?? '';
    const draft = {
      tripId: trip.id,
      imageId: existing?.imageId ?? null,
      merchant: v['merchant'] ?? '',
      purchasedAt: new Date(v['purchasedAt'] ?? Date.now()).toISOString(),
      currency: v['currency'] ?? currency,
      total: num(v['total']),
      tax: taxRaw === '' ? null : num(taxRaw),
      // 수기 입력이므로 OCR 신뢰도는 없다
      confidence: existing?.confidence ?? null,
      items,
    };

    void (async () => {
      try {
        if (editing && receiptId !== undefined) {
          await updateReceipt(receiptId, draft);
          navigate(`/receipts/${receiptId}`);
        } else {
          const created = await createReceipt(draft);
          void ensurePersistOnce();
          navigate(`/receipts/${created.id}`);
        }
      } catch (err) {
        errorSlot.replaceChildren(
          errorBox(`저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    })();
  });

  return el('div', {},
    el('a', { class: 'back-link',
      href: editing ? `#/receipts/${receiptId}` : `#/trips/${trip.id}` }, '← 돌아가기'),
    pageHeader(editing ? '영수증 수정' : '영수증 추가', trip.name),
    form,
    editing && receiptId !== undefined
      ? el('div', { class: 'danger-zone' },
          el('button', { class: 'btn danger', type: 'button',
            onclick: () => {
              if (!confirm('이 영수증을 삭제할까요?')) return;
              void deleteReceipt(receiptId).then(() => navigate(`/trips/${trip.id}`));
            } }, '영수증 삭제'),
        )
      : null,
  );
}
