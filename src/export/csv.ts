/**
 * P6 지출 내역 CSV 내보내기.
 *
 * - 모든 영수증을 보존하고 상태와 집계 포함 여부를 함께 기록한다.
 * - 원본 통화·금액과 여행 기준 통화의 환산액·환율을 함께 보존한다.
 * - 영수증 총액/세금은 첫 품목 행에만 기록해 스프레드시트에서 중복 합산을 피한다.
 */
import { isCountable, type Receipt, type Trip } from '../types.ts';
import { convertedTotal, convertAmount, paymentDate, receiptRate } from '../currency.ts';

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
  '영수증총액',
  '부가세',
  '집계기준통화',
  '적용환율',
  '환율기준일',
  '환율조회기준일',
  '환율출처',
  '환산상태',
  '환산품목금액',
  '환산영수증총액',
  '환산부가세',
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
      const converted = receipt.status === 'pending' ? null : convertedTotal(receipt, trip.currency);
      const snapshot = receiptRate(receipt, trip.currency);
      const rate = receipt.currency === trip.currency ? 1 : snapshot?.rate;
      const conversionState = receipt.status === 'pending' ? '내용 대기' : converted === null ? '환산 대기'
        : receipt.currency === trip.currency ? '같은 통화' : '환산 완료';
      const prefix: CsvValue[] = [
        trip.name,
        trip.id,
        receipt.purchasedAt,
        receipt.merchant,
        receipt.id,
        receipt.status,
        isCountable(receipt) && converted !== null ? '예' : '아니요',
        receipt.currency,
      ];
      const suffix = (first: boolean, itemAmount?: number): CsvValue[] => [
        first ? receipt.total : '', first ? receipt.tax : '', trip.currency, rate,
        snapshot?.date ?? (rate === 1 ? paymentDate(receipt.purchasedAt) : ''),
        snapshot?.requestedDate ?? (rate === 1 ? paymentDate(receipt.purchasedAt) : ''),
        snapshot?.source ?? (rate === 1 ? '동일 통화' : ''), conversionState,
        itemAmount !== undefined && rate !== undefined && converted !== null ? convertAmount(itemAmount, rate, trip.currency) : '',
        first ? converted : '',
        first && receipt.tax !== null && rate !== undefined && converted !== null ? convertAmount(receipt.tax, rate, trip.currency) : '',
      ];

      if (receipt.items.length === 0) {
        rows.push([...prefix, '', '', '', '', '', ...suffix(true)]);
        continue;
      }

      receipt.items.forEach((item, index) => {
        rows.push([
          ...prefix,
          item.name,
          item.category,
          item.quantity,
          item.unitPrice,
          item.amount,
          ...suffix(index === 0, item.amount),
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
