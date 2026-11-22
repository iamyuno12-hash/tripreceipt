import { el } from './dom.ts';
import { money } from './format.ts';
import { convertAmount, paymentDate, validRate } from '../currency.ts';
import { lookupExchangeRate } from '../exchange.ts';
import type { ExchangeRate } from '../types.ts';

export interface ExchangeField {
  readonly element: HTMLElement;
  rates(): readonly ExchangeRate[];
  validate(): string | null;
  setTarget(currency: string | null): void;
}

export function createExchangeField(
  currencyInput: HTMLSelectElement,
  dateInput: HTMLInputElement,
  totalInput: HTMLInputElement,
  target: string | null,
  saved: readonly ExchangeRate[] = [],
): ExchangeField {
  let draft: ExchangeRate | null = null;
  let manual = false;
  let epoch = 0;
  let currentKey = '';
  const histories = [...saved];
  const input = el('input', { class: 'input exchange-rate', id: 'f-exchange-rate', type: 'number',
    min: '0', step: 'any', placeholder: '환율 입력', inputmode: 'decimal' });
  const label = el('label', { class: 'field-label', for: input.id });
  const preview = el('span', { class: 'exchange-preview', 'aria-live': 'polite' });
  const hint = el('span', { class: 'field-hint', 'aria-live': 'polite' });
  const button = el('button', { class: 'btn tiny', type: 'button', text: '결제일 환율 불러오기',
    onclick: () => { void refresh(true); } });
  const element = el('div', { class: 'field exchange-field' },
    el('span', { class: 'field-label', text: '여행 통화로 환산' }),
    label,
    el('div', { class: 'exchange-controls' }, input, button, preview),
    hint,
  );

  function drawPreview(): void {
    if (!target) return;
    const amount = Number(totalInput.value);
    const rate = Number(input.value);
    preview.textContent = input.value && totalInput.value !== '' && Number.isFinite(rate) && rate > 0 && Number.isFinite(amount)
      ? `환산액 약 ${money(convertAmount(amount, rate, target), target)}` : '환산 대기';
  }

  function useRate(rate: ExchangeRate): void {
    draft = rate;
    input.value = String(rate.rate);
    hint.textContent = rate.source === 'manual'
      ? `직접 입력 · ${rate.requestedDate} 결제 기준 · 저장하면 이 환율을 유지합니다.`
      : `Frankfurter 참고환율 · ${rate.date}${rate.date !== rate.requestedDate ? ` (${rate.requestedDate} 이전 최근 제공일)` : ''} · 저장하면 이 환율을 유지합니다.`;
    drawPreview();
  }

  async function refresh(retry = false): Promise<void> {
    const to = target;
    const from = currencyInput.value;
    const date = paymentDate(dateInput.value);
    const key = `${from}:${target}:${date}`;
    if (!retry && key === currentKey) { drawPreview(); return; }
    currentKey = key;
    const token = ++epoch;
    element.hidden = !to || from === to;
    draft = null;
    input.value = '';
    manual = false;
    button.disabled = false;
    if (!to || element.hidden) return;
    label.textContent = `1 ${from} = 아래 금액 (${to})`;
    const stored = histories.find(rate => validRate(rate, from, to, date));
    if (stored && !retry) { useRate(stored); return; }
    drawPreview();
    if (!date) { hint.textContent = '결제 일시를 입력하면 날짜별 환율을 불러옵니다.'; return; }
    button.disabled = true;
    hint.textContent = '결제일 기준 환율을 불러오는 중… 조회가 끝나기 전에도 영수증을 저장할 수 있습니다.';
    try {
      const result = await lookupExchangeRate(from, to, date, retry);
      if (token !== epoch) return;
      useRate(result);
    } catch {
      if (token !== epoch) return;
      hint.textContent = '환율을 불러오지 못했습니다. 직접 입력하거나 다시 조회하세요. 비워 두면 환산 대기로 저장합니다.';
      drawPreview();
    } finally { if (token === epoch) button.disabled = false; }
  }

  input.addEventListener('input', () => {
    ++epoch; // 조회 중 수동 입력한 값을 늦게 끝난 응답이 덮어쓰지 않는다.
    manual = true;
    draft = null;
    button.disabled = false;
    const rate = input.valueAsNumber;
    const date = paymentDate(dateInput.value);
    if (Number.isFinite(rate) && rate > 0 && date && target) {
      draft = { from: currencyInput.value, to: target, rate, requestedDate: date, date,
        source: 'manual', recordedAt: new Date().toISOString() };
      hint.textContent = '직접 입력한 환율입니다. 저장하면 이후에도 이 값을 사용합니다.';
    } else hint.textContent = '환율은 0보다 큰 숫자로 입력하세요. 비워 두면 환산 대기로 저장합니다.';
    drawPreview();
  });
  totalInput.addEventListener('input', drawPreview);
  dateInput.addEventListener('input', () => { void refresh(); });
  currencyInput.addEventListener('change', () => { void refresh(); });
  void refresh();

  return {
    element,
    setTarget: currency => {
      if (currency === target) return;
      if (draft) {
        const index = histories.findIndex(rate => validRate(rate, draft!.from, draft!.to, draft!.requestedDate));
        if (index >= 0) histories.splice(index, 1);
        histories.push(draft);
      }
      target = currency; currentKey = ''; void refresh();
    },
    validate: () => !element.hidden && manual && (input.validity.badInput ||
      (input.value !== '' && (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber <= 0)))
      ? '환율은 0보다 큰 숫자로 입력하세요.' : null,
    rates: () => {
      const to = target;
      if (!to || element.hidden) return histories;
      const date = paymentDate(dateInput.value);
      const rest = histories.filter(rate => !validRate(rate, currencyInput.value, to, date));
      return draft && validRate(draft, currencyInput.value, to, date) ? [...rest, draft] : rest;
    },
  };
}
