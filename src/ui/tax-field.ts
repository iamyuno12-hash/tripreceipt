/** 부가세 비율 계산과 직접 입력. 저장되는 값은 기존 tax 금액 하나다. */
import { el } from './dom.ts';
import { money } from './format.ts';

export type TaxBasis = 'included' | 'percentage';

/** 화면의 통화 표시 기준에 맞춰 원·엔은 정수, 그 외 통화는 소수 둘째 자리로 반올림한다. */
export function calculateTax(total: number, rate: number, basis: TaxBasis, currency: string): number {
  const amount = total * rate / (basis === 'included' ? 100 + rate : 100);
  const scale = currency === 'KRW' || currency === 'JPY' ? 1 : 100;
  return Math.round((amount + Number.EPSILON) * scale) / scale;
}

export interface TaxField {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  validate(): string | null;
}

export function createTaxField(
  totalInput: HTMLInputElement,
  currencyInput: HTMLSelectElement,
  existingTax: number | null,
): TaxField {
  let entry: 'percent' | 'amount' = 'percent';
  let basis: TaxBasis = 'included';
  let rateTouched = false;
  let manualTouched = false;
  let manualValue = existingTax === null ? '' : String(existingTax);
  let error: string | null = null;

  const percentRadio = el('input', {
    type: 'radio', name: 'taxEntry', value: 'percent', checked: true,
  });
  const amountRadio = el('input', { type: 'radio', name: 'taxEntry', value: 'amount' });
  const rateInput = el('input', {
    class: 'input', id: 'f-tax-rate', type: 'number', min: '0', step: 'any',
    placeholder: '예: 10', 'aria-describedby': 'tax-basis-description',
  });
  const input = el('input', {
    class: 'input', id: 'f-tax', name: 'tax', type: 'number', min: '0', step: '1',
    value: manualValue, readonly: true, 'aria-describedby': 'tax-hint',
  });
  const amountLabel = el('label', { class: 'field-label', for: 'f-tax' });
  const hint = el('span', { id: 'tax-hint', class: 'field-hint', 'aria-live': 'polite' });
  const description = el('span', { id: 'tax-basis-description', class: 'field-hint tax-basis-description' });

  const includedButton = el('button', {
    class: 'tax-basis-button', type: 'button', 'aria-pressed': 'true',
    onclick: () => { basis = 'included'; refresh(); },
  }, '포함세액');
  const percentageButton = el('button', {
    class: 'tax-basis-button', type: 'button', 'aria-pressed': 'false',
    onclick: () => { basis = 'percentage'; refresh(); },
  }, '금액의 %');
  const basisControls = el('div', { class: 'tax-basis-row' },
    el('div', { class: 'tax-basis-toggle', role: 'group', 'aria-label': '부가세 계산 방식' },
      includedButton, percentageButton,
    ),
    description,
  );
  const percentControls = el('div', { class: 'tax-percent-controls' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'f-tax-rate', text: '비율 (%)' }),
      el('div', { class: 'tax-rate-input' },
        rateInput,
        el('span', { class: 'tax-rate-suffix', 'aria-hidden': 'true', text: '%' }),
      ),
    ),
  );
  const element = el('fieldset', { class: 'tax-field' },
    el('legend', { class: 'field-label', text: '부가세 (선택)' }),
    el('div', { class: 'tax-options-row' },
      el('div', { class: 'tax-entry-options' },
        el('label', { class: 'tax-entry-option' }, percentRadio, ' % 입력'),
        el('label', { class: 'tax-entry-option' }, amountRadio, ' 직접 입력'),
      ),
      basisControls,
    ),
    percentControls,
    el('div', { class: 'field' }, amountLabel, input, hint),
  );

  function setAmount(value: string): void {
    if (input.value !== value) input.value = value;
  }

  function refresh(): void {
    error = null;
    const currency = currencyInput.value;
    input.step = currency === 'KRW' || currency === 'JPY' ? '1' : '0.01';
    basisControls.hidden = entry !== 'percent';
    percentControls.hidden = entry !== 'percent';
    input.readOnly = entry === 'percent';
    percentRadio.checked = entry === 'percent';
    amountRadio.checked = entry === 'amount';
    includedButton.setAttribute('aria-pressed', String(basis === 'included'));
    percentageButton.setAttribute('aria-pressed', String(basis === 'percentage'));
    description.textContent = basis === 'included'
      ? '총액에 포함된 부가세를 분리해요.'
      : '총액에 입력한 비율을 곱해요.';

    if (entry === 'amount') {
      amountLabel.textContent = '부가세 금액';
      setAmount(manualValue);
      if (input.validity.badInput || (manualValue !== '' && (!Number.isFinite(Number(manualValue)) || Number(manualValue) < 0))) {
        error = '부가세 금액은 0 이상의 숫자로 입력하세요.';
      }
      hint.textContent = error ?? '영수증에 적힌 부가세 금액을 입력하세요.';
      return;
    }

    amountLabel.textContent = '계산된 부가세';
    const rate = rateInput.valueAsNumber;
    if (rateInput.validity.badInput || (rateInput.value !== '' && (!Number.isFinite(rate) || rate < 0))) {
      setAmount('');
      error = '부가세 비율은 0 이상의 숫자로 입력하세요.';
      hint.textContent = error;
      return;
    }
    if (rateInput.value === '') {
      const keepExisting = !rateTouched && existingTax !== null;
      setAmount(keepExisting ? String(existingTax) : '');
      amountLabel.textContent = keepExisting ? '현재 부가세' : '계산된 부가세';
      hint.textContent = keepExisting
        ? `저장된 ${money(existingTax, currency)}을 유지해요. 비율을 입력하면 다시 계산해요.`
        : '비율을 입력하면 자동 계산해요. 비워 두면 부가세 없이 저장해요.';
      return;
    }
    const total = totalInput.valueAsNumber;
    if (!Number.isFinite(total) || total < 0) {
      setAmount('');
      error = '부가세를 계산할 영수증 총액을 확인하세요.';
      hint.textContent = error;
      return;
    }
    const amount = calculateTax(total, rate, basis, currency);
    if (!Number.isFinite(amount)) {
      setAmount('');
      error = '부가세를 계산할 금액과 비율을 확인하세요.';
      hint.textContent = error;
      return;
    }
    setAmount(String(amount));
    hint.textContent = `계산 결과 ${money(amount, currency)} · 반올림 적용`;
  }

  percentRadio.addEventListener('change', () => {
    if (!percentRadio.checked) return;
    entry = 'percent';
    refresh();
  });
  amountRadio.addEventListener('change', () => {
    if (!amountRadio.checked) return;
    if (!manualTouched) manualValue = input.value;
    entry = 'amount';
    refresh();
  });
  rateInput.addEventListener('input', () => { rateTouched = true; refresh(); });
  input.addEventListener('input', () => {
    if (entry !== 'amount') return;
    manualTouched = true;
    manualValue = input.value;
    refresh();
  });
  totalInput.addEventListener('input', refresh);
  currencyInput.addEventListener('change', refresh);
  refresh();

  return {
    element, input,
    validate: () => { refresh(); return error; },
  };
}
