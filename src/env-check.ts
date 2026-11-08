/**
 * 브라우저 환경 점검.
 *
 * P0 의 목적은 기능이 아니라 "이 브라우저에서 P3~P4 파이프라인이 돌아갈 수 있는가"를
 * 코드를 더 쓰기 전에 확인하는 것이다. 여기서 빨간 항목이 나오면 그 원인을 먼저 해결해야
 * 이후 단계가 의미가 있다.
 */

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly level: CheckLevel;
  readonly detail: string;
  /** 어느 단계에서 이 기능이 필요한지 */
  readonly neededFor: string;
}

/** WASM SIMD 지원 여부. SIMD 가 없으면 OCR 추론이 몇 배 느려진다. */
function hasWasmSimd(): boolean {
  try {
    // SIMD 명령(v128.const, i8x16 계열)을 담은 최소 모듈을 검증만 해 본다.
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/** 저장 가능 용량(바이트)을 추정한다. 모델 17MB + 영수증 사진이 들어갈 공간이 필요하다. */
async function storageEstimate(): Promise<{ quota?: number; usage?: number }> {
  if (!navigator.storage?.estimate) return {};
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return { quota: quota ?? undefined, usage: usage ?? undefined };
  } catch {
    return {};
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

export async function runEnvChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // --- WebAssembly: OCR 추론 엔진의 전제조건 ---
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function';
  results.push({
    name: 'WebAssembly',
    level: wasm ? 'ok' : 'fail',
    detail: wasm ? '지원' : '미지원 — 이 브라우저에서는 OCR 을 실행할 수 없습니다',
    neededFor: 'P4 OCR 추론',
  });

  const simd = hasWasmSimd();
  results.push({
    name: 'WASM SIMD',
    level: simd ? 'ok' : 'warn',
    detail: simd ? '지원' : '미지원 — 추론이 수 배 느려집니다',
    neededFor: 'P4 추론 속도',
  });

  // --- cross-origin isolation: 멀티스레드 WASM 의 전제조건 ---
  // 서버가 COOP/COEP 헤더를 내려주지 않으면 여기서 막힌다.
  // vite.config.ts 와 docker/nginx.conf 에 해당 설정이 있다.
  const isolated = globalThis.crossOriginIsolated === true;
  const sab = typeof SharedArrayBuffer !== 'undefined';
  results.push({
    name: 'Cross-origin isolation',
    level: isolated && sab ? 'ok' : 'warn',
    detail:
      isolated && sab
        ? '적용됨 — 멀티스레드 WASM 사용 가능'
        : 'COOP/COEP 헤더가 적용되지 않아 단일 스레드로 동작합니다',
    neededFor: 'P4 추론 속도',
  });

  // --- IndexedDB: 백엔드를 대체하는 저장소 ---
  const idb = typeof indexedDB !== 'undefined';
  results.push({
    name: 'IndexedDB',
    level: idb ? 'ok' : 'fail',
    detail: idb ? '지원' : '미지원 — 데이터를 저장할 수 없습니다',
    neededFor: 'P2 데이터 저장',
  });

  const { quota, usage } = await storageEstimate();
  if (quota !== undefined) {
    const enough = quota > 200 * 1024 * 1024;
    results.push({
      name: '저장 공간',
      level: enough ? 'ok' : 'warn',
      detail: `약 ${mb(quota)} 사용 가능${usage !== undefined ? ` (현재 ${mb(usage)} 사용)` : ''}`,
      neededFor: 'P2 저장 / P4 모델 캐시',
    });
  }

  // --- 영구 저장: 브라우저가 데이터를 임의로 비우지 않게 하는 설정 ---
  if (navigator.storage?.persisted) {
    let persisted = false;
    try {
      persisted = await navigator.storage.persisted();
    } catch {
      /* 무시 */
    }
    results.push({
      name: '영구 저장 권한',
      level: persisted ? 'ok' : 'warn',
      detail: persisted
        ? '허용됨'
        : '미허용 — 저장 공간이 부족하면 브라우저가 데이터를 지울 수 있습니다 (P2 에서 요청 처리)',
      neededFor: 'P2 데이터 보존',
    });
  }

  // --- 카메라: 영수증 촬영 입력 ---
  const camera = typeof navigator.mediaDevices?.getUserMedia === 'function';
  results.push({
    name: '카메라 API',
    level: camera ? 'ok' : 'warn',
    detail: camera
      ? '사용 가능 (실제 권한은 촬영 시점에 요청)'
      : '사용 불가 — 파일 선택으로만 입력받아야 합니다',
    neededFor: 'P3 영수증 촬영',
  });

  // --- 이미지 처리: 전처리 파이프라인 ---
  const imaging =
    typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
  results.push({
    name: '이미지 처리 API',
    level: imaging ? 'ok' : 'warn',
    detail: imaging
      ? 'createImageBitmap / OffscreenCanvas 지원'
      : '일부 미지원 — 전처리를 메인 스레드에서 처리해야 합니다',
    neededFor: 'P3 이미지 전처리',
  });

  // --- WebGPU: 있으면 더 빠른 추론 백엔드로 쓸 수 있다 (선택) ---
  const webgpu = 'gpu' in navigator;
  results.push({
    name: 'WebGPU (선택)',
    level: webgpu ? 'ok' : 'warn',
    detail: webgpu ? '사용 가능 — WASM 대신 쓰면 더 빠릅니다' : '미지원 — WASM 백엔드를 사용합니다',
    neededFor: 'P4 추론 속도 (선택)',
  });

  return results;
}

/** 치명적 문제가 있는지 */
export function hasBlockingFailure(results: readonly CheckResult[]): boolean {
  return results.some((r) => r.level === 'fail');
}
