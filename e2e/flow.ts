import { expect, type Page } from '@playwright/test';
import { SPEAKING } from '../src/content/speaking';

// Полный проход всех шести частей при ускоренном времени. Один и тот же для локальной версии и версии для Pages:
// различается только то, где потом искать результаты.

export async function openPart(page: Page, id: string) {
  await page.getByTestId(`part-${id}`).getByRole('button').click();
}

export async function passWholeTest(page: Page) {
  page.on('dialog', (d) => void d.accept());
  await page.goto('./');
  await page.getByRole('button', { name: 'Начать тест' }).click();

  // 1. Биография
  await openPart(page, 'biography');
  await page.locator('#bio-b01-input').fill('Учил в школе, потом по документации.');
  await page.locator('#hours-reading').fill('6');
  await page.locator('#level-listening').selectOption('B2');
  await page.getByTestId('submit-part').click();
  await expect(page.getByTestId('part-biography')).toContainText('Сдана');

  // 2. Самооценка: пять страниц по десять утверждений
  await openPart(page, 'self');
  for (let p = 0; p < 5; p++) {
    await expect(page.getByText(`Страница ${p + 1} из 5`)).toBeVisible(); // all() не ждёт отрисовки
    for (const group of await page.getByRole('radiogroup').all()) await group.getByRole('radio', { name: 'Да', exact: true }).click();
    if (p < 4) await page.getByTestId('next-page').click();
  }
  await page.getByTestId('submit-part').click();

  // 3. EF SET
  await openPart(page, 'efset');
  await page.locator('#ef-overall').fill('56');
  await page.locator('#ef-reading').fill('60');
  await page.locator('#ef-listening').fill('52');
  await page.getByTestId('submit-part').click();

  // 4. Грамматика — с перезагрузкой посреди части: прогресс должен восстановиться
  await openPart(page, 'grammar');
  await page.getByTestId('grammar-begin').click();
  for (let i = 0; i < 60; i++) {
    if (i === 5) {
      await page.reload();
      await openPart(page, 'grammar');
      await expect(page.getByText('Задание 6 из 60')).toBeVisible();
    }
    const item = page.getByTestId(`item-g${String(i + 1).padStart(2, '0')}`);
    await expect(item).toBeVisible(); // count() не ждёт: сначала убеждаемся, что на экране нужное задание
    if (await item.locator('.choice').count()) await item.locator('.choice').first().click();
    else if (await item.locator('.gap-input').count()) await item.locator('.gap-input').fill('test');
    else await item.locator('.seg-btn').first().click();
    await page.getByTestId(i % 7 === 0 ? 'dont-know' : 'next-item').click();
  }
  await page.getByTestId('submit-part').click();

  // 5. Письмо: первое сдаём досрочно, второе — по таймеру, третье снова досрочно
  await openPart(page, 'writing');
  const text = page.getByTestId('writing-text');
  await page.getByTestId('start-task').click();
  await text.pressSequentially('Dear Sarah, thank you for your email. ');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'pasted text');
    document
      .querySelector('[data-testid=writing-text]')
      ?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('Вставка текста отключена')).toBeVisible();
  await expect(text).not.toHaveValue(/pasted text/);
  await page.getByTestId('finish-early').click();
  await page.getByTestId('back-to-list').click();

  await page.getByTestId('start-task').click();
  await text.pressSequentially('AI assistants sometimes guess. ');
  await expect(page.getByTestId('writing-finished')).toContainText('Время вышло', { timeout: 20_000 });
  await expect(text).toHaveAttribute('readonly', '');
  await page.getByTestId('back-to-list').click();

  await page.getByTestId('start-task').click();
  await text.pressSequentially('Some people believe that children should start early. ');
  await page.getByTestId('finish-early').click();
  await page.getByTestId('back-to-list').click();
  await page.getByTestId('submit-part').click();

  // 6. Речь: поддельный микрофон Chrome, ускоренные лимиты — каждая запись заканчивается сама
  await openPart(page, 'speaking');
  await page.getByTestId('mic-enable').click();
  await page.getByTestId('mic-ready').click();
  for (const [i, p] of SPEAKING.entries()) {
    await page.getByTestId(`speaking-${p.id}`).getByTestId('listen').click();
    const next = SPEAKING[i + 1];
    await expect(next ? page.getByTestId(`speaking-${next.id}`) : page.getByTestId('speaking-done')).toBeVisible({ timeout: 30_000 });
  }
  await page.getByTestId('submit-part').click();
  await expect(page.getByTestId('all-done')).toBeVisible();
}

// Доступ к результатам сессии: папка results/<сессия>/ у локальной версии или распакованный архив у версии для Pages.
export interface Results {
  json(rel: string): any;
  events(): string;
  size(rel: string): number;
}

export function checkResults(r: Results) {
  const session = r.json('session.json');
  expect(Object.keys(session.parts)).toHaveLength(6);
  expect(Object.values(session.parts).every((p) => (p as { status: string }).status === 'done')).toBe(true);
  expect(r.json('biography.json').answers.b01).toContain('школе');
  expect(r.json('self-assessment.json').result.listening.label).toBe('C2');
  expect(r.json('efset.json').overall).toBe('56');

  const grammar = r.json('grammar.json');
  expect(Object.keys(grammar.responses)).toHaveLength(60);
  expect(grammar.score.total).toBe(60);
  expect(Object.values(grammar.responses).filter((x) => (x as { answer: unknown }).answer === null)).toHaveLength(9);

  const w1 = r.json('writing/w1-letter.json');
  expect(w1.pasteBlocked).toBeGreaterThan(0);
  expect(w1.early).toBe(true);
  expect(w1.text).toContain('Dear Sarah');
  expect(r.json('writing/w2-explain.json').timedOut).toBe(true);
  expect(r.json('writing/w3-essay.json').snapshots.length).toBeGreaterThan(0);

  const manifest = r.json('speaking/manifest.json');
  expect(Object.keys(manifest.items)).toHaveLength(SPEAKING.length);
  for (const item of Object.values(manifest.items) as { file: string; skipped: boolean }[]) {
    expect(item.skipped).toBe(false);
    expect(r.size(item.file)).toBeGreaterThan(0);
  }
  expect(manifest.mic.label).not.toBe(undefined);

  const events = r.events();
  expect(events).toContain('"paste-blocked"');
  expect(events).toContain('"speaking-saved"');
  expect(events).toContain('"part-finish"');
}
