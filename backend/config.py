import logging
import os
from collections.abc import Mapping
from pathlib import Path

logger = logging.getLogger(__name__)

def _parse_aws_endpoint_url(environ: Mapping[str, str]) -> str | None:
    """None means real AWS. Empty counts as unset (``AWS_ENDPOINT_URL=${AWS_ENDPOINT_URL}`` in Compose)."""
    return environ.get("AWS_ENDPOINT_URL") or None


def _parse_aws_credential(environ: Mapping[str, str], name: str) -> str | None:
    """An access key, secret key or session token. Empty counts as unset (``AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}`` in Compose)."""
    return environ.get(name, "").strip() or None


AWS_ENDPOINT_URL: str | None = _parse_aws_endpoint_url(os.environ)

# Remove AWS_ENDPOINT_URL from the process environment so boto3's internal
# credential resolution (SSO, AssumeRole) doesn't route to a local emulator.
# StackPort's own clients ignore it anyway (see aws_client); the clients boto3
# creates to fetch credentials don't.
if "AWS_ENDPOINT_URL" in os.environ:
    del os.environ["AWS_ENDPOINT_URL"]
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID: str | None = _parse_aws_credential(os.environ, "AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY: str | None = _parse_aws_credential(os.environ, "AWS_SECRET_ACCESS_KEY")
# Belongs to the two keys above (SSO exports, assumed roles). Read once at start-up.
AWS_SESSION_TOKEN: str | None = _parse_aws_credential(os.environ, "AWS_SESSION_TOKEN")
STACKPORT_ALLOW_WRITES: bool = os.environ.get("STACKPORT_ALLOW_WRITES", "true").lower() in ("1", "true", "yes")
STACKPORT_PORT: int = int(os.environ.get("STACKPORT_PORT", "8080"))
# Interface the server listens on. Loopback by default: StackPort has no login
# and can change any endpoint it has saved, so it isn't offered to the network
# unless asked. The Docker image sets 0.0.0.0, which a container needs for its
# port to be published (publish it on 127.0.0.1 to keep it on this machine).
STACKPORT_HOST: str = os.environ.get("STACKPORT_HOST", "").strip() or "127.0.0.1"
# Guided tutorials. Set to false to drop the Learn routes and every trace of
# the tutorial UI, for anyone who wants StackPort as a resource browser only.
STACKPORT_LEARN: bool = os.environ.get("STACKPORT_LEARN", "true").lower() in ("1", "true", "yes")
STACKPORT_SERVICES: str = os.environ.get(
    "STACKPORT_SERVICES",
    "s3,sqs,sns,dynamodb,lambda,iam,logs,ssm,secretsmanager,kinesis,events,ec2,"
    "route53,kms,cloudformation,stepfunctions,rds,ecs,monitoring,ses,acm,wafv2,"
    "ecr,elasticache,glue,athena,apigateway,firehose,cognito-idp,cognito-identity,"
    "elasticmapreduce,elasticloadbalancing,elasticfilesystem,cloudfront,appsync",
)
LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()

# Origins allowed to call the API from another site (comma-separated). Empty by
# default: the UI is served by StackPort itself, so it never needs CORS, and
# allowing every origin would let any web page drive the API of a local
# StackPort. WebSocket connections follow the same rule (see backend/origins.py).
def _parse_cors_origins(environ: Mapping[str, str]) -> list[str]:
    raw = environ.get("STACKPORT_CORS_ORIGINS", "")
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


STACKPORT_CORS_ORIGINS: list[str] = _parse_cors_origins(os.environ)


def _parse_allowed_hosts(environ: Mapping[str, str]) -> list[str]:
    raw = environ.get("STACKPORT_ALLOWED_HOSTS", "")
    return [host.strip().lower().rstrip(".") for host in raw.split(",") if host.strip()]


# Host names StackPort answers to besides localhost and IP addresses
# (comma-separated; "*" accepts any). For reverse proxies, Codespaces-style
# forwarded URLs, or a machine name on the LAN. See backend/origins.py.
STACKPORT_ALLOWED_HOSTS: list[str] = _parse_allowed_hosts(os.environ)

# Probe and cache configuration
STACKPORT_PROBE_TIMEOUT: int = int(os.environ.get("STACKPORT_PROBE_TIMEOUT", "5"))
STACKPORT_CACHE_TTL: int = int(os.environ.get("STACKPORT_CACHE_TTL", "5"))
STACKPORT_PROBE_WORKERS: int = int(os.environ.get("STACKPORT_PROBE_WORKERS", "10"))

_MIB: int = 1024 * 1024

# Default max upload: 100 MiB (whole mebibytes; STACKPORT_S3_MAX_UPLOAD_MB).
_DEFAULT_S3_MAX_UPLOAD_MB: int = 100
_DEFAULT_S3_MAX_UPLOAD_BYTES: int = _DEFAULT_S3_MAX_UPLOAD_MB * _MIB


def _parse_s3_max_upload_bytes_from_env(environ: Mapping[str, str]) -> int:
    """Resolve max single-object upload size for the S3 write API.

    Uses ``STACKPORT_S3_MAX_UPLOAD_MB`` only: positive integer **mebibytes** (MiB,
    × 1024²). When unset or empty, default is 100 MiB.
    """
    raw_mb = environ.get("STACKPORT_S3_MAX_UPLOAD_MB")
    if raw_mb is None or not str(raw_mb).strip():
        return _DEFAULT_S3_MAX_UPLOAD_BYTES
    try:
        mb = int(str(raw_mb).strip(), 10)
    except ValueError:
        logger.warning(
            "Invalid STACKPORT_S3_MAX_UPLOAD_MB %r; using default %s MiB",
            raw_mb,
            _DEFAULT_S3_MAX_UPLOAD_MB,
        )
        return _DEFAULT_S3_MAX_UPLOAD_BYTES
    if mb <= 0:
        logger.warning(
            "STACKPORT_S3_MAX_UPLOAD_MB must be positive; using default %s MiB",
            _DEFAULT_S3_MAX_UPLOAD_MB,
        )
        return _DEFAULT_S3_MAX_UPLOAD_BYTES
    return mb * _MIB


def _parse_s3_max_upload_bytes() -> int:
    return _parse_s3_max_upload_bytes_from_env(os.environ)


# Max single-object upload size for S3 write API (configurable; default 100 MiB).
S3_MAX_UPLOAD_BYTES: int = _parse_s3_max_upload_bytes()


def _parse_endpoints() -> dict[str, str | None]:
    """Parse STACKPORT_ENDPOINTS env var into dict."""
    endpoints_str = os.environ.get("STACKPORT_ENDPOINTS", "")
    if not endpoints_str:
        # Backward compatibility: single endpoint (may be None for real AWS)
        return {"default": AWS_ENDPOINT_URL}

    endpoints: dict[str, str | None] = {}
    for pair in endpoints_str.split(","):
        if "=" in pair:
            name, url = pair.split("=", 1)
            url = url.strip()
            endpoints[name.strip()] = url if url else None
    return endpoints


ENDPOINTS: dict[str, str | None] = _parse_endpoints()
DEFAULT_ENDPOINT: str | None = next(iter(ENDPOINTS.values()))

# Data directory for persistent config (endpoints.json, etc.)
STACKPORT_DATA_DIR: Path = Path(os.environ.get("STACKPORT_DATA_DIR", Path.home() / ".stackport"))


def _parse_aws_emulator_dir(environ: Mapping[str, str]) -> Path | None:
    """Where AWS Emulator writes its per-port credentials and certificate.

    Unset means AWS Emulator's own default, ``~/.aws/emulator``. An empty value
    turns the lookup off.
    """
    raw = environ.get("STACKPORT_AWS_EMULATOR_DIR")
    if raw is None:
        return Path.home() / ".aws" / "emulator"
    raw = raw.strip()
    return Path(raw).expanduser() if raw else None


STACKPORT_AWS_EMULATOR_DIR: Path | None = _parse_aws_emulator_dir(os.environ)

# Initialize endpoint store
from backend.endpoint_store import EndpointStore

endpoint_store = EndpointStore(
    json_path=STACKPORT_DATA_DIR / "endpoints.json",
    env_endpoints=ENDPOINTS,
    env_urls_are_explicit=bool(os.environ.get("STACKPORT_ENDPOINTS")) or AWS_ENDPOINT_URL is not None,
)


_UNSET = object()


def is_local_endpoint(endpoint_url: str | None = _UNSET) -> bool:
    """Return True when targeting a local emulator (LocalStack, MiniStack, Moto, MinIO, etc.).

    Logic: a custom endpoint that is NOT an amazonaws.com domain is assumed to be
    a local emulator.  This covers localhost, 127.0.0.1, 0.0.0.0, Docker service
    names (localstack, minio, moto, …), and .local TLDs.

    None means real AWS (no custom endpoint) → returns False.
    Omitted means use DEFAULT_ENDPOINT.
    """
    url = DEFAULT_ENDPOINT if endpoint_url is _UNSET else endpoint_url
    if url is None:
        return False
    return ".amazonaws.com" not in url
