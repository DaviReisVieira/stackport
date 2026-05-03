"""Pydantic schemas for endpoint management API requests."""

from typing import Literal

from pydantic import BaseModel, Field


class AddEndpointBody(BaseModel):
    """Request body for adding a new endpoint."""

    name: str = Field(..., description="Unique endpoint name")
    url: str | None = Field(None, description="Endpoint URL (None for real AWS)")
    region: str | None = Field(None, description="AWS region override (None uses global default)")
    auth_type: Literal["default", "profile", "credentials"] = Field(
        "default", description="Authentication type"
    )
    auth_profile: str | None = Field(None, description="AWS profile name (for auth_type=profile)")
    auth_access_key_id: str | None = Field(None, description="Access key ID (for auth_type=credentials)")
    auth_secret_access_key: str | None = Field(None, description="Secret access key (for auth_type=credentials)")


class UpdateEndpointBody(BaseModel):
    """Request body for updating an endpoint."""

    url: str | None = Field(None, description="New endpoint URL (None for real AWS)")
    region: str | None = Field(None, description="AWS region override (None uses global default)")
    auth_type: Literal["default", "profile", "credentials"] | None = Field(
        None, description="Authentication type"
    )
    auth_profile: str | None = Field(None, description="AWS profile name (for auth_type=profile)")
    auth_access_key_id: str | None = Field(None, description="Access key ID (for auth_type=credentials)")
    auth_secret_access_key: str | None = Field(None, description="Secret access key (for auth_type=credentials)")


class SetDefaultBody(BaseModel):
    """Request body for setting the default endpoint."""

    name: str = Field(..., description="Name of the endpoint to set as default")
