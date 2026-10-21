<script setup lang="ts">
import { computed } from 'vue';
import { saveStatus } from '../lib/api';

const text = computed(() => {
  if (saveStatus.error) return 'Не сохранилось — проверь, что сервер запущен';
  if (saveStatus.pending) return 'Сохраняю…';
  if (saveStatus.savedAt)
    return `✓ ${new Date(saveStatus.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  return '';
});
</script>

<template>
  <span class="save" :class="{ bad: !!saveStatus.error }" role="status" aria-live="polite" data-testid="save-status">{{ text }}</span>
</template>

<style scoped>
.save { font-size: 0.85rem; color: var(--muted); white-space: nowrap; margin-left: auto; }
.save.bad { color: var(--danger); font-weight: 600; white-space: normal; text-align: right; }
</style>
