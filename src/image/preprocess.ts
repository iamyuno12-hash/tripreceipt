/**
 * 영수증 이미지 전처리 (OpenCV.js).
 *
 * 실제 영수증 16장 × 여러 조합을 정답지로 채점해 정한 순서다 (docs/OCR-ENGINE.md 3.8·3.9 절).
 *
 *   회전(1차 인식으로 잰 각도) → 영수증만 자르기 → 글자 높이 32px 로 크기 조정 → 흑백
 *
 * 하지 않는 것과 이유:
 * - 대비개선(CLAHE)·그림자 보정·이진화: 두 번의 평가 모두 금액을 덜 맞혔다 (이진화가 가장 나쁨).
 * - 선명화: 효과 없음.
 * - 글자 48·64px: 느리고, 큰 사진에서 검출이 통째로 실패한 경우가 있었다.
 *
 * 평가에 쓴 파이썬 구현(tools/ocr-eval/pipeline.py)과 같은 계산을 그대로 옮겼다.
 * 각도·글자 높이를 재는 부분은 geometry.ts (DOM 없이 테스트 가능).
 */
import cv from '@techstark/opencv-js';

/** OpenCV.js 는 WASM 이라 로딩이 비동기다. 준비될 때까지 기다린다. */
let readyPromise: Promise<void> | null = null;
export function opencvReady(): Promise<void> {
  readyPromise ??= new Promise<void>((resolve) => {
    const anyCv = cv as unknown as { Mat?: unknown; onRuntimeInitialized?: () => void };
    if (anyCv.Mat) {
      resolve();
      return;
    }
    anyCv.onRuntimeInitialized = () => resolve();
  });
  return readyPromise;
}

/** 이미지를 RGBA Mat 으로 읽는다. 다 쓰면 반드시 delete() 해야 한다. */
export async function loadMat(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<cv.Mat> {
  await opencvReady();
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  return cv.imread(canvas);
}

export function matToCanvas(mat: cv.Mat): HTMLCanvasElement {
  const out = document.createElement('canvas');
  cv.imshow(out, mat);
  return out;
}

/** 긴 변이 maxSide 를 넘으면 줄인 사본을 캔버스로. 1차 인식(각도 재기)용 */
export function downscaleToCanvas(mat: cv.Mat, maxSide: number): { canvas: HTMLCanvasElement; scale: number } {
  const longest = Math.max(mat.cols, mat.rows);
  if (longest <= maxSide) return { canvas: matToCanvas(mat), scale: 1 };
  const scale = maxSide / longest;
  const small = new cv.Mat();
  try {
    cv.resize(mat, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    return { canvas: matToCanvas(small), scale };
  } finally {
    small.delete();
  }
}

/** deg 도만큼 돌린다(반시계, OpenCV 규약). 잘리지 않게 캔버스를 넓히고 여백은 fill 로 채운다. */
export function rotate(src: cv.Mat, deg: number, fill: readonly [number, number, number, number]): cv.Mat {
  const w = src.cols;
  const h = src.rows;
  const m = cv.getRotationMatrix2D(new cv.Point(w / 2, h / 2), deg, 1);
  const c = Math.abs(m.data64F[0] ?? 1);
  const s = Math.abs(m.data64F[1] ?? 0);
  const nw = Math.trunc(h * s + w * c);
  const nh = Math.trunc(h * c + w * s);
  m.data64F[2] = (m.data64F[2] ?? 0) + nw / 2 - w / 2;
  m.data64F[5] = (m.data64F[5] ?? 0) + nh / 2 - h / 2;
  const dst = new cv.Mat();
  cv.warpAffine(src, dst, m, new cv.Size(nw, nh), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(...fill));
  m.delete();
  return dst;
}

export interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/**
 * 영수증 영역 찾기: 밝고(V>140) 채도가 낮은(S<30) 픽셀 중 가장 큰 덩어리.
 * 회전으로 생긴 여백이 영수증과 붙지 않도록 검은 여백으로 돌린 이미지에서 찾는다.
 * 덩어리가 사진의 10% 보다 작으면 못 찾은 것으로 보고 null.
 * (밝은 천·나무 배경에서는 못 찾는다. 그때는 사진 전체를 쓰며, 정확도에는 영향이 없었다)
 */
export function receiptRect(blackFilled: cv.Mat, margin = 0.02): Rect | null {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const ch = new cv.MatVector();
  const sMask = new cv.Mat();
  const vMask = new cv.Mat();
  const mask = new cv.Mat();
  const k = Math.max(5, Math.floor(blackFilled.cols / 150));
  const kOpen = cv.Mat.ones(k, k, cv.CV_8U);
  const kClose = cv.Mat.ones(k * 3, k * 3, cv.CV_8U);
  try {
    cv.cvtColor(blackFilled, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, ch);
    cv.threshold(ch.get(1), sMask, 29, 255, cv.THRESH_BINARY_INV); // S <= 29
    cv.threshold(ch.get(2), vMask, 140, 255, cv.THRESH_BINARY);    // V > 140
    cv.bitwise_and(sMask, vMask, mask);
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kOpen);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kClose);

    const H = mask.rows;
    const W = mask.cols;
    const best = largestComponent(mask);
    if (!best || best.area < 0.1 * H * W) return null;
    const mx = Math.trunc(W * margin);
    const my = Math.trunc(H * margin);
    return {
      x0: Math.max(0, best.x - mx),
      y0: Math.max(0, best.y - my),
      x1: Math.min(W, best.x + best.w + mx),
      y1: Math.min(H, best.y + best.h + my),
    };
  } finally {
    for (const m of [rgb, hsv, sMask, vMask, mask, kOpen, kClose]) m.delete();
    for (let i = 0; i < ch.size(); i++) ch.get(i).delete();
    ch.delete();
  }
}

interface Component { x: number; y: number; w: number; h: number; area: number }

function largestComponent(mask: cv.Mat): Component | null {
  const anyCv = cv as unknown as { connectedComponentsWithStats?: unknown };
  if (typeof anyCv.connectedComponentsWithStats === 'function') {
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const cents = new cv.Mat();
    try {
      const n = cv.connectedComponentsWithStats(mask, labels, stats, cents);
      let best: Component | null = null;
      for (let i = 1; i < n; i++) {
        const at = (k: number): number => stats.data32S[i * 5 + k] ?? 0;
        const c = { x: at(0), y: at(1), w: at(2), h: at(3), area: at(4) };
        if (!best || c.area > best.area) best = c;
      }
      return best;
    } finally {
      labels.delete(); stats.delete(); cents.delete();
    }
  }
  // 이 빌드에 connectedComponentsWithStats 가 없으면 외곽선으로 대신한다
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  try {
    cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best: Component | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const r = cv.boundingRect(cnt);
      const area = cv.contourArea(cnt);
      cnt.delete();
      if (!best || area > best.area) best = { x: r.x, y: r.y, w: r.width, h: r.height, area };
    }
    return best;
  } finally {
    contours.delete(); hier.delete();
  }
}

export interface PrepareOptions {
  /** 1차 인식으로 잰 글자 줄 각도(도) */
  readonly angle: number;
  /** 원본 기준 글자 높이(px) */
  readonly textHeight: number;
  readonly targetTextHeight: number;
  readonly crop: boolean;
  readonly gray: boolean;
}

export interface PrepareResult {
  readonly canvas: HTMLCanvasElement;
  readonly steps: readonly string[];
  readonly cropped: boolean;
}

/** 원본 Mat 에 회전 → 자르기 → 크기 조정 → 흑백을 적용해 2차 인식용 캔버스를 만든다. */
export function prepareForOcr(src: cv.Mat, o: PrepareOptions): PrepareResult {
  const steps: string[] = [];
  const toDelete: cv.Mat[] = [];
  try {
    let img = rotate(src, o.angle, [255, 255, 255, 255]);
    toDelete.push(img);
    steps.push(`회전 ${o.angle.toFixed(1)}도`);

    let cropped = false;
    if (o.crop) {
      const black = rotate(src, o.angle, [0, 0, 0, 255]);
      const r = receiptRect(black);
      black.delete();
      if (r) {
        const roi = img.roi(new cv.Rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0));
        img = roi.clone();
        roi.delete();
        toDelete.push(img);
        cropped = true;
        steps.push('영수증 영역 자르기');
      } else {
        steps.push('영수증 영역 못 찾음 — 전체 사용');
      }
    }

    if (o.textHeight > 0) {
      const s = o.targetTextHeight / o.textHeight;
      const resized = new cv.Mat();
      cv.resize(img, resized, new cv.Size(0, 0), s, s, s < 1 ? cv.INTER_AREA : cv.INTER_CUBIC);
      toDelete.push(resized);
      img = resized;
      steps.push(`글자 높이 ${Math.round(o.textHeight)}→${o.targetTextHeight}px`);
    }

    if (o.gray) {
      const g = new cv.Mat();
      cv.cvtColor(img, g, cv.COLOR_RGBA2GRAY);
      toDelete.push(g);
      img = g;
      steps.push('흑백');
    }

    return { canvas: matToCanvas(img), steps, cropped };
  } finally {
    for (const m of toDelete) m.delete();
  }
}

/** 캔버스를 180도 돌린 사본. 거꾸로 찍힌 사진 판정용 */
export function rotate180(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.translate(out.width, out.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** 캔버스를 저장용 Blob 으로. JPEG 는 글자 경계가 뭉개지므로 PNG 를 쓴다. */
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지 변환 실패'))),
      type,
    );
  });
}
