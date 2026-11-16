/**
 * 1차 인식 결과(글자 상자)에서 기울기와 글자 높이를 재는 순수 함수들.
 *
 * DOM·OpenCV 에 의존하지 않아 node 테스트로 확인할 수 있다 (test/geometry.test.ts).
 * 근거와 수치는 docs/OCR-ENGINE.md 3.7~3.9 절.
 *
 * 왜 글자 상자로 재는가 — 처음 만든 OpenCV 윤곽선 방식은 영수증 바깥 배경(키보드 등)의
 * 모서리 각도를 잡아서 실제 사진에서 0도로 판단했다. OCR 이 찾은 글자 상자는 배경과
 * 상관없이 글자 줄의 방향을 그대로 알려 준다.
 */

export interface Point { readonly x: number; readonly y: number }
export interface BoxLike { readonly text: string; readonly score: number; readonly poly: readonly Point[] }

export interface BoxStats {
  /** 글자 줄 각도(도), -90 이상 90 미만. 양수면 오른쪽이 아래로 처진 것 */
  readonly angle: number;
  /** 글자 높이(px) 중앙값 — 상자의 짧은 변 */
  readonly textHeight: number;
  /** 각도 계산에 쓴 상자 수 */
  readonly used: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/** 각도를 -90 이상 90 미만으로. 상자의 긴 변은 방향이 없으므로 180도 차이는 같은 것으로 본다. */
export function normalizeAngle(deg: number): number {
  return ((((deg + 90) % 180) + 180) % 180) - 90;
}

/**
 * 상자마다 긴 변의 방향과 짧은 변의 길이를 구해 중앙값을 낸다.
 * 각도는 4글자 이상인 상자만 쓴다 — 숫자 한 자리 같은 짧은 상자는 정사각형에 가까워 방향이 불안정하다.
 * (평가 도구 tools/ocr-eval/pipeline.py 의 first_pass_stats 와 같은 계산)
 */
export function boxStats(boxes: readonly BoxLike[]): BoxStats {
  const angles: number[] = [];
  const heights: number[] = [];
  for (const b of boxes) {
    const [p0, p1, p2] = b.poly;
    if (!p0 || !p1 || !p2 || b.poly.length < 4) continue;
    const e1 = { x: p1.x - p0.x, y: p1.y - p0.y };
    const e2 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const l1 = Math.hypot(e1.x, e1.y);
    const l2 = Math.hypot(e2.x, e2.y);
    const [long, short] = l1 >= l2 ? [e1, l2] : [e2, l1];
    if (b.text.length >= 4) angles.push(normalizeAngle((Math.atan2(long.y, long.x) * 180) / Math.PI));
    heights.push(short);
  }
  return { angle: median(angles), textHeight: median(heights), used: angles.length };
}

/** 인식 결과의 평균 신뢰도. 방향(180도) 판정에만 쓴다 — 정확도 판단에는 쓰지 않는다. */
export function meanScore(boxes: readonly BoxLike[]): number {
  if (boxes.length === 0) return 0;
  return boxes.reduce((s, b) => s + b.score, 0) / boxes.length;
}

export interface PlanConfig {
  /** 이 각도(도) 미만이면 회전 없이 1차 결과를 쓴다 */
  readonly skipBelowDegrees: number;
  /** 회전·자르기 뒤 맞출 글자 높이(px) */
  readonly targetTextHeight: number;
}

/**
 * 16장 평가로 정한 값 (docs/OCR-ENGINE.md 3.9).
 * - 글자 높이 32px: 48·64px 보다 빠르고, 큰 사진에서 검출이 통째로 실패하는 일이 없었다.
 * - 1도: 영수증 한 줄 폭이 글자 높이의 약 20배라, 1도면 줄 양 끝 높이 차가 글자 높이의 1/3 정도.
 *   줄 묶기가 깨지는 기준(절반, 약 1.4도)보다 작다.
 */
export const DEFAULT_PLAN: PlanConfig = { skipBelowDegrees: 1, targetTextHeight: 32 };

/** 2차 인식(회전·자르기·크기 조정 뒤 다시 인식)이 필요한가 */
export function needsSecondPass(stats: BoxStats, cfg: PlanConfig = DEFAULT_PLAN): boolean {
  if (stats.used === 0) return false; // 글자를 못 찾았으면 다시 돌려도 소용없다
  return Math.abs(stats.angle) >= cfg.skipBelowDegrees;
}

/**
 * 옆으로 누운 사진(45도 넘게 돌아감)은 글자 상자만으로는 위아래를 알 수 없다.
 * 두 방향을 다 인식해 보고 신뢰도가 높은 쪽을 고른다 (다이소: 93.9% vs 69.1%).
 */
export function orientationAmbiguous(stats: BoxStats): boolean {
  return Math.abs(stats.angle) > 45;
}

/** 똑바로 놓인 사진이라도 신뢰도가 이 값보다 낮으면 거꾸로 찍혔을 수 있어 180도 돌려 본다. */
export const UPSIDE_DOWN_SCORE = 0.7;

/** 글자 높이를 target 으로 맞추는 배율. 높이를 못 쟀으면 1 */
export function scaleToTextHeight(textHeight: number, target: number): number {
  return textHeight > 0 ? target / textHeight : 1;
}
