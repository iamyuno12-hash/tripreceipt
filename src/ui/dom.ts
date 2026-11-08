/**
 * 작은 DOM 헬퍼.
 *
 * 프레임워크를 쓰지 않기로 했으므로 innerHTML 문자열 조립 대신 이 함수를 쓴다.
 * 영수증 상호명처럼 OCR 이 읽어온 문자열이 그대로 화면에 들어가기 때문에,
 * textContent 로 넣어 HTML 주입 가능성을 원천적으로 없앤다.
 */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    f.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return f;
}

/** 화면 제목 + 선택적 부제 */
export function pageHeader(title: string, subtitle?: string): HTMLElement {
  return el('header', { class: 'page-header' },
    el('h1', { text: title }),
    subtitle ? el('p', { class: 'subtitle', text: subtitle }) : null,
  );
}

/** 내용이 없을 때 보여주는 안내 */
export function emptyState(message: string, hint?: string): HTMLElement {
  return el('div', { class: 'empty' },
    el('p', { text: message }),
    hint ? el('p', { class: 'empty-hint', text: hint }) : null,
  );
}

/** 아직 구현 전인 화면에 붙이는 표시. 어느 단계에서 채우는지 명시한다. */
export function phaseNote(phase: string, what: string): HTMLElement {
  return el('div', { class: 'phase-note' },
    el('strong', { text: phase }),
    ' ',
    el('span', { text: what }),
  );
}
