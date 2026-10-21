// Досье сессии для разбора: ответы, баллы, тексты, расшифровки и журнал условий — в одном markdown.
// Запуск: npm run dossier [-- results/<сессия>]. Рядом ложится rater-input.md — только письмо и речь,
// без биографии, самооценки и баллов: это вход для второго, слепого оценщика.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BIOGRAPHY, HOURS_FIELDS, LEVEL_FIELDS } from '../src/content/biography.ru';
import { GRAMMAR, TRAPS } from '../src/content/grammar';
import { PARTS } from '../src/content/parts';
import { CAN_DO, SKILL_LABELS } from '../src/content/selfAssessment.ru';
import { SPEAKING, TYPE_LABELS, VOICE_LABELS } from '../src/content/speaking';
import type { CanDoAnswer, GrammarItem, Skill } from '../src/content/types';
import { WRITING } from '../src/content/writing';
import { LEVELS, grammarScore, isCorrect, selfLevels, type GrammarAnswer, type GrammarResponse } from '../src/lib/scoring';
import { parseErrorSentence } from '../src/lib/items';

const resultsDir = path.resolve(process.env.RESULTS_DIR ?? 'results');
const dir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(resultsDir, (JSON.parse(readFileSync(path.join(resultsDir, 'active.json'), 'utf8')) as { id: string }).id);

function read<T>(rel: string): T | null {
  const f = path.join(dir, rel);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

interface Event {
  t: string;
  type: string;
  part?: string;
  task?: string;
  awayMs?: number;
}
const events: Event[] = existsSync(path.join(dir, 'events.jsonl'))
  ? readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Event)
  : [];

const min = (ms: number) => `${(ms / 60000).toFixed(1).replace('.', ',')} мин`;
const between = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : 0);
const fence = (text: string) => `\`\`\`text\n${text.trim() || '(пусто)'}\n\`\`\``;
const out: string[] = [];
const rater: string[] = [];

// ——— Шапка и ход теста
interface Session {
  id: string;
  form: string;
  createdAt: string;
  parts: Record<string, { status: string; startedAt: string; finishedAt?: string }>;
}
const session = read<Session>('session.json');
out.push(`# Досье: сессия ${session?.id ?? path.basename(dir)}`, '');
out.push(`Собрано ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC скриптом scripts/dossier.ts. Версия теста: ${session?.form?.toUpperCase() ?? '?'}.`, '');
out.push('| Часть | Статус | Начата | Длилась |', '| --- | --- | --- | --- |');
for (const p of PARTS) {
  const pr = session?.parts[p.id];
  out.push(`| ${p.n}. ${p.title} | ${pr?.status ?? 'не начата'} | ${pr?.startedAt?.slice(0, 16).replace('T', ' ') ?? '—'} | ${pr?.finishedAt ? min(between(pr.startedAt, pr.finishedAt)) : '—'} |`);
}

// ——— Условия
out.push('', '## Условия', '');
for (const p of PARTS) {
  const evs = events.filter((e) => e.part === p.id);
  const hidden = evs.filter((e) => e.type === 'visible');
  const blur = evs.filter((e) => e.type === 'focus');
  const paste = evs.filter((e) => e.type === 'paste-blocked').length;
  const sum = (list: Event[]) => list.reduce((s, e) => s + (e.awayMs ?? 0), 0);
  if (!hidden.length && !blur.length && !paste) continue;
  out.push(
    `- **${p.title}:** вкладка скрывалась ${hidden.length} раз (${min(sum(hidden))}); окно теряло фокус ${blur.length} раз (${min(sum(blur))})${paste ? `; заблокировано вставок: ${paste}` : ''}.`,
  );
}
if (!events.some((e) => ['visible', 'focus', 'paste-blocked'].includes(e.type))) out.push('- Уходов со страницы и вставок не было.');

// ——— 1. Биография
interface Bio {
  answers: Record<string, string>;
  hours: Record<string, string>;
  levels: Record<string, string>;
}
const bio = read<Bio>('biography.json');
out.push('', '## 1. Языковая биография', '');
if (!bio) out.push('Нет ответов.');
else
  BIOGRAPHY.forEach((q, i) => {
    out.push(`**${i + 1}. ${q.text}**`, '');
    if (q.kind === 'hours') out.push(HOURS_FIELDS.map((f) => `${f.label}: ${bio.hours[f.key] || '—'} ч/нед`).join(' · '));
    else if (q.kind === 'levels')
      out.push([...LEVEL_FIELDS.map((f) => `${f.label}: ${bio.levels[f.key] || '—'}`), `ожидаемый IELTS: ${bio.levels.ielts || '—'}`].join(' · '));
    else out.push((bio.answers[q.id] ?? '').trim() || '—');
    out.push('');
  });

// ——— 2. Самооценка
const self = read<{ answers: Record<string, CanDoAnswer> }>('self-assessment.json');
out.push('## 2. Самооценка', '');
if (!self) out.push('Нет ответов.');
else {
  const levels = selfLevels(CAN_DO, self.answers);
  out.push(`| Навык | ${LEVELS.join(' | ')} | Индекс (0 = A1 … 5 = C2) | Уровень |`, `| --- | ${LEVELS.map(() => '---').join(' | ')} | --- | --- |`);
  for (const [skill, r] of Object.entries(levels))
    out.push(`| ${SKILL_LABELS[skill as Skill]} | ${LEVELS.map((l) => `${Math.round(r.byLevel[l] * 100)}%`).join(' | ')} | ${r.index} | ${r.label} |`);
  out.push('', 'Доля — «да» плюс половина «с трудом». Утверждения с ответом «с трудом» или «нет»:', '');
  for (const c of CAN_DO) {
    const a = self.answers[c.id];
    if (a === 'hard' || a === 'no') out.push(`- ${SKILL_LABELS[c.skill]}, ${c.level}, ${a === 'hard' ? 'с трудом' : 'нет'}: ${c.text}`);
  }
}

// ——— 3. EF SET
const ef = read<Record<string, string | boolean>>('efset.json');
out.push('', '## 3. EF SET', '');
if (!ef) out.push('Нет данных.');
else if (ef.skipped) out.push('Пропущен.');
else
  out.push(
    `Общий балл ${ef.overall}, чтение ${ef.reading}, слушание ${ef.listening}; уровень на сайте: ${ef.cefr || '—'}; дата ${ef.takenAt}.`,
    '',
    `Что было трудно: ${String(ef.hard ?? '').trim() || '—'}`,
  );

// ——— 4. Грамматика
function itemText(item: GrammarItem): string {
  if (item.kind === 'choice') return `${item.prompt}  (варианты: ${item.options.join(' / ')})`;
  if (item.kind === 'gap') return `${item.prompt} ${item.hint ?? ''}`.trim();
  return item.sentence;
}
function answerText(item: GrammarItem, a: GrammarAnswer): string {
  if (a === null) return 'не знаю';
  if (item.kind === 'choice') return item.options[a as number] ?? String(a);
  if (item.kind === 'error') return `[${parseErrorSentence(item.sentence).find((p) => p.seg === a)?.text ?? a}]`;
  return String(a);
}
function keyText(item: GrammarItem): string {
  if (item.kind === 'choice') return item.options[item.answer] ?? '';
  if (item.kind === 'error') return `[${parseErrorSentence(item.sentence).find((p) => p.seg === item.answer)?.text}] → ${item.correction}`;
  return item.accept.join(' / ');
}

const gr = read<{ startedAt: string; finishedAt?: string; responses: Record<string, GrammarResponse> }>('grammar.json');
out.push('', '## 4. Грамматика и лексика', '');
if (!gr) out.push('Нет ответов.');
else {
  const s = grammarScore(GRAMMAR, gr.responses);
  const times = Object.values(gr.responses)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  out.push(`Верно ${s.correct} из ${s.total}. Время: ${min(between(gr.startedAt, gr.finishedAt))}, медиана ${(median / 1000).toFixed(0)} с на задание.`, '');
  out.push('| Ловушка | Верно | Не знаю | Уверенные ошибки |', '| --- | --- | --- | --- |');
  for (const [trap, t] of Object.entries(s.byTrap))
    out.push(`| ${TRAPS[trap as keyof typeof TRAPS].title} | ${t.correct} из ${t.total} | ${t.dontKnow} | ${t.wrongConfident} |`);
  out.push('', 'Неверные ответы и «не знаю»:', '');
  for (const item of GRAMMAR) {
    const r = gr.responses[item.id];
    if (r && isCorrect(item, r.answer)) continue;
    out.push(
      `- **${item.id}** · ${TRAPS[item.trap].title} · ${item.level}${r ? ` · ${(r.ms / 1000).toFixed(0)} с` : ''}${r?.unsure ? ' · отметил «сомневаюсь»' : ''}`,
      `  - задание: ${itemText(item)}`,
      `  - ответ: ${r ? answerText(item, r.answer) : 'нет ответа'} · ключ: ${keyText(item)}`,
      `  - почему: ${item.explain}`,
    );
  }
}

// ——— 5. Письмо
interface WritingData {
  startedAt: string;
  finishedAt?: string;
  text: string;
  words: number;
  snapshots: { t: number; text: string }[];
  pasteBlocked: number;
  timedOut?: boolean;
  early?: boolean;
}
out.push('', '## 5. Письмо', '');
rater.push('# Материалы для слепой оценки', '', 'Письмо и речь одного человека. Других сведений о нём нет — так задумано.', '', '## Письмо', '');
for (const t of WRITING) {
  const w = read<WritingData>(`writing/${t.id}.json`);
  const head = `### ${t.title} (${t.id})`;
  const task = [...t.prompt, ...(t.bullets ?? []).map((b) => `- ${b}`), t.closing ?? ''].filter(Boolean).join('\n');
  out.push(head, '', `Формат: ${t.format} Время: ${t.minutes} мин, нужно ${t.maxWords ? `${t.minWords}–${t.maxWords}` : `от ${t.minWords}`} слов.`, '');
  rater.push(head, '', `Задание (${t.minutes} мин, ${t.maxWords ? `${t.minWords}–${t.maxWords}` : `от ${t.minWords}`} слов):`, '', fence(task), '');
  if (!w) {
    out.push('Не выполнено.', '');
    rater.push('Не выполнено.', '');
    continue;
  }
  const shrinks = w.snapshots.filter((s, i) => i > 0 && s.text.length < (w.snapshots[i - 1]?.text.length ?? 0)).length;
  const away = events.filter((e) => e.task === t.id && (e.type === 'visible' || e.type === 'focus')).reduce((s, e) => s + (e.awayMs ?? 0), 0);
  out.push(
    `Слов: ${w.words}. Время: ${min(between(w.startedAt, w.finishedAt))}${w.timedOut ? ' (закончилось по таймеру)' : w.early ? ' (сдано досрочно)' : ''}. Снимков: ${w.snapshots.length}, из них с сокращением текста: ${shrinks}. Вставок заблокировано: ${w.pasteBlocked}. Вне страницы: ${min(away)}.`,
    '',
    fence(w.text),
    '',
  );
  rater.push(`Слов: ${w.words}. Время: ${min(between(w.startedAt, w.finishedAt))}.`, '', fence(w.text), '');
}

// ——— 6. Речь
interface Metrics {
  speechRateWpm: number;
  articulationRateSps: number;
  meanLengthOfRun: number;
  latencySec: number;
  words: number;
  pauses: { perMin: number; meanSec: number; longestSec: number; midClause: { perMin: number } };
  filledPausesPerMin: number;
  mattr: number;
  rareShare: number;
  lowConfidence?: { w: string; start: number }[];
  pauseList?: { after: string; before: string; at: number; sec: number; boundary: boolean }[];
  flags?: string[];
  windowSec?: number;
}
interface MetricsFile {
  overall: Metrics;
  byType: Record<string, Metrics>;
  perPrompt: Record<string, Metrics>;
}
interface ManifestItem {
  durationMs?: number;
  textShown: boolean;
  replays: number;
  skipped: boolean;
  notes?: string;
}
const metrics = read<MetricsFile>('metrics.json');
const manifest = read<{ items: Record<string, ManifestItem>; mic?: { label: string } }>('speaking/manifest.json');
const row = (name: string, m: Metrics) =>
  `| ${name} | ${m.words} | ${m.speechRateWpm} | ${m.articulationRateSps} | ${m.meanLengthOfRun} | ${m.pauses.perMin} | ${m.pauses.midClause.perMin} | ${m.pauses.meanSec ?? '—'} | ${m.filledPausesPerMin} | ${m.latencySec} | ${m.mattr} | ${Math.round(m.rareShare * 100)}% |`;
const header = [
  '| | Слов | Слов/мин | Слогов/с без пауз | Слов между паузами | Пауз/мин | Внутри фразы/мин | Средняя пауза, с | «Эээ»/мин | До начала речи, с | MATTR | Редкие слова |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

out.push('', '## 6. Речь', '');
rater.push('## Речь', '', 'Расшифровка Whisper; паузы — по детектору речи (порог 0,25 с). «Эээ» и повторы Whisper частично выбрасывает.', '');
if (!manifest) out.push('Записей нет.');
else {
  out.push(`Микрофон: ${manifest.mic?.label || 'по умолчанию'}.`, '');
  if (!metrics) out.push('**Расшифровки ещё нет: запусти `npm run transcribe`, потом собери досье заново.**', '');
  else {
    out.push(...header, row('Всё вместе', metrics.overall));
    for (const [type, m] of Object.entries(metrics.byType)) out.push(row(TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type, m));
    out.push('');
  }
  for (const p of SPEAKING) {
    const item = manifest.items[p.id];
    const m = metrics?.perPrompt[p.id];
    const tr = read<{ text: string }>(`transcripts/${p.id}.json`);
    const title = `### ${p.id} · ${TYPE_LABELS[p.type]} · ${VOICE_LABELS[p.voice]}`;
    out.push(title, '', `Вопрос: ${p.text}`);
    rater.push(
      title,
      '',
      `Вопрос: ${p.card ? p.card.join(' ') : p.text}${p.task ? ` (задание: ${p.task})` : ''}`,
      `Лимит ответа: ${p.maxSec} с${p.prepSec ? `, подготовка ${p.prepSec} с` : ''}.`,
    );
    if (!item) {
      out.push('', 'Не записан.', '');
      rater.push('', 'Не записан.', '');
      continue;
    }
    if (item.skipped) {
      out.push('', 'Пропущен.', '');
      rater.push('', 'Пропущен.', '');
      continue;
    }
    const flags = [item.textShown ? 'открывал текст вопроса' : '', item.replays ? `переслушивал ${item.replays} раз` : '', ...(m?.flags ?? [])].filter(Boolean);
    out.push(`Длительность: ${((item.durationMs ?? 0) / 1000).toFixed(0)} с${flags.length ? `; ${flags.join('; ')}` : ''}.`);
    if (item.notes) out.push(`Заметки к монологу: ${item.notes.trim()}`);
    if (m)
      out.push(
        `Слов ${m.words}, ${m.speechRateWpm} слов/мин, ${m.meanLengthOfRun} слов между паузами, ${m.pauses.perMin} пауз/мин (внутри фразы ${m.pauses.midClause.perMin}), самая длинная ${m.pauses.longestSec} с, до начала речи ${m.latencySec} с.`,
      );
    const longest = [...(m?.pauseList ?? [])].sort((a, b) => b.sec - a.sec).slice(0, 3);
    if (longest.length) out.push(`Самые длинные паузы: ${longest.map((x) => `«${x.after} … ${x.before}» ${x.sec} с${x.boundary ? '' : ' (внутри фразы)'}`).join('; ')}.`);
    if (m?.lowConfidence?.length) out.push(`Переслушать: ${m.lowConfidence.map((w) => `${w.w} (${w.start.toFixed(1)} с)`).join(', ')}.`);
    out.push('', tr ? fence(tr.text) : '(расшифровки нет)', '');
    // Это условие задания, а не сведения о человеке: без него оценщик не знает, судить ли по пересказу о слушании.
    rater.push(
      `Условия: ${item.textShown ? 'открывал текст вопроса' : 'текст вопроса не открывал'}${item.replays ? `, переслушивал ${item.replays} раз` : ''}.`,
    );
    rater.push(
      m ? `Длительность ${((item.durationMs ?? 0) / 1000).toFixed(0)} с; ${m.speechRateWpm} слов/мин; ${m.meanLengthOfRun} слов между паузами; ${m.pauses.perMin} пауз/мин, внутри фразы ${m.pauses.midClause.perMin}.` : '',
      '',
      tr ? fence(tr.text) : '(расшифровки нет)',
      '',
    );
  }
}

writeFileSync(path.join(dir, 'dossier.md'), `${out.join('\n')}\n`);
writeFileSync(path.join(dir, 'rater-input.md'), `${rater.join('\n')}\n`);
console.log(`✓ ${path.relative(process.cwd(), path.join(dir, 'dossier.md'))}`);
console.log(`✓ ${path.relative(process.cwd(), path.join(dir, 'rater-input.md'))}`);
