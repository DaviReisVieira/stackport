"""Pydantic schemas for CloudWatch Logs API requests."""

from pydantic import BaseModel, ConfigDict, Field


class CreateLogGroupBody(BaseModel):
    """Request body for creating a new log group."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(..., description="Log group name")
    retention_in_days: int | None = Field(None, alias="retentionInDays", description="Retention period in days")
    tags: dict[str, str] = Field(default_factory=dict, description="Resource tags")


class SetRetentionBody(BaseModel):
    """Request body for setting a log group's retention policy."""

    model_config = ConfigDict(populate_by_name=True)

    retention_in_days: int | None = Field(None, alias="retentionInDays", description="Retention period in days, or null to never expire")
