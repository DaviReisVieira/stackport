"""Recognise which emulator answers at an endpoint, so the UI can name it.

Every emulator is recognised the same way: one unauthenticated GET to a route
the emulator serves for this purpose, whose answer has to have the shape that
emulator gives it. Routes and shapes come from each emulator's source:

- MiniStack: ``/_ministack/health`` (``_handle_health_request`` in
  ``ministack/app.py``), a JSON report with a ``services`` map and a ``version``.
- Floci: ``/_floci/health`` (``EmulatorInfoController``), the same kind of report.
- LocalStack: ``/_localstack/health`` (``HealthResource`` in
  ``localstack/services/internal.py``), the report the other two are modelled on.
- Moto: ``/moto-api/config`` (``MotoAPIResponse.config``), the server's JSON
  config with ``batch`` and ``lambda`` sections. Moto 5.0.2 and later.
- AWS Emulator: ``/__admin/health`` (``serve_production_on_address`` in
  ``vendor/server/src/lib.rs``), the plain text ``ok``. HTTPS only.

MiniStack and Floci also serve their report at ``/_localstack/health``, so the
registry asks their own routes first. A matching answer only counts if a path
that no emulator serves doesn't get one too, so a server that answers every
path alike (a catch-all ``ok``, say) is never taken for an emulator.

Nothing secret is sent: no credentials, no signature. When an HTTPS endpoint's
certificate isn't trusted, identification carries on with certificate checks
off, and the result says so (``tls_trusted: false``) so the UI can explain the
certificate problem instead of only reporting a failed connection.
"""

from __future__ import annotations

import http.client
import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, replace
from urllib.parse import urlsplit

from backend.aws_emulator import AwsEmulatorFilesError
from backend.cache import cache
from backend.config import is_local_endpoint
from backend.connection import (
    PLACEHOLDER_ACCESS_KEY_ID,
    PLACEHOLDER_SECRET_ACCESS_KEY,
    ConnectionPlan,
    EndpointInfo,
    plan_connection,
    ssl_context_for,
)

logger = logging.getLogger(__name__)

# Seconds. A request that gets no answer ends the search, so a host that drops
# packets costs one request timeout and a refused connection costs nothing.
_REQUEST_TIMEOUT = 1.5
# Seconds for one identification, however slowly the endpoint answers.
_TIME_BUDGET = 3.0
# Bytes. Every answer recognised here is a few kilobytes at most.
_MAX_BODY = 64 * 1024
_READ_CHUNK = 4096
# Seconds. An emulator rarely changes behind a URL; one that isn't up yet should
# be recognised soon after it starts.
_IDENTIFIED_TTL = 60
_UNIDENTIFIED_TTL = 10
# No emulator serves this, and "_stackport" isn't a valid bucket name, so S3
# handlers answer it with an error rather than an object.
_CONTROL_PATH = "/_stackport/not-an-emulator-route"
USER_AGENT = "StackPort"


@dataclass(frozen=True)
class Recognised:
    """What a matching answer says beyond which emulator sent it."""

    version: str | None = None


@dataclass(frozen=True)
class Detector:
    """How one emulator is recognised: the route it answers and the shape of the answer."""

    id: str
    name: str
    path: str
    # The body of a 2xx answer to ``path`` -> Recognised, or None when it isn't this emulator's.
    recognise: Callable[[bytes], Recognised | None]
    https_only: bool = False


def _json_object(body: bytes) -> dict | None:
    try:
        value = json.loads(body)
    except (ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def _reported_version(value: object) -> str | None:
    """The version an emulator reported, if it reads like one."""
    if not isinstance(value, str):
        return None
    version = value.strip()
    return version if 0 < len(version) <= 64 else None


def _health_report(body: bytes) -> Recognised | None:
    """LocalStack's health report, also served by MiniStack and Floci: a ``services`` map."""
    report = _json_object(body)
    if report is None or not isinstance(report.get("services"), dict):
        return None
    return Recognised(version=_reported_version(report.get("version")))


def _moto_config(body: bytes) -> Recognised | None:
    """Moto's server config: ``batch`` and ``lambda`` sections. It carries no version."""
    config = _json_object(body)
    if config is None or not all(isinstance(config.get(section), dict) for section in ("batch", "lambda")):
        return None
    return Recognised()


def _plain_ok(body: bytes) -> Recognised | None:
    """AWS Emulator's readiness answer: exactly ``ok``. It carries no version."""
    return Recognised() if body == b"ok" else None


# Asked in this order. Only the shared /_localstack/health route constrains it.
DETECTORS: tuple[Detector, ...] = (
    Detector("ministack", "MiniStack", "/_ministack/health", _health_report),
    Detector("floci", "Floci", "/_floci/health", _health_report),
    Detector("localstack", "LocalStack", "/_localstack/health", _health_report),
    Detector("moto", "Moto", "/moto-api/config", _moto_config),
    Detector("aws-emulator", "AWS Emulator", "/__admin/health", _plain_ok, https_only=True),
)


class _NoAnswer(Exception):
    """The endpoint didn't answer (or ran out of time): the search stops."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect isn't an emulator's answer, and following it could leave the endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _unverified_context() -> ssl.SSLContext:
    # No CA store to load: nothing is verified against one.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


class _Session:
    """GETs against one endpoint, within one time budget, without credentials."""

    def __init__(self, base_url: str, context: ssl.SSLContext | None):
        """``context``: for HTTPS, the TLS trust StackPort uses for the endpoint, or None when it
        can't be set up. Unused over plain HTTP."""
        self._base_url = base_url
        self._deadline = time.monotonic() + _TIME_BUDGET
        self.https = base_url.startswith("https://")
        # Whether that trust accepts the endpoint's certificate. None over plain HTTP.
        self.tls_trusted: bool | None = (context is not None) if self.https else None
        self._opener = self._build_opener(context if context is not None else _unverified_context())

    @staticmethod
    def _build_opener(context: ssl.SSLContext) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect)

    def get(self, path: str) -> bytes | None:
        """The body of a 2xx answer, or None for any other answer.

        Raises:
            _NoAnswer: nothing answered, or the time budget ran out.
        """
        timeout = min(_REQUEST_TIMEOUT, self._deadline - time.monotonic())
        if timeout <= 0:
            raise _NoAnswer
        request = urllib.request.Request(self._base_url + path, headers={"User-Agent": USER_AGENT})
        try:
            with self._opener.open(request, timeout=timeout) as response:
                body = self._read(response)
        except urllib.error.HTTPError as exc:
            exc.close()
            return None
        except urllib.error.URLError as exc:
            if self.tls_trusted and isinstance(exc.reason, ssl.SSLCertVerificationError):
                # Identify the emulator anyway, so the UI can say whose certificate it is.
                self.tls_trusted = False
                self._opener = self._build_opener(_unverified_context())
                return self.get(path)
            raise _NoAnswer from exc
        except (OSError, http.client.HTTPException, ValueError) as exc:
            raise _NoAnswer from exc
        return body if len(body) <= _MAX_BODY else None

    def _read(self, response) -> bytes:
        """Read up to _MAX_BODY + 1 bytes, giving up at the deadline.

        A single read only waits _REQUEST_TIMEOUT for each packet, so a server
        that trickles bytes would otherwise hold the identification for as long
        as it likes.
        """
        chunks: list[bytes] = []
        size = 0
        while size <= _MAX_BODY:
            if time.monotonic() > self._deadline:
                raise _NoAnswer
            # read1 returns whatever arrived; read(n) would wait for all n bytes.
            chunk = response.read1(min(_READ_CHUNK, _MAX_BODY + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        return b"".join(chunks)


def _identify(base_url: str, context: ssl.SSLContext | None) -> dict | None:
    session = _Session(base_url, context)
    try:
        for detector in DETECTORS:
            if detector.https_only and not session.https:
                continue
            body = session.get(detector.path)
            recognised = detector.recognise(body) if body is not None else None
            if recognised is None:
                continue
            control = session.get(_CONTROL_PATH)
            if control is not None and detector.recognise(control) is not None:
                return None  # It answers every path this way.
            info: dict = {"id": detector.id, "name": detector.name, "version": recognised.version}
            if session.https:
                info["tls_trusted"] = session.tls_trusted
            return info
    except _NoAnswer:
        logger.debug("No answer from %s while identifying the emulator", base_url, exc_info=True)
    return None


def endpoint_base_url(url: str) -> str | None:
    """``scheme://host[:port][/path]`` without user info or a trailing slash; None unless HTTP(S)."""
    try:
        parts = urlsplit(url)
    except ValueError:  # e.g. an unclosed IPv6 bracket
        return None
    scheme = parts.scheme.lower()
    host = parts.netloc.rpartition("@")[2]
    if scheme not in ("http", "https") or not host:
        return None
    return f"{scheme}://{host}{parts.path.rstrip('/')}"


def _trust_plan(ep: EndpointInfo) -> ConnectionPlan | None:
    """The connection plan for ``ep``, for its TLS trust only.

    Planned with placeholder keys so AWS Emulator's credentials file is never
    read: identification sends no credentials, and has to work when that file
    can't be read. None when the emulator's files can't be looked at at all.
    """
    keyless = replace(
        ep,
        auth_type="credentials",
        auth_access_key_id=PLACEHOLDER_ACCESS_KEY_ID,
        auth_secret_access_key=PLACEHOLDER_SECRET_ACCESS_KEY,
    )
    try:
        return plan_connection(keyless)
    except AwsEmulatorFilesError:
        logger.debug("Identifying the emulator at %s without its files", ep.url, exc_info=True)
        return None


def _verified_context(plan: ConnectionPlan | None) -> ssl.SSLContext | None:
    """The TLS trust StackPort uses for the endpoint, or None when it can't be set up."""
    if plan is None:
        return None
    try:
        return ssl_context_for(plan)
    except OSError:  # a CA bundle that is missing, unreadable, or not PEM (ssl.SSLError)
        logger.debug("Can't load the CA bundle for %s", plan.endpoint_url, exc_info=True)
        return None


# Cached "not identified", told apart from a cache miss.
_UNIDENTIFIED = object()

# How long a route that must stay fast (GET /api/health, which Compose
# healthchecks call with a 3 s timeout) waits for a first identification.
# Emulators on this machine answer in milliseconds; a host that never answers
# would otherwise hold the route for the whole _TIME_BUDGET.
QUICK_WAIT = 0.5

_background: ThreadPoolExecutor | None = None
# Identifications waiting or running. Past this, new ones are skipped (the
# route just shows no emulator name) instead of queueing without end.
_MAX_IN_FLIGHT = 8
_in_flight: dict[str, Future] = {}
# Re-entrant: a detection that finishes before add_done_callback runs its
# callback right away, in the thread that still holds the lock.
_in_flight_lock = threading.RLock()


def _cache_key(ep: EndpointInfo, plan: ConnectionPlan | None) -> str:
    # A restarted AWS Emulator has a new certificate: its CA's stamp is part of the key.
    ca_stamp = plan.emulator_files.stamp[0] if plan is not None and plan.emulator_files is not None else None
    # Starts with the URL, like every per-endpoint entry, so editing the endpoint drops it.
    return f"{ep.url}:emulator:{ep.tls_verify}:{ep.ca_bundle}:{ca_stamp}"


def detect_emulator(ep: EndpointInfo, *, refresh: bool = False) -> dict | None:
    """Which emulator answers at ``ep``: ``{id, name, version}``, or None.

    HTTPS endpoints also get ``tls_trusted``: False when the emulator was only
    identified with certificate checks off, meaning StackPort's TLS settings for
    the endpoint don't accept its certificate.

    None for real AWS, and for an endpoint that doesn't answer or isn't
    recognised. Results are cached per URL and TLS settings, and dropped with the
    endpoint's other cache entries when it is edited; ``refresh`` looks again for
    an explicit connection check. Never raises.
    """
    if not is_local_endpoint(ep.url):
        return None
    base_url = endpoint_base_url(ep.url)
    if base_url is None:
        return None

    plan = _trust_plan(ep)
    key = _cache_key(ep, plan)
    if not refresh:
        cached = cache.get(key)
        if cached is not None:
            return None if cached is _UNIDENTIFIED else dict(cached)

    context = _verified_context(plan) if base_url.startswith("https://") else None
    try:
        info = _identify(base_url, context)
    except Exception:  # Naming the emulator is a courtesy: it must never fail the route showing it.
        logger.warning("Couldn't identify the emulator at %s", ep.url, exc_info=True)
        info = None
    if info is None:
        cache.set(key, _UNIDENTIFIED, ttl=_UNIDENTIFIED_TTL)
        return None
    cache.set(key, info, ttl=_IDENTIFIED_TTL)
    return dict(info)


def detect_emulator_quickly(ep: EndpointInfo, wait: float = QUICK_WAIT) -> dict | None:
    """``detect_emulator`` for routes that must answer fast.

    A cached result comes back at once. Otherwise the identification runs in the
    background (one at a time per endpoint, however many requests ask) and this
    waits at most ``wait`` seconds for it; a slower answer is cached for the next
    request. Never raises.
    """
    # Only saved endpoints: a URL passed straight in a request would let any
    # caller make StackPort send requests anywhere.
    if not ep.saved or not is_local_endpoint(ep.url) or endpoint_base_url(ep.url) is None:
        return None
    key = _cache_key(ep, _trust_plan(ep))
    cached = cache.get(key)
    if cached is not None:
        return None if cached is _UNIDENTIFIED else dict(cached)

    with _in_flight_lock:
        future = _in_flight.get(key)
        if future is None:
            if len(_in_flight) >= _MAX_IN_FLIGHT:
                return None
            future = _executor().submit(detect_emulator, ep, refresh=True)
            _in_flight[key] = future
            future.add_done_callback(lambda _done, key=key: _forget(key))
    try:
        return future.result(timeout=wait)
    except FutureTimeout:
        return None


def _forget(key: str) -> None:
    with _in_flight_lock:
        _in_flight.pop(key, None)


def _executor() -> ThreadPoolExecutor:
    """The background pool, created on first use (call with _in_flight_lock held)."""
    global _background
    if _background is None:
        _background = ThreadPoolExecutor(max_workers=2, thread_name_prefix="stackport-emulator-id")
    return _background


def shutdown() -> None:
    """Drop queued identifications and don't wait for running ones (app shutdown)."""
    global _background
    with _in_flight_lock:
        pool, _background = _background, None
        _in_flight.clear()
    if pool is not None:
        pool.shutdown(wait=False, cancel_futures=True)
