/**
 * 공통 레이아웃.
 *
 * 좁은 화면(폰)에서는 하단 탭, 넓은 화면에서는 왼쪽 사이드바로 바뀐다.
 * 영수증을 찍는 상황이 대부분 폰이므로 모바일을 기준으로 잡고 데스크톱을 확장했다.
 */
import { el } from './dom.ts';
import { currentPath } from '../router.ts';

interface NavItem {
  readonly path: string;
  readonly label: string;
  /** 아이콘 대용 기호. 외부 아이콘 라이브러리를 쓰지 않기 위함 */
  readonly glyph: string;
  /** 이 경로로 시작하면 활성으로 본다 */
  readonly matchPrefix: string;
}

const NAV: readonly NavItem[] = [
  { path: '/', label: '여행', glyph: '◆', matchPrefix: '/trip' },
  { path: '/scan', label: '스캔', glyph: '◎', matchPrefix: '/scan' },
  { path: '/stats', label: '통계', glyph: '▤', matchPrefix: '/stats' },
  { path: '/settings', label: '설정', glyph: '⚙', matchPrefix: '/settings' },
];

function isActive(item: NavItem, path: string): boolean {
  // 영수증은 여행에 속하므로 상세 화면에서도 '여행' 탭을 활성으로 유지한다.
  if (item.path === '/') {
    return path === '/' || path.startsWith('/trip') || path.startsWith('/receipt');
  }
  return path.startsWith(item.matchPrefix);
}

function navLink(item: NavItem, path: string): HTMLElement {
  return el('a', {
    class: isActive(item, path) ? 'nav-link active' : 'nav-link',
    href: `#${item.path}`,
  },
    el('span', { class: 'nav-glyph', 'aria-hidden': 'true', text: item.glyph }),
    el('span', { class: 'nav-label', text: item.label }),
  );
}

export function buildShell(): { root: HTMLElement; outlet: HTMLElement; refreshNav: () => void } {
  const outlet = el('main', { class: 'outlet', id: 'outlet' });
  const nav = el('nav', { class: 'nav', 'aria-label': '주요 화면' });

  const brand = el('div', { class: 'brand' },
    el('span', { class: 'brand-name', text: 'TripReceipt' }),
    el('span', { class: 'brand-sub', text: '오프라인 영수증 지출 관리' }),
  );

  const refreshNav = (): void => {
    const path = currentPath();
    nav.replaceChildren(brand, ...NAV.map((i) => navLink(i, path)));
  };
  refreshNav();

  const root = el('div', { class: 'shell' }, nav, outlet);
  return { root, outlet, refreshNav };
}
