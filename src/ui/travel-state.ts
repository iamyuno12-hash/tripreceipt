/** 직접 펼친 목록과 각 화면에서 보던 위치만 탭 안에서 보관한다. */
export const openTravelGroups = new Set<string>();
const positions = new Map<string, { top: number; receiptId?: string }>();
const receiptOrigins = new Map<string, { path: string; group: string }>();

export function travelPath(tripId: string | null): string {
  return tripId ? `/trips/${encodeURIComponent(tripId)}` : '/unassigned';
}

export function rememberTravelPosition(page: HTMLElement, receiptId?: string): void {
  const row = [...page.querySelectorAll<HTMLElement>('[data-receipt-id]')].find(node => node.dataset.receiptId === receiptId);
  positions.set(page.dataset.pageKey ?? 'travel-home', { top: window.scrollY, receiptId });
  const group = row?.closest<HTMLElement>('[data-travel-group]')?.dataset.travelGroup;
  if (receiptId && group) receiptOrigins.set(receiptId, { path: page.dataset.returnPath ?? '/', group });
}

export function receiptBackPath(receiptId: string, tripId: string | null): string {
  const origin = receiptOrigins.get(receiptId);
  return origin?.group === (tripId ?? 'unassigned') ? origin.path : travelPath(tripId);
}

export function restoreTravelPosition(page: HTMLElement): void {
  const key = page.dataset.pageKey ?? 'travel-home';
  const previous = positions.get(key);
  if (!previous) return;
  window.scrollTo({ top: previous.top });
  const row = [...page.querySelectorAll<HTMLElement>('[data-receipt-id]')].find(node => node.dataset.receiptId === previous.receiptId);
  if (!row?.closest('[hidden]')) row?.focus({ preventScroll: true });
  positions.delete(key);
}
