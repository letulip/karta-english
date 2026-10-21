"""Метрики беглости и словаря по расшифровкам части 6.

Запуск: python metrics.py [папка-сессии]
Читает transcripts/*.json и speaking/manifest.json, пишет metrics.json: по каждой записи,
по типам вопросов и в целом. Определения метрик — в блоке definitions самого файла.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from statistics import mean

from session import load_manifest, resolve_session, write_json

PAUSE_SEC = 0.25  # обычный порог в исследованиях беглости на втором языке (де Йонг и Боскер, 2013)
LONG_PAUSE_SEC = 1.0
JUNCTION_TOLERANCE_SEC = 0.05
LOW_CONFIDENCE = 0.5
MATTR_WINDOW = 50
TOP_N = 2000
FILLERS = {"uh", "um", "umm", "uhm", "uhh", "er", "erm", "ah", "eh", "hmm", "hm", "mm", "mhm"}
BOUNDARY_MARKS = tuple(".,;:?!")
HESITATION_MARKS = ("...", "…")
SENTENCE_END = tuple(".?!")
TYPES = ("part1", "part2", "part3", "work", "retell")
WORD_RE = re.compile(r"[a-z]+(?:['-][a-z]+)*")

DEFINITIONS = {
    "pauseThresholdSec": "Паузой считается тишина между словами от 0,25 с. Границы тишины меряет детектор речи Silero VAD (точность 32 мс): таймкоды слов Whisper растягивают слова на соседнюю тишину и занижают паузы.",
    "windowSec": "Окно речи: от начала речи до её конца по детектору речи. Тишина до первого слова не входит.",
    "latencySec": "Сколько секунд прошло от начала записи до начала речи.",
    "words": "Слова без заполненных пауз («uh», «um», «er»…).",
    "speechRateWpm": "Темп речи: слова в минуту в окне речи.",
    "articulationRateSps": "Темп артикуляции: слоги в секунду без пауз от 0,25 с. Слоги — по словарю произношений CMU, неизвестные слова оцениваются по гласным, числа — как 2 слога.",
    "meanLengthOfRun": "Средняя длина фразы между паузами от 0,25 с, в словах. Заполненные паузы фразу не рвут, но в длину не входят.",
    "pauses": "Тишина от 0,25 с: сколько в минуту, средняя и самая длинная. «На границе» — после слова со знаком препинания, «внутри фразы» — все остальные, включая многоточие (так Whisper отмечает запинку). Паузы внутри фразы сильнее мешают беглости. Знаки препинания ставит Whisper, поэтому деление приблизительное.",
    "pauseList": "Каждая пауза записи: после какого слова, перед каким, когда началась и сколько длилась.",
    "recoveredSpans": "Куски речи, которые Whisper пропустил в первом проходе и которые удалось расшифровать отдельно (их слова помечены rec: true в расшифровке). Кусок, который не расшифровался и со второго раза, отмечен во flags как «речь без расшифровки» с его временем.",
    "filledPausesPerMin": "Заполненные паузы в минуту. Whisper часто их выкидывает, поэтому это нижняя оценка.",
    "repetitions": "Повторы подряд: то же слово («the the») или та же пара слов («I think I think»). Whisper тоже склонен их убирать — нижняя оценка.",
    "mattr": "Разнообразие слов (MATTR): доля разных слов в скользящем окне из 50 слов, от 0 до 1. Если слов меньше 50 — доля разных слов во всей записи.",
    "rareShare": "Доля словоформ вне 2000 самых частых в английском (частотный словарь wordfreq). Имена собственные не считаются; рабочие термины («deployment») тоже попадают в редкие.",
    "lowConfidence": "Слова, в которых Whisper не уверен (вероятность ниже 0,5): их стоит переслушать — это могут быть оговорки, неразборчивое произношение или ошибка распознавания.",
}


@lru_cache(maxsize=1)
def top_words() -> frozenset[str]:
    from wordfreq import top_n_list

    return frozenset(w.replace("’", "'") for w in top_n_list("en", TOP_N))


@lru_cache(maxsize=1)
def pronunciations() -> dict:
    import cmudict

    return cmudict.dict()


def norm(token: str) -> str:
    return token.replace("’", "'").lower().strip(" \"“”‘'.,;:?!()[]{}…-—–")


def is_filler(token: str) -> bool:
    return norm(token) in FILLERS


def syllables(token: str) -> int:
    word = norm(token)
    if any(ch.isdigit() for ch in word):
        return 2
    entry = pronunciations().get(word)
    if entry:
        return max(1, sum(1 for ph in entry[0] if ph[-1].isdigit()))
    groups = re.findall(r"[aeiouy]+", word)
    count = len(groups)
    if word.endswith("e") and not word.endswith(("le", "ee")) and count > 1:
        count -= 1
    return max(1, count)


def is_rare(token: str) -> bool:
    top = top_words()
    return token not in top and token.split("'")[0] not in top


def r(x: float | None, nd: int = 2) -> float | None:
    return None if x is None else round(x, nd)


def per_min(count: int, seconds: float) -> float | None:
    return count / seconds * 60 if seconds > 0 else None


def ends_clause(token: str) -> bool:
    t = token.rstrip()
    # Многоточие Whisper ставит на запинке («because...»), а не в конце мысли — такая пауза внутри фразы.
    return t.endswith(BOUNDARY_MARKS) and not t.endswith(HESITATION_MARKS)


def junction_for(start: float, end: float, words: list[dict]) -> int:
    """После какого слова стоит тишина [start, end].

    Whisper растягивает на тишину то предыдущее слово, то следующее («about» на 1,6 с), поэтому
    середина тишины не годится. Стык j подходит, если слово j началось до тишины, а слово j + 1
    кончилось после неё; из подходящих берём стык, чья середина ближе всего к тишине.
    """
    def distance(j: int) -> tuple[float, float]:
        joint = (words[j]["end"] + words[j + 1]["start"]) / 2
        return max(start - joint, joint - end, 0.0), abs(joint - (start + end) / 2)

    junctions = range(len(words) - 1)
    fitting = [j for j in junctions if words[j]["start"] < start + JUNCTION_TOLERANCE_SEC and words[j + 1]["end"] > end - JUNCTION_TOLERANCE_SEC]
    return min(fitting or junctions, key=distance)


def vad_pauses(words: list[dict], segments: list[list[float]]) -> tuple[tuple[float, float], dict[int, dict]] | None:
    """Окно речи и паузы по детектору речи. None, если рядом со словами детектор речь не нашёл."""
    lo, hi = words[0]["start"] - 0.5, words[-1]["end"] + 0.5
    inside = [s for s in segments if s[1] > lo and s[0] < hi]
    if not inside:
        return None
    pause_after: dict[int, dict] = {}
    if len(words) > 1:
        for a, b in zip(inside, inside[1:]):
            gap = b[0] - a[1]
            if gap < PAUSE_SEC:
                continue
            # Две паузы на одном стыке (между ними, например, вдох) складываются в одну.
            p = pause_after.setdefault(junction_for(a[1], b[0], words), {"start": a[1], "sec": 0.0})
            p["sec"] += gap
    return (inside[0][0], inside[-1][1]), pause_after


def whisper_pauses(words: list[dict]) -> tuple[tuple[float, float], dict[int, dict]]:
    """Запасной путь без детектора речи: паузы по таймкодам Whisper, их длина занижена."""
    pause_after = {}
    for i in range(1, len(words)):
        gap = words[i]["start"] - words[i - 1]["end"]
        if gap >= PAUSE_SEC:
            pause_after[i - 1] = {"start": words[i - 1]["end"], "sec": gap}
    return (words[0]["start"], words[-1]["end"]), pause_after


def analyse(words: list[dict], vad_segments: list[list[float]] | None = None) -> dict:
    """Сырые счётчики по одной записи: из них считаются и метрики записи, и сводные."""
    words = [w for w in words if norm(w["w"])]
    raw = {
        "windowSec": 0.0, "latencySec": None, "words": 0, "fillers": 0, "syllables": 0,
        "pauseDurations": [], "boundaryDurations": [], "midDurations": [], "runs": [], "pauseList": [],
        "pauseSource": None, "repetitionExamples": [], "lexTokens": [], "rare": [], "lowConfidence": [],
    }
    if not words:
        return raw

    found = vad_pauses(words, vad_segments) if vad_segments else None
    raw["pauseSource"] = "vad" if found else "whisper"
    (start, end), pause_after = found or whisper_pauses(words)
    raw["latencySec"] = start
    raw["windowSec"] = max(end - start, 0.0)

    run = 0
    for i, w in enumerate(words):
        if i > 0 and (i - 1) in pause_after:
            pause = pause_after[i - 1]
            prev = words[i - 1]["w"]
            boundary = ends_clause(prev)
            raw["pauseDurations"].append(pause["sec"])
            (raw["boundaryDurations"] if boundary else raw["midDurations"]).append(pause["sec"])
            raw["pauseList"].append({"after": prev, "before": w["w"], "at": round(pause["start"], 2), "sec": round(pause["sec"], 2), "boundary": boundary})
            if run:
                raw["runs"].append(run)
            run = 0
        if is_filler(w["w"]):
            raw["fillers"] += 1
            continue
        run += 1
        raw["words"] += 1
        raw["syllables"] += syllables(w["w"])
        if w.get("p") is not None and w["p"] < LOW_CONFIDENCE:
            raw["lowConfidence"].append({"w": w["w"], "start": w["start"], "end": w["end"], "p": w["p"]})
    if run:
        raw["runs"].append(run)

    content = [w for w in words if not is_filler(w["w"])]
    tokens = [norm(w["w"]) for w in content]
    for i, tok in enumerate(tokens):
        if not WORD_RE.fullmatch(tok):
            continue
        if i > 0 and tok == tokens[i - 1]:
            raw["repetitionExamples"].append({"text": f"{content[i - 1]['w']} {content[i]['w']}", "start": content[i - 1]["start"]})
        elif i >= 3 and (tokens[i - 1], tok) == (tokens[i - 3], tokens[i - 2]) and len({tokens[i - 3], tokens[i - 2]}) > 1:
            text = " ".join(w["w"] for w in content[i - 3 : i + 1])
            raw["repetitionExamples"].append({"text": text, "start": content[i - 3]["start"]})

        # Слово с большой буквы не в начале предложения — скорее имя собственное, в редкие его не считаем.
        surface = content[i]["w"].lstrip("\"“‘'(")
        sentence_start = i == 0 or content[i - 1]["w"].rstrip().endswith(SENTENCE_END)
        proper = surface[:1].isupper() and not sentence_start and tok not in {"i", "i'm", "i've", "i'll", "i'd"}
        if not proper:
            raw["lexTokens"].append(tok)
            if is_rare(tok):
                raw["rare"].append(tok)
    return raw


def mattr(tokens: list[str]) -> tuple[float | None, int]:
    if not tokens:
        return None, 0
    if len(tokens) < MATTR_WINDOW:
        return len(set(tokens)) / len(tokens), len(tokens)
    windows = [len(set(tokens[i : i + MATTR_WINDOW])) / MATTR_WINDOW for i in range(len(tokens) - MATTR_WINDOW + 1)]
    return mean(windows), MATTR_WINDOW


def summarise(raws: list[dict]) -> dict:
    """Метрики по одной записи или по группе: счётчики складываются, потом пересчитываются доли и темпы."""
    window = sum(x["windowSec"] for x in raws)
    words = sum(x["words"] for x in raws)
    pauses = [d for x in raws for d in x["pauseDurations"]]
    boundary = [d for x in raws for d in x["boundaryDurations"]]
    mid = [d for x in raws for d in x["midDurations"]]
    runs = [n for x in raws for n in x["runs"]]
    phonation = window - sum(pauses)
    lex = [t for x in raws for t in x["lexTokens"]]
    rare = [t for x in raws for t in x["rare"]]
    latencies = [x["latencySec"] for x in raws if x["latencySec"] is not None]
    repetitions = [e for x in raws for e in x["repetitionExamples"]]

    # MATTR по группе — среднее по записям с весом по числу слов: окна не должны склеивать разные ответы.
    weighted = [(m, len(x["lexTokens"])) for x in raws for m in [mattr(x["lexTokens"])[0]] if m is not None]
    total_lex = sum(n for _, n in weighted)
    group_mattr = sum(m * n for m, n in weighted) / total_lex if total_lex else None

    def pause_block(durs: list[float]) -> dict:
        return {"count": len(durs), "perMin": r(per_min(len(durs), window), 1), "meanSec": r(mean(durs) if durs else None)}

    rare_counts: dict[str, int] = {}
    for t in rare:
        rare_counts[t] = rare_counts.get(t, 0) + 1

    return {
        "recordings": len(raws),
        "windowSec": r(window, 1),
        "latencySec": r(mean(latencies) if latencies else None),
        "words": words,
        "fillers": sum(x["fillers"] for x in raws),
        "syllables": sum(x["syllables"] for x in raws),
        "speechRateWpm": r(per_min(words, window), 1),
        "articulationRateSps": r(sum(x["syllables"] for x in raws) / phonation if phonation > 0 else None),
        "meanLengthOfRun": r(mean(runs) if runs else None, 1),
        "pauses": {
            **pause_block(pauses),
            "totalSec": r(sum(pauses), 1),
            "longCount": sum(1 for d in pauses if d >= LONG_PAUSE_SEC),
            "longestSec": r(max(pauses) if pauses else None),
            "boundary": pause_block(boundary),
            "midClause": pause_block(mid),
        },
        "filledPausesPerMin": r(per_min(sum(x["fillers"] for x in raws), window), 1),
        "repetitions": {"count": len(repetitions), "perMin": r(per_min(len(repetitions), window), 1), "examples": repetitions[:10]},
        "mattr": r(group_mattr, 3),
        "rareShare": r(len(rare) / len(lex) if lex else None, 3),
        "rareWords": sorted(rare_counts, key=lambda t: (-rare_counts[t], t)),
        "lowConfidence": [w for x in raws for w in x["lowConfidence"]],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Посчитать метрики беглости по расшифровкам.")
    parser.add_argument("session", nargs="?", help="папка сессии, по умолчанию активная")
    args = parser.parse_args()

    session = resolve_session(args.session)
    items = load_manifest(session)
    transcripts_dir = session / "transcripts"

    per_prompt: dict[str, dict] = {}
    raws_by_type: dict[str, list[dict]] = {t: [] for t in TYPES}
    all_raws: list[dict] = []
    engines = set()
    for prompt_id, item in items.items():
        path = transcripts_dir / f"{prompt_id}.json"
        if not path.exists():
            continue
        t = json.loads(path.read_text(encoding="utf-8"))
        vad = t.get("vad") or {}
        engines.add(f"{t.get('engine')} · {t.get('model')}")
        if vad.get("engine"):
            engines.add(vad["engine"])
        raw = analyse(t["words"], vad.get("segments"))
        _, lex_window = mattr(raw["lexTokens"])
        summary = summarise([raw])
        summary.pop("recordings")
        flags = list(t.get("flags", []))
        if raw["pauseSource"] == "whisper":
            flags.append("паузы по таймкодам Whisper: детектора речи нет, длина пауз занижена")
        per_prompt[prompt_id] = {
            "type": item.get("type"),
            "voice": item.get("voice"),
            "durationSec": t.get("durationSec"),
            **summary,
            "mattrWindow": lex_window,
            "pauseSource": raw["pauseSource"],
            "pauseList": raw["pauseList"],
            "recoveredSpans": [s for s in (t.get("recovery") or {}).get("spans", []) if s.get("recovered")],
            "flags": flags,
        }
        all_raws.append(raw)
        raws_by_type.setdefault(item.get("type") or "other", []).append(raw)

    data = {
        "session": session.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "engine": sorted(engines),
        "pauseThresholdSec": PAUSE_SEC,
        "overall": summarise(all_raws) if all_raws else None,
        "byType": {t: summarise(raws) for t, raws in raws_by_type.items() if raws},
        "perPrompt": per_prompt,
        "definitions": DEFINITIONS,
    }
    write_json(session / "metrics.json", data)
    o = data["overall"]
    if o:
        print(
            f"Метрики: {len(per_prompt)} записей, {o['words']} слов, темп {o['speechRateWpm']} сл/мин, "
            f"фраза между паузами {o['meanLengthOfRun']} сл., пауз {o['pauses']['perMin']}/мин → {session / 'metrics.json'}"
        )
    else:
        print(f"Расшифровок нет — metrics.json пустой: {session / 'metrics.json'}")


if __name__ == "__main__":
    main()
