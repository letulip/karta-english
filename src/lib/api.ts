import { reactive } from 'vue';
import { browserBackend } from './backend/browser';
import { serverBackend } from './backend/server';
import type { Session } from './backend/types';

export type { PartProgress, Session } from './backend/types';

// Где живут ответы: локальная версия (npm run exam) пишет их на диск через свой сервер,
// версия для GitHub Pages (npm run build:pages) — в IndexedDB браузера и отдаёт архивом.
export const MODE: 'server' | 'browser' = import.meta.env.VITE_STORAGE === 'browser' ? 'browser' : 'server';
const backend = MODE === 'browser' ? browserBackend : serverBackend;

// Состояние сохранения для индикатора в шапке: сколько записей в пути, когда последняя сохранилась, была ли ошибка.
export const saveStatus = reactive({ pending: 0, savedAt: 0, error: '' });

export const fetchSession = (): Promise<Session | null> => backend.fetchSession();
export const createSession = (form: 'a' | 'b'): Promise<Session> => backend.createSession(form);
export const readJson = <T>(rel: string): Promise<T | null> => backend.readJson<T>(rel);

export async function writeFile(rel: string, body: Blob | string, keepalive = false): Promise<void> {
  saveStatus.pending++;
  try {
    await backend.writeFile(rel, body, keepalive);
    saveStatus.savedAt = Date.now();
    saveStatus.error = '';
  } catch (err) {
    saveStatus.error = String(err);
    throw err;
  } finally {
    saveStatus.pending--;
  }
}

export function writeJson(rel: string, data: unknown, keepalive = false): Promise<void> {
  return writeFile(rel, JSON.stringify(data, null, 2), keepalive);
}

export function logEvent(type: string, data: Record<string, unknown> = {}): void {
  backend.logEvent({ type, ...data });
}

// Отложенная запись: пока идёт набор, файл пишется не чаще раза в delay мс; при уходе со страницы — сразу.
const pendingFlushes = new Set<(keepalive?: boolean) => Promise<void>>();

export function createSaver(rel: () => string, getData: () => unknown, delay = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  async function flush(keepalive = false): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    try {
      await writeJson(rel(), getData(), keepalive);
    } catch {
      dirty = true; // попробуем снова при следующей правке или уходе со страницы
    }
  }

  function schedule(): void {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  }

  pendingFlushes.add(flush);
  return { schedule, flush, dispose: () => pendingFlushes.delete(flush) };
}

export function installFlushOnHide(): void {
  window.addEventListener('pagehide', () => pendingFlushes.forEach((f) => void f(true)));
}
