"""Turn boto3 failures into something a person can act on.

Most routes wrap whatever they catch in ``HTTPException(500, str(e))``. That
hides the difference between "this emulator doesn't implement the operation",
"the credentials were rejected", "the certificate isn't trusted", and "nothing
is listening", which need very different fixes. ``classify`` recovers that
difference from the exception (or from the exception chain behind an
``HTTPException``), and ``main.py`` uses it to answer with the right status and
a message that says what to do.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, replace
from enum import Enum

from botocore.exceptions import ClientError, HTTPClientError, NoCredentialsError, PartialCredentialsError, ProfileNotFound, SSLError
from botocore.exceptions import ConnectionError as BotoConnectionError

from backend import config
from backend.aws_emulator import AwsEmulatorFilesError, display_path


class ErrorKind(str, Enum):
    """What went wrong, in terms of what fixes it."""

    NOT_IMPLEMENTED = "not_implemented"  # the endpoint doesn't support the operation
    CREDENTIALS = "credentials"  # missing, invalid, or expired credentials
    FORBIDDEN = "forbidden"  # valid credentials without permission
    TLS = "tls"  # the endpoint's certificate isn't trusted
    UNREACHABLE = "unreachable"  # nothing answered at the endpoint
    OTHER = "other"


# Kinds where the problem is the connection to the endpoint, not the request:
# every call to the endpoint fails the same way until the setup changes.
ENDPOINT_KINDS = frozenset({ErrorKind.CREDENTIALS, ErrorKind.TLS, ErrorKind.UNREACHABLE})

# HTTP status StackPort answers with for each kind it rewrites.
HTTP_STATUS = {
    ErrorKind.NOT_IMPLEMENTED: 501,
    ErrorKind.CREDENTIALS: 401,
    ErrorKind.FORBIDDEN: 403,
    ErrorKind.TLS: 502,
    ErrorKind.UNREACHABLE: 502,
}

# AWS Emulator and LocalStack answer 501 NotImplemented. MiniStack answers an
# action it doesn't know with the error AWS itself uses for an unknown action
# (InvalidAction for Query APIs, UnknownOperationException for JSON ones), and
# hands a request for an API it doesn't serve at all to S3 (see _s3_error_code).
_NOT_IMPLEMENTED_CODES = frozenset({
    "InvalidAction",
    "NotImplemented",
    "NotImplementedError",
    "NotImplementedException",
    "UnknownOperation",
    "UnknownOperationException",
})

_CREDENTIAL_CODES = frozenset({
    "AuthFailure",
    "ExpiredToken",
    "ExpiredTokenException",
    "IncompleteSignature",
    "InvalidAccessKeyId",
    "InvalidClientTokenId",
    "InvalidSignatureException",
    "InvalidToken",
    "MissingAuthenticationToken",
    "MissingAuthenticationTokenException",
    "SignatureDoesNotMatch",
    "UnrecognizedClientException",
})

_FORBIDDEN_CODES = frozenset({
    "AccessDenied",
    "AccessDeniedException",
    "AuthorizationError",
    "Forbidden",
    "UnauthorizedOperation",
})

# AWS Emulator answers AccessDenied, not a signature error, when a request is
# signed with keys from another run (or another emulator).
_EMULATOR_KEYS_MESSAGE = "emulator credentials"

_CHAIN_LIMIT = 8


_ECHO_LIMIT = 300


def shorten(text: str) -> str:
    """Cap text taken from an endpoint's answer: a parse error can carry a whole page of it."""
    return text if len(text) <= _ECHO_LIMIT else text[: _ECHO_LIMIT - 1] + "…"


def _emulator_folder() -> str:
    """Where StackPort looks for AWS Emulator's files, for hints: honours STACKPORT_AWS_EMULATOR_DIR."""
    base = config.STACKPORT_AWS_EMULATOR_DIR
    if base is None:
        return "the folder named by STACKPORT_AWS_EMULATOR_DIR (currently empty, so StackPort doesn't look) "
    return f"{display_path(base)}/<port>/"


@dataclass(frozen=True)
class ClassifiedError:
    kind: ErrorKind
    message: str
    hint: str | None = None
    code: str | None = None
    operation: str | None = None
    # The original error text, when ``message`` rewrote it for people.
    cause: str | None = None

    @property
    def is_endpoint_problem(self) -> bool:
        return self.kind in ENDPOINT_KINDS

    def to_dict(self) -> dict:
        data = asdict(self)
        data["kind"] = self.kind.value
        return {key: value for key, value in data.items() if value is not None}


def _chain(exc: BaseException):
    """The exception, then its causes, nearest first (bounded, cycle-safe)."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(seen) < _CHAIN_LIMIT:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


# An S3 error document: <Error> at the root, its <Code> first.
_S3_ERROR_DOCUMENT = re.compile(r"\s*(?:<\?xml[^>]*\?>\s*)?<Error>\s*<Code>([A-Za-z0-9.]+)</Code>")


def _s3_error_code(code: str | None, status: int | None, message: str) -> str | None:
    """The code of an S3 error that answered a call to another API, or None.

    When an error isn't in the API's own format, botocore takes the HTTP status
    for its code and, for JSON APIs, the body for its message. An S3 error there
    means the endpoint gave the request to S3: it doesn't serve the API. That is
    what MiniStack does with anything it can't route (MethodNotAllowed for a
    POST, NoSuchBucket for a GET). S3's own calls never get here: botocore reads
    their errors, so the code isn't the status.
    """
    if status is None or code != str(status):
        return None
    match = _S3_ERROR_DOCUMENT.match(message)
    return match.group(1) if match else None


def _classify_client_error(err: ClientError) -> ClassifiedError:
    error = err.response.get("Error", {}) or {}
    code = error.get("Code") or None
    message = error.get("Message") or str(err)
    status = (err.response.get("ResponseMetadata", {}) or {}).get("HTTPStatusCode")
    operation = err.operation_name or None

    s3_code = _s3_error_code(code, status, message)
    if code in _NOT_IMPLEMENTED_CODES or status == 501 or s3_code is not None:
        what = operation or "this operation"
        return ClassifiedError(
            ErrorKind.NOT_IMPLEMENTED,
            f"This endpoint doesn't implement {what} yet.",
            hint="The endpoint doesn't support this operation. StackPort shows the rest of what it supports.",
            code=s3_code or code or "NotImplemented",
            operation=operation,
        )
    if code in _FORBIDDEN_CODES and _EMULATOR_KEYS_MESSAGE in message.lower():
        return ClassifiedError(
            ErrorKind.CREDENTIALS,
            "AWS Emulator rejected the credentials StackPort signed with.",
            hint=(
                "AWS Emulator creates new keys every time it starts. StackPort reads them from "
                f"{_emulator_folder()} when it can see that folder, so check that it can "
                "(see STACKPORT_AWS_EMULATOR_DIR), and that the endpoint has no keys of its own."
            ),
            code=code,
            operation=operation,
        )
    if code in _CREDENTIAL_CODES:
        return ClassifiedError(
            ErrorKind.CREDENTIALS,
            f"The endpoint rejected StackPort's credentials ({code}).",
            hint="Check the credentials this endpoint uses in Settings, or the AWS_* variables StackPort runs with.",
            code=code,
            operation=operation,
        )
    if code in _FORBIDDEN_CODES:
        return ClassifiedError(
            ErrorKind.FORBIDDEN,
            message,
            hint="The credentials are valid but not allowed to do this.",
            code=code,
            operation=operation,
        )
    return ClassifiedError(ErrorKind.OTHER, message, code=code, operation=operation)


UNTRUSTED_CERTIFICATE_MESSAGE = "StackPort doesn't trust the endpoint's TLS certificate."

# Substrings OpenSSL puts in the error text, lowercased.
_CERTIFICATE_MARKERS = ("certificate verify failed", "certificate_verify_failed", "hostname mismatch", "doesn't match")
_NOT_TLS_MARKERS = ("wrong version number", "wrong_version_number", "packet length too long", "unknown protocol", "http request")


def _classify_tls_failure(text: str) -> ClassifiedError:
    """Tell an untrusted certificate apart from a server that isn't speaking TLS at all."""
    lowered = text.lower()
    if any(marker in lowered for marker in _NOT_TLS_MARKERS):
        return ClassifiedError(
            ErrorKind.TLS,
            "The endpoint didn't answer with TLS.",
            hint="If the emulator serves plain HTTP (most do, AWS Emulator doesn't), use an http:// URL for it.",
        )
    if any(marker in lowered for marker in _CERTIFICATE_MARKERS):
        return ClassifiedError(
            ErrorKind.TLS,
            UNTRUSTED_CERTIFICATE_MESSAGE,
            hint=(
                "For an emulator with a self-signed certificate, set the endpoint's CA bundle in "
                f"Settings. For AWS Emulator, StackPort uses {_emulator_folder()}ca.pem by itself "
                "when the endpoint URL is https://127.0.0.1:<port> and that folder is readable."
            ),
        )
    return ClassifiedError(
        ErrorKind.TLS,
        "The TLS handshake with the endpoint failed.",
        hint="Check that the URL's scheme and port match what the emulator serves.",
    )


def classify_one(exc: BaseException) -> ClassifiedError | None:
    """Classify a single exception, without looking at its causes."""
    result = _classify_one(exc)
    if result is None or result.kind is ErrorKind.OTHER:
        return result
    cause = str(exc)
    return replace(result, cause=cause) if cause and cause != result.message else result


def _classify_one(exc: BaseException) -> ClassifiedError | None:
    if isinstance(exc, ClientError):
        return _classify_client_error(exc)
    if isinstance(exc, AwsEmulatorFilesError):
        return ClassifiedError(
            ErrorKind.CREDENTIALS,
            f"StackPort can't read {display_path(exc.path)}, which AWS Emulator wrote: {exc.reason}.",
            hint=(
                "AWS Emulator makes its files readable only by the user that runs it. Run StackPort as "
                "that user, or point STACKPORT_AWS_EMULATOR_DIR at a copy StackPort can read."
            ),
        )
    if isinstance(exc, SSLError):
        return _classify_tls_failure(str(exc))
    # botocore's ConnectionError covers refused connections, DNS failures, connect
    # timeouts, and proxies. SSLError is a ConnectionError too, which is why it
    # comes first.
    if isinstance(exc, BotoConnectionError):
        return ClassifiedError(
            ErrorKind.UNREACHABLE,
            "StackPort couldn't reach the endpoint.",
            hint="Check that the emulator is running and that the endpoint URL and port are right.",
        )
    # HTTPClientError covers read timeouts and dropped connections: the endpoint
    # is there, this one call failed. Not an endpoint-wide problem, so one slow
    # operation doesn't make StackPort give up on the others.
    if isinstance(exc, HTTPClientError):
        return ClassifiedError(
            ErrorKind.OTHER,
            "The endpoint accepted the connection but the call didn't complete.",
            hint="The emulator may be busy (starting up, or a slow operation). Try again in a moment.",
            cause=str(exc),
        )
    if isinstance(exc, (NoCredentialsError, PartialCredentialsError)):
        return ClassifiedError(
            ErrorKind.CREDENTIALS,
            "StackPort has no credentials to sign requests to this endpoint.",
            hint="Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (any value works for most emulators), or give the endpoint its own credentials in Settings.",
        )
    if isinstance(exc, ProfileNotFound):
        return ClassifiedError(
            ErrorKind.CREDENTIALS,
            str(exc),
            hint="Pick a profile that exists in ~/.aws/config, or switch the endpoint to another auth type.",
        )
    return None


def classify(exc: BaseException) -> ClassifiedError | None:
    """Classify an exception, looking through ``raise ... from`` and implicit chaining.

    Returns None when nothing in the chain came from talking to AWS, so callers
    can leave unrelated errors alone.
    """
    for link in _chain(exc):
        result = classify_one(link)
        if result is not None:
            return result
    return None
