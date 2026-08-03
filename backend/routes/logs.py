import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.aws_client import get_client
from backend.cache import cache
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.logs import CreateLogGroupBody, SetRetentionBody

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_RETENTION_DAYS = {1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653}


def _epoch_millis_to_iso(timestamp: Optional[int]) -> Optional[str]:
    """Convert epoch milliseconds to ISO string."""
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp / 1000.0).isoformat()


@router.get("/groups")
def list_log_groups(
    prefix: str = Query(default="", description="Log group name prefix filter"),
    next_token: str = Query(default="", description="Pagination token"),
    ep: EndpointInfo = Depends(get_endpoint_info),
):
    """List CloudWatch log groups with optional prefix filtering."""
    cache_key = f"{ep.url}:logs:groups:{prefix}:{next_token}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    logs = get_client("logs", **ep.client_kwargs())
    params: dict = {"limit": 50}
    if prefix:
        params["logGroupNamePrefix"] = prefix
    if next_token:
        params["nextToken"] = next_token

    try:
        response = logs.describe_log_groups(**params)
    except Exception:
        logger.debug("Failed to list log groups", exc_info=True)
        return {"log_groups": [], "next_token": None}

    log_groups = []
    for group in response.get("logGroups", []):
        log_groups.append(
            {
                "name": group["logGroupName"],
                "arn": group.get("arn", ""),
                "creation_time": _epoch_millis_to_iso(group.get("creationTime")),
                "retention_days": group.get("retentionInDays"),
                "stored_bytes": group.get("storedBytes", 0),
                "metric_filter_count": group.get("metricFilterCount", 0),
            }
        )

    result = {
        "log_groups": log_groups,
        "next_token": response.get("nextToken"),
    }

    cache.set(cache_key, result, ttl=30)
    return result


@router.get("/groups/{name:path}/streams")
def list_log_streams(
    name: str,
    prefix: str = Query(default="", description="Log stream name prefix filter"),
    order_by: str = Query(default="LastEventTime", description="Sort by LastEventTime or LogStreamName"),
    descending: bool = Query(default=True, description="Sort order"),
    limit: int = Query(default=50, description="Max streams to return"),
    next_token: str = Query(default="", description="Pagination token"),
    ep: EndpointInfo = Depends(get_endpoint_info),
):
    """List log streams for a log group."""
    cache_key = f"{ep.url}:logs:streams:{name}:{prefix}:{order_by}:{descending}:{limit}:{next_token}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    logs = get_client("logs", **ep.client_kwargs())
    params: dict = {
        "logGroupName": name,
        "orderBy": order_by,
        "descending": descending,
        "limit": min(limit, 50),
    }
    if prefix:
        params["logStreamNamePrefix"] = prefix
    if next_token:
        params["nextToken"] = next_token

    try:
        response = logs.describe_log_streams(**params)
    except Exception:
        logger.debug("Failed to list log streams for %s", name, exc_info=True)
        return {"log_streams": [], "next_token": None}

    log_streams = []
    for stream in response.get("logStreams", []):
        log_streams.append(
            {
                "name": stream["logStreamName"],
                "creation_time": _epoch_millis_to_iso(stream.get("creationTime")),
                "first_event_time": _epoch_millis_to_iso(stream.get("firstEventTimestamp")),
                "last_event_time": _epoch_millis_to_iso(stream.get("lastEventTime")),
                "last_ingestion_time": _epoch_millis_to_iso(stream.get("lastIngestionTime")),
                "stored_bytes": stream.get("storedBytes", 0),
            }
        )

    result = {
        "log_group": name,
        "log_streams": log_streams,
        "next_token": response.get("nextToken"),
    }

    cache.set(cache_key, result, ttl=30)
    return result


@router.get("/groups/{name:path}/streams/{stream:path}/events")
def get_log_events(
    name: str,
    stream: str,
    start_time: int = Query(default=0, description="Start time (epoch millis, 0 = no filter)"),
    end_time: int = Query(default=0, description="End time (epoch millis, 0 = no filter)"),
    filter_pattern: str = Query(default="", description="CloudWatch Logs filter pattern"),
    limit: int = Query(default=100, description="Max events to return"),
    next_token: str = Query(default="", description="Pagination token"),
    ep: EndpointInfo = Depends(get_endpoint_info),
):
    """Get log events for a specific log stream with optional filtering."""
    # Events are NOT cached — tail mode needs fresh data
    logs = get_client("logs", **ep.client_kwargs())

    # Use filter_log_events (supports patterns) if filter_pattern is provided,
    # otherwise use get_log_events for simpler retrieval
    if filter_pattern:
        params: dict = {
            "logGroupName": name,
            "logStreamNames": [stream],
            "limit": min(limit, 10000),
        }
        if filter_pattern:
            params["filterPattern"] = filter_pattern
        if start_time > 0:
            params["startTime"] = start_time
        if end_time > 0:
            params["endTime"] = end_time
        if next_token:
            params["nextToken"] = next_token

        try:
            response = logs.filter_log_events(**params)
        except Exception:
            logger.debug("Failed to filter log events for %s/%s", name, stream, exc_info=True)
            return {"events": [], "next_token": None}

        events = []
        for event in response.get("events", []):
            events.append(
                {
                    "timestamp": _epoch_millis_to_iso(event["timestamp"]),
                    "timestamp_millis": event["timestamp"],
                    "message": event["message"],
                    "ingestion_time": _epoch_millis_to_iso(event.get("ingestionTime")),
                    "event_id": event.get("eventId", ""),
                }
            )

        return {
            "log_group": name,
            "log_stream": stream,
            "events": events,
            "next_token": response.get("nextToken"),
        }
    else:
        params: dict = {
            "logGroupName": name,
            "logStreamName": stream,
            "limit": min(limit, 10000),
            "startFromHead": False,  # Start from most recent
        }
        if start_time > 0:
            params["startTime"] = start_time
        if end_time > 0:
            params["endTime"] = end_time
        if next_token:
            params["nextToken"] = next_token

        try:
            response = logs.get_log_events(**params)
        except Exception:
            logger.debug("Failed to get log events for %s/%s", name, stream, exc_info=True)
            return {"events": [], "next_token": None}

        events = []
        for event in response.get("events", []):
            events.append(
                {
                    "timestamp": _epoch_millis_to_iso(event["timestamp"]),
                    "timestamp_millis": event["timestamp"],
                    "message": event["message"],
                    "ingestion_time": None,
                    "event_id": "",
                }
            )

        return {
            "log_group": name,
            "log_stream": stream,
            "events": events,
            "next_token": response.get("nextForwardToken"),
        }


@router.post("/groups", status_code=201)
def create_log_group(body: CreateLogGroupBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Create a new CloudWatch log group."""
    if body.retention_in_days is not None and body.retention_in_days not in VALID_RETENTION_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"retention_in_days must be one of {sorted(VALID_RETENTION_DAYS)}",
        )

    logs = get_client("logs", **ep.client_kwargs())
    try:
        kwargs: dict = {"logGroupName": body.name}
        if body.tags:
            kwargs["tags"] = body.tags
        logs.create_log_group(**kwargs)

        if body.retention_in_days is not None:
            logs.put_retention_policy(
                logGroupName=body.name, retentionInDays=body.retention_in_days
            )
    except logs.exceptions.ResourceAlreadyExistsException:
        raise HTTPException(status_code=409, detail=f"Log group '{body.name}' already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache.delete_by_prefix(f"{ep.url}:logs:groups:")
    return {"name": body.name, "retention_in_days": body.retention_in_days}


@router.delete("/groups/{name:path}")
def delete_log_group(name: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Delete a CloudWatch log group."""
    logs = get_client("logs", **ep.client_kwargs())
    try:
        logs.delete_log_group(logGroupName=name)
    except logs.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Log group '{name}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache.delete_by_prefix(f"{ep.url}:logs:groups:")
    cache.delete_by_prefix(f"{ep.url}:logs:streams:{name}:")
    return {"success": True, "message": f"Log group '{name}' deleted"}


@router.put("/groups/{name:path}/retention")
def set_log_group_retention(name: str, body: SetRetentionBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Set or remove a log group's retention policy."""
    if body.retention_in_days is not None and body.retention_in_days not in VALID_RETENTION_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"retention_in_days must be one of {sorted(VALID_RETENTION_DAYS)}",
        )

    logs = get_client("logs", **ep.client_kwargs())
    try:
        if body.retention_in_days is None:
            logs.delete_retention_policy(logGroupName=name)
        else:
            logs.put_retention_policy(logGroupName=name, retentionInDays=body.retention_in_days)
    except logs.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Log group '{name}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache.delete_by_prefix(f"{ep.url}:logs:groups:")
    return {"name": name, "retention_in_days": body.retention_in_days}


@router.delete("/groups/{name:path}/streams/{stream:path}")
def delete_log_stream(name: str, stream: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Delete a log stream from a log group."""
    logs = get_client("logs", **ep.client_kwargs())
    try:
        logs.delete_log_stream(logGroupName=name, logStreamName=stream)
    except logs.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Log stream '{stream}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache.delete_by_prefix(f"{ep.url}:logs:streams:{name}:")
    return {"success": True, "message": f"Log stream '{stream}' deleted"}
