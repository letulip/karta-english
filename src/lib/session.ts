import { reactive } from 'vue';
import { PARTS } from '../content/parts';
import type { PartId } from '../content/types';
import { MODE, createSession, fetchSession, logEvent, writeJson, type Session } from './api';
import { requestPersistence } from './backend/browser';
import { setContext } from './conditions';

export const state = reactive<{
  session: Session | null;
  loading: boolean;
  error: string;
  view: 'home' | PartId;
  lockNav: boolean; // идёт запись или задание на время — уходить на главный экран нельзя
}>({
  session: null,
  loading: true,
  error: '',
  view: 'home',
  lockNav: false,
});

export async function loadSession(): Promise<void> {
  state.loading = true;
  try {
    state.session = await fetchSession();
    state.error = '';
  } catch (err) {
    state.error =
      MODE === 'server'
        ? `Сервер не отвечает (${String(err)}). Запусти его командой npm run exam.`
        : `Браузер не дал открыть хранилище (${String(err)}). Проверь, что окно не приватное, и обнови страницу.`;
  } finally {
    state.loading = false;
  }
}

export async function beginTest(form: 'a' | 'b' = 'a'): Promise<void> {
  state.session = await createSession(form);
  logEvent('session-start', { form, mode: MODE, ...(MODE === 'browser' ? { persisted: await requestPersistence() } : {}) });
}

export function partStatus(id: PartId): 'locked' | 'todo' | 'active' | 'done' {
  const progress = state.session?.parts[id];
  if (progress) return progress.status;
  return id === nextPartId() ? 'todo' : 'locked';
}

// Порядок частей фиксирован: самооценка идёт до любых заданий, чтобы результат на неё не повлиял.
export function nextPartId(): PartId | null {
  return PARTS.find((p) => state.session?.parts[p.id]?.status !== 'done')?.id ?? null;
}

async function saveSession(): Promise<void> {
  if (state.session) await writeJson('session.json', state.session);
}

export async function openPart(id: PartId): Promise<void> {
  const session = state.session;
  if (!session) return;
  if (!session.parts[id]) {
    session.parts[id] = { status: 'active', startedAt: new Date().toISOString() };
    await saveSession();
    logEvent('part-start', { part: id });
  }
  state.view = id;
  setContext({ part: id });
  window.scrollTo(0, 0);
}

export async function finishPart(id: PartId): Promise<void> {
  const progress = state.session?.parts[id];
  if (!progress) return;
  progress.status = 'done';
  progress.finishedAt = new Date().toISOString();
  await saveSession();
  logEvent('part-finish', { part: id });
  goHome();
}

export function goHome(): void {
  state.view = 'home';
  state.lockNav = false;
  setContext({});
  window.scrollTo(0, 0);
}
