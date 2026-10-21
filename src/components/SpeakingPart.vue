<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { SPEAKING, TYPE_LABELS, VOICE_LABELS, audioUrl } from '../content/speaking';
import type { SpeakingPrompt, SpeakingType, Voice } from '../content/types';
import { logEvent, readJson, writeFile, writeJson } from '../lib/api';
import { setContext } from '../lib/conditions';
import { Recording, beep, extFor, getMic, levelMeter, type MicInfo } from '../lib/recorder';
import { finishPart, state } from '../lib/session';
import { SPEED, sec, useDeadline } from '../lib/timer';
import AutoTextarea from './AutoTextarea.vue';
import MicCheck from './MicCheck.vue';
import ProgressBar from './ProgressBar.vue';

// Формат speaking/manifest.json читает расшифровка (pipeline/transcribe.py) — поля меняются только вместе с ней.
interface ManifestItem {
  id: string;
  type: SpeakingType;
  voice: Voice;
  prompt: string;
  file?: string;
  mimeType?: string;
  startedAt?: string;
  durationMs?: number;
  prepMs?: number; // от конца вопроса до начала записи
  textShown: boolean;
  replays: number;
  skipped: boolean;
  bytes?: number;
  notes?: string;
}
interface Manifest {
  items: Record<string, ManifestItem>;
  mic?: MicInfo;
  userAgent?: string;
}

type Phase = 'intro' | 'ready' | 'listening' | 'prep' | 'recording' | 'saving' | 'done';

const manifest = reactive<Manifest>({ items: {} });
const loaded = ref(false);
const phase = ref<Phase>('intro');
const idx = ref(0);
const textShown = ref(false);
const replays = ref(0);
const notes = ref('');
const level = ref(0);
const saveError = ref('');
const prepDeadline = ref<number | null>(null);
const recDeadline = ref<number | null>(null);
let audio: HTMLAudioElement | null = null;
let recording: Recording | null = null;
let stopMeter: (() => void) | null = null;
let audioEndedAt = 0;
let unsaved: { blob: Blob; item: ManifestItem } | null = null;

// После последнего вопроса idx выходит за список; экран тогда показывает «готово», а prompt держится на последнем.
const prompt = computed<SpeakingPrompt>(() => SPEAKING[Math.min(idx.value, SPEAKING.length - 1)]!);
const answeredCount = computed(() => Object.keys(manifest.items).length);
const prep = useDeadline(
  () => (phase.value === 'prep' ? prepDeadline.value : null),
  () => void startRecording(),
);
const rec = useDeadline(
  () => (phase.value === 'recording' ? recDeadline.value : null),
  () => void stopRecording(),
);

onMounted(async () => {
  const saved = await readJson<Manifest>('speaking/manifest.json');
  if (saved) Object.assign(manifest, saved);
  const open = SPEAKING.findIndex((p) => !manifest.items[p.id]);
  idx.value = open >= 0 ? open : SPEAKING.length;
  phase.value = open >= 0 ? 'intro' : 'done';
  loaded.value = true;
});

onBeforeUnmount(() => {
  stopAudio();
  stopMeter?.();
  if (recording) void recording.stop();
  state.lockNav = false;
});

const saveManifest = () => writeJson('speaking/manifest.json', manifest);

function onMicReady(info: MicInfo) {
  manifest.mic = info;
  manifest.userAgent = navigator.userAgent;
  void saveManifest();
  phase.value = 'ready';
  setContext({ part: 'speaking', task: prompt.value.id });
}

function resetPrompt() {
  textShown.value = false;
  replays.value = 0;
  notes.value = '';
  prepDeadline.value = null;
  recDeadline.value = null;
  audioEndedAt = 0;
}

function stopAudio() {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio = null;
}

function play() {
  stopAudio();
  const a = new Audio(audioUrl(prompt.value.id));
  if (SPEED > 1) a.playbackRate = Math.min(16, SPEED);
  audio = a;
  a.onended = onAudioEnded;
  a.onerror = onAudioFailed;
  a.play().catch(onAudioFailed);
}

// Без звука вопрос всё равно должен дойти: показываем текст и пишем в журнал, что вопрос был прочитан, а не услышан.
function onAudioFailed() {
  logEvent('audio-error', { part: 'speaking', task: prompt.value.id });
  textShown.value = true;
  onAudioEnded();
}

function listen() {
  state.lockNav = true;
  phase.value = 'listening';
  logEvent('speaking-listen', { part: 'speaking', task: prompt.value.id });
  play();
}

function replay() {
  replays.value++;
  logEvent('speaking-replay', { part: 'speaking', task: prompt.value.id, phase: phase.value });
  play();
}

function showText() {
  textShown.value = true;
  logEvent('speaking-text-shown', { part: 'speaking', task: prompt.value.id, phase: phase.value });
}

function onAudioEnded() {
  if (phase.value !== 'listening') return; // повтор во время подготовки фазу не меняет
  audioEndedAt = Date.now();
  if (prompt.value.prepSec > 0) {
    prepDeadline.value = Date.now() + sec(prompt.value.prepSec);
    phase.value = 'prep';
  } else void startRecording();
}

async function startRecording() {
  if (phase.value !== 'listening' && phase.value !== 'prep') return;
  if (!audioEndedAt) audioEndedAt = Date.now();
  stopAudio();
  recDeadline.value = null;
  phase.value = 'recording';
  const stream = await getMic();
  await beep();
  recording = new Recording(stream);
  recording.start();
  stopMeter = levelMeter(stream, (v) => (level.value = v));
  recDeadline.value = Date.now() + sec(prompt.value.maxSec);
}

async function stopRecording() {
  if (phase.value !== 'recording' || !recording) return;
  phase.value = 'saving';
  const r = recording;
  recording = null;
  const stoppedAt = Date.now();
  stopMeter?.();
  stopMeter = null;
  const blob = await r.stop();
  const p = prompt.value;
  const mimeType = blob.type || r.mime;
  const file = `speaking/${p.id}.${extFor(mimeType)}`;
  const item: ManifestItem = {
    id: p.id,
    type: p.type,
    voice: p.voice,
    prompt: p.text,
    file,
    mimeType,
    startedAt: new Date(r.startedAt).toISOString(),
    durationMs: stoppedAt - r.startedAt,
    prepMs: Math.max(0, r.startedAt - audioEndedAt),
    textShown: textShown.value,
    replays: replays.value,
    skipped: false,
    bytes: blob.size,
    ...(notes.value.trim() ? { notes: notes.value } : {}),
  };
  await persist(blob, item);
}

async function persist(blob: Blob, item: ManifestItem) {
  try {
    await writeFile(item.file ?? '', blob);
    manifest.items[item.id] = item;
    await saveManifest();
    unsaved = null;
    saveError.value = '';
    logEvent('speaking-saved', { part: 'speaking', task: item.id, ms: item.durationMs });
    next();
  } catch {
    unsaved = { blob, item };
    saveError.value = 'Запись не сохранилась. Проверь, что сервер запущен, и нажми «Сохранить ещё раз».';
  }
}

function retrySave() {
  if (unsaved) void persist(unsaved.blob, unsaved.item);
}

async function skip() {
  if (!window.confirm('Пропустить этот вопрос? Вернуться к нему будет нельзя.')) return;
  stopAudio();
  const p = prompt.value;
  manifest.items[p.id] = { id: p.id, type: p.type, voice: p.voice, prompt: p.text, textShown: textShown.value, replays: replays.value, skipped: true };
  await saveManifest();
  logEvent('speaking-skip', { part: 'speaking', task: p.id });
  next();
}

function next() {
  idx.value++;
  resetPrompt();
  state.lockNav = false;
  if (idx.value >= SPEAKING.length) {
    phase.value = 'done';
    setContext({ part: 'speaking' });
  } else {
    phase.value = 'ready';
    setContext({ part: 'speaking', task: prompt.value.id });
  }
  window.scrollTo(0, 0);
}

async function submitPart() {
  await finishPart('speaking');
}
</script>

<template>
  <section v-if="loaded" class="stack">
    <h1>Речь</h1>

    <template v-if="phase === 'intro'">
      <div class="card stack">
        <p v-if="answeredCount">Продолжаем с вопроса {{ idx + 1 }} из {{ SPEAKING.length }}.</p>
        <p>
          {{ SPEAKING.length }} ответов голосом, около 30 минут. Вопрос звучит один раз, и сразу после него начинается запись —
          отвечай, как на созвоне. Нужно подумать — думай вслух, это нормально.
        </p>
        <ul>
          <li>Переслушать вопрос или открыть его текст можно, но это попадёт в журнал: так разбор отделит понимание на слух от речи.</li>
          <li>Ответ закончится сам по лимиту времени. Сказал всё раньше — жми «Закончить ответ».</li>
          <li>Перезаписать ответ нельзя: первая попытка и есть замер.</li>
        </ul>
      </div>
      <MicCheck @ready="onMicReady" />
    </template>

    <template v-else-if="phase !== 'done' && prompt">
      <div class="row spread">
        <span class="muted">Вопрос {{ idx + 1 }} из {{ SPEAKING.length }} · {{ TYPE_LABELS[prompt.type] }} · {{ VOICE_LABELS[prompt.voice] }}</span>
      </div>
      <ProgressBar :value="idx" :max="SPEAKING.length" label="Записано ответов" />

      <div v-if="prompt.task" class="card soft">{{ prompt.task }}</div>

      <div v-if="prompt.card && phase !== 'ready'" class="task-card en" translate="no" data-testid="cue-card">
        <p v-for="line in prompt.card" :key="line">{{ line }}</p>
      </div>

      <div v-if="textShown" class="task-card en" translate="no" data-testid="prompt-text">
        <p>{{ prompt.text }}</p>
      </div>

      <div class="card stack" :data-testid="`speaking-${prompt.id}`">
        <template v-if="phase === 'ready'">
          <p>
            {{
              prompt.type === 'retell'
                ? 'Сейчас прозвучит голосовое сообщение клиента. Потом будет 20 секунд на подготовку и запись.'
                : prompt.type === 'part2'
                  ? 'Сейчас прозвучит инструкция и появится карточка с темой. Минута на подготовку, потом до двух минут рассказа.'
                  : 'Нажми, когда будешь готов. Запись начнётся сразу после вопроса.'
            }}
          </p>
          <div class="row spread">
            <button class="btn primary" type="button" data-testid="listen" @click="listen">Слушать вопрос</button>
            <button class="btn ghost" type="button" @click="skip">Пропустить</button>
          </div>
        </template>

        <template v-else-if="phase === 'listening'">
          <p>Звучит вопрос…</p>
          <div class="row">
            <button v-if="!textShown" class="btn small" type="button" @click="showText">Показать текст</button>
          </div>
        </template>

        <template v-else-if="phase === 'prep'">
          <div class="row spread">
            <strong>Подготовка</strong>
            <span class="timer" data-testid="prep-timer">{{ prep.label.value }}</span>
          </div>
          <div v-if="prompt.type === 'part2'">
            <label for="part2-notes">Заметки — их видишь только ты</label>
            <AutoTextarea id="part2-notes" v-model="notes" label="Заметки" />
          </div>
          <div class="row">
            <button class="btn small" type="button" @click="replay">Переслушать</button>
            <button v-if="!textShown" class="btn small" type="button" @click="showText">Показать текст</button>
            <button class="btn primary small" type="button" data-testid="start-now" @click="startRecording">Начать отвечать сейчас</button>
          </div>
        </template>

        <template v-else-if="phase === 'recording'">
          <div class="row spread">
            <span><span class="rec-dot" aria-hidden="true" /> <strong>Идёт запись</strong></span>
            <span class="timer" :class="{ low: (rec.remaining.value ?? 0) < sec(15) }" data-testid="rec-timer">{{ rec.label.value }}</span>
          </div>
          <div class="meter" aria-hidden="true"><span :style="{ width: `${Math.round(level * 100)}%` }" /></div>
          <div class="row spread">
            <button v-if="!textShown" class="btn small" type="button" @click="showText">Показать текст</button>
            <span v-else />
            <button class="btn primary" type="button" data-testid="stop-answer" @click="stopRecording">Закончить ответ</button>
          </div>
        </template>

        <template v-else-if="phase === 'saving'">
          <p v-if="!saveError">Сохраняю запись…</p>
          <template v-else>
            <p class="card danger">{{ saveError }}</p>
            <div class="row">
              <button class="btn primary" type="button" @click="retrySave">Сохранить ещё раз</button>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template v-else>
      <div class="card soft" data-testid="speaking-done">
        <p>
          <strong>Все ответы записаны.</strong> Записи лежат в <code>results/{{ state.session?.id }}/speaking/</code>, расшифровку
          я сделаю после сдачи части.
        </p>
      </div>
      <div class="row">
        <button class="btn primary" type="button" data-testid="submit-part" @click="submitPart">Сдать часть</button>
      </div>
    </template>
  </section>
</template>
