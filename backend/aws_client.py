import functools

import boto3

from backend.config import (
    AWS_ACCESS_KEY_ID,
    AWS_REGION,
    AWS_SECRET_ACCESS_KEY,
    DEFAULT_ENDPOINT,
)

_UNSET = object()


@functools.lru_cache(maxsize=256)
def get_client(service_name: str, endpoint_url: str | None = _UNSET):
    """Return a boto3 client for the given service and endpoint.

    Args:
        service_name: AWS service name (e.g., "s3", "dynamodb")
        endpoint_url: Endpoint URL. None means real AWS (no custom endpoint).
                     Omitted (sentinel) means use DEFAULT_ENDPOINT.

    Returns:
        Configured boto3 client
    """
    url = DEFAULT_ENDPOINT if endpoint_url is _UNSET else endpoint_url

    kwargs = {
        "service_name": service_name,
        "region_name": AWS_REGION,
    }

    if url is not None:
        kwargs["endpoint_url"] = url

    if AWS_ACCESS_KEY_ID is not None:
        kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
    if AWS_SECRET_ACCESS_KEY is not None:
        kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY

    return boto3.client(**kwargs)
