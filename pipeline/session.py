"""Где лежит сессия теста и что в ней записано. Общие помощники для transcribe.py и metrics.py."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def results_root() -> Path:
    # Сервер теста тоже читает RESULTS_DIR: так e2e и самопроверка не трогают настоящие результаты.
    return Path(os.environ.get("RESULTS_DIR", "results"))


def resolve_session(arg: str | None) -> Path:
    """Папка сессии: из аргумента или активная, на которую указывает results/active.json."""
    if arg:
        session = Path(arg)
    else:
        pointer = results_root() / "active.json"
        if not pointer.exists():
            sys.exit(f"Нет активной сессии: не найден {pointer}. Передай папку сессии аргументом.")
        session = results_root() / json.loads(pointer.read_text(encoding="utf-8"))["id"]
    if not session.is_dir():
        sys.exit(f"Папка сессии не найдена: {session}")
    return session


def load_manifest(session: Path) -> dict[str, dict]:
    """Записи части 6 по id вопроса. Пустой словарь, если речь ещё не записывали."""
    path = session / "speaking" / "manifest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("items", {})


def write_json(path: Path, data: object) -> None:
    # Пишем во временный файл и переименовываем: прерванный запуск не оставит полузаписанный JSON.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
