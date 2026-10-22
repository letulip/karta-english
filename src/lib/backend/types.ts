import type { PartId } from '../../content/types';

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

// Хранилище ответов. Пути — те же, что в results/<сессия>/ локальной версии: biography.json, writing/w1-letter.json…
export interface Backend {
  fetchSession(): Promise<Session | null>;
  createSession(form: 'a' | 'b'): Promise<Session>;
  readJson<T>(rel: string): Promise<T | null>;
  writeFile(rel: string, body: Blob | string, keepalive?: boolean): Promise<void>;
  logEvent(event: Record<string, unknown>): void;
}

export const SESSION_ID = /^[ab]-\d{4}-\d{2}-\d{2}(-\d+)?$/;

// Дата по часам компьютера, а не по UTC: на Бали полночь UTC — это восемь утра.
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
