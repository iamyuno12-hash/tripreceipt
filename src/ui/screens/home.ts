/** 여행과 영수증 등록·관리를 모은 첫 화면. */
import { el, pageHeader, emptyState } from '../dom.ts';
import { dateRange } from '../format.ts';
import { listTrips, deleteTrip } from '../../storage/trips.ts';
import { listAllReceipts } from '../../storage/receipts.ts';
import { isSampleLoaded } from '../../storage/meta.ts';
import { loadSample } from '../../storage/seed.ts';
import type { Trip } from '../../types.ts';
import { summarizeExpenses } from '../../currency.ts';
import { prepareExchangeRates } from '../../exchange.ts';
import { expenseText } from '../exchange-display.ts';
import { registrationGuide } from '../registration-guide.ts';
import { createDeleteButton } from '../delete-action.ts';
import { receiptRow } from '../receipt-list.ts';
import { createRegistrationDialog } from '../registration-dialog.ts';
import { openTravelGroups, rememberTravelPosition, travelPath } from '../travel-state.ts';

export function sampleBanner(): HTMLElement {
  return el('div', { class: 'sample-banner' }, el('strong', { text: '샘플 데이터' }),
    el('span', { text: ' 실제 인식 결과가 아니라 화면 확인용으로 넣은 예시입니다. 설정에서 지울 수 있습니다.' }));
}

export async function renderHome(): Promise<HTMLElement> {
  const [trips, saved, sample] = await Promise.all([listTrips(), listAllReceipts(), isSampleLoaded()]);
  const receipts = await prepareExchangeRates(trips, saved);
  const page = el('div', { class: 'travel-page', 'data-page-key': 'travel-home', 'data-return-path': '/' });
  const registration = createRegistrationDialog(trips, () => rememberTravelPosition(page));

  function group(trip: Trip | null): HTMLElement {
    const key = trip?.id ?? 'unassigned';
    const rows = receipts.filter(receipt => receipt.tripId === (trip?.id ?? null))
      .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
    const summary = trip ? summarizeExpenses(rows, trip.currency) : null;
    const review = rows.filter(r => r.status === 'needs_review').length;
    const pending = rows.filter(r => r.status === 'pending').length;
    const error = el('p', { class: 'field-hint', role: 'alert' });
    const actions = el('span', { class: 'trip-overview-actions' },
      trip ? el('a', { class: 'btn tiny', href: `#/trips/${trip.id}/edit`, onclick: () => rememberTravelPosition(page) }, '여행 수정') : null,
      trip ? createDeleteButton({ label: '여행 삭제', tiny: true,
        message: `"${trip.name}"을(를) 삭제할까요? 이 여행의 영수증과 사진도 함께 삭제되며 되돌릴 수 없습니다.`,
        remove: () => deleteTrip(trip.id), destination: '/', onError: message => { error.textContent = message; },
      }) : null,
    );
    const bodyId = `travel-receipts-${key}`;
    const body = el('div', { class: 'travel-group-body', id: bodyId, hidden: !openTravelGroups.has(key) },
      el('div', { class: 'btn-row travel-receipt-actions' }, el('button', { class: 'btn', type: 'button',
        onclick: () => registration.open(trip?.id ?? null, trip !== null) }, '+ 영수증 등록')),
      !trip ? el('p', { class: 'field-hint', text: '여행에 지정하기 전에는 지출·통계에서 제외되며, 전체 CSV에는 포함됩니다.' }) : null,
      summary?.pending ? el('p', { class: 'stat-note', text: `환산 대기 ${summary.pending}장은 합계에서 빠져 있습니다. 영수증 수정 화면에서 환율을 입력하거나 조회하세요.` }) : null,
      rows.length ? el('div', { class: 'card-list' }, ...rows.map(receipt => receiptRow(receipt, trip?.currency ?? null,
        () => rememberTravelPosition(page, receipt.id)))) : emptyState('아직 영수증이 없습니다.'),
    );
    const arrow = el('span', { 'aria-hidden': 'true', text: body.hidden ? '▸' : '▾' });
    const toggle = el('button', { class: 'travel-receipt-toggle', type: 'button',
      'aria-expanded': String(!body.hidden), 'aria-controls': bodyId }, `영수증 ${rows.length}장 `, arrow);
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      arrow.textContent = body.hidden ? '▸' : '▾';
      if (body.hidden) openTravelGroups.delete(key); else openTravelGroups.add(key);
    });
    return el('article', { class: `travel-group${trip ? '' : ' travel-unassigned'}`, 'data-travel-group': key },
      el('div', { class: 'travel-summary' },
        el('a', { class: 'travel-detail-link', href: `#${travelPath(trip?.id ?? null)}`,
          'aria-label': `${trip?.name ?? '여행 미지정'} 상세 보기`, onclick: () => rememberTravelPosition(page) }),
        el('div', { class: 'trip-head' },
          el('h2', { class: 'trip-name' }, trip?.name ?? '여행 미지정',
            el('span', { class: 'travel-detail-arrow', 'aria-hidden': 'true', text: '›' })),
          trip && summary ? el('span', { class: 'trip-amount', text: expenseText(summary, trip.currency) }) : null,
        ),
        el('p', { class: 'trip-meta', text: trip ? `${trip.destination} · ${dateRange(trip.startDate, trip.endDate)}`
          : '여행을 지정하기 전까지 보관하는 영수증입니다.' }),
        el('div', { class: 'travel-card-footer' },
          el('div', { class: 'travel-receipt-meta' }, toggle,
            review ? el('span', { class: 'badge warn', text: `검수 필요 ${review}장` }) : null,
            pending ? el('span', { class: 'badge', text: `인식 대기 ${pending}장` }) : null,
            summary?.pending ? el('span', { class: 'badge warn', text: `환산 대기 ${summary.pending}장` }) : null,
          ),
          trip ? actions : null,
        ),
        error,
      ), body,
    );
  }

  page.append(
    registrationGuide(),
    ...(sample ? [sampleBanner()] : []),
    el('div', { class: 'travel-page-heading' }, pageHeader('여행', '여행과 영수증을 등록하고 지출을 관리합니다.'),
      el('div', { class: 'btn-row' },
        el('a', { class: 'btn primary', href: '#/trips/new', onclick: () => rememberTravelPosition(page) }, '+ 여행 추가'),
        el('button', { class: 'btn', type: 'button', onclick: () => registration.open() }, '+ 영수증 등록'),
      )),
    el('div', { class: 'travel-groups' }, group(null), ...trips.map(group)),
    ...(trips.length === 0 ? [emptyState('아직 여행이 없습니다.', '여행을 만들거나, 영수증을 여행 미지정으로 먼저 보관하세요.'),
      !sample && receipts.length === 0 ? el('button', { class: 'btn', type: 'button', onclick: (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
        void loadSample().then(() => globalThis.location.reload());
      } }, '샘플 데이터 넣기') : null].filter((node): node is HTMLElement => node !== null) : []),
    registration.element,
  );
  return page;
}
