import type { CanDo, CanDoAnswer, GrammarItem, Level, Skill, TrapId } from '../content/types';

export const LEVELS: Level[] = ['A2', 'B1', 'B2', 'C1', 'C2'];
const LADDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const ANSWER_VALUE: Record<CanDoAnswer, number> = { yes: 1, hard: 0.5, no: 0 };

export interface SkillSelfLevel {
  byLevel: Record<Level, number>; // доля «да» на уровне, «с трудом» считается за половину
  index: number; // 0 = A1 … 5 = C2, непрерывная шкала для сравнения с повтором
  label: string; // A2, B1+, …
}

// Уровень по самооценке: сумма долей по ступеням A2…C2 поверх A1. «Да» на всех ступенях до B2 и «с трудом» на C1
// дают 3,5 — это «B2+». Прозрачно и одинаково считается при повторе.
export function selfLevels(items: CanDo[], answers: Record<string, CanDoAnswer | undefined>): Record<Skill, SkillSelfLevel> {
  const skills = [...new Set(items.map((i) => i.skill))];
  const out = {} as Record<Skill, SkillSelfLevel>;
  for (const skill of skills) {
    const byLevel = {} as Record<Level, number>;
    for (const level of LEVELS) {
      const vals = items
        .filter((i) => i.skill === skill && i.level === level)
        .map((i) => answers[i.id])
        .filter((a): a is CanDoAnswer => !!a)
        .map((a) => ANSWER_VALUE[a]);
      byLevel[level] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    }
    const index = LEVELS.reduce((s, l) => s + byLevel[l], 0);
    out[skill] = { byLevel, index: Math.round(index * 100) / 100, label: indexLabel(index) };
  }
  return out;
}

export function indexLabel(index: number): string {
  const whole = Math.min(5, Math.floor(index));
  const plus = index - whole >= 0.5 && whole < 5 ? '+' : '';
  return `${LADDER[whole]}${plus}`;
}

export function normalizeGap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '');
}

export type GrammarAnswer = number | string | null; // null — «не знаю»

export function isCorrect(item: GrammarItem, answer: GrammarAnswer): boolean {
  if (answer === null) return false;
  if (item.kind === 'gap') return typeof answer === 'string' && item.accept.includes(normalizeGap(answer));
  return answer === item.answer;
}

export interface GrammarResponse {
  answer: GrammarAnswer;
  unsure: boolean;
  ms: number;
  at: string;
}

export interface TrapScore {
  total: number;
  correct: number;
  dontKnow: number;
  wrongConfident: number; // ошибка без отметки «сомневаюсь» — кандидат в закрепившиеся
}

export function grammarScore(items: GrammarItem[], responses: Record<string, GrammarResponse | undefined>) {
  const byTrap = {} as Record<TrapId, TrapScore>;
  let correct = 0;
  for (const item of items) {
    const r = responses[item.id];
    const t = (byTrap[item.trap] ??= { total: 0, correct: 0, dontKnow: 0, wrongConfident: 0 });
    t.total++;
    if (r && isCorrect(item, r.answer)) {
      t.correct++;
      correct++;
    } else if (!r || r.answer === null) t.dontKnow++;
    else if (!r.unsure) t.wrongConfident++;
  }
  return { total: items.length, correct, byTrap };
}

// Слова считаются так же, как на IELTS: всё, что разделено пробелами и содержит букву или цифру.
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Детерминированное перемешивание: порядок утверждений одинаков у всех попыток, чтобы повтор был сравним.
export function seededShuffle<T>(list: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
