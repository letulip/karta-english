import { defineConfig, devices } from '@playwright/test';

// Сквозной прогон всех шести частей: отдельная папка результатов, ускоренное время и поддельный микрофон Chrome.
export const E2E_RESULTS = '.e2e-results';
const PORT = 5182;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: `rm -rf ${E2E_RESULTS} && RESULTS_DIR=${E2E_RESULTS} VITE_SPEED=120 npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
});
