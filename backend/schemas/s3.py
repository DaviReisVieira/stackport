"""Pydantic schemas for S3 API requests."""

import re

from pydantic import BaseModel, Field, field_validator, model_validator


class DeleteBatchBody(BaseModel):
    """Delete by explicit keys or by prefix (recursive). Provide exactly one."""

    keys: list[str] | None = None
    prefix: str | None = None

    @model_validator(mode="after")
    def exactly_one_mode(self):
        has_keys = bool(self.keys)
        has_prefix = bool(self.prefix and self.prefix.strip())
        if has_keys == has_prefix:
            raise ValueError('Provide exactly one of non-empty "keys" or "prefix"')
        return self


class CreateFolderBody(BaseModel):
    prefix: str

    @model_validator(mode="after")
    def trailing_slash(self):
        if not self.prefix.endswith("/"):
            raise ValueError('Folder prefix must end with "/"')
        if ".." in self.prefix or self.prefix.startswith("/"):
            raise ValueError("Invalid prefix")
        return self


class PutVersioningBody(BaseModel):
    """Enable or suspend versioning."""

    status: str = Field(..., pattern="^(Enabled|Suspended)$")


class LifecycleRuleBody(BaseModel):
    """Single lifecycle rule for expiration."""

    model_config = {"populate_by_name": True}

    id: str = Field(..., alias="id")
    prefix: str = Field(default="", alias="prefix")
    expiration_days: int = Field(..., gt=0, alias="expirationDays")
    enabled: bool = Field(default=True, alias="enabled")


class PutLifecycleBody(BaseModel):
    """Set lifecycle configuration."""

    model_config = {"populate_by_name": True}

    rules: list[LifecycleRuleBody] = Field(..., alias="rules")


class NotificationConfigurationBody(BaseModel):
    """Single notification configuration."""

    model_config = {"populate_by_name": True}

    id: str = Field(..., alias="id")
    destination_type: str = Field(..., pattern="^(Lambda|SQS|SNS)$", alias="destinationType")
    destination_arn: str = Field(..., alias="destinationArn")
    events: list[str] = Field(..., min_length=1, alias="events")
    filter_prefix: str = Field(default="", alias="filterPrefix")
    filter_suffix: str = Field(default="", alias="filterSuffix")


class PutNotificationsBody(BaseModel):
    """Set notification configuration."""

    model_config = {"populate_by_name": True}

    configurations: list[NotificationConfigurationBody] = Field(default_factory=list, alias="configurations")


class PutBucketTagsBody(BaseModel):
    """Set bucket tags."""

    tags: dict[str, str]


class CORSRuleBody(BaseModel):
    """Single CORS rule."""

    model_config = {"populate_by_name": True}

    id: str | None = Field(default=None, alias="id")
    allowed_origins: list[str] = Field(..., min_length=1, alias="allowedOrigins")
    allowed_methods: list[str] = Field(..., min_length=1, alias="allowedMethods")
    allowed_headers: list[str] = Field(default_factory=list, alias="allowedHeaders")
    expose_headers: list[str] = Field(default_factory=list, alias="exposeHeaders")
    max_age_seconds: int | None = Field(default=None, ge=0, alias="maxAgeSeconds")


class PutCORSBody(BaseModel):
    """Set CORS configuration."""

    model_config = {"populate_by_name": True}

    rules: list[CORSRuleBody] = Field(..., alias="rules")

# S3 general purpose bucket naming rules.
# https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
_BUCKET_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
_BUCKET_IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_BUCKET_RESERVED_PREFIXES = ("xn--", "sthree-", "amzn-s3-demo-")
_BUCKET_RESERVED_SUFFIXES = ("-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3")


def validate_bucket_name(name: str) -> str:
    """Validate a name against the AWS general purpose bucket naming rules.

    Raises ValueError with the specific rule that failed, so the UI can show it.
    """
    if not 3 <= len(name) <= 63:
        raise ValueError("Bucket name must be between 3 and 63 characters long")
    if not _BUCKET_NAME_RE.match(name):
        raise ValueError(
            "Bucket name must use only lowercase letters, numbers, periods and hyphens, "
            "and must begin and end with a letter or number"
        )
    if ".." in name:
        raise ValueError("Bucket name must not contain two adjacent periods")
    if _BUCKET_IP_RE.match(name):
        raise ValueError("Bucket name must not be formatted as an IP address")
    for prefix in _BUCKET_RESERVED_PREFIXES:
        if name.startswith(prefix):
            raise ValueError(f"Bucket name must not start with the reserved prefix '{prefix}'")
    for suffix in _BUCKET_RESERVED_SUFFIXES:
        if name.endswith(suffix):
            raise ValueError(f"Bucket name must not end with the reserved suffix '{suffix}'")
    return name


class CreateBucketBody(BaseModel):
    """Create a general purpose bucket, optionally enabling versioning and tags."""

    model_config = {"populate_by_name": True}

    name: str
    region: str | None = None
    versioning: bool = False
    tags: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return validate_bucket_name(value)
