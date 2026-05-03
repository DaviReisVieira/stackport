"""Common route dependencies and utilities."""

from dataclasses import dataclass

from fastapi import Depends, Query

from backend.config import endpoint_store


@dataclass(frozen=True)
class EndpointInfo:
    """Resolved endpoint URL and region."""

    url: str | None
    region: str | None


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str | None:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls, or None for real AWS.
    """
    return endpoint_store.resolve(endpoint)


def get_endpoint_info(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> EndpointInfo:
    """Resolve endpoint query param to URL and region.

    This dependency resolves the endpoint name to both a URL and region,
    avoiding ambiguity when multiple endpoints share the same URL (e.g., None for real AWS).
    """
    url, region = endpoint_store.resolve_with_region(endpoint)
    return EndpointInfo(url=url, region=region)
