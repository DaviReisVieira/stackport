"""Step verification for the Learn module.

Checks run directly against the selected endpoint with fresh boto3 calls
(never through the TTL cache) so a step verifies immediately after the
learner acts. Connection failures surface as status "service_unreachable"
instead of a silent "not done".
"""

import logging
from collections.abc import Callable

from botocore.exceptions import ClientError, ConnectTimeoutError, EndpointConnectionError

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo

logger = logging.getLogger(__name__)


def _s3_bucket_exists(ep: EndpointInfo, params: dict) -> dict:
    bucket = params["bucket"]
    client = get_client("s3", **ep.client_kwargs())
    try:
        client.head_bucket(Bucket=bucket)
        return {"passed": True, "message": f"Bucket '{bucket}' found."}
    except ClientError:
        return {"passed": False, "message": f"Bucket '{bucket}' not found yet."}


def _s3_object_exists(ep: EndpointInfo, params: dict) -> dict:
    """One named object. Better UX than a count: the message can say what is missing."""
    bucket = params["bucket"]
    key = params["key"]
    client = get_client("s3", **ep.client_kwargs())
    try:
        response = client.head_object(Bucket=bucket, Key=key)
    except ClientError:
        return {"passed": False, "message": f"No object '{key}' in '{bucket}' yet."}
    size = response.get("ContentLength", 0)
    return {"passed": True, "message": f"Found '{key}' in '{bucket}' ({size} bytes)."}


def _s3_prefix_exists(ep: EndpointInfo, params: dict) -> dict:
    """A prefix "exists" when at least one key starts with it (S3 has no real folders)."""
    bucket = params["bucket"]
    prefix = params["prefix"]
    client = get_client("s3", **ep.client_kwargs())
    try:
        response = client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
    except ClientError:
        return {"passed": False, "message": f"Bucket '{bucket}' not found yet."}
    if response.get("KeyCount", 0) > 0:
        return {"passed": True, "message": f"Found keys under '{prefix}' in '{bucket}'."}
    return {"passed": False, "message": f"Nothing stored under '{prefix}' in '{bucket}' yet."}


def _s3_object_count(ep: EndpointInfo, params: dict) -> dict:
    bucket = params["bucket"]
    minimum = int(params.get("min", 1))
    client = get_client("s3", **ep.client_kwargs())
    try:
        response = client.list_objects_v2(Bucket=bucket)
    except ClientError:
        return {"passed": False, "message": f"Bucket '{bucket}' not found yet."}
    count = response.get("KeyCount", 0)
    if count >= minimum:
        return {"passed": True, "message": f"Found {count} object(s) in '{bucket}'."}
    return {"passed": False, "message": f"Bucket '{bucket}' has {count} object(s); expected at least {minimum}."}


def _dynamodb_table_exists(ep: EndpointInfo, params: dict) -> dict:
    table = params["table"]
    client = get_client("dynamodb", **ep.client_kwargs())
    try:
        response = client.describe_table(TableName=table)
    except ClientError:
        return {"passed": False, "message": f"Table '{table}' not found yet."}
    status = response.get("Table", {}).get("TableStatus", "")
    expected_status = params.get("status")
    if expected_status and status != expected_status:
        return {"passed": False, "message": f"Table '{table}' exists but is {status}, expected {expected_status}."}
    return {"passed": True, "message": f"Table '{table}' found ({status})."}


def _dynamodb_item_count(ep: EndpointInfo, params: dict) -> dict:
    table = params["table"]
    minimum = int(params.get("min", 1))
    client = get_client("dynamodb", **ep.client_kwargs())
    try:
        response = client.scan(TableName=table, Select="COUNT")
    except ClientError:
        return {"passed": False, "message": f"Table '{table}' not found yet."}
    count = response.get("Count", 0)
    if count >= minimum:
        return {"passed": True, "message": f"Found {count} item(s) in '{table}'."}
    return {"passed": False, "message": f"Table '{table}' has {count} item(s); expected at least {minimum}."}


def _resource_exists(ep: EndpointInfo, params: dict) -> dict:
    """Generic existence check driven by SERVICE_REGISTRY (no cache)."""
    from backend.routes.stats import _METHOD_KWARGS, SERVICE_REGISTRY

    service = params["service"]
    resource_type = params["resource_type"]
    target = params["id"]

    for rtype, boto_service, method, response_key in SERVICE_REGISTRY.get(service, []):
        if rtype != resource_type:
            continue
        client = get_client(boto_service, **ep.client_kwargs())
        kwargs = _METHOD_KWARGS.get((boto_service, method), {})
        response = getattr(client, method)(**kwargs)
        items = response.get(response_key, [])
        if isinstance(items, dict) and "Items" in items:
            items = items["Items"]
        for item in items:
            if isinstance(item, str) and target in item:
                return {"passed": True, "message": f"Found {resource_type[:-1] if resource_type.endswith('s') else resource_type} '{target}'."}
            if isinstance(item, dict) and any(target in str(v) for v in item.values() if isinstance(v, str)):
                return {"passed": True, "message": f"Found '{target}' in {service} {resource_type}."}
        return {"passed": False, "message": f"'{target}' not found in {service} {resource_type} yet."}
    return {"passed": False, "message": f"Unknown resource type {service}/{resource_type}."}


def _all_of(ep: EndpointInfo, params: dict) -> dict:
    """Composite step: every nested check must pass. Reports the first one that doesn't."""
    specs = params.get("checks", [])
    if not specs:
        return {"passed": False, "message": "This composite check has no sub-checks."}
    for spec in specs:
        check = CHECKS.get(spec.get("type", ""))
        if check is None:
            return {"passed": False, "message": f"Unknown check type '{spec.get('type')}'."}
        result = check(ep, spec.get("params", {}))
        if not result["passed"]:
            return result
    return {"passed": True, "message": f"All {len(specs)} conditions met."}


CHECKS: dict[str, Callable[[EndpointInfo, dict], dict]] = {
    "s3_bucket_exists": _s3_bucket_exists,
    "s3_object_exists": _s3_object_exists,
    "s3_prefix_exists": _s3_prefix_exists,
    "s3_object_count": _s3_object_count,
    "all_of": _all_of,
    "dynamodb_table_exists": _dynamodb_table_exists,
    "dynamodb_item_count": _dynamodb_item_count,
    "resource_exists": _resource_exists,
}


def run_check(ep: EndpointInfo, spec: dict) -> dict:
    """Run a verification spec: {"type": <check name>, "params": {...}}.

    Returns {"status": "ok"|"service_unreachable"|"error", "passed": bool, "message": str}.
    """
    check = CHECKS.get(spec.get("type", ""))
    if check is None:
        return {"status": "error", "passed": False, "message": f"Unknown check type '{spec.get('type')}'."}
    try:
        result = check(ep, spec.get("params", {}))
        result["status"] = "ok"
        return result
    except (EndpointConnectionError, ConnectTimeoutError):
        return {
            "status": "service_unreachable",
            "passed": False,
            "message": "Could not reach the endpoint. Is your emulator running?",
        }
    except Exception as e:
        logger.debug("Learn check failed unexpectedly", exc_info=True)
        return {"status": "error", "passed": False, "message": str(e)}
