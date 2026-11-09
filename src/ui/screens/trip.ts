/** 여행 상세 = 그 여행의 영수증 목록. */
import { el, pageHeader, emptyState, phaseNote } from '../dom.ts';
import { money, dateTime, dateRange } from '../format.ts';
import { getTrip } from '../../storage/trips.ts';
import { listReceipts } from '../../storage/receipts.ts';
import { isSampleLoaded } from '../../storage/meta.ts';
import { sampleBanner } from './home.ts';
import { tripTotal, crossCheck, type Receipt } from '../../types.ts';

const STATUS_LABEL: Record<Receipt['status'], string> = {
  pending: '인식 대기',
  parsed: '인식 완료',
  needs_review: '검수 필요',
  confirmed: '확인됨',
};

function receiptRow(r: Receipt): HTMLElement {
  const check = crossCheck(r);
  const isPending = r.status === 'pending';

  return el('a', { class: 'card receipt-row', href: `#/receipts/${r.id}` },
    el('div', { class: 'receipt-main' },
      el('span', { class: 'receipt-merchant', text: r.merchant || '(상호 미인식)' }),
      el('span', { class: 'receipt-date', text: dateTime(r.purchasedAt) }),
    ),
    el('div', { class: 'receipt-side' },
      el('span', { class: 'receipt-amount',
        text: isPending ? '—' : money(r.total, r.currency) }),
      el('span', { class: `status status-${r.status}`, text: STATUS_LABEL[r.status] }),
    ),
    // 교차검증에 걸린 영수증은 목록에서 이유까지 바로 보여준다.
    r.status === 'needs_review'
      ? el('p', { class: 'receipt-warn',
          text: `품목 합계 ${money(check.itemsTotal, r.currency)} 와 총액이 ${money(Math.abs(check.difference), r.currency)} 차이납니다` })
      : null,
  );
}

export async function renderTrip(params: Record<string, string>): Promise<HTMLElement> {
  const tripId = params['id'] ?? '';
  const trip = await getTrip(tripId);

  if (!trip) {
    return el('div', {},
      pageHeader('여행'),
      emptyState('여행을 찾을 수 없습니다.'),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

  const [receipts, sample] = await Promise.all([listReceipts(trip.id), isSampleLoaded()]);
  const reviewCount = receipts.filter((r) => r.status === 'needs_review').length;

  return el('div', {},
    sample ? sampleBanner() : null,
    el('a', { class: 'back-link', href: '#/' }, '← 여행 목록'),
    pageHeader(trip.name, `${trip.destination} · ${dateRange(trip.startDate, trip.endDate)}`),
    el('div', { class: 'btn-row' },
      el('a', { class: 'btn tiny', href: `#/trips/${trip.id}/edit` }, '여행 수정'),
    ),

    el('div', { class: 'summary-box' },
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '총 지출' }),
        el('span', { class: 'summary-value', text: money(tripTotal(receipts), trip.currency) }),
      ),
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '영수증' }),
        el('span', { class: 'summary-value', text: `${receipts.length}장` }),
      ),
      reviewCount > 0
        ? el('div', { class: 'summary-item' },
            el('span', { class: 'summary-label', text: '검수 필요' }),
            el('span', { class: 'summary-value warn', text: `${reviewCount}장` }),
          )
        : null,
    ),

    receipts.length === 0
      ? emptyState('아직 영수증이 없습니다.', '스캔 화면에서 영수증을 추가하세요.')
      : el('div', { class: 'card-list' }, ...receipts.map(receiptRow)),

    el('div', { class: 'btn-row' },
      el('a', { class: 'btn primary', href: `#/trips/${trip.id}/receipts/new` }, '+ 영수증 직접 입력'),
      el('a', { class: 'btn', href: '#/scan' }, '사진으로 추가'),
    ),
    phaseNote('P4', '사진으로 추가하면 OCR 이 품목과 금액을 자동으로 채웁니다. 지금은 직접 입력만 저장됩니다.'),
  );
}
