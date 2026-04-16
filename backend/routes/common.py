"""Common route dependencies and utilities."""

from fastapi import Query

from backend.config import DEFAULT_ENDPOINT, ENDPOINTS


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls
    """
    if endpoint is None:
        return DEFAULT_ENDPOINT

    # Check if it's a known endpoint name
    if endpoint in ENDPOINTS:
        return ENDPOINTS[endpoint]

    # Otherwise treat as direct URL (for flexibility)
    return endpoint
