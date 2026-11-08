import './style.css';
import { runEnvChecks, hasBlockingFailure, type CheckResult } from './env-check';
import { DETECTION_MODEL, RECOGNITION_MODELS, totalModelMB } from './ocr/models';

const MARKS: Record<CheckResult['level'], string> = {
  ok: '✓',
  warn: '!',
  fail: '✕',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}

function renderCheck(r: CheckResult): string {
  return `
    <div class="check">
      <div class="mark ${r.level}">${MARKS[r.level]}</div>
      <div>
        <div class="check-name">${escapeHtml(r.name)}</div>
        <div class="check-detail">${escapeHtml(r.detail)}</div>
        <div class="check-needed">필요 단계: ${escapeHtml(r.neededFor)}</div>
      </div>
    </div>`;
}

function renderModelTable(): string {
  const rows = [
    ['검출 (언어 무관)', DETECTION_MODEL.modelName, `${DETECTION_MODEL.approxMB}MB`],
    ...Object.entries(RECOGNITION_MODELS).map(([lang, m]) => [
      `인식 (${lang})`,
      m.modelName,
      `${m.approxMB}MB`,
    ]),
  ];
  return `
    <table class="models">
      <thead><tr><th>역할</th><th>model_name</th><th>용량</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r[0]!)}</td><td><code>${escapeHtml(r[1]!)}</code></td><td>${escapeHtml(r[2]!)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app 요소를 찾을 수 없습니다');

  app.innerHTML = `
    <header>
      <h1>TripReceipt</h1>
      <p class="subtitle">여행 영수증 OCR 지출 관리</p>
      <div class="phase-badge">P0 — 실행 환경 검증</div>
    </header>
    <h2>브라우저 환경 점검</h2>
    <p class="hint">검사 중…</p>
    <div class="checks"></div>
  `;

  const results = await runEnvChecks();
  const blocked = hasBlockingFailure(results);
  const warnCount = results.filter((r) => r.level === 'warn').length;

  const hint = app.querySelector<HTMLParagraphElement>('.hint');
  if (hint) {
    hint.textContent =
      '이 앱은 서버 없이 브라우저 안에서만 동작합니다. 아래 항목은 이후 단계가 의존하는 기능들입니다.';
  }

  const list = app.querySelector<HTMLDivElement>('.checks');
  if (list) list.innerHTML = results.map(renderCheck).join('');

  const summary = document.createElement('p');
  summary.className = blocked ? 'summary blocked' : 'summary';
  summary.textContent = blocked
    ? '필수 기능이 빠져 있습니다. 최신 Chrome 또는 Edge 에서 다시 확인하세요.'
    : warnCount > 0
      ? `필수 기능은 모두 사용 가능합니다. 경고 ${warnCount}건은 속도나 편의에만 영향을 줍니다.`
      : '모든 항목 정상입니다. 다음 단계(P1 화면 구조)로 진행할 수 있습니다.';
  app.appendChild(summary);

  const modelSection = document.createElement('div');
  modelSection.innerHTML = `
    <h2>사용할 OCR 모델</h2>
    <p class="hint">
      첫 진입 시 약 ${totalModelMB()}MB 를 내려받고 이후에는 캐시를 사용합니다.
      모델 파일은 저장소에 포함되지 않으므로 <code>make models</code> 를 먼저 실행하세요.
    </p>
    ${renderModelTable()}
  `;
  app.appendChild(modelSection);

  const footer = document.createElement('footer');
  footer.innerHTML = `
    사진과 인식 결과는 이 브라우저 안에만 저장되며 외부로 전송되지 않습니다.<br />
    단계별 계획은 <code>docs/ROADMAP.md</code>, OCR 구성 근거는 <code>docs/OCR-ENGINE.md</code> 를 참고하세요.
  `;
  app.appendChild(footer);
}

main().catch((err: unknown) => {
  const app = document.querySelector<HTMLDivElement>('#app');
  const msg = err instanceof Error ? err.message : String(err);
  if (app) {
    app.innerHTML = `<h1>초기화 실패</h1><p class="summary blocked">${escapeHtml(msg)}</p>`;
  }
  console.error(err);
});
