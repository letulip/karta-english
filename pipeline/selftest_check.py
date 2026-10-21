"""Проверки для selftest.sh: метрики на заданных вручную словах, результат прогона на синтезированной речи
и второй проход расшифровки — возврат пропущенной Whisper'ом речи."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from metrics import analyse, norm, summarise

FIELDS = [
    "windowSec", "latencySec", "words", "fillers", "syllables", "speechRateWpm", "articulationRateSps",
    "meanLengthOfRun", "pauses", "filledPausesPerMin", "repetitions", "mattr", "rareShare", "rareWords", "lowConfidence",
]
PAUSE_FIELDS = ["count", "perMin", "meanSec", "totalSec", "longCount", "longestSec", "boundary", "midClause"]
PROMPT_FIELDS = ["pauseSource", "pauseList", "recoveredSpans", "mattrWindow", "flags"]

# Что синтезировано в selftest.sh: сколько слов, после какого слова тишина известной длины
# и где эта пауза по смыслу — на границе фразы или внутри.
EXPECTED = {
    "st-r1": {"words": 24, "after": "beach", "sec": 0.7, "boundary": True},
    "st-r2": {"words": 23, "after": "because", "sec": 1.5, "boundary": False},
    "st-r3": {"words": 22, "after": "well", "sec": 0.7, "boundary": True},
    "st-r4": {"words": 11, "after": "on", "sec": 1.2, "boundary": False},  # с шумом в комнате
}

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        failures.append(message)


def w(t: str, s: float, e: float, p: float = 0.9) -> dict:
    return {"w": t, "start": s, "end": e, "p": p}


def unit_checks() -> None:
    print("Метрики на заданных словах (запасной путь — паузы по таймкодам Whisper):")
    words = [
        w("Well,", 0.50, 0.80),      # латентность 0,5 с
        w("I", 1.30, 1.40),          # пауза 0,5 с на границе (после запятой)
        w("think", 1.45, 1.70),
        w("the", 1.75, 1.85),
        w("the", 1.90, 2.00),        # повтор слова
        w("um", 2.10, 2.40),         # заполненная пауза
        w("deployment", 3.60, 4.20, 0.3),  # пауза 1,2 с внутри фразы; редкое слово; низкая уверенность
        w("works.", 4.25, 4.60),
    ]
    m = summarise([analyse(words)])
    check(m["words"] == 7, f"слов без заполненных пауз: 7 (получено {m['words']})")
    check(m["fillers"] == 1, f"заполненных пауз: 1 (получено {m['fillers']})")
    check(m["latencySec"] == 0.5, f"латентность 0,5 с (получено {m['latencySec']})")
    check(m["pauses"]["count"] == 2, f"пауз от 0,25 с: 2 (получено {m['pauses']['count']})")
    check(m["pauses"]["boundary"]["count"] == 1 and m["pauses"]["midClause"]["count"] == 1, "одна пауза на границе, одна внутри фразы")
    check(m["pauses"]["longCount"] == 1 and m["pauses"]["longestSec"] == 1.2, f"длинная пауза 1,2 с (получено {m['pauses']['longestSec']})")
    check(m["meanLengthOfRun"] == 2.3, f"фраза между паузами: (1 + 4 + 2) / 3 = 2,3 слова (получено {m['meanLengthOfRun']})")
    check(m["repetitions"]["count"] == 1 and m["repetitions"]["examples"][0]["text"] == "the the", "повтор «the the» найден")
    check("deployment" in m["rareWords"], f"«deployment» — редкое слово (получено {m['rareWords']})")
    check(len(m["lowConfidence"]) == 1, "одно слово с низкой уверенностью")
    expected_rate = round(7 / (4.60 - 0.50) * 60, 1)
    check(m["speechRateWpm"] == expected_rate, f"темп {expected_rate} сл/мин (получено {m['speechRateWpm']})")

    print("Паузы по детектору речи, слово растянуто Whisper'ом на тишину:")
    words = [
        w("Our", 0.03, 0.30), w("answer,", 3.34, 3.84),
        w("because...", 4.06, 5.36, 0.55),  # на деле слово кончилось в 4,77, дальше тишина до 6,21
        w("A", 6.02, 6.28), w("wrong", 6.28, 6.48), w("answer.", 6.48, 8.90),
    ]
    vad = [[0.03, 3.97], [4.13, 4.77], [6.21, 9.0]]
    raw = analyse(words, vad)
    m = summarise([raw])
    check(raw["pauseSource"] == "vad", "источник пауз — детектор речи")
    check(m["pauses"]["count"] == 1 and m["pauses"]["longestSec"] == 1.44, f"одна пауза 1,44 с; короткий зазор 0,16 с паузой не считается (получено {m['pauses']['count']}, {m['pauses']['longestSec']})")
    check(raw["pauseList"] and norm(raw["pauseList"][0]["after"]) == "because" and raw["pauseList"][0]["at"] == 4.77, "пауза привязана к стыку после «because» и начинается в 4,77")
    check(m["pauses"]["midClause"]["count"] == 1, "пауза после многоточия — внутри фразы")
    check(m["latencySec"] == 0.03 and m["windowSec"] == 9.0, f"окно речи 0,03–9,0 с по детектору (получено {m['latencySec']}, {m['windowSec']})")

    print("Паузы по детектору речи, на тишину растянуто следующее слово:")
    words = [w("tested", 0.14, 0.52), w("on", 1.18, 1.60), w("about", 1.60, 3.22), w("400", 3.22, 3.70), w("documents.", 3.70, 4.22)]
    raw = analyse(words, [[0.03, 1.79], [2.91, 4.3]])
    check([norm(p["after"]) for p in raw["pauseList"]] == ["on"], f"пауза после «on», а не после «about» (получено {[p['after'] for p in raw['pauseList']]})")
    words = [w("going", 1.92, 2.18), w("well.", 2.18, 2.56), w("But", 2.86, 3.44), w("they", 3.44, 3.60), w("want", 3.60, 3.84)]
    raw = analyse(words, [[0.1, 2.72], [3.36, 3.9]])
    check([norm(p["after"]) for p in raw["pauseList"]] == ["well"] and raw["pauseList"][0]["boundary"], "пауза после «well.» — на границе")


def run_checks(session: Path) -> None:
    print(f"Прогон на синтезированной речи ({session}):")
    transcripts = session / "transcripts"
    metrics_path = session / "metrics.json"
    data = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else None
    check(data is not None, "metrics.json есть")

    for pid, exp in EXPECTED.items():
        path = transcripts / f"{pid}.json"
        check(path.exists(), f"{pid}: расшифровка есть")
        if not path.exists():
            continue
        t = json.loads(path.read_text(encoding="utf-8"))
        n = len(t["words"])
        check(abs(n - exp["words"]) <= max(3, round(exp["words"] * 0.15)), f"{pid}: слов {n}, ожидалось ≈{exp['words']}")
        check(bool((t.get("vad") or {}).get("segments")), f"{pid}: детектор нашёл речь")
        print(f"       текст: {t['text']}")
        if not data:
            continue
        prompt = data["perPrompt"].get(pid, {})
        found = [p for p in prompt.get("pauseList", []) if norm(p["after"]) == exp["after"]]
        sec = found[0]["sec"] if found else None
        check(sec is not None and exp["sec"] * 0.8 <= sec <= exp["sec"] + 0.5, f"{pid}: тишина {exp['sec']} с после «{exp['after']}» найдена ({sec} с)")
        if found:
            where = "на границе" if exp["boundary"] else "внутри фразы"
            check(found[0]["boundary"] == exp["boundary"], f"{pid}: пауза после «{exp['after']}» — {where}")
    check(not (transcripts / "st-skip.json").exists(), "st-skip: пропущенный вопрос не расшифрован")

    if not data:
        return
    for block in ["overall", "byType", "perPrompt", "definitions", "pauseThresholdSec", "engine"]:
        check(block in data and data[block] is not None, f"metrics.json: блок {block}")
    blocks = [("overall", data["overall"])]
    blocks += [(f"byType.{k}", v) for k, v in data["byType"].items()]
    blocks += [(f"perPrompt.{k}", v) for k, v in data["perPrompt"].items()]
    for name, block in blocks:
        missing = [f for f in FIELDS if f not in block] + [f"pauses.{f}" for f in PAUSE_FIELDS if f not in block["pauses"]]
        if name.startswith("perPrompt."):
            missing += [f for f in PROMPT_FIELDS if f not in block]
        check(not missing, f"{name}: все поля на месте" + (f" (нет: {missing})" if missing else ""))
    check(set(data["byType"]) == {"part1", "work", "retell"}, f"byType по типам записей: {sorted(data['byType'])}")
    check(all(p["pauseSource"] == "vad" for p in data["perPrompt"].values()), "все паузы измерены детектором речи")
    kept = data["perPrompt"].get("st-r3", {}).get("repetitions", {}).get("count", 0)
    print(f"  info повтор «the the» в st-r3 {'сохранён' if kept else 'Whisper убрал'} (повторов: {kept})")
    print(f"  info заполненных пауз в синтезированной речи (их там нет): {data['overall']['fillers']}")
    o = data["overall"]
    print(f"  info в целом: {o['words']} слов, {o['speechRateWpm']} сл/мин, {o['articulationRateSps']} слог/с, фраза {o['meanLengthOfRun']} сл., пауз {o['pauses']['count']}")


def recovery_checks(session: Path) -> None:
    from transcribe import SAMPLE_RATE, load_audio, recover

    print("Второй проход — запись, на которой первый проход теряет фразу (st-r5):")
    path = session / "transcripts" / "st-r5.json"
    check(path.exists(), "st-r5: расшифровка есть")
    if path.exists():
        t = json.loads(path.read_text(encoding="utf-8"))
        rec = [w["w"] for w in t["words"] if w.get("rec")]
        check("Thursday" in t["text"], "st-r5: фраза «She asked to call back before Thursday.» в расшифровке")
        check("Christmas, Christmas" not in t["text"], "st-r5: хвост слова «Christmas» не задвоен")
        check(not any(f.startswith("речь без расшифровки") for f in t["flags"]), f"st-r5: потерянной речи нет (флаги: {t['flags']})")
        check(t["text"].index("too fast.") < t["text"].index("Thursday") < t["text"].index("I would ask"), "st-r5: восстановленная фраза стоит на своём месте")
        print(f"  info st-r5: второй проход вернул слова {rec}" if rec else "  info st-r5: первый проход эту фразу не потерял — второй не понадобился")

    print("Второй проход — пропуск, сделанный вручную (st-r1 без второй фразы):")
    src = session / "speaking" / "st-r1.webm"
    t = json.loads((session / "transcripts" / "st-r1.json").read_text(encoding="utf-8"))
    cut = next(i for i, w in enumerate(t["words"]) if norm(w["w"]) == "beach") + 1
    first = t["words"][:cut]
    segments = [{"start": first[0]["start"], "end": first[-1]["end"], "text": " ".join(w["w"] for w in first)}]
    audio = load_audio(src)
    words, segments, recovery, flags = recover(audio, first, segments, t["vad"]["segments"])
    text = " ".join(s["text"] for s in segments)
    back = [w["w"] for w in words if w.get("rec")]
    check("morning" in [norm(w) for w in back], f"st-r1: вторая фраза вернулась вторым проходом ({' '.join(back)})")
    check(text.startswith("I live in a small house near the beach.") and "In the morning" in text, f"st-r1: текст читается по порядку: {text}")
    check(not flags, f"st-r1: флагов нет (получено {flags})")

    print("Второй проход — «речь» по детектору там, где тишина:")
    import numpy as np

    silent = np.concatenate([audio, np.zeros(int(2.0 * SAMPLE_RATE), dtype=np.float32)])
    tail = len(audio) / SAMPLE_RATE
    fake_vad = t["vad"]["segments"] + [[round(tail + 0.4, 3), round(tail + 1.4, 3)]]
    _, _, recovery, flags = recover(silent, t["words"], t["segments"], fake_vad)
    check(any(f.startswith("речь без расшифровки:") for f in flags), f"нерасшифрованный кусок отмечен флагом ({flags})")
    check(recovery["spans"] and recovery["spans"][-1]["recovered"] is False, "кусок записан в recovery как невосстановленный")


if __name__ == "__main__":
    unit_checks()
    if len(sys.argv) > 1:
        run_checks(Path(sys.argv[1]))
        recovery_checks(Path(sys.argv[1]))
    print("ИТОГ: " + ("всё сходится" if not failures else f"{len(failures)} проверок не прошли"))
    sys.exit(1 if failures else 0)
