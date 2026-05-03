"""Pydantic schemas for Secrets Manager API requests."""

from pydantic import BaseModel, Field


class CreateSecretBody(BaseModel):
    """Request body for creating a new secret."""

    name: str = Field(..., description="Secret name")
    description: str | None = Field(None, description="Secret description")
    secret_string: str | None = Field(None, description="Secret value as string")
    secret_binary: str | None = Field(None, description="Secret value as base64-encoded binary")
    tags: dict[str, str] = Field(default_factory=dict, description="Resource tags")


class UpdateSecretValueBody(BaseModel):
    """Request body for updating a secret's value."""

    secret_string: str | None = Field(None, description="New secret value as string")
    secret_binary: str | None = Field(None, description="New secret value as base64-encoded binary")


class UpdateSecretMetadataBody(BaseModel):
    """Request body for updating a secret's metadata."""

    description: str | None = Field(None, description="New description")
    tags: dict[str, str] | None = Field(None, description="New tags (replaces existing)")
