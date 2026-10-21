<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { BIOGRAPHY, HOURS_FIELDS, IELTS_OPTIONS, LEVEL_FIELDS, LEVEL_OPTIONS } from '../content/biography.ru';
import type { BioQuestion } from '../content/types';
import { createSaver, readJson } from '../lib/api';
import { finishPart } from '../lib/session';
import AutoTextarea from './AutoTextarea.vue';

interface BioData {
  answers: Record<string, string>;
  hours: Record<string, string>;
  levels: Record<string, string>;
}

const data = reactive<BioData>({ answers: {}, hours: {}, levels: {} });
const loaded = ref(false);
const saver = createSaver(
  () => 'biography.json',
  () => ({ ...data, updatedAt: new Date().toISOString() }),
);

onMounted(async () => {
  const saved = await readJson<BioData>('biography.json');
  if (saved) Object.assign(data, saved);
  for (const q of BIOGRAPHY) if (q.kind === 'text') data.answers[q.id] ??= '';
  loaded.value = true;
  watch(data, saver.schedule, { deep: true });
});
onBeforeUnmount(() => {
  void saver.flush();
  saver.dispose();
});

function isAnswered(q: BioQuestion): boolean {
  if (q.kind === 'hours') return Object.values(data.hours).some((v) => v !== '');
  if (q.kind === 'levels') return Object.values(data.levels).some((v) => v !== '');
  return (data.answers[q.id] ?? '').trim() !== '';
}
const answered = computed(() => BIOGRAPHY.filter(isAnswered).length);

async function submit() {
  const left = BIOGRAPHY.length - answered.value;
  if (left > 0 && !window.confirm(`Без ответа ${left} из ${BIOGRAPHY.length}. Сдать часть? Вернуться к ней будет нельзя.`)) return;
  await saver.flush();
  await finishPart('biography');
}
</script>

<template>
  <section v-if="loaded" class="stack">
    <h1>Языковая биография</h1>
    <div class="card soft">
      <p>
        Это не проверка, а контекст для разбора: что у тебя уже работает, где английский живёт в твоей неделе и где болит. Пиши
        по-русски, коротко и честно. Пропускать можно, но каждый ответ делает разбор точнее.
      </p>
      <p class="muted">Ответы сохраняются сами. Вернуться к сданной части будет нельзя.</p>
    </div>

    <div v-for="(q, i) in BIOGRAPHY" :key="q.id" class="card stack" :data-testid="`bio-${q.id}`">
      <label :for="q.kind === 'text' ? `bio-${q.id}-input` : undefined">{{ i + 1 }}. {{ q.text }}</label>
      <small v-if="q.hint" class="muted">{{ q.hint }}</small>

      <AutoTextarea
        v-if="q.kind === 'text'"
        :id="`bio-${q.id}-input`"
        :model-value="data.answers[q.id] ?? ''"
        :label="q.text"
        @update:model-value="(v: string) => (data.answers[q.id] = v)"
      />

      <div v-else-if="q.kind === 'hours'" class="grid">
        <div v-for="f in HOURS_FIELDS" :key="f.key">
          <label :for="`hours-${f.key}`" class="small-label">{{ f.label }}, ч/нед</label>
          <input :id="`hours-${f.key}`" v-model="data.hours[f.key]" type="text" inputmode="decimal" placeholder="0" />
        </div>
      </div>

      <div v-else class="grid">
        <div v-for="f in LEVEL_FIELDS" :key="f.key">
          <label :for="`level-${f.key}`" class="small-label">{{ f.label }}</label>
          <select :id="`level-${f.key}`" v-model="data.levels[f.key]">
            <option value="" disabled>выбери</option>
            <option v-for="o in LEVEL_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
        <div>
          <label for="level-ielts" class="small-label">Балл IELTS, если бы экзамен был завтра</label>
          <select id="level-ielts" v-model="data.levels.ielts">
            <option value="" disabled>выбери</option>
            <option v-for="o in IELTS_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="row spread">
      <span class="muted">Отвечено {{ answered }} из {{ BIOGRAPHY.length }}</span>
      <button class="btn primary" type="button" data-testid="submit-part" @click="submit">Сдать часть</button>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.small-label { font-weight: 500; font-size: 0.92rem; }
</style>
