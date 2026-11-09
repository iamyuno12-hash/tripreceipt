/**
 * 해시 기반 라우터.
 *
 * history API 대신 해시(#/trips/t1)를 쓰는 이유:
 * 서버 설정 없이 어디서든 동작하고, dist/index.html 을 직접 열어도 깨지지 않는다.
 * 백엔드가 없는 이 프로젝트의 성격과 맞다.
 */

export interface Route {
  /** 화면 이름 */
  readonly name: string;
  /** URL 패턴. :id 형태의 자리표시자를 쓸 수 있다 */
  readonly path: string;
  /**
   * 화면을 그려 반환한다.
   * 저장소에서 읽어야 하는 화면은 Promise 를 돌려줘도 된다 (P2 에서 추가).
   */
  readonly render: (params: Record<string, string>) => HTMLElement | Promise<HTMLElement>;
}

export interface MatchedRoute {
  readonly route: Route;
  readonly params: Record<string, string>;
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const ap = actual.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const val = ap[i]!;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(val);
    } else if (seg !== val) {
      return null;
    }
  }
  return params;
}

/** 현재 해시에서 경로만 뽑는다. 해시가 없으면 "/" */
export function currentPath(): string {
  const h = globalThis.location.hash;
  return h.startsWith('#') ? h.slice(1) || '/' : '/';
}

export function navigate(path: string): void {
  globalThis.location.hash = path;
}

export class Router {
  private readonly routes: readonly Route[];
  private readonly outlet: HTMLElement;
  private readonly onChange: ((m: MatchedRoute) => void) | undefined;

  constructor(
    routes: readonly Route[],
    outlet: HTMLElement,
    onChange?: (m: MatchedRoute) => void,
  ) {
    this.routes = routes;
    this.outlet = outlet;
    this.onChange = onChange;
  }

  match(path: string): MatchedRoute | null {
    for (const route of this.routes) {
      const params = matchPath(route.path, path);
      if (params) return { route, params };
    }
    return null;
  }

  start(): void {
    const handle = (): void => this.render();
    globalThis.addEventListener('hashchange', handle);
    handle();
  }

  /**
   * 화면 전환 중에 늦게 끝난 이전 화면이 뒤늦게 그려지는 것을 막기 위한 토큰.
   * 저장소 읽기가 비동기라 빠르게 탭을 옮기면 순서가 뒤집힐 수 있다.
   */
  private renderToken = 0;

  private render(): void {
    const path = currentPath();
    let matched = this.match(path);

    // 알 수 없는 경로는 홈으로 되돌린다.
    // 화면만 홈으로 바꾸면 주소창과 네비게이션 표시가 어긋나기 때문이다.
    if (!matched && path !== '/') {
      navigate('/');
      return;
    }
    matched ??= this.match('/');

    this.outlet.replaceChildren();

    if (!matched) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = `경로를 찾을 수 없습니다: ${path}`;
      this.outlet.appendChild(p);
      return;
    }

    const token = ++this.renderToken;
    const found = matched;
    this.onChange?.(found);

    let result: HTMLElement | Promise<HTMLElement>;
    try {
      result = found.route.render(found.params);
    } catch (err) {
      this.showError(err);
      return;
    }

    if (result instanceof Promise) {
      // 저장소를 읽는 동안 잠깐 비어 보이지 않게 안내를 띄운다.
      const loading = document.createElement('p');
      loading.className = 'empty';
      loading.textContent = '불러오는 중…';
      this.outlet.appendChild(loading);

      result.then(
        (node) => {
          if (token !== this.renderToken) return; // 그 사이 다른 화면으로 이동함
          this.outlet.replaceChildren(node);
          this.scrollTop();
        },
        (err: unknown) => {
          if (token !== this.renderToken) return;
          this.showError(err);
        },
      );
      return;
    }

    this.outlet.replaceChildren(result);
    this.scrollTop();
  }

  private scrollTop(): void {
    this.outlet.scrollTo?.({ top: 0 });
    globalThis.scrollTo?.({ top: 0 });
  }

  private showError(err: unknown): void {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'summary blocked';
    p.textContent = `화면을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
    this.outlet.replaceChildren(p);
  }
}
