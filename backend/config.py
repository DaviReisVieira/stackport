import logging
import os
from collections.abc import Mapping

logger = logging.getLogger(__name__)

AWS_ENDPOINT_URL: str | None = os.environ.get("AWS_ENDPOINT_URL")  # None = real AWS
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID: str | None = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY: str | None = os.environ.get("AWS_SECRET_ACCESS_KEY")
STACKPORT_ALLOW_WRITES: bool = os.environ.get("STACKPORT_ALLOW_WRITES", "").lower() in ("1", "true", "yes")
STACKPORT_PORT: int = int(os.environ.get("STACKPORT_PORT", "8080"))
STACKPORT_SERVICES: str = os.environ.get(
    "STACKPORT_SERVICES",
    "s3,sqs,sns,dynamodb,lambda,iam,logs,ssm,secretsmanager,kinesis,events,ec2,"
    "route53,kms,cloudformation,stepfunctions,rds,ecs,monitoring,ses,acm,wafv2,"
    "ecr,elasticache,glue,athena,apigateway,firehose,cognito-idp,cognito-identity,"
    "elasticmapreduce,elasticloadbalancing,elasticfilesystem,cloudfront,appsync",
)
LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()

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
            endpoints[name.strip()] = url.strip()
    return endpoints


ENDPOINTS: dict[str, str | None] = _parse_endpoints()
DEFAULT_ENDPOINT: str | None = next(iter(ENDPOINTS.values()))


def is_local_endpoint(endpoint_url: str | None = None) -> bool:
    """Return True when targeting a local emulator (LocalStack, MiniStack, Moto, MinIO, etc.).

    Logic: a custom endpoint that is NOT an amazonaws.com domain is assumed to be
    a local emulator.  This covers localhost, 127.0.0.1, 0.0.0.0, Docker service
    names (localstack, minio, moto, …), and .local TLDs.
    """
    url = endpoint_url if endpoint_url is not None else DEFAULT_ENDPOINT
    if url is None:
        return False
    return ".amazonaws.com" not in url
