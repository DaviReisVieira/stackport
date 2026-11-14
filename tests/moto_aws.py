"""StackPort's routes answered by moto's in-memory AWS.

Responses then go through botocore's real parsing and handlers, which a mock
returning hand-made dicts skips. botocore parses IAM policy documents into
dicts, for instance: mocks that returned strings hid that StackPort didn't
expect it.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import urlsplit

import boto3
from moto import mock_aws

from backend.aws_client import get_client
from backend.cache import cache
from backend.main import app
from backend.routes.common import EndpointInfo, get_endpoint_info

REGION = "us-east-1"

# moto answers calls made to AWS's own hosts, so StackPort is pointed at AWS.
MOTO = EndpointInfo(url=None, region=REGION)


def _forget_cached() -> None:
    # A client built before moto started would bypass it; results would be stale.
    get_client.cache_clear()
    cache.delete_by_prefix(MOTO.cache_scope())


def _assert_on_aws(client) -> None:
    host = urlsplit(client.meta.endpoint_url).hostname or ""
    assert host.endswith(".amazonaws.com"), f"{client.meta.endpoint_url} isn't AWS, so moto wouldn't answer it"


@contextmanager
def moto_account() -> Iterator[None]:
    """StackPort's AWS calls go to a new, empty moto account until the block ends."""
    # StackPort's clients ignore configured endpoint URLs on their own; the plain
    # boto3 clients from aws() would otherwise use AWS_ENDPOINT_URL, which
    # conftest points at a local emulator.
    with patch.dict(os.environ, {"AWS_IGNORE_CONFIGURED_ENDPOINT_URLS": "true"}), mock_aws():
        _forget_cached()
        _assert_on_aws(get_client("sts", **MOTO.client_kwargs()))
        app.dependency_overrides[get_endpoint_info] = lambda: MOTO
        try:
            yield
        finally:
            app.dependency_overrides.pop(get_endpoint_info, None)
            _forget_cached()


def aws(service: str):
    """A client for setting up resources in the moto account (inside ``moto_account`` only)."""
    client = boto3.client(service, region_name=REGION)
    _assert_on_aws(client)
    return client
