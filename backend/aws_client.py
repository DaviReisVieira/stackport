"""boto3 clients, cached per service and connection plan."""

from __future__ import annotations

import functools
import logging
import threading
from pathlib import Path

import boto3
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

# Last stat stamp seen per AWS Emulator files directory, to notice restarts.
_emulator_stamps: dict[Path, tuple] = {}
_emulator_stamps_lock = threading.Lock()


@functools.lru_cache(maxsize=256)
def _build_client(service_name: str, plan: ConnectionPlan):
    if plan.credential_source == "endpoint-profile":
        session = boto3.Session(profile_name=plan.profile, region_name=plan.region)
    else:
        session_kwargs: dict = {"region_name": plan.region}
        if plan.access_key_id is not None:
            session_kwargs["aws_access_key_id"] = plan.access_key_id
        if plan.secret_access_key is not None:
            session_kwargs["aws_secret_access_key"] = plan.secret_access_key
        if plan.session_token is not None:
            session_kwargs["aws_session_token"] = plan.session_token
        session = boto3.Session(**session_kwargs)

    client_kwargs: dict = {
        "service_name": service_name,
        "config": _LOCAL_ENDPOINT_CONFIG if plan.local_endpoint else _CLIENT_CONFIG,
    }
    if plan.endpoint_url is not None:
        client_kwargs["endpoint_url"] = plan.endpoint_url
    if plan.verify is not None:
        client_kwargs["verify"] = plan.verify
    return session.client(**client_kwargs)


def _note_emulator_restart(plan: ConnectionPlan) -> None:
    """Drop cached clients once an emulator's files change, so old keys don't linger.

    Correctness doesn't depend on this (the stamp is part of the cache key);
    it only frees clients built from a previous run, and logs the restart.
    """
    files = plan.emulator_files
    if files is None:
        return
    with _emulator_stamps_lock:
        previous = _emulator_stamps.get(files.directory)
        _emulator_stamps[files.directory] = files.stamp
    if previous is not None and previous != files.stamp:
        logger.info("AWS Emulator files in %s changed (emulator restarted); refreshing clients", files.directory)
        _build_client.cache_clear()


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

    Returns:
        Configured boto3 client. See backend.connection for how credentials
        and TLS trust are chosen.

    Raises:
        AwsEmulatorFilesError: AWS Emulator's credentials exist but can't be read.
    """
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
    return _build_client(service_name, plan)


def _cache_clear() -> None:
    _build_client.cache_clear()
    with _emulator_stamps_lock:
        _emulator_stamps.clear()


# Kept from when get_client itself was the lru_cache: endpoint routes and tests call these.
get_client.cache_clear = _cache_clear  # type: ignore[attr-defined]
get_client.cache_info = _build_client.cache_info  # type: ignore[attr-defined]
