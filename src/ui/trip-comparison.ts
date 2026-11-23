/** 두 여행 통계의 공통 표시 조건. 여행별 금액은 보존하고 대상을 함께 고른다. */
import type { Receipt, Trip } from '../types.ts';
import { isCountable } from '../types.ts';
import { summarizeExpenses } from '../currency.ts';
import { el, emptyState } from './dom.ts';
import { dateRange } from './format.ts';
import { expenseText } from './exchange-display.ts';
import { field, selectField } from './form.ts';
import { attachDateCalendar } from './date-calendar.ts';

export interface TravelFilters {
  period: 'year' | '3months' | 'month' | 'all' | 'custom';
  query: string;
  customStart?: string;
  customEnd?: string;
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
    ),
  );
  const summaries = trips.map(trip => ({
    trip, summary: summarizeExpenses((byTrip.get(trip.id) ?? []).filter(isCountable), trip.currency),
  }));
  const today = new Date();
  const todayValue = calendarDate(today.getFullYear(), today.getMonth(), today.getDate());
  const allStart = trips.map(trip => trip.startDate).sort()[0] ?? '';
  const allEnd = trips.map(trip => trip.endDate).sort().at(-1) ?? '';
  const periodField = selectField('여행 기간', 'travelPeriod', [
    ['year', '1년'], ['3months', '3개월'], ['month', '1개월'], ['all', '전체 기간'], ['custom', '직접 설정'],
  ], filters.period);
  const startField = field({ label: '조회 시작일', name: 'travelStart', type: 'date', required: true });
  const endField = field({ label: '조회 종료일', name: 'travelEnd', type: 'date', required: true });
  const startDate = startField.querySelector<HTMLInputElement>('input')!;
  const endDate = endField.querySelector<HTMLInputElement>('input')!;
  const dateFields = el('fieldset', { class: 'stats-date-range', 'aria-label': '여행 기간과 겹치는 조회 날짜 범위' },
    startField, el('span', { class: 'stats-date-separator', 'aria-hidden': 'true', text: '~' }), endField,
  );
  const closeStartCalendar = attachDateCalendar(startDate, () => startDate.value,
    { label: '조회 시작일', openOnClick: true });
  const closeEndCalendar = attachDateCalendar(endDate, () => endDate.value || startDate.value,
    { label: '조회 종료일', openOnClick: true });
  const searchField = field({ label: '여행 이름', name: 'travelQuery', type: 'search',
    value: filters.query, placeholder: '여행 이름으로 검색' });
  searchField.classList.add('stats-travel-search');
  const period = periodField.querySelector<HTMLSelectElement>('select')!;
  const search = searchField.querySelector<HTMLInputElement>('input')!;
  const periodError = el('p', { class: 'form-error stats-period-error', id: 'travel-period-error',
    role: 'status', 'aria-live': 'polite' });
  const status = el('p', { class: 'stat-note', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const results = el('div', { class: 'stats-comparison-results', id: 'stats-comparison-results',
    role: 'region', 'aria-label': '여행 간 지출 비교 결과', tabindex: 0 });
  const categories = el('div', { class: 'stats-categories-content' });
  const sharedResults = el('div', { id: 'stats-travel-results' },
    el('section', { class: 'stats-comparison-card', 'data-chart': 'comparison', 'aria-labelledby': 'stats-comparison-title' },
      el('header', { class: 'stats-panel-header' },
        el('h3', { class: 'section-title stats-panel-title', id: 'stats-comparison-title', tabindex: -1,
          text: '여행 간 지출 비교' }),
        el('p', { class: 'stats-panel-purpose', text: '선택한 여행들의 검수 완료 지출 규모를 비교합니다.' }),
      ), results,
    ), categories,
  );
  for (const input of [period, search, startDate, endDate]) input.setAttribute('aria-controls', 'stats-travel-results');
  for (const input of [startDate, endDate]) input.setAttribute('aria-describedby', 'travel-period-error');
  const reset = el('button', { class: 'btn', type: 'button', text: '조건 해제',
    onclick: () => {
      filters.period = 'all'; filters.query = '';
      delete filters.customStart; delete filters.customEnd;
      period.value = 'all'; search.value = '';
      drawResults();
    },
  });

  function drawResults(): void {
    const months = filters.period === 'year' ? 12 : filters.period === '3months' ? 3 : 1;
    const custom = filters.period === 'custom';
    startDate.value = filters.period === 'all' ? allStart
      : custom ? filters.customStart ?? periodStart(today, 12) : periodStart(today, months);
    endDate.value = filters.period === 'all' ? allEnd : custom ? filters.customEnd ?? todayValue : todayValue;
    dateFields.disabled = !custom;
    if (!custom) { closeStartCalendar?.(); closeEndCalendar?.(); }
    const start = startDate.value;
    const end = endDate.value;
    const error = !custom ? '' : !start || !end ? '시작일과 종료일을 모두 선택하세요.'
      : start > end ? '종료일은 시작일과 같거나 이후여야 합니다.' : '';
    periodError.textContent = error;
    periodError.hidden = !error;
    startDate.setAttribute('aria-invalid', String(custom && !start));
    endDate.setAttribute('aria-invalid', String(custom && (!end || start > end)));
    const query = normalizeName(filters.query);
    const visible = summaries.filter(({ trip }) =>
      !error && (filters.period === 'all' || (trip.startDate <= end && trip.endDate >= start)) && normalizeName(trip.name).includes(query));
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
        el('h4', { class: 'stats-chart-currency', text: `${currency} 기준` }),
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
    if (error) {
      results.replaceChildren(emptyState('조회 기간을 확인하세요.'));
    } else if (registeredTripCount < 2) {
      results.replaceChildren(emptyState('여행이 2개 이상 등록되면 지출을 비교할 수 있습니다.'));
    } else if (visible.length === 0) {
      results.appendChild(emptyState('조건에 맞는 여행이 없습니다.', '기간을 바꾸거나 여행 이름을 지워 보세요.'));
    }
    categories.replaceChildren(renderCategories(visible.map(row => row.trip)));
    results.scrollTop = 0;
  }

  period.addEventListener('change', () => {
    if (period.value === 'custom') {
      filters.customStart ??= startDate.value || periodStart(today, 12);
      filters.customEnd ??= endDate.value || todayValue;
    }
    filters.period = period.value as TravelFilters['period']; drawResults();
  });
  for (const input of [startDate, endDate]) input.addEventListener('input', () => {
    if (filters.period !== 'custom') return;
    filters.customStart = startDate.value; filters.customEnd = endDate.value;
    drawResults();
  });
  search.addEventListener('input', () => { filters.query = search.value; drawResults(); });
  section.append(
    el('div', { class: 'stats-travel-controls' }, periodField, dateFields, searchField, reset),
    periodError, status, sharedResults,
  );
  drawResults();
  return section;
}
