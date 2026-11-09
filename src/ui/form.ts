/** 폼 입력 헬퍼. 여행 폼과 영수증 폼이 공유한다. */
import { el } from './dom.ts';

export interface FieldOptions {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly value?: string | number;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly step?: string;
  readonly min?: string;
}

export function field(o: FieldOptions): HTMLElement {
  const input = el('input', {
    class: 'input',
    id: `f-${o.name}`,
    name: o.name,
    type: o.type ?? 'text',
    value: o.value === undefined ? '' : String(o.value),
    required: o.required ?? false,
    placeholder: o.placeholder ?? '',
    step: o.step ?? '',
    min: o.min ?? '',
  });

  return el('div', { class: 'field' },
    el('label', { class: 'field-label', for: `f-${o.name}`, text: o.label }),
    input,
    o.hint ? el('span', { class: 'field-hint', text: o.hint }) : null,
  );
}

export function selectField(
  label: string,
  name: string,
  options: readonly (readonly [string, string])[],
  selected?: string,
): HTMLElement {
  const sel = el('select', { class: 'input', id: `f-${name}`, name });
  for (const [value, text] of options) {
    sel.appendChild(el('option', { value, text, selected: value === selected }));
  }
  return el('div', { class: 'field' },
    el('label', { class: 'field-label', for: `f-${name}`, text: label }),
    sel,
  );
}

/** 폼 값을 문자열 맵으로 읽는다. */
export function readForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v === 'string') out[k] = v.trim();
  }
  return out;
}

export function errorBox(message: string): HTMLElement {
  return el('p', { class: 'form-error', role: 'alert', text: message });
}

/** 흔히 쓰는 통화 목록. 여행 지역에 맞춰 고른다. */
export const CURRENCIES: readonly (readonly [string, string])[] = [
  ['KRW', '원 (KRW)'],
  ['JPY', '엔 (JPY)'],
  ['USD', '달러 (USD)'],
  ['EUR', '유로 (EUR)'],
  ['CNY', '위안 (CNY)'],
  ['TWD', '대만달러 (TWD)'],
  ['THB', '바트 (THB)'],
  ['VND', '동 (VND)'],
];
