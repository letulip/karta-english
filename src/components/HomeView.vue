<script setup lang="ts">
import { computed, ref } from 'vue';
import { PARTS, SITTINGS } from '../content/parts';
import { beginTest, openPart, partStatus, state } from '../lib/session';

const starting = ref(false);
const sittings = [1, 2, 3] as const;
const doneCount = computed(() => PARTS.filter((p) => partStatus(p.id) === 'done').length);

async function start() {
  starting.value = true;
  try {
    await beginTest('a');
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <section v-if="!state.session" class="stack">
    <h1>Карта английского</h1>
    <p>
      Тест покажет твой английский по каждому навыку отдельно: где ты сейчас, какие ошибки повторяются и насколько беглая у тебя
      речь. Шесть частей, около 3,5 часа, в три захода.
    </p>
    <div class="card stack">
      <h2>Правила</h2>
      <ul>
        <li><strong>Без ИИ, переводчика, словаря и проверки орфографии.</strong> Не знаешь слово — обойди его, как в живом разговоре.</li>
        <li><strong>Тихое место и наушники.</strong> Для речи — тот микрофон, с которым ходишь на собеседования.</li>
        <li><strong>Части идут по порядку.</strong> Внутри части без перерывов, между частями — сколько угодно.</li>
        <li><strong>Таймер письма не останавливается</strong>, даже если закрыть страницу.</li>
        <li>
          <strong>Страница отмечает уходы и попытки вставить текст.</strong> Это не штраф, а контекст для разбора.
        </li>
      </ul>
    </div>
    <div class="row">
      <button class="btn primary" type="button" :disabled="starting" @click="start">Начать тест</button>
    </div>
    <p class="muted">Ответы и записи сохраняются только на этом компьютере, в папке <code>results/</code>.</p>
  </section>

  <section v-else class="stack">
    <div class="row spread">
      <h1>Карта английского</h1>
      <span class="tag accent">сдано {{ doneCount }} из {{ PARTS.length }}</span>
    </div>

    <template v-for="s in sittings" :key="s">
      <h2>{{ SITTINGS[s] }}</h2>
      <ul class="parts">
        <li v-for="p in PARTS.filter((x) => x.sitting === s)" :key="p.id" class="card" :data-testid="`part-${p.id}`">
          <div class="part-row" :class="partStatus(p.id)">
            <span class="n" aria-hidden="true">{{ partStatus(p.id) === 'done' ? '✓' : p.n }}</span>
            <div class="grow">
              <strong>{{ p.title }}</strong>
              <span class="muted"> · ~{{ p.minutes }} мин</span>
              <br />
              <small>{{ partStatus(p.id) === 'done' ? 'Сдана.' : p.blurb }}</small>
            </div>
            <button
              v-if="partStatus(p.id) === 'todo' || partStatus(p.id) === 'active'"
              class="btn primary small"
              type="button"
              @click="openPart(p.id)"
            >
              {{ partStatus(p.id) === 'active' ? 'Продолжить' : 'Начать' }}
            </button>
          </div>
        </li>
      </ul>
    </template>

    <div v-if="doneCount === PARTS.length" class="card soft" data-testid="all-done">
      <strong>Все части сданы.</strong> Дальше — расшифровка речи и разбор: напиши Claude, что тест пройден.
    </div>

    <details class="card soft">
      <summary>Правила</summary>
      <ul>
        <li>Без ИИ, переводчика, словаря и проверки орфографии.</li>
        <li>Тихое место, наушники; для речи — привычный для созвонов микрофон.</li>
        <li>Внутри части без перерывов. Таймер письма идёт, даже если закрыть страницу.</li>
        <li>Уходы со страницы и попытки вставить текст попадают в журнал как контекст.</li>
      </ul>
    </details>
    <p class="muted">Сессия {{ state.session.id }} · результаты в <code>results/{{ state.session.id }}/</code></p>
  </section>
</template>
