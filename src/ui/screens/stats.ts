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
import { expensesByMonth, paymentDate, summarizeExpenses, sumMoney } from '../../currency.ts';
import { prepareExchangeRates } from '../../exchange.ts';
import { expenseText } from '../exchange-display.ts';
import { CURRENCIES, selectField } from '../form.ts';
import { renderMonthlyChart } from '../monthly-chart.ts';
import { renderTravelStatistics, type TravelFilters } from '../trip-comparison.ts';

const STATS_JUMP_GAP = 16;
const CATEGORY_TRIP_LIMIT = 3;

function markCurrentSection(navigation: HTMLElement, chart: string | undefined): void {
  for (const button of navigation.querySelectorAll<HTMLButtonElement>('.stats-jump-link')) {
    if (button.dataset.chart === chart) {
      if (!button.hasAttribute('aria-current')) button.setAttribute('aria-current', 'location');
    } else button.removeAttribute('aria-current');
  }
}

function visibleSection(results: HTMLElement, navigationBottom: number): string | undefined {
  const viewportBottom = window.innerHeight;
  const atPageEnd = window.scrollY > 0 &&
    window.scrollY + viewportBottom >= document.documentElement.scrollHeight - 1;
  let chart: string | undefined;
  for (const section of results.querySelectorAll<HTMLElement>('section[data-chart]')) {
    const { top, bottom } = section.getBoundingClientRect();
    if (bottom <= navigationBottom || top >= viewportBottom) continue;
    // 마지막 섹션이 짧으면 바로가기 아래까지 올라오지 못해도 현재 영역으로 표시한다.
    if (atPageEnd || top <= navigationBottom + STATS_JUMP_GAP || chart === undefined) chart = section.dataset.chart;
  }
  return chart;
}

export function watchStatsSections(page: HTMLElement): (() => void) | undefined {
  const navigation = page.querySelector<HTMLElement>('.stats-jump');
  const results = page.querySelector<HTMLElement>('#stats-results');
  if (!navigation || !results) return;

  let frame: number | undefined;
  let focusChanged = false;
  const update = (): void => {
    frame = undefined;
    const focusedChart = focusChanged && results.contains(document.activeElement)
      ? document.activeElement?.closest<HTMLElement>('section[data-chart]')?.dataset.chart
      : undefined;
    markCurrentSection(navigation, focusedChart ?? visibleSection(results, navigation.getBoundingClientRect().bottom));
    focusChanged = false;
  };
  const schedule = (): void => {
    frame ??= window.requestAnimationFrame(update);
  };
  const handleFocus = (): void => {
    // 초점 이동 때문에 스크롤이 함께 일어나면 이 프레임에서는 초점이 들어간 영역을 우선한다.
    focusChanged = true;
    schedule();
  };

  const tripLimits = new Map<HTMLElement, HTMLElement>();
  const fitTripLists = (): void => {
    for (const [list, lastTrip] of tripLimits) {
      const height = lastTrip.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop;
      const limit = `${Math.ceil(height)}px`;
      if (list.style.getPropertyValue('--stats-list-height') !== limit) {
        list.style.setProperty('--stats-list-height', limit);
      }
    }
  };
  const resize = new ResizeObserver(() => {
    fitTripLists();
    schedule();
  });
  const observeResults = (): void => {
    tripLimits.clear();
    resize.disconnect();
    resize.observe(navigation);
    resize.observe(results);
    for (const list of results.querySelectorAll<HTMLElement>('[data-trip-limit]')) {
      const firstTrips = Array.from(list.querySelectorAll<HTMLElement>('[data-trip-id]'))
        .slice(0, Number(list.dataset.tripLimit));
      const lastTrip = firstTrips.at(-1);
      if (!lastTrip) continue;
      tripLimits.set(list, lastTrip);
      resize.observe(list);
      for (const trip of firstTrips) resize.observe(trip);
    }
    fitTripLists();
  };
  const content = new window.MutationObserver(changes => {
    if (!changes.some(({ target }) => target === results ||
      target instanceof HTMLElement && target.matches('.stats-comparison-results, .stats-categories-content'))) return;
    observeResults();
    schedule();
  });
  content.observe(results, { childList: true, subtree: true });
  observeResults();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  results.addEventListener('focusin', handleFocus);
  update();

  return () => {
    content.disconnect();
    resize.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    results.removeEventListener('focusin', handleFocus);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
}

/** 화면별 금액의 의미와 상태별 제외 기준은 이 안내 한 곳에서 설명한다. */
function statisticsGuide(): HTMLElement {
  return el('div', { class: 'registration-help stats-help' },
    el('button', { class: 'registration-help-trigger', type: 'button', text: '?',
      'aria-label': '통계 집계 기준', 'aria-describedby': 'stats-accounting-tooltip' }),
    el('aside', { class: 'registration-guide registration-tooltip stats-accounting-guide',
      id: 'stats-accounting-tooltip', role: 'tooltip' },
      el('strong', { text: '통계 집계 기준' }),
      el('p', { class: 'stats-accounting-intro',
        text: '월별 추이·여행 비교는 영수증 총액, 분류별 구성은 품목 금액을 합산합니다. 금액은 각 여행의 기준 통화로 환산하며, 기준 통화가 다른 여행끼리는 합산하지 않습니다.' }),
      el('dl', { class: 'guide-status-list' },
        el('div', { class: 'guide-status-row' },
          el('dt', {},
            el('span', { class: 'status status-parsed guide-status-tag', text: '인식 완료' }),
            el('span', { class: 'status status-confirmed guide-status-tag', text: '확인됨' }),
          ),
          el('dd', { text: '월별 추이·여행 비교·분류 합계에 포함됩니다.' }),
        ),
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'status status-needs_review guide-status-tag', text: '검수 필요' })),
          el('dd', { text: '여행 목록·상세의 총지출과 아래 영수증 총액에는 포함하지만, 월별 추이·여행 비교·분류 합계에서는 제외합니다.' }),
        ),
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'status status-pending guide-status-tag', text: '인식 대기' })),
          el('dd', { text: '품목·금액을 아직 저장하지 않은 상태로, 총지출과 통계에서 제외합니다.' }),
        ),
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'badge warn guide-status-tag', text: '환산 대기' })),
          el('dd', { text: '여행 기준 통화의 환율이 없어 총지출과 통계에서 제외합니다. 영수증 수정 화면에서 환율을 입력하거나 조회하세요. 검수 상태와 별개이므로 다른 상태와 함께 표시될 수 있습니다.' }),
        ),
      ),
      el('p', { class: 'stats-accounting-note',
        text: '분류 비율은 분류 합계 기준입니다. 확인된 영수증도 품목 합계와 총액이 다르면 두 합계는 다를 수 있습니다.' }),
    ),
  );
}

function statisticsHeader(trips: readonly Trip[], receipts: readonly Receipt[]): HTMLElement {
  const header = pageHeader('통계');
  header.append(el('div', { class: 'stats-intro' },
    el('p', { class: 'subtitle', text: '월별 지출의 흐름과 여행별·카테고리별 지출을 확인합니다.' }),
    statisticsGuide(),
  ));
  return el('div', { class: 'stats-heading' }, header, exportAction(trips, receipts));
}

/** 모든 여행의 검수 완료된 영수증을 모아, 최근 1년 월별 지출을 통화별로 표시한다. */
function renderOverallTrend(
  trips: readonly Trip[], receipts: readonly Receipt[], currencyOrder: readonly string[],
): HTMLElement {
  const tripIds = new Set(trips.map(trip => trip.id));
  const eligible = receipts.filter(receipt =>
    receipt.tripId !== null && tripIds.has(receipt.tripId) && isCountable(receipt),
  );
  const eligibleTripIds = new Set(eligible.map(receipt => receipt.tripId));
  const eligibleCurrencies = new Set(trips.filter(trip => eligibleTripIds.has(trip.id)).map(trip => trip.currency));
  const currencies = currencyOrder.filter(currency => eligibleCurrencies.has(currency));
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const firstMonth = monthKey(first);
  const lastMonth = monthKey(today);
  const inRange = eligible.filter(receipt => {
    const month = paymentDate(receipt.purchasedAt).slice(0, 7);
    return month >= firstMonth && month <= lastMonth;
  });
  const pending = trips.reduce((n, trip) => n + summarizeExpenses(inRange.filter(r => r.tripId === trip.id), trip.currency).pending, 0);

  return el('section', { class: 'stat-section stats-panel', 'data-chart': 'trend', 'aria-labelledby': 'stats-trend-title' },
    el('header', { class: 'stats-panel-header' },
      el('h2', { class: 'section-title stats-panel-title', id: 'stats-trend-title', tabindex: -1,
        text: '월별 지출 추이' }),
      el('p', { class: 'stats-panel-purpose', text: '1년 전부터 이번 달까지, 월별 지출의 흐름을 봅니다.' }),
    ),
    pending > 0 ? el('p', { class: 'stat-note', text: `표시 기간 내 환산 대기 ${pending}장 제외 · 부분 집계` }) : null,
    currencies.length === 0
      ? emptyState('집계할 지출 내역이 없습니다.')
      : el('div', {},
          ...currencies.map(currency => {
            const points = expensesByMonth(trips, eligible, currency, today);
            return el('div', { class: 'stats-monthly-group' },
              el('h3', { class: 'stats-chart-currency', text: `${currency} 기준` }),
              renderMonthlyChart(points, currency),
            );
          }),
        ),
  );
}

function renderTripStatistics(trip: Trip, receipts: readonly Receipt[]): HTMLElement {
  const summary = summarizeExpenses(receipts, trip.currency);
  const counted = summarizeExpenses(receipts.filter(isCountable), trip.currency);
  const byCat = counted.byCategory;
  const categoryTotal = sumMoney([...byCat.values()], trip.currency);
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

  const reviewCount = receipts.filter(r => r.status === 'needs_review').length;
  const pendingCount = receipts.filter(r => r.status === 'pending').length;
  return el('section', { class: 'stat-section stats-trip-statistics', 'aria-label': trip.name, 'data-trip-id': trip.id },
    el('div', { class: 'stat-head' },
      el('h4', { class: 'section-title stats-trip-title', text: trip.name }),
      el('div', { class: 'stats-trip-totals' },
        el('div', { class: 'stats-trip-total' },
          el('span', { class: 'stats-total-label', text: '분류 합계' }),
          el('strong', { class: 'stat-total stats-category-total',
            text: expenseText({ ...counted, total: categoryTotal }, trip.currency) }),
        ),
        el('div', { class: 'stats-trip-total stats-trip-total-secondary' },
          el('span', { class: 'stats-total-label', text: '영수증 총액' }),
          el('span', { class: 'stats-receipt-total', text: expenseText(summary, trip.currency) }),
        ),
      ),
    ),
    reviewCount > 0 || pendingCount > 0 || summary.pending > 0
      ? el('div', { class: 'stats-status-counts', 'aria-label': '집계 참고 상태' },
          reviewCount > 0 ? el('span', { class: 'status status-needs_review', text: `검수 필요 ${reviewCount}장` }) : null,
          pendingCount > 0 ? el('span', { class: 'status status-pending', text: `인식 대기 ${pendingCount}장` }) : null,
          summary.pending > 0 ? el('span', { class: 'badge warn', text: `환산 대기 ${summary.pending}장` }) : null,
        )
      : null,
    rows.length === 0
      ? emptyState('아직 집계할 품목이 없습니다.')
      : el('div', { class: 'bars' }, ...rows),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn tiny', type: 'button',
        onclick: () => downloadCsv(
          buildExpenseCsv([trip], receipts), `tripreceipt-${trip.id}.csv`,
        ),
      }, '이 여행 CSV 내보내기'),
    ),
  );
}

function renderTripCategories(trips: readonly Trip[], byTrip: ReadonlyMap<string, Receipt[]>): HTMLElement {
  const scrollable = trips.length > CATEGORY_TRIP_LIMIT;
  return el('section', { class: 'stats-categories', 'data-chart': 'categories', 'aria-labelledby': 'stats-categories-title' },
    el('header', { class: 'stats-panel-header' },
      el('h3', { class: 'section-title stats-panel-title', id: 'stats-categories-title', tabindex: -1,
        text: '여행별 지출 구성' }),
      el('p', { class: 'stats-panel-purpose', text: '분류 합계는 검수 필요를 뺀 품목 금액, 영수증 총액은 검수 필요를 포함한 총액이므로 서로 다를 수 있습니다.' }),
    ),
    trips.length === 0
      ? emptyState('조건에 맞는 여행이 없습니다.', '기간을 바꾸거나 여행 이름을 지워 보세요.')
      : el('div', { class: 'stats-trip-list', 'data-trip-limit': scrollable ? CATEGORY_TRIP_LIMIT : undefined,
          role: scrollable ? 'region' : undefined, 'aria-label': scrollable ? '여행별 지출 구성 목록' : undefined,
          tabindex: scrollable ? 0 : undefined },
          ...trips.map(trip => renderTripStatistics(trip, byTrip.get(trip.id) ?? [])),
        ),
  );
}

function exportAction(trips: readonly Trip[], receipts: readonly Receipt[]): HTMLElement {
  return el('div', { class: 'stats-export' },
    el('button', { class: 'btn stats-export-button', type: 'button', 'aria-describedby': 'stats-export-note',
      onclick: () => downloadCsv(buildExpenseCsv(trips, receipts), 'tripreceipt-all.csv'),
    }, '전체 CSV 내보내기'),
    el('p', { class: 'stats-export-note', id: 'stats-export-note',
      text: '필터와 관계없이 모든 여행·미지정 영수증을 내보냅니다. 사진은 제외됩니다.' }),
  );
}

export async function renderStats(): Promise<HTMLElement> {
  const [trips, saved] = await Promise.all([listTrips(), listAllReceipts()]);
  const all = await prepareExchangeRates(trips, saved);
  const unassignedCount = all.filter(receipt => receipt.tripId === null).length;
  const unassignedNote = unassignedCount ? el('p', { class: 'stat-note stats-unassigned-note',
    text: `* 여행 미지정 ${unassignedCount}장은 여행에 지정하기 전까지 통계에서 제외됩니다.` }) : null;

  if (trips.length === 0) {
    return el('div', { class: 'stats-page' },
      statisticsHeader(trips, all),
      unassignedNote,
      emptyState('집계할 여행이 없습니다.', '여행 미지정 영수증은 여행에 지정한 뒤 통계에 포함됩니다.'),
      el('a', { class: 'btn', href: '#/' }, '여행으로 이동'),
    );
  }

  const byTrip = new Map<string, Receipt[]>();
  for (const r of all) {
    if (r.tripId === null) continue;
    const list = byTrip.get(r.tripId);
    if (list) list.push(r);
    else byTrip.set(r.tripId, [r]);
  }

  const currencyActivity = new Map<string, { count: number; latestDate: string }>();
  for (const trip of trips) {
    const activity = currencyActivity.get(trip.currency) ?? { count: 0, latestDate: '' };
    activity.count++;
    if (trip.startDate > activity.latestDate) activity.latestDate = trip.startDate;
    for (const receipt of byTrip.get(trip.id) ?? []) {
      if (!isCountable(receipt)) continue;
      const date = paymentDate(receipt.purchasedAt);
      if (date > activity.latestDate) activity.latestDate = date;
    }
    currencyActivity.set(trip.currency, activity);
  }
  const currencyLabels = new Map(CURRENCIES);
  const availableCurrencies = [...currencyActivity]
    .sort(([a, left], [b, right]) => right.count - left.count ||
      right.latestDate.localeCompare(left.latestDate) || a.localeCompare(b))
    .map(([currency]) => currency);
  const filter = selectField('표시 통화', 'statsCurrency', [
    ['', '전체 통화'],
    ...availableCurrencies.map(currency => [currency, currencyLabels.get(currency) ?? currency] as const),
  ], '');
  filter.classList.add('stats-currency-filter');
  const select = filter.querySelector<HTMLSelectElement>('select')!;
  select.setAttribute('aria-describedby', 'stats-currency-hint');
  select.setAttribute('aria-controls', 'stats-results');
  filter.querySelector('label')!.appendChild(el('span', { class: 'stats-currency-hint', id: 'stats-currency-hint',
    text: '여행의 집계 기준 통화로 구분합니다.' }));
  const selectionStatus = el('p', { class: 'stats-selection-status', role: 'status', 'aria-live': 'polite' });
  const scope = el('div', { class: 'stats-scope' }, filter,
    el('div', { class: 'stats-scope-summary' }, selectionStatus, unassignedNote),
  );
  const results = el('div', { id: 'stats-results' });
  const travelFilters: TravelFilters = { period: 'year', query: '' };

  function drawStatistics(): void {
    const currency = select.value;
    const visibleTrips = currency ? trips.filter(trip => trip.currency === currency) : trips;
    const visibleIds = new Set(visibleTrips.map(trip => trip.id));
    const visibleReceipts = all.filter(receipt => receipt.tripId !== null && visibleIds.has(receipt.tripId));
    selectionStatus.textContent = `${currency ? `${currency} 기준` : '전체 통화'} · 여행 ${visibleTrips.length}개`;
    results.replaceChildren(
      renderOverallTrend(visibleTrips, visibleReceipts, availableCurrencies),
      renderTravelStatistics(visibleTrips, byTrip, trips.length, travelFilters,
        selected => renderTripCategories(selected, byTrip)),
    );
  }
  select.addEventListener('change', drawStatistics);
  drawStatistics();

  const page = el('div', { class: 'stats-page' });
  const navigation = el('nav', { class: 'stats-jump', 'aria-label': '통계 영역 바로가기' },
    el('span', { class: 'stats-jump-label', 'aria-hidden': 'true', text: '바로가기' }),
    el('div', { class: 'stats-jump-links' }, ...[
      ['stats-trend-title', '월별 추이', 'trend'],
      ['stats-comparison-title', '여행 비교', 'comparison'],
      ['stats-categories-title', '여행별 지출 구성', 'categories'],
    ].map(([id, label, chart]) => el('button', {
      class: 'stats-jump-link', type: 'button', 'data-chart': chart, 'aria-controls': id, 'aria-label': `${label} 영역으로 이동`,
      onclick: () => {
        // 해시 라우터의 주소와 통화 선택은 유지한 채 해당 영역으로 이동한다.
        const heading = page.querySelector<HTMLElement>(`#${id}`);
        if (!heading) return;
        const section = heading.closest('section');
        if (!section) return;
        // 좁은 화면에서 바로가기 행이 줄바꿈되어도 제목을 가리지 않는다.
        section.style.scrollMarginTop = `${navigation.getBoundingClientRect().height + STATS_JUMP_GAP}px`;
        section.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
        markCurrentSection(navigation, chart);
      },
    }, label))),
  );

  page.append(
    statisticsHeader(trips, all),
    scope,
    navigation,
    results,
  );
  return page;
}
