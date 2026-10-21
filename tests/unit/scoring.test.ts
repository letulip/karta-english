import { describe, expect, it } from 'vitest';
import { CAN_DO } from '../../src/content/selfAssessment.ru';
import type { CanDoAnswer, GrammarItem } from '../../src/content/types';
import { parseErrorSentence, splitBlank } from '../../src/lib/items';
import {
  countWords,
  grammarScore,
  indexLabel,
  isCorrect,
  normalizeGap,
  seededShuffle,
  selfLevels,
  type GrammarResponse,
} from '../../src/lib/scoring';

const answerAll = (pick: (level: string) => CanDoAnswer) =>
  Object.fromEntries(CAN_DO.map((c) => [c.id, pick(c.level)])) as Record<string, CanDoAnswer>;

describe('самооценка', () => {
  it('всё «да» — C2 по каждому навыку', () => {
    const r = selfLevels(CAN_DO, answerAll(() => 'yes'));
    for (const s of Object.values(r)) expect(s).toMatchObject({ index: 5, label: 'C2' });
  });

  it('«да» до B2, «с трудом» на C1, «нет» на C2 — это B2+', () => {
    const r = selfLevels(CAN_DO, answerAll((l) => (l === 'C1' ? 'hard' : l === 'C2' ? 'no' : 'yes')));
    expect(r.listening).toMatchObject({ index: 3.5, label: 'B2+' });
  });

  it('всё «нет» — A1', () => {
    expect(selfLevels(CAN_DO, answerAll(() => 'no')).writing.label).toBe('A1');
  });

  it('подписи уровней', () => {
    expect([0, 0.4, 0.5, 2.2, 4.9, 5].map(indexLabel)).toEqual(['A1', 'A1', 'A1+', 'B1', 'C1+', 'C2']);
  });
});

describe('грамматика', () => {
  const choice: GrammarItem = { id: 'x1', trap: 'articles', level: 'B1', explain: '', kind: 'choice', prompt: 'I am ___ engineer.', options: ['a', 'an', 'the'], answer: 1 };
  const gap: GrammarItem = { id: 'x2', trap: 'perfect', level: 'B1', explain: '', kind: 'gap', prompt: 'I ___ it yet.', accept: ["haven't seen", 'have not seen'] };
  const error: GrammarItem = { id: 'x3', trap: 'prepositions', level: 'B1', explain: '', kind: 'error', sentence: '[It] [depends] [from] [them].', answer: 2, correction: 'on' };

  it('ответы в пропуск сравниваются без регистра, лишних пробелов и с любым апострофом', () => {
    expect(normalizeGap('  Haven’t   seen. ')).toBe("haven't seen");
    expect(isCorrect(gap, 'HAVE NOT SEEN')).toBe(true);
    expect(isCorrect(gap, 'didn’t see')).toBe(false);
  });

  it('«не знаю», уверенная ошибка и верный ответ считаются раздельно', () => {
    const r = (answer: number | string | null, unsure = false): GrammarResponse => ({ answer, unsure, ms: 1000, at: '' });
    const score = grammarScore([choice, gap, error], { x1: r(1), x2: r(null), x3: r(0) });
    expect(score.correct).toBe(1);
    expect(score.byTrap.perfect).toMatchObject({ dontKnow: 1, correct: 0 });
    expect(score.byTrap.prepositions).toMatchObject({ wrongConfident: 1 });
    expect(grammarScore([error], { x3: r(0, true) }).byTrap.prepositions?.wrongConfident).toBe(0);
  });

  it('фрагменты задания «найди ошибку» и пропуск', () => {
    expect(parseErrorSentence('She [has worked] here [since] 2020.')).toEqual([
      { text: 'She ' },
      { text: 'has worked', seg: 0 },
      { text: ' here ' },
      { text: 'since', seg: 1 },
      { text: ' 2020.' },
    ]);
    expect(splitBlank('I ___ it.')).toEqual(['I ', ' it.']);
  });
});

describe('мелочи', () => {
  it('слова считаются как на IELTS', () => {
    expect(countWords('Dear Sarah,\n\nThank you — it’s 9 a.m. here.')).toBe(8);
    expect(countWords('   ')).toBe(0);
  });

  it('перемешивание детерминированное и ничего не теряет', () => {
    const list = Array.from({ length: 50 }, (_, i) => i);
    const a = seededShuffle(list, 2026);
    expect(seededShuffle(list, 2026)).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(list);
    expect(a).not.toEqual(list);
  });
});
