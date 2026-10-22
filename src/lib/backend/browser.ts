import type { Backend, Session } from './types';
import { SESSION_ID, localDate } from './types';

// Версия для GitHub Pages: сервера нет, ответы и записи живут в IndexedDB этого браузера.
// К разбору они уходят архивом (lib/archive.ts), который повторяет папку results/<сессия>/.

const DB_NAME = 'karta-english';
const FILES = 'files'; // `${сессия}/${путь}` → StoredFile
const EVENTS = 'events'; // журнал условий: { session, t, type, … }
const META = 'meta'; // 'active' → { id } активной сессии

interface StoredFile {
  data: string | Blob;
  updatedAt: number;
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(FILES);
      db.createObjectStore(EVENTS, { autoIncrement: true }).createIndex('session', 'session');
      db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

// Одна операция — одна транзакция; промис разрешается, когда транзакция зафиксирована, а не раньше.
async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

// id активной сессии, известный синхронно: при уходе со страницы ждать ответа IndexedDB уже некогда.
let cachedId: string | null = null;

export async function activeSessionId(): Promise<string | null> {
  const v = await run<{ id?: string } | undefined>(META, 'readonly', (s) => s.get('active'));
  cachedId = v?.id && SESSION_ID.test(v.id) ? v.id : null;
  return cachedId;
}

const getFile = (key: string) => run<StoredFile | undefined>(FILES, 'readonly', (s) => s.get(key));
const putFile = (key: string, data: string | Blob, updatedAt = Date.now()) =>
  run(FILES, 'readwrite', (s) => s.put({ data, updatedAt } satisfies StoredFile, key));
const asText = (f: StoredFile) => (typeof f.data === 'string' ? Promise.resolve(f.data) : f.data.text());

// Запись в IndexedDB, начатая при закрытии вкладки, может не успеть зафиксироваться. Поэтому в этот момент
// последняя версия файла ещё и синхронно кладётся в localStorage; при следующем открытии она возвращается
// в IndexedDB, если она новее того, что там лежит.
const PENDING = 'karta-english:pending:';

function stash(key: string, data: string): void {
  try {
    localStorage.setItem(PENDING + key, JSON.stringify({ data, t: Date.now() }));
  } catch {
    // нет места или localStorage недоступен — остаётся обычная запись в IndexedDB
  }
}

function unstash(key: string): void {
  try {
    localStorage.removeItem(PENDING + key);
  } catch {
    // нечего убирать
  }
}

let recovering: Promise<void> | null = null;

function recoverPending(): Promise<void> {
  recovering ??= (async () => {
    let keys: string[];
    try {
      keys = Object.keys(localStorage).filter((k) => k.startsWith(PENDING));
    } catch {
      return;
    }
    for (const k of keys) {
      const key = k.slice(PENDING.length);
      try {
        const { data, t } = JSON.parse(localStorage.getItem(k) ?? 'null') as { data: string; t: number };
        const existing = await getFile(key);
        if (!existing || existing.updatedAt < t) await putFile(key, data, t);
      } catch {
        // битая запись — пропускаем
      }
      unstash(key);
    }
  })();
  return recovering;
}

export const browserBackend: Backend = {
  async fetchSession() {
    await recoverPending();
    const id = await activeSessionId();
    const f = id ? await getFile(`${id}/session.json`) : undefined;
    return f ? (JSON.parse(await asText(f)) as Session) : null;
  },

  async createSession(form) {
    const base = `${form}-${localDate()}`;
    let id = base;
    for (let n = 2; await getFile(`${id}/session.json`); n++) id = `${base}-${n}`;
    const session: Session = { id, form, createdAt: new Date().toISOString(), parts: {} };
    await putFile(`${id}/session.json`, JSON.stringify(session, null, 2));
    await run(META, 'readwrite', (s) => s.put({ id }, 'active'));
    cachedId = id;
    return session;
  },

  async readJson<T>(rel: string) {
    await recoverPending();
    const id = await activeSessionId();
    const f = id ? await getFile(`${id}/${rel}`) : undefined;
    return f ? (JSON.parse(await asText(f)) as T) : null;
  },

  async writeFile(rel, body, keepalive = false) {
    // keepalive — вызов при уходе со страницы: копию в localStorage кладём до первого await, пока страница ещё жива.
    if (keepalive && cachedId && typeof body === 'string') stash(`${cachedId}/${rel}`, body);
    await recoverPending();
    const id = await activeSessionId();
    if (!id) throw new Error('no-session');
    await putFile(`${id}/${rel}`, body);
    unstash(`${id}/${rel}`);
  },

  logEvent(event) {
    void (async () => {
      const id = await activeSessionId();
      if (id) await run(EVENTS, 'readwrite', (s) => s.add({ session: id, t: new Date().toISOString(), ...event }));
    })().catch(() => undefined);
  },
};

export async function sessionFiles(id: string): Promise<{ rel: string; data: string | Blob }[]> {
  const db = await openDb();
  const prefix = `${id}/`;
  return new Promise((resolve, reject) => {
    const out: { rel: string; data: string | Blob }[] = [];
    const tx = db.transaction(FILES, 'readonly');
    const req = tx.objectStore(FILES).openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      out.push({ rel: String(c.key).slice(prefix.length), data: (c.value as StoredFile).data });
      c.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

export async function sessionEvents(id: string): Promise<Record<string, unknown>[]> {
  const all = await run<Record<string, unknown>[]>(EVENTS, 'readonly', (s) => s.index('session').getAll(id));
  return all.map(({ session: _session, ...e }) => e);
}

// Восстановление из архива: файлы сессии и её журнал заменяются целиком, сессия становится активной.
export async function importSession(
  id: string,
  files: { rel: string; data: string | Blob }[],
  events: Record<string, unknown>[],
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FILES, EVENTS, META], 'readwrite');
    const fileStore = tx.objectStore(FILES);
    const prefix = `${id}/`;
    fileStore.delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
    for (const f of files) fileStore.put({ data: f.data, updatedAt: Date.now() } satisfies StoredFile, `${prefix}${f.rel}`);
    const eventStore = tx.objectStore(EVENTS);
    const old = eventStore.index('session').openKeyCursor(IDBKeyRange.only(id));
    old.onsuccess = () => {
      const c = old.result;
      if (c) {
        eventStore.delete(c.primaryKey);
        c.continue();
      } else for (const e of events) eventStore.add({ ...e, session: id });
    };
    tx.objectStore(META).put({ id }, 'active');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  cachedId = id;
  // Отложенные копии от прошлых сессий в этом браузере больше не нужны: архив — источник правды.
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${PENDING}${id}/`)) localStorage.removeItem(k);
  } catch {
    // localStorage недоступен — копий там и нет
  }
}

// Просим браузер не чистить данные сайта при нехватке места. Chrome решает сам, по вовлечённости в сайт.
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
