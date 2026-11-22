import type { Trip } from '../types.ts';
import { OCR_LANGUAGES, OCR_LANGUAGE_LABELS, suggestOcrLanguage, tripOcrLanguage } from '../types.ts';
import { navigate } from '../router.ts';
import { el } from './dom.ts';
import { CURRENCIES, selectField } from './form.ts';

export function createRegistrationDialog(trips: readonly Trip[], onContinue: () => void): {
  element: HTMLDialogElement; open(tripId?: string | null): void;
} {
  const tripField = selectField('여행', 'registerTrip', [['', '여행 미지정'], ...trips.map(t => [t.id, t.name] as const)], '');
  const tripInput = tripField.querySelector<HTMLSelectElement>('select')!;
  const currencyField = selectField('결제 통화', 'registerCurrency', CURRENCIES, 'KRW');
  const currency = currencyField.querySelector<HTMLSelectElement>('select')!;
  const languageField = selectField('OCR 인식 언어', 'registerLanguage',
    OCR_LANGUAGES.map(lang => [lang, OCR_LANGUAGE_LABELS[lang]] as const), 'korean');
  const language = languageField.querySelector<HTMLSelectElement>('select')!;
  let languageTouched = false;
  const hint = el('p', { class: 'field-hint', role: 'status' });
  const method = el('fieldset', { class: 'registration-method' },
    el('legend', { class: 'field-label', text: '입력 방식' }),
    ...[['photo', '사진으로 등록'], ['manual', '직접 입력']].map(([value, label]) =>
      el('label', {}, el('input', { type: 'radio', name: 'registerMethod', value, checked: value === 'photo' }), ` ${label}`)),
  );
  const close = (): void => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
  const form = el('form', { class: 'form' },
    el('h2', { id: 'registration-title', text: '영수증 등록' }), tripField, method, currencyField, languageField, hint,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit', text: '계속' }),
      el('button', { class: 'btn', type: 'button', text: '취소', onclick: close }),
    ),
  );
  const dialog = el('dialog', { class: 'registration-dialog', 'aria-labelledby': 'registration-title' }, form);
  const draw = (): void => {
    const trip = trips.find(t => t.id === tripInput.value);
    const photo = form.querySelector<HTMLInputElement>('[name="registerMethod"]:checked')?.value !== 'manual';
    currencyField.hidden = !!trip;
    languageField.hidden = !!trip || !photo;
    hint.textContent = trip ? `여행 기준 통화 ${trip.currency} · ${OCR_LANGUAGE_LABELS[tripOcrLanguage(trip)]}`
      : '여행 미지정으로 보관합니다. 나중에 영수증 수정 화면에서 여행을 지정할 수 있습니다.';
  };
  form.addEventListener('change', draw);
  language.addEventListener('change', () => { languageTouched = true; });
  currency.addEventListener('change', () => { if (!languageTouched) language.value = suggestOcrLanguage(currency.value); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const trip = trips.find(t => t.id === tripInput.value);
    const photo = form.querySelector<HTMLInputElement>('[name="registerMethod"]:checked')?.value !== 'manual';
    const query = new URLSearchParams({ tripId: tripInput.value,
      currency: trip?.currency ?? currency.value, lang: trip ? tripOcrLanguage(trip) : language.value });
    onContinue(); close(); navigate(`${photo ? '/scan' : '/receipts/new'}?${query}`);
  });
  return { element: dialog, open: (tripId = null) => {
    tripInput.value = tripId ?? ''; currency.value = 'KRW'; language.value = 'korean'; languageTouched = false;
    form.querySelector<HTMLInputElement>('[value="photo"]')!.checked = true;
    draw();
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    tripInput.focus();
  } };
}
