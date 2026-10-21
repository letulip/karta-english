import { logEvent } from './api';

// Журнал условий: уходы со страницы и переключения в другое окно. Это не штраф, а контекст для разбора —
// например, длинный уход посреди эссе объясняет провал в тексте, а уход во время EF SET — ожидаем.
let context: Record<string, string> = {};

export function setContext(next: Record<string, string>): void {
  context = next;
}

export function installConditionsLog(): void {
  let hiddenAt = 0;
  let blurAt = 0;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      logEvent('hidden', context);
    } else if (hiddenAt) {
      logEvent('visible', { ...context, awayMs: Date.now() - hiddenAt });
      hiddenAt = 0;
    }
  });

  window.addEventListener('blur', () => {
    blurAt = Date.now();
    logEvent('blur', context);
  });
  window.addEventListener('focus', () => {
    if (!blurAt) return;
    logEvent('focus', { ...context, awayMs: Date.now() - blurAt });
    blurAt = 0;
  });
}
