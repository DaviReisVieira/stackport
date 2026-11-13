"""App-wide handlers that answer AWS failures with a useful status and message.

Response body for a rewritten error::

    {"detail": "<what happened>", "error": {"kind": "...", "message": "...", "hint": "...", ...}}

``detail`` stays a string so every existing client keeps working.
"""

from __future__ import annotations

import logging

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import HTTP_STATUS, ClassifiedError, ErrorKind, classify, shorten

logger = logging.getLogger(__name__)

# Kinds that say nothing about the request itself, so they override whatever
# status a route picked when it wrapped the error.
_ALWAYS_REWRITE = frozenset({ErrorKind.NOT_IMPLEMENTED, ErrorKind.CREDENTIALS, ErrorKind.TLS, ErrorKind.UNREACHABLE})


def _response(classified: ClassifiedError, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": classified.message, "error": classified.to_dict()})


def _should_rewrite(classified: ClassifiedError, route_status: int) -> bool:
    if classified.kind in _ALWAYS_REWRITE:
        return True
    # A route that wrapped AccessDenied in a generic 500 meant "something failed";
    # 403 says what. A route that picked a 4xx on purpose keeps it.
    return classified.kind is ErrorKind.FORBIDDEN and route_status >= 500


async def _http_exception(request: Request, exc: StarletteHTTPException):
    classified = classify(exc)
    if classified is not None and _should_rewrite(classified, exc.status_code):
        return _response(classified, HTTP_STATUS[classified.kind])
    return await http_exception_handler(request, exc)


def _status_for_unhandled(exc: Exception, classified: ClassifiedError) -> int:
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


async def _unhandled_aws_error(_request: Request, exc: Exception):
    """A boto3 error no route caught: still answer JSON with the classified message."""
    classified = classify(exc) or ClassifiedError(ErrorKind.OTHER, shorten(str(exc)))
    status = _status_for_unhandled(exc, classified)
    if status >= 500:
        logger.warning("Unhandled AWS error (%s): %s", classified.kind.value, exc, exc_info=exc)
    return _response(classified, status)


def install_aws_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(ClientError, _unhandled_aws_error)
    app.add_exception_handler(BotoCoreError, _unhandled_aws_error)
    app.add_exception_handler(AwsEmulatorFilesError, _unhandled_aws_error)
