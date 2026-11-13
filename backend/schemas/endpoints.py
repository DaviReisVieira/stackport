"""Pydantic schemas for endpoint management API requests."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.connection import check_endpoint_url

_CA_BUNDLE_DESCRIPTION = (
    "Path of a PEM CA bundle to trust for this endpoint, on the machine that runs StackPort "
    "(None trusts the system store, or AWS Emulator's own certificate when StackPort finds it)"
)


def _check_url(value: str | None) -> str | None:
    """None means real AWS; anything else must be an endpoint URL StackPort accepts."""
    if value is None:
        return None
    return check_endpoint_url(value.strip())


def _clean_ca_bundle(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class _TlsFields(BaseModel):
    """TLS trust settings shared by the add and update bodies."""

    tls_verify: bool | None = Field(
        None, description="False turns certificate verification off for this endpoint"
    )
    ca_bundle: str | None = Field(None, max_length=1024, description=_CA_BUNDLE_DESCRIPTION)

    normalize_ca_bundle = field_validator("ca_bundle")(_clean_ca_bundle)

    @model_validator(mode="after")
    def check_verify_or_bundle(self):
        if self.tls_verify is False and self.ca_bundle:
            raise ValueError("Set a CA bundle or turn certificate verification off, not both")
        return self


class AddEndpointBody(_TlsFields):
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

    check_url = field_validator("url")(_check_url)


class UpdateEndpointBody(_TlsFields):
    """Request body for updating an endpoint."""

    url: str | None = Field(None, description="New endpoint URL (None for real AWS)")
    region: str | None = Field(None, description="AWS region override (None uses global default)")
    auth_type: Literal["default", "profile", "credentials"] | None = Field(
        None, description="Authentication type"
    )
    auth_profile: str | None = Field(None, description="AWS profile name (for auth_type=profile)")
    auth_access_key_id: str | None = Field(None, description="Access key ID (for auth_type=credentials)")
    auth_secret_access_key: str | None = Field(None, description="Secret access key (for auth_type=credentials)")

    check_url = field_validator("url")(_check_url)


class SetDefaultBody(BaseModel):
    """Request body for setting the default endpoint."""

    name: str = Field(..., description="Name of the endpoint to set as default")
