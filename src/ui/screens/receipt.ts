/**
 * 영수증 상세 / 검수 화면.
 *
 * 이 프로젝트에서 가장 중요한 화면이다. OCR 이 100% 정확할 수 없다는 전제 위에서,
 * 교차검증으로 "의심스러운 영수증"을 골라내 사람이 빠르게 고치게 하는 것이 설계 목표다.
 * P5 에서 실제 수정·저장이 연결된다.
 */
import { el, pageHeader, emptyState, phaseNote } from '../dom.ts';
import { money, dateTime, percent } from '../format.ts';
import { findReceipt, findTrip } from '../../data/dummy.ts';
import { crossCheck, type Receipt } from '../../types.ts';

function checkBanner(r: Receipt): HTMLElement {
  const c = crossCheck(r);

  if (r.status === 'pending') {
    return el('div', { class: 'banner' },
      el('strong', { text: '아직 인식되지 않았습니다.' }),
      el('p', { text: '이미지만 등록된 상태입니다.' }),
    );
  }

  if (c.matches) {
    return el('div', { class: 'banner ok' },
      el('strong', { text: '교차검증 통과' }),
      el('p', { text: `품목 합계 ${money(c.itemsTotal, r.currency)} 가 총액과 일치합니다.` }),
    );
  }

  return el('div', { class: 'banner warn' },
    el('strong', { text: '교차검증 실패 — 확인이 필요합니다' }),
    el('p', { text: `품목 합계 ${money(c.itemsTotal, r.currency)}, 영수증 총액 ${money(c.statedTotal, r.currency)} (차이 ${money(Math.abs(c.difference), r.currency)})` }),
    el('p', { class: 'banner-hint',
      text: '합계·부가세 같은 줄이 품목으로 잘못 들어갔을 수 있습니다. 아래 표에서 해당 줄을 지우세요.' }),
  );
}

export function renderReceipt(params: Record<string, string>): HTMLElement {
  const receipt = findReceipt(params['id'] ?? '');

  if (!receipt) {
    return el('div', {},
      pageHeader('영수증'),
      emptyState('영수증을 찾을 수 없습니다.'),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

  const trip = findTrip(receipt.tripId);
  const c = crossCheck(receipt);

  const rows = receipt.items.map((item) =>
    el('tr', {},
      el('td', { text: item.name }),
      el('td', { class: 'num', text: String(item.quantity) }),
      el('td', { class: 'num', text: money(item.amount, receipt.currency) }),
      el('td', {}, el('span', { class: 'chip', text: item.category })),
      el('td', { class: 'num' },
        el('button', { class: 'btn tiny', type: 'button',
          onclick: () => alert('품목 수정·삭제는 P5 에서 구현합니다.') }, '수정'),
      ),
    ),
  );

  return el('div', {},
    trip
      ? el('a', { class: 'back-link', href: `#/trips/${trip.id}` }, `← ${trip.name}`)
      : el('a', { class: 'back-link', href: '#/' }, '← 여행 목록'),

    pageHeader(receipt.merchant || '(상호 미인식)', dateTime(receipt.purchasedAt)),

    checkBanner(receipt),

    el('div', { class: 'summary-box' },
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '총액' }),
        el('span', { class: 'summary-value', text: money(receipt.total, receipt.currency) }),
      ),
      receipt.tax !== null
        ? el('div', { class: 'summary-item' },
            el('span', { class: 'summary-label', text: '부가세' }),
            el('span', { class: 'summary-value', text: money(receipt.tax, receipt.currency) }),
          )
        : null,
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '품목 합계' }),
        el('span', { class: c.matches ? 'summary-value' : 'summary-value warn',
          text: money(c.itemsTotal, receipt.currency) }),
      ),
      receipt.confidence !== null
        ? el('div', { class: 'summary-item' },
            el('span', { class: 'summary-label', text: '인식 신뢰도' }),
            el('span', { class: 'summary-value', text: percent(receipt.confidence) }),
          )
        : null,
    ),

    el('h2', { class: 'section-title', text: '품목' }),
    receipt.items.length === 0
      ? emptyState('추출된 품목이 없습니다.')
      : el('div', { class: 'table-wrap' },
          el('table', { class: 'items' },
            el('thead', {},
              el('tr', {},
                el('th', { text: '품목' }),
                el('th', { class: 'num', text: '수량' }),
                el('th', { class: 'num', text: '금액' }),
                el('th', { text: '분류' }),
                el('th', { class: 'num', text: '' }),
              ),
            ),
            el('tbody', {}, ...rows),
          ),
        ),

    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'button',
        onclick: () => alert('확인 처리는 P5 에서 구현합니다.') }, '확인 완료로 표시'),
      el('button', { class: 'btn', type: 'button',
        onclick: () => alert('재인식은 P4 에서 구현합니다.') }, '다시 인식'),
    ),

    phaseNote('P5', '품목 추가·수정·삭제와 확인 처리가 연결됩니다.'),
  );
}
