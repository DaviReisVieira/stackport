"""API Explorer: any operation of any service botocore knows, run against the selected endpoint.

Only operations in a service's model are reachable. The name is checked against
the model, then called through the client method botocore generated for it, so
nothing else on a client (``generate_presigned_url``, ``get_paginator``,
``close``, ``meta``) can be reached. In read-only mode ``ReadOnlyMiddleware``
lets a run through only when ``service_models.is_read_operation`` says so,
reading the service and operation from the path (``operation_run_by``).

A ``ClientError`` is the endpoint's answer, so it reaches the app-wide handlers,
which reply with the endpoint's status and message. Parameter values are never
logged: they hold secrets.
"""

from __future__ import annotations

import base64
import codecs
import json
import math
import re
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

import botocore
import jmespath
from botocore import xform_name
from botocore.exceptions import EndpointResolutionError, ParamValidationError
from botocore.model import Shape
from botocore.response import StreamingBody
from botocore.validate import validate_parameters
from fastapi import APIRouter, Depends, HTTPException

from backend import service_models
from backend.aws_client import get_isolated_client
from backend.learn.cli_setup import cli_setup_for
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.explorer import RunOperationRequest

PREFIX = "/api/explorer"

router = APIRouter()

_RUN_PATH = re.compile(re.escape(PREFIX) + r"/services/(?P<service>[^/]+)/operations/(?P<operation>[^/]+)/run")

# A streaming body (S3 GetObject, Lambda Invoke) is read up to this many bytes, then closed.
STREAM_READ_LIMIT = 1024 * 1024
# Responses past this size, as JSON, aren't sent to the browser.
RESPONSE_SIZE_LIMIT = 5 * 1024 * 1024

# How bytes that aren't UTF-8 text travel as JSON, both ways.
BASE64_KEY = "$base64"


def operation_run_by(path: str) -> tuple[str, str] | None:
    """The (service, operation) a request path runs, or None when it isn't a run."""
    match = _RUN_PATH.fullmatch(path)
    return (match["service"], match["operation"]) if match else None


def _not_found(exc: LookupError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


@router.get("/services")
def list_services() -> dict[str, Any]:
    return {"botocoreVersion": botocore.__version__, "services": service_models.list_services()}


@router.get("/services/{service}")
def get_service(service: str) -> dict[str, Any]:
    try:
        return service_models.describe_service(service)
    except service_models.UnknownService as exc:
        raise _not_found(exc) from exc


@router.get("/services/{service}/operations/{operation}")
def get_operation(service: str, operation: str) -> dict[str, Any]:
    try:
        return service_models.describe_operation(service, operation)
    except (service_models.UnknownService, service_models.UnknownOperation) as exc:
        raise _not_found(exc) from exc


@router.get("/cli-setup")
def get_cli_setup(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """The shell setup copied commands need for this endpoint beyond ``--endpoint-url``, or null.

    The same setup Learn shows next to its CLI steps (AWS Emulator's keys,
    certificate and host prefixes), served here so it doesn't depend on Learn
    being turned on.
    """
    return {"cliSetup": cli_setup_for(ep)}


@router.post("/services/{service}/operations/{operation}/run")
def run_operation(
    service: str,
    operation: str,
    body: RunOperationRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    try:
        model = service_models.operation_model(service, operation)
    except (service_models.UnknownService, service_models.UnknownOperation) as exc:
        raise _not_found(exc) from exc
    if model.has_event_stream_input or model.has_event_stream_output:
        raise HTTPException(
            status_code=400,
            detail=f"{operation} streams events, which the API Explorer can't run.",
        )
    paging = service_models.pagination(service, operation)
    if body.paginate and paging is None:
        raise HTTPException(status_code=400, detail=f"{operation} doesn't paginate.")
    params = _decode_blobs(body.params, model.input_shape, "")

    # Any of botocore's services can be run here, so these clients stay out of the
    # console's shared sessions, which keep every model they load.
    client = get_isolated_client(service, **ep.client_kwargs())
    method_name = xform_name(operation)
    # botocore leaves out of the client the few operations it can't call
    if client.meta.method_to_api_mapping.get(method_name) != operation:
        raise HTTPException(status_code=400, detail=f"boto3 can't call {operation}.")
    call = getattr(client, method_name)

    notices: list[str] = []
    responses: list[dict[str, Any]] = []
    # Pages too large to show still count: they were fetched all the same
    fetched_bytes = 0
    request = params
    started = time.perf_counter()
    while True:
        raw = _call(call, request, model.input_shape)
        metadata = raw.pop("ResponseMetadata", {})
        next_token = _next_token(raw, paging) if paging else None
        label = f"Page {len(responses) + 1}" if body.paginate else "The response"
        page = _serialize(raw, "", notices)
        size = len(json.dumps(page))
        fetched_bytes += size
        if size > RESPONSE_SIZE_LIMIT:
            page = None
            notices.append(f"{label} is {_size(size)} as JSON, more than the {_size(RESPONSE_SIZE_LIMIT)} the API Explorer shows.")
        responses.append({
            "body": page,
            "metadata": {
                "httpStatusCode": metadata.get("HTTPStatusCode"),
                "requestId": metadata.get("RequestId"),
                "retryAttempts": metadata.get("RetryAttempts"),
            },
        })
        if not body.paginate or next_token is None or len(responses) >= body.max_pages:
            break
        if fetched_bytes >= RESPONSE_SIZE_LIMIT:
            notices.append(f"Stopped following pages after {_size(RESPONSE_SIZE_LIMIT)} of responses.")
            break
        request = {key: value for key, value in params.items() if key not in paging["input_tokens"]} | next_token

    return {
        "responses": responses,
        "durationMs": round((time.perf_counter() - started) * 1000, 1),
        "nextToken": _serialize(next_token, "", notices) if next_token else None,
        "notices": notices,
    }


def _call(call: Callable[..., dict[str, Any]], request: dict[str, Any], input_shape: Shape | None) -> dict[str, Any]:
    """One call. Mistakes in the input that botocore finds while building the request are a 400."""
    try:
        return call(**request)
    except ParamValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except EndpointResolutionError as exc:
        # A parameter that becomes part of the host, like s3control's AccountId
        raise HTTPException(status_code=400, detail=f"botocore can't build the request's URL: {exc}") from exc
    except (TypeError, ValueError) as exc:
        # A few of botocore's handlers read parameters before it validates them
        # (S3's customer key handler). When the validator explains the failure,
        # that's the answer; anything else is a bug and stays a 500.
        if input_shape is not None:
            try:
                validate_parameters(request, input_shape)
            except ParamValidationError as invalid:
                raise HTTPException(status_code=400, detail=str(invalid)) from exc
        raise


def _size(size: int) -> str:
    if size < 1024:
        return f"{size} bytes"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _next_token(page: dict[str, Any], paging: dict[str, Any]) -> dict[str, Any] | None:
    """The parameters that ask for the page after ``page``, the way botocore's paginators find them."""
    if paging["more_results"] and not jmespath.search(paging["more_results"], page):
        return None
    tokens = {
        key: jmespath.search(expression, page)
        for key, expression in zip(paging["input_tokens"], paging["output_tokens"])
    }
    # An empty token means there's nothing after this page
    tokens = {key: value for key, value in tokens.items() if value}
    return tokens or None


def _decode_blobs(value: Any, shape: Shape | None, path: str) -> Any:
    """``value`` with every ``{"$base64": ...}`` given for a blob turned into bytes."""
    if shape is None:
        return value
    if shape.type_name == "blob" and isinstance(value, dict) and value.keys() == {BASE64_KEY}:
        try:
            return base64.b64decode(value[BASE64_KEY], validate=True)
        # binascii.Error for bad characters is a ValueError, and so is text that isn't ASCII
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"{path or 'The value'} isn't valid base64.") from exc
    if shape.type_name == "structure" and isinstance(value, dict):
        return {
            key: _decode_blobs(item, shape.members.get(key), f"{path}.{key}" if path else key)
            for key, item in value.items()
        }
    if shape.type_name == "list" and isinstance(value, list):
        return [_decode_blobs(item, shape.member, f"{path}[{index}]") for index, item in enumerate(value)]
    if shape.type_name == "map" and isinstance(value, dict):
        return {key: _decode_blobs(item, shape.value, f"{path}.{key}") for key, item in value.items()}
    return value


def _serialize(value: Any, path: str, notices: list[str]) -> Any:
    """A boto3 response as JSON: timestamps in ISO 8601, bytes as text or base64, streams read up to a limit."""
    if isinstance(value, dict):
        return {key: _serialize(item, f"{path}.{key}" if path else str(key), notices) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize(item, f"{path}[{index}]", notices) for index, item in enumerate(value)]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return _bytes(value)
    if isinstance(value, StreamingBody):
        return _stream(value, path, notices)
    # botocore parses "NaN" and "Infinity" for floats and doubles, which JSON can't carry
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def _bytes(data: bytes, *, complete: bool = True) -> str | dict[str, str]:
    try:
        # A stream cut off by the read limit can end inside a character: leave that one out
        return codecs.getincrementaldecoder("utf-8")().decode(data, final=complete)
    except UnicodeDecodeError:
        return {BASE64_KEY: base64.b64encode(data).decode("ascii")}


def _stream(body: StreamingBody, path: str, notices: list[str]) -> str | dict[str, str]:
    try:
        data = body.read(STREAM_READ_LIMIT + 1)
    finally:
        body.close()
    if len(data) <= STREAM_READ_LIMIT:
        return _bytes(data)
    notices.append(f"{path} shows the first {_size(STREAM_READ_LIMIT)} of the stream; the rest wasn't read.")
    return _bytes(data[:STREAM_READ_LIMIT], complete=False)
