/** 설정 화면. 저장 상태 확인과 데이터 관리. */
import { el, pageHeader, phaseNote } from '../dom.ts';
import { DETECTION_MODEL, RECOGNITION_MODELS, totalModelMB } from '../../ocr/models.ts';
import { clearAll, usage } from '../../storage/db.ts';
import { isSampleLoaded } from '../../storage/meta.ts';
import { loadSample, removeSample } from '../../storage/seed.ts';
import { persistState, requestPersist, storageEstimate } from '../../storage/persist.ts';

function row(label: string, value: string, extra?: HTMLElement | null): HTMLElement {
  return el('div', { class: 'setting-row' },
    el('div', {},
      el('span', { class: 'setting-label', text: label }),
      el('span', { class: 'setting-value', text: value }),
    ),
    extra ?? null,
  );
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

const PERSIST_TEXT = {
  granted: '허용됨 — 브라우저가 데이터를 임의로 지우지 않습니다',
  denied: '미허용 — 저장 공간이 부족하면 데이터가 지워질 수 있습니다',
  unsupported: '이 브라우저는 지원하지 않습니다',
} as const;

function reload(): void {
  globalThis.location.reload();
}

export async function renderSettings(): Promise<HTMLElement> {
  const [counts, sample, persist, estimate] = await Promise.all([
    usage(),
    isSampleLoaded(),
    persistState(),
    storageEstimate(),
  ]);

  const persistRow = el('div', {});
  function drawPersist(state: keyof typeof PERSIST_TEXT): void {
    persistRow.replaceChildren(
      row('영구 저장 권한', PERSIST_TEXT[state],
        state === 'denied'
          ? el('button', { class: 'btn', type: 'button',
              onclick: (ev: Event) => {
                const btn = ev.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                void requestPersist().then((next) => drawPersist(next));
              } }, '요청')
          : null),
    );
  }
  drawPersist(persist);

  return el('div', {},
    pageHeader('설정'),

    el('h2', { class: 'section-title', text: '저장 상태' }),
    el('div', { class: 'card' },
      row('저장 위치', '이 브라우저 (IndexedDB) — 외부 전송 없음'),
      row('저장된 데이터',
        `여행 ${counts.trips}개 · 영수증 ${counts.receipts}장 · 사진 ${counts.images}장`),
      estimate
        ? row('사용량', `${mb(estimate.usage)} / ${mb(estimate.quota)}`)
        : null,
      persistRow,
    ),

    el('h2', { class: 'section-title', text: '샘플 데이터' }),
    el('div', { class: 'card' },
      row('상태', sample ? '들어 있음' : '없음'),
      el('p', { class: 'field-hint',
        text: '샘플은 실제 인식 결과가 아니라 화면 확인용 예시입니다. 직접 만든 데이터는 영향을 받지 않습니다.' }),
      el('div', { class: 'btn-row' },
        sample
          ? el('button', { class: 'btn', type: 'button',
              onclick: (ev: Event) => {
                (ev.currentTarget as HTMLButtonElement).disabled = true;
                void removeSample().then(reload);
              } }, '샘플 데이터 지우기')
          : el('button', { class: 'btn', type: 'button',
              onclick: (ev: Event) => {
                (ev.currentTarget as HTMLButtonElement).disabled = true;
                void loadSample().then(reload);
              } }, '샘플 데이터 넣기'),
      ),
    ),

    el('h2', { class: 'section-title', text: 'OCR 모델' }),
    el('div', { class: 'card' },
      row('검출 모델', `${DETECTION_MODEL.modelName} (${DETECTION_MODEL.approxMB}MB)`),
      row('인식 모델 (한국어)',
        `${RECOGNITION_MODELS.korean.modelName} (${RECOGNITION_MODELS.korean.approxMB}MB)`),
      row('합계', `${totalModelMB()}MB — 첫 인식 때 내려받습니다`),
    ),

    el('h2', { class: 'section-title', text: '진단' }),
    el('div', { class: 'card' },
      row('브라우저 환경 점검', '이후 단계가 의존하는 기능 확인',
        el('a', { class: 'btn', href: '#/settings/env' }, '열기')),
    ),

    el('div', { class: 'danger-zone' },
      el('h2', { class: 'section-title', text: '전체 삭제' }),
      el('p', { class: 'field-hint',
        text: '여행·영수증·사진이 모두 지워집니다. 백엔드가 없어 되돌릴 수 없습니다.' }),
      el('button', { class: 'btn danger', type: 'button',
        onclick: () => {
          if (!confirm('모든 데이터를 삭제할까요? 되돌릴 수 없습니다.')) return;
          void clearAll().then(reload);
        } }, '전체 삭제'),
    ),

    phaseNote('P6', 'CSV 내보내기가 추가되면 삭제 전에 데이터를 백업할 수 있습니다.'),
  );
}
