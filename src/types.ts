/**
 * 도메인 타입.
 *
 * P1 에서는 더미 데이터로만 쓰이지만, P2(IndexedDB 스키마)와 P5(파서 출력)가
 * 이 타입을 그대로 사용한다. 저장 구조와 파서 결과의 계약 역할을 한다.
 */

/** 지출 분류. 통계 화면의 집계 단위다. */
export const CATEGORIES = ['식비', '교통', '숙박', '쇼핑', '관광', '기타'] as const;
export type Category = (typeof CATEGORIES)[number];

/** 영수증 처리 상태 */
export type ReceiptStatus =
  /** 이미지만 등록되고 아직 인식 전 */
  | 'pending'
  /** 인식·파싱 완료, 교차검증도 통과 */
  | 'parsed'
  /** 인식은 됐으나 품목합계와 총액이 맞지 않아 사람 확인이 필요 */
  | 'needs_review'
  /** 사용자가 확인·수정을 마침 */
  | 'confirmed';

export interface Trip {
  readonly id: string;
  /** 여행 이름 (예: "오사카 3박 4일") */
  readonly name: string;
  /** 지역. P6 에서 인식 모델 선택에 쓰인다 */
  readonly destination: string;
  /** ISO 날짜 (YYYY-MM-DD) */
  readonly startDate: string;
  readonly endDate: string;
  /** 이 여행의 기준 통화 (ISO 4217) */
  readonly currency: string;
  readonly createdAt: string;
}

export interface ReceiptItem {
  readonly id: string;
  readonly receiptId: string;
  readonly name: string;
  readonly quantity: number;
  /** 단가. 단가가 안 찍힌 영수증이면 amount / quantity 로 채운다 */
  readonly unitPrice: number;
  /** 이 줄의 금액 */
  readonly amount: number;
  readonly category: Category;
  /** 영수증에서 이 품목이 있던 줄 순서. 검수 화면에서 원본과 대조할 때 쓴다 */
  readonly lineIndex: number;
}

export interface Receipt {
  readonly id: string;
  readonly tripId: string;
  /** 원본 이미지 키. P2 에서 IndexedDB 의 Blob 저장소를 가리킨다 */
  readonly imageId: string | null;
  readonly merchant: string;
  /** 결제 일시 (ISO) */
  readonly purchasedAt: string;
  readonly currency: string;
  /** 영수증에 찍힌 총액 */
  readonly total: number;
  /** 영수증에 찍힌 부가세. 없으면 null */
  readonly tax: number | null;
  readonly status: ReceiptStatus;
  /** OCR 평균 신뢰도 (0~1). 아직 인식 전이면 null */
  readonly confidence: number | null;
  readonly items: readonly ReceiptItem[];
}

// ---------------------------------------------------------------------------
// 교차검증
//
// 제안서의 핵심 아이디어다. OCR 은 "합계", "부가세", "카드승인" 같은 비품목 금액도
// 똑같은 숫자 줄로 읽기 때문에, 단순 추출만으로는 어떤 금액이 품목인지 알 수 없다.
// 그래서 품목 금액의 합과 영수증에 찍힌 총액을 맞춰 보고, 어긋나면 사람에게 넘긴다.
// 이 함수가 "검수가 필요한 영수증"을 자동으로 골라내는 기준이 된다.
// ---------------------------------------------------------------------------

/** 금액 비교 허용 오차. 반올림·봉사료 등으로 소액 차이는 날 수 있다. */
export const AMOUNT_TOLERANCE = 1;

export interface CrossCheckResult {
  /** 품목 금액의 합 */
  readonly itemsTotal: number;
  /** 영수증에 찍힌 총액 */
  readonly statedTotal: number;
  /** statedTotal - itemsTotal */
  readonly difference: number;
  /** 허용 오차 안에 들어오는가 */
  readonly matches: boolean;
}

export function crossCheck(receipt: Receipt): CrossCheckResult {
  const itemsTotal = receipt.items.reduce((sum, item) => sum + item.amount, 0);
  const difference = receipt.total - itemsTotal;
  return {
    itemsTotal,
    statedTotal: receipt.total,
    difference,
    matches: Math.abs(difference) <= AMOUNT_TOLERANCE,
  };
}

/**
 * 교차검증 결과로 상태를 판정한다.
 * 사용자가 이미 확인한(confirmed) 영수증은 다시 되돌리지 않는다.
 */
export function resolveStatus(receipt: Receipt): ReceiptStatus {
  if (receipt.status === 'pending' || receipt.status === 'confirmed') {
    return receipt.status;
  }
  return crossCheck(receipt).matches ? 'parsed' : 'needs_review';
}

/** 여행 전체 지출 합계 */
export function tripTotal(receipts: readonly Receipt[]): number {
  return receipts.reduce((sum, r) => sum + r.total, 0);
}

/**
 * 집계에 넣어도 되는 영수증인가.
 *
 * 교차검증에 실패한 영수증(needs_review)의 품목은 "합계" 같은 비품목 줄이 섞여 있을 수
 * 있어 그대로 더하면 통계가 부풀려진다. 아직 인식 전(pending)도 마찬가지다.
 * 그래서 집계에서는 빼고, 화면에 몇 장이 빠졌는지 알려 준다.
 */
export function isCountable(receipt: Receipt): boolean {
  return receipt.status === 'parsed' || receipt.status === 'confirmed';
}

/**
 * 카테고리별 합계. 통계 화면과 CSV 내보내기가 함께 쓴다.
 * 검증을 통과한 영수증만 더한다 (isCountable 참고).
 */
export function totalsByCategory(receipts: readonly Receipt[]): Map<Category, number> {
  const out = new Map<Category, number>();
  for (const receipt of receipts) {
    if (!isCountable(receipt)) continue;
    for (const item of receipt.items) {
      out.set(item.category, (out.get(item.category) ?? 0) + item.amount);
    }
  }
  return out;
}
