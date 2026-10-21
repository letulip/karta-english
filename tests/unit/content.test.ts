import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOGRAPHY } from '../../src/content/biography.ru';
import { PARTS } from '../../src/content/parts';
import { CAN_DO, CAN_DO_ORDER } from '../../src/content/selfAssessment.ru';
import { SPEAKING, VOICE_RATE } from '../../src/content/speaking';
import { WRITING } from '../../src/content/writing';

const unique = (ids: string[]) => new Set(ids).size === ids.length;

describe('контент', () => {
  it('шесть частей в порядке спеки', () => {
    expect(PARTS.map((p) => p.id)).toEqual(['biography', 'self', 'efset', 'grammar', 'writing', 'speaking']);
    expect(PARTS.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('биография: 18 вопросов с уникальными id', () => {
    expect(BIOGRAPHY).toHaveLength(18);
    expect(unique(BIOGRAPHY.map((q) => q.id))).toBe(true);
  });

  it('самооценка: по два утверждения на каждую пару «навык × уровень»', () => {
    expect(CAN_DO).toHaveLength(50);
    expect(unique(CAN_DO.map((c) => c.id))).toBe(true);
    const counts = new Map<string, number>();
    for (const c of CAN_DO) counts.set(`${c.skill}/${c.level}`, (counts.get(`${c.skill}/${c.level}`) ?? 0) + 1);
    expect(counts.size).toBe(25);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    for (const c of CAN_DO) expect(c.id.slice(3, 5)).toBe(c.level.toLowerCase());
  });

  it('порядок самооценки — та же полусотня, но вперемешку', () => {
    expect([...CAN_DO_ORDER].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...CAN_DO].sort((a, b) => a.id.localeCompare(b.id)));
    expect(CAN_DO_ORDER.slice(0, 10).map((c) => c.skill)).not.toEqual(CAN_DO.slice(0, 10).map((c) => c.skill));
  });

  it('письмо: три задания, суммарно 75 минут', () => {
    expect(WRITING).toHaveLength(3);
    expect(WRITING.reduce((s, t) => s + t.minutes, 0)).toBe(75);
    expect(unique(WRITING.map((t) => t.id))).toBe(true);
  });

  it('речь: 14 вопросов, у каждого есть озвучка', () => {
    expect(SPEAKING).toHaveLength(14);
    expect(unique(SPEAKING.map((p) => p.id))).toBe(true);
    for (const p of SPEAKING) {
      expect(VOICE_RATE[p.voice]).toBeGreaterThan(0);
      expect(existsSync(path.resolve('public/audio', `${p.id}.mp3`))).toBe(true);
    }
    expect(SPEAKING.find((p) => p.type === 'part2')?.card?.length).toBeGreaterThan(3);
    expect(SPEAKING.filter((p) => p.type === 'retell').every((p) => p.task)).toBe(true);
  });
});
