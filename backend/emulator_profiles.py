"""What StackPort knows about each emulator beyond recognising it.

One profile per emulator ``backend.emulators`` recognises: where its own
documentation lives, whether one request wipes its state (and which), and the
limits that change what you can do with it. Real AWS and unrecognised
endpoints have no profile, and an emulator without a feature simply doesn't
show it. Every fact comes from the emulator itself, checked against its docs
or source and against a running instance:

- AWS Emulator (1.0.367): no reset route ("The emulator doesn't provide routes
  to reset state", command reference; restarting it starts empty). It answers a
  request body over 16 MiB with 413 (``MAX_PRODUCTION_BODY_BYTES`` in
  ``vendor/server/src/lib.rs``), caps S3 storage (``MAX_OBJECT_BYTES_PER_BUCKET``
  and its siblings in the S3 service's ``state.rs``), and only runs Python and
  Node.js handlers (``engine_for`` in the Lambda service's ``execution.rs``).
- MiniStack: ``POST /_ministack/reset`` (``_handle_admin_reset`` in
  ``ministack/app.py``, and its README) answers ``{"reset": "ok"}``.
- Floci: ``POST /_floci/state/reset`` (``EmulatorInfoController``) answers
  ``{"status": "OK"}``, or 409 when a service refuses, as DynamoDB does when it
  runs on an external DynamoDB Local.
- LocalStack: the open-source image (4.14) has no reset route: it answers
  ``POST /_localstack/state/reset`` with 404. The reset its CLI sends is in the
  Pro part of the CLI (``localstack_cli/pro``).
- Moto: ``POST /moto-api/reset`` (``MotoAPIResponse.reset_response``, the
  "Reset API" in its docs) answers ``{"status": "ok"}``.

A reset goes to the endpoint's own URL plus the profile's fixed path, after a
fresh identification says which emulator answers there, and only for saved
endpoints. Like identification it sends no credentials (no emulator asks for
them on these routes) and trusts what StackPort trusts for the endpoint's
certificate, with no fallback: nothing is wiped over a connection StackPort
wouldn't use for anything else.
"""

from __future__ import annotations

import http.client
import json
import socket
import ssl
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass

from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import ClassifiedError, ErrorKind, classify, shorten
from backend.config import is_local_endpoint
from backend.connection import EndpointInfo, plan_connection, ssl_context_for
from backend.emulators import USER_AGENT, NoRedirect, detect_emulator, endpoint_base_url

# Seconds. A reset walks every service; with many resources it takes a while.
RESET_TIMEOUT = 30.0
# Bytes of an error answer read for its message.
_MAX_ANSWER = 64 * 1024


@dataclass(frozen=True)
class KnownLimit:
    """Something the emulator refuses that AWS would accept."""

    # The StackPort service it concerns ("s3", "lambda"), shown next to that
    # service's actions too; None when it applies to every request.
    service: str | None
    text: str


@dataclass(frozen=True)
class EmulatorProfile:
    docs_url: str
    # POSTed to the endpoint's base URL to wipe the state of every service; None without one.
    reset_path: str | None = None
    limits: tuple[KnownLimit, ...] = ()

    def to_dict(self) -> dict:
        return {
            "docs_url": self.docs_url,
            "reset": self.reset_path is not None,
            "limits": [asdict(limit) for limit in self.limits],
        }


PROFILES: dict[str, EmulatorProfile] = {
    "aws-emulator": EmulatorProfile(
        docs_url="https://docs.aws.amazon.com/emulator/latest/userguide/what-is-service.html",
        limits=(
            KnownLimit(None, "AWS Emulator refuses any request with a body over 16 MiB, so bigger uploads have to go in parts."),
            KnownLimit(
                "s3",
                "AWS Emulator keeps objects in memory: at most 64 MiB and 1,000 objects in each bucket, "
                "and 128 MiB and 10,000 objects across all buckets.",
            ),
            KnownLimit(
                "lambda",
                "AWS Emulator runs Python and Node.js functions only. Functions on other runtimes can be "
                "created, but invoking them fails.",
            ),
        ),
    ),
    "ministack": EmulatorProfile(docs_url="https://ministack.org/docs/", reset_path="/_ministack/reset"),
    "floci": EmulatorProfile(docs_url="https://floci.io/floci/", reset_path="/_floci/state/reset"),
    "localstack": EmulatorProfile(docs_url="https://docs.localstack.cloud/"),
    "moto": EmulatorProfile(docs_url="https://docs.getmoto.org/en/latest/", reset_path="/moto-api/reset"),
}


def with_profile(emulator: dict | None) -> dict | None:
    """An identified emulator (as ``detect_emulator`` reports it) with its ``profile``, for the UI."""
    if emulator is None:
        return None
    profile = PROFILES.get(emulator["id"])
    return {**emulator, "profile": profile.to_dict() if profile is not None else None}


class ResetRefused(Exception):
    """StackPort won't reset this endpoint's emulator. Nothing was sent."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class ResetFailed(Exception):
    """The reset didn't go through: it couldn't be sent, or the emulator didn't accept it."""

    def __init__(self, error: ClassifiedError):
        super().__init__(error.message)
        self.error = error


@dataclass(frozen=True)
class ResetTarget:
    emulator_id: str
    emulator_name: str
    url: str
    # For https:// endpoints: the trust StackPort uses for the endpoint.
    context: ssl.SSLContext | None


def reset_target(ep: EndpointInfo) -> ResetTarget:
    """Where to send the reset for a saved endpoint's emulator.

    Identifies the emulator afresh: another one may have taken the port since
    it was last looked at, and a reset path means nothing to any other.

    Raises:
        ResetRefused: real AWS, an emulator StackPort doesn't recognise, or one without a reset.
        ResetFailed: StackPort can't set up the connection (the endpoint's CA bundle, say).
    """
    if not ep.saved:
        raise ResetRefused(400, "StackPort only resets the emulator of a saved endpoint.")
    base = endpoint_base_url(ep.url) if is_local_endpoint(ep.url) else None
    if base is None:
        raise ResetRefused(400, "This endpoint is real AWS. StackPort only resets emulators.")
    emulator = detect_emulator(ep, refresh=True)
    if emulator is None:
        raise ResetRefused(
            409,
            f"StackPort can't tell which emulator answers at {ep.url}: it isn't running, or StackPort doesn't "
            "recognise it. Nothing was reset.",
        )
    profile = PROFILES.get(emulator["id"])
    if profile is None or profile.reset_path is None:
        raise ResetRefused(409, f"StackPort knows no request that resets {emulator['name']}, so it can't reset it.")
    context = _trust(ep) if base.startswith("https://") else None
    return ResetTarget(emulator["id"], emulator["name"], base + profile.reset_path, context)


def _trust(ep: EndpointInfo) -> ssl.SSLContext:
    try:
        return ssl_context_for(plan_connection(ep))
    except AwsEmulatorFilesError as exc:
        raise ResetFailed(classify(exc) or ClassifiedError(ErrorKind.OTHER, str(exc))) from exc
    except OSError as exc:  # a CA bundle that is missing, unreadable, or not PEM (ssl.SSLError)
        raise ResetFailed(
            ClassifiedError(
                ErrorKind.TLS,
                "StackPort can't load the CA bundle set for this endpoint, so it didn't send the reset.",
                hint="Check the endpoint's CA bundle in Settings.",
                cause=str(exc),
            )
        ) from exc


def send_reset(target: ResetTarget) -> None:
    """POST the reset and wait for the emulator to finish it.

    Raises:
        ResetFailed: the request couldn't be sent, or the emulator answered anything but a 2xx.
    """
    request = urllib.request.Request(target.url, data=b"", method="POST", headers={"User-Agent": USER_AGENT})
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=target.context), NoRedirect)
    try:
        with opener.open(request, timeout=RESET_TIMEOUT):
            return
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(_MAX_ANSWER)
        except (OSError, http.client.HTTPException):
            body = b""
        finally:
            exc.close()
        raise ResetFailed(_refusal(target.emulator_name, exc.code, body)) from exc
    except (OSError, http.client.HTTPException, ValueError) as exc:
        raise ResetFailed(_failure(target.emulator_name, exc)) from exc


def _refusal(name: str, status: int, body: bytes) -> ClassifiedError:
    """The emulator answered, and not with success (a redirect too: StackPort doesn't follow one)."""
    message = _answer_message(body)
    said = f": {message}" if message else "."
    return ClassifiedError(ErrorKind.OTHER, f"{name} answered the reset with HTTP {status}{said}")


def _answer_message(body: bytes) -> str | None:
    """The message in an emulator's JSON error (Floci's ``{"__type", "message"}``, say)."""
    try:
        answer = json.loads(body)
    except (ValueError, RecursionError):
        return None
    if not isinstance(answer, dict):
        return None
    message = answer.get("message", answer.get("Message"))
    return shorten(message.strip()) if isinstance(message, str) and message.strip() else None


_UNREACHABLE_HINT = "Check that the emulator is running, then try again."


def _failure(name: str, exc: BaseException) -> ClassifiedError:
    """Why the reset couldn't be sent, or got no answer, in the terms of backend.aws_errors."""
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    if isinstance(reason, ssl.SSLCertVerificationError):
        return ClassifiedError(
            ErrorKind.TLS,
            f"StackPort doesn't trust {name}'s TLS certificate, so it didn't send the reset.",
            hint="Set the endpoint's CA bundle in Settings.",
            cause=str(reason),
        )
    if isinstance(reason, ssl.SSLError):
        return ClassifiedError(ErrorKind.TLS, f"The TLS handshake with {name} failed.", cause=str(reason))
    if isinstance(reason, TimeoutError):
        return ClassifiedError(
            ErrorKind.UNREACHABLE,
            f"{name} didn't answer the reset within {RESET_TIMEOUT:g} seconds. It may still be resetting.",
            hint="Refresh in a moment to see what is left.",
        )
    if isinstance(reason, (ConnectionRefusedError, socket.gaierror)):
        return ClassifiedError(ErrorKind.UNREACHABLE, f"StackPort couldn't reach {name}.", hint=_UNREACHABLE_HINT, cause=str(reason))
    return ClassifiedError(
        ErrorKind.UNREACHABLE,
        f"The connection to {name} failed before it answered the reset.",
        hint="Refresh to see whether it reset anyway.",
        cause=str(reason),
    )
