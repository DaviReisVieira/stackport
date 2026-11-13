"""Lambda service-specific routes."""

import base64
import http.client
import ipaddress
import json
import logging
import socket
import ssl
import urllib.error
import urllib.request
from collections.abc import Iterator
from email.message import Message
from typing import IO, Any
from urllib.parse import SplitResult, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse

from backend.aws_client import get_client
from backend.aws_errors import ClassifiedError, ErrorKind
from backend.config import is_local_endpoint
from backend.connection import plan_connection, ssl_context_for
from backend.downloads import RELAY_CHUNK_BYTES, RelayResponse, attachment
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.lambda_svc import UpdateFunctionConfigRequest

logger = logging.getLogger(__name__)

router = APIRouter()

# Largest code package StackPort relays from an emulator. Lambda rejects code
# that unzips to more than 262,144,000 bytes ("250 MB"), and a zip is never much
# bigger than what it holds, so 256 MiB fits every package Lambda accepts,
# including ones over the 50 MB direct-upload limit that were deployed from S3.
# Anything larger isn't a code package, and StackPort won't pass it on.
CODE_PACKAGE_MAX_BYTES = 256 * 1024 * 1024

# Applies to connecting and to every read. The package comes from an emulator
# StackPort reaches directly, so a socket idle this long is stuck, not slow.
CODE_FETCH_TIMEOUT_SECONDS = 10.0

_FETCHABLE_SCHEMES = frozenset({"http", "https"})

_TLS_HINT = (
    "StackPort trusts the same certificates for this download as for the endpoint. "
    "For a self-signed certificate, set the endpoint's CA bundle in Settings."
)
_UNREACHABLE_HINT = (
    "The endpoint gave this address for the code package, so StackPort has to be able to reach it. "
    "A Docker Compose service name, for example, only resolves inside its Compose network."
)


class CodePackageTooLarge(Exception):
    """The emulator sent more than CODE_PACKAGE_MAX_BYTES after the response started.

    Raised from the response body so the response is abandoned instead of
    finished: a download that finishes normally would leave a truncated zip
    that looks complete.
    """


class _CodeFetchFailed(Exception):
    """StackPort couldn't open the code package's location."""

    def __init__(self, error: ClassifiedError):
        super().__init__(error.message)
        self.error = error


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Answer a redirect with an HTTPError, so StackPort only fetches the URL the endpoint gave."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: Message,
        newurl: str,
    ) -> urllib.request.Request | None:
        return None


class _CodePackageResponse(RelayResponse):
    """Relays an open code package download, and closes it however the response ends."""

    def __init__(self, upstream: http.client.HTTPResponse, *, origin: str, filename: str, length: int | None):
        headers = {"Content-Disposition": attachment(filename)}
        if length is not None:
            headers["Content-Length"] = str(length)
        super().__init__(_relay(upstream, origin), upstream=upstream, media_type="application/zip", headers=headers)


def _host(parts: SplitResult) -> str:
    """The URL's host and port, without any credentials in it."""
    return parts.netloc.rpartition("@")[2]


def _declared_length(headers: Message) -> int | None:
    """The body length the upstream declared, when there is one to pass on.

    A Transfer-Encoding overrides Content-Length (RFC 9112, section 6.3), and
    http.client reads the body by the same rule.
    """
    if headers.get("Transfer-Encoding") is not None:
        return None
    value = (headers.get("Content-Length") or "").strip()
    return int(value) if value.isascii() and value.isdigit() else None


def _relay(upstream: http.client.HTTPResponse, origin: str) -> Iterator[bytes]:
    """Yield the package in chunks, refusing to relay more than CODE_PACKAGE_MAX_BYTES."""
    relayed = 0
    while chunk := upstream.read(RELAY_CHUNK_BYTES):
        relayed += len(chunk)
        if relayed > CODE_PACKAGE_MAX_BYTES:
            raise CodePackageTooLarge(
                f"StackPort stopped relaying the code package from {origin} at {CODE_PACKAGE_MAX_BYTES:,} bytes, "
                "more than any package Lambda accepts."
            )
        yield chunk


def _fetch_failure(origin: str, exc: OSError | http.client.HTTPException | ValueError) -> ClassifiedError:
    """Say why opening the code location failed, in the terms of backend.aws_errors."""
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    prefix = f"StackPort couldn't fetch the code package from {origin}"
    if isinstance(reason, ssl.SSLCertVerificationError):
        return ClassifiedError(
            ErrorKind.TLS, f"{prefix}: it doesn't trust the server's TLS certificate.", hint=_TLS_HINT, cause=str(reason)
        )
    if isinstance(reason, ssl.SSLError):
        return ClassifiedError(ErrorKind.TLS, f"{prefix}: the TLS handshake failed.", hint=_TLS_HINT, cause=str(reason))
    if isinstance(reason, socket.gaierror):
        return ClassifiedError(
            ErrorKind.UNREACHABLE, f"{prefix}: StackPort can't resolve that host name.", hint=_UNREACHABLE_HINT, cause=str(reason)
        )
    if isinstance(reason, TimeoutError):
        return ClassifiedError(
            ErrorKind.UNREACHABLE,
            f"{prefix}: it didn't answer within {CODE_FETCH_TIMEOUT_SECONDS:g} seconds.",
            hint=_UNREACHABLE_HINT,
        )
    if isinstance(reason, ConnectionRefusedError):
        return ClassifiedError(
            ErrorKind.UNREACHABLE, f"{prefix}: the connection was refused.", hint=_UNREACHABLE_HINT, cause=str(reason)
        )
    if isinstance(reason, OSError):
        return ClassifiedError(
            ErrorKind.UNREACHABLE, f"{prefix}: the connection failed.", hint=_UNREACHABLE_HINT, cause=str(reason)
        )
    if isinstance(reason, http.client.HTTPException) and not isinstance(reason, http.client.InvalidURL):
        return ClassifiedError(
            ErrorKind.OTHER, f"{prefix}: it didn't answer with a valid HTTP response.", cause=repr(reason)
        )
    # A URL http.client can't send (a port that isn't a number, characters
    # outside ASCII), or a reason urllib gives as plain text, such as "no host given".
    return ClassifiedError(ErrorKind.OTHER, f"{prefix}: {reason}.")


def _parse_location(location: str) -> SplitResult:
    """Parse the code location, accepting only http and https URLs.

    Raises:
        _CodeFetchFailed: anything else, including a malformed URL.
    """
    try:
        parts = urlsplit(location)
        parts.port  # raises ValueError for a port that isn't a number
    except ValueError:
        parts = None
    if parts is None or parts.scheme not in _FETCHABLE_SCHEMES or not parts.hostname:
        # Without the query, where a pre-signed URL keeps its signature.
        shown = urlunsplit((parts.scheme, _host(parts), parts.path, "", "")) if parts else "a malformed URL"
        raise _CodeFetchFailed(
            ClassifiedError(
                ErrorKind.OTHER,
                f"StackPort can't download the code package: the endpoint gave {shown} as its location, "
                "and StackPort only fetches http and https URLs.",
            )
        )
    return parts


def _is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _effective_port(parts: SplitResult) -> int:
    return parts.port or (443 if parts.scheme == "https" else 80)


def _fetch_target(location: SplitResult, endpoint_url: str) -> str | None:
    """The URL StackPort may fetch the package from, or None to leave it to the browser.

    StackPort only fetches from the endpoint it already talks to, so a
    GetFunction answer can never make it read another URL (a host elsewhere on
    the network, a cloud metadata service): the location needs the endpoint's
    scheme and port, and either its host or a loopback one.

    - Same host: AWS Emulator, Floci (its ``FLOCI_HOSTNAME``), MiniStack reached on localhost.
    - Loopback location for an endpoint reached by name: MiniStack calls itself
      ``localhost`` even when StackPort reaches it as ``ministack`` from another
      container, so the location moves onto the endpoint's host.
    - Both loopback (``localhost`` and ``127.0.0.1``): the same server.

    Anything else (LocalStack's ``*.localhost.localstack.cloud`` host, say) gets
    the redirect StackPort always used, and the browser fetches it as before.
    """
    endpoint = urlsplit(endpoint_url)
    if location.scheme != endpoint.scheme or _effective_port(location) != _effective_port(endpoint):
        return None
    location_host = (location.hostname or "").lower()
    endpoint_host = (endpoint.hostname or "").lower()
    if location_host == endpoint_host or (_is_loopback_host(location_host) and _is_loopback_host(endpoint_host)):
        return location.geturl()
    if _is_loopback_host(location_host):
        return location._replace(netloc=_host(endpoint)).geturl()
    return None


def _open_code_location(target: str, ep: EndpointInfo) -> tuple[http.client.HTTPResponse, str]:
    """Open the code package URL, trusting what boto3 trusts for ``ep``.

    Returns the open response and the origin to name in messages.

    Raises:
        _CodeFetchFailed: fetching it failed.
    """
    parts = urlsplit(target)
    origin = f"{parts.scheme}://{_host(parts)}"
    context = ssl_context_for(plan_connection(ep)) if parts.scheme == "https" else None
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), _NoRedirects)
    try:
        return opener.open(target, timeout=CODE_FETCH_TIMEOUT_SECONDS), origin
    except urllib.error.HTTPError as exc:
        exc.close()
        status = f"HTTP {exc.code} {exc.reason or ''}".rstrip()
        raise _CodeFetchFailed(
            ClassifiedError(ErrorKind.OTHER, f"StackPort couldn't fetch the code package from {origin}: it answered {status}.")
        ) from exc
    # URLError wraps failures to connect; failures after the request was sent
    # (a timeout waiting for the answer, a dropped connection) and URLs
    # http.client can't send arrive as they are.
    except (OSError, http.client.HTTPException, ValueError) as exc:
        raise _CodeFetchFailed(_fetch_failure(origin, exc)) from exc


def _bad_gateway(function_name: str, error: ClassifiedError) -> JSONResponse:
    """Answer in the shape backend.error_handlers uses for classified AWS errors."""
    logger.warning(
        "Downloading the code of Lambda function %r failed: %s%s",
        function_name,
        error.message,
        f" ({error.cause})" if error.cause else "",
    )
    return JSONResponse(status_code=502, content={"detail": error.message, "error": error.to_dict()})


@router.get("/functions")
def list_functions(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all Lambda functions with metadata."""
    try:
        client = get_client("lambda", **ep.client_kwargs())
        paginator = client.get_paginator("list_functions")

        functions = []
        for page in paginator.paginate():
            functions.extend(page.get("Functions", []))

        return {"functions": functions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}")
def get_function(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get full function configuration, code location, and tags."""
    try:
        client = get_client("lambda", **ep.client_kwargs())
        response = client.get_function(FunctionName=function_name)

        return {
            "configuration": response.get("Configuration", {}),
            "code": response.get("Code", {}),
            "tags": response.get("Tags", {}),
            "concurrency": response.get("Concurrency"),
        }
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/code")
def download_code(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Download a function's deployment package as a zip.

    On AWS this redirects to the pre-signed URL that GetFunction returns. An
    emulator's URL often only works from where StackPort runs (a Compose
    service name, a self-signed certificate, a host the browser can't
    resolve), so when it points at the emulator itself StackPort fetches the
    package and streams it back (see ``_fetch_target``). Container image
    functions have no package to download.
    """
    client = get_client("lambda", **ep.client_kwargs())
    try:
        response = client.get_function(FunctionName=function_name)
    except client.exceptions.ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found") from exc

    configuration = response.get("Configuration", {})
    if configuration.get("PackageType", "Zip") == "Image":
        raise HTTPException(status_code=400, detail="Cannot download code for container image functions")

    location = response.get("Code", {}).get("Location")
    if not location:
        raise HTTPException(status_code=404, detail="Code location not available")

    if not is_local_endpoint(ep.url):
        return RedirectResponse(url=location)

    try:
        # Only for an endpoint someone saved: a URL passed straight in the request
        # could point StackPort anywhere, so its location is left to the browser.
        target = _fetch_target(_parse_location(location), ep.url) if ep.saved else None
        if target is None:
            return RedirectResponse(url=location)
        upstream, origin = _open_code_location(target, ep)
    except _CodeFetchFailed as failure:
        return _bad_gateway(function_name, failure.error)

    length = _declared_length(upstream.headers)
    if length is not None and length > CODE_PACKAGE_MAX_BYTES:
        upstream.close()
        return _bad_gateway(
            function_name,
            ClassifiedError(
                ErrorKind.OTHER,
                f"StackPort didn't download the code package from {origin}: it is {length:,} bytes, and "
                f"StackPort stops at {CODE_PACKAGE_MAX_BYTES:,} bytes, more than any package Lambda accepts.",
            ),
        )

    filename = f"{configuration.get('FunctionName') or function_name}.zip"
    return _CodePackageResponse(upstream, origin=origin, filename=filename, length=length)


@router.post("/functions/{function_name}/invoke")
def invoke_function(function_name: str, payload: dict[str, Any], ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Invoke a Lambda function with a JSON payload.

    Request body: { "payload": {...} }
    Returns: status, response payload, logs, error if any.
    """
    try:
        client = get_client("lambda", **ep.client_kwargs())

        # Extract the actual payload from the request body
        function_payload = payload.get("payload", {})

        response = client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            LogType="Tail",
            Payload=json.dumps(function_payload).encode("utf-8"),
        )

        # Read the streaming body
        response_payload = response.get("Payload")
        if response_payload:
            response_payload = response_payload.read().decode("utf-8")
            try:
                response_payload = json.loads(response_payload)
            except json.JSONDecodeError:
                # Keep as string if not valid JSON
                pass

        # Decode base64 logs
        log_result = response.get("LogResult")
        logs = None
        if log_result:
            try:
                logs = base64.b64decode(log_result).decode("utf-8")
            except Exception:
                logs = None

        return {
            "statusCode": response.get("StatusCode"),
            "functionError": response.get("FunctionError"),
            "executedVersion": response.get("ExecutedVersion"),
            "payload": response_payload,
            "logs": logs,
        }

    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/event-sources")
def list_event_sources(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List event source mappings for a function."""
    try:
        client = get_client("lambda", **ep.client_kwargs())
        paginator = client.get_paginator("list_event_source_mappings")

        mappings = []
        for page in paginator.paginate(FunctionName=function_name):
            mappings.extend(page.get("EventSourceMappings", []))

        return {"eventSourceMappings": mappings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/aliases")
def list_aliases(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List aliases for a function."""
    try:
        client = get_client("lambda", **ep.client_kwargs())
        paginator = client.get_paginator("list_aliases")

        aliases = []
        for page in paginator.paginate(FunctionName=function_name):
            aliases.extend(page.get("Aliases", []))

        return {"aliases": aliases}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/versions")
def list_versions(function_name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List versions for a function."""
    try:
        client = get_client("lambda", **ep.client_kwargs())
        paginator = client.get_paginator("list_versions_by_function")

        versions = []
        for page in paginator.paginate(FunctionName=function_name):
            versions.extend(page.get("Versions", []))

        return {"versions": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/functions/{function_name}/configuration")
def update_function_configuration(
    function_name: str,
    body: UpdateFunctionConfigRequest,
    ep: EndpointInfo = Depends(get_endpoint_info)
) -> dict[str, Any]:
    """Update Lambda function configuration (partial updates supported).

    All body fields are optional — only specified fields will be updated.
    Returns the updated function configuration.
    """
    try:
        client = get_client("lambda", **ep.client_kwargs())

        # Build boto3 kwargs from request body, skipping None values
        update_kwargs: dict[str, Any] = {"FunctionName": function_name}

        if body.description is not None:
            update_kwargs["Description"] = body.description

        if body.handler is not None:
            update_kwargs["Handler"] = body.handler

        if body.runtime is not None:
            update_kwargs["Runtime"] = body.runtime

        if body.memory_size is not None:
            update_kwargs["MemorySize"] = body.memory_size

        if body.timeout is not None:
            update_kwargs["Timeout"] = body.timeout

        if body.environment is not None:
            update_kwargs["Environment"] = {"Variables": body.environment}

        if body.layers is not None:
            update_kwargs["Layers"] = body.layers

        # Call update_function_configuration
        response = client.update_function_configuration(**update_kwargs)

        return {"configuration": response}

    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except client.exceptions.InvalidParameterValueException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
