#!/usr/bin/env bash
# Расшифровка записей части 6 и метрики беглости. Всё локально: модель Whisper один раз скачивается
# в кэш Hugging Face (~1,6 ГБ), дальше сеть не нужна.
#
#   bash pipeline/run.sh                    активная сессия (results/active.json)
#   bash pipeline/run.sh results/a-2026-…  конкретная сессия
#   bash pipeline/run.sh --force            расшифровать заново даже готовые записи
#   bash pipeline/run.sh --setup            только поставить зависимости и скачать модель
#
# mlx-whisper 0.4.3 ставится на системный Python 3.14 (колёса mlx 0.32 под 3.14 есть), поэтому
# отдельный интерпретатор не нужен. Другой Python можно задать через PYTHON=/путь/к/python3.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
PY="${PYTHON:-python3}"
MODEL="mlx-community/whisper-large-v3-turbo"

FORCE=()
SESSION=()
SETUP=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=(--force) ;;
    --setup) SETUP=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "Неизвестный флаг: $arg" >&2; exit 2 ;;
    *) SESSION=("$arg") ;;
  esac
done

command -v ffmpeg >/dev/null || { echo "Нужен ffmpeg: brew install ffmpeg" >&2; exit 1; }

if [ ! -x "$VENV/bin/python" ]; then
  echo "Создаю окружение Python в $VENV"
  "$PY" -m venv "$VENV"
fi
# Ставим зависимости, только когда requirements.txt изменился: отметка — его копия внутри окружения.
if ! cmp -s "$HERE/requirements.txt" "$VENV/.requirements.installed"; then
  echo "Ставлю зависимости (mlx-whisper, wordfreq, cmudict)…"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check -r "$HERE/requirements.txt"
  cp "$HERE/requirements.txt" "$VENV/.requirements.installed"
fi

if [ "$SETUP" = 1 ]; then
  echo "Скачиваю модель $MODEL (один раз, ~1,6 ГБ)…"
  "$VENV/bin/python" -c "from huggingface_hub import snapshot_download; print(snapshot_download('$MODEL'))"
  echo "Готово: дальше расшифровка работает без сети."
  exit 0
fi

# Модель уже в кэше — работаем без сети: иначе huggingface_hub при каждом запуске сверяется с сайтом.
export HF_HUB_DISABLE_PROGRESS_BARS=1
if "$VENV/bin/python" -c "import sys; from huggingface_hub import try_to_load_from_cache as cached; sys.exit(0 if isinstance(cached('$MODEL', 'weights.safetensors'), str) else 1)"; then
  export HF_HUB_OFFLINE=1
else
  echo "Модели $MODEL ещё нет в кэше — скачаю при первой расшифровке (~1,6 ГБ)."
fi

# По умолчанию результаты — в results/ корня проекта; относительный RESULTS_DIR (так его задают e2e
# и самопроверка) считается от папки, откуда запустили скрипт, как и путь к сессии.
RESULTS_DIR="${RESULTS_DIR:-$HERE/../results}"
case "$RESULTS_DIR" in /*) ;; *) RESULTS_DIR="$PWD/$RESULTS_DIR" ;; esac
export RESULTS_DIR

"$VENV/bin/python" "$HERE/transcribe.py" ${SESSION[@]+"${SESSION[@]}"} ${FORCE[@]+"${FORCE[@]}"}
"$VENV/bin/python" "$HERE/metrics.py" ${SESSION[@]+"${SESSION[@]}"}
