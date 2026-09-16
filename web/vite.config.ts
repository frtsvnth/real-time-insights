import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Для деплоя под путём (например https://host/realtimeinsights/) собери с
  // VITE_BASE_PATH=/realtimeinsights/ — иначе ассеты и WS уедут искать себя в корне домена.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    // pcm.worklet.ts маленький и без этого попадает под лимит инлайнинга — Vite зашивает
    // его в основной бандл как data:-URL. AudioWorklet.addModule() не может загрузить
    // такой URL (opaque origin), и запись падает в продакшн-сборке, хотя в dev-сервере
    // всё работает (там воркет раздаётся обычным файлом). Держим ассеты отдельными файлами.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
});
