/** 표시용 포맷 함수 모음. 화면 여러 곳에서 공유한다. */

/** 통화 표시. JPY 처럼 소수점이 없는 통화를 자동 처리한다. */
export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'KRW' || currency === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('ko-KR')} ${currency}`;
  }
}

/** 2026-04-11 -> 4월 11일 */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 2026-04-11T12:40 -> 4월 11일 12:40 */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${shortDate(iso)} ${hh}:${mm}`;
}

/** 4월 11일 ~ 4월 14일 */
export function dateRange(start: string, end: string): string {
  return `${shortDate(start)} ~ ${shortDate(end)}`;
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
