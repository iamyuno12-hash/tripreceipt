/**
 * OCR 엔진 래퍼.
 *
 * @paddleocr/paddleocr-js(ONNX Runtime Web + OpenCV.js)를 감싸서,
 * 앱의 나머지 부분이 SDK 세부사항을 몰라도 되게 한다.
 *
 * 모델은 한 번 초기화하면 재사용한다. 초기화에 수 초가 걸리므로
 * 영수증마다 다시 만들면 안 된다.
 */
import { PaddleOCR } from '@paddleocr/paddleocr-js';
import type { OcrResult } from '@paddleocr/paddleocr-js';
import {
  DETECTION_MODEL,
  RECOGNITION_MODELS,
  DEFAULT_LANGUAGE,
  type RecognitionLanguage,
} from './models.ts';

export type OcrBackend = 'auto' | 'wasm' | 'webgpu';

export interface EngineOptions {
  readonly lang?: RecognitionLanguage;
  readonly backend?: OcrBackend;
  /** 모델을 Worker 에서 돌릴지. 메인 스레드가 멈추지 않게 하려면 true */
  readonly worker?: boolean;
  readonly onProgress?: (message: string) => void;
}

export interface TextLine {
  readonly text: string;
  /** 인식 신뢰도 0~1 */
  readonly score: number;
  /** 글자 영역 꼭짓점. P5 파서가 줄을 묶을 때 쓴다 */
  readonly poly: readonly { x: number; y: number }[];
  /** poly 로부터 계산한 중심 y. 줄 그룹핑의 1차 기준 */
  readonly centerY: number;
  readonly minX: number;
  readonly maxX: number;
}

export interface RecognizeResult {
  readonly lines: readonly TextLine[];
  readonly imageSize: { width: number; height: number };
  readonly metrics: { detMs: number; recMs: number; totalMs: number };
  readonly runtime: {
    requestedBackend: string;
    detProvider: string;
    recProvider: string;
    webgpuAvailable: boolean;
  };
}

type Engine = Awaited<ReturnType<typeof PaddleOCR.create>>;

let cached: { engine: Engine; lang: RecognitionLanguage } | null = null;

/** 모델을 로드한다. 같은 언어로 다시 부르면 캐시를 돌려준다. */
export async function getEngine(options: EngineOptions = {}): Promise<Engine> {
  const lang = options.lang ?? DEFAULT_LANGUAGE;
  if (cached && cached.lang === lang) return cached.engine;

  if (cached) {
    // 언어가 바뀌면 이전 모델을 내려 메모리를 회수한다.
    await cached.engine.dispose().catch(() => undefined);
    cached = null;
  }

  const rec = RECOGNITION_MODELS[lang];
  options.onProgress?.(`모델 내려받는 중… (약 ${DETECTION_MODEL.approxMB + rec.approxMB}MB)`);

  const engine = await PaddleOCR.create({
    textDetectionModelName: DETECTION_MODEL.modelName,
    textDetectionModelAsset: { url: DETECTION_MODEL.url },
    textRecognitionModelName: rec.modelName,
    textRecognitionModelAsset: { url: rec.url },
    ortOptions: { backend: options.backend ?? 'auto' },
    worker: options.worker ?? false,
  });

  options.onProgress?.('모델 준비 완료');
  cached = { engine, lang };
  return engine;
}

function toLine(item: OcrResult['items'][number]): TextLine {
  // SDK 의 Point2D 는 객체가 아니라 [x, y] 튜플이다.
  const poly = item.poly.map(([x, y]) => ({ x, y }));
  const ys = poly.map((p) => p.y);
  const xs = poly.map((p) => p.x);
  return {
    text: item.text,
    score: item.score,
    poly,
    centerY: ys.reduce((a, b) => a + b, 0) / (ys.length || 1),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
  };
}

/** 이미지 한 장을 인식한다. */
export async function recognize(
  image: ImageBitmap | Blob | HTMLCanvasElement | ImageData | HTMLImageElement,
  options: EngineOptions = {},
): Promise<RecognizeResult> {
  const engine = await getEngine(options);
  options.onProgress?.('인식 중…');

  const results = await engine.predict(image);
  const first = results[0];
  if (!first) throw new Error('인식 결과가 비어 있습니다.');

  return {
    lines: first.items.map(toLine),
    imageSize: first.image,
    metrics: first.metrics,
    runtime: first.runtime,
  };
}

/** 메모리 해제. 설정 화면에서 모델을 내릴 때 쓴다. */
export async function disposeEngine(): Promise<void> {
  if (!cached) return;
  await cached.engine.dispose().catch(() => undefined);
  cached = null;
}

export function isEngineLoaded(): boolean {
  return cached !== null;
}
