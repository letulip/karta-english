import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

// Ускорение времени только для автотестов: e2e запускает сервер с VITE_SPEED=120, и 40 минут эссе проходят за 20 секунд.
export const SPEED = Math.max(1, Number(import.meta.env.VITE_SPEED ?? 1) || 1);
export const sec = (n: number) => (n * 1000) / SPEED;

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil((ms * SPEED) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Общие часы компонента: обновляются четыре раза в секунду и останавливаются вместе с ним.
export function useNow(): Ref<number> {
  const now = ref(Date.now());
  const id = setInterval(() => (now.value = Date.now()), 250);
  onBeforeUnmount(() => clearInterval(id));
  return now;
}

// Обратный отсчёт до дедлайна. Дедлайн хранится в результатах, поэтому перезагрузка страницы время не останавливает.
export function useDeadline(deadline: () => number | null, onExpire: () => void) {
  const now = useNow();
  const remaining = computed(() => {
    const d = deadline();
    return d === null ? null : Math.max(0, d - now.value);
  });
  let fired = false;
  watch(deadline, () => (fired = false));
  watch(remaining, (ms) => {
    if (ms === 0 && !fired) {
      fired = true;
      onExpire();
    }
  });
  return { remaining, label: computed(() => (remaining.value === null ? '' : formatMs(remaining.value))) };
}
