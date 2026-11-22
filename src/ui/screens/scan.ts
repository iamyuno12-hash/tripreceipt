/**
 * 영수증 등록 화면.
 *
 * 흐름: 여행 선택 → 사진 파일 선택 → 전처리 + OCR (ocr/pipeline.ts) → 결과 확인 → 저장 → 내용 입력
 *
 * 입력은 파일 선택만 둔다. 웹으로 서비스하므로 카메라 화면을 따로 만들지 않았다.
 * 휴대폰 브라우저에서는 파일 선택 창에서 "사진 찍기" 를 고를 수 있어 촬영도 이 경로로 된다.
 *
 * OCR 결과(글자와 좌표)를 저장하고, 수정 화면에서 품목·금액을 추출해 확인·저장한다.
 */
import { el, pageHeader, emptyState } from '../dom.ts';
import { navigate } from '../../router.ts';
import { listTrips } from '../../storage/trips.ts';
import { saveImage, deleteImage } from '../../storage/images.ts';
import { createReceipt } from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { canvasToBlob } from '../../image/preprocess.ts';
import { analyzeReceipt, type AnalyzeResult } from '../../ocr/pipeline.ts';
import { meanScore } from '../../image/geometry.ts';
import { totalModelMB } from '../../ocr/models.ts';
import { OCR_LANGUAGES, OCR_LANGUAGE_LABELS, suggestOcrLanguage, tripOcrLanguage, type Trip, type OcrLanguage } from '../../types.ts';
import { registrationGuide } from '../registration-guide.ts';
import { CURRENCIES, selectField } from '../form.ts';
import { travelPath } from '../travel-state.ts';

function note(text: string, kind: 'info' | 'ok' | 'fail' = 'info'): HTMLElement {
  return el('p', { class: `ocr-status ${kind}`, text });
}

const HINT = '영수증 사진 파일을 선택하세요';

export async function renderScan(params: Record<string, string> = {}): Promise<HTMLElement> {
  const trips = await listTrips();

  if (params['tripId'] && !trips.some(trip => trip.id === params['tripId'])) {
    return el('div', {},
      pageHeader('영수증 등록'),
      registrationGuide(),
      emptyState('여행을 찾을 수 없습니다.', '여행 화면에서 다시 등록해 주세요.'),
      el('a', { class: 'btn primary block', href: '#/' }, '여행으로 이동'),
    );
  }

  const tripSelect = el('select', { class: 'input', id: 'scan-trip' });
  tripSelect.appendChild(el('option', { value: '', text: '여행 미지정' }));
  for (const t of trips) {
    tripSelect.appendChild(el('option', { value: t.id, text: `${t.name} (${t.destination})` }));
  }
  tripSelect.value = params['tripId'] ?? trips[0]?.id ?? '';
  const currentTrip = (): Trip | undefined => trips.find((t) => t.id === tripSelect.value);
  const currencyField = selectField('결제 통화', 'scanCurrency', CURRENCIES,
    CURRENCIES.some(([code]) => code === params['currency']) ? params['currency'] : currentTrip()?.currency ?? 'KRW');
  const currencyInput = currencyField.querySelector<HTMLSelectElement>('select')!;
  const languageField = selectField('OCR 인식 언어', 'scanLanguage', OCR_LANGUAGES.map(lang => [lang, OCR_LANGUAGE_LABELS[lang]] as const),
    OCR_LANGUAGES.includes(params['lang'] as OcrLanguage) ? params['lang'] : 'korean');
  const languageInput = languageField.querySelector<HTMLSelectElement>('select')!;
  let languageTouched = OCR_LANGUAGES.includes(params['lang'] as OcrLanguage);
  const currentLanguage = (): OcrLanguage => currentTrip() ? tripOcrLanguage(currentTrip()) : languageInput.value as OcrLanguage;
  const backLink = el('a', { class: 'back-link', href: '#/' }, '← 여행');
  const langHint = el('p', { class: 'field-hint' });
  const showLang = (): void => {
    const lang = currentLanguage();
    currencyField.hidden = !!currentTrip(); languageField.hidden = !!currentTrip();
    backLink.href = `#${travelPath(currentTrip()?.id ?? null)}`;
    langHint.textContent = `인식 언어: ${OCR_LANGUAGE_LABELS[lang]}${currentTrip() ? ' — 여행 설정에서 바꿀 수 있습니다.' : ''} ` +
      `첫 인식 때 모델 약 ${totalModelMB(lang).toFixed(0)}MB 를 내려받습니다.`;
  };
  tripSelect.addEventListener('change', () => {
    if (currentTrip()) currencyInput.value = currentTrip()!.currency;
    if (analyzed && analyzed.snapshot.lang !== currentLanguage()) reset();
    showLang();
  });
  languageInput.addEventListener('change', () => {
    languageTouched = true;
    if (analyzed && analyzed.snapshot.lang !== currentLanguage()) reset();
    showLang();
  });
  currencyInput.addEventListener('change', () => {
    if (!analyzed && !languageTouched) languageInput.value = suggestOcrLanguage(currencyInput.value);
    showLang();
  });
  showLang();

  const stage = el('div', { class: 'preview-box' }, el('span', { class: 'preview-hint', text: HINT }));
  const statusSlot = el('div', {});
  const linesSlot = el('div', {});
  const actionSlot = el('div', { class: 'btn-row' });
  const actionHintSlot = el('div', {});
  let analyzed: AnalyzeResult | null = null;
  let busy = false;
  let saving = false;

  function reset(): void {
    analyzed = null;
    stage.replaceChildren(el('span', { class: 'preview-hint', text: HINT }));
    statusSlot.replaceChildren();
    linesSlot.replaceChildren();
    drawActions('idle');
  }

  async function run(file: File): Promise<void> {
    if (busy || saving) return;
    busy = true;
    drawActions('busy');
    linesSlot.replaceChildren();
    const lang = currentLanguage();
    analyzed = null;
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
    if (!analyzed || saving) return;
    saving = true;
    let unsavedImage: string | null = null;
    drawActions('busy');
    statusSlot.replaceChildren(note('저장 중…'));
    try {
      // OCR 좌표가 이 이미지 기준이므로, 원본이 아니라 인식에 쓴 이미지를 저장한다.
      const blob = await canvasToBlob(analyzed.canvas);
      const imageId = await saveImage(blob);
      unsavedImage = imageId;
      const trip = currentTrip();
      const receipt = await createReceipt({
        tripId: tripSelect.value || null,
        imageId,
        merchant: '',
        purchasedAt: new Date().toISOString(),
        currency: trip?.currency ?? currencyInput.value,
        total: 0,
        tax: null,
        confidence: analyzed.result.lines.length ? meanScore(analyzed.result.lines) : null,
        // 먼저 사진·OCR 원문을 등록한다. 추출된 품목·금액은 수정 화면의 저장으로 확정한다.
        status: 'pending',
        items: [],
        ocr: analyzed.snapshot,
      });
      unsavedImage = null;
      void ensurePersistOnce();
      navigate(`/receipts/${receipt.id}/edit`);
    } catch (err) {
      if (unsavedImage) await deleteImage(unsavedImage).catch(() => {});
      console.error(err);
      statusSlot.replaceChildren(note(`저장 실패: ${err instanceof Error ? err.message : String(err)}`, 'fail'));
      drawActions('ready');
    } finally { saving = false; }
  }

  function drawActions(mode: 'idle' | 'busy' | 'ready'): void {
    for (const input of [tripSelect, currencyInput, languageInput]) input.disabled = mode === 'busy';
    actionHintSlot.replaceChildren(...(mode === 'ready' ? [el('p', { class: 'field-hint',
      text: '사진과 읽은 글자를 먼저 등록합니다. 다음 수정 화면에서 내용을 확인하고 저장을 눌러 주세요.' })] : []));
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

  return el('div', { class: 'scan-page' },
    registrationGuide(),
    backLink,
    pageHeader('영수증 등록', '사진은 이 브라우저 안에서만 처리·저장되며 외부로 전송되지 않습니다.'),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'scan-trip', text: '여행' }),
      tripSelect,
    ),
    currencyField, languageField, langHint,
    stage,
    actionSlot,
    actionHintSlot,
    fileInput,
    statusSlot,
    linesSlot,
  );
}
