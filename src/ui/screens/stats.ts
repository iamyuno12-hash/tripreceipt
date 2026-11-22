/**
 * P6: 카테고리별 통계 + 전체 여행 월별 지출 추이 + 여행 간 비교 + CSV 다운로드.
 * 여행의 집계 기준 통화별로 표시 범위를 선택한다.
 */
import { el, pageHeader, emptyState } from '../dom.ts';
import { money } from '../format.ts';
import { listTrips } from '../../storage/trips.ts';
import { listAllReceipts } from '../../storage/receipts.ts';
import { buildExpenseCsv, downloadCsv } from '../../export/csv.ts';
import type { Receipt, Trip } from '../../types.ts';
import { isCountable, CATEGORIES } from '../../types.ts';
import { expensesByMonth, summarizeExpenses } from '../../currency.ts';
import { prepareExchangeRates } from '../../exchange.ts';
import { expenseText } from '../exchange-display.ts';
import { CURRENCIES, selectField } from '../form.ts';
import { renderMonthlyChart } from '../monthly-chart.ts';

/** 모든 여행의 검수 완료된 영수증을 모아, 최근 1년 월별 지출을 통화별로 표시한다. */
function renderOverallTrend(trips: readonly Trip[], receipts: readonly Receipt[]): HTMLElement {
  const tripIds = new Set(trips.map(trip => trip.id));
  const eligible = receipts.filter(receipt =>
    tripIds.has(receipt.tripId) && isCountable(receipt),
  );
  const currencies = [...new Set(trips.filter(trip => eligible.some(r => r.tripId === trip.id)).map(trip => trip.currency))].sort();
  const pending = trips.reduce((n, trip) => n + summarizeExpenses(eligible.filter(r => r.tripId === trip.id), trip.currency).pending, 0);

  return el('section', { class: 'stat-section stats-panel', 'aria-labelledby': 'stats-trend-title' },
    el('header', { class: 'stats-panel-header' },
      el('h2', { class: 'section-title stats-panel-title', id: 'stats-trend-title', tabindex: -1,
        text: '월별 지출 추이' }),
      el('p', { class: 'stats-panel-purpose', text: '1년 전부터 이번 달까지, 월별 지출의 흐름을 봅니다.' }),
    ),
    el('p', { class: 'stat-note',
      text: '검수 완료 영수증을 각 여행의 기준 통화로 환산해 합산합니다. 기준 통화가 다른 여행은 구분합니다.' }),
    pending > 0 ? el('p', { class: 'stat-note', text: `환산 대기 ${pending}장이 빠진 부분 집계입니다.` }) : null,
    currencies.length === 0
      ? emptyState('집계할 지출 내역이 없습니다.')
      : el('div', {},
          ...currencies.map(currency => {
            const points = expensesByMonth(trips, eligible, currency);
            return el('div', { style: 'margin-top:20px' },
              el('h3', { text: `${currency} 기준`, style: 'font-size:0.94rem;margin:0 0 10px' }),
              renderMonthlyChart(points, currency),
            );
          }),
        ),
  );
}

/** 기준 통화가 같은 여행끼리만 총지출을 비교한다. */
function renderComparison(
  trips: readonly Trip[], byTrip: ReadonlyMap<string, Receipt[]>, registeredTripCount = trips.length,
): HTMLElement {
  // 표시 필터를 바꿔도 기존 통화별 비교 영역과 막대 값은 유지한다.
  if (registeredTripCount < 2) {
    return el('section', { class: 'stat-section stats-panel', 'aria-labelledby': 'stats-comparison-title' },
      comparisonHeader(),
      emptyState('여행이 2개 이상 등록되면 지출을 비교할 수 있습니다.'),
    );
  }

  const groups = new Map<string, Array<{ name: string; total: number; pending: number; converted: number }>>();
  for (const trip of trips) {
    const eligible = (byTrip.get(trip.id) ?? [])
      .filter(isCountable);
    const summary = summarizeExpenses(eligible, trip.currency);
    const rows = groups.get(trip.currency) ?? [];
    rows.push({ name: trip.name, total: summary.total, pending: summary.pending, converted: summary.converted });
    groups.set(trip.currency, rows);
  }

  return el('section', { class: 'stat-section stats-panel', 'aria-labelledby': 'stats-comparison-title' },
    comparisonHeader(),
    el('p', { class: 'stat-note',
      text: '검수 완료된 영수증을 여행 기준 통화로 환산한 금액입니다. 기준 통화가 다른 여행끼리는 구분합니다.' }),
    ...[...groups.entries()].map(([currency, rows]) => {
      const sorted = [...rows].sort((a, b) => b.total - a.total);
      const max = Math.max(1, ...sorted.map(row => Math.max(0, row.total)));
      return el('div', { style: 'margin-top:16px' },
        el('h3', { text: `${currency} 기준`, style: 'font-size:0.9rem;margin:0 0 8px' }),
        ...sorted.map(row =>
          el('div', { style: 'margin:0 0 12px' },
            el('div', { class: 'stat-head' },
              el('span', { text: row.name, style: 'font-size:0.88rem;overflow-wrap:anywhere' }),
              el('strong', { text: expenseText({ ...row, byCategory: new Map() }, currency), style: 'white-space:nowrap' }),
            ),
            row.pending > 0 ? el('p', { class: 'stat-note', text: `환산 대기 ${row.pending}장 제외` }) : null,
            el('div', { class: 'bar-track', style: 'margin-top:5px' },
              el('div', { class: 'bar-fill', style: `width:${Math.max(0, row.total) / max * 100}%` }),
            ),
          ),
        ),
      );
    }),
  );
}

function comparisonHeader(): HTMLElement {
  return el('header', { class: 'stats-panel-header' },
    el('h2', { class: 'section-title stats-panel-title', id: 'stats-comparison-title', tabindex: -1,
      text: '여행 간 지출 비교' }),
    el('p', { class: 'stats-panel-purpose', text: '여행별 지출 규모를 나란히 비교합니다.' }),
  );
}

function renderTripStatistics(trip: Trip, receipts: readonly Receipt[]): HTMLElement {
  const summary = summarizeExpenses(receipts, trip.currency);
  const byCat = summary.byCategory;
  const categoryTotal = [...byCat.values()].reduce((sum, amount) => sum + amount, 0);
  const max = Math.max(1, ...byCat.values());

  const rows = CATEGORIES
    .map(cat => ({ cat, amount: byCat.get(cat) ?? 0 }))
    .filter(row => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map(({ cat, amount }) => {
      const share = categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0;
      return el('div', { class: 'bar-row' },
        el('span', { class: 'bar-label', text: cat }),
        el('div', { class: 'bar-track' },
          el('div', { class: 'bar-fill', style: `width:${amount / max * 100}%` }),
        ),
        el('span', { class: 'bar-value', text: `${money(amount, trip.currency)} (${share.toFixed(1)}%)` }),
      );
    });

  const excluded = receipts.filter(r => !isCountable(r)).length;
  return el('section', { class: 'stat-section stats-trip-statistics', 'aria-label': trip.name },
    el('div', { class: 'stat-head' },
      el('h3', { class: 'section-title stats-trip-title', text: trip.name }),
      el('span', {
        class: 'stat-total',
        title: '여행 기준 통화로 환산한 영수증 총액 (검수 전 금액 포함)',
        text: expenseText(summary, trip.currency),
      }),
    ),
    rows.length === 0
      ? emptyState('아직 집계할 품목이 없습니다.')
      : el('div', { class: 'bars' }, ...rows),
    excluded > 0
      ? el('p', { class: 'stat-note',
          text: `검수가 필요하거나 아직 인식되지 않은 ${excluded}장은 분류/전체 추이/비교 집계에서 제외했습니다.` })
      : null,
    summary.pending > 0
      ? el('p', { class: 'stat-note',
          text: `환산 대기 ${summary.pending}장은 합계와 통계에서 빠져 있습니다. 해당 영수증 수정 화면에서 환율을 입력하세요. CSV에는 원금액과 대기 상태가 포함됩니다.` })
      : null,
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => downloadCsv(
          buildExpenseCsv([trip], receipts), `tripreceipt-${trip.id}.csv`,
        ),
      }, '이 여행 CSV 내보내기'),
    ),
  );
}

function renderTripCategories(trips: readonly Trip[], byTrip: ReadonlyMap<string, Receipt[]>): HTMLElement {
  return el('section', { class: 'stat-section stats-panel', 'aria-labelledby': 'stats-categories-title' },
    el('header', { class: 'stats-panel-header' },
      el('h2', { class: 'section-title stats-panel-title', id: 'stats-categories-title', tabindex: -1,
        text: '여행별 지출 구성' }),
      el('p', { class: 'stats-panel-purpose', text: '각 여행 안에서 분류별로 얼마를 썼는지 살펴봅니다.' }),
    ),
    el('div', { class: 'stats-trip-list' },
      ...trips.map(trip => renderTripStatistics(trip, byTrip.get(trip.id) ?? [])),
    ),
  );
}

export async function renderStats(): Promise<HTMLElement> {
  const [trips, saved] = await Promise.all([listTrips(), listAllReceipts()]);
  const all = await prepareExchangeRates(trips, saved);

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

  const currencyCounts = new Map<string, number>();
  for (const trip of trips) currencyCounts.set(trip.currency, (currencyCounts.get(trip.currency) ?? 0) + 1);
  const currencyLabels = new Map(CURRENCIES);
  const availableCurrencies = [...currencyCounts.keys()].sort((a, b) =>
    (currencyCounts.get(b) ?? 0) - (currencyCounts.get(a) ?? 0) || a.localeCompare(b));
  const filter = selectField('표시 통화', 'statsCurrency', [
    ['', '전체 통화'],
    ...availableCurrencies.map(currency => [currency, currencyLabels.get(currency) ?? currency] as const),
  ], '');
  filter.classList.add('stats-currency-filter');
  const select = filter.querySelector<HTMLSelectElement>('select')!;
  select.setAttribute('aria-describedby', 'stats-currency-hint');
  select.setAttribute('aria-controls', 'stats-results');
  filter.appendChild(el('span', { class: 'field-hint', id: 'stats-currency-hint',
    text: '여행의 집계 기준 통화로 구분합니다.' }));
  const selectionStatus = el('p', { class: 'stat-note', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { id: 'stats-results' });

  function drawStatistics(): void {
    const currency = select.value;
    const visibleTrips = currency ? trips.filter(trip => trip.currency === currency) : trips;
    const visibleIds = new Set(visibleTrips.map(trip => trip.id));
    const visibleReceipts = all.filter(receipt => visibleIds.has(receipt.tripId));
    selectionStatus.textContent = `${currency ? `${currency} 기준` : '전체 통화'} · 여행 ${visibleTrips.length}개`;
    results.replaceChildren(
      renderOverallTrend(visibleTrips, visibleReceipts),
      renderComparison(visibleTrips, byTrip, trips.length),
      renderTripCategories(visibleTrips, byTrip),
    );
  }
  select.addEventListener('change', drawStatistics);
  drawStatistics();

  const page = el('div', { class: 'stats-page' });
  const navigation = el('nav', { class: 'stats-jump', 'aria-label': '통계 영역 바로가기' },
    el('span', { class: 'stats-jump-label', text: '바로가기' }),
    ...[
      ['stats-trend-title', '월별 추이'],
      ['stats-comparison-title', '여행 비교'],
      ['stats-categories-title', '여행별 지출 구성'],
    ].map(([id, label]) => el('button', {
      class: 'btn tiny', type: 'button', 'aria-controls': id, 'aria-label': `${label} 영역으로 이동`,
      onclick: () => {
        // 해시 라우터의 주소와 통화 선택은 유지한 채 해당 영역으로 이동한다.
        const heading = page.querySelector<HTMLElement>(`#${id}`);
        if (!heading) return;
        const section = heading.closest('section');
        if (!section) return;
        // 좁은 화면에서 바로가기 행이 줄바꿈되어도 제목을 가리지 않는다.
        section.style.scrollMarginTop = `${navigation.getBoundingClientRect().height + 16}px`;
        section.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
      },
    }, label)),
  );

  page.append(
    pageHeader('통계', '월별 지출의 흐름과 여행별·카테고리별 지출을 확인합니다.'),
    el('div', { class: 'stats-export' },
      el('button', {
        class: 'btn primary', type: 'button',
        onclick: () => downloadCsv(buildExpenseCsv(trips, all), 'tripreceipt-all.csv'),
      }, '전체 CSV 내보내기'),
      el('p', { class: 'stats-export-note',
        text: '전체 CSV는 표시 통화와 관계없이 모든 여행을 포함합니다. 사진은 포함되지 않습니다.' }),
    ),
    filter,
    selectionStatus,
    navigation,
    results,
  );
  return page;
}
