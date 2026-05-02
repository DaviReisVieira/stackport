"""Common route dependencies and utilities."""

from fastapi import Query

from backend.config import endpoint_store


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str | None:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls, or None for real AWS.
    """
    return endpoint_store.resolve(endpoint)
