#!/usr/bin/env bash
# Самопроверка конвейера: синтезирует ответы голосами macOS с тишиной в известных местах,
# кодирует их в webm/opus, как браузер, прогоняет расшифровку и метрики и сверяет результат.
# Плюс готовая запись fixtures/dropped-sentence.webm (тоже синтез): на ней первый проход Whisper
# теряет фразу «She asked to call back before Thursday.», и её должен вернуть второй проход.
# Настоящие результаты не трогает: всё лежит в pipeline/.selftest/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ST="$HERE/.selftest"
SESSION_ID="st-selftest"
SESSION="$ST/results/$SESSION_ID"

rm -rf "$ST"
mkdir -p "$SESSION/speaking"
printf '{"id": "%s"}\n' "$SESSION_ID" > "$ST/results/active.json"

synth() {
  local id="$1" voice="$2" text="$3"
  say -v "$voice" -o "$ST/$id.aiff" "$text"
  ffmpeg -nostdin -loglevel error -y -i "$ST/$id.aiff" -c:a libopus -b:a 48k "$SESSION/speaking/$id.webm"
}

# Та же речь, но с розовым шумом под ней — как вентилятор или кондиционер в комнате.
synth_noisy() {
  local id="$1" voice="$2" text="$3"
  say -v "$voice" -o "$ST/$id.aiff" "$text"
  ffmpeg -nostdin -loglevel error -y -i "$ST/$id.aiff" -f lavfi -i "anoisesrc=color=pink:amplitude=0.03:seed=7" \
    -filter_complex "[0:a]aresample=48000[v];[1:a]aresample=48000[n];[v][n]amix=inputs=2:duration=first:normalize=0" \
    -c:a libopus -b:a 48k "$SESSION/speaking/$id.webm"
}

echo "Синтезирую ответы…"
synth st-r1 Samantha "I live in a small house near the beach. [[slnc 700]] In the morning I usually walk the dog, and then I start work at nine."
synth st-r2 Daniel "Our assistant refuses when the documents do not contain the answer, because [[slnc 1500]] a wrong answer is much worse than no answer at all."
synth st-r3 Karen "So the client said that the the pilot is going well, [[slnc 700]] but they want everything moved to their own servers before Christmas."
synth_noisy st-r4 Daniel "We tested the assistant on [[slnc 1200]] about four hundred documents last month."
cp "$HERE/fixtures/dropped-sentence.webm" "$SESSION/speaking/st-r5.webm"

cat > "$SESSION/speaking/manifest.json" <<'JSON'
{
  "items": {
    "st-r1": {"id": "st-r1", "type": "part1", "voice": "Samantha", "prompt": "Describe where you live.", "file": "speaking/st-r1.webm", "mimeType": "audio/webm;codecs=opus", "durationMs": 0, "prepMs": 0, "textShown": false, "replays": 0, "skipped": false},
    "st-r2": {"id": "st-r2", "type": "work", "voice": "Daniel", "prompt": "Why does the assistant refuse?", "file": "speaking/st-r2.webm", "mimeType": "audio/webm;codecs=opus", "durationMs": 0, "prepMs": 0, "textShown": false, "replays": 0, "skipped": false},
    "st-r3": {"id": "st-r3", "type": "retell", "voice": "Karen", "prompt": "Retell the message.", "file": "speaking/st-r3.webm", "mimeType": "audio/webm;codecs=opus", "durationMs": 0, "prepMs": 0, "textShown": false, "replays": 0, "skipped": false},
    "st-r4": {"id": "st-r4", "type": "work", "voice": "Daniel", "prompt": "How did you test it? (noisy room)", "file": "speaking/st-r4.webm", "mimeType": "audio/webm;codecs=opus", "durationMs": 0, "prepMs": 0, "textShown": false, "replays": 0, "skipped": false},
    "st-r5": {"id": "st-r5", "type": "retell", "voice": "Karen", "prompt": "Retell the message (Whisper drops a sentence).", "file": "speaking/st-r5.webm", "mimeType": "audio/webm;codecs=opus", "durationMs": 0, "prepMs": 0, "textShown": false, "replays": 0, "skipped": false},
    "st-skip": {"id": "st-skip", "type": "part3", "voice": "Daniel", "prompt": "Skipped on purpose.", "skipped": true}
  }
}
JSON

echo "Расшифровка и метрики…"
RESULTS_DIR="$ST/results" bash "$HERE/run.sh"

echo "Повторный запуск без --force должен ничего не расшифровывать:"
RESULTS_DIR="$ST/results" bash "$HERE/run.sh" | sed 's/^/  /'

echo
# Проверкам второго прохода нужна модель; к этому моменту она уже в кэше.
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_PROGRESS_BARS=1 "$HERE/.venv/bin/python" "$HERE/selftest_check.py" "$SESSION"
