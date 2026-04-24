"""Common route dependencies and utilities."""

from fastapi import Query

from backend.config import DEFAULT_ENDPOINT, ENDPOINTS


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str | None:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls, or None for real AWS.
    """
    if endpoint is None:
        return DEFAULT_ENDPOINT

    if endpoint in ENDPOINTS:
        return ENDPOINTS[endpoint]

    if endpoint.startswith(("http://", "https://")):
        return endpoint

    return DEFAULT_ENDPOINT
