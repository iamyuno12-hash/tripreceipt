/**
 * 영수증 한 장을 읽는 전체 흐름 (P3 전처리 + P4 OCR).
 *
 *   1차 인식 (긴 변 1600px 로 줄인 사진)
 *     → 글자 상자로 기울기·글자 높이 측정 (image/geometry.ts)
 *     → 기울기가 1도 미만이면 1차 결과를 그대로 쓴다
 *     → 아니면 원본에 회전 → 영수증만 자르기 → 글자 높이 32px → 흑백 (image/preprocess.ts)
 *       을 적용하고 2차 인식
 *     → 옆으로 누운 사진이거나 신뢰도가 매우 낮으면 180도 돌려 한 번 더 보고 나은 쪽을 쓴다
 *
 * 전처리가 OCR 결과(글자 상자)에 기대기 때문에 P3 와 P4 를 한 흐름으로 묶었다.
 * SDK 에 "검출만" 하는 공개 API 가 없어 1차에서도 글자 인식까지 돈다. 그래서 기울기가 작은 사진은
 * 2차를 생략해 시간을 아낀다. 수치 근거: docs/OCR-ENGINE.md 3.9·3.10 절.
 */
import type { OcrLanguage, OcrSnapshot } from '../types.ts';
import { recognize, type RecognizeResult } from './engine.ts';
import { loadMat, downscaleToCanvas, prepareForOcr, rotate180 } from '../image/preprocess.ts';
import {
  boxStats, needsSecondPass, orientationAmbiguous, meanScore,
  UPSIDE_DOWN_SCORE, DEFAULT_PLAN,
} from '../image/geometry.ts';

export interface AnalyzeOptions {
  readonly lang: OcrLanguage;
  /** 기울기가 작으면 2차 인식을 생략 (기본 true). 측정할 때만 끈다 */
  readonly skipSmallAngle?: boolean;
  /** 1차 인식에 쓸 사진의 긴 변 (기본 1600) */
  readonly firstPassMaxSide?: number;
  readonly onProgress?: (message: string) => void;
}

export interface AnalyzeResult {
  /** OCR 좌표의 기준이 되는 이미지. 영수증과 함께 이것을 저장한다 */
  readonly canvas: HTMLCanvasElement;
  readonly result: RecognizeResult;
  readonly snapshot: OcrSnapshot;
}

export async function analyzeReceipt(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const { lang, skipSmallAngle = true, firstPassMaxSide = 1600, onProgress } = options;
  const t0 = performance.now();
  const src = await loadMat(source);

  try {
    onProgress?.('1차 인식 중… (기울기 재기)');
    const { canvas: first, scale } = downscaleToCanvas(src, firstPassMaxSide);
    const tf = performance.now();
    const r1 = await recognize(first, { lang, onProgress });
    const firstMs = performance.now() - tf;

    const stats = boxStats(r1.lines);
    const textHeight = stats.textHeight / scale; // 원본 기준
    const steps: string[] = [
      `1차 인식 ${first.width}×${first.height}`,
      `각도 ${stats.angle.toFixed(1)}도 · 글자 높이 ${Math.round(textHeight)}px`,
    ];

    let canvas = first;
    let result = r1;
    let passes = 1;
    let prepMs = 0;
    let secondMs = 0;

    const doSecond = stats.used > 0 && (!skipSmallAngle || needsSecondPass(stats));
    if (doSecond) {
      onProgress?.('회전·자르기 중…');
      const tp = performance.now();
      const prep = prepareForOcr(src, {
        angle: stats.angle,
        textHeight,
        targetTextHeight: DEFAULT_PLAN.targetTextHeight,
        crop: true,
        gray: true,
      });
      prepMs = performance.now() - tp;
      steps.push(...prep.steps);

      onProgress?.('2차 인식 중…');
      const ts = performance.now();
      canvas = prep.canvas;
      result = await recognize(canvas, { lang });
      passes = 2;
      secondMs = performance.now() - ts;
    } else {
      steps.push(stats.used === 0 ? '글자를 거의 찾지 못함' : `기울기 ${DEFAULT_PLAN.skipBelowDegrees}도 미만 — 1차 결과 사용`);
    }

    // 위아래 판정: 옆으로 누운 사진은 항상, 그 외에는 신뢰도가 아주 낮을 때만
    if (result.lines.length > 0 && (orientationAmbiguous(stats) || meanScore(result.lines) < UPSIDE_DOWN_SCORE)) {
      onProgress?.('위아래 방향 확인 중…');
      const ts = performance.now();
      const flipped = rotate180(canvas);
      const r3 = await recognize(flipped, { lang });
      passes += 1;
      if (meanScore(r3.lines) > meanScore(result.lines)) {
        canvas = flipped;
        result = r3;
        steps.push('180도 뒤집음');
      }
      secondMs += performance.now() - ts;
    }

    const snapshot: OcrSnapshot = {
      lang,
      lines: result.lines.map((l) => ({ text: l.text, score: l.score, poly: l.poly })),
      imageSize: { width: canvas.width, height: canvas.height },
      passes,
      angle: stats.angle,
      textHeight,
      steps,
      ms: {
        total: Math.round(performance.now() - t0),
        firstPass: Math.round(firstMs),
        preprocess: Math.round(prepMs),
        secondPass: Math.round(secondMs),
      },
      recordedAt: new Date().toISOString(),
    };
    return { canvas, result, snapshot };
  } finally {
    src.delete();
  }
}
