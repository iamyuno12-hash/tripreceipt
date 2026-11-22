import { el } from './dom.ts';

/** 등록과 집계 기준을 현재 저장·검수·환산 동작에 맞춰 설명한다. */
export function registrationGuide(): HTMLElement {
  return el('aside', { class: 'registration-guide', 'aria-label': '영수증 등록·검수 안내' },
    el('p', { class: 'registration-flow' },
      el('strong', { class: 'registration-flow-label', text: '이용 순서' }),
      el('span', { class: 'registration-flow-steps', text: '여행 선택 → 사진 또는 직접 입력 → 내용 확인·저장 → 통계' }),
    ),
    el('details', {},
      el('summary', { text: '저장·검수·집계 기준 안내' }),
      el('dl', { class: 'guide-status-list' },
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'status status-pending guide-status-tag', text: '인식 대기' })),
          el('dd', { text: '품목·금액을 아직 저장하지 않은 상태입니다. 내용을 저장하기 전에는 지출과 통계에 포함되지 않습니다.' }),
        ),
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'status status-needs_review guide-status-tag', text: '검수 필요' })),
          el('dd', { text: '품목 합계와 영수증 총액이 다른 상태입니다. 저장된 총액은 총지출에 포함하지만, 분류·월별 추이·여행 비교에서는 금액을 고치거나 확인 완료로 표시하기 전까지 제외됩니다.' }),
        ),
        el('div', { class: 'guide-status-row' },
          el('dt', {}, el('span', { class: 'badge warn guide-status-tag', text: '환산 대기' })),
          el('dd', { text: '환율이 없어 집계에서 빠진 상태입니다. 영수증 수정 화면에서 환율을 입력하거나 조회할 수 있습니다. 다른 결제 통화는 여행의 집계 기준 통화로 환산됩니다.' }),
        ),
      ),
    ),
  );
}
