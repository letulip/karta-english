<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { logEvent } from '../lib/api';
import { archiveName, downloadBytes, mimeFor, packSession, unpackSession } from '../lib/archive';
import { activeSessionId, importSession, isPersisted, sessionEvents, sessionFiles } from '../lib/backend/browser';
import { loadSession, state } from '../lib/session';

defineProps<{ final?: boolean }>();

const busy = ref('');
const error = ref('');
const persisted = ref<boolean | null>(null);
const input = ref<HTMLInputElement>();

onMounted(async () => {
  persisted.value = await isPersisted();
});

async function download() {
  error.value = '';
  busy.value = 'Собираю архив…';
  try {
    const id = await activeSessionId();
    if (!id) return;
    const bytes = await packSession(id, await sessionFiles(id), await sessionEvents(id));
    downloadBytes(bytes, archiveName(id));
    logEvent('archive-download', { bytes: bytes.length });
  } catch (err) {
    error.value = `Не получилось собрать архив: ${String(err)}`;
  } finally {
    busy.value = '';
  }
}

async function restore() {
  const file = input.value?.files?.[0];
  if (!file) return;
  error.value = '';
  try {
    const data = unpackSession(new Uint8Array(await file.arrayBuffer()));
    if (state.session && !window.confirm(`Открыть сессию ${data.id} из архива? То, что сейчас в браузере для этой сессии, заменится архивом.`))
      return;
    busy.value = 'Восстанавливаю…';
    const files = data.files.map((f) => ({ rel: f.rel, data: typeof f.data === 'string' ? f.data : new Blob([f.data.slice()], { type: mimeFor(f.rel) }) }));
    await importSession(data.id, files, data.events);
    await loadSession();
    logEvent('archive-restore', { files: files.length });
  } catch (err) {
    error.value = `Не получилось восстановить: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    busy.value = '';
    if (input.value) input.value.value = '';
  }
}
</script>

<template>
  <div class="card stack" data-testid="backup-card">
    <h2>{{ final ? 'Результаты' : 'Резервная копия' }}</h2>
    <template v-if="state.session">
      <p v-if="final">
        Скачай архив и напиши Claude «тест пройден» с путём к файлу — обычно это <code>~/Downloads/{{ archiveName(state.session.id) }}</code>.
        Дальше расшифровка речи и разбор.
      </p>
      <p v-else>
        Ответы и записи хранятся только в этом браузере на этом устройстве. Проходи все заходы здесь же и после каждого скачивай
        архив: он спасёт прогресс, если браузер очистит данные, и перенесёт его на другое устройство.
      </p>
      <p v-if="persisted === false && !final" class="muted">Браузер может удалить данные сайта при нехватке места — тем важнее архив.</p>
    </template>
    <p v-else>Уже начинал тест на другом устройстве или в другом браузере? Восстанови прогресс из архива.</p>

    <div class="row">
      <button v-if="state.session" class="btn" :class="{ primary: final }" type="button" :disabled="!!busy" data-testid="download-archive" @click="download">
        Скачать архив
      </button>
      <label class="btn ghost restore">
        Восстановить из архива
        <input ref="input" type="file" accept=".zip,application/zip" class="visually-hidden" data-testid="restore-archive" @change="restore" />
      </label>
    </div>
    <p v-if="busy" class="muted" role="status">{{ busy }}</p>
    <p v-if="error" class="card danger" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.restore { margin: 0; font-weight: 600; }
</style>
