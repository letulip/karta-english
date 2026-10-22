import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { SESSION_ID } from './backend/types';

// Архив сессии повторяет папку results/<сессия>/ локальной версии: его распаковывают в results/ (npm run import)
// и разбирают как обычно. Им же восстанавливают прогресс в браузере на другом устройстве.

const AUDIO = /\.(webm|ogg|mp4|m4a|wav)$/i;
const MIME: Record<string, string> = { webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4', m4a: 'audio/mp4', wav: 'audio/wav' };

export interface PackedFile {
  rel: string;
  data: string | Blob | Uint8Array;
}

export interface UnpackedSession {
  id: string;
  files: { rel: string; data: string | Uint8Array }[]; // текст для json, байты для записей
  events: Record<string, unknown>[];
}

export const archiveName = (id: string) => `karta-english-${id}.zip`;
export const mimeFor = (rel: string) => MIME[rel.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export async function packSession(id: string, files: PackedFile[], events: Record<string, unknown>[]): Promise<Uint8Array> {
  const tree: Zippable = {};
  for (const f of files) {
    const bytes =
      typeof f.data === 'string' ? strToU8(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    // Записи уже сжаты кодеком: повторное сжатие только тратит время.
    tree[`${id}/${f.rel}`] = [bytes, { level: AUDIO.test(f.rel) ? 0 : 6 }];
  }
  tree[`${id}/events.jsonl`] = strToU8(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return zipSync(tree);
}

export function unpackSession(zip: Uint8Array): UnpackedSession {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error('Это не zip-архив.');
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/') && !n.endsWith('.DS_Store'));
  const roots = new Set(names.map((n) => n.split('/')[0] ?? ''));
  const [id] = [...roots];
  if (roots.size !== 1 || !id || !SESSION_ID.test(id)) throw new Error('Не похоже на архив теста: внутри должна быть одна папка сессии вида a-2026-10-22.');
  if (!entries[`${id}/session.json`]) throw new Error('В архиве нет session.json.');

  const files: UnpackedSession['files'] = [];
  let events: Record<string, unknown>[] = [];
  for (const name of names) {
    const rel = name.slice(id.length + 1);
    const bytes = entries[name];
    if (!rel || !bytes) continue;
    if (rel === 'events.jsonl')
      events = strFromU8(bytes)
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    else files.push({ rel, data: AUDIO.test(rel) ? bytes : strFromU8(bytes) });
  }
  return { id, files, events };
}

export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
