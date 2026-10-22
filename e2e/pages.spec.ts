import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unpackSession } from '../src/lib/archive';
import { checkResults, passWholeTest } from './flow';

// Версия для GitHub Pages: сервера нет, прогресс живёт в IndexedDB, результаты уходят архивом.
test('версия для Pages: прогресс в браузере, архив и восстановление в чистом браузере', async ({ page, browser }, info) => {
  await passWholeTest(page);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-archive').click()]);
  expect(download.suggestedFilename()).toMatch(/^karta-english-a-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipPath = await download.path();
  const archive = unpackSession(new Uint8Array(readFileSync(zipPath)));
  const files = new Map(archive.files.map((f) => [f.rel, f.data]));
  checkResults({
    json: (rel) => JSON.parse(String(files.get(rel))),
    events: () => archive.events.map((e) => JSON.stringify(e)).join('\n'),
    size: (rel) => files.get(rel)?.length ?? 0,
  });

  // Другое устройство: чистый браузер без данных восстанавливает всё из архива.
  const fresh = await browser.newContext({ baseURL: info.project.use.baseURL, permissions: ['microphone'] });
  const other = await fresh.newPage();
  await other.goto('./');
  await expect(other.getByRole('button', { name: 'Начать тест' })).toBeVisible();
  await other.getByTestId('restore-archive').setInputFiles(zipPath);
  await expect(other.getByTestId('all-done')).toBeVisible();
  await expect(other.getByTestId('part-speaking')).toContainText('Сдана');

  // Архив из восстановленного браузера — та же сессия с теми же файлами.
  const [again] = await Promise.all([other.waitForEvent('download'), other.getByTestId('download-archive').click()]);
  const restored = unpackSession(new Uint8Array(readFileSync(await again.path())));
  expect(restored.id).toBe(archive.id);
  expect(restored.files.map((f) => f.rel).sort()).toEqual(archive.files.map((f) => f.rel).sort());
  await fresh.close();
});
