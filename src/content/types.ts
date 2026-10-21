export type PartId = 'biography' | 'self' | 'efset' | 'grammar' | 'writing' | 'speaking';

export interface PartInfo {
  id: PartId;
  n: number;
  title: string;
  minutes: number;
  sitting: 1 | 2 | 3;
  blurb: string;
}

// Часть 1 — языковая биография
export type BioKind = 'text' | 'hours' | 'levels';
export interface BioQuestion {
  id: string;
  text: string;
  hint?: string;
  kind: BioKind;
}

// Часть 2 — самооценка «я могу…»
export type Skill = 'listening' | 'reading' | 'interaction' | 'production' | 'writing';
export type Level = 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export interface CanDo {
  id: string;
  skill: Skill;
  level: Level;
  text: string;
}
export type CanDoAnswer = 'yes' | 'hard' | 'no';

// Часть 4 — грамматика и лексика: 12 ловушек по 5 заданий
export type TrapId =
  | 'articles'
  | 'perfect'
  | 'tenses'
  | 'prepositions'
  | 'questions'
  | 'conditionals'
  | 'verb-patterns'
  | 'collocations'
  | 'false-friends'
  | 'countable'
  | 'phrasal'
  | 'reported';

interface ItemBase {
  id: string; // g01…g60, порядок показа — по id
  trap: TrapId;
  level: 'B1' | 'B2' | 'C1';
  explain: string; // по-русски, для разбора; во время теста не показывается
}
// Выбор варианта: в prompt пропуск обозначен «___».
export interface ChoiceItem extends ItemBase {
  kind: 'choice';
  prompt: string;
  options: string[];
  answer: number;
}
// Вписать слово: в prompt пропуск «___», в hint — подсказка в скобках, например «(not / see)».
export interface GapItem extends ItemBase {
  kind: 'gap';
  prompt: string;
  hint?: string;
  accept: string[];
}
// Найти ошибку: в sentence ровно четыре фрагмента в [квадратных скобках], answer — номер ошибочного (0–3).
export interface ErrorItem extends ItemBase {
  kind: 'error';
  sentence: string;
  answer: number;
  correction: string;
}
export type GrammarItem = ChoiceItem | GapItem | ErrorItem;

// Часть 5 — письмо
export interface WritingTask {
  id: string;
  title: string;
  minutes: number;
  minWords: number;
  maxWords?: number;
  format: string; // что это за формат, по-русски
  prompt: string[]; // абзацы задания по-английски
  bullets?: string[];
  closing?: string;
}

// Часть 6 — речь
export type SpeakingType = 'part1' | 'part2' | 'part3' | 'work' | 'retell';
export type Voice = 'Daniel' | 'Karen' | 'Rishi' | 'Samantha';
export interface SpeakingPrompt {
  id: string;
  type: SpeakingType;
  voice: Voice;
  text: string; // что звучит голосом
  card?: string[]; // карточка Part 2 — показывается текстом сразу, как на экзамене
  task?: string; // что сделать, по-русски (для пересказа)
  prepSec: number;
  maxSec: number;
}
