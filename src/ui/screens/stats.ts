/**
 * P6: 카테고리별 통계 + 전체 여행 월별 지출 추이 + 여행 간 비교 + CSV 다운로드.
 * src/ui/screens/stats.ts 를 이 파일로 교체한다.
 * 기존 CSS(.bars, .bar-row, .bar-track 등)를 재사용한다.
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

/** 숫자를 비교하기 쉬운 막대로 표시한다. */
function amountBars(
  data: ReadonlyArray<{ label: string; amount: number; title?: string }>,
  currency: string,
): HTMLElement {
  if (data.length === 0) return emptyState('표시할 지출 내역이 없습니다.');
  const max = Math.max(1, ...data.map(row => Math.max(0, row.amount)));
  return el('div', { class: 'bars' },
    ...data.map(({ label, amount, title }) =>
      el('div', { class: 'bar-row' },
        el('span', { class: 'bar-label', text: label, title: title ?? label }),
        el('div', { class: 'bar-track' },
          el('div', { class: 'bar-fill', style: `width:${Math.max(0, amount) / max * 100}%` }),
        ),
        el('span', { class: 'bar-value', text: money(amount, currency) }),
      ),
    ),
  );
}

/** 모든 여행의 검수 완료된 영수증을 모아, 최근 1년 월별 지출을 통화별로 표시한다. */
function renderOverallTrend(trips: readonly Trip[], receipts: readonly Receipt[]): HTMLElement {
  const tripIds = new Set(trips.map(trip => trip.id));
  const eligible = receipts.filter(receipt =>
    tripIds.has(receipt.tripId) && isCountable(receipt),
  );
  const currencies = [...new Set(trips.filter(trip => eligible.some(r => r.tripId === trip.id)).map(trip => trip.currency))].sort();
  const pending = trips.reduce((n, trip) => n + summarizeExpenses(eligible.filter(r => r.tripId === trip.id), trip.currency).pending, 0);

  return el('section', { class: 'stat-section' },
    el('h2', { class: 'section-title', text: '전체 월별 지출 추이 (1년 전 ~ 이번 달)' }),
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
              amountBars(
                points.map(({ key, amount }) => ({
                  label: key.replace('-', '.'),
                  title: key,
                  amount,
                })),
                currency,
              ),
            );
          }),
        ),
  );
}

/** 기준 통화가 같은 여행끼리만 총지출을 비교한다. */
function renderComparison(trips: readonly Trip[], byTrip: ReadonlyMap<string, Receipt[]>): HTMLElement {
  if (trips.length < 2) {
    return el('section', { class: 'stat-section' },
      el('h2', { class: 'section-title', text: '여행 간 지출 비교' }),
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

  return el('section', { class: 'stat-section' },
    el('h2', { class: 'section-title', text: '여행 간 지출 비교' }),
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

  const sections = trips.map((trip) => {
    const receipts = byTrip.get(trip.id) ?? [];
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
    return el('section', { class: 'stat-section' },
      el('div', { class: 'stat-head' },
        el('h2', { class: 'section-title', text: trip.name }),
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
  });

  return el('div', {},
    pageHeader('통계', '전체 월별 지출 추이와 여행별·카테고리별 지출을 확인합니다.'),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary', type: 'button',
        onclick: () => downloadCsv(buildExpenseCsv(trips, all), 'tripreceipt-all.csv'),
      }, '전체 CSV 내보내기'),
    ),
    renderOverallTrend(trips, all),
    renderComparison(trips, byTrip),
    ...sections,
  );
}
