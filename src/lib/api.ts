import { reactive } from 'vue';
import type { PartId } from '../content/types';

export interface PartProgress {
  status: 'active' | 'done';
  startedAt: string;
  finishedAt?: string;
}

export interface Session {
  id: string;
  form: 'a' | 'b';
  createdAt: string;
  parts: Partial<Record<PartId, PartProgress>>;
}

// Состояние сохранения для индикатора в шапке: сколько записей в пути, когда последняя дошла до диска, была ли ошибка.
export const saveStatus = reactive({ pending: 0, savedAt: 0, error: '' });

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function fetchSession(): Promise<Session | null> {
  const res = await ok(await fetch('/api/session', { cache: 'no-store' }));
  return ((await res.json()) as { session: Session | null }).session;
}

export async function createSession(form: 'a' | 'b'): Promise<Session> {
  const res = await ok(await fetch('/api/session', { method: 'POST', body: JSON.stringify({ form }) }));
  return ((await res.json()) as { session: Session }).session;
}

export async function readJson<T>(rel: string): Promise<T | null> {
  const res = await fetch(`/api/file/${rel}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  return (await (await ok(res)).json()) as T;
}

export async function writeFile(rel: string, body: Blob | string, keepalive = false): Promise<void> {
  saveStatus.pending++;
  try {
    await ok(await fetch(`/api/file/${rel}`, { method: 'PUT', body, keepalive }));
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

// Журнал событий — только дописывается, поэтому порядок и время событий не теряются даже при сбое страницы.
export function logEvent(type: string, data: Record<string, unknown> = {}): void {
  void fetch('/api/event', {
    method: 'POST',
    body: JSON.stringify({ type, ...data }),
    keepalive: true,
  }).catch(() => undefined);
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
