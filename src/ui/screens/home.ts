/** 여행 목록. 앱의 첫 화면이다. */
import { el, pageHeader, emptyState, phaseNote } from '../dom.ts';
import { money, dateRange } from '../format.ts';
import { tripsWithReceipts } from '../../data/dummy.ts';
import { tripTotal } from '../../types.ts';

export function renderHome(): HTMLElement {
  const data = tripsWithReceipts();

  if (data.length === 0) {
    return el('div', {},
      pageHeader('여행'),
      emptyState('등록된 여행이 없습니다.', '여행을 만들고 영수증을 추가해 보세요.'),
    );
  }

  const cards = data.map(({ trip, receipts }) => {
    const needsReview = receipts.filter((r) => r.status === 'needs_review').length;
    const pending = receipts.filter((r) => r.status === 'pending').length;

    return el('a', { class: 'card trip-card', href: `#/trips/${trip.id}` },
      el('div', { class: 'trip-head' },
        el('h2', { class: 'trip-name', text: trip.name }),
        el('span', { class: 'trip-amount', text: money(tripTotal(receipts), trip.currency) }),
      ),
      el('p', { class: 'trip-meta',
        text: `${trip.destination} · ${dateRange(trip.startDate, trip.endDate)}` }),
      el('div', { class: 'badges' },
        el('span', { class: 'badge', text: `영수증 ${receipts.length}장` }),
        needsReview > 0
          ? el('span', { class: 'badge warn', text: `검수 필요 ${needsReview}장` })
          : null,
        pending > 0 ? el('span', { class: 'badge', text: `인식 대기 ${pending}장` }) : null,
      ),
    );
  });

  return el('div', {},
    pageHeader('여행', '여행별로 영수증과 지출을 모아 봅니다.'),
    el('div', { class: 'card-list' }, ...cards),
    el('button', { class: 'btn primary block', type: 'button',
      onclick: () => alert('여행 추가는 P2 에서 구현합니다.') },
      '+ 여행 추가'),
    phaseNote('P2', '여행 추가·수정과 실제 저장(IndexedDB)이 연결됩니다.'),
  );
}
