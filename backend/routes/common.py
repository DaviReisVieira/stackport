"""Common route dependencies and utilities."""

from fastapi import HTTPException, Query

from backend.config import endpoint_store
from backend.connection import EndpointInfo, InvalidEndpointUrl, check_endpoint_url

__all__ = ["EndpointInfo", "endpoint_info_for", "endpoint_info_for_url", "get_endpoint_info", "get_endpoint_url"]


def _is_direct_url(endpoint: str | None) -> bool:
    return endpoint is not None and endpoint.startswith(("http://", "https://"))


def get_endpoint_url(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> str | None:
    """Extract and validate endpoint from query params.

    Args:
        endpoint: Endpoint name (e.g., "local") or direct URL. If None, uses default.

    Returns:
        Endpoint URL to use for AWS API calls, or None for real AWS.
    """
    if _is_direct_url(endpoint):
        try:
            check_endpoint_url(endpoint)
        except InvalidEndpointUrl as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return endpoint_store.resolve(endpoint)


def endpoint_info_for(endpoint: str | None) -> EndpointInfo:
    """Resolve an endpoint name, a direct URL, or None (the default) to connection info.

    Raises:
        InvalidEndpointUrl: a direct URL StackPort refuses to use.
    """
    if _is_direct_url(endpoint):
        check_endpoint_url(endpoint)
    entry = endpoint_store.resolve_full(endpoint)
    if entry:
        return EndpointInfo.from_entry(entry)

    url, region = endpoint_store.resolve_with_region(endpoint)
    return EndpointInfo(url=url, region=region)


def endpoint_info_for_url(url: str | None) -> EndpointInfo:
    """Connection info for a URL, using the first saved endpoint with that URL, if any.

    For callers that only kept the URL, such as the WebSocket probe loop.
    """
    for entry in endpoint_store.list_all().values():
        if entry["url"] == url:
            return EndpointInfo.from_entry(entry)
    return EndpointInfo(url=url, region=None)


def get_endpoint_info(endpoint: str | None = Query(None, description="Endpoint name or URL")) -> EndpointInfo:
    """Resolve endpoint query param to URL, region, auth, and TLS config.

    This dependency resolves the endpoint name to full connection info,
    including auth type and credentials/profile.
    """
    try:
        return endpoint_info_for(endpoint)
    except InvalidEndpointUrl as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
