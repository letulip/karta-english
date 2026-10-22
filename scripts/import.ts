// Распаковка архива из версии для GitHub Pages в results/: дальше всё как у локальной версии —
// npm run transcribe, npm run dossier и разбор. Сессия из архива становится активной.
// Запуск: npm run import -- ~/Downloads/karta-english-a-2026-10-22.zip [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safeRelPath } from '../server/resultsApi';
import { unpackSession } from '../src/lib/archive';

const args = process.argv.slice(2).filter((a) => a !== '--');
const zipPath = args.find((a) => !a.startsWith('--'));
const force = args.includes('--force');
if (!zipPath) {
  console.error('Укажи архив: npm run import -- ~/Downloads/karta-english-….zip');
  process.exit(2);
}

const root = path.resolve(process.env.RESULTS_DIR ?? 'results');
const { id, files, events } = unpackSession(new Uint8Array(readFileSync(path.resolve(zipPath))));
const dir = path.join(root, id);
if (existsSync(dir) && !force) {
  console.error(`Папка ${path.relative(process.cwd(), dir)} уже есть. Добавь --force, чтобы перезаписать её содержимым архива.`);
  process.exit(1);
}

let written = 0;
for (const f of files) {
  // Пути из архива проходят ту же проверку, что и запросы к локальному серверу: ничего не пишется за пределы папки сессии.
  const rel = safeRelPath(f.rel);
  if (!rel) {
    console.warn(`Пропускаю файл с недопустимым путём: ${f.rel}`);
    continue;
  }
  const target = path.join(dir, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, f.data);
  written++;
}
writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
writeFileSync(path.join(root, 'active.json'), JSON.stringify({ id }, null, 2));
console.log(`✓ ${path.relative(process.cwd(), dir)}: ${written} файлов, ${events.length} событий. Сессия ${id} теперь активная.`);
