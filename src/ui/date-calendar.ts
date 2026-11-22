/** 선택된 날짜를 바꾸지 않고 원하는 달에서 열 수 있는 날짜 달력. */
import { el } from './dom.ts';

function readDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function moveMonth(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + offset);
  const last = new Date(next);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()));
  return next;
}

function calendarIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true',
  })) svg.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z');
  svg.append(path);
  return svg;
}

/** 기존 date 입력을 유지한다. 필요한 화면은 입력 클릭으로도 달력을 열 수 있다. 반환값은 닫기 함수다. */
export function attachDateCalendar(
  input: HTMLInputElement, anchorDate: () => string,
  options: { label?: string; openOnClick?: boolean } = {},
): (() => void) | undefined {
  // Popover 미지원 환경은 기존 브라우저 날짜 입력을 그대로 사용한다.
  if (typeof HTMLElement.prototype.showPopover !== 'function') return;

  const label = options.label ?? '종료일';
  const id = `${input.id}-calendar`;
  const title = el('strong', { id: `${id}-title`, 'aria-live': 'polite' });
  const body = el('tbody');
  const selectedLabel = el('span', { class: 'field-hint' });
  const grid = el('table', { class: 'date-calendar-grid', role: 'grid' },
    el('thead', {}, el('tr', {},
      ...['일', '월', '화', '수', '목', '금', '토'].map(day => el('th', { scope: 'col', text: day })),
    )),
    body,
  );
  const trigger = el('button', {
    class: 'date-calendar-trigger', type: 'button', 'aria-label': `${label} 달력 열기`,
    'aria-haspopup': 'dialog', 'aria-controls': id, 'aria-expanded': 'false',
    popovertarget: id, popovertargetaction: 'toggle',
  }, calendarIcon());
  const popup = el('div', {
    id, class: 'date-calendar', popover: 'auto', role: 'dialog', 'aria-labelledby': `${id}-title`,
  },
    el('div', { class: 'date-calendar-head' },
      el('button', { class: 'btn tiny', type: 'button', 'aria-label': '이전 달',
        onclick: () => { focused = moveMonth(focused, -1); draw(); position(); } }, '‹'),
      title,
      el('button', { class: 'btn tiny', type: 'button', 'aria-label': '다음 달',
        onclick: () => { focused = moveMonth(focused, 1); draw(); position(); } }, '›'),
    ),
    grid,
    el('div', { class: 'date-calendar-foot' },
      selectedLabel,
      el('button', { class: 'btn tiny', type: 'button', onclick: () => close(true) }, '닫기'),
    ),
  );

  let focused = new Date();
  let open = false;
  let listeners: AbortController | null = null;
  const wrap = el('div', { class: 'date-calendar-input' });
  input.before(wrap);
  input.classList.add('date-calendar-value');
  wrap.append(input, trigger, popup);

  function close(restoreFocus = false): void {
    if (open) popup.hidePopover();
    open = false;
    trigger.setAttribute('aria-expanded', 'false');
    listeners?.abort();
    listeners = null;
    if (restoreFocus) input.focus();
  }

  function position(): void {
    if (!open) return;
    const rect = wrap.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12));
    const below = rect.bottom + 6;
    const top = below + box.height <= window.innerHeight - 12
      ? below : Math.max(12, rect.top - box.height - 6);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function focusDay(): void {
    popup.querySelector<HTMLButtonElement>('button[data-date][tabindex="0"]')?.focus();
  }

  function draw(): void {
    const year = focused.getUTCFullYear();
    const month = focused.getUTCMonth();
    const monthName = `${year}년 ${month + 1}월`;
    title.textContent = monthName;
    grid.setAttribute('aria-label', monthName);
    selectedLabel.textContent = input.value ? `현재 ${label}: ${input.value}` : '날짜를 선택하세요.';
    const first = new Date(focused);
    first.setUTCDate(1);
    const last = new Date(first);
    last.setUTCMonth(month + 1, 0);
    const weeks: HTMLTableRowElement[] = [];
    const start = readDate(anchorDate());
    const today = dateValue(new Date());
    for (let slot = 0; slot < first.getUTCDay() + last.getUTCDate(); slot++) {
      if (slot % 7 === 0) weeks.push(el('tr'));
      const week = weeks[weeks.length - 1]!;
      const day = slot - first.getUTCDay() + 1;
      if (day < 1) { week.append(el('td')); continue; }
      const date = new Date(first);
      date.setUTCDate(day);
      const value = dateValue(date);
      const selected = value === input.value;
      const cell = el('td', { 'aria-selected': String(selected) });
      cell.append(el('button', {
        class: 'date-calendar-day' + (selected ? ' selected' : '') +
          (start && value === dateValue(start) ? ' trip-start' : ''),
        type: 'button', text: String(day), 'data-date': value,
        'aria-label': `${year}년 ${month + 1}월 ${day}일`,
        'aria-current': value === today ? 'date' : undefined,
        tabindex: value === dateValue(focused) ? '0' : '-1',
        onclick: () => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close(true);
        },
      }));
      week.append(cell);
    }
    const tail = weeks.at(-1);
    while (tail && tail.children.length < 7) tail.append(el('td'));
    body.replaceChildren(...weeks);
  }

  function show(): void {
    if (input.matches(':disabled')) return;
    if (open) { close(); return; }
    // 표시할 달만 시작일에 맞춘다. input.value는 날짜를 클릭할 때에만 바꾼다.
    focused = readDate(anchorDate()) ?? readDate(input.value) ?? readDate(dateValue(new Date()))!;
    draw();
    popup.showPopover();
    open = true;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    focusDay();
    listeners?.abort();
    listeners = new AbortController();
    const signal = listeners.signal;
    window.addEventListener('resize', position, { signal });
    window.addEventListener('scroll', position, { capture: true, signal });
    window.addEventListener('hashchange', () => close(), { signal });
  }

  trigger.addEventListener('click', ev => { ev.preventDefault(); show(); });
  if (options.openOnClick) input.addEventListener('click', show);
  input.addEventListener('keydown', ev => {
    if ((ev.altKey && ev.key === 'ArrowDown') || ev.key === 'F4' || ev.key === ' ') {
      ev.preventDefault();
      show();
    }
  });
  popup.addEventListener('beforetoggle', ev => {
    if ((ev as ToggleEvent).newState === 'closed') {
      open = false;
      trigger.setAttribute('aria-expanded', 'false');
      listeners?.abort();
      listeners = null;
    }
  });
  popup.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(true); return; }
    if (!(ev.target instanceof HTMLElement) || !ev.target.matches('button[data-date]')) return;
    let next = new Date(focused);
    switch (ev.key) {
      case 'ArrowLeft': next.setUTCDate(next.getUTCDate() - 1); break;
      case 'ArrowRight': next.setUTCDate(next.getUTCDate() + 1); break;
      case 'ArrowUp': next.setUTCDate(next.getUTCDate() - 7); break;
      case 'ArrowDown': next.setUTCDate(next.getUTCDate() + 7); break;
      case 'Home': next.setUTCDate(next.getUTCDate() - next.getUTCDay()); break;
      case 'End': next.setUTCDate(next.getUTCDate() + 6 - next.getUTCDay()); break;
      case 'PageUp': next = moveMonth(next, ev.shiftKey ? -12 : -1); break;
      case 'PageDown': next = moveMonth(next, ev.shiftKey ? 12 : 1); break;
      default: return;
    }
    ev.preventDefault();
    focused = next;
    draw();
    position();
    focusDay();
  });
  return () => close();
}
