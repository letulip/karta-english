import type { Backend, Session } from './types';

// Локальная версия: каждый ответ сразу пишет на диск сервер Vite (server/resultsApi.ts), в results/<сессия>/.

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export const serverBackend: Backend = {
  async fetchSession() {
    const res = await ok(await fetch('/api/session', { cache: 'no-store' }));
    return ((await res.json()) as { session: Session | null }).session;
  },

  async createSession(form) {
    const res = await ok(await fetch('/api/session', { method: 'POST', body: JSON.stringify({ form }) }));
    return ((await res.json()) as { session: Session }).session;
  },

  async readJson<T>(rel: string) {
    const res = await fetch(`/api/file/${rel}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    return (await (await ok(res)).json()) as T;
  },

  async writeFile(rel, body, keepalive = false) {
    await ok(await fetch(`/api/file/${rel}`, { method: 'PUT', body, keepalive }));
  },

  // Журнал только дописывается, поэтому порядок и время событий не теряются даже при сбое страницы.
  logEvent(event) {
    void fetch('/api/event', { method: 'POST', body: JSON.stringify(event), keepalive: true }).catch(() => undefined);
  },
};
