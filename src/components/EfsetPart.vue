<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { LEVEL_OPTIONS } from '../content/biography.ru';
import { createSaver, logEvent, readJson } from '../lib/api';
import { finishPart } from '../lib/session';
import AutoTextarea from './AutoTextarea.vue';

interface EfsetData {
  overall: string;
  reading: string;
  listening: string;
  cefr: string;
  takenAt: string;
  certificate: string;
  hard: string;
  skipped: boolean;
}

const today = new Date().toLocaleDateString('sv-SE');
const data = reactive<EfsetData>({
  overall: '',
  reading: '',
  listening: '',
  cefr: '',
  takenAt: today,
  certificate: '',
  hard: '',
  skipped: false,
});
const loaded = ref(false);
const saver = createSaver(
  () => 'efset.json',
  () => ({ ...data, updatedAt: new Date().toISOString() }),
);

onMounted(async () => {
  const saved = await readJson<EfsetData>('efset.json');
  if (saved) Object.assign(data, saved);
  loaded.value = true;
  watch(data, saver.schedule, { deep: true });
});
onBeforeUnmount(() => {
  void saver.flush();
  saver.dispose();
});

const score = (s: string) => /^\d{1,3}$/.test(s.trim()) && Number(s) <= 100;
const complete = computed(() => data.skipped || (score(data.overall) && score(data.reading) && score(data.listening)));

async function submit() {
  if (data.skipped && !window.confirm('Сдать часть без EF SET? Чтение и слушание тогда останутся без замера.')) return;
  await saver.flush();
  await finishPart('efset');
}
</script>

<template>
  <section v-if="loaded" class="stack">
    <h1>Чтение и слушание</h1>
    <div class="card stack">
      <p>
        Эту часть меряет внешний бесплатный тест <strong>EF SET</strong>: 25 минут чтения и 25 минут слушания. Он откалиброван по
        шкале CEFR и подстраивает задания под тебя — здесь он точнее любых моих вопросов.
      </p>
      <ol>
        <li>Надень наушники и закрой лишние вкладки. Нужно 50 минут без перерыва.</li>
        <li>
          Открой <a href="https://www.efset.org/" target="_blank" rel="noopener noreferrer" @click="logEvent('efset-open')">efset.org</a>
          и выбери тест на 50 минут. Если сайт попросит зарегистрироваться, чтобы показать результат, — зарегистрируйся сам.
        </li>
        <li>Без словаря и переводчика. Если Chrome предложит перевести страницу — откажись.</li>
        <li>В конце сайт покажет общий балл от 0 до 100 и баллы по чтению и слушанию. Внеси их ниже.</li>
      </ol>
      <p class="muted">Пока ты на сайте EF SET, эта страница отметит уход — так и задумано.</p>
    </div>

    <div class="card stack">
      <h2>Результат</h2>
      <div class="grid">
        <div>
          <label for="ef-overall">Общий балл (0–100)</label>
          <input id="ef-overall" v-model="data.overall" type="text" inputmode="numeric" :disabled="data.skipped" />
        </div>
        <div>
          <label for="ef-reading">Чтение (0–100)</label>
          <input id="ef-reading" v-model="data.reading" type="text" inputmode="numeric" :disabled="data.skipped" />
        </div>
        <div>
          <label for="ef-listening">Слушание (0–100)</label>
          <input id="ef-listening" v-model="data.listening" type="text" inputmode="numeric" :disabled="data.skipped" />
        </div>
        <div>
          <label for="ef-cefr">Уровень, который показал сайт</label>
          <select id="ef-cefr" v-model="data.cefr" :disabled="data.skipped">
            <option value="">—</option>
            <option v-for="o in LEVEL_OPTIONS.slice(0, 6)" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
        <div>
          <label for="ef-date">Дата</label>
          <input id="ef-date" v-model="data.takenAt" type="date" :disabled="data.skipped" />
        </div>
      </div>
      <div>
        <label for="ef-cert">Ссылка на сертификат, если есть</label>
        <input id="ef-cert" v-model="data.certificate" type="url" placeholder="https://" :disabled="data.skipped" />
      </div>
      <div>
        <label for="ef-hard">Что было трудно? Где ты терял нить?</label>
        <AutoTextarea id="ef-hard" v-model="data.hard" label="Что было трудно" />
      </div>
      <label class="row check">
        <input v-model="data.skipped" type="checkbox" />
        <span>Не буду проходить EF SET сейчас</span>
      </label>
    </div>

    <div class="row spread">
      <span class="muted">{{ complete ? 'Можно сдавать.' : 'Нужны три балла: общий, чтение и слушание.' }}</span>
      <button class="btn primary" type="button" :disabled="!complete" data-testid="submit-part" @click="submit">Сдать часть</button>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.check { font-weight: 500; }
.check input { width: 20px; height: 20px; }
</style>
