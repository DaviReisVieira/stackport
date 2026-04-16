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

    Returns:
        Configured boto3 client
    """
    url = endpoint_url if endpoint_url is not None else DEFAULT_ENDPOINT
    return boto3.client(
        service_name,
        endpoint_url=url,
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )
