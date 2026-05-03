"""Pydantic schemas for endpoint management API requests."""

from pydantic import BaseModel, Field


class AddEndpointBody(BaseModel):
    """Request body for adding a new endpoint."""

    name: str = Field(..., description="Unique endpoint name")
    url: str | None = Field(None, description="Endpoint URL (None for real AWS)")
    region: str | None = Field(None, description="AWS region override (None uses global default)")


class UpdateEndpointBody(BaseModel):
    """Request body for updating an endpoint."""

    url: str | None = Field(None, description="New endpoint URL (None for real AWS)")
    region: str | None = Field(None, description="AWS region override (None uses global default)")


class SetDefaultBody(BaseModel):
    """Request body for setting the default endpoint."""

    name: str = Field(..., description="Name of the endpoint to set as default")
