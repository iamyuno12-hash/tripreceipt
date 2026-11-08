/** 설정 화면. 모델 상태와 데이터 관리, 그리고 환경 점검 진입점. */
import { el, pageHeader, phaseNote } from '../dom.ts';
import { DETECTION_MODEL, RECOGNITION_MODELS, totalModelMB } from '../../ocr/models.ts';

function row(label: string, value: string, extra?: HTMLElement): HTMLElement {
  return el('div', { class: 'setting-row' },
    el('div', {},
      el('span', { class: 'setting-label', text: label }),
      el('span', { class: 'setting-value', text: value }),
    ),
    extra ?? null,
  );
}

export function renderSettings(): HTMLElement {
  return el('div', {},
    pageHeader('설정'),

    el('h2', { class: 'section-title', text: 'OCR 모델' }),
    el('div', { class: 'card' },
      row('검출 모델', `${DETECTION_MODEL.modelName} (${DETECTION_MODEL.approxMB}MB)`),
      row('인식 모델 (한국어)',
        `${RECOGNITION_MODELS.korean.modelName} (${RECOGNITION_MODELS.korean.approxMB}MB)`),
      row('합계', `${totalModelMB()}MB`),
    ),

    el('h2', { class: 'section-title', text: '데이터' }),
    el('div', { class: 'card' },
      row('저장 위치', '이 브라우저 (IndexedDB)'),
      row('외부 전송', '없음'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', type: 'button',
          onclick: () => alert('CSV 내보내기는 P6 에서 구현합니다.') }, 'CSV 내보내기'),
        el('button', { class: 'btn danger', type: 'button',
          onclick: () => alert('데이터 삭제는 P2 에서 구현합니다.') }, '전체 삭제'),
      ),
    ),

    el('h2', { class: 'section-title', text: '진단' }),
    el('div', { class: 'card' },
      row('브라우저 환경 점검', '이후 단계가 의존하는 기능 확인',
        el('a', { class: 'btn', href: '#/settings/env' }, '열기')),
    ),

    phaseNote('P2·P6', '영구 저장 권한 요청과 내보내기가 연결됩니다.'),
  );
}
