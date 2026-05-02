"""Pydantic schemas for endpoint management API requests."""

from pydantic import BaseModel, Field


class AddEndpointBody(BaseModel):
    """Request body for adding a new endpoint."""

    name: str = Field(..., description="Unique endpoint name")
    url: str | None = Field(None, description="Endpoint URL (None for real AWS)")


class UpdateEndpointBody(BaseModel):
    """Request body for updating an endpoint."""

    url: str | None = Field(None, description="New endpoint URL (None for real AWS)")


class SetDefaultBody(BaseModel):
    """Request body for setting the default endpoint."""

    name: str = Field(..., description="Name of the endpoint to set as default")
