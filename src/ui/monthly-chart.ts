/** 월별 집계값을 유지하면서 통화별 세로 막대 그래프를 그린다. */
import { currencyDigits } from '../currency.ts';
import { el, emptyState } from './dom.ts';
import { money } from './format.ts';

interface MonthlyPoint {
  readonly key: string;
  readonly amount: number;
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {}, text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 통화의 최소 단위로 눈금을 정해 0·소수·음수에서도 축을 유지한다. */
export function renderMonthlyChart(points: readonly MonthlyPoint[], currency: string): HTMLElement {
  if (points.length === 0) return emptyState('표시할 지출 내역이 없습니다.');

  const digits = currencyDigits(currency);
  const scale = 10 ** digits;
  const units = points.map(point => Math.round(point.amount * scale));
  const min = Math.min(0, ...units);
  let max = Math.max(0, ...units);
  if (min === max) max = 4;
  const roughStep = Math.max(1, (max - min) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const factor = [1, 2, 5, 10].find(value => value * magnitude >= roughStep)!;
  const step = Math.ceil(factor * magnitude);
  const firstTick = Math.floor(min / step);
  const lastTick = Math.ceil(max / step);
  const low = firstTick * step;
  const high = lastTick * step;

  // 가로는 비율, 세로는 px로 두어 영역 폭에 맞추면서 글자와 높이는 유지한다.
  const height = 220, left = 7.5, right = 2.5, top = 16, bottom = 44;
  const plotHeight = height - top - bottom;
  const columnWidth = (100 - left - right) / points.length;
  const y = (value: number): number => top + (high - value) / (high - low) * plotHeight;
  const zero = y(0);
  const axisFormat = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: digits });
  const chart = svgNode('svg', {
    class: 'monthly-chart-svg', height, role: 'group',
    'aria-label': `${currency} 기준 월별 지출. 가로축은 연도·월, 세로축은 금액입니다. 막대에 마우스를 올리거나 키보드 초점을 옮기면 금액이 표시됩니다.`,
  });

  const tooltip = svgNode('g', { class: 'monthly-chart-tooltip', visibility: 'hidden', 'aria-hidden': 'true' });
  const tooltipBox = svgNode('rect', { height: 48, rx: 6 });
  const tooltipMonth = svgNode('text', { class: 'monthly-chart-tooltip-month', x: 12, y: 17 });
  const tooltipAmount = svgNode('text', { class: 'monthly-chart-tooltip-amount', x: 12, y: 36 });
  tooltip.append(tooltipBox, tooltipMonth, tooltipAmount);
  let hovered: number | null = null;
  let focused: number | null = null;

  function updateTooltip(): void {
    const index = hovered ?? focused;
    if (index === null) {
      tooltip.setAttribute('visibility', 'hidden');
      return;
    }
    const point = points[index]!;
    tooltipMonth.textContent = point.key.replace('-', '.');
    tooltipAmount.textContent = money(point.amount, currency);
    tooltip.setAttribute('visibility', 'visible');
    const textWidth = Math.max(tooltipMonth.getComputedTextLength(), tooltipAmount.getComputedTextLength());
    const width = chart.clientWidth || chart.getBoundingClientRect().width || 960;
    const boxWidth = Math.min(width - 16, Math.max(140, textWidth + 24));
    tooltipBox.setAttribute('width', String(boxWidth));
    const center = width * (left + columnWidth * (index + 0.5)) / 100;
    const tooltipX = Math.max(8, Math.min(width - boxWidth - 8, center - boxWidth / 2));
    const tooltipY = Math.max(top, Math.min(zero, y(units[index]!)) - 56);
    tooltip.setAttribute('transform', `translate(${tooltipX} ${tooltipY})`);
  }

  for (let tick = firstTick; tick <= lastTick; tick++) {
    const value = tick * step;
    const tickY = y(value);
    chart.appendChild(svgNode('line', {
      class: value === 0 ? 'monthly-chart-grid monthly-chart-zero' : 'monthly-chart-grid',
      x1: `${left}%`, x2: `${100 - right}%`, y1: tickY, y2: tickY,
    }));
    const label = svgNode('text', { class: 'monthly-chart-tick', x: `${left - 1.2}%`, y: tickY + 4, 'text-anchor': 'end' },
      axisFormat.format(value / scale));
    label.appendChild(svgNode('title', {}, money(value / scale, currency)));
    chart.appendChild(label);
  }

  points.forEach((point, index) => {
    const value = units[index]!;
    const center = left + columnWidth * (index + 0.5);
    const barWidth = columnWidth * 0.5;
    const month = point.key.replace('-', '.');
    const group = svgNode('g', { class: 'monthly-chart-month', 'data-month': point.key, 'data-amount': point.amount,
      tabindex: 0, role: 'img', 'aria-label': `${month} · ${money(point.amount, currency)}` });
    group.append(
      // 0인 달도 마우스를 올려 금액을 확인할 수 있도록 열 전체를 대상으로 둔다.
      svgNode('rect', { class: 'monthly-chart-hit', x: `${center - columnWidth / 2}%`, y: top,
        width: `${columnWidth}%`, height: plotHeight }),
      svgNode('rect', { class: 'monthly-chart-bar', x: `${center - barWidth / 2}%`, y: Math.min(zero, y(value)),
        width: `${barWidth}%`, height: Math.abs(zero - y(value)), rx: 2 }),
    );
    if (value === 0) group.appendChild(svgNode('line', {
      class: 'monthly-chart-zero-mark', x1: `${center - 0.5}%`, x2: `${center + 0.5}%`, y1: zero, y2: zero,
    }));
    group.appendChild(svgNode('text', {
      class: 'monthly-chart-month-label', x: `${center}%`, y: height - 24, 'text-anchor': 'middle',
    }, month));
    group.addEventListener('pointerenter', () => { hovered = index; updateTooltip(); });
    group.addEventListener('pointerleave', () => { if (hovered === index) hovered = null; updateTooltip(); });
    group.addEventListener('focus', () => { focused = index; updateTooltip(); });
    group.addEventListener('blur', () => { if (focused === index) focused = null; updateTooltip(); });
    group.addEventListener('click', () => { group.focus(); focused = index; updateTooltip(); });
    group.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hovered = null; focused = null; updateTooltip(); }
    });
    chart.appendChild(group);
  });
  // 마지막에 그려 막대 앞에 표시하고, 툴팁이 마우스 입력을 가로채지 않게 한다.
  chart.appendChild(tooltip);

  return el('figure', { class: 'monthly-chart' },
    el('figcaption', { class: 'monthly-chart-caption', text: `금액 (${currency}) · 가로축: 연도·월` }),
    el('div', { class: 'monthly-chart-viewport', tabindex: 0, role: 'region',
      'aria-label': `${currency} 월별 지출 그래프` }, chart),
  );
}
