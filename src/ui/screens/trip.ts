/** 여행 상세와 미지정 보관함 상세. 목록 카드의 펼침과 별개 화면으로 유지한다. */
import { el, pageHeader, emptyState } from '../dom.ts';
import { dateRange } from '../format.ts';
import type { Trip } from '../../types.ts';
import { getTrip, deleteTrip } from '../../storage/trips.ts';
import { listReceipts } from '../../storage/receipts.ts';
import { isSampleLoaded } from '../../storage/meta.ts';
import { summarizeExpenses } from '../../currency.ts';
import { prepareExchangeRates } from '../../exchange.ts';
import { sampleBanner } from './home.ts';
import { expenseText } from '../exchange-display.ts';
import { receiptRow } from '../receipt-list.ts';
import { createDeleteButton } from '../delete-action.ts';
import { receiptRegistrationActions } from '../registration-dialog.ts';
import { registrationGuide } from '../registration-guide.ts';
import { rememberTravelPosition, travelPath } from '../travel-state.ts';

async function renderTravelDetail(trip: Trip | null): Promise<HTMLElement> {
  const [saved, sample] = await Promise.all([listReceipts(trip?.id ?? null), isSampleLoaded()]);
  const receipts = trip ? await prepareExchangeRates([trip], saved) : saved;
  const summary = trip ? summarizeExpenses(receipts, trip.currency) : null;
  const review = receipts.filter(receipt => receipt.status === 'needs_review').length;
  const path = travelPath(trip?.id ?? null);
  const page = el('div', { class: 'trip-detail-page', 'data-page-key': path, 'data-return-path': path,
    'data-travel-group': trip?.id ?? 'unassigned' });
  const error = el('p', { class: 'field-hint', role: 'alert' });
  page.append(
    registrationGuide(),
    ...(sample ? [sampleBanner()] : []),
    el('a', { class: 'back-link', href: '#/' }, '← 여행 목록'),
    pageHeader(trip?.name ?? '여행 미지정', trip ? `${trip.destination} · ${dateRange(trip.startDate, trip.endDate)}` : '여행을 정하기 전 영수증을 보관합니다.'),
    el('section', { class: 'trip-overview', 'aria-label': trip ? '여행 요약' : '미지정 보관함 요약' },
      el('div', { class: 'summary-box' },
        trip && summary ? el('div', { class: 'summary-item trip-total' },
          el('span', { class: 'summary-label', text: `총 지출 (${trip.currency})` }),
          el('span', { class: 'summary-value', text: expenseText(summary, trip.currency) }),
        ) : null,
        el('div', { class: 'summary-item' }, el('span', { class: 'summary-label', text: '영수증' }),
          el('span', { class: 'summary-value', text: `${receipts.length}장` })),
        review ? el('div', { class: 'summary-item' }, el('span', { class: 'summary-label', text: '검수 필요' }),
          el('span', { class: 'summary-value warn', text: `${review}장` })) : null,
      ),
      trip ? el('div', { class: 'trip-overview-actions', 'aria-label': '여행 관리' },
        el('a', { class: 'btn tiny', href: `#/trips/${trip.id}/edit`, onclick: () => rememberTravelPosition(page) }, '여행 수정'),
        createDeleteButton({ label: '여행 삭제', tiny: true,
          message: `"${trip.name}"을(를) 삭제할까요? 이 여행의 영수증과 사진도 함께 삭제되며 되돌릴 수 없습니다.`,
          remove: () => deleteTrip(trip.id), destination: '/', onError: message => { error.textContent = message; } }),
      ) : null,
      error,
    ),
    el('section', { class: 'travel-receipts', 'aria-labelledby': 'trip-receipts-title' },
      el('div', { class: 'travel-receipt-actions' },
        el('h2', { id: 'trip-receipts-title', text: '영수증' }),
        receiptRegistrationActions(trip?.id ?? null, () => rememberTravelPosition(page)),
      ),
      !trip ? el('p', { class: 'field-hint', text: '여행에 지정하기 전에는 지출·통계에서 제외되며 전체 CSV에는 포함됩니다.' }) : null,
      summary?.pending ? el('p', { class: 'stat-note', text: `환산 대기 ${summary.pending}장은 합계에서 빠져 있습니다. 영수증 수정 화면에서 환율을 입력하거나 조회하세요.` }) : null,
      receipts.length ? el('div', { class: 'card-list' }, ...receipts.map(receipt => receiptRow(receipt, trip?.currency ?? null,
        () => rememberTravelPosition(page, receipt.id)))) : emptyState('아직 영수증이 없습니다.'),
    ),
  );
  return page;
}

export async function renderTrip(params: Record<string, string>): Promise<HTMLElement> {
  const trip = await getTrip(params['id'] ?? '');
  if (!trip) return el('div', {}, pageHeader('여행'), emptyState('여행을 찾을 수 없습니다.'),
    el('a', { class: 'btn', href: '#/' }, '← 여행 목록'));
  return renderTravelDetail(trip);
}

export function renderUnassigned(): Promise<HTMLElement> {
  return renderTravelDetail(null);
}
