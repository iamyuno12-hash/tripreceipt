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

// ---------------------------------------------------------------------------
// 인식 언어
//
// 인식 모델은 언어별로 다르다. 한국어 모델은 일본어 가나·한자를 읽지 못하고
// (일본 영수증 3장에서 품목명 오류 68%), 중·일 모델은 한글을 읽지 못한다.
// 그래서 여행마다 언어를 정하고 그 여행의 영수증은 그 모델로 읽는다.
// 근거: docs/OCR-ENGINE.md 3.9 절.
// ---------------------------------------------------------------------------

/** korean: 한국어 + 영어 / zh_ja: 중국어·일본어 + 영어 */
export const OCR_LANGUAGES = ['korean', 'zh_ja'] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  korean: '한국어 (영어 포함)',
  zh_ja: '일본어·중국어 (영어 포함)',
};

/** 통화로 인식 언어를 추천한다. 여행 만들기 화면의 기본값으로만 쓰고, 사용자가 바꿀 수 있다. */
export function suggestOcrLanguage(currency: string): OcrLanguage {
  return ['JPY', 'CNY', 'TWD', 'HKD'].includes(currency.toUpperCase()) ? 'zh_ja' : 'korean';
}

/** 저장된 여행의 인식 언어. 이 필드가 생기기 전에 만든 여행은 한국어로 본다. */
export function tripOcrLanguage(trip: Pick<Trip, 'ocrLanguage'> | undefined): OcrLanguage {
  return trip?.ocrLanguage ?? 'korean';
}

export interface Trip {
  readonly id: string;
  /** 여행 이름 (예: "오사카 3박 4일") */
  readonly name: string;
  /** 지역 (표시용) */
  readonly destination: string;
  /** 영수증 인식 언어. 없으면 한국어 (tripOcrLanguage 참고) */
  readonly ocrLanguage?: OcrLanguage;
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
  /** null이면 여행 미지정 보관함. 기존 여행 ID는 그대로 유지한다. */
  readonly tripId: string | null;
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
  /**
   * OCR 원본 결과. P5 파서가 이것으로 품목·금액을 채운다.
   * 좌표는 함께 저장한 이미지(imageId) 기준이다. 수기 입력만 한 영수증이면 없다.
   */
  readonly ocr?: OcrSnapshot | null;
  /** 원래 금액은 보존하고, 집계에 사용한 환율을 기준 통화·결제일별로 고정한다. */
  readonly exchangeRates?: readonly ExchangeRate[];
}

export interface ExchangeRate {
  readonly from: string;
  readonly to: string;
  /** 원래 통화 1단위당 기준 통화 금액 */
  readonly rate: number;
  readonly requestedDate: string;
  readonly date: string;
  readonly source: 'frankfurter' | 'manual';
  readonly recordedAt: string;
}

/** OCR 이 읽은 글자 상자 하나 */
export interface OcrLineRecord {
  readonly text: string;
  /** 모델 신뢰도 0~1. 높아도 틀릴 수 있다 (솥밥→솔밥 99.8%) — 정확도 판단에 쓰지 않는다 */
  readonly score: number;
  readonly poly: readonly { readonly x: number; readonly y: number }[];
}

export interface OcrSnapshot {
  readonly lang: OcrLanguage;
  readonly lines: readonly OcrLineRecord[];
  readonly imageSize: { readonly width: number; readonly height: number };
  /** 인식을 몇 번 돌렸나. 1 = 기울기가 작아 1차 결과를 그대로 씀 */
  readonly passes: number;
  /** 1차 인식으로 잰 글자 줄 각도(도)와 원본 기준 글자 높이(px) */
  readonly angle: number;
  readonly textHeight: number;
  /** 적용한 전처리 단계 (표시·디버깅용) */
  readonly steps: readonly string[];
  readonly ms: { readonly total: number; readonly firstPass: number; readonly preprocess: number; readonly secondPass: number };
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// 교차검증
//
// 제안서의 핵심 아이디어다. OCR 은 "합계", "부가세", "카드승인" 같은 비품목 금액도
// 똑같은 숫자 줄로 읽기 때문에, 단순 추출만으로는 어떤 금액이 품목인지 알 수 없다.
// 그래서 품목 금액의 합과 영수증에 찍힌 총액을 맞춰 보고, 어긋나면 사람에게 넘긴다.
// 이 함수가 "검수가 필요한 영수증"을 자동으로 골라내는 기준이 된다.
// ---------------------------------------------------------------------------

/** 금액 비교 허용 오차: 각 통화의 최소 표시 단위 1개. */
export const AMOUNT_TOLERANCE = 1;

export function currencyDigits(currency: string): number {
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

export function amountTolerance(currency: string): number {
  return AMOUNT_TOLERANCE / 10 ** currencyDigits(currency);
}

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
    matches: hasReceiptContent(receipt) && Math.abs(difference) <= amountTolerance(receipt.currency) + Number.EPSILON * Math.max(1, receipt.total, itemsTotal) * 4,
  };
}

/**
 * 교차검증 결과로 상태를 판정한다.
 *
 * - confirmed 는 현재 내용에 대한 사용자 판단이다. 내용 변경 여부는 저장소에서 비교한다.
 * - pending 은 "사진만 있고 아직 내용이 없음" 을 뜻한다. 내용이 하나라도 들어오면
 *   (P3 스캔 후 수기 입력, 또는 P4 의 OCR 결과) 더 이상 대기 상태가 아니므로
 *   교차검증으로 판정한다.
 */
export function resolveStatus(receipt: Receipt): ReceiptStatus {
  if (!hasReceiptContent(receipt)) return 'pending';
  if (receipt.status === 'confirmed') return 'confirmed';

  return crossCheck(receipt).matches ? 'parsed' : 'needs_review';
}

export function hasReceiptContent(receipt: Pick<Receipt, 'items' | 'total'>): boolean {
  return receipt.items.length > 0 || receipt.total > 0;
}

/** 동일 통화 금액의 합. 여행 화면의 혼합 통화 집계는 summarizeExpenses를 쓴다. */
export function tripTotal(receipts: readonly Receipt[]): number {
  if (new Set(receipts.map(receipt => receipt.currency)).size > 1) throw new Error('다른 통화는 환산한 뒤 합산하세요.');
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
