/** 표시용 포맷 함수 모음. 화면 여러 곳에서 공유한다. */

/** 통화 표시. JPY 처럼 소수점이 없는 통화를 자동 처리한다. */
export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('ko-KR')} ${currency}`;
  }
}

/** 여행 기간처럼 날짜만 있는 값은 시차로 날짜가 바뀌지 않도록 현지 날짜로 읽는다. */
function displayDate(iso: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
}

/** 2026-04-11 -> 2026년 4월 11일 */
export function shortDate(iso: string): string {
  const d = displayDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 2026-04-11T12:40 -> 2026년 4월 11일 12:40 */
export function dateTime(iso: string): string {
  const d = displayDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${shortDate(iso)} ${hh}:${mm}`;
}

/** 2024년 5월 12일 ~ 2025년 5월 8일: 같은 해여도 양쪽 모두 연도를 표시한다. */
export function dateRange(start: string, end: string): string {
  return `${shortDate(start)} ~ ${shortDate(end)}`;
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
