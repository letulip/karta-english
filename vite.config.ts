/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resultsApi } from './server/resultsApi';

// Ответы, записи и журнал пишутся на диск через API этого же локального сервера (server/resultsApi.ts).
// RESULTS_DIR переопределяют только тесты, чтобы не трогать настоящие результаты.
export default defineConfig({
  plugins: [vue(), resultsApi({ dir: process.env.RESULTS_DIR ?? 'results' })],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
