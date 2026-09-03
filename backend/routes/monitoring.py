"""CloudWatch monitoring routes: dashboards, alarms and metric data (#123)."""

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.monitoring import MetricDataRequest

logger = logging.getLogger(__name__)

router = APIRouter()


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@router.get("/dashboards")
def list_dashboards(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List CloudWatch dashboards."""
    cw = get_client("cloudwatch", **ep.client_kwargs())
    response = cw.list_dashboards()
    dashboards = [
        {
            "name": entry["DashboardName"],
            "lastModified": _iso(entry.get("LastModified")),
            "size": entry.get("Size", 0),
        }
        for entry in response.get("DashboardEntries", [])
    ]
    return {"dashboards": dashboards}


@router.get("/dashboards/{name}")
def get_dashboard(name: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Get a dashboard with its parsed widget definitions."""
    cw = get_client("cloudwatch", **ep.client_kwargs())
    try:
        response = cw.get_dashboard(DashboardName=name)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Dashboard '{name}' not found: {exc}")
    try:
        body = json.loads(response.get("DashboardBody") or "{}")
    except json.JSONDecodeError:
        body = {}
    return {"name": name, "body": body}


@router.get("/alarms")
def list_alarms(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List CloudWatch metric alarms with their state and configuration."""
    cw = get_client("cloudwatch", **ep.client_kwargs())
    response = cw.describe_alarms()
    alarms = [
        {
            "name": alarm["AlarmName"],
            "arn": alarm.get("AlarmArn", ""),
            "description": alarm.get("AlarmDescription"),
            "state": alarm.get("StateValue", "INSUFFICIENT_DATA"),
            "stateReason": alarm.get("StateReason"),
            "stateUpdated": _iso(alarm.get("StateUpdatedTimestamp")),
            "namespace": alarm.get("Namespace"),
            "metricName": alarm.get("MetricName"),
            "statistic": alarm.get("Statistic"),
            "period": alarm.get("Period"),
            "evaluationPeriods": alarm.get("EvaluationPeriods"),
            "threshold": alarm.get("Threshold"),
            "comparisonOperator": alarm.get("ComparisonOperator"),
            "dimensions": [
                {"name": d.get("Name", ""), "value": d.get("Value", "")} for d in alarm.get("Dimensions", [])
            ],
        }
        for alarm in response.get("MetricAlarms", [])
    ]
    return {"alarms": alarms}


@router.post("/metric-data")
def get_metric_data(body: MetricDataRequest, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Fetch metric time series for dashboard widgets.

    This is a read-only POST (the query set does not fit in a query string);
    it is allow-listed in the read-only middleware.
    """
    if not body.queries:
        return {"results": []}
    cw = get_client("cloudwatch", **ep.client_kwargs())

    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=max(1, body.start_minutes))

    metric_queries = [
        {
            "Id": query.id,
            "MetricStat": {
                "Metric": {
                    "Namespace": query.namespace,
                    "MetricName": query.metric_name,
                    "Dimensions": [{"Name": d.name, "Value": d.value} for d in query.dimensions],
                },
                "Period": max(1, query.period),
                "Stat": query.stat,
            },
        }
        for query in body.queries[:100]
    ]

    try:
        response = cw.get_metric_data(MetricDataQueries=metric_queries, StartTime=start, EndTime=end)
    except Exception as exc:
        logger.debug("get_metric_data failed", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Failed to fetch metric data: {exc}")

    results = [
        {
            "id": series.get("Id", ""),
            "label": series.get("Label", ""),
            "timestamps": [_iso(ts) for ts in series.get("Timestamps", [])],
            "values": series.get("Values", []),
        }
        for series in response.get("MetricDataResults", [])
    ]
    return {"results": results}
