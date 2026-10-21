<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { WritingTask } from '../content/types';
import { WRITING } from '../content/writing';
import { createSaver, logEvent, readJson, writeJson } from '../lib/api';
import { setContext } from '../lib/conditions';
import { countWords } from '../lib/scoring';
import { finishPart, state } from '../lib/session';
import { plural, sec, useDeadline } from '../lib/timer';

interface TaskData {
  id: string;
  startedAt: string;
  deadline: number;
  text: string;
  words: number;
  snapshots: { t: number; text: string }[]; // снимок раз в 10 секунд: видно, как текст писался и правился
  pasteBlocked: number;
  finishedAt?: string;
  timedOut?: boolean;
  early?: boolean;
}

const data = reactive<Record<string, TaskData | undefined>>({});
const loaded = ref(false);
const activeId = ref<string | null>(null);
const pasteNote = ref(false);
let snapshotTimer: ReturnType<typeof setInterval> | undefined;

const active = computed(() => (activeId.value ? data[activeId.value] : undefined));
const activeTask = computed(() => WRITING.find((t) => t.id === activeId.value));
const currentIndex = computed(() => WRITING.findIndex((t) => !data[t.id]?.finishedAt));
const savers = new Map(WRITING.map((t) => [t.id, createSaver(() => `writing/${t.id}.json`, () => data[t.id])]));

const { remaining, label } = useDeadline(
  () => (active.value && !active.value.finishedAt ? active.value.deadline : null),
  () => void finishTask('timeout'),
);
const timerClass = computed(() => {
  if (remaining.value === null) return '';
  if (remaining.value === 0) return 'out';
  return remaining.value < sec(120) ? 'low' : '';
});

onMounted(async () => {
  for (const t of WRITING) {
    const saved = await readJson<TaskData>(`writing/${t.id}.json`);
    if (saved) data[t.id] = saved;
  }
  // Задание начато, но не сдано: время шло и без страницы. Либо продолжаем, либо закрываем по таймеру.
  const open = WRITING.map((t) => data[t.id]).find((d) => d && !d.finishedAt);
  if (open) {
    if (Date.now() >= open.deadline) {
      activeId.value = open.id;
      await finishTask('timeout');
      activeId.value = null;
    } else enterTask(open.id);
  }
  loaded.value = true;
});

onBeforeUnmount(() => {
  stopSnapshots();
  for (const s of savers.values()) {
    void s.flush();
    s.dispose();
  }
  state.lockNav = false;
});

function enterTask(id: string) {
  activeId.value = id;
  state.lockNav = true;
  setContext({ part: 'writing', task: id });
  stopSnapshots();
  snapshotTimer = setInterval(snapshot, sec(10));
  window.scrollTo(0, 0);
}

function snapshot() {
  const d = active.value;
  if (!d || d.finishedAt) return;
  const last = d.snapshots[d.snapshots.length - 1];
  if (last?.text === d.text) return;
  d.snapshots.push({ t: Date.now() - Date.parse(d.startedAt), text: d.text });
  savers.get(d.id)?.schedule();
}

function stopSnapshots() {
  if (snapshotTimer) clearInterval(snapshotTimer);
  snapshotTimer = undefined;
}

async function startTask(task: WritingTask) {
  if (!window.confirm(`Задание на ${task.minutes} минут. Таймер не остановится, даже если закрыть страницу. Начать?`)) return;
  const now = Date.now();
  data[task.id] = {
    id: task.id,
    startedAt: new Date(now).toISOString(),
    deadline: now + sec(task.minutes * 60),
    text: '',
    words: 0,
    snapshots: [],
    pasteBlocked: 0,
  };
  await writeJson(`writing/${task.id}.json`, data[task.id]);
  logEvent('writing-start', { part: 'writing', task: task.id });
  enterTask(task.id);
}

function onInput() {
  const d = active.value;
  if (!d) return;
  d.words = countWords(d.text);
  savers.get(d.id)?.schedule();
}

function onPaste() {
  const d = active.value;
  if (!d) return;
  d.pasteBlocked++;
  pasteNote.value = true;
  logEvent('paste-blocked', { part: 'writing', task: d.id });
  savers.get(d.id)?.schedule();
}

// Вставку из буфера, перетаскивание и подстановки браузера отсекаем на уровне ввода — так текст пишется только руками.
function onBeforeInput(e: InputEvent) {
  if (['insertFromPaste', 'insertFromDrop', 'insertFromYank', 'insertReplacementText'].includes(e.inputType)) {
    e.preventDefault();
    onPaste();
  }
}

async function finishTask(reason: 'timeout' | 'early') {
  const d = active.value;
  if (!d || d.finishedAt) return;
  if (reason === 'early' && !window.confirm('Сдать задание досрочно? Дописать потом будет нельзя.')) return;
  snapshot();
  stopSnapshots();
  d.words = countWords(d.text);
  d.finishedAt = new Date().toISOString();
  d.timedOut = reason === 'timeout';
  d.early = reason === 'early';
  await writeJson(`writing/${d.id}.json`, d);
  logEvent('writing-finish', { part: 'writing', task: d.id, reason, words: d.words });
  state.lockNav = false;
  setContext({ part: 'writing' });
}

function backToList() {
  activeId.value = null;
  pasteNote.value = false;
  window.scrollTo(0, 0);
}

async function submitPart() {
  await finishPart('writing');
}

const wordsLabel = (n: number) => `${n} ${plural(n, ['слово', 'слова', 'слов'])}`;
</script>

<template>
  <section v-if="loaded" class="stack">
    <template v-if="active && activeTask">
      <div class="row spread">
        <h1>{{ activeTask.title }}</h1>
        <span v-if="!active.finishedAt" class="timer" :class="timerClass" data-testid="writing-timer">{{ label }}</span>
      </div>
      <p class="muted">{{ activeTask.format }}</p>

      <div class="task-card en" translate="no">
        <p v-for="p in activeTask.prompt" :key="p">{{ p }}</p>
        <ul v-if="activeTask.bullets">
          <li v-for="b in activeTask.bullets" :key="b">{{ b }}</li>
        </ul>
        <p v-if="activeTask.closing"><em>{{ activeTask.closing }}</em></p>
      </div>

      <div v-if="active.finishedAt" class="card soft" data-testid="writing-finished">
        {{ active.timedOut ? 'Время вышло. Ответ сохранён.' : 'Задание сдано.' }} {{ wordsLabel(active.words) }}.
      </div>
      <div v-else-if="pasteNote" class="card warn">Вставка текста отключена: в этой части текст пишется только руками.</div>

      <textarea
        v-model="active.text"
        class="writing-area"
        :readonly="!!active.finishedAt"
        aria-label="Твой ответ"
        lang="en"
        translate="no"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-testid="writing-text"
        @input="onInput"
        @paste.prevent="onPaste"
        @drop.prevent="onPaste"
        @beforeinput="onBeforeInput"
      />

      <div class="row spread">
        <span class="muted" data-testid="word-count">
          {{ wordsLabel(active.words) }} · нужно {{ activeTask.maxWords ? `${activeTask.minWords}–${activeTask.maxWords}` : `от ${activeTask.minWords}` }}
        </span>
        <button v-if="!active.finishedAt" class="btn" type="button" data-testid="finish-early" @click="finishTask('early')">
          Сдать досрочно
        </button>
        <button v-else class="btn primary" type="button" data-testid="back-to-list" @click="backToList">К списку заданий</button>
      </div>
    </template>

    <template v-else>
      <h1>Письмо</h1>
      <div class="card soft">
        <p>
          Три задания на время, по очереди. Пиши сам: без переводчика, ИИ и проверки орфографии — она здесь выключена, а вставка
          текста заблокирована. Задание открывается только после кнопки «Начать», и с этого момента идёт таймер.
        </p>
        <p class="muted">Между заданиями можно отдохнуть. Внутри задания таймер не останавливается.</p>
      </div>

      <ul class="parts">
        <li v-for="(t, i) in WRITING" :key="t.id" class="card" :data-testid="`task-${t.id}`">
          <div class="part-row" :class="{ done: !!data[t.id]?.finishedAt, locked: i > currentIndex && currentIndex !== -1 }">
            <span class="n" aria-hidden="true">{{ data[t.id]?.finishedAt ? '✓' : i + 1 }}</span>
            <div class="grow">
              <strong>{{ t.title }}</strong>
              <span class="muted"> · {{ t.minutes }} мин · {{ t.maxWords ? `${t.minWords}–${t.maxWords}` : `от ${t.minWords}` }} слов</span>
              <br />
              <small>{{ data[t.id]?.finishedAt ? `Сдано: ${wordsLabel(data[t.id]?.words ?? 0)}.` : t.format }}</small>
            </div>
            <button v-if="i === currentIndex" class="btn primary small" type="button" data-testid="start-task" @click="startTask(t)">
              Начать
            </button>
          </div>
        </li>
      </ul>

      <div v-if="currentIndex === -1" class="row">
        <button class="btn primary" type="button" data-testid="submit-part" @click="submitPart">Сдать часть</button>
      </div>
    </template>
  </section>
</template>
