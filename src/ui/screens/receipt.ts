/**
 * 영수증 상세 / 검수 화면.
 *
 * 이 프로젝트에서 가장 중요한 화면이다. OCR 이 100% 정확할 수 없다는 전제 위에서,
 * 교차검증으로 "의심스러운 영수증"을 골라내 사람이 빠르게 고치게 하는 것이 설계 목표다.
 * 수정·저장 후 품목과 총액을 다시 대조한다.
 */
import { el, pageHeader, emptyState } from '../dom.ts';
import { money, dateTime, percent } from '../format.ts';
import { getReceipt, confirmReceipt, deleteReceipt } from '../../storage/receipts.ts';
import { getTrip } from '../../storage/trips.ts';
import { imageObjectURL } from '../../storage/images.ts';
import { navigate } from '../../router.ts';
import { crossCheck, hasReceiptContent, type Receipt } from '../../types.ts';
import { prepareExchangeRates } from '../../exchange.ts';
import { conversionNote } from '../exchange-display.ts';
import { createDeleteButton } from '../delete-action.ts';
import { receiptBackPath } from '../travel-state.ts';
import { groupLinesByY, lineTolerance, toTextLines } from '../../ocr/lines.ts';

function checkBanner(r: Receipt): HTMLElement {
  const c = crossCheck(r);

  if (r.status === 'pending' || !hasReceiptContent(r)) {
    return el('div', { class: 'banner' },
      el('strong', { text: r.ocr ? '글자는 읽었고, 품목·금액은 아직 비어 있습니다.' : '아직 인식되지 않았습니다.' }),
      el('p', { text: r.ocr
        ? '수정 화면에서 OCR 결과를 반영하고 저장하세요.'
        : '이미지만 등록된 상태입니다.' }),
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

/** 읽은 글자를 위에서 아래, 같은 줄은 왼쪽부터 이어 붙여 원문 대조에 쓴다. */
function ocrText(lines: NonNullable<Receipt['ocr']>['lines']): string {
  const tl = toTextLines(lines);
  return groupLinesByY(tl, lineTolerance(tl)).map((g) => g.text).join('\n');
}

export async function renderReceipt(params: Record<string, string>): Promise<HTMLElement> {
  const receiptId = params['id'] ?? '';
  const savedReceipt = await getReceipt(receiptId);

  if (!savedReceipt) {
    return el('div', {},
      pageHeader('영수증'),
      emptyState('영수증을 찾을 수 없습니다.'),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

  const trip = savedReceipt.tripId ? await getTrip(savedReceipt.tripId) : undefined;
  const receipt = trip ? (await prepareExchangeRates([trip], [savedReceipt]))[0]! : savedReceipt;
  const backPath = receiptBackPath(receipt.id, receipt.tripId);
  const actionError = el('p', { class: 'field-hint', role: 'alert' });
  const c = crossCheck(receipt);

  const rows = receipt.items.map((item) =>
    el('tr', {},
      el('td', { text: item.name }),
      el('td', { class: 'num', text: String(item.quantity) }),
      el('td', { class: 'num', text: money(item.unitPrice, receipt.currency) }),
      el('td', { class: 'num', text: money(item.amount, receipt.currency) }),
      el('td', {}, el('span', { class: 'chip', text: item.category })),
    ),
  );

  return el('div', {},
    el('a', { class: 'back-link', href: `#${backPath}` },
      backPath === '/' ? '← 여행 목록' : `← ${trip?.name ?? '여행 미지정'}`),

    pageHeader(receipt.merchant || '(상호 미인식)', dateTime(receipt.purchasedAt)),

    checkBanner(receipt),

    // 저장된 원본 사진. 검수 중에 값이 맞는지 눈으로 대조하는 데 쓴다.
    receipt.imageId
      ? (() => {
          const box = el('div', { class: 'preview-box receipt-photo' },
            el('span', { class: 'preview-hint', text: '사진 불러오는 중…' }));
          void imageObjectURL(receipt.imageId).then((res) => {
            if (!res) {
              box.replaceChildren(el('span', { class: 'preview-hint', text: '사진을 찾을 수 없습니다.' }));
              return;
            }
            const img = el('img', { class: 'preview-img', alt: '영수증 원본', src: res.url });
            img.addEventListener('load', () => res.revoke(), { once: true });
            box.replaceChildren(img);
          });
          return box;
        })()
      : null,

    el('div', { class: 'summary-box' },
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '총액' }),
        el('span', { class: 'summary-value', text: money(receipt.total, receipt.currency) }),
        trip ? conversionNote(receipt, trip.currency, true) : null,
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

    receipt.ocr
      ? el('details', { class: 'ocr-raw' },
          el('summary', { text: `읽은 글자 (${receipt.ocr.lines.length}개 · ${receipt.ocr.lang === 'korean' ? '한국어' : '일본어·중국어'} 모델 · ${(receipt.ocr.ms.total / 1000).toFixed(1)}초)` }),
          el('pre', { class: 'ocr-raw-text', text: ocrText(receipt.ocr.lines) }),
        )
      : null,

    el('h2', { class: 'section-title', text: '품목' }),
    receipt.items.length === 0
      ? emptyState('추출된 품목이 없습니다.')
      : el('div', { class: 'table-wrap' },
          el('table', { class: 'items' },
            el('thead', {},
              el('tr', {},
                el('th', { text: '품목' }),
                el('th', { class: 'num', text: '수량' }),
                el('th', { class: 'num', text: '단가' }),
                el('th', { class: 'num', text: '금액' }),
                el('th', { text: '분류' }),
              ),
            ),
            el('tbody', {}, ...rows),
          ),
        ),

    el('div', { class: 'btn-row' },
      receipt.status === 'confirmed' || !hasReceiptContent(receipt)
        ? null
        : el('button', { class: 'btn primary', type: 'button',
            onclick: (ev: Event) => {
              const btn = ev.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              void confirmReceipt(receipt.id).then(() => navigate(backPath)).catch(err => {
                btn.disabled = false;
                actionError.textContent = err instanceof Error ? err.message : '확인하지 못했습니다.';
              });
            } }, '확인 완료로 표시'),
      el('a', { class: 'btn', href: `#/receipts/${receipt.id}/edit` }, '수정'),
      createDeleteButton({
        label: '영수증 삭제',
        message: '이 영수증을 삭제할까요? 연결된 사진도 함께 삭제되며 되돌릴 수 없습니다.',
        remove: () => deleteReceipt(receipt.id), destination: backPath,
        onError: message => { actionError.textContent = message; },
      }),
    ),
    actionError,

  );
}
