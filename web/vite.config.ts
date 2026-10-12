import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api 代理到本地只读 API(pnpm exec tsx scripts/serve-api.ts，默认 8787)。
// 前端只通过 src/api/types.ts 这份契约与后端对话；契约只被 import type，构建时会被擦除。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  resolve: { alias: { '@contract': new URL('../src/api/types.ts', import.meta.url).pathname } },
});
