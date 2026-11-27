/**
 * 영수증 등록 화면.
 *
 * 흐름: 인식 언어 확인 → 사진 파일 선택 → 전처리와 OCR → 사진 등록 → 내용 확인·저장
 *
 * 입력은 파일 선택만 둔다. 웹으로 서비스하므로 카메라 화면을 따로 만들지 않았다.
 * 휴대폰 브라우저에서는 파일 선택 창에서 "사진 찍기" 를 고를 수 있어 촬영도 이 경로로 된다.
 *
 * OCR 결과(글자와 좌표)를 저장하고, 수정 화면에서 품목·금액을 추출해 확인·저장한다.
 */
import { el, pageHeader, emptyState } from '../dom.ts';
import { navigate } from '../../router.ts';
import { getTrip, listTrips } from '../../storage/trips.ts';
import { saveImage, deleteImage } from '../../storage/images.ts';
import { createReceipt } from '../../storage/receipts.ts';
import { ensurePersistOnce } from '../../storage/persist.ts';
import { canvasToBlob } from '../../image/preprocess.ts';
import { analyzeReceipt, type AnalyzeResult } from '../../ocr/pipeline.ts';
import { meanScore } from '../../image/geometry.ts';
import { totalModelMB } from '../../ocr/models.ts';
import { OCR_LANGUAGES, OCR_LANGUAGE_LABELS, suggestOcrLanguage, type OcrLanguage } from '../../types.ts';
import { registrationGuide } from '../registration-guide.ts';
import { selectField } from '../form.ts';
import { travelPath } from '../travel-state.ts';

function note(text: string, kind: 'info' | 'ok' | 'fail' = 'info'): HTMLElement {
  return el('p', { class: `ocr-status ${kind}`, text });
}

const HINT = '영수증 사진 파일을 선택하세요';

export async function renderScan(params: Record<string, string> = {}): Promise<HTMLElement> {
  const requestedTripId = params['tripId'];
  const trip = requestedTripId === undefined
    ? (await listTrips())[0]
    : requestedTripId ? await getTrip(requestedTripId) : undefined;

  if (requestedTripId && !trip) {
    return el('div', {},
      pageHeader('영수증 등록'),
      registrationGuide(),
      emptyState('여행을 찾을 수 없습니다.', '여행 화면에서 다시 등록해 주세요.'),
      el('a', { class: 'btn primary block', href: '#/' }, '여행으로 이동'),
    );
  }

  const tripId = trip?.id ?? null;
  const currency = trip?.currency ?? 'KRW';
  const languageField = selectField('OCR 인식 언어', 'scanLanguage',
    OCR_LANGUAGES.map(lang => [lang, OCR_LANGUAGE_LABELS[lang]] as const),
    trip?.ocrLanguage ?? suggestOcrLanguage(currency));
  const languageInput = languageField.querySelector<HTMLSelectElement>('select')!;
  const langHint = el('p', { class: 'field-hint' });
  languageField.append(langHint);

  function showLangHint(): void {
    langHint.textContent = `영수증에 적힌 언어를 선택하세요. 첫 인식 때 모델 약 ${totalModelMB(languageInput.value as OcrLanguage).toFixed(0)}MB를 내려받습니다.`;
  }
  showLangHint();

  const stage = el('div', { class: 'preview-box' }, el('span', { class: 'preview-hint', text: HINT }));
  const statusSlot = el('div', {});
  const linesSlot = el('div', {});
  const actionSlot = el('div', { class: 'btn-row' });
  const actionHintSlot = el('div', {});
  let selectedFile: File | null = null;
  let analyzed: AnalyzeResult | null = null;
  let busy = false;
  let saving = false;

  languageInput.addEventListener('change', () => {
    showLangHint();
    if (selectedFile) void run(selectedFile);
  });

  async function run(file: File): Promise<void> {
    if (busy || saving) return;
    busy = true;
    selectedFile = file;
    analyzed = null;
    drawActions('busy');
    stage.replaceChildren(el('span', { class: 'preview-hint', text: '영수증 사진을 읽는 중…' }));
    statusSlot.replaceChildren();
    linesSlot.replaceChildren();
    const lang = languageInput.value as OcrLanguage;
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
        ? note('글자를 찾지 못했습니다. 사진을 바꾸거나, 이 사진을 등록하고 내용을 직접 입력할 수 있습니다.', 'fail')
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
      stage.replaceChildren(el('span', { class: 'preview-hint', text: HINT }));
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
    statusSlot.replaceChildren(note('등록 중…'));
    try {
      // OCR 좌표가 이 이미지 기준이므로, 원본이 아니라 인식에 쓴 이미지를 저장한다.
      const blob = await canvasToBlob(analyzed.canvas);
      const imageId = await saveImage(blob);
      unsavedImage = imageId;
      const receipt = await createReceipt({
        tripId,
        imageId,
        merchant: '',
        purchasedAt: new Date().toISOString(),
        currency,
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
      statusSlot.replaceChildren(note(`등록 실패: ${err instanceof Error ? err.message : String(err)}`, 'fail'));
      drawActions('ready');
    } finally { saving = false; }
  }

  function drawActions(mode: 'idle' | 'busy' | 'ready'): void {
    languageInput.disabled = mode === 'busy';
    fileInput.disabled = mode === 'busy';
    actionHintSlot.replaceChildren(...(mode === 'ready' ? [el('p', { class: 'field-hint',
      text: '사진과 읽은 글자를 먼저 등록합니다. 다음 수정 화면에서 내용을 확인하고 저장을 눌러 주세요.' })] : []));
    if (mode === 'busy') {
      actionSlot.replaceChildren(el('button', { class: 'btn', type: 'button', disabled: true }, '처리 중…'));
      return;
    }
    const ready = mode === 'ready';
    actionSlot.replaceChildren(...(ready
      ? [el('button', { class: 'btn primary', type: 'button', onclick: () => { void save(); } }, '등록하고 내용 입력')]
      : []),
      el('button', { class: ready ? 'btn' : 'btn primary', type: 'button', onclick: () => fileInput.click() },
        ready ? '다른 사진' : '사진 선택'),
    );
  }

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', hidden: true, id: 'scan-file',
    onchange: (ev: Event) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // 같은 파일을 다시 골라도 change 가 오도록
      if (file) void run(file);
    },
  });
  drawActions('idle');

  return el('div', { class: 'scan-page' },
    registrationGuide(),
    el('a', { class: 'back-link', href: `#${travelPath(tripId)}` }, '← 돌아가기'),
    pageHeader('영수증 등록', trip?.name ?? '여행 미지정'),
    el('p', { class: 'field-hint', text: '사진은 이 브라우저 안에서만 처리·저장되며 외부로 전송되지 않습니다.' }),
    languageField,
    stage,
    actionSlot,
    actionHintSlot,
    fileInput,
    statusSlot,
    linesSlot,
  );
}
