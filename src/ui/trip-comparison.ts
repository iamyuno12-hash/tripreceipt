/** 두 여행 통계의 공통 표시 조건. 여행별 금액은 보존하고 대상을 함께 고른다. */
import type { Receipt, Trip } from '../types.ts';
import { isCountable } from '../types.ts';
import { summarizeExpenses } from '../currency.ts';
import { el, emptyState } from './dom.ts';
import { dateRange } from './format.ts';
import { expenseText } from './exchange-display.ts';
import { field, selectField } from './form.ts';

export interface TravelFilters {
  period: 'year' | '3months' | 'month' | 'all';
  query: string;
}

function calendarDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function periodStart(today: Date, months: number): string {
  const first = new Date(today.getFullYear(), today.getMonth() - months, 1);
  const year = first.getFullYear();
  const month = first.getMonth();
  const day = Math.min(today.getDate(), new Date(year, month + 1, 0).getDate());
  return calendarDate(year, month, day);
}

function normalizeName(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

export function renderTravelStatistics(
  trips: readonly Trip[], byTrip: ReadonlyMap<string, Receipt[]>, registeredTripCount: number,
  filters: TravelFilters, renderCategories: (selected: readonly Trip[]) => HTMLElement,
): HTMLElement {
  const section = el('section', { class: 'stat-section stats-panel stats-travel-panel', 'aria-labelledby': 'stats-travel-title' },
    el('header', { class: 'stats-panel-header' },
      el('h2', { class: 'section-title stats-panel-title', id: 'stats-travel-title', text: '여행별 지출' }),
      el('p', { class: 'stats-panel-purpose', text: '여행을 골라 전체 지출과 분류별 구성을 함께 확인합니다.' }),
    ),
  );
  const summaries = trips.map(trip => ({
    trip, summary: summarizeExpenses((byTrip.get(trip.id) ?? []).filter(isCountable), trip.currency),
  }));
  const today = new Date();
  const end = calendarDate(today.getFullYear(), today.getMonth(), today.getDate());
  const periodField = selectField('여행 기간', 'travelPeriod', [
    ['year', '1년'], ['3months', '3개월'], ['month', '1개월'], ['all', '전체 기간'],
  ], filters.period);
  const searchField = field({ label: '여행 이름', name: 'travelQuery', type: 'search',
    value: filters.query, placeholder: '여행 이름으로 검색' });
  const period = periodField.querySelector<HTMLSelectElement>('select')!;
  const search = searchField.querySelector<HTMLInputElement>('input')!;
  const periodHint = el('p', { class: 'stat-note', id: 'travel-period-hint' });
  const status = el('p', { class: 'stat-note', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const results = el('div', { class: 'stats-comparison-results', id: 'stats-comparison-results',
    role: 'region', 'aria-label': '여행 간 지출 비교 결과', tabindex: 0 });
  const categories = el('div', { class: 'stats-categories-content' });
  const sharedResults = el('div', { id: 'stats-travel-results' },
    el('section', { class: 'stats-comparison-card', 'aria-labelledby': 'stats-comparison-title' },
      el('header', { class: 'stats-panel-header' },
        el('h3', { class: 'section-title stats-panel-title', id: 'stats-comparison-title', tabindex: -1,
          text: '여행 간 지출 비교' }),
        el('p', { class: 'stats-panel-purpose', text: '선택한 여행들의 검수 완료 지출 규모를 비교합니다.' }),
      ), results,
    ), categories,
  );
  for (const input of [period, search]) input.setAttribute('aria-controls', 'stats-travel-results');
  period.setAttribute('aria-describedby', 'travel-period-hint');
  const reset = el('button', { class: 'btn', type: 'button', text: '조건 해제',
    onclick: () => {
      filters.period = 'all'; filters.query = '';
      period.value = 'all'; search.value = '';
      drawResults();
    },
  });

  function drawResults(): void {
    const months = filters.period === 'year' ? 12 : filters.period === '3months' ? 3 : 1;
    const start = filters.period === 'all' ? null : periodStart(today, months);
    const query = normalizeName(filters.query);
    const visible = summaries.filter(({ trip }) =>
      (start === null || (trip.startDate <= end && trip.endDate >= start)) && normalizeName(trip.name).includes(query));
    periodHint.textContent = start === null
      ? '전체 여행 기간을 표시합니다.'
      : `${dateRange(start, end)}와 여행 기간이 겹치는 여행을 표시합니다.`;
    status.textContent = `선택 여행 ${visible.length}개 / 현재 통화 여행 ${trips.length}개`;
    reset.disabled = filters.period === 'all' && filters.query.length === 0;

    const groups = new Map<string, typeof visible>();
    for (const row of visible) {
      const rows = groups.get(row.trip.currency) ?? [];
      rows.push(row); groups.set(row.trip.currency, rows);
    }
    results.replaceChildren(...[...groups].map(([currency, rows]) => {
      const sorted = [...rows].sort((a, b) => b.summary.total - a.summary.total);
      const max = Math.max(1, ...sorted.map(row => Math.max(0, row.summary.total)));
      return el('div', { class: 'stats-comparison-group' },
        el('h4', { class: 'stats-comparison-currency', text: `${currency} 기준` }),
        ...sorted.map(({ trip, summary }) => el('div', { class: 'stats-comparison-item', 'data-trip-id': trip.id },
          el('div', { class: 'stat-head' },
            el('div', { class: 'stats-comparison-name' },
              el('span', { text: trip.name }),
              el('p', { class: 'stats-comparison-dates', text: dateRange(trip.startDate, trip.endDate) }),
            ),
            el('strong', { class: 'stats-comparison-amount', text: expenseText(summary, currency) }),
          ),
          summary.pending > 0 ? el('p', { class: 'stat-note', text: `환산 대기 ${summary.pending}장 제외` }) : null,
          el('div', { class: 'bar-track', style: 'margin-top:5px' },
            el('div', { class: 'bar-fill', style: `width:${Math.max(0, summary.total) / max * 100}%` }),
          ),
        )),
      );
    }));
    if (registeredTripCount < 2) {
      results.replaceChildren(emptyState('여행이 2개 이상 등록되면 지출을 비교할 수 있습니다.'));
    } else if (visible.length === 0) {
      results.appendChild(emptyState('조건에 맞는 여행이 없습니다.', '기간을 바꾸거나 여행 이름을 지워 보세요.'));
    }
    categories.replaceChildren(renderCategories(visible.map(row => row.trip)));
    results.scrollTop = 0;
  }

  period.addEventListener('change', () => {
    filters.period = period.value as TravelFilters['period']; drawResults();
  });
  search.addEventListener('input', () => { filters.query = search.value; drawResults(); });
  section.append(
    el('p', { class: 'stat-note', text: '기간·검색은 아래 비교와 지출 구성에 함께 적용됩니다. 금액은 선택한 여행 전체 기준입니다.' }),
    el('div', { class: 'stats-travel-controls' }, periodField, searchField, reset),
    periodHint, status, sharedResults,
  );
  drawResults();
  return section;
}
