<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { GRAMMAR } from '../content/grammar';
import { createSaver, readJson, writeJson } from '../lib/api';
import { parseErrorSentence, splitBlank } from '../lib/items';
import { grammarScore, type GrammarAnswer, type GrammarResponse } from '../lib/scoring';
import { finishPart } from '../lib/session';
import { formatMs, useNow } from '../lib/timer';
import ProgressBar from './ProgressBar.vue';

const SUGGESTED_MIN = 25;

const responses = reactive<Record<string, GrammarResponse>>({});
const startedAt = ref<string | null>(null);
const loaded = ref(false);
const idx = ref(0);
const shownAt = ref(Date.now());
const choice = ref<number | null>(null);
const gap = ref('');
const unsure = ref(false);
const gapInput = ref<HTMLInputElement>();
const now = useNow();

const item = computed(() => GRAMMAR[idx.value]);
const finished = computed(() => idx.value >= GRAMMAR.length);
const blank = computed(() => (item.value && item.value.kind !== 'error' ? splitBlank(item.value.prompt) : ['', '']));
const pieces = computed(() => (item.value?.kind === 'error' ? parseErrorSentence(item.value.sentence) : []));
const canAnswer = computed(() => (item.value?.kind === 'gap' ? gap.value.trim() !== '' : choice.value !== null));
const elapsed = computed(() => (startedAt.value ? formatMs(now.value - Date.parse(startedAt.value)) : '0:00'));

const saver = createSaver(
  () => 'grammar.json',
  () => ({ order: GRAMMAR.map((i) => i.id), startedAt: startedAt.value, responses, updatedAt: new Date().toISOString() }),
);

onMounted(async () => {
  const saved = await readJson<{ startedAt: string | null; responses: Record<string, GrammarResponse> }>('grammar.json');
  if (saved) {
    Object.assign(responses, saved.responses);
    startedAt.value = saved.startedAt;
  }
  const open = GRAMMAR.findIndex((i) => !responses[i.id]);
  idx.value = open >= 0 ? open : GRAMMAR.length;
  loaded.value = true;
});
onBeforeUnmount(() => {
  void saver.flush();
  saver.dispose();
});

function begin() {
  startedAt.value = new Date().toISOString();
  shownAt.value = Date.now();
  saver.schedule();
}

function record(answer: GrammarAnswer) {
  const current = item.value;
  if (!current) return;
  responses[current.id] = { answer, unsure: unsure.value, ms: Date.now() - shownAt.value, at: new Date().toISOString() };
  saver.schedule();
  idx.value++;
  choice.value = null;
  gap.value = '';
  unsure.value = false;
  shownAt.value = Date.now();
  window.scrollTo(0, 0);
  void nextTick(() => gapInput.value?.focus());
}

function submitAnswer() {
  if (!canAnswer.value || !item.value) return;
  record(item.value.kind === 'gap' ? gap.value : choice.value);
}

async function submitPart() {
  await saver.flush();
  await writeJson('grammar.json', {
    order: GRAMMAR.map((i) => i.id),
    startedAt: startedAt.value,
    responses,
    score: grammarScore(GRAMMAR, responses),
    finishedAt: new Date().toISOString(),
  });
  await finishPart('grammar');
}
</script>

<template>
  <section v-if="loaded" class="stack">
    <h1>Грамматика и лексика</h1>

    <template v-if="!startedAt">
      <div class="card stack">
        <p>{{ GRAMMAR.length }} коротких заданий, примерно {{ SUGGESTED_MIN }} минут. Жёсткого таймера нет, но долго не думай: первое решение честнее.</p>
        <ul>
          <li>Одно задание — один экран. Назад вернуться нельзя.</li>
          <li>Не знаешь — жми «Не знаю». Это честнее угадывания и точнее покажет пробелы.</li>
          <li>Отметь «Сомневаюсь», если ответил наугад или не уверен. Так разбор отличит пробел в знаниях от закрепившейся ошибки.</li>
          <li>Результат не показывается до разбора: так он не повлияет на следующие части.</li>
        </ul>
      </div>
      <div class="row">
        <button class="btn primary" type="button" data-testid="grammar-begin" @click="begin">Начать</button>
      </div>
    </template>

    <template v-else-if="!finished && item">
      <div class="row spread">
        <span class="muted">Задание {{ idx + 1 }} из {{ GRAMMAR.length }}</span>
        <span class="timer" :title="`Рекомендуется около ${SUGGESTED_MIN} минут`">{{ elapsed }}</span>
      </div>
      <ProgressBar :value="idx" :max="GRAMMAR.length" label="Пройдено заданий" />

      <div class="card stack" :data-testid="`item-${item.id}`">
        <p class="muted">
          <template v-if="item.kind === 'choice'">Выбери вариант для пропуска.</template>
          <template v-else-if="item.kind === 'gap'">Впиши в пропуск нужную форму.</template>
          <template v-else>В одном из выделенных фрагментов ошибка. Нажми на него.</template>
        </p>

        <p v-if="item.kind === 'choice'" class="en" translate="no">
          {{ blank[0] }}<span class="blank">{{ choice !== null ? item.options[choice] : ' ' }}</span>{{ blank[1] }}
        </p>
        <div v-if="item.kind === 'choice'" class="choices" role="radiogroup" aria-label="Варианты">
          <button
            v-for="(o, i) in item.options"
            :key="o"
            class="choice en"
            type="button"
            role="radio"
            translate="no"
            :aria-checked="choice === i"
            @click="choice = i"
          >
            <span class="key">{{ 'ABCD'[i] }}</span>{{ o }}
          </button>
        </div>

        <form v-else-if="item.kind === 'gap'" class="en" translate="no" @submit.prevent="submitAnswer">
          {{ blank[0] }}<input
            ref="gapInput"
            v-model="gap"
            class="gap-input"
            type="text"
            aria-label="Ответ"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            data-gramm="false"
          />{{ blank[1] }}
          <span v-if="item.hint" class="muted"> {{ item.hint }}</span>
        </form>

        <p v-else class="en" translate="no">
          <template v-for="(p, i) in pieces" :key="i">
            <button
              v-if="p.seg !== undefined"
              class="seg-btn"
              type="button"
              :aria-pressed="choice === p.seg"
              @click="choice = p.seg ?? null"
            >
              {{ p.text }}<sup>{{ 'ABCD'[p.seg] }}</sup></button
            ><span v-else>{{ p.text }}</span>
          </template>
        </p>

        <label class="row unsure">
          <input v-model="unsure" type="checkbox" />
          <span>Сомневаюсь — ответил наугад или не уверен</span>
        </label>
      </div>

      <div class="row spread">
        <button class="btn ghost" type="button" data-testid="dont-know" @click="record(null)">Не знаю</button>
        <button class="btn primary" type="button" :disabled="!canAnswer" data-testid="next-item" @click="submitAnswer">Дальше</button>
      </div>
    </template>

    <template v-else>
      <div class="card soft">
        <p><strong>Все задания пройдены</strong> за {{ elapsed }}. Результат будет в разборе.</p>
      </div>
      <div class="row">
        <button class="btn primary" type="button" data-testid="submit-part" @click="submitPart">Сдать часть</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.unsure { font-weight: 500; font-size: 0.95rem; }
.unsure input { width: 20px; height: 20px; }
</style>
