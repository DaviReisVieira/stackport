"""Pydantic schemas for Learn module API requests."""

from pydantic import BaseModel, ConfigDict, Field


class StepRef(BaseModel):
    """Reference to a single step within a trail."""

    model_config = ConfigDict(populate_by_name=True)

    trail_id: str = Field(..., alias="trailId", description="Trail identifier")
    lesson_id: str = Field(..., alias="lessonId", description="Lesson identifier")
    step_id: str = Field(..., alias="stepId", description="Step identifier")


class VerifyRequest(StepRef):
    """Request body for verifying a step against live resource state."""


class MarkStepRequest(StepRef):
    """Request body for completing a step by hand."""

    force: bool = Field(
        False, description="Skip a step that has verification, recording it as skipped rather than done"
    )


class SetVariableRequest(BaseModel):
    """Request body for naming a lesson's resources (bucket name, table name...)."""

    model_config = ConfigDict(populate_by_name=True)

    trail_id: str = Field(..., alias="trailId", description="Trail identifier")
    lesson_id: str = Field(..., alias="lessonId", description="Lesson identifier")
    name: str = Field(..., description="Variable name as declared by the lesson")
    value: str = Field(..., min_length=1, max_length=200, description="Value the learner chose")


class ResetProgressRequest(BaseModel):
    """Request body for resetting progress (one trail, or everything)."""

    model_config = ConfigDict(populate_by_name=True)

    trail_id: str | None = Field(None, alias="trailId", description="Trail to reset; omit to reset all")
