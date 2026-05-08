"""Pydantic schemas for Lambda API requests."""

from pydantic import BaseModel, ConfigDict, Field


class UpdateFunctionConfigRequest(BaseModel):
    """Request body for updating Lambda function configuration.

    All fields are optional — only specified fields will be updated.
    Validation follows AWS Lambda limits:
    - Memory: 128-10240 MB
    - Timeout: 1-900 seconds
    """

    model_config = ConfigDict(populate_by_name=True)

    description: str | None = Field(None, description="Function description")
    handler: str | None = Field(None, description="Handler path (e.g., index.handler)")
    runtime: str | None = Field(None, description="Runtime identifier (e.g., python3.12, nodejs20.x)")
    memory_size: int | None = Field(None, alias="memorySize", ge=128, le=10240, description="Memory in MB")
    timeout: int | None = Field(None, ge=1, le=900, description="Timeout in seconds")
    environment: dict[str, str] | None = Field(None, description="Environment variables as key-value dict")
    layers: list[str] | None = Field(None, description="Layer ARNs")
