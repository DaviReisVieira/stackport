"""boto3 clients, cached per service and connection plan.

A boto3 session keeps every service model and botocore's endpoint data once it
has loaded them, which is most of what a client weighs. ``get_client`` builds
clients with the same credentials and region from one shared session, so those
are loaded once for all of them instead of once per client.
"""

from __future__ import annotations

import functools
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

import boto3
from botocore.client import BaseClient
from botocore.config import Config

from backend.config import STACKPORT_PROBE_TIMEOUT, endpoint_store
from backend.connection import ConnectionPlan, EndpointInfo, plan_connection

logger = logging.getLogger(__name__)

_UNSET = object()

# Every client goes to the endpoint's URL, or to AWS when it has none. boto3
# would otherwise take an endpoint from AWS_ENDPOINT_URL_<SERVICE> or from a
# profile's endpoint_url or services section in ~/.aws/config, and send some of
# a real-AWS endpoint's calls somewhere else. A profile still gives credentials.
_CLIENT_CONFIG = Config(ignore_configured_endpoint_urls=True)

# Client options for local emulators (custom endpoints that aren't *.amazonaws.com):
# - Emulators serve every service on one host, so host prefixes such as Step
#   Functions' "sync-" or Cloud Map's "data-" point at hosts that don't exist.
#   Real AWS needs them, so only local endpoints turn them off.
# - botocore's default of 60 s to connect plus up to 5 attempts with backoff
#   turns a stopped emulator into a 10 s wait per call, and the dashboard probes
#   dozens of services. Locally nothing is throttled, a refused connection or a
#   rejected certificate won't fix itself on retry, and the UI polls again in
#   seconds, so fail fast instead. STACKPORT_PROBE_TIMEOUT bounds the connect.
# - Flexible checksums (CRC32 on uploads, checked on downloads) only where an API
#   requires them, as before botocore 1.36. Emulators keep them unevenly: moto
#   returns a multipart object's checksum of part checksums as if it covered the
#   whole object, so a download of it failed its check. Without asking for them,
#   StackPort's multipart uploads don't leave such objects behind for other
#   clients either.
_LOCAL_ENDPOINT_CONFIG = _CLIENT_CONFIG.merge(
    Config(
        inject_host_prefix=False,
        connect_timeout=STACKPORT_PROBE_TIMEOUT,
        retries={"mode": "standard", "total_max_attempts": 1},
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
    )
)

# get_client's clients, least recently used dropped first: one per registry
# service and endpoint in use, plus the few other services routes call. From a
# shared session a client adds well under 1 MB, so this holds about nine
# endpoints' worth. Probing more endpoints than fit, in turn, would rebuild
# every client on every round.
_MAX_CLIENTS = 512
# get_isolated_client's clients. Each has a session of its own (about 8 MB).
_MAX_ISOLATED_CLIENTS = 16

# Last stat stamp seen per AWS Emulator files directory, to notice restarts.
_emulator_stamps: dict[Path, tuple] = {}
_emulator_stamps_lock = threading.Lock()


@dataclass(frozen=True)
class _SessionSettings:
    """What a boto3 session is built from: a plan's credentials and its region.

    Plans that differ only in endpoint URL, TLS trust or client options share
    a session. The region belongs here too: the clients botocore creates to
    fetch credentials (STS for an assumed role) use the session's region.
    """

    region: str
    # Set only for an endpoint's own profile; the keys are then None.
    profile: str | None
    access_key_id: str | None = field(repr=False)
    secret_access_key: str | None = field(repr=False)
    session_token: str | None = field(repr=False)

    @classmethod
    def of(cls, plan: ConnectionPlan) -> _SessionSettings:
        return cls(plan.region, plan.profile, plan.access_key_id, plan.secret_access_key, plan.session_token)

    def new_session(self) -> boto3.Session:
        if self.profile is not None:
            return boto3.Session(profile_name=self.profile, region_name=self.region)
        # Keys left as None fall through to boto3's default credential chain.
        return boto3.Session(
            region_name=self.region,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            aws_session_token=self.session_token,
        )


def _new_client(
    session: boto3.Session, service_name: str, plan: ConnectionPlan, client_config: Config | None = None
) -> BaseClient:
    config = _LOCAL_ENDPOINT_CONFIG if plan.local_endpoint else _CLIENT_CONFIG
    client_kwargs: dict = {
        "service_name": service_name,
        "config": config.merge(client_config) if client_config is not None else config,
    }
    if plan.endpoint_url is not None:
        client_kwargs["endpoint_url"] = plan.endpoint_url
    if plan.verify is not None:
        client_kwargs["verify"] = plan.verify
    return session.client(**client_kwargs)


class _SharedSession:
    """One credential set's boto3 session, and the lock clients are built under.

    ``Session.client()`` isn't thread-safe, and the probes build clients from a
    thread pool. Calls made with the clients don't take the lock.
    """

    def __init__(self, settings: _SessionSettings):
        self.settings = settings
        self.lock = threading.Lock()
        self._session: boto3.Session | None = None

    def new_client(self, service_name: str, plan: ConnectionPlan, client_config: Config | None = None) -> BaseClient:
        """Build a client. The caller holds ``lock``."""
        session = self._session if self._session is not None else self.settings.new_session()
        client = _new_client(session, service_name, plan, client_config)
        # Kept once it has built a client: a session keeps the config it read,
        # so one whose first client failed (an assumed role whose source profile
        # isn't in ~/.aws/config yet) would fail until the cache is cleared.
        self._session = session
        return client


class CacheInfo(NamedTuple):
    """What ``get_client.cache_info()`` returns."""

    maxsize: int
    currsize: int


class _SharedSessionClients:
    """Clients per (service, plan, client config), built from one ``_SharedSession`` per credential set.

    Keeps the ``maxsize`` most recently used clients. Sessions stay until
    ``clear``: there is one per credential set and region in use (saved
    endpoints, the environment's keys, a running AWS Emulator's keys), and a
    client rebuilt after it was dropped reuses the models its session holds.
    Each client is built once, even when many threads ask for it together.
    """

    def __init__(self, maxsize: int):
        self.maxsize = maxsize
        self._lock = threading.Lock()
        self._clients: OrderedDict[tuple[str, ConnectionPlan, Config | None], BaseClient] = OrderedDict()
        self._sessions: dict[_SessionSettings, _SharedSession] = {}
        # Bumped by clear(), so a client built from a session it dropped isn't cached.
        self._generation = 0

    def get(self, service_name: str, plan: ConnectionPlan, client_config: Config | None = None) -> BaseClient:
        key = (service_name, plan, client_config)
        with self._lock:
            client = self._cached(key)
            if client is not None:
                return client
            settings = _SessionSettings.of(plan)
            shared = self._sessions.get(settings)
            if shared is None:
                shared = self._sessions[settings] = _SharedSession(settings)
            generation = self._generation
        with shared.lock:
            with self._lock:
                # Another thread may have built it while this one waited for the lock.
                client = self._cached(key)
            if client is not None:
                return client
            client = shared.new_client(service_name, plan, client_config)
            with self._lock:
                if generation == self._generation:
                    self._clients[key] = client
                    if len(self._clients) > self.maxsize:
                        self._clients.popitem(last=False)
        return client

    def _cached(self, key: tuple[str, ConnectionPlan, Config | None]) -> BaseClient | None:
        client = self._clients.get(key)
        if client is not None:
            self._clients.move_to_end(key)
        return client

    def clear(self) -> None:
        with self._lock:
            self._clients.clear()
            self._sessions.clear()
            self._generation += 1

    def info(self) -> CacheInfo:
        with self._lock:
            return CacheInfo(self.maxsize, len(self._clients))


_shared_clients = _SharedSessionClients(_MAX_CLIENTS)


@functools.lru_cache(maxsize=_MAX_ISOLATED_CLIENTS)
def _build_isolated_client(service_name: str, plan: ConnectionPlan) -> BaseClient:
    return _new_client(_SessionSettings.of(plan).new_session(), service_name, plan)


def _clear_clients() -> None:
    _shared_clients.clear()
    _build_isolated_client.cache_clear()


def _note_emulator_restart(plan: ConnectionPlan) -> None:
    """Drop cached clients and sessions once an emulator's files change, so old keys don't linger.

    Correctness doesn't depend on this (the stamp is part of the cache key);
    it only frees the clients and sessions of a previous run, and logs the restart.
    """
    files = plan.emulator_files
    if files is None:
        return
    with _emulator_stamps_lock:
        previous = _emulator_stamps.get(files.directory)
        _emulator_stamps[files.directory] = files.stamp
    if previous is not None and previous != files.stamp:
        logger.info("AWS Emulator files in %s changed (emulator restarted); refreshing clients", files.directory)
        _clear_clients()


def _plan(
    *,
    endpoint_url: str | None,
    region: str | None,
    auth_type: str,
    auth_profile: str | None,
    auth_access_key_id: str | None,
    auth_secret_access_key: str | None,
    tls_verify: bool,
    ca_bundle: str | None,
) -> ConnectionPlan:
    url = endpoint_store.get_default_url() if endpoint_url is _UNSET else endpoint_url
    plan = plan_connection(
        EndpointInfo(
            url=url,
            region=region,
            auth_type=auth_type,
            auth_profile=auth_profile,
            auth_access_key_id=auth_access_key_id,
            auth_secret_access_key=auth_secret_access_key,
            tls_verify=tls_verify,
            ca_bundle=ca_bundle,
        )
    )
    _note_emulator_restart(plan)
    return plan


def get_client(
    service_name: str,
    endpoint_url: str | None = _UNSET,
    region: str | None = None,
    auth_type: str = "default",
    auth_profile: str | None = None,
    auth_access_key_id: str | None = None,
    auth_secret_access_key: str | None = None,
    tls_verify: bool = True,
    ca_bundle: str | None = None,
    client_config: Config | None = None,
):
    """Return a boto3 client for the given service and endpoint.

    Args:
        service_name: AWS service name (e.g., "s3", "dynamodb")
        endpoint_url: Endpoint URL. None means real AWS (no custom endpoint).
                     Omitted (sentinel) means use default endpoint.
        region: Per-endpoint region override. None means use global AWS_REGION.
        auth_type: "default", "profile", or "credentials"
        auth_profile: AWS profile name (for auth_type="profile")
        auth_access_key_id: Access key (for auth_type="credentials")
        auth_secret_access_key: Secret key (for auth_type="credentials")
        tls_verify: False turns certificate verification off for this endpoint
        ca_bundle: Path of a CA bundle to trust for this endpoint
        client_config: Options for one kind of call, applied over the defaults (and over
                     the local-emulator options). Clients are cached per config object,
                     so pass a module-level constant, not a new Config per request.

    Returns:
        Configured boto3 client, built from the session shared by every client
        with the same credentials and region. See backend.connection for how
        credentials and TLS trust are chosen.

    Raises:
        AwsEmulatorFilesError: AWS Emulator's credentials exist but can't be read.
    """
    plan = _plan(
        endpoint_url=endpoint_url,
        region=region,
        auth_type=auth_type,
        auth_profile=auth_profile,
        auth_access_key_id=auth_access_key_id,
        auth_secret_access_key=auth_secret_access_key,
        tls_verify=tls_verify,
        ca_bundle=ca_bundle,
    )
    return _shared_clients.get(service_name, plan, client_config)


def get_isolated_client(
    service_name: str,
    endpoint_url: str | None = _UNSET,
    region: str | None = None,
    auth_type: str = "default",
    auth_profile: str | None = None,
    auth_access_key_id: str | None = None,
    auth_secret_access_key: str | None = None,
    tls_verify: bool = True,
    ca_bundle: str | None = None,
):
    """Return a client like ``get_client``, built from a session of its own.

    For callers that can reach any of botocore's services rather than the
    registry's. A shared session keeps every model it loads until the cache is
    cleared, so browsing hundreds of services through ``get_client`` would grow
    it for good. These clients are kept only while they are among the
    ``_MAX_ISOLATED_CLIENTS`` most recently used, and their memory goes with them.

    Arguments, credentials and TLS trust are as for ``get_client``.
    """
    plan = _plan(
        endpoint_url=endpoint_url,
        region=region,
        auth_type=auth_type,
        auth_profile=auth_profile,
        auth_access_key_id=auth_access_key_id,
        auth_secret_access_key=auth_secret_access_key,
        tls_verify=tls_verify,
        ca_bundle=ca_bundle,
    )
    return _build_isolated_client(service_name, plan)


def _cache_clear() -> None:
    _clear_clients()
    with _emulator_stamps_lock:
        _emulator_stamps.clear()


# Kept from when get_client itself was the lru_cache: endpoint routes and tests call
# these. Clearing drops every cached client and session, get_isolated_client's too.
get_client.cache_clear = _cache_clear  # type: ignore[attr-defined]
get_client.cache_info = _shared_clients.info  # type: ignore[attr-defined]
