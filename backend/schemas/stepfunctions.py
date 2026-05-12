"""Pydantic schemas for Step Functions API requests."""

from pydantic import BaseModel, Field


class StartExecutionRequest(BaseModel):
    """Request body for starting a Step Functions execution."""

    name: str | None = Field(None, alias="name")
    input: dict | None = Field(None, alias="input")

    model_config = {"populate_by_name": True}


class StopExecutionRequest(BaseModel):
    """Request body for stopping a Step Functions execution."""

    error: str | None = Field(None, alias="error")
    cause: str | None = Field(None, alias="cause")

    model_config = {"populate_by_name": True}
