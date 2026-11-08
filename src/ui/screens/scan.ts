/**
 * 영수증 스캔 화면.
 *
 * P1 에서는 입력 경로(촬영 / 파일 선택)와 처리 단계 안내만 보여준다.
 * 실제 촬영·전처리는 P3, OCR 은 P4 에서 붙는다.
 */
import { el, pageHeader, phaseNote } from '../dom.ts';
import { totalModelMB } from '../../ocr/models.ts';

const STEPS: readonly (readonly [string, string, string])[] = [
  ['1', '이미지 입력', '카메라로 찍거나 갤러리에서 고릅니다'],
  ['2', '전처리', 'OpenCV.js 로 기울기 보정과 대비 개선'],
  ['3', '문자 인식', 'PP-OCRv5 모델로 글자 위치와 내용을 읽습니다'],
  ['4', '지출 정보 추출', '좌표로 줄을 묶어 품목과 금액을 분리합니다'],
  ['5', '교차검증', '품목 합계와 총액을 맞춰 보고 다르면 검수로 넘깁니다'],
];

export function renderScan(): HTMLElement {
  const preview = el('div', { class: 'preview-box' },
    el('span', { class: 'preview-hint', text: '선택한 이미지가 여기에 표시됩니다' }),
  );

  // P1 에서도 파일 선택은 실제로 동작시켜 미리보기까지 확인할 수 있게 한다.
  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    id: 'receipt-file',
    onchange: (ev: Event) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = el('img', { class: 'preview-img', alt: '선택한 영수증', src: url });
      img.addEventListener('load', () => URL.revokeObjectURL(url));
      preview.replaceChildren(img,
        el('p', { class: 'preview-meta',
          text: `${file.name} · ${(file.size / 1024).toFixed(0)}KB` }));
    },
  });

  return el('div', {},
    pageHeader('영수증 스캔', '사진은 이 브라우저 안에만 저장되며 외부로 전송되지 않습니다.'),

    preview,

    el('div', { class: 'btn-row' },
      el('label', { class: 'btn primary', for: 'receipt-file' }, '파일 선택'),
      el('button', { class: 'btn', type: 'button',
        onclick: () => alert('카메라 촬영은 P3 에서 구현합니다.') }, '카메라로 촬영'),
    ),
    fileInput,

    el('h2', { class: 'section-title', text: '처리 단계' }),
    el('ol', { class: 'steps' },
      ...STEPS.map(([n, title, desc]) =>
        el('li', { class: 'step' },
          el('span', { class: 'step-num', text: n }),
          el('div', {},
            el('span', { class: 'step-title', text: title }),
            el('span', { class: 'step-desc', text: desc }),
          ),
        ),
      ),
    ),

    phaseNote('P3·P4', `촬영과 전처리는 P3, OCR 추론은 P4 에서 붙습니다. 모델 ${totalModelMB()}MB 는 첫 사용 시 한 번만 내려받습니다.`),
  );
}
