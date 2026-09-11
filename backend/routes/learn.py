"""Learn module routes: trails, step verification, and progress.

Trail content is authored as JSON with `{{variable}}` placeholders. A lesson
declares its variables (for example the bucket name the learner will create);
the values are generated once, persisted, and substituted into everything the
learner sees and into the verification parameters, so the commands on screen
always name the learner's own resources.
"""

import json
import logging
import random
import re
import string
from copy import deepcopy
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.config import STACKPORT_DATA_DIR
from backend.learn.verify import run_check
from backend.learn_store import LearnProgressStore
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.learn import (
    MarkStepRequest,
    ResetProgressRequest,
    SetVariableRequest,
    VerifyRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_TRAILS_DIR = Path(__file__).resolve().parent.parent / "learn" / "trails"

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _load_trails() -> dict[str, dict]:
    from backend.learn.content import validate_trail

    trails: dict[str, dict] = {}
    for path in sorted(_TRAILS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            validate_trail(data)
            trails[data["id"]] = data
        except (json.JSONDecodeError, KeyError, OSError, ValueError):
            logger.warning("Skipping invalid trail file %s", path, exc_info=True)
    return trails


TRAILS: dict[str, dict] = _load_trails()

progress_store = LearnProgressStore(json_path=STACKPORT_DATA_DIR / "learn_progress.json")


def _random_suffix(length: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choices(alphabet, k=length))


def _substitute(value: Any, variables: dict[str, str]) -> Any:
    """Recursively replace {{name}} with the learner's value. Unknown names are left alone."""
    if isinstance(value, str):
        return _PLACEHOLDER_RE.sub(lambda m: variables.get(m.group(1), m.group(0)), value)
    if isinstance(value, dict):
        return {k: _substitute(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, variables) for v in value]
    return value


def _lesson_variables(trail_id: str, lesson: dict) -> dict[str, str]:
    """Resolved variables for a lesson, generating and persisting defaults on first use."""
    specs = lesson.get("variables", [])
    if not specs:
        return {}
    defaults = {
        spec["name"]: spec.get("default", "").replace("{{suffix}}", _random_suffix())
        for spec in specs
    }
    return progress_store.get_or_create_variables(trail_id, lesson["id"], defaults)


def _find_step(trail_id: str, lesson_id: str, step_id: str) -> tuple[dict, dict]:
    """Locate a step and return it alongside the lesson's resolved variables."""
    trail = TRAILS.get(trail_id)
    if trail is None:
        raise HTTPException(status_code=404, detail=f"Trail '{trail_id}' not found")
    lesson = next((les for les in trail["lessons"] if les["id"] == lesson_id), None)
    if lesson is None:
        raise HTTPException(status_code=404, detail=f"Lesson '{lesson_id}' not found")
    step = next((s for s in lesson["steps"] if s["id"] == step_id), None)
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step '{step_id}' not found")
    return step, _lesson_variables(trail_id, lesson)


def _trail_progress(trail: dict, completed: dict) -> dict[str, Any]:
    done = completed.get(trail["id"], {})
    total_steps = sum(len(lesson["steps"]) for lesson in trail["lessons"])
    done_steps = sum(len(steps) for steps in done.values())
    return {"totalSteps": total_steps, "completedSteps": done_steps}


@router.get("/trails")
def list_trails() -> dict[str, Any]:
    """List available trails with progress summaries."""
    completed = progress_store.get_progress()["completed"]
    summaries = []
    for trail in TRAILS.values():
        summaries.append(
            {
                "id": trail["id"],
                "title": trail["title"],
                "description": trail["description"],
                "lessonCount": len(trail["lessons"]),
                **_trail_progress(trail, completed),
            }
        )
    return {"trails": summaries}


@router.get("/trails/{trail_id}")
def get_trail(trail_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get a full trail with the learner's progress, variables already substituted.

    The commands on screen name the learner's own resources and their own
    endpoint, so they can be copied and run without editing anything.
    """
    trail = TRAILS.get(trail_id)
    if trail is None:
        raise HTTPException(status_code=404, detail=f"Trail '{trail_id}' not found")

    progress = progress_store.get_progress()
    resolved = deepcopy(trail)
    variables: dict[str, dict[str, str]] = {}
    for index, lesson in enumerate(resolved["lessons"]):
        lesson_vars = _lesson_variables(trail_id, lesson)
        variables[lesson["id"]] = lesson_vars
        substitutions = {**lesson_vars, "endpointUrl": ep.url or ""}
        resolved["lessons"][index] = _substitute(lesson, substitutions)
        # the variable specs keep their unresolved defaults, so the editor can
        # show what the lesson asked for rather than the generated value
        resolved["lessons"][index]["variables"] = lesson.get("variables", [])

    return {
        "trail": resolved,
        "completed": progress["completed"].get(trail_id, {}),
        "skipped": progress["skipped"].get(trail_id, {}),
        "variables": variables,
    }


def _progress_payload(trail_id: str, progress: dict) -> dict[str, Any]:
    return {
        "completed": progress["completed"].get(trail_id, {}),
        "skipped": progress["skipped"].get(trail_id, {}),
    }


@router.post("/verify")
def verify_step(body: VerifyRequest, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Verify a step against live resource state; marks it complete on success."""
    step, variables = _find_step(body.trail_id, body.lesson_id, body.step_id)
    spec = step.get("verify")
    if not spec:
        raise HTTPException(status_code=400, detail="This step has no automatic verification; mark it done via /progress")

    result = run_check(ep, _substitute(spec, variables))
    if result["passed"]:
        progress = progress_store.mark_step(body.trail_id, body.lesson_id, body.step_id)
    else:
        progress = progress_store.get_progress()

    return {
        "passed": result["passed"],
        "verifyStatus": result["status"],
        "message": result["message"],
        **_progress_payload(body.trail_id, progress),
    }


@router.post("/progress")
def mark_step(body: MarkStepRequest) -> dict[str, Any]:
    """Complete a step by hand.

    Steps without verification are simply acknowledged. A verifiable step needs
    `force`, which records the step as skipped: verification is a record of what
    the learner built, never a toll gate that can trap them in a lesson.
    """
    step, _ = _find_step(body.trail_id, body.lesson_id, body.step_id)
    skipped = bool(step.get("verify"))
    if skipped and not body.force:
        raise HTTPException(
            status_code=400,
            detail="This step has automatic verification; use /verify, or send force to skip it",
        )
    progress = progress_store.mark_step(body.trail_id, body.lesson_id, body.step_id, skipped=skipped)
    return _progress_payload(body.trail_id, progress)


@router.post("/progress/reset")
def reset_progress(body: ResetProgressRequest) -> dict[str, Any]:
    """Reset progress for one trail, or all trails."""
    progress = progress_store.reset(body.trail_id)
    return {"completed": progress["completed"], "skipped": progress["skipped"]}


@router.post("/variables")
def set_variable(body: SetVariableRequest) -> dict[str, Any]:
    """Set a lesson variable, so the learner names their own resources."""
    trail = TRAILS.get(body.trail_id)
    if trail is None:
        raise HTTPException(status_code=404, detail=f"Trail '{body.trail_id}' not found")
    lesson = next((les for les in trail["lessons"] if les["id"] == body.lesson_id), None)
    if lesson is None:
        raise HTTPException(status_code=404, detail=f"Lesson '{body.lesson_id}' not found")

    spec = next((v for v in lesson.get("variables", []) if v["name"] == body.name), None)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"Lesson '{body.lesson_id}' has no variable '{body.name}'")

    pattern = spec.get("pattern")
    if pattern and not re.fullmatch(pattern, body.value):
        raise HTTPException(status_code=400, detail=spec.get("patternMessage", f"'{body.value}' is not a valid {body.name}."))

    _lesson_variables(body.trail_id, lesson)  # make sure defaults exist before overwriting one
    variables = progress_store.set_variable(body.trail_id, body.lesson_id, body.name, body.value)
    return {"variables": variables}
