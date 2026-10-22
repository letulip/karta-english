import { test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkResults, passWholeTest } from './flow';

// Та же папка, что в playwright.config.ts: сервер теста пишет результаты туда, а не в настоящие results/.
const RESULTS = '.e2e-results';

test('локальная версия: полный проход пишет результаты на диск', async ({ page }) => {
  await passWholeTest(page);

  const { id } = JSON.parse(readFileSync(path.join(RESULTS, 'active.json'), 'utf8')) as { id: string };
  const file = (rel: string) => path.join(RESULTS, id, rel);
  checkResults({
    json: (rel) => JSON.parse(readFileSync(file(rel), 'utf8')),
    events: () => readFileSync(file('events.jsonl'), 'utf8'),
    size: (rel) => statSync(file(rel)).size,
  });
});
