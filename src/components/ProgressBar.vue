<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ value: number; max: number; label?: string }>();
const pct = computed(() => (props.max ? Math.round((props.value / props.max) * 100) : 0));
</script>

<template>
  <div class="bar" role="progressbar" :aria-valuenow="value" :aria-valuemin="0" :aria-valuemax="max" :aria-label="label ?? 'Прогресс'">
    <span :style="{ width: `${pct}%` }" />
  </div>
</template>

<style scoped>
.bar { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: inherit; transition: width 0.3s; }
</style>
