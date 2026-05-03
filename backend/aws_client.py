import functools

import boto3

from backend.config import (
    AWS_ACCESS_KEY_ID,
    AWS_REGION,
    AWS_SECRET_ACCESS_KEY,
    endpoint_store,
)

_UNSET = object()


@functools.lru_cache(maxsize=256)
def get_client(
    service_name: str,
    endpoint_url: str | None = _UNSET,
    region: str | None = None,
    auth_type: str = "default",
    auth_profile: str | None = None,
    auth_access_key_id: str | None = None,
    auth_secret_access_key: str | None = None,
):
    """Return a boto3 client for the given service and endpoint.

    Args:
        service_name: AWS service name (e.g., "s3", "dynamodb")
        endpoint_url: Endpoint URL. None means real AWS (no custom endpoint).
                     Omitted (sentinel) means use default endpoint.
        region: Per-endpoint region override. None means use global AWS_REGION.
        auth_type: "default", "profile", or "credentials"
        auth_profile: AWS profile name (for auth_type="profile")
        auth_access_key_id: Access key (for auth_type="credentials")
        auth_secret_access_key: Secret key (for auth_type="credentials")

    Returns:
        Configured boto3 client
    """
    url = endpoint_store.get_default_url() if endpoint_url is _UNSET else endpoint_url
    resolved_region = region or AWS_REGION

    if auth_type == "profile" and auth_profile:
        session = boto3.Session(profile_name=auth_profile, region_name=resolved_region)
    elif auth_type == "credentials" and auth_access_key_id and auth_secret_access_key:
        session = boto3.Session(
            aws_access_key_id=auth_access_key_id,
            aws_secret_access_key=auth_secret_access_key,
            region_name=resolved_region,
        )
    else:
        session_kwargs: dict = {"region_name": resolved_region}
        if AWS_ACCESS_KEY_ID is not None:
            session_kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
        if AWS_SECRET_ACCESS_KEY is not None:
            session_kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
        session = boto3.Session(**session_kwargs)

    client_kwargs: dict = {"service_name": service_name}
    if url is not None:
        client_kwargs["endpoint_url"] = url

    return session.client(**client_kwargs)
