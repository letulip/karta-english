// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { archiveName, mimeFor, packSession, unpackSession } from '../../src/lib/archive';

describe('архив сессии', () => {
  it('упаковка и распаковка сохраняют тексты, записи и журнал', async () => {
    const audio = new Uint8Array([26, 69, 223, 163, 0, 1, 2, 255]);
    const zip = await packSession(
      'a-2026-10-22',
      [
        { rel: 'session.json', data: '{"id":"a-2026-10-22"}' },
        { rel: 'writing/w1-letter.json', data: '{"text":"Dear Sarah, — привет"}' },
        { rel: 'speaking/p1-1.webm', data: new Blob([audio], { type: 'audio/webm' }) },
        { rel: 'speaking/p1-2.webm', data: audio },
      ],
      [{ t: '2026-10-22T01:00:00Z', type: 'part-start', part: 'biography' }],
    );
    const s = unpackSession(zip);
    expect(s.id).toBe('a-2026-10-22');
    const byRel = Object.fromEntries(s.files.map((f) => [f.rel, f.data]));
    expect(Object.keys(byRel).sort()).toEqual(['session.json', 'speaking/p1-1.webm', 'speaking/p1-2.webm', 'writing/w1-letter.json']);
    expect(byRel['writing/w1-letter.json']).toBe('{"text":"Dear Sarah, — привет"}');
    expect([...(byRel['speaking/p1-1.webm'] as Uint8Array)]).toEqual([...audio]);
    expect([...(byRel['speaking/p1-2.webm'] as Uint8Array)]).toEqual([...audio]);
    expect(s.events).toEqual([{ t: '2026-10-22T01:00:00Z', type: 'part-start', part: 'biography' }]);
  });

  it('отвергает чужие и битые архивы', () => {
    expect(() => unpackSession(new Uint8Array([1, 2, 3]))).toThrow('zip');
    const twoRoots = zipSync({ 'a-2026-10-22/session.json': strToU8('{}'), 'other/x.json': strToU8('{}') });
    expect(() => unpackSession(twoRoots)).toThrow('одна папка');
    expect(() => unpackSession(zipSync({ 'a-2026-10-22/biography.json': strToU8('{}') }))).toThrow('session.json');
    expect(() => unpackSession(zipSync({ 'photos/session.json': strToU8('{}') }))).toThrow('Не похоже');
  });

  it('служебные файлы macOS в архиве не мешают', () => {
    const zip = zipSync({ 'a-2026-10-22/session.json': strToU8('{}'), '__MACOSX/a-2026-10-22/._session.json': strToU8('x') });
    expect(unpackSession(zip).files.map((f) => f.rel)).toEqual(['session.json']);
  });

  it('имя архива и тип записей', () => {
    expect(archiveName('a-2026-10-22')).toBe('karta-english-a-2026-10-22.zip');
    expect(mimeFor('speaking/p1-1.webm')).toBe('audio/webm');
    expect(mimeFor('speaking/p1-1.mp4')).toBe('audio/mp4');
  });
});
