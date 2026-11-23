import { el } from './dom.ts';

interface MessageOptions {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly danger?: boolean };
}

/** 안내와 확인 대화 상자를 같은 형태로 보여주고, 명시적으로 확인한 경우만 true를 반환한다. */
export function showMessage(returnFocus: HTMLElement, options: MessageOptions): Promise<boolean> {
  if (!returnFocus.isConnected || document.querySelector('.message-dialog[open]')) return Promise.resolve(false);

  return new Promise(resolve => {
    const confirmButton = el('button', {
      class: `btn ${options.action?.danger ? 'danger' : 'primary'}`, type: 'button',
      text: options.action?.label ?? '확인', onclick: () => finish(true),
    });
    const cancelButton = options.action
      ? el('button', { class: 'btn', type: 'button', text: '취소', onclick: () => finish(false) })
      : null;
    const dialog = el('dialog', {
      class: 'message-dialog', role: 'alertdialog', 'aria-modal': 'true',
      'aria-labelledby': 'message-dialog-title', 'aria-describedby': 'message-dialog-description',
    },
      el('h2', { id: 'message-dialog-title', text: options.title }),
      el('p', { id: 'message-dialog-description', text: options.message }),
      el('div', { class: 'btn-row' }, cancelButton, confirmButton),
    );
    let settled = false;
    let inertApp: HTMLElement | null = null;
    const dismissForNavigation = (): void => finish(false, false);

    function finish(confirmed: boolean, restoreFocus = true): void {
      if (settled) return;
      settled = true;
      window.removeEventListener('hashchange', dismissForNavigation);
      if (dialog.open) dialog.close?.();
      dialog.remove();
      inertApp?.removeAttribute('inert');
      if (restoreFocus && returnFocus.isConnected) returnFocus.focus();
      resolve(confirmed && returnFocus.isConnected);
    }

    const cancel = (event: Event): void => { event.preventDefault(); finish(false); };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', () => finish(false));
    window.addEventListener('hashchange', dismissForNavigation);
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      dialog.classList.add('message-dialog-fallback');
      inertApp = document.querySelector<HTMLElement>('#app:not([inert])');
      inertApp?.setAttribute('inert', '');
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(event); });
    }
    (cancelButton ?? confirmButton).focus();
  });
}
