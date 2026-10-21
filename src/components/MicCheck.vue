<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { Recording, getMic, levelMeter, micInfo, type MicInfo } from '../lib/recorder';
import { sec } from '../lib/timer';

const emit = defineEmits<{ ready: [info: MicInfo] }>();

const status = ref<'idle' | 'asking' | 'ok' | 'denied'>('idle');
const level = ref(0);
const label = ref('');
const testing = ref(false);
const playbackUrl = ref('');
let stream: MediaStream | null = null;
let stopMeter: (() => void) | null = null;

async function enable() {
  status.value = 'asking';
  try {
    stream = await getMic();
    label.value = micInfo(stream).label;
    stopMeter = levelMeter(stream, (v) => (level.value = v));
    status.value = 'ok';
  } catch {
    status.value = 'denied';
  }
}

async function testRecord() {
  if (!stream) return;
  testing.value = true;
  const r = new Recording(stream);
  r.start();
  await new Promise((resolve) => setTimeout(resolve, sec(3)));
  const blob = await r.stop();
  if (playbackUrl.value) URL.revokeObjectURL(playbackUrl.value);
  playbackUrl.value = URL.createObjectURL(blob);
  testing.value = false;
}

function proceed() {
  if (stream) emit('ready', micInfo(stream));
}

onBeforeUnmount(() => {
  stopMeter?.();
  if (playbackUrl.value) URL.revokeObjectURL(playbackUrl.value);
});
</script>

<template>
  <div class="card stack">
    <h2>Микрофон</h2>
    <p v-if="status !== 'ok'">
      Подключи микрофон, с которым ходишь на созвоны, и не меняй его до конца части: от него зависит качество расшифровки.
    </p>
    <div v-if="status === 'idle' || status === 'asking' || status === 'denied'" class="row">
      <button class="btn" type="button" :disabled="status === 'asking'" data-testid="mic-enable" @click="enable">Включить микрофон</button>
    </div>
    <p v-if="status === 'denied'" class="card danger">
      Браузер не дал доступ к микрофону. Разреши его в настройках сайта — значок слева от адреса — и нажми кнопку ещё раз.
    </p>
    <template v-if="status === 'ok'">
      <p>
        Микрофон: <strong>{{ label || 'по умолчанию' }}</strong>. Скажи что-нибудь — полоска должна двигаться.
      </p>
      <div class="meter" aria-hidden="true"><span :style="{ width: `${Math.round(level * 100)}%` }" /></div>
      <div class="row">
        <button class="btn" type="button" :disabled="testing" @click="testRecord">
          {{ testing ? 'Записываю 3 секунды…' : 'Записать 3 секунды и послушать' }}
        </button>
      </div>
      <audio v-if="playbackUrl" :src="playbackUrl" controls />
      <div class="row">
        <button class="btn primary" type="button" data-testid="mic-ready" @click="proceed">Звук нормальный, начать</button>
      </div>
    </template>
  </div>
</template>
