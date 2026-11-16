/**
 * 영수증 등록 화면.
 *
 * 흐름: 여행 선택 → 사진 파일 선택 → 전처리 + OCR (ocr/pipeline.ts) → 결과 확인 → 저장 → 내용 입력
 *
 * 입력은 파일 선택만 둔다. 웹으로 서비스하므로 카메라 화면을 따로 만들지 않았다.
 * 휴대폰 브라우저에서는 파일 선택 창에서 "사진 찍기" 를 고를 수 있어 촬영도 이 경로로 된다.
 *
 * OCR 결과(글자와 좌표)는 영수증에 함께 저장한다. 품목·금액을 자동으로 채우는 파서는 P5.
 */
import { el, pageHeader, emptyState, phaseNote } from '../dom.ts';
import { navigate } from '../../router.ts';
import { listTrips } from '../../storage/trips.ts';
import { saveImage } from '../../storage/images.ts';
import { createReceipt } from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { canvasToBlob } from '../../image/preprocess.ts';
import { analyzeReceipt, type AnalyzeResult } from '../../ocr/pipeline.ts';
import { meanScore } from '../../image/geometry.ts';
import { totalModelMB } from '../../ocr/models.ts';
import { OCR_LANGUAGE_LABELS, tripOcrLanguage, type Trip } from '../../types.ts';

function note(text: string, kind: 'info' | 'ok' | 'fail' = 'info'): HTMLElement {
  return el('p', { class: `ocr-status ${kind}`, text });
}

const HINT = '영수증 사진 파일을 선택하세요';

export async function renderScan(): Promise<HTMLElement> {
  const trips = await listTrips();

  if (trips.length === 0) {
    return el('div', {},
      pageHeader('영수증 등록'),
      emptyState('먼저 여행을 만들어야 합니다.', '영수증은 여행에 속해 저장됩니다.'),
      el('a', { class: 'btn primary block', href: '#/trips/new' }, '여행 만들기'),
    );
  }

  const tripSelect = el('select', { class: 'input', id: 'scan-trip' });
  for (const t of trips) {
    tripSelect.appendChild(el('option', { value: t.id, text: `${t.name} (${t.destination})` }));
  }
  const currentTrip = (): Trip | undefined => trips.find((t) => t.id === tripSelect.value);
  const langHint = el('p', { class: 'field-hint' });
  const showLang = (): void => {
    const lang = tripOcrLanguage(currentTrip());
    langHint.textContent = `인식 언어: ${OCR_LANGUAGE_LABELS[lang]} — 여행 설정에서 바꿀 수 있습니다. ` +
      `첫 인식 때 모델 약 ${totalModelMB(lang).toFixed(0)}MB 를 내려받습니다.`;
  };
  tripSelect.addEventListener('change', showLang);
  showLang();

  const stage = el('div', { class: 'preview-box' }, el('span', { class: 'preview-hint', text: HINT }));
  const statusSlot = el('div', {});
  const linesSlot = el('div', {});
  const actionSlot = el('div', { class: 'btn-row' });
  let analyzed: AnalyzeResult | null = null;
  let busy = false;

  function reset(): void {
    analyzed = null;
    stage.replaceChildren(el('span', { class: 'preview-hint', text: HINT }));
    statusSlot.replaceChildren();
    linesSlot.replaceChildren();
    drawActions('idle');
  }

  async function run(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    drawActions('busy');
    linesSlot.replaceChildren();
    const lang = tripOcrLanguage(currentTrip());
    try {
      const bitmap = await createImageBitmap(file);
      try {
        analyzed = await analyzeReceipt(bitmap, {
          lang,
          onProgress: (m) => statusSlot.replaceChildren(note(m)),
        });
      } finally {
        bitmap.close();
      }
      const { canvas, result, snapshot } = analyzed;
      canvas.className = 'preview-img';
      stage.replaceChildren(
        canvas,
        el('p', { class: 'preview-meta', text: `${snapshot.steps.join(' → ')} · ${canvas.width}×${canvas.height}` }),
      );
      const n = result.lines.length;
      statusSlot.replaceChildren(n === 0
        ? note('글자를 찾지 못했습니다. 영수증이 화면에 크게 나오게 다시 찍어 보세요. 그래도 저장해서 직접 입력할 수 있습니다.', 'fail')
        : meanScore(result.lines) < 0.8
          ? note(`${n}개 글자 상자를 읽었지만 흐릿한 부분이 많습니다 (${(snapshot.ms.total / 1000).toFixed(1)}초). 저장 후 내용을 꼭 확인하세요.`, 'fail')
          : note(`${n}개 글자 상자를 읽었습니다 (${(snapshot.ms.total / 1000).toFixed(1)}초, 인식 ${snapshot.passes}회).`, 'ok'));
      linesSlot.replaceChildren(
        el('details', { class: 'ocr-raw' },
          el('summary', { text: `읽은 글자 보기 (${n}개)` }),
          el('pre', { class: 'ocr-raw-text',
            text: [...result.lines].sort((a, b) => a.centerY - b.centerY).map((l) => l.text).join('\n') }),
        ),
      );
      drawActions('ready');
    } catch (err) {
      console.error(err);
      statusSlot.replaceChildren(note(`인식 실패: ${err instanceof Error ? err.message : String(err)}`, 'fail'));
      drawActions('idle');
    } finally {
      busy = false;
    }
  }

  async function save(): Promise<void> {
    if (!analyzed) return;
    drawActions('busy');
    statusSlot.replaceChildren(note('저장 중…'));
    try {
      // OCR 좌표가 이 이미지 기준이므로, 원본이 아니라 인식에 쓴 이미지를 저장한다.
      const blob = await canvasToBlob(analyzed.canvas);
      const imageId = await saveImage(blob);
      const trip = currentTrip();
      const receipt = await createReceipt({
        tripId: tripSelect.value,
        imageId,
        merchant: '',
        purchasedAt: new Date().toISOString(),
        currency: trip?.currency ?? 'KRW',
        total: 0,
        tax: null,
        confidence: analyzed.result.lines.length ? meanScore(analyzed.result.lines) : null,
        // 품목·금액은 P5 파서가 채운다. 그 전까지는 대기 상태로 두고 직접 입력한다.
        status: 'pending',
        items: [],
        ocr: analyzed.snapshot,
      });
      void ensurePersistOnce();
      navigate(`/receipts/${receipt.id}/edit`);
    } catch (err) {
      console.error(err);
      statusSlot.replaceChildren(note(`저장 실패: ${err instanceof Error ? err.message : String(err)}`, 'fail'));
      drawActions('ready');
    }
  }

  function drawActions(mode: 'idle' | 'busy' | 'ready'): void {
    if (mode === 'busy') {
      actionSlot.replaceChildren(el('button', { class: 'btn', type: 'button', disabled: true }, '처리 중…'));
      return;
    }
    if (mode === 'ready') {
      actionSlot.replaceChildren(
        el('button', { class: 'btn primary', type: 'button', onclick: () => { void save(); } }, '저장하고 내용 입력'),
        el('button', { class: 'btn', type: 'button', onclick: reset }, '다른 사진'),
      );
      return;
    }
    actionSlot.replaceChildren(el('label', { class: 'btn primary', for: 'scan-file' }, '사진 선택'));
  }
  drawActions('idle');

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'scan-file',
    onchange: (ev: Event) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // 같은 파일을 다시 골라도 change 가 오도록
      if (file) void run(file);
    },
  });

  return el('div', {},
    pageHeader('영수증 등록', '사진은 이 브라우저 안에서만 처리·저장되며 외부로 전송되지 않습니다.'),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'scan-trip', text: '여행' }),
      tripSelect,
      langHint,
    ),
    stage,
    actionSlot,
    fileInput,
    statusSlot,
    linesSlot,
    phaseNote('P5', '지금은 읽은 글자를 저장하고 내용을 직접 입력합니다. 파서가 붙으면 품목과 금액이 자동으로 채워집니다.'),
  );
}
