/**
 * P6 지출 내역 CSV 내보내기.
 *
 * - 모든 영수증을 보존하고 상태와 집계 포함 여부를 함께 기록한다.
 * - 통화를 환산/합산하지 않고 원본 통화를 각 행에 표시한다.
 * - 영수증 총액/세금은 첫 품목 행에만 기록해 스프레드시트에서 중복 합산을 피한다.
 */
import { isCountable, type Receipt, type Trip } from '../types.ts';

type CsvValue = string | number | null | undefined;

const HEADERS = [
  '여행명',
  '여행ID',
  '결제일시',
  '상호명',
  '영수증ID',
  '영수증상태',
  '통계집계포함',
  '통화',
  '품목명',
  '카테고리',
  '수량',
  '단가',
  '품목금액',
] as const;

/** 쉼표/따옴표/줄바꿈을 CSV 규칙에 맞게 처리하고, 셀 수식 실행을 방지한다. */
function escapeCsv(value: CsvValue): string {
  const raw = value == null ? '' : String(value);
  // 사용자 입력(상호명, 품목명 등)이 Excel 수식으로 해석되지 않도록 한다.
  const safe = typeof value === 'string' && /^\s*[=+\-@]/u.test(raw)
    ? `'${raw}`
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** 저장된 여행·영수증으로 품목 단위 CSV를 만든다. (IndexedDB와 무관한 순수 함수) */
export function buildExpenseCsv(
  trips: readonly Trip[],
  receipts: readonly Receipt[],
): string {
  const rows: CsvValue[][] = [[...HEADERS]];
  const receiptsByTrip = new Map<string, Receipt[]>();

  for (const receipt of receipts) {
    const grouped = receiptsByTrip.get(receipt.tripId) ?? [];
    grouped.push(receipt);
    receiptsByTrip.set(receipt.tripId, grouped);
  }

  for (const trip of trips) {
    const tripReceipts = [...(receiptsByTrip.get(trip.id) ?? [])]
      .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));

    for (const receipt of tripReceipts) {
      const prefix: CsvValue[] = [
        trip.name,
        trip.id,
        receipt.purchasedAt,
        receipt.merchant,
        receipt.id,
        receipt.status,
        isCountable(receipt) ? '예' : '아니요',
        receipt.currency,
      ];

      if (receipt.items.length === 0) {
        rows.push([...prefix, '', '', '', '', '']);
        continue;
      }

      receipt.items.forEach((item) => {
        rows.push([
          ...prefix,
          item.name,
          item.category,
          item.quantity,
          item.unitPrice,
          item.amount,
        ]);
      });
    }
  }

  // Excel에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
  return '\uFEFF' + rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
}

/** 생성한 CSV를 사용자 브라우저에서 다운로드한다. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // 클릭 이후 다운로드 처리가 시작될 시간을 확보한다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
