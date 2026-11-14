"""Try it: send an HTTP request to an API Gateway stage or a Lambda function URL from the console.

The browser can't call these itself (an emulator's addresses need CORS, its own
CA, or a Host header the browser won't send), so StackPort sends the request.
Where it goes is never taken from the request: the stage or function URL is
described through the endpoint first, so it has to exist there, and its
address is built from the endpoint's own URL and ``backend.invoke_urls``. The
request only adds a method, a path below that address, query parameters,
headers and a body (``schemas.try_it``).

Only saved endpoints: a URL passed straight in ``?endpoint=`` would let any
caller use StackPort to send requests anywhere. Like a Lambda invoke, sending
runs the resource's code, so it is allowed in read-only mode
(``ReadOnlyMiddleware`` asks ``is_send_path``); on AWS it needs ``confirmed``.
"""

from __future__ import annotations

import re
from typing import Any

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from backend.aws_client import get_client
from backend.aws_errors import ErrorKind, classify
from backend.config import STACKPORT_PROBE_TIMEOUT, is_local_endpoint
from backend.connection import InvalidEndpointUrl, check_endpoint_url, plan_connection, ssl_context_for
from backend.emulators import detect_emulator
from backend.invoke_urls import (
    InvokeTarget,
    NoInvokeAddress,
    TargetKind,
    aws_target,
    emulator_target,
    function_url_id,
)
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.try_it import TryItRequest
from backend.try_it import SendFailed, send

PREFIX = "/api/try-it"

router = APIRouter()

_SEND_PATH = re.compile(
    re.escape(PREFIX) + r"/(?:(?:rest-apis|http-apis)/[^/]+/stages/[^/]+|functions/[^/]+)/send"
)

# Seconds to wait for AWS to accept the connection. Emulators get STACKPORT_PROBE_TIMEOUT.
_AWS_CONNECT_TIMEOUT = 10.0


def is_send_path(path: str) -> bool:
    """Whether a request path sends a Try it request."""
    return _SEND_PATH.fullmatch(path) is not None


class _Refused(Exception):
    """The target can't be called from here. The message says why, for people."""


# --- describing targets ---------------------------------------------------------


def _rest_api_problem(client, api_id: str) -> str | None:
    api = client.get_rest_api(restApiId=api_id)
    if api.get("disableExecuteApiEndpoint"):
        return "This API's default endpoint is turned off, so it is only reachable through a custom domain name."
    return None


def _http_api_problem(client, api_id: str) -> str | None:
    api = client.get_api(ApiId=api_id)
    if api.get("ProtocolType") != "HTTP":
        return "Try it sends HTTP requests, and this is a WebSocket API."
    if api.get("DisableExecuteApiEndpoint"):
        return "This API's default endpoint is turned off, so it is only reachable through a custom domain name."
    return None


def _target(ep: EndpointInfo, kind: TargetKind, *, api_id: str = "", stage: str = "", function_url: str = "") -> InvokeTarget:
    """Where requests for the target go on ``ep``.

    Raises:
        _Refused: StackPort can't or won't address it there.
    """
    region = plan_connection(ep).region
    try:
        # Real AWS too: an AWS endpoint URL passed in the request is no more trusted than any other.
        if ep.url is not None and not ep.saved:
            raise _Refused("Try it only sends requests to saved endpoints. Save this one in Settings to use it.")
        if not is_local_endpoint(ep.url):
            return aws_target(kind, region=region, api_id=api_id, stage=stage, function_url=function_url)
        try:
            endpoint_url = check_endpoint_url(ep.url)
        except InvalidEndpointUrl as exc:
            raise _Refused(str(exc)) from exc
        url_id = ""
        if kind is TargetKind.FUNCTION_URL:
            url_id = function_url_id(function_url) or ""
            if not url_id:
                raise _Refused(f"StackPort can't read a function URL id in {function_url}, so it can't address it.")
        return emulator_target(
            endpoint_url, detect_emulator(ep), kind, region=region, api_id=api_id, stage=stage, url_id=url_id
        )
    except NoInvokeAddress as exc:
        raise _Refused(str(exc)) from exc


def _described(ep: EndpointInfo, problem: str | None, targets: list[dict[str, Any]]) -> dict[str, Any]:
    return {"realAws": not is_local_endpoint(ep.url), "problem": problem, "targets": targets}


def _stage_targets(ep: EndpointInfo, kind: TargetKind, api_id: str, stages: list[str]) -> tuple[str | None, list[dict]]:
    """Each stage with its address, or the one problem that keeps all of them from having one."""
    try:
        return None, [{"stage": stage, "url": _target(ep, kind, api_id=api_id, stage=stage).url} for stage in stages]
    except _Refused as exc:
        return str(exc), [{"stage": stage, "url": None} for stage in stages]


@router.get("/rest-apis/{api_id}")
def describe_rest_api(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """The REST API's stages and where Try it sends requests for each, or why it can't."""
    client = get_client("apigateway", **ep.client_kwargs())
    problem = _rest_api_problem(client, api_id)
    stages = sorted(stage["stageName"] for stage in client.get_stages(restApiId=api_id).get("item", []))
    if problem is not None:
        return _described(ep, problem, [{"stage": stage, "url": None} for stage in stages])
    return _described(ep, *_stage_targets(ep, TargetKind.REST_STAGE, api_id, stages))


@router.get("/http-apis/{api_id}")
def describe_http_api(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """The HTTP API's stages and where Try it sends requests for each, or why it can't."""
    client = get_client("apigatewayv2", **ep.client_kwargs())
    problem = _http_api_problem(client, api_id)
    stages = sorted(
        stage["StageName"]
        for page in client.get_paginator("get_stages").paginate(ApiId=api_id)
        for stage in page.get("Items", [])
    )
    if problem is not None:
        return _described(ep, problem, [{"stage": stage, "url": None} for stage in stages])
    return _described(ep, *_stage_targets(ep, TargetKind.HTTP_STAGE, api_id, stages))


def _function_url_configs(client, function_name: str) -> list[dict]:
    """Every function URL of the function: the unqualified one and one per alias.

    An endpoint without ListFunctionUrlConfigs (Floci) is asked for the
    unqualified one, the URL most functions have.
    """
    try:
        return [
            config
            for page in client.get_paginator("list_function_url_configs").paginate(FunctionName=function_name)
            for config in page.get("FunctionUrlConfigs", [])
        ]
    except ClientError as exc:
        classified = classify(exc)
        if classified is None or classified.kind is not ErrorKind.NOT_IMPLEMENTED:
            raise
    try:
        return [client.get_function_url_config(FunctionName=function_name)]
    except client.exceptions.ResourceNotFoundException:
        return []


def _qualifier(function_arn: str) -> str | None:
    """The alias in a qualified function ARN (``arn:aws:lambda:...:function:name:alias``), or None."""
    parts = function_arn.split(":")
    return parts[7] if len(parts) == 8 else None


@router.get("/functions/{function_name}")
def describe_function_urls(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """The function's URLs and where Try it sends requests for each, or why it can't."""
    client = get_client("lambda", **ep.client_kwargs())
    problem = None
    targets = []
    for config in _function_url_configs(client, function_name):
        try:
            url = _target(ep, TargetKind.FUNCTION_URL, function_url=config["FunctionUrl"]).url
        except _Refused as exc:
            url, problem = None, str(exc)
        targets.append({
            "qualifier": _qualifier(config.get("FunctionArn", "")),
            "functionUrl": config["FunctionUrl"],
            "authType": config.get("AuthType"),
            "url": url,
        })
    targets.sort(key=lambda target: target["qualifier"] or "")
    return _described(ep, problem, targets)


# --- sending ----------------------------------------------------------------------


def _send(ep: EndpointInfo, body: TryItRequest, target: InvokeTarget) -> dict[str, Any] | JSONResponse:
    if not is_local_endpoint(ep.url) and not body.confirmed:
        raise HTTPException(status_code=428, detail="This sends a request to AWS. Confirm it to send it.")
    plan = plan_connection(ep)
    try:
        context = ssl_context_for(plan) if target.scheme == "https" else None
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"StackPort can't load the CA bundle for this endpoint: {exc}") from exc
    connect_timeout = float(STACKPORT_PROBE_TIMEOUT) if plan.local_endpoint else _AWS_CONNECT_TIMEOUT
    try:
        return send(target, body, context=context, connect_timeout=connect_timeout).to_dict()
    except SendFailed as failure:
        return JSONResponse(status_code=502, content={"detail": failure.error.message, "error": failure.error.to_dict()})


def _refused(exc: _Refused) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/rest-apis/{api_id}/stages/{stage}/send")
def send_to_rest_stage(api_id: str, stage: str, body: TryItRequest, ep: EndpointInfo = Depends(get_endpoint_info)):
    client = get_client("apigateway", **ep.client_kwargs())
    problem = _rest_api_problem(client, api_id)
    client.get_stage(restApiId=api_id, stageName=stage)
    try:
        if problem is not None:
            raise _Refused(problem)
        target = _target(ep, TargetKind.REST_STAGE, api_id=api_id, stage=stage)
    except _Refused as exc:
        raise _refused(exc) from exc
    return _send(ep, body, target)


@router.post("/http-apis/{api_id}/stages/{stage}/send")
def send_to_http_stage(api_id: str, stage: str, body: TryItRequest, ep: EndpointInfo = Depends(get_endpoint_info)):
    client = get_client("apigatewayv2", **ep.client_kwargs())
    problem = _http_api_problem(client, api_id)
    client.get_stage(ApiId=api_id, StageName=stage)
    try:
        if problem is not None:
            raise _Refused(problem)
        target = _target(ep, TargetKind.HTTP_STAGE, api_id=api_id, stage=stage)
    except _Refused as exc:
        raise _refused(exc) from exc
    return _send(ep, body, target)


@router.post("/functions/{function_name}/send")
def send_to_function_url(
    function_name: str,
    body: TryItRequest,
    qualifier: str | None = Query(None, description="The alias whose function URL to call"),
    ep: EndpointInfo = Depends(get_endpoint_info),
):
    client = get_client("lambda", **ep.client_kwargs())
    config = client.get_function_url_config(
        FunctionName=function_name, **({"Qualifier": qualifier} if qualifier else {})
    )
    try:
        target = _target(ep, TargetKind.FUNCTION_URL, function_url=config["FunctionUrl"])
    except _Refused as exc:
        raise _refused(exc) from exc
    return _send(ep, body, target)
