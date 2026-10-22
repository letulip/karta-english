import { defineConfig, devices } from '@playwright/test';

// Сквозной прогон всех шести частей в двух версиях: локальной (сервер пишет на диск) и для GitHub Pages
// (прогресс в браузере, результаты архивом). Ускоренное время, поддельный микрофон Chrome, отдельные папки результатов.
const LOCAL = 'http://localhost:5182/';
const PAGES = 'http://localhost:5183/karta-english/';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: [
    {
      command: 'rm -rf .e2e-results && RESULTS_DIR=.e2e-results VITE_SPEED=120 npx vite --port 5182 --strictPort',
      url: LOCAL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        'VITE_STORAGE=browser VITE_SPEED=120 npx vite build --base /karta-english/ --outDir .e2e-pages && npx vite preview --base /karta-english/ --outDir .e2e-pages --port 5183 --strictPort',
      url: PAGES,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'local', testMatch: /exam\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: LOCAL } },
    { name: 'pages', testMatch: /pages\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: PAGES } },
  ],
});
