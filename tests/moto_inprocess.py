"""In-process moto for route tests: real botocore requests and parsing, nothing on the network.

Routes get plain boto3 clients that moto intercepts in place of StackPort's
endpoint clients. Endpoint URLs from the environment or ~/.aws/config are
ignored: the suite points AWS_ENDPOINT_URL at a local emulator, and a request
sent there would bypass moto.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from types import ModuleType
from typing import Any

import boto3
import pytest
from botocore.config import Config
from moto import mock_aws

REGION = "us-east-1"

_CONFIG = Config(ignore_configured_endpoint_urls=True)


def moto_client(service: str, **_connection: Any) -> Any:
    """Stands in for ``backend.aws_client.get_client``."""
    return boto3.client(service, region_name=REGION, config=_CONFIG)


@contextmanager
def moto_routes(monkeypatch: pytest.MonkeyPatch, *route_modules: ModuleType) -> Iterator[None]:
    """Run ``route_modules`` against moto for the duration of the block."""
    with mock_aws():
        for module in route_modules:
            monkeypatch.setattr(module, "get_client", moto_client)
        yield
