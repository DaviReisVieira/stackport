"""Persistent store for Learn module progress.

Single-user local store, mirroring the endpoint_store persistence pattern:
threading lock, atomic tmp+fsync+replace writes, and graceful recovery
from a corrupt or missing file.
"""

import copy
import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

_CURRENT_VERSION = 1


def _empty_progress() -> dict:
    return {"version": _CURRENT_VERSION, "completed": {}, "skipped": {}, "variables": {}}


class LearnProgressStore:
    """Stores completed steps as {trail_id: {lesson_id: [step_id, ...]}}.

    Steps the learner skipped are recorded in `completed` too, so the lesson
    keeps moving, and additionally in `skipped` so the UI can show them as
    "moved past" rather than "done" and offer them for a later re-check.
    """

    def __init__(self, json_path: Path):
        self._path = json_path
        self._lock = threading.RLock()
        self._data: dict = _empty_progress()
        self._load()

    def _load(self) -> None:
        try:
            if self._path.exists():
                with open(self._path) as f:
                    data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("completed"), dict):
                    data.setdefault("skipped", {})
                    data.setdefault("variables", {})
                    self._data = data
                else:
                    logger.warning("Unexpected learn progress format in %s; reinitializing", self._path)
        except (json.JSONDecodeError, OSError):
            logger.warning("Could not read learn progress from %s; reinitializing", self._path)

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "w") as f:
                json.dump(self._data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._path)
        except OSError:
            logger.warning("Failed to save learn progress to %s", self._path, exc_info=True)
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    def get_progress(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._data)

    def mark_step(self, trail_id: str, lesson_id: str, step_id: str, skipped: bool = False) -> dict:
        with self._lock:
            steps = self._data["completed"].setdefault(trail_id, {}).setdefault(lesson_id, [])
            dirty = False
            if step_id not in steps:
                steps.append(step_id)
                dirty = True

            if skipped:
                skips = self._data["skipped"].setdefault(trail_id, {}).setdefault(lesson_id, [])
                if step_id not in skips:
                    skips.append(step_id)
                    dirty = True
            else:
                # verifying a step the learner had skipped upgrades it to done
                skips = self._data["skipped"].get(trail_id, {}).get(lesson_id, [])
                if step_id in skips:
                    skips.remove(step_id)
                    dirty = True

            if dirty:
                self._save()
            return copy.deepcopy(self._data)

    def get_or_create_variables(self, trail_id: str, lesson_id: str, defaults: dict[str, str]) -> dict[str, str]:
        """Resolved variables for a lesson.

        Defaults are generated once and persisted, so a name containing a random
        suffix stays the same across reloads and the commands on screen keep
        matching the resources the learner actually created.
        """
        with self._lock:
            stored = self._data["variables"].setdefault(trail_id, {}).setdefault(lesson_id, {})
            added = {name: value for name, value in defaults.items() if name not in stored}
            if added:
                stored.update(added)
                self._save()
            return dict(stored)

    def set_variable(self, trail_id: str, lesson_id: str, name: str, value: str) -> dict[str, str]:
        with self._lock:
            stored = self._data["variables"].setdefault(trail_id, {}).setdefault(lesson_id, {})
            if stored.get(name) != value:
                stored[name] = value
                self._save()
            return dict(stored)

    def reset(self, trail_id: str | None = None) -> dict:
        with self._lock:
            if trail_id is None:
                self._data["completed"] = {}
                self._data["skipped"] = {}
                self._data["variables"] = {}
            else:
                self._data["completed"].pop(trail_id, None)
                self._data["skipped"].pop(trail_id, None)
                self._data["variables"].pop(trail_id, None)
            self._save()
            return copy.deepcopy(self._data)
