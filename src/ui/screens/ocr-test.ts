/**
 * OCR 진단 화면 (설정 > OCR 테스트).
 *
 * P4 착수 전에 "이 브라우저에서 한국어 모델이 실제로 로드되고 인식되는가" 를
 * 확인하기 위한 화면이다. P4 이후에도 모델 교체나 전처리 변경의 효과를
 * 눈으로 비교하는 용도로 계속 쓴다.
 *
 * 측정값(처리시간·신뢰도·백엔드)은 P7 의 "테스트 결과" 산출물 재료가 된다.
 */
import { el, pageHeader } from '../dom.ts';
import { percent } from '../format.ts';
import { recognize, disposeEngine, isEngineLoaded, type RecognizeResult } from '../../ocr/engine.ts';
import { groupLinesByY, gradeGrouping, residualSkewDegrees } from '../../ocr/lines.ts';
import { totalModelMB } from '../../ocr/models.ts';
import { analyzeReceipt } from '../../ocr/pipeline.ts';
import { OCR_LANGUAGES, OCR_LANGUAGE_LABELS, type OcrLanguage, type OcrSnapshot } from '../../types.ts';

function statusLine(text: string, kind: 'info' | 'ok' | 'fail' = 'info'): HTMLElement {
  return el('p', { class: `ocr-status ${kind}`, text });
}

function resultView(r: RecognizeResult, pre: OcrSnapshot | null): HTMLElement {
  const avg = r.lines.length
    ? r.lines.reduce((s, l) => s + l.score, 0) / r.lines.length
    : 0;

  // 전처리 효과의 핵심 지표: 줄 묶기가 가능한 상태인가
  const grouped = groupLinesByY(r.lines);
  const quality = gradeGrouping(grouped);
  const skew = residualSkewDegrees(r.lines);

  return el('div', {},
    el('div', { class: quality.separable ? 'banner ok' : 'banner warn' },
      el('strong', { text: quality.separable
        ? '줄 묶기 가능 — 파서가 동작할 수 있는 상태'
        : '줄 묶기 불가 — 기울기 보정이 필요합니다' }),
      el('p', { text:
        `한 줄 안 y 편차 최대 ${quality.maxSpan}px, 줄 사이 간격 최소 ${quality.minGap}px` +
        ` · 잔여 기울기 ${skew.toFixed(1)}도 · ${quality.groups}줄로 묶임` }),
      quality.separable
        ? null
        : el('p', { class: 'banner-hint',
            text: '한 줄 안의 편차가 줄 사이 간격보다 커서 인접한 줄이 섞입니다.' }),
    ),
    pre
      ? el('p', { class: 'field-hint',
          text: `앱 처리: ${pre.steps.join(' → ')} · 인식 ${pre.passes}회 · ` +
                `1차 ${pre.ms.firstPass}ms + 전처리 ${pre.ms.preprocess}ms + 2차 ${pre.ms.secondPass}ms = ${pre.ms.total}ms` })
      : el('p', { class: 'field-hint', text: '전처리: 적용 안 함 (원본 그대로 1회 인식)' }),
    el('div', { class: 'summary-box' },
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '인식한 줄' }),
        el('span', { class: 'summary-value', text: `${r.lines.length}줄` }),
      ),
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '평균 신뢰도' }),
        el('span', { class: 'summary-value', text: percent(avg) }),
      ),
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '처리 시간' }),
        el('span', { class: 'summary-value', text: `${Math.round(r.metrics.totalMs)}ms` }),
      ),
      el('div', { class: 'summary-item' },
        el('span', { class: 'summary-label', text: '검출 / 인식' }),
        el('span', { class: 'summary-value',
          text: `${Math.round(r.metrics.detMs)} / ${Math.round(r.metrics.recMs)}ms` }),
      ),
    ),

    el('p', { class: 'field-hint',
      text: `백엔드: 검출 ${r.runtime.detProvider} · 인식 ${r.runtime.recProvider}` +
            ` (요청 ${r.runtime.requestedBackend}, WebGPU ${r.runtime.webgpuAvailable ? '사용 가능' : '없음'})` }),

    el('div', { class: 'table-wrap' },
      el('table', { class: 'items ocr-lines' },
        el('thead', {},
          el('tr', {},
            el('th', { class: 'num', text: 'y' }),
            el('th', { text: '인식 결과' }),
            el('th', { class: 'num', text: '신뢰도' }),
          ),
        ),
        el('tbody', {},
          ...[...r.lines]
            .sort((a, b) => a.centerY - b.centerY)
            .map((l) =>
              el('tr', { class: l.score < 0.7 ? 'low-score' : '' },
                el('td', { class: 'num dim', text: String(Math.round(l.centerY)) }),
                el('td', { text: l.text }),
                el('td', { class: 'num', text: percent(l.score) }),
              ),
            ),
        ),
      ),
    ),
  );
}

export function renderOcrTest(): HTMLElement {
  const preview = el('div', { class: 'preview-box' },
    el('span', { class: 'preview-hint', text: '영수증 이미지를 선택하세요' }),
  );
  const statusSlot = el('div', {});
  const resultSlot = el('div', {});
  const prePreview = el('div', {});
  let picked: Blob | null = null;
  let lastRaw: unknown = null;

  const saveBtn = el('button', { class: 'btn', type: 'button', disabled: true,
    onclick: () => {
      if (!lastRaw) return;
      const blob = new Blob([JSON.stringify(lastRaw, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ocr-result-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, '결과 JSON 저장');

  // 앱의 실제 처리(ocr/pipeline.ts)와 원본 그대로를 비교할 수 있게 한다 (평가 도구가 이 화면을 쓴다)
  const mkToggle = (id: string, label: string, checked: boolean): HTMLElement =>
    el('label', { class: 'toggle' },
      el('input', { type: 'checkbox', id, checked }),
      el('span', { text: label }),
    );
  const langSelect = el('select', { class: 'input', id: 'ocr-lang' });
  for (const l of OCR_LANGUAGES) langSelect.appendChild(el('option', { value: l, text: OCR_LANGUAGE_LABELS[l] }));
  const toggles = el('div', { class: 'toggle-row' },
    mkToggle('pp-enable', '앱 처리 사용 (1차 인식 → 회전·자르기·32px·흑백 → 2차 인식)', true),
    mkToggle('pp-skip', '기울기 1도 미만이면 2차 생략', true),
    langSelect,
  );
  const isOn = (id: string): boolean =>
    (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;

  const runBtn = el('button', { class: 'btn primary', type: 'button', disabled: true }, '인식 실행');

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'ocr-file',
    onchange: (ev: Event) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      picked = file;
      runBtn.disabled = false;
      resultSlot.replaceChildren();
      const url = URL.createObjectURL(file);
      const img = el('img', { class: 'preview-img', alt: '선택한 영수증', src: url });
      img.addEventListener('load', () => URL.revokeObjectURL(url));
      preview.replaceChildren(img,
        el('p', { class: 'preview-meta', text: `${file.name} · ${(file.size / 1024).toFixed(0)}KB` }));
    },
  });

  runBtn.addEventListener('click', () => {
    if (!picked) return;
    runBtn.disabled = true;
    resultSlot.replaceChildren();
    const started = performance.now();

    void (async () => {
      try {
        const lang = langSelect.value as OcrLanguage;
        const onProgress = (m: string): void => { statusSlot.replaceChildren(statusLine(m)); };
        let result: RecognizeResult;
        let pre: OcrSnapshot | null = null;

        if (isOn('pp-enable')) {
          const bitmap = await createImageBitmap(picked);
          try {
            const out = await analyzeReceipt(bitmap, { lang, skipSmallAngle: isOn('pp-skip'), onProgress });
            result = out.result;
            pre = out.snapshot;
            out.canvas.className = 'preview-img';
            prePreview.replaceChildren(
              el('h2', { class: 'section-title', text: '인식에 쓴 이미지' }),
              el('div', { class: 'preview-box' }, out.canvas),
            );
          } finally {
            bitmap.close();
          }
        } else {
          prePreview.replaceChildren();
          result = await recognize(picked, { lang, onProgress });
        }

        const wall = Math.round(performance.now() - started);

        // 원본 결과를 보관한다. 화면 표는 요약일 뿐이라, 검증하려면
        // 좌표와 점수가 들어 있는 원본을 꺼내 볼 수 있어야 한다.
        lastRaw = {
          file: picked instanceof File ? picked.name : 'image',
          recordedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          crossOriginIsolated: globalThis.crossOriginIsolated === true,
          wallMs: wall,
          lang: langSelect.value,
          preprocess: pre ? { ...pre, lines: undefined } : null,
          result,
        };
        (globalThis as unknown as { __ocrLast?: unknown }).__ocrLast = lastRaw;
        saveBtn.disabled = false;
        statusSlot.replaceChildren(
          statusLine(`완료 — 전체 ${wall}ms (모델 로딩 포함)`, 'ok'),
        );
        resultSlot.replaceChildren(resultView(result, pre));
      } catch (err) {
        console.error(err);
        statusSlot.replaceChildren(
          statusLine(`실패: ${err instanceof Error ? err.message : String(err)}`, 'fail'),
        );
      } finally {
        runBtn.disabled = false;
      }
    })();
  });

  return el('div', {},
    el('a', { class: 'back-link', href: '#/settings' }, '← 설정'),
    pageHeader('OCR 테스트', '인식 결과와 처리 시간을 확인하는 진단 화면입니다. 평가 도구(tools/ocr-eval)도 이 화면을 씁니다.'),

    el('p', { class: 'field-hint',
      text: `첫 실행에서 모델 약 ${totalModelMB().toFixed(0)}MB 를 내려받습니다(일본어·중국어는 따로 ${totalModelMB('zh_ja').toFixed(0)}MB). 이후에는 브라우저 캐시를 씁니다.` }),

    preview,
    toggles,
    el('div', { class: 'btn-row' },
      el('label', { class: 'btn', for: 'ocr-file' }, '이미지 선택'),
      runBtn,
      saveBtn,
      el('button', { class: 'btn', type: 'button',
        onclick: (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement;
          b.disabled = true;
          void disposeEngine().then(() => {
            statusSlot.replaceChildren(statusLine('모델을 메모리에서 내렸습니다.'));
            b.disabled = false;
          });
        } }, '모델 내리기'),
    ),
    fileInput,
    el('p', { class: 'field-hint',
      text: isEngineLoaded() ? '모델이 이미 로드돼 있습니다.' : '모델은 첫 인식 때 로드됩니다.' }),

    statusSlot,
    prePreview,
    resultSlot,
  );
}
