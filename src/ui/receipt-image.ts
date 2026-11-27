/** 수정 화면에서 저장된 영수증 사진을 펼쳐 대조한다. */
import { getImage } from '../storage/images.ts';
import { el } from './dom.ts';

export function createReceiptImage(imageId: string): HTMLDetailsElement {
  const viewport = el('div', { class: 'receipt-image-viewport', tabindex: '0', 'aria-label': '영수증 사진, 스크롤하여 이동' });
  const zoomLabel = el('output', { class: 'receipt-image-zoom', 'aria-live': 'polite', text: '—' });
  const fitButton = el('button', { class: 'btn tiny', type: 'button', onclick: () => fit() }, '화면 맞춤');
  const actualButton = el('button', { class: 'btn tiny', type: 'button', onclick: () => setZoom(1) }, '100%');
  const smaller = el('button', { class: 'btn tiny', type: 'button', 'aria-label': '영수증 사진 축소',
    onclick: () => setZoom(Math.max(0.05, zoom / 1.5)) }, '−');
  const larger = el('button', { class: 'btn tiny', type: 'button', 'aria-label': '영수증 사진 확대',
    onclick: () => setZoom(Math.min(4, Math.max(0.05, zoom * 1.5))) }, '+');
  const controls = [fitButton, actualButton, smaller, larger];
  const panel = el('details', { class: 'receipt-image-panel', open: true },
    el('summary', { text: '영수증 사진 보기' }),
    el('div', { class: 'receipt-image-body' },
      el('div', { class: 'receipt-image-toolbar' }, fitButton, actualButton, smaller, zoomLabel, larger),
      viewport,
      el('p', { class: 'field-hint', text: '사진을 확대하고 스크롤하면서 입력 내용과 대조하세요.' }),
    ),
  );

  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  let zoom = 1;
  let fitting = true;
  let loading = false;
  let ready = false;
  let generation = 0;
  let listeners: AbortController | null = null;

  function message(text: string): void {
    viewport.replaceChildren(el('span', { class: 'preview-hint', role: 'status', text }));
  }

  function updateControls(): void {
    for (const button of controls) button.disabled = !ready;
    smaller.disabled = !ready || zoom <= 0.05;
    larger.disabled = !ready || zoom >= 4;
    zoomLabel.textContent = ready ? `${Math.round(zoom * 100)}%` : '—';
  }

  function releaseUrl(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function clear(): void {
    generation++;
    ready = false;
    loading = false;
    listeners?.abort();
    listeners = null;
    image?.removeAttribute('src');
    image = null;
    releaseUrl();
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    message('사진을 펼치면 불러옵니다.');
    updateControls();
  }

  function setZoom(next: number, reset = false): void {
    if (!ready || !image) return;
    const oldMargin = Math.max(0, (viewport.clientWidth - image.naturalWidth * zoom) / 2);
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2 - oldMargin) / zoom;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
    zoom = next;
    fitting = reset;
    const width = Math.max(1, Math.round(image.naturalWidth * zoom));
    image.style.width = `${width}px`;
    image.style.height = `${Math.max(1, Math.round(image.naturalHeight * zoom))}px`;
    const newMargin = Math.max(0, (viewport.clientWidth - width) / 2);
    viewport.scrollLeft = reset ? 0 : Math.max(0, centerX * zoom + newMargin - viewport.clientWidth / 2);
    viewport.scrollTop = reset ? 0 : Math.max(0, centerY * zoom - viewport.clientHeight / 2);
    updateControls();
  }

  function fit(): void {
    if (!ready || !image) return;
    setZoom(Math.min(1,
      (viewport.clientWidth || 640) / image.naturalWidth,
      (viewport.clientHeight || 360) / image.naturalHeight,
    ), true);
  }

  async function load(): Promise<void> {
    if (loading || ready) return;
    const request = ++generation;
    loading = true;
    message('사진 불러오는 중…');
    updateControls();
    listeners?.abort();
    listeners = new AbortController();
    const signal = listeners.signal;
    window.addEventListener('hashchange', () => { clear(); panel.open = false; }, { signal });
    window.addEventListener('resize', () => { if (fitting) fit(); }, { signal });
    try {
      const record = await getImage(imageId);
      if (request !== generation || !panel.open) return;
      if (!record) {
        loading = false;
        message('저장된 영수증 사진을 찾을 수 없습니다.');
        return;
      }
      objectUrl = URL.createObjectURL(record.blob);
      const img = el('img', { class: 'receipt-image-canvas', alt: '저장된 영수증 사진' });
      image = img;
      img.addEventListener('load', () => {
        if (request !== generation || !panel.open) return;
        loading = false;
        if (!img.naturalWidth || !img.naturalHeight) {
          releaseUrl();
          image = null;
          message('사진을 표시할 수 없습니다.');
          return;
        }
        ready = true;
        fit();
      }, { once: true });
      img.addEventListener('error', () => {
        if (request !== generation) return;
        loading = false;
        ready = false;
        releaseUrl();
        image = null;
        message('사진을 표시할 수 없습니다.');
        updateControls();
      }, { once: true });
      viewport.replaceChildren(img);
      img.src = objectUrl;
    } catch {
      if (request !== generation) return;
      loading = false;
      ready = false;
      releaseUrl();
      image = null;
      message('사진을 불러오지 못했습니다. 접었다가 다시 펼쳐 주세요.');
      updateControls();
    }
  }

  panel.addEventListener('toggle', () => {
    if (panel.open) void load();
    else clear();
  });
  clear();
  return panel;
}
