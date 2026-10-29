"""Pydantic schemas for Bedrock endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class ConverseBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model_id: str = Field(alias="modelId", min_length=1)
    prompt: str = Field(min_length=1)
    system: str | None = None
    max_tokens: int | None = Field(alias="maxTokens", default=None, ge=1)
    temperature: float | None = Field(default=None, ge=0, le=1)
    top_p: float | None = Field(alias="topP", default=None, ge=0, le=1)
