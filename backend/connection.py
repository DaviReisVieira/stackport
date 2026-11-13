"""How StackPort connects to an endpoint: credentials, TLS trust, and client options.

``EndpointInfo`` is what a request (or the probe loop, or the CLI) knows about
the endpoint it targets. ``plan_connection`` turns it into a ``ConnectionPlan``,
the single place where the precedence rules live:

Credentials, most specific first:

1. the endpoint's own auth (a profile, or an access key pair);
2. AWS Emulator's ``emulator_credentials`` for this endpoint, when present;
3. ``AWS_ACCESS_KEY_ID`` / ``AWS_SECRET_ACCESS_KEY`` from StackPort's environment,
   with ``AWS_SESSION_TOKEN`` when it is set (temporary credentials). The token
   belongs to that pair only: no other source below or above ever gets it;
4. placeholder keys when AWS Emulator's folder exists without keys (it runs
   with ``--auth off``, or it is stopped), so the default chain never sends the
   access key ID of a real account to it, and a stopped emulator shows up as
   unreachable rather than as missing credentials;
5. boto3's default credential chain.

TLS trust, most specific first:

1. the endpoint's CA bundle;
2. verification turned off for the endpoint;
3. AWS Emulator's ``ca.pem`` for this endpoint, when present;
4. boto3's default, which honours ``AWS_CA_BUNDLE``.

Both are per endpoint on purpose: ``AWS_CA_BUNDLE`` replaces the system trust
store, so setting it globally breaks a real-AWS endpoint configured next to an
emulator.

A plan is hashable and carries the emulator files' stat stamp, so
``aws_client`` can cache clients on it and still notice an emulator restart.
"""

from __future__ import annotations

import os
import ssl
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from urllib3.exceptions import LocationParseError
from urllib3.util import parse_url

from backend import aws_emulator
from backend.config import AWS_ACCESS_KEY_ID, AWS_REGION, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, is_local_endpoint

CredentialSource = Literal[
    "endpoint-profile",
    "endpoint-keys",
    "aws-emulator",
    "environment",
    "placeholder",
    "default-chain",
]
TrustSource = Literal["endpoint", "disabled", "aws-emulator", "environment", "system"]

# Any non-empty pair works against an emulator that runs with --auth off.
PLACEHOLDER_ACCESS_KEY_ID = "stackport"
PLACEHOLDER_SECRET_ACCESS_KEY = "stackport"


@dataclass(frozen=True)
class EndpointInfo:
    """Resolved endpoint URL, region, auth, and TLS configuration."""

    url: str | None
    region: str | None
    auth_type: str = "default"
    auth_profile: str | None = None
    auth_access_key_id: str | None = None
    auth_secret_access_key: str | None = field(default=None, repr=False)
    tls_verify: bool = True
    ca_bundle: str | None = None
    # Saved in StackPort (env or Settings), as opposed to a URL passed directly in
    # a request. Some things StackPort only does for endpoints someone set up.
    saved: bool = field(default=False, compare=False)

    @classmethod
    def from_entry(cls, entry: dict) -> EndpointInfo:
        """Build from an endpoint store entry, tolerating entries saved by older versions."""
        return cls(
            url=entry.get("url"),
            region=entry.get("region"),
            auth_type=entry.get("auth_type") or "default",
            auth_profile=entry.get("auth_profile"),
            auth_access_key_id=entry.get("auth_access_key_id"),
            auth_secret_access_key=entry.get("auth_secret_access_key"),
            tls_verify=entry.get("tls_verify", True) is not False,
            ca_bundle=entry.get("ca_bundle") or None,
            saved=True,
        )

    def cache_scope(self) -> str:
        """Prefix for cache keys holding this endpoint's results.

        Two saved endpoints can share a URL with different auth or TLS settings,
        so all of them are in it (never the secret key). It starts with the URL,
        so editing an endpoint, which drops ``"<url>:"`` keys, drops these too.
        """
        return ":".join(
            str(part)
            for part in (
                self.url, self.region, self.auth_type, self.auth_profile,
                self.auth_access_key_id, self.tls_verify, self.ca_bundle,
            )
        )

    def client_kwargs(self) -> dict:
        """Return kwargs to pass to get_client beyond service_name."""
        return {
            "endpoint_url": self.url,
            "region": self.region,
            "auth_type": self.auth_type,
            "auth_profile": self.auth_profile,
            "auth_access_key_id": self.auth_access_key_id,
            "auth_secret_access_key": self.auth_secret_access_key,
            "tls_verify": self.tls_verify,
            "ca_bundle": self.ca_bundle,
        }


@dataclass(frozen=True)
class ConnectionPlan:
    """Everything needed to build a boto3 client for one endpoint. Hashable."""

    endpoint_url: str | None
    region: str
    credential_source: CredentialSource
    trust_source: TrustSource
    profile: str | None = None
    access_key_id: str | None = field(default=None, repr=False)
    secret_access_key: str | None = field(default=None, repr=False)
    session_token: str | None = field(default=None, repr=False)
    # None leaves verification to botocore (system trust, or AWS_CA_BUNDLE).
    verify: bool | str | None = None
    # A local emulator rather than AWS: see aws_client._build_client for what changes.
    local_endpoint: bool = False
    emulator_files: aws_emulator.EmulatorFiles | None = None


class InvalidEndpointUrl(ValueError):
    """An endpoint URL StackPort refuses to use."""


def is_direct_endpoint_url(value: str | None) -> bool:
    """True when an endpoint reference is a URL rather than a saved endpoint's name.

    The scheme is case-insensitive (``HTTP://host`` is a URL); whether the URL
    is acceptable is ``check_endpoint_url``'s call.
    """
    return value is not None and value.lower().startswith(("http://", "https://"))


def check_endpoint_url(url: str) -> str:
    """Return ``url`` if it is a plain http(s) URL every parser reads the same way.

    Endpoint URLs can come from requests (``?endpoint=``, the Settings form).
    Python's ``urlsplit`` and urllib3, which botocore sends requests with,
    disagree on some inputs: ``http://a\\@b`` is host ``b`` to the first and
    host ``a`` to the second. StackPort makes decisions with one and connects
    with the other (which emulator files to use, which code location to
    fetch), so a URL they don't agree on is refused rather than guessed.

    Raises:
        InvalidEndpointUrl: with a sentence saying what's wrong.
    """
    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in url):
        raise InvalidEndpointUrl("The endpoint URL can't contain spaces or control characters.")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise InvalidEndpointUrl(f"The endpoint URL isn't valid: {exc}.") from exc
    if parts.scheme not in ("http", "https"):
        raise InvalidEndpointUrl("The endpoint URL must start with http:// or https://.")
    if not parts.hostname:
        raise InvalidEndpointUrl("The endpoint URL needs a host name.")
    if "@" in parts.netloc or "\\" in parts.netloc:
        raise InvalidEndpointUrl("The endpoint URL can't contain credentials or a backslash before the path.")
    if "%" in parts.netloc:
        # urllib decodes it ("localhost%3a6379" is port 6379 to it, port 80 to urlsplit).
        raise InvalidEndpointUrl("The endpoint URL's host can't contain percent-encoding.")
    if port == 0:
        raise InvalidEndpointUrl("The endpoint URL's port can't be 0.")
    try:
        transport = parse_url(url)
    except LocationParseError as exc:
        raise InvalidEndpointUrl(f"The endpoint URL isn't valid: {exc}.") from exc
    if (transport.host or "").strip("[]").lower() != parts.hostname.lower() or transport.port != port:
        raise InvalidEndpointUrl("The endpoint URL is ambiguous: its host could be read in more than one way.")
    return url


def expand_ca_bundle(path: str) -> str:
    """Expand ``~`` and environment variables in a CA bundle path."""
    return os.path.expandvars(os.path.expanduser(path.strip()))


def plan_connection(ep: EndpointInfo) -> ConnectionPlan:
    """Apply the precedence rules in this module's docstring to one endpoint.

    Raises:
        AwsEmulatorFilesError: the emulator's credentials exist but can't be read.
    """
    has_own_credentials = (ep.auth_type == "profile" and bool(ep.auth_profile)) or (
        ep.auth_type == "credentials" and bool(ep.auth_access_key_id) and bool(ep.auth_secret_access_key)
    )
    has_own_trust = bool(ep.ca_bundle) or not ep.tls_verify
    # Only look for AWS Emulator's files when a fallback could use them, so an
    # unreadable folder never gets in the way of an endpoint configured in full.
    files = aws_emulator.discover(ep.url) if ep.url and not (has_own_credentials and has_own_trust) else None

    # Credentials
    profile = key = secret = token = None
    source: CredentialSource
    if ep.auth_type == "profile" and ep.auth_profile:
        source, profile = "endpoint-profile", ep.auth_profile
    elif ep.auth_type == "credentials" and ep.auth_access_key_id and ep.auth_secret_access_key:
        source, key, secret = "endpoint-keys", ep.auth_access_key_id, ep.auth_secret_access_key
    elif files is not None and files.credentials is not None:
        key, secret = aws_emulator.read_credentials(files.credentials, files.stamp[1])
        source = "aws-emulator"
    elif AWS_ACCESS_KEY_ID is not None or AWS_SECRET_ACCESS_KEY is not None:
        source, key, secret, token = "environment", AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
    elif files is not None:
        source, key, secret = "placeholder", PLACEHOLDER_ACCESS_KEY_ID, PLACEHOLDER_SECRET_ACCESS_KEY
    else:
        source = "default-chain"

    # TLS trust
    verify: bool | str | None
    trust: TrustSource
    if ep.ca_bundle:
        verify, trust = expand_ca_bundle(ep.ca_bundle), "endpoint"
    elif not ep.tls_verify:
        verify, trust = False, "disabled"
    elif files is not None and files.ca_bundle is not None:
        verify, trust = str(files.ca_bundle), "aws-emulator"
    elif os.environ.get("AWS_CA_BUNDLE"):
        verify, trust = None, "environment"
    else:
        verify, trust = None, "system"

    return ConnectionPlan(
        endpoint_url=ep.url,
        region=ep.region or AWS_REGION,
        credential_source=source,
        trust_source=trust,
        profile=profile,
        access_key_id=key,
        secret_access_key=secret,
        session_token=token,
        verify=verify,
        local_endpoint=is_local_endpoint(ep.url),
        emulator_files=files,
    )


def describe_connection(plan: ConnectionPlan) -> dict:
    """Summarise a plan for the UI. Never includes key material."""
    files = plan.emulator_files
    return {
        "credentials_source": plan.credential_source,
        "tls_trust_source": plan.trust_source,
        "ca_bundle": (
            aws_emulator.display_path(Path(plan.verify)) if isinstance(plan.verify, str) else None
        ),
        "aws_emulator_dir": aws_emulator.display_path(files.directory) if files else None,
        # Where StackPort looks for AWS Emulator's files for this endpoint, found
        # or not, so the UI can say where to put them. None when the URL can't be
        # an AWS Emulator (not https on a loopback host with a port) or the lookup is off.
        "aws_emulator_lookup_dir": _lookup_dir(plan.endpoint_url),
    }


def _lookup_dir(endpoint_url: str | None) -> str | None:
    directory = aws_emulator.files_dir_for(endpoint_url)
    return aws_emulator.display_path(directory) if directory is not None else None


def ssl_context_for(plan: ConnectionPlan) -> ssl.SSLContext:
    """An ``ssl`` context that trusts what boto3 would trust for this plan.

    For the few plain HTTP requests StackPort makes on behalf of an endpoint
    (fetching a pre-signed URL it returned, identifying the emulator).
    """
    if plan.verify is False:
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    if isinstance(plan.verify, str):
        return ssl.create_default_context(cafile=plan.verify)
    env_bundle = os.environ.get("AWS_CA_BUNDLE")
    if env_bundle:
        return ssl.create_default_context(cafile=expand_ca_bundle(env_bundle))
    return ssl.create_default_context()
