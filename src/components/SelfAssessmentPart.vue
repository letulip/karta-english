<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { CAN_DO, CAN_DO_ORDER } from '../content/selfAssessment.ru';
import type { CanDoAnswer } from '../content/types';
import { createSaver, readJson, writeJson } from '../lib/api';
import { selfLevels } from '../lib/scoring';
import { finishPart } from '../lib/session';
import ProgressBar from './ProgressBar.vue';

const PAGE = 10;
const OPTIONS: { value: CanDoAnswer; label: string }[] = [
  { value: 'yes', label: 'Да' },
  { value: 'hard', label: 'С трудом' },
  { value: 'no', label: 'Нет' },
];

const answers = reactive<Record<string, CanDoAnswer>>({});
const page = ref(0);
const loaded = ref(false);
const pages = Math.ceil(CAN_DO_ORDER.length / PAGE);
const items = computed(() => CAN_DO_ORDER.slice(page.value * PAGE, (page.value + 1) * PAGE));
const pageDone = computed(() => items.value.every((i) => answers[i.id]));
const answeredCount = computed(() => Object.keys(answers).length);

const saver = createSaver(
  () => 'self-assessment.json',
  () => ({ order: CAN_DO_ORDER.map((i) => i.id), answers, updatedAt: new Date().toISOString() }),
);

onMounted(async () => {
  const saved = await readJson<{ answers: Record<string, CanDoAnswer> }>('self-assessment.json');
  if (saved) Object.assign(answers, saved.answers);
  const firstOpen = Math.floor(CAN_DO_ORDER.findIndex((i) => !answers[i.id]) / PAGE);
  page.value = firstOpen >= 0 ? firstOpen : pages - 1;
  loaded.value = true;
});
onBeforeUnmount(() => {
  void saver.flush();
  saver.dispose();
});

function pick(id: string, value: CanDoAnswer) {
  answers[id] = value;
  saver.schedule();
}

function go(delta: number) {
  page.value += delta;
  window.scrollTo(0, 0);
}

async function submit() {
  await saver.flush();
  await writeJson('self-assessment.json', {
    order: CAN_DO_ORDER.map((i) => i.id),
    answers,
    result: selfLevels(CAN_DO, answers),
    finishedAt: new Date().toISOString(),
  });
  await finishPart('self');
}
</script>

<template>
  <section v-if="loaded" class="stack">
    <h1>Самооценка</h1>
    <div class="card soft">
      <p>
        Отвечай быстро, по первому ощущению, и про себя сегодняшнего. «С трудом» — если получается, но с усилием или не всегда. Если
        такой ситуации не было, представь её и ответь честно.
      </p>
    </div>
    <ProgressBar :value="answeredCount" :max="CAN_DO_ORDER.length" label="Отвечено утверждений" />
    <p class="muted">Страница {{ page + 1 }} из {{ pages }}</p>

    <div v-for="item in items" :key="item.id" class="card stack" :data-testid="`cando-${item.id}`">
      <p :id="`cando-${item.id}`">{{ item.text }}</p>
      <div class="segmented" role="radiogroup" :aria-labelledby="`cando-${item.id}`">
        <button
          v-for="o in OPTIONS"
          :key="o.value"
          type="button"
          role="radio"
          :aria-checked="answers[item.id] === o.value"
          @click="pick(item.id, o.value)"
        >
          {{ o.label }}
        </button>
      </div>
    </div>

    <div class="row spread">
      <button v-if="page > 0" class="btn" type="button" @click="go(-1)">← Назад</button>
      <span v-else />
      <button v-if="page < pages - 1" class="btn primary" type="button" :disabled="!pageDone" data-testid="next-page" @click="go(1)">
        Дальше
      </button>
      <button
        v-else
        class="btn primary"
        type="button"
        :disabled="answeredCount < CAN_DO_ORDER.length"
        data-testid="submit-part"
        @click="submit"
      >
        Сдать часть
      </button>
    </div>
  </section>
</template>
