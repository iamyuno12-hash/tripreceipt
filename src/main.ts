import './style.css';
import { Router, type Route } from './router.ts';
import { buildShell } from './ui/layout.ts';
import { renderHome } from './ui/screens/home.ts';
import { renderTrip } from './ui/screens/trip.ts';
import { renderScan } from './ui/screens/scan.ts';
import { renderReceipt } from './ui/screens/receipt.ts';
import { renderStats } from './ui/screens/stats.ts';
import { renderSettings } from './ui/screens/settings.ts';
import { renderEnv } from './ui/screens/env.ts';

const ROUTES: readonly Route[] = [
  { name: 'home', path: '/', render: renderHome },
  { name: 'trip', path: '/trips/:id', render: renderTrip },
  { name: 'scan', path: '/scan', render: renderScan },
  { name: 'receipt', path: '/receipts/:id', render: renderReceipt },
  { name: 'stats', path: '/stats', render: renderStats },
  { name: 'settings', path: '/settings', render: renderSettings },
  { name: 'env', path: '/settings/env', render: renderEnv },
];

function main(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app 요소를 찾을 수 없습니다');

  const { root, outlet, refreshNav } = buildShell();
  app.replaceChildren(root);

  // 화면이 바뀔 때마다 네비게이션의 활성 표시를 갱신한다.
  new Router(ROUTES, outlet, refreshNav).start();
}

try {
  main();
} catch (err) {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    app.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = '초기화 실패';
    const p = document.createElement('p');
    p.className = 'summary blocked';
    p.textContent = err instanceof Error ? err.message : String(err);
    app.append(h, p);
  }
  console.error(err);
}
