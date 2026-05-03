"""Common route dependencies and utilities."""

from dataclasses import dataclass

from fastapi import Depends, Query

from backend.config import endpoint_store


@dataclass(frozen=True)
class EndpointInfo:
    """Resolved endpoint URL, region, and auth configuration."""

    url: str | None
    region: str | None
    auth_type: str = "default"
    auth_profile: str | None = None
    auth_access_key_id: str | None = None
    auth_secret_access_key: str | None = None

    def client_kwargs(self) -> dict:
        """Return kwargs to pass to get_client beyond service_name."""
        return {
            "endpoint_url": self.url,
            "region": self.region,
            "auth_type": self.auth_type,
            "auth_profile": self.auth_profile,
            "auth_access_key_id": self.auth_access_key_id,
            "auth_secret_access_key": self.auth_secret_access_key,
        }


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str | None:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls, or None for real AWS.
    """
    return endpoint_store.resolve(endpoint)


def get_endpoint_info(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> EndpointInfo:
    """Resolve endpoint query param to URL, region, and auth config.

    This dependency resolves the endpoint name to full connection info,
    including auth type and credentials/profile.
    """
    entry = endpoint_store.resolve_full(endpoint)
    if entry:
        return EndpointInfo(
            url=entry["url"],
            region=entry.get("region"),
            auth_type=entry.get("auth_type", "default"),
            auth_profile=entry.get("auth_profile"),
            auth_access_key_id=entry.get("auth_access_key_id"),
            auth_secret_access_key=entry.get("auth_secret_access_key"),
        )

    url, region = endpoint_store.resolve_with_region(endpoint)
    return EndpointInfo(url=url, region=region)
