"""Расшифровка записей части 6 локальным Whisper (MLX на Apple Silicon) с таймкодами слов
и границами речи от детектора Silero VAD.

Запуск: python transcribe.py [папка-сессии] [--force]
Пишет transcripts/<id вопроса>.json рядом с записями. Уже расшифрованные записи пропускает,
если запись не новее расшифровки; --force расшифровывает всё заново.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import wave
from functools import lru_cache
from importlib.metadata import version
from pathlib import Path

from session import load_manifest, resolve_session, write_json

MODEL = "mlx-community/whisper-large-v3-turbo"
# Whisper по умолчанию «причёсывает» речь и выкидывает «эээ» и повторы. Затравка с междометиями
# подталкивает его писать дословнее; паузы меряет VAD, и от затравки они не зависят.
INITIAL_PROMPT = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking."
# На длинной тишине Whisper иногда «слышит» фразы, которых не было. Опция отбрасывает такие куски,
# но заодно может выбросить и настоящую фразу: сегмент с очень короткими словами у начала окна
# декодирования она принимает за галлюцинацию. Такие пропуски ловит второй проход (recover).
HALLUCINATION_SILENCE_SEC = 2.0
MIN_AUDIO_SEC = 0.3
SAMPLE_RATE = 16000

# Второй проход: речь по детектору, на которую не пришлось ни одного слова, расшифровываем отдельно.
COVER_TOLERANCE_SEC = 0.15  # слово «покрывает» речь чуть шире своих таймкодов
MIN_UNCOVERED_SEC = 0.4
RECOVERY_PAD_SEC = 0.3
# Если из короткого куска Whisper «услышал» одну из своих типовых галлюцинаций, кусок считается нераспознанным.
TYPICAL_HALLUCINATIONS = {"thank you", "thanks for watching", "thank you for watching", "you", "bye"}
SHORT_SPAN_SEC = 1.5


def to_wav(src: Path, dst: Path) -> None:
    # Браузер пишет webm/opus (Chrome) или mp4/aac (Safari); Whisper и VAD нужен 16 кГц моно.
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def load_audio(src: Path):
    """Запись как массив float32, 16 кГц моно — его едят и Whisper, и детектор речи."""
    import numpy as np

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        to_wav(src, wav)
        with wave.open(str(wav), "rb") as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def seconds_label(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


@lru_cache(maxsize=1)
def vad_model():
    from silero_vad import load_silero_vad

    # ONNX, а не TorchScript: torch.jit на Python 3.14 объявлен устаревшим и может сломаться.
    return load_silero_vad(onnx=True)


def speech_segments(audio) -> dict:
    """Где на записи речь, с точностью до 32 мс. Паузы между словами считаются по этим границам."""
    import torch
    from silero_vad import get_speech_timestamps

    stamps = get_speech_timestamps(
        torch.from_numpy(audio.copy()),
        vad_model(),
        sampling_rate=SAMPLE_RATE,
        # Короткие слова и «эээ» — тоже речь; тишина делит речь уже от 0,1 с, без «подушек» по краям,
        # чтобы длина паузы была настоящей. Порог паузы 0,25 с применяет metrics.py.
        min_speech_duration_ms=100,
        min_silence_duration_ms=100,
        speech_pad_ms=0,
        return_seconds=True,
        time_resolution=3,
    )
    return {"engine": f"silero-vad {version('silero-vad')} (onnx)", "segments": [[s["start"], s["end"]] for s in stamps]}


def echoes_prompt(text: str) -> bool:
    # На тишине модель может вернуть саму затравку — такую расшифровку нельзя принимать за речь.
    return "here's what i'm, like, thinking" in text.lower()


def whisper(audio, **options) -> dict:
    import mlx_whisper  # импорт тяжёлый, поэтому только когда есть что расшифровывать

    return mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=MODEL,
        language="en",
        word_timestamps=True,
        initial_prompt=INITIAL_PROMPT,
        condition_on_previous_text=False,
        **options,
    )


def collect(result: dict, offset: float = 0.0) -> tuple[list[dict], list[dict]]:
    """Слова и сегменты из ответа Whisper; offset сдвигает таймкоды кусочка на его место в записи."""
    words, segments = [], []
    for seg in result.get("segments", []):
        segments.append({"start": round(float(seg["start"]) + offset, 2), "end": round(float(seg["end"]) + offset, 2), "text": seg["text"].strip()})
        for w in seg.get("words", []):
            token = w["word"].strip()
            if token:
                words.append({"w": token, "start": round(float(w["start"]) + offset, 3), "end": round(float(w["end"]) + offset, 3), "p": round(float(w["probability"]), 3)})
    return words, segments


def plain(token: str) -> str:
    return token.lower().strip(" \"“”‘’'.,;:?!…-—–")


def strip_echo(found: list[dict], before: list[dict], after: list[dict]) -> list[dict]:
    """Убрать слова, которые второй проход услышал заново у краёв куска.

    Whisper обрезает конец слова раньше, чем оно звучит, — хвост слова выглядит непокрытой речью,
    и второй проход слышит то же слово ещё раз («Christmas, Christmas.»).
    """
    tail = [plain(w["w"]) for w in before[-3:]]
    head = [plain(w["w"]) for w in after[:3]]
    for k in range(min(3, len(found)), 0, -1):
        if [plain(w["w"]) for w in found[:k]] == tail[-k:]:
            found = found[k:]
            break
    for k in range(min(3, len(found)), 0, -1):
        if [plain(w["w"]) for w in found[-k:]] == head[:k]:
            found = found[:-k]
            break
    return found


def uncovered_spans(vad_segments: list[list[float]], words: list[dict]) -> list[tuple[float, float]]:
    """Куски речи по детектору, на которые не пришлось ни одного слова Whisper."""
    covered = sorted((w["start"] - COVER_TOLERANCE_SEC, w["end"] + COVER_TOLERANCE_SEC) for w in words)
    spans: list[tuple[float, float]] = []
    for start, end in vad_segments:
        cursor = start
        for c_start, c_end in covered:
            if c_end <= cursor or c_start >= end:
                continue
            if c_start - cursor >= MIN_UNCOVERED_SEC:
                spans.append((cursor, c_start))
            cursor = max(cursor, c_end)
            if cursor >= end:
                break
        if end - cursor >= MIN_UNCOVERED_SEC:
            spans.append((cursor, end))
    # Соседние куски, чьи поля перекрываются, расшифровываем одним кусочком.
    merged: list[tuple[float, float]] = []
    for span in spans:
        if merged and span[0] - merged[-1][1] < 2 * RECOVERY_PAD_SEC:
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(span)
    return merged


def recover(audio, words: list[dict], segments: list[dict], vad_segments: list[list[float]]) -> tuple[list[dict], list[dict], dict, list[str]]:
    """Второй проход: каждую непокрытую словами речь расшифровываем отдельно и вставляем на место.

    Порог галлюцинаций здесь выключен — он и выбросил эти слова. Слова второго прохода помечены rec: true.
    """
    words, segments = list(words), list(segments)
    log, flags = [], []
    total = len(audio) / SAMPLE_RATE
    for start, end in uncovered_spans(vad_segments, words):
        start, end = float(start), float(end)
        span = {"start": round(start, 2), "end": round(end, 2)}
        crop_start = max(0.0, start - RECOVERY_PAD_SEC)
        crop_end = min(total, end + RECOVERY_PAD_SEC)
        result = whisper(audio[int(crop_start * SAMPLE_RATE) : int(crop_end * SAMPLE_RATE)])
        heard = result.get("text", "").strip()
        found, _ = collect(result, offset=crop_start)
        # Поля по краям могли захватить соседние, уже расшифрованные слова: берём только те, что внутри куска.
        inside = [w for w in found if start - COVER_TOLERANCE_SEC <= (w["start"] + w["end"]) / 2 <= end + COVER_TOLERANCE_SEC]
        before = [w for w in words if w["end"] <= start + COVER_TOLERANCE_SEC]
        after = [w for w in words if w["start"] >= end - COVER_TOLERANCE_SEC]
        kept = strip_echo(inside, before, after)
        text = " ".join(w["w"] for w in kept)
        if inside and not kept:
            # Кусок — это хвост или начало соседнего слова, которое уже есть в расшифровке. Речь не потеряна.
            log.append({**span, "recovered": False, "duplicate": True, "heard": heard})
            continue
        if not kept or echoes_prompt(heard) or (end - start < SHORT_SPAN_SEC and plain(text) in TYPICAL_HALLUCINATIONS):
            flags.append(f"речь без расшифровки: {seconds_label(start)}–{seconds_label(end)} с")
            log.append({**span, "recovered": False, "heard": heard})
            continue
        for w in kept:
            w["rec"] = True
        words.extend(kept)
        segments.append({"start": kept[0]["start"], "end": kept[-1]["end"], "text": text, "rec": True})
        log.append({**span, "recovered": True, "text": text})
    words.sort(key=lambda w: w["start"])
    segments.sort(key=lambda s: s["start"])
    recovery = {
        "note": "Речь по детектору, на которую в первом проходе не пришлось слов, расшифрована отдельно; такие слова и сегменты помечены rec: true.",
        "spans": log,
    }
    return words, segments, recovery, flags


def finish(data: dict, words: list[dict], segments: list[dict], recovery: dict, flags: list[str]) -> dict:
    """Собрать расшифровку заново после второго прохода: текст идёт по порядку сегментов."""
    data["words"] = words
    data["segments"] = segments
    data["text"] = " ".join(s["text"] for s in segments if s["text"])
    data["recovery"] = recovery
    kept = [f for f in data.get("flags", []) if not f.startswith("речь без расшифровки") and f != "речь не распознана"]
    data["flags"] = kept + flags + ([] if words else ["речь не распознана"])
    return data


def transcribe_file(src: Path, prompt_id: str) -> dict:
    audio = load_audio(src)
    duration = len(audio) / SAMPLE_RATE
    data = {
        "promptId": prompt_id,
        "model": MODEL,
        "engine": f"mlx-whisper {version('mlx-whisper')}",
        "language": "en",
        "durationSec": round(duration, 2),
    }
    if duration < MIN_AUDIO_SEC:
        return {**data, "text": "", "words": [], "segments": [], "vad": {"engine": None, "segments": []},
                "recovery": {"spans": []}, "elapsedSec": 0.0, "flags": ["слишком короткая запись"]}

    started = time.perf_counter()
    result = whisper(audio, hallucination_silence_threshold=HALLUCINATION_SILENCE_SEC)
    words, segments = collect(result)
    vad = speech_segments(audio)
    flags = []
    if echoes_prompt(result.get("text", "")):
        flags.append("в расшифровке затравка Whisper — вероятно, на записи тишина")
    if words and not vad["segments"]:
        flags.append("детектор речи не нашёл речь, а Whisper нашёл слова — проверь запись")
    data.update({"vad": vad, "flags": flags})
    data = finish(data, *recover(audio, words, segments, vad["segments"]))
    data["elapsedSec"] = round(time.perf_counter() - started, 2)
    return data


def backfill(src: Path, out: Path) -> str | None:
    """Достроить старую расшифровку — границы речи и второй проход — без повторного основного прохода."""
    data = json.loads(out.read_text(encoding="utf-8"))
    if data.get("vad") is not None and data.get("recovery") is not None:
        return None
    audio = load_audio(src)
    done = []
    if data.get("vad") is None:
        data["vad"] = speech_segments(audio)
        done.append("границы речи")
    if data.get("recovery") is None:
        data = finish(data, *recover(audio, data["words"], data["segments"], data["vad"]["segments"]))
        done.append("второй проход")
    write_json(out, data)
    return ", ".join(done)


def coverage_note(data: dict) -> str:
    back = [s for s in data.get("recovery", {}).get("spans", []) if s["recovered"]]
    note = f", восстановлено кусков: {len(back)}" if back else ""
    return note + (f" ⚠ {'; '.join(data['flags'])}" if data.get("flags") else "")


def main() -> None:
    parser = argparse.ArgumentParser(description="Расшифровать записи части 6.")
    parser.add_argument("session", nargs="?", help="папка сессии, по умолчанию активная")
    parser.add_argument("--force", action="store_true", help="расшифровать заново даже готовые")
    args = parser.parse_args()

    session = resolve_session(args.session)
    items = load_manifest(session)
    if not items:
        print(f"В {session} нет записей речи — расшифровывать нечего.")
        return

    out_dir = session / "transcripts"
    done = skipped = missing = 0
    audio_total = elapsed_total = 0.0
    for prompt_id, item in items.items():
        if item.get("skipped") or not item.get("file"):
            skipped += 1
            continue
        src = session / item["file"]
        if not src.exists():
            print(f"  {prompt_id}: файла {src} нет — пропускаю", file=sys.stderr)
            missing += 1
            continue
        out = out_dir / f"{prompt_id}.json"
        if out.exists() and not args.force and out.stat().st_mtime >= src.stat().st_mtime:
            added = backfill(src, out)
            if added:
                data = json.loads(out.read_text(encoding="utf-8"))
                print(f"  {prompt_id}: достроил готовую расшифровку ({added}){coverage_note(data)}")
            continue
        data = transcribe_file(src, prompt_id)
        write_json(out, data)
        done += 1
        audio_total += data["durationSec"]
        elapsed_total += data["elapsedSec"]
        print(f"  {prompt_id}: {data['durationSec']:.1f} с аудио, {len(data['words'])} слов, {data['elapsedSec']:.1f} с{coverage_note(data)}")

    speed = f", скорость ×{audio_total / elapsed_total:.1f} к реальному времени" if elapsed_total > 0 else ""
    print(f"Расшифровано: {done}{speed}. Пропущено (не записано): {skipped}. Нет файла: {missing}.")


if __name__ == "__main__":
    main()
