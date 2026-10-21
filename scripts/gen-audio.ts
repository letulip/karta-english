// Озвучка вопросов части 6 голосами macOS. Запуск: npm run audio (с --force — перезаписать всё).
// Файлы лежат в public/audio и хранятся в git: тест работает без повторной генерации, а голоса не меняются между попытками.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SPEAKING, VOICE_RATE } from '../src/content/speaking.ts';

const out = path.resolve('public/audio');
const force = process.argv.includes('--force');
const tmp = mkdtempSync(path.join(tmpdir(), 'english-karta-audio-'));
mkdirSync(out, { recursive: true });

try {
  for (const p of SPEAKING) {
    const target = path.join(out, `${p.id}.mp3`);
    if (existsSync(target) && !force) continue;
    const aiff = path.join(tmp, `${p.id}.aiff`);
    execFileSync('say', ['-v', p.voice, '-r', String(VOICE_RATE[p.voice]), '-o', aiff, p.text]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k', target]);
    console.log(`✓ ${p.id} — ${p.voice}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
