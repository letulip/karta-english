// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler, isLocalOrigin, safeRelPath } from '../../server/resultsApi';

describe('пути и происхождение запросов', () => {
  it('пропускает только плоские пути внутри сессии', () => {
    expect(safeRelPath('biography.json')).toBe('biography.json');
    expect(safeRelPath('speaking/p1-1.webm')).toBe('speaking/p1-1.webm');
    for (const bad of ['../x.json', '..%2Fx.json', 'a/../../x.json', '.hidden.json', 'x.exe', 'a/b/c/d.json', '', 'a//b.json'])
      expect(safeRelPath(bad), bad).toBe(null);
  });

  it('принимает только свой хост', () => {
    expect(isLocalOrigin(undefined)).toBe(true);
    expect(isLocalOrigin('http://localhost:5180')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:5180')).toBe(true);
    expect(isLocalOrigin('https://evil.example')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});

describe('API результатов', () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'english-karta-test-'));
    const handler = createHandler(root);
    server = createServer((req, res) => {
      req.url = req.url?.replace(/^\/api/, '') ?? '/';
      void handler(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
  });

  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('без сессии файлы не пишутся, события тихо пропускаются', async () => {
    expect((await fetch(`${base}/session`).then((r) => r.json())).session).toBe(null);
    expect((await fetch(`${base}/file/x.json`, { method: 'PUT', body: '{}' })).status).toBe(409);
    expect((await fetch(`${base}/event`, { method: 'POST', body: '{"type":"blur"}' })).status).toBe(202);
  });

  it('сессия, запись, чтение, журнал', async () => {
    const { session } = await fetch(`${base}/session`, { method: 'POST', body: '{"form":"a"}' }).then((r) => r.json());
    expect(session.id).toMatch(/^a-\d{4}-\d{2}-\d{2}$/);

    expect((await fetch(`${base}/file/writing/w1.json`, { method: 'PUT', body: '{"text":"hi"}' })).status).toBe(200);
    expect(await fetch(`${base}/file/writing/w1.json`).then((r) => r.json())).toEqual({ text: 'hi' });
    expect((await fetch(`${base}/file/missing.json`)).status).toBe(404);

    const audio = new Uint8Array([26, 69, 223, 163, 1, 2, 3]);
    await fetch(`${base}/file/speaking/p1-1.webm`, { method: 'PUT', body: audio });
    expect([...readFileSync(path.join(root, session.id, 'speaking', 'p1-1.webm'))]).toEqual([...audio]);

    await fetch(`${base}/event`, { method: 'POST', body: '{"type":"hidden","part":"writing"}' });
    const line = JSON.parse(readFileSync(path.join(root, session.id, 'events.jsonl'), 'utf8').trim());
    expect(line).toMatchObject({ type: 'hidden', part: 'writing' });
    expect(line.t).toMatch(/^\d{4}-/);
  });

  it('вторая сессия в тот же день получает суффикс и становится активной', async () => {
    const { session } = await fetch(`${base}/session`, { method: 'POST', body: '{"form":"a"}' }).then((r) => r.json());
    expect(session.id).toMatch(/-2$/);
    expect((await fetch(`${base}/session`).then((r) => r.json())).session.id).toBe(session.id);
  });

  it('отказывает чужому сайту и кривым путям', async () => {
    const foreign = await fetch(`${base}/file/x.json`, { method: 'PUT', body: '{}', headers: { Origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect((await fetch(`${base}/file/..%2F..%2Fescape.json`, { method: 'PUT', body: '{}' })).status).toBe(400);
  });
});
