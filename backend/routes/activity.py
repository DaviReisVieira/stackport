"""Activity: recent management events from CloudTrail's LookupEvents (#229).

Each request is one LookupEvents call, and the next page is only fetched when
someone asks for it. On AWS, lookups are limited to two a second per account
and Region, shared with every other tool using the account, so this route never
follows pages or fans out, and the page polls no faster than every 10 seconds.

Errors reach the app-wide handlers: an endpoint without LookupEvents answers
501 with the ``not_implemented`` kind, which the page shows as such.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn

from fastapi import APIRouter, Depends
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.activity import (
    MAX_PAGE_SIZE,
    ActivityEvent,
    ActivityPage,
    ActivityQuery,
    ActivityResource,
    LookupAttribute,
)

router = APIRouter()

# The window a lookup covers when it doesn't name a start.
DEFAULT_WINDOW = timedelta(hours=1)


def _window(query: ActivityQuery) -> tuple[datetime, datetime | None]:
    """The lookup's start and end; without a start, the hour before the end (or now)."""
    if query.start_time:
        return query.start_time, query.end_time
    until = query.end_time or datetime.now(timezone.utc).replace(microsecond=0)
    return until - DEFAULT_WINDOW, query.end_time


def _reject_constant(name: str) -> NoReturn:
    raise ValueError(f"{name} isn't JSON")


def _parse_record(raw: object) -> dict[str, Any] | None:
    """CloudTrailEvent as a JSON object, or None when it isn't one.

    Emulators don't all send a valid record. NaN and Infinity count as invalid:
    they aren't JSON, and the response couldn't carry them.
    """
    if not isinstance(raw, str):
        return None
    try:
        parsed = json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _flag(value: object) -> bool | None:
    """ReadOnly: a string in LookupEvents' answer, a boolean in the record (a string in some emulators')."""
    if isinstance(value, bool):
        return value
    return {"true": True, "false": False}.get(value) if isinstance(value, str) else None


def _text(record: dict[str, Any], key: str) -> str | None:
    value = record.get(key)
    return value if isinstance(value, str) else None


def serialize_event(event: dict[str, Any]) -> ActivityEvent:
    raw = event.get("CloudTrailEvent")
    record = _parse_record(raw)
    fields = record or {}
    event_time = event.get("EventTime")
    return ActivityEvent(
        event_id=event.get("EventId", ""),
        event_name=event.get("EventName", ""),
        event_source=event.get("EventSource", ""),
        event_time=event_time.astimezone(timezone.utc) if isinstance(event_time, datetime) else None,
        username=event.get("Username"),
        access_key_id=event.get("AccessKeyId"),
        read_only=_flag(event.get("ReadOnly", fields.get("readOnly"))),
        resources=[
            ActivityResource(type=resource.get("ResourceType"), name=resource.get("ResourceName"))
            for resource in event.get("Resources", [])
        ],
        error_code=_text(fields, "errorCode"),
        error_message=_text(fields, "errorMessage"),
        source_ip_address=_text(fields, "sourceIPAddress"),
        user_agent=_text(fields, "userAgent"),
        aws_region=_text(fields, "awsRegion"),
        record=record,
        raw_record=raw if record is None and isinstance(raw, str) else None,
    )


def activity_query(
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    attribute: LookupAttribute | None = None,
    value: str | None = None,
    next_token: str | None = None,
    max_results: int = MAX_PAGE_SIZE,
) -> ActivityQuery:
    """The query parameters, checked together.

    Declared one by one rather than as a Pydantic query model: older FastAPI
    releases only spread such a model into separate parameters when it is the
    route's only one, and ``endpoint`` is another.
    """
    try:
        return ActivityQuery(
            start_time=start_time,
            end_time=end_time,
            attribute=attribute,
            value=value,
            next_token=next_token,
            max_results=max_results,
        )
    except ValidationError as exc:
        raise RequestValidationError([{**error, "loc": ("query", *error["loc"])} for error in exc.errors()]) from exc


@router.get("/events")
def lookup_events(
    query: ActivityQuery = Depends(activity_query),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> ActivityPage:
    """One page of management events, newest first, from a single LookupEvents call."""
    start, end = _window(query)
    params: dict[str, Any] = {"StartTime": start, "MaxResults": query.max_results}
    if end is not None:
        params["EndTime"] = end
    if query.attribute is not None:
        params["LookupAttributes"] = [{"AttributeKey": query.attribute.value, "AttributeValue": query.value}]
    if query.next_token:
        params["NextToken"] = query.next_token

    response = get_client("cloudtrail", **ep.client_kwargs()).lookup_events(**params)
    return ActivityPage(
        events=[serialize_event(event) for event in response.get("Events", [])],
        next_token=response.get("NextToken") or None,
        start_time=start,
        end_time=end,
    )
