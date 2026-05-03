"""Pydantic schemas for Secrets Manager API requests."""

from pydantic import BaseModel, ConfigDict, Field


class CreateSecretBody(BaseModel):
    """Request body for creating a new secret."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(..., description="Secret name")
    description: str | None = Field(None, description="Secret description")
    secret_string: str | None = Field(None, alias="secretString", description="Secret value as string")
    secret_binary: str | None = Field(None, alias="secretBinary", description="Secret value as base64-encoded binary")
    tags: dict[str, str] = Field(default_factory=dict, description="Resource tags")


class UpdateSecretValueBody(BaseModel):
    """Request body for updating a secret's value."""

    model_config = ConfigDict(populate_by_name=True)

    secret_string: str | None = Field(None, alias="secretString", description="New secret value as string")
    secret_binary: str | None = Field(None, alias="secretBinary", description="New secret value as base64-encoded binary")


class UpdateSecretMetadataBody(BaseModel):
    """Request body for updating a secret's metadata."""

    model_config = ConfigDict(populate_by_name=True)

    description: str | None = Field(None, description="New description")
    tags: dict[str, str] | None = Field(None, description="New tags (replaces existing)")
