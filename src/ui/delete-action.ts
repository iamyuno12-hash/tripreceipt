/** 상세 화면의 삭제 확인·오류·복귀 동작. */
import { el } from './dom.ts';
import { showMessage } from './message-dialog.ts';
import { navigate } from '../router.ts';

interface DeleteOptions {
  readonly label: string;
  readonly message: string;
  readonly remove: () => Promise<void>;
  readonly destination: string;
  readonly onError: (message: string) => void;
  readonly tiny?: boolean;
}

export function createDeleteButton(options: DeleteOptions): HTMLButtonElement {
  const button = el('button', { class: `btn danger${options.tiny ? ' tiny' : ''}`, type: 'button' }, options.label);
  button.addEventListener('click', async () => {
    if (button.disabled || !(await showMessage(button, {
      title: options.label, message: options.message, action: { label: '삭제', danger: true },
    }))) return;
    options.onError('');
    button.disabled = true;
    button.textContent = '삭제 중…';
    button.setAttribute('aria-busy', 'true');
    try {
      await options.remove();
      navigate(options.destination);
    } catch (error) {
      options.onError(`삭제하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      button.disabled = false;
      button.textContent = options.label;
    } finally { button.removeAttribute('aria-busy'); }
  });
  return button;
}
