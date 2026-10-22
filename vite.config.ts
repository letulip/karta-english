/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resultsApi } from './server/resultsApi';

// Ответы не должны уходить с устройства: собранная страница обращается только к своему адресу. Политика — meta-тегом
// и только в сборке: на GitHub Pages заголовки не настраиваются, а dev-серверу Vite строгая политика мешает.
// media-src blob: — чтобы проверка микрофона могла проиграть только что записанный фрагмент.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// Локальная версия (npm run exam) пишет ответы на диск через API этого же сервера (server/resultsApi.ts).
// RESULTS_DIR переопределяют только тесты, чтобы не трогать настоящие результаты.
export default defineConfig({
  plugins: [
    vue(),
    resultsApi({ dir: process.env.RESULTS_DIR ?? 'results' }),
    {
      name: 'karta-english-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<!-- csp -->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
