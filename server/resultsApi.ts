import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

// Локальный API «экзаменационной комнаты». Страница сохраняет каждый ответ сразу на диск, в results/<сессия>/,
// поэтому закрытая вкладка или перезагрузка ничего не теряют. Сессия — одна попытка теста (версия A или Б),
// она тянется через все три захода; активная записана в results/active.json.

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const ALLOWED_EXT = /\.(json|jsonl|webm|ogg|mp4|m4a|wav|txt|md)$/i;
const SESSION_ID = /^[ab]-\d{4}-\d{2}-\d{2}(-\d+)?$/;
const MAX_BODY = 64 * 1024 * 1024;
const MAX_EVENT = 16 * 1024;

export interface SessionFile {
  id: string;
  form: 'a' | 'b';
  createdAt: string;
  parts: Record<string, unknown>;
}

// Путь внутри сессии: латиница, цифры, точка, дефис и подчёркивание, не глубже двух папок, только знакомые расширения.
export function safeRelPath(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts = decoded.split('/');
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((p) => SEGMENT.test(p) && !p.includes('..'))) return null;
  if (!ALLOWED_EXT.test(parts[parts.length - 1])) return null;
  return parts.join('/');
}

// Чужой сайт, открытый в том же браузере, не должен писать в результаты: принимаем только запросы со своего хоста.
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl, тесты и обычные GET приходят без Origin
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

// Дата по часам компьютера, а не по UTC: на Бали полночь UTC — это восемь утра.
function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export async function activeSession(root: string): Promise<SessionFile | null> {
  try {
    const { id } = JSON.parse(await fs.readFile(path.join(root, 'active.json'), 'utf8')) as { id?: string };
    if (!id || !SESSION_ID.test(id)) return null;
    return JSON.parse(await fs.readFile(path.join(root, id, 'session.json'), 'utf8')) as SessionFile;
  } catch {
    return null;
  }
}

export async function createSession(root: string, form: 'a' | 'b', now = new Date()): Promise<SessionFile> {
  const base = `${form}-${localDate(now)}`;
  let id = base;
  for (let n = 2; await exists(path.join(root, id)); n++) id = `${base}-${n}`;
  const session: SessionFile = { id, form, createdAt: now.toISOString(), parts: {} };
  await writeAtomic(path.join(root, id, 'session.json'), JSON.stringify(session, null, 2));
  await writeAtomic(path.join(root, 'active.json'), JSON.stringify({ id }, null, 2));
  return session;
}

export function createHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    try {
      if (!isLocalOrigin(req.headers.origin)) return send(res, 403, { error: 'origin' });
      const route = new URL(req.url ?? '/', 'http://localhost').pathname;

      if (route === '/session' && req.method === 'GET') return send(res, 200, { session: await activeSession(root) });

      if (route === '/session' && req.method === 'POST') {
        const raw = (await readBody(req, MAX_EVENT)).toString('utf8');
        const form = (raw ? (JSON.parse(raw) as { form?: string }).form : 'a') === 'b' ? 'b' : 'a';
        return send(res, 200, { session: await createSession(root, form) });
      }

      const session = await activeSession(root);

      if (route === '/event' && req.method === 'POST') {
        if (!session) return send(res, 202, { ignored: 'no-session' }); // до старта теста журналировать нечего
        const event = JSON.parse((await readBody(req, MAX_EVENT)).toString('utf8')) as Record<string, unknown>;
        const line = JSON.stringify({ t: new Date().toISOString(), ...event });
        await fs.appendFile(path.join(root, session.id, 'events.jsonl'), `${line}\n`);
        return send(res, 200, { ok: true });
      }

      if (route.startsWith('/file/')) {
        const rel = safeRelPath(route.slice('/file/'.length));
        if (!rel) return send(res, 400, { error: 'path' });
        if (!session) return send(res, 409, { error: 'no-session' });
        const file = path.join(root, session.id, rel);

        if (req.method === 'GET') {
          let data: Buffer;
          try {
            data = await fs.readFile(file);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return send(res, 404, { error: 'missing' });
            throw err;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(data);
          return;
        }

        if (req.method === 'PUT') {
          const body = await readBody(req, MAX_BODY);
          await writeAtomic(file, body);
          return send(res, 200, { ok: true, bytes: body.length });
        }
      }

      next();
    } catch (err) {
      send(res, 500, { error: String(err) });
    }
  };
}

export function resultsApi(opts: { dir: string }): Plugin {
  const handler = createHandler(path.resolve(opts.dir));
  return {
    name: 'english-karta-results-api',
    configureServer(server) {
      server.middlewares.use('/api', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', handler);
    },
  };
}
