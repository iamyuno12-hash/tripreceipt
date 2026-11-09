/** 여행 생성·수정 폼. */
import { el, pageHeader } from '../dom.ts';
import { field, selectField, readForm, errorBox, CURRENCIES } from '../form.ts';
import { createTrip, getTrip, updateTrip, deleteTrip } from '../../storage/trips.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { navigate } from '../../router.ts';

export async function renderTripForm(params: Record<string, string>): Promise<HTMLElement> {
  const id = params['id'];
  const editing = id !== undefined;
  const trip = editing ? await getTrip(id) : undefined;

  if (editing && !trip) {
    return el('div', {},
      pageHeader('여행 수정'),
      el('p', { class: 'empty', text: '여행을 찾을 수 없습니다.' }),
      el('a', { class: 'btn', href: '#/' }, '← 여행 목록'),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const errorSlot = el('div', {});

  const form = el('form', { class: 'form', novalidate: 'true' },
    field({ label: '여행 이름', name: 'name', required: true,
      value: trip?.name ?? '', placeholder: '예: 오사카 3박 4일' }),
    field({ label: '지역', name: 'destination', required: true,
      value: trip?.destination ?? '', placeholder: '예: 일본 오사카',
      hint: 'P6 에서 이 지역에 맞는 인식 모델을 고르는 데 쓰입니다.' }),
    el('div', { class: 'field-row' },
      field({ label: '시작일', name: 'startDate', type: 'date', required: true,
        value: trip?.startDate ?? today }),
      field({ label: '종료일', name: 'endDate', type: 'date', required: true,
        value: trip?.endDate ?? today }),
    ),
    selectField('통화', 'currency', CURRENCIES, trip?.currency ?? 'KRW'),
    errorSlot,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', type: 'submit' }, editing ? '저장' : '만들기'),
      el('a', { class: 'btn', href: editing ? `#/trips/${id}` : '#/' }, '취소'),
    ),
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errorSlot.replaceChildren();
    const v = readForm(form);

    if (!v['name']) { errorSlot.replaceChildren(errorBox('여행 이름을 입력하세요.')); return; }
    if (!v['destination']) { errorSlot.replaceChildren(errorBox('지역을 입력하세요.')); return; }
    if ((v['endDate'] ?? '') < (v['startDate'] ?? '')) {
      errorSlot.replaceChildren(errorBox('종료일이 시작일보다 빠릅니다.'));
      return;
    }

    const draft = {
      name: v['name'] ?? '',
      destination: v['destination'] ?? '',
      startDate: v['startDate'] ?? today,
      endDate: v['endDate'] ?? today,
      currency: v['currency'] ?? 'KRW',
    };

    void (async () => {
      try {
        if (editing && id !== undefined) {
          await updateTrip(id, draft);
          navigate(`/trips/${id}`);
        } else {
          const created = await createTrip(draft);
          // 사용자가 처음 데이터를 만든 시점에 영구 저장 권한을 조용히 요청한다.
          void ensurePersistOnce();
          navigate(`/trips/${created.id}`);
        }
      } catch (err) {
        errorSlot.replaceChildren(
          errorBox(`저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    })();
  });

  return el('div', {},
    el('a', { class: 'back-link', href: editing ? `#/trips/${id}` : '#/' }, '← 돌아가기'),
    pageHeader(editing ? '여행 수정' : '새 여행'),
    form,
    editing && id !== undefined
      ? el('div', { class: 'danger-zone' },
          el('h2', { class: 'section-title', text: '여행 삭제' }),
          el('p', { class: 'field-hint',
            text: '이 여행의 영수증과 사진이 함께 삭제됩니다. 되돌릴 수 없습니다.' }),
          el('button', { class: 'btn danger', type: 'button',
            onclick: () => {
              if (!confirm(`"${trip?.name}" 을(를) 삭제할까요? 영수증도 함께 사라집니다.`)) return;
              void deleteTrip(id).then(() => navigate('/'));
            } }, '여행 삭제'),
        )
      : null,
  );
}
