import type { Trip } from '../types.ts';
import { navigate } from '../router.ts';
import { el } from './dom.ts';
import { selectField } from './form.ts';
import { travelPath } from './travel-state.ts';

function registrationPath(tripId: string | null, photo: boolean): string {
  if (photo) return `/scan?${new URLSearchParams({ tripId: tripId ?? '' })}`;
  return tripId ? `${travelPath(tripId)}/receipts/new` : '/receipts/new';
}

export function receiptRegistrationActions(tripId: string | null, onContinue: () => void): HTMLElement {
  return el('div', { class: 'btn-row receipt-registration-actions' },
    el('a', { class: 'btn primary', href: `#${registrationPath(tripId, true)}`, onclick: onContinue }, '사진으로 등록'),
    el('a', { class: 'btn', href: `#${registrationPath(tripId, false)}`, onclick: onContinue }, '직접 입력'),
  );
}

export function createRegistrationDialog(trips: readonly Trip[], onContinue: () => void): {
  element: HTMLDialogElement; open(): void;
} {
  const tripField = selectField('여행', 'registerTrip', [['', '여행 미지정'], ...trips.map(t => [t.id, t.name] as const)], '');
  const tripInput = tripField.querySelector<HTMLSelectElement>('select')!;
  const method = el('fieldset', { class: 'registration-method' },
    el('legend', { class: 'field-label', text: '입력 방식' }),
    ...[['photo', '사진으로 등록'], ['manual', '직접 입력']].map(([value, label]) =>
      el('label', {}, el('input', { type: 'radio', name: 'registerMethod', value, checked: value === 'photo' }), ` ${label}`)),
  );
  const close = (): void => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
  const form = el('form', { class: 'form' },
    el('h2', { id: 'registration-title', text: '영수증 등록' }), tripField, method,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit', text: '계속' }),
      el('button', { class: 'btn', type: 'button', text: '취소', onclick: close }),
    ),
  );
  const dialog = el('dialog', { class: 'registration-dialog', 'aria-labelledby': 'registration-title' }, form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const photo = form.querySelector<HTMLInputElement>('[name="registerMethod"]:checked')?.value !== 'manual';
    onContinue();
    close();
    navigate(registrationPath(tripInput.value || null, photo));
  });
  return { element: dialog, open: () => {
    tripInput.value = '';
    form.querySelector<HTMLInputElement>('[value="photo"]')!.checked = true;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    tripInput.focus();
  } };
}
