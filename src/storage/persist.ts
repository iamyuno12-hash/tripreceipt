/**
 * 영구 저장 권한.
 *
 * 기본 상태의 IndexedDB 는 "best-effort" 라, 기기 저장 공간이 부족하면 브라우저가
 * 말없이 지울 수 있다. 백엔드가 없어서 지워지면 복구할 방법이 없으므로,
 * 사용자가 데이터를 처음 만든 직후에 권한을 요청한다.
 *
 * 권한은 브라우저가 알아서 판단한다(방문 빈도, 북마크 여부 등). 거절돼도
 * 앱은 그대로 동작하고, 설정 화면에서 현재 상태를 보여 준다.
 */

export type PersistState = 'granted' | 'denied' | 'unsupported';

export async function persistState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersist(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * 첫 데이터 생성 직후 한 번만 조용히 시도한다.
 * 실패해도 사용자 흐름을 막지 않는다.
 */
let attempted = false;
export async function ensurePersistOnce(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    await requestPersist();
  } catch {
    /* 무시 */
  }
}

export async function storageEstimate(): Promise<{ quota: number; usage: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return { quota: quota ?? 0, usage: usage ?? 0 };
  } catch {
    return null;
  }
}
