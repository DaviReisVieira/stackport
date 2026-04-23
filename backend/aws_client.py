import functools

import boto3

from backend.config import (
    AWS_ACCESS_KEY_ID,
    AWS_REGION,
    AWS_SECRET_ACCESS_KEY,
    DEFAULT_ENDPOINT,
)


@functools.lru_cache(maxsize=128)
def get_client(service_name: str, endpoint_url: str | None = None):
    """Return a boto3 client for the given service and endpoint.

    Args:
        service_name: AWS service name (e.g., "s3", "dynamodb")
        endpoint_url: Endpoint URL to use. If None, uses DEFAULT_ENDPOINT.
                     If DEFAULT_ENDPOINT is None, connects to real AWS.

    Returns:
        Configured boto3 client
    """
    url = endpoint_url if endpoint_url is not None else DEFAULT_ENDPOINT

    kwargs = {
        "service_name": service_name,
        "region_name": AWS_REGION,
    }

    # Only set endpoint_url if explicitly provided (None = real AWS)
    if url is not None:
        kwargs["endpoint_url"] = url

    # Only set credentials if provided (None = use default credential chain)
    if AWS_ACCESS_KEY_ID is not None:
        kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
    if AWS_SECRET_ACCESS_KEY is not None:
        kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY

    return boto3.client(**kwargs)
