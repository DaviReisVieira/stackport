"""Validation for authored trail content.

A typo in a trail JSON file, a verification type that does not exist or a step
pointing at a hotspot the UI never renders would all strand a learner mid
lesson with no way forward. Content is therefore validated when it loads, and
the test suite runs the same validation over everything that ships, so bad
content fails in CI instead of in front of someone trying to learn.
"""

import re

from backend.learn.hotspots import KNOWN_HOTSPOT_IDS
from backend.learn.verify import CHECKS

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")

# Filled in by the server rather than declared by a lesson
_IMPLICIT_VARIABLES = frozenset({"endpointUrl"})

_TRAIL_KEYS = ("id", "title", "description", "lessons")
_LESSON_KEYS = ("id", "title", "summary", "steps")
_STEP_KEYS = ("id", "title", "instruction")


def _require(data: dict, keys: tuple[str, ...], where: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise ValueError(f"{where} is missing {', '.join(missing)}")


def _validate_verify(spec: dict, where: str) -> None:
    check_type = spec.get("type")
    if check_type not in CHECKS:
        raise ValueError(f"{where} uses unknown verify type '{check_type}'")
    if check_type == "all_of":
        for nested in spec.get("params", {}).get("checks", []):
            _validate_verify(nested, f"{where} (nested)")


def validate_trail(trail: dict) -> None:
    """Raise ValueError describing the first problem found, if any."""
    _require(trail, _TRAIL_KEYS, "trail")
    if not trail["lessons"]:
        raise ValueError(f"trail '{trail['id']}' has no lessons")

    lesson_ids: set[str] = set()
    for lesson in trail["lessons"]:
        _require(lesson, _LESSON_KEYS, f"lesson in trail '{trail['id']}'")
        where_lesson = f"{trail['id']}/{lesson['id']}"
        if lesson["id"] in lesson_ids:
            raise ValueError(f"duplicate lesson id '{lesson['id']}' in trail '{trail['id']}'")
        lesson_ids.add(lesson["id"])

        declared = {spec["name"] for spec in lesson.get("variables", [])} | _IMPLICIT_VARIABLES
        for spec in lesson.get("variables", []):
            if "default" not in spec:
                raise ValueError(f"variable '{spec['name']}' in {where_lesson} has no default")

        if not lesson["steps"]:
            raise ValueError(f"lesson {where_lesson} has no steps")

        # everything except the variable specs, whose defaults carry {{suffix}}
        body = {key: value for key, value in lesson.items() if key != "variables"}
        for name in _placeholders(body) - declared:
            raise ValueError(f"lesson {where_lesson} uses undeclared variable '{{{{{name}}}}}'")

        step_ids: set[str] = set()
        hotspot_ids: set[str] = set()
        for step in lesson["steps"]:
            _require(step, _STEP_KEYS, f"step in lesson {where_lesson}")
            where = f"{where_lesson}/{step['id']}"
            if step["id"] in step_ids:
                raise ValueError(f"duplicate step id '{step['id']}' in lesson {where_lesson}")
            step_ids.add(step["id"])

            if step.get("verify"):
                _validate_verify(step["verify"], where)

            console = step.get("console")
            if console:
                hotspot_id = console.get("hotspotId")
                if hotspot_id and hotspot_id not in KNOWN_HOTSPOT_IDS:
                    raise ValueError(f"{where} points at unknown hotspot '{hotspot_id}'")
                if hotspot_id in hotspot_ids:
                    # two steps sharing an anchor would unlock the second one's
                    # Next button as soon as the first one mounted
                    raise ValueError(f"{where} reuses hotspot '{hotspot_id}' within the same lesson")
                if hotspot_id:
                    hotspot_ids.add(hotspot_id)
                if not console.get("route"):
                    raise ValueError(f"{where} has a console path with no route")

            for name in _placeholders(step) - declared:
                raise ValueError(f"{where} uses undeclared variable '{{{{{name}}}}}'")


def _placeholders(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, str):
        found.update(_PLACEHOLDER_RE.findall(value))
    elif isinstance(value, dict):
        for nested in value.values():
            found |= _placeholders(nested)
    elif isinstance(value, list):
        for nested in value:
            found |= _placeholders(nested)
    return found
