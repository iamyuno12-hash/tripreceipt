/**
 * 브라우저 환경 점검 화면 (P0 에서 만든 것을 설정 하위로 옮김).
 *
 * 팀원이 각자 환경에서 확인하고, 시연 전 점검용으로도 계속 쓴다.
 */
import { el, pageHeader } from '../dom.ts';
import { runEnvChecks, hasBlockingFailure, type CheckResult } from '../../env-check.ts';

const MARKS: Record<CheckResult['level'], string> = { ok: '✓', warn: '!', fail: '✕' };

function checkCard(r: CheckResult): HTMLElement {
  return el('div', { class: 'check' },
    el('div', { class: `mark ${r.level}`, text: MARKS[r.level] }),
    el('div', {},
      el('div', { class: 'check-name', text: r.name }),
      el('div', { class: 'check-detail', text: r.detail }),
      el('div', { class: 'check-needed', text: `필요 단계: ${r.neededFor}` }),
    ),
  );
}

export function renderEnv(): HTMLElement {
  const list = el('div', { class: 'checks' });
  const summary = el('p', { class: 'summary', text: '검사 중…' });

  const root = el('div', {},
    el('a', { class: 'back-link', href: '#/settings' }, '← 설정'),
    pageHeader('브라우저 환경 점검',
      '이 앱은 서버 없이 브라우저 안에서만 동작합니다. 아래는 이후 단계가 의존하는 기능입니다.'),
    list,
    summary,
  );

  void runEnvChecks().then((results) => {
    list.replaceChildren(...results.map(checkCard));

    const blocked = hasBlockingFailure(results);
    const warns = results.filter((r) => r.level === 'warn').length;
    summary.className = blocked ? 'summary blocked' : 'summary';
    summary.textContent = blocked
      ? '필수 기능이 빠져 있습니다. 최신 Chrome 또는 Edge 에서 다시 확인하세요.'
      : warns > 0
        ? `필수 기능은 모두 사용 가능합니다. 경고 ${warns}건은 속도나 편의에만 영향을 줍니다.`
        : '모든 항목 정상입니다.';
  });

  return root;
}
