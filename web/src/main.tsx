import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

async function boot() {
  // 开发时没有 API 也能看界面：?mock 会用 mock.ts 里的假数据接管 fetch。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) (await import('./mock')).installMock();
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void boot();
