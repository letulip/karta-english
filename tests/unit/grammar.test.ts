import { describe, expect, it } from 'vitest';
import { GRAMMAR, TRAPS } from '../../src/content/grammar';
import type { TrapId } from '../../src/content/types';

const TRAP_IDS: TrapId[] = [
  'articles',
  'perfect',
  'tenses',
  'prepositions',
  'questions',
  'conditionals',
  'verb-patterns',
  'collocations',
  'false-friends',
  'countable',
  'phrasal',
  'reported',
];

const blanks = (s: string) => s.split('___').length - 1;

describe('банк заданий части 4', () => {
  it('60 заданий с номерами g01…g60 по порядку', () => {
    expect(GRAMMAR).toHaveLength(60);
    GRAMMAR.forEach((item, i) => expect(item.id).toBe(`g${String(i + 1).padStart(2, '0')}`));
    expect(new Set(GRAMMAR.map((item) => item.id)).size).toBe(60);
  });

  it('у каждой ловушки 5 заданий: 2 × B1, 2 × B2, 1 × C1, хотя бы двух видов', () => {
    for (const trap of TRAP_IDS) {
      const items = GRAMMAR.filter((item) => item.trap === trap);
      expect(items, trap).toHaveLength(5);
      const levels = items.map((item) => item.level).sort();
      expect(levels, trap).toEqual(['B1', 'B1', 'B2', 'B2', 'C1']);
      expect(new Set(items.map((item) => item.kind)).size, trap).toBeGreaterThanOrEqual(2);
    }
  });

  it('у каждой ловушки есть название и пояснение', () => {
    expect(Object.keys(TRAPS).sort()).toEqual([...TRAP_IDS].sort());
    for (const trap of TRAP_IDS) {
      expect(TRAPS[trap].title.trim(), trap).not.toBe('');
      expect(TRAPS[trap].blurb.trim(), trap).not.toBe('');
    }
  });

  it('одна ловушка не стоит дважды подряд', () => {
    for (let i = 1; i < GRAMMAR.length; i++) {
      expect(GRAMMAR[i].trap, GRAMMAR[i].id).not.toBe(GRAMMAR[i - 1].trap);
    }
  });

  it('выбор варианта: один пропуск, варианты уникальны, ключ среди них', () => {
    for (const item of GRAMMAR) {
      if (item.kind !== 'choice') continue;
      expect(blanks(item.prompt), item.id).toBe(1);
      expect(item.options.length, item.id).toBeGreaterThanOrEqual(3);
      expect(item.options.length, item.id).toBeLessThanOrEqual(4);
      expect(new Set(item.options).size, item.id).toBe(item.options.length);
      expect(Number.isInteger(item.answer), item.id).toBe(true);
      expect(item.answer, item.id).toBeGreaterThanOrEqual(0);
      expect(item.answer, item.id).toBeLessThan(item.options.length);
    }
  });

  it('вписать слово: один пропуск, ответы в нижнем регистре и без пробелов по краям', () => {
    for (const item of GRAMMAR) {
      if (item.kind !== 'gap') continue;
      expect(blanks(item.prompt), item.id).toBe(1);
      expect(item.accept.length, item.id).toBeGreaterThan(0);
      for (const answer of item.accept) {
        expect(answer, item.id).toBe(answer.trim());
        expect(answer, item.id).toBe(answer.toLowerCase());
        expect(answer, item.id).not.toBe('');
      }
      expect(new Set(item.accept).size, item.id).toBe(item.accept.length);
    }
  });

  it('найти ошибку: ровно четыре фрагмента в скобках, ключ 0–3, есть исправление', () => {
    for (const item of GRAMMAR) {
      if (item.kind !== 'error') continue;
      const fragments = [...item.sentence.matchAll(/\[([^\[\]]+)\]/g)].map((m) => m[1]);
      expect(fragments, item.id).toHaveLength(4);
      expect(item.sentence.split('[').length - 1, item.id).toBe(4);
      expect(item.sentence.split(']').length - 1, item.id).toBe(4);
      expect(blanks(item.sentence), item.id).toBe(0);
      expect([0, 1, 2, 3], item.id).toContain(item.answer);
      expect(item.correction.trim(), item.id).not.toBe('');
      expect(item.correction, item.id).not.toBe(fragments[item.answer]);
    }
  });

  it('у каждого задания есть объяснение для разбора', () => {
    for (const item of GRAMMAR) expect(item.explain.trim(), item.id).not.toBe('');
  });
});
