"""App-wide handlers that answer AWS failures with a useful status and message.

An error the endpoint answered with a 4xx (a missing resource, a bad
parameter) keeps that status, also when a route caught it and raised a
generic 500. An endpoint failing with a 5xx is a 502, unless it said it
doesn't implement the operation (501).

Response body for a rewritten error::

    {"detail": "<what happened>", "error": {"kind": "...", "message": "...", "hint": "...", ...}}

``detail`` stays a string so every existing client keeps working.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import HTTP_STATUS, ClassifiedError, ErrorKind, classify, shorten

logger = logging.getLogger(__name__)

# Kinds that say nothing about the request itself, so they override whatever
# status a route picked when it wrapped the error.
_ALWAYS_REWRITE = frozenset({ErrorKind.NOT_IMPLEMENTED, ErrorKind.CREDENTIALS, ErrorKind.TLS, ErrorKind.UNREACHABLE})

# What routes raise to say "the call failed" without saying how. Any other
# status (a route's own 404, a 501 for a feature the endpoint lacks) was
# chosen on purpose.
_GENERIC_FAILURES = frozenset({500, 502})


def _response(classified: ClassifiedError, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": classified.message, "error": classified.to_dict()})


def _status_for(exc: Exception, classified: ClassifiedError) -> int:
    """The status for an AWS error, as if no route had caught it."""
    if classified.kind in HTTP_STATUS:
        return HTTP_STATUS[classified.kind]
    if isinstance(exc, ClientError):
        upstream = (exc.response.get("ResponseMetadata", {}) or {}).get("HTTPStatusCode")
        # A 4xx from the endpoint (a missing resource, a bad parameter) is the
        # answer to this request; a 5xx is the endpoint failing, so it's a bad gateway.
        if isinstance(upstream, int) and 400 <= upstream < 500:
            return upstream
        return 502
    return 500


def _status_for_wrapped(exc: StarletteHTTPException, classified: ClassifiedError) -> int | None:
    """The status for a route's HTTPException that wraps an AWS error, or None to keep the route's answer."""
    if classified.kind in _ALWAYS_REWRITE:
        return HTTP_STATUS[classified.kind]
    # The error the route was handling when it raised, with or without ``from``.
    wrapped = exc.__cause__ or exc.__context__
    # A route that wrapped the endpoint's answer in a generic failure meant
    # "the call failed"; the endpoint's own status says what failed (a missing
    # secret is a 404, AccessDenied a 403). Anything else that went wrong in
    # the route, even while it handled an endpoint error, is still StackPort's.
    if exc.status_code in _GENERIC_FAILURES and isinstance(wrapped, ClientError):
        return _status_for(wrapped, classified)
    return None


async def _http_exception(request: Request, exc: StarletteHTTPException):
    classified = classify(exc)
    status = _status_for_wrapped(exc, classified) if classified is not None else None
    if status is not None:
        return _response(classified, status)
    return await http_exception_handler(request, exc)


async def _unhandled_aws_error(_request: Request, exc: Exception):
    """A boto3 error no route caught: still answer JSON with the classified message."""
    classified = classify(exc) or ClassifiedError(ErrorKind.OTHER, shorten(str(exc)))
    status = _status_for(exc, classified)
    if status >= 500:
        logger.warning("Unhandled AWS error (%s): %s", classified.kind.value, exc, exc_info=exc)
    return _response(classified, status)


class _AsciiJSONResponse(JSONResponse):
    """JSON with everything outside ASCII escaped, which any text can be written as.

    A request's JSON can carry a lone surrogate (``"\\ud800"``), which no UTF-8
    encoder accepts, and a validation error repeats the input it refused.
    """

    def render(self, content: Any) -> bytes:
        return json.dumps(content, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")


async def _request_validation_error(_request: Request, exc: RequestValidationError):
    """FastAPI's own 422 answer, written so that whatever the request sent can be repeated back."""
    return _AsciiJSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


def install_aws_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _request_validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(ClientError, _unhandled_aws_error)
    app.add_exception_handler(BotoCoreError, _unhandled_aws_error)
    app.add_exception_handler(AwsEmulatorFilesError, _unhandled_aws_error)
