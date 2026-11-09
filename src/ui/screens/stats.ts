/**
 * 통계 화면.
 *
 * P1 에서는 더미 데이터로 카테고리별 집계를 막대로 보여준다.
 * 차트 라이브러리를 쓰지 않고 CSS 막대로 그린다 — 의존성을 늘리지 않기 위함이고,
 * 이 정도 표현이면 충분하다.
 */
import { el, pageHeader, emptyState, phaseNote } from '../dom.ts';
import { money } from '../format.ts';
import { listTrips } from '../../storage/trips.ts';
import { listAllReceipts } from '../../storage/receipts.ts';
import type { Receipt } from '../../types.ts';
import { totalsByCategory, tripTotal, isCountable, CATEGORIES } from '../../types.ts';

export async function renderStats(): Promise<HTMLElement> {
  const [trips, all] = await Promise.all([listTrips(), listAllReceipts()]);

  if (trips.length === 0) {
    return el('div', {},
      pageHeader('통계'),
      emptyState('집계할 여행이 없습니다.', '여행을 만들고 영수증을 추가하면 분류별 지출이 보입니다.'),
    );
  }

  const byTrip = new Map<string, Receipt[]>();
  for (const r of all) {
    const list = byTrip.get(r.tripId);
    if (list) list.push(r);
    else byTrip.set(r.tripId, [r]);
  }

  const sections = trips.map((trip) => {
    const receipts = byTrip.get(trip.id) ?? [];
    const byCat = totalsByCategory(receipts);
    const total = tripTotal(receipts);
    const max = Math.max(1, ...byCat.values());

    // 금액이 있는 카테고리만, 큰 순서로
    const rows = CATEGORIES
      .map((cat) => ({ cat, amount: byCat.get(cat) ?? 0 }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map(({ cat, amount }) =>
        el('div', { class: 'bar-row' },
          el('span', { class: 'bar-label', text: cat }),
          el('div', { class: 'bar-track' },
            el('div', { class: 'bar-fill', style: `width:${(amount / max) * 100}%` }),
          ),
          el('span', { class: 'bar-value', text: money(amount, trip.currency) }),
        ),
      );

    const excluded = receipts.filter((r) => !isCountable(r)).length;

    return el('section', { class: 'stat-section' },
      el('div', { class: 'stat-head' },
        el('h2', { class: 'section-title', text: trip.name }),
        el('span', { class: 'stat-total', text: money(total, trip.currency) }),
      ),
      rows.length === 0
        ? emptyState('아직 집계할 품목이 없습니다.')
        : el('div', { class: 'bars' }, ...rows),
      // 검증을 통과하지 못한 영수증은 품목 집계에서 뺐다는 사실을 숨기지 않는다.
      excluded > 0
        ? el('p', { class: 'stat-note',
            text: `검수가 필요하거나 아직 인식되지 않은 ${excluded}장은 분류 집계에서 제외했습니다.` })
        : null,
    );
  });

  return el('div', {},
    pageHeader('통계', '카테고리별 지출 분포입니다.'),
    ...sections,
    phaseNote('P6', '기간별 추이, 여행 간 비교, CSV 내보내기가 추가됩니다.'),
  );
}
