"""Pydantic schemas for the Activity page: CloudTrail's LookupEvents."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

# LookupEvents answers at most 50 events a call.
MAX_PAGE_SIZE = 50
# The longest AttributeValue the API takes.
MAX_ATTRIBUTE_VALUE = 2000


class LookupAttribute(str, Enum):
    """What LookupEvents filters on. A call takes one of them, not a combination."""

    EVENT_ID = "EventId"
    EVENT_NAME = "EventName"
    READ_ONLY = "ReadOnly"
    USERNAME = "Username"
    RESOURCE_TYPE = "ResourceType"
    RESOURCE_NAME = "ResourceName"
    EVENT_SOURCE = "EventSource"
    ACCESS_KEY_ID = "AccessKeyId"


class ActivityQuery(BaseModel):
    """Query parameters of ``GET /api/activity/events``.

    A next page is asked for with the same window and attribute as the first,
    plus its ``next_token``: CloudTrail ties the token to them.
    """

    start_time: datetime | None = None
    end_time: datetime | None = None
    attribute: LookupAttribute | None = None
    value: str | None = Field(None, min_length=1, max_length=MAX_ATTRIBUTE_VALUE)
    next_token: str | None = None
    max_results: int = Field(MAX_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE)

    @field_validator("start_time", "end_time")
    @classmethod
    def _utc_to_the_second(cls, moment: datetime | None) -> datetime | None:
        """In UTC, to the second: botocore sends LookupEvents' times as whole seconds.

        The page echoes the window it used for the next page to send again, and a
        token only continues a lookup with the same parameters, so the echo has to
        be what went out. A time without a zone is taken as UTC.
        """
        if moment is None:
            return None
        aware = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).replace(microsecond=0)

    @model_validator(mode="after")
    def _consistent(self) -> "ActivityQuery":
        if self.start_time and self.end_time and self.start_time > self.end_time:
            raise ValueError("start_time is after end_time")
        if (self.attribute is None) != (self.value is None):
            raise ValueError("attribute and value go together: give both or neither")
        if self.attribute is LookupAttribute.READ_ONLY and self.value not in ("true", "false"):
            raise ValueError("ReadOnly is looked up as true or false")
        return self


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ActivityResource(_CamelModel):
    type: str | None = None
    name: str | None = None


class ActivityEvent(_CamelModel):
    """One event, with what the console shows of its CloudTrail record lifted out of it."""

    event_id: str
    event_name: str
    event_source: str
    event_time: datetime | None = None
    username: str | None = None
    access_key_id: str | None = None
    read_only: bool | None = None
    resources: list[ActivityResource] = []
    error_code: str | None = None
    error_message: str | None = None
    source_ip_address: str | None = None
    user_agent: str | None = None
    aws_region: str | None = None
    # CloudTrailEvent, parsed. When it isn't a JSON object, the string as sent is
    # in raw_record instead, so nothing the endpoint answered is lost.
    record: dict[str, Any] | None = None
    raw_record: str | None = None


class ActivityPage(_CamelModel):
    events: list[ActivityEvent]
    next_token: str | None = None
    # The window the lookup used, for asking for the next page with the same one.
    start_time: datetime
    end_time: datetime | None = None
