"""Where API Gateway stages and Lambda function URLs answer, on each emulator and on AWS.

On AWS both are reached at a host that names the resource:
``{api-id}.execute-api.{region}.amazonaws.com/{stage}`` and
``{url-id}.lambda-url.{region}.on.aws``. An emulator answers every service on
one host and port, so each names the API or function URL its own way: in the
path, or in a Host header sent to its own address. ``FORMATS`` holds those
ways, keyed by the ids ``backend.emulators`` recognises. Each was read in the
emulator's source or docs and tried against it:

- AWS Emulator: ``/_aws/execute-api/{api}/{stage}`` for REST and HTTP APIs
  (``invoke.rs`` in its API Gateway service, ``announced_execute_api_endpoint``
  in API Gateway V2) and ``/_aws/lambda-url/{url-id}``, the FunctionUrl it
  returns (``state/function_url.rs`` in Lambda).
- MiniStack: the same two paths (``_parse_execute_api_url`` and
  ``_parse_lambda_url`` in ``ministack/app.py``).
- Floci: ``/_aws/execute-api/{api}/{stage}`` (``ApiGatewayAwsExecuteController``)
  and ``/lambda-url/{url-id}`` (``LambdaUrlInvocationController``).
- LocalStack: ``/_aws/execute-api/{api}/{stage}`` for REST APIs
  (``ApiGatewayRouter``). HTTP APIs, which its paid plans serve, and function
  URLs (``FunctionUrlRouter``) by host, as its docs give them:
  ``{api}.execute-api.localhost.localstack.cloud``, where a ``$default`` stage
  has no path segment, and ``{url-id}.lambda-url.{region}.localhost.localstack.cloud``.
- Moto: its server has no data plane for either.

Where the stage is a path segment, a ``$default`` stage is spelled ``$default``:
AWS Emulator and MiniStack accept it, and Floci requires it.

A target only ever points at the endpoint's own scheme, host and port, or, on
AWS, at the execute-api or lambda-url host of the resource itself: ids go
through ``quote`` into the path, or must be valid host labels.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from enum import Enum
from urllib.parse import quote, urlsplit

from botocore.loaders import create_loader

DEFAULT_STAGE = "$default"

_HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_REGION = re.compile(r"[a-z]{2}(?:-[a-z]+)+-\d{1,2}")
# The path AWS Emulator announces a function URL at.
_LAMBDA_URL_PATH = re.compile(r"/_aws/lambda-url/(?P<id>[A-Za-z0-9-]+)/?")
# On AWS, the one address a function URL has (``FunctionUrlConfig$FunctionUrl``).
_AWS_FUNCTION_URL_DOMAIN = "on.aws"


class TargetKind(str, Enum):
    REST_STAGE = "rest-stage"
    HTTP_STAGE = "http-stage"
    FUNCTION_URL = "function-url"

    @property
    def described(self) -> str:
        return {
            TargetKind.REST_STAGE: "REST API stages",
            TargetKind.HTTP_STAGE: "HTTP API stages",
            TargetKind.FUNCTION_URL: "Lambda function URLs",
        }[self]


@dataclass(frozen=True)
class Format:
    """How one emulator addresses one kind of target.

    ``path`` and ``host`` are templates over ``api_id``, ``stage``, ``url_id`` and
    ``region``. With a ``host``, requests go to the endpoint's own address with
    that Host header (and the endpoint's port); without one, the endpoint's own.
    """

    path: str
    host: str | None = None
    # The $default stage is left out of the path, rather than named in it.
    omit_default_stage: bool = False


@dataclass(frozen=True)
class EmulatorFormats:
    rest_stage: Format | None
    http_stage: Format | None
    function_url: Format | None

    def for_kind(self, kind: TargetKind) -> Format | None:
        return {
            TargetKind.REST_STAGE: self.rest_stage,
            TargetKind.HTTP_STAGE: self.http_stage,
            TargetKind.FUNCTION_URL: self.function_url,
        }[kind]


_EXECUTE_API_PATH = Format("/_aws/execute-api/{api_id}/{stage}")

FORMATS: dict[str, EmulatorFormats] = {
    "aws-emulator": EmulatorFormats(
        rest_stage=_EXECUTE_API_PATH,
        http_stage=_EXECUTE_API_PATH,
        function_url=Format("/_aws/lambda-url/{url_id}"),
    ),
    "ministack": EmulatorFormats(
        rest_stage=_EXECUTE_API_PATH,
        http_stage=_EXECUTE_API_PATH,
        function_url=Format("/_aws/lambda-url/{url_id}"),
    ),
    "floci": EmulatorFormats(
        rest_stage=_EXECUTE_API_PATH,
        http_stage=_EXECUTE_API_PATH,
        function_url=Format("/lambda-url/{url_id}"),
    ),
    "localstack": EmulatorFormats(
        rest_stage=_EXECUTE_API_PATH,
        http_stage=Format("/{stage}", host="{api_id}.execute-api.localhost.localstack.cloud", omit_default_stage=True),
        function_url=Format("", host="{url_id}.lambda-url.{region}.localhost.localstack.cloud"),
    ),
    "moto": EmulatorFormats(rest_stage=None, http_stage=None, function_url=None),
}


class NoInvokeAddress(Exception):
    """StackPort doesn't know where the target answers on this endpoint. The message says why."""


@dataclass(frozen=True)
class InvokeTarget:
    """Where a request to one stage or function URL goes."""

    scheme: str
    # What StackPort opens the connection to.
    connect_host: str
    connect_port: int
    # The Host header, and the host the shown URL names.
    host: str
    # Percent-encoded, without a trailing slash ("" for the root).
    base_path: str

    @property
    def url(self) -> str:
        return f"{self.scheme}://{self.host}{self.base_path}"


def function_url_id(function_url: str) -> str | None:
    """The url id in a FunctionUrl an endpoint returned, or None when it has none StackPort can read.

    Either the host's first label (``{url-id}.lambda-url.{region}.…``, AWS and
    most emulators) or the path AWS Emulator announces (``/_aws/lambda-url/{url-id}/``).
    """
    try:
        parts = urlsplit(function_url)
    except ValueError:
        return None
    match = _LAMBDA_URL_PATH.fullmatch(parts.path)
    if match:
        return match["id"]
    labels = (parts.hostname or "").split(".")
    if len(labels) >= 3 and labels[1] == "lambda-url" and re.fullmatch(r"[A-Za-z0-9-]+", labels[0]):
        return labels[0]
    return None


def emulator_target(
    endpoint_url: str,
    emulator: dict | None,
    kind: TargetKind,
    *,
    region: str,
    api_id: str = "",
    stage: str = "",
    url_id: str = "",
) -> InvokeTarget:
    """The target on an emulator's own address. ``emulator`` is ``detect_emulator``'s answer.

    Raises:
        NoInvokeAddress: the emulator wasn't recognised, or doesn't serve ``kind``.
    """
    if emulator is None:
        raise NoInvokeAddress(
            f"StackPort couldn't tell which emulator answers at {endpoint_url}, "
            f"so it doesn't know where that endpoint serves {kind.described}."
        )
    formats = FORMATS.get(emulator["id"])
    template = formats.for_kind(kind) if formats is not None else None
    if template is None:
        raise NoInvokeAddress(
            f"{emulator['name']} doesn't serve {kind.described} over HTTP, so there's nothing to send a request to."
        )

    parts = urlsplit(endpoint_url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if template.host is None:
        host = parts.netloc
    else:
        host = template.host.format(
            api_id=_host_label(api_id, "API id") if api_id else "",
            url_id=_host_label(url_id, "function URL id") if url_id else "",
            region=_checked_region(region),
        )
        if parts.port is not None:
            host = f"{host}:{port}"
    return InvokeTarget(
        scheme=parts.scheme,
        connect_host=parts.hostname or "",
        connect_port=port,
        host=host,
        base_path=parts.path.rstrip("/") + _path(template, api_id=api_id, stage=stage, url_id=url_id),
    )


def aws_target(
    kind: TargetKind,
    *,
    region: str,
    api_id: str = "",
    stage: str = "",
    function_url: str = "",
) -> InvokeTarget:
    """The target on AWS: the resource's own execute-api or lambda-url host.

    For a function URL, the address AWS returned, as long as it has the shape
    AWS documents for it.

    Raises:
        NoInvokeAddress: an address that doesn't have that shape, or a region
            StackPort can't place in a partition.
    """
    region = _checked_region(region)
    if kind is TargetKind.FUNCTION_URL:
        url_id = function_url_id(function_url)
        host = f"{url_id}.lambda-url.{region}.{_AWS_FUNCTION_URL_DOMAIN}"
        if url_id is None or not _HOST_LABEL.fullmatch(url_id) or urlsplit(function_url).hostname != host:
            raise NoInvokeAddress(
                f"StackPort doesn't recognise {function_url} as a function URL address on AWS, so it won't send a request to it."
            )
        return InvokeTarget(scheme="https", connect_host=host, connect_port=443, host=host, base_path="")

    host = f"{_host_label(api_id, 'API id')}.execute-api.{region}.{_dns_suffix(region)}"
    template = Format("/{stage}", omit_default_stage=kind is TargetKind.HTTP_STAGE)
    return InvokeTarget(
        scheme="https",
        connect_host=host,
        connect_port=443,
        host=host,
        base_path=_path(template, api_id=api_id, stage=stage, url_id=""),
    )


def _path(template: Format, *, api_id: str, stage: str, url_id: str) -> str:
    if any(value in (".", "..") for value in (api_id, stage, url_id)):
        # quote() leaves dots alone, and a server would read these as a step up the path.
        raise NoInvokeAddress("An id or stage name can't be . or .., so StackPort can't address it.")
    path = template.path
    if template.omit_default_stage and stage == DEFAULT_STAGE:
        path = path.replace("/{stage}", "")
    # "$" stays as it is in a stage name: Floci matches "$default" only as written.
    return path.format(api_id=quote(api_id, safe=""), stage=quote(stage, safe="$"), url_id=quote(url_id, safe=""))


def _host_label(value: str, what: str) -> str:
    label = value.lower()
    if not _HOST_LABEL.fullmatch(label):
        raise NoInvokeAddress(f"The {what} {value!r} can't be part of a host name, so StackPort can't address it.")
    return label


def _checked_region(region: str) -> str:
    if not _REGION.fullmatch(region):
        raise NoInvokeAddress(f"{region!r} isn't a region name StackPort can put in a host name.")
    return region


@functools.cache
def _partitions() -> tuple[dict, ...]:
    return tuple(create_loader().load_data("endpoints")["partitions"])


def _dns_suffix(region: str) -> str:
    """The domain AWS serves ``region``'s endpoints under (``amazonaws.com``, ``amazonaws.com.cn``, ...)."""
    for partition in _partitions():
        if region in partition.get("regions", {}) or re.fullmatch(partition["regionRegex"], region):
            return partition["dnsSuffix"]
    raise NoInvokeAddress(f"StackPort doesn't know which AWS partition {region} is in.")
