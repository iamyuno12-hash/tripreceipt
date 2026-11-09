/** 여행 목록. 앱의 첫 화면이다. */
import { el, pageHeader, phaseNote } from '../dom.ts';
import { money, dateRange } from '../format.ts';
import { listTrips } from '../../storage/trips.ts';
import { listAllReceipts } from '../../storage/receipts.ts';
import { isSampleLoaded } from '../../storage/meta.ts';
import { loadSample } from '../../storage/seed.ts';
import { tripTotal, type Receipt, type Trip } from '../../types.ts';

/** 샘플이 들어 있을 때 화면 맨 위에 띄우는 안내. 실제 인식 결과와 헷갈리지 않게 한다. */
export function sampleBanner(): HTMLElement {
  return el('div', { class: 'sample-banner' },
    el('strong', { text: '샘플 데이터' }),
    el('span', { text: ' 실제 인식 결과가 아니라 화면 확인용으로 넣은 예시입니다. 설정에서 지울 수 있습니다.' }),
  );
}

function tripCard(trip: Trip, receipts: Receipt[]): HTMLElement {
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
      needsReview > 0 ? el('span', { class: 'badge warn', text: `검수 필요 ${needsReview}장` }) : null,
      pending > 0 ? el('span', { class: 'badge', text: `인식 대기 ${pending}장` }) : null,
    ),
  );
}

export async function renderHome(): Promise<HTMLElement> {
  const [trips, allReceipts, sample] = await Promise.all([
    listTrips(),
    listAllReceipts(),
    isSampleLoaded(),
  ]);

  const byTrip = new Map<string, Receipt[]>();
  for (const r of allReceipts) {
    const list = byTrip.get(r.tripId);
    if (list) list.push(r);
    else byTrip.set(r.tripId, [r]);
  }

  if (trips.length === 0) {
    return el('div', {},
      pageHeader('여행', '여행별로 영수증과 지출을 모아 봅니다.'),
      el('div', { class: 'empty' },
        el('p', { text: '아직 여행이 없습니다.' }),
        el('p', { class: 'empty-hint', text: '여행을 만들고 영수증을 추가해 보세요.' }),
        el('div', { class: 'btn-row center' },
          el('a', { class: 'btn primary', href: '#/trips/new' }, '여행 만들기'),
          el('button', { class: 'btn', type: 'button',
            onclick: (ev: Event) => {
              const btn = ev.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              btn.textContent = '넣는 중…';
              void loadSample().then(() => globalThis.location.reload());
            } }, '샘플 데이터 넣기'),
        ),
      ),
      phaseNote('P3·P4', '영수증 사진 촬영과 자동 인식이 추가됩니다. 지금은 수기 입력만 가능합니다.'),
    );
  }

  return el('div', {},
    sample ? sampleBanner() : null,
    pageHeader('여행', '여행별로 영수증과 지출을 모아 봅니다.'),
    el('div', { class: 'card-list' },
      ...trips.map((t) => tripCard(t, byTrip.get(t.id) ?? [])),
    ),
    el('a', { class: 'btn primary block', href: '#/trips/new' }, '+ 여행 추가'),
    phaseNote('P3·P4', '영수증 사진 촬영과 자동 인식이 추가됩니다. 지금은 수기 입력만 가능합니다.'),
  );
}
