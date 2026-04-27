import base64
import json
import logging
from typing import Any

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.aws_client import get_client
from backend.cache import cache
from backend.routes.common import get_endpoint_url
from backend.schemas.dynamodb import BatchWriteRequest, DeleteItemRequest, PutItemRequest, QueryRequest

logger = logging.getLogger(__name__)

_serializer = TypeSerializer()


def _plain_to_dynamodb_item(plain: dict[str, Any]) -> dict[str, Any]:
    return {k: _serializer.serialize(v) for k, v in plain.items()}


def _get_partition_sort_keys(dynamodb: Any, table_name: str) -> tuple[str | None, str | None]:
    table_resp = dynamodb.describe_table(TableName=table_name)
    key_schema = table_resp["Table"].get("KeySchema", [])
    partition_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "HASH"), None)
    sort_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "RANGE"), None)
    return partition_key, sort_key


def _require_key_attributes(
    attrs: dict[str, Any],
    partition_key: str | None,
    sort_key: str | None,
    *,
    label: str,
) -> None:
    if not partition_key:
        raise HTTPException(status_code=400, detail="Table has no partition key in key schema")
    if partition_key not in attrs:
        raise HTTPException(status_code=400, detail=f"Missing {label} attribute: {partition_key!r}")
    if sort_key and sort_key not in attrs:
        raise HTTPException(status_code=400, detail=f"Missing {label} attribute: {sort_key!r}")


def _coerce_item_dict(raw: dict[str, Any], item_format: str) -> dict[str, Any]:
    if item_format == "plain":
        try:
            return _plain_to_dynamodb_item(raw)
        except TypeError as e:
            raise HTTPException(status_code=400, detail=f"Could not convert plain item to DynamoDB types: {e}") from e
    return raw


def _coerce_key_dict(raw: dict[str, Any], item_format: str) -> dict[str, Any]:
    if item_format == "plain":
        try:
            return _plain_to_dynamodb_item(raw)
        except TypeError as e:
            raise HTTPException(status_code=400, detail=f"Could not convert plain key to DynamoDB types: {e}") from e
    return raw


def _invalidate_table_item_count(table_name: str, endpoint_url: str | None) -> None:
    cache.delete(f"{endpoint_url}:dynamodb:item_count:{table_name}")


def _client_error_message(exc: ClientError) -> str:
    err = exc.response.get("Error", {})
    return err.get("Message", err.get("Code", str(exc)))

router = APIRouter()


def _get_table_item_count(table_name: str, endpoint_url: str | None) -> int:
    """Return item count for a table. Cached 30s."""
    cache_key = f"{endpoint_url}:dynamodb:item_count:{table_name}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    dynamodb = get_client("dynamodb", endpoint_url)
    try:
        resp = dynamodb.describe_table(TableName=table_name)
        item_count = resp["Table"].get("ItemCount", 0)
        cache.set(cache_key, item_count, ttl=30)
        return item_count
    except Exception:
        logger.debug("Failed to get item count for %s", table_name, exc_info=True)
        return 0


@router.get("/tables")
def list_tables(endpoint_url: str | None = Depends(get_endpoint_url)):
    dynamodb = get_client("dynamodb", endpoint_url)
    paginator = dynamodb.get_paginator("list_tables")
    table_names = []

    for page in paginator.paginate():
        table_names.extend(page.get("TableNames", []))

    tables = []
    for name in table_names:
        try:
            resp = dynamodb.describe_table(TableName=name)
            table = resp["Table"]
            item_count = table.get("ItemCount", 0)
            table_size = table.get("TableSizeBytes", 0)

            key_schema = table.get("KeySchema", [])
            partition_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "HASH"), None)
            sort_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "RANGE"), None)

            tables.append(
                {
                    "name": name,
                    "status": table.get("TableStatus", "UNKNOWN"),
                    "item_count": item_count,
                    "size_bytes": table_size,
                    "partition_key": partition_key,
                    "sort_key": sort_key,
                    "billing_mode": table.get("BillingModeSummary", {}).get("BillingMode", "PROVISIONED"),
                    "created": table.get("CreationDateTime").isoformat() if table.get("CreationDateTime") else None,
                }
            )
        except Exception:
            logger.debug("Failed to describe table %s", name, exc_info=True)
            continue

    return {"tables": tables}


@router.get("/tables/{name}")
def get_table_detail(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    dynamodb = get_client("dynamodb", endpoint_url)

    try:
        resp = dynamodb.describe_table(TableName=name)
        table = resp["Table"]

        key_schema = table.get("KeySchema", [])
        attribute_defs = {attr["AttributeName"]: attr["AttributeType"] for attr in table.get("AttributeDefinitions", [])}

        partition_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "HASH"), None)
        sort_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "RANGE"), None)

        return {
            "name": name,
            "status": table.get("TableStatus", "UNKNOWN"),
            "item_count": table.get("ItemCount", 0),
            "size_bytes": table.get("TableSizeBytes", 0),
            "partition_key": partition_key,
            "partition_key_type": attribute_defs.get(partition_key) if partition_key else None,
            "sort_key": sort_key,
            "sort_key_type": attribute_defs.get(sort_key) if sort_key else None,
            "billing_mode": table.get("BillingModeSummary", {}).get("BillingMode", "PROVISIONED"),
            "created": table.get("CreationDateTime").isoformat() if table.get("CreationDateTime") else None,
            "attribute_definitions": attribute_defs,
            "key_schema": key_schema,
            "global_secondary_indexes": table.get("GlobalSecondaryIndexes", []),
            "local_secondary_indexes": table.get("LocalSecondaryIndexes", []),
        }
    except Exception as e:
        logger.error("Failed to get table detail for %s: %s", name, e, exc_info=True)
        return {"error": str(e)}


@router.get("/tables/{name}/items")
def scan_table(
    name: str,
    limit: int = Query(default=25, ge=1, le=100, description="Max items per page"),
    exclusive_start_key: str = Query(default=None, description="Base64 encoded last evaluated key for pagination"),
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    dynamodb = get_client("dynamodb", endpoint_url)

    scan_params: dict[str, Any] = {
        "TableName": name,
        "Limit": limit,
    }

    if exclusive_start_key:
        try:
            decoded = base64.b64decode(exclusive_start_key).decode("utf-8")
            scan_params["ExclusiveStartKey"] = json.loads(decoded)
        except Exception:
            logger.debug("Invalid exclusive_start_key", exc_info=True)

    try:
        resp = dynamodb.scan(**scan_params)
        items = resp.get("Items", [])

        last_evaluated_key = resp.get("LastEvaluatedKey")
        next_token = None
        if last_evaluated_key:
            next_token = base64.b64encode(json.dumps(last_evaluated_key).encode("utf-8")).decode("utf-8")

        return {
            "table": name,
            "items": items,
            "count": len(items),
            "scanned_count": resp.get("ScannedCount", len(items)),
            "next_token": next_token,
        }
    except Exception as e:
        logger.error("Failed to scan table %s: %s", name, e, exc_info=True)
        return {"error": str(e), "items": [], "count": 0}



@router.post("/tables/{name}/query")
def query_table(name: str, request: QueryRequest, endpoint_url: str | None = Depends(get_endpoint_url)):
    dynamodb = get_client("dynamodb", endpoint_url)

    try:
        # Get table key schema
        table_resp = dynamodb.describe_table(TableName=name)
        table = table_resp["Table"]
        key_schema = table.get("KeySchema", [])
        attribute_defs = {attr["AttributeName"]: attr["AttributeType"] for attr in table.get("AttributeDefinitions", [])}

        partition_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "HASH"), None)
        sort_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "RANGE"), None)

        if not partition_key:
            return {"error": "No partition key found in table schema", "items": [], "count": 0}

        partition_key_type = attribute_defs.get(partition_key, "S")

        # Build key condition expression
        key_condition = f"#{partition_key} = :pk"
        expression_attr_names = {f"#{partition_key}": partition_key}
        expression_attr_values = {":pk": {partition_key_type: request.partition_key_value}}

        if sort_key and request.sort_key_value:
            sort_key_type = attribute_defs.get(sort_key, "S")
            if request.sort_key_operator == "=":
                key_condition += f" AND #{sort_key} = :sk"
                expression_attr_values[":sk"] = {sort_key_type: request.sort_key_value}
            elif request.sort_key_operator in ("<", "<=", ">", ">="):
                key_condition += f" AND #{sort_key} {request.sort_key_operator} :sk"
                expression_attr_values[":sk"] = {sort_key_type: request.sort_key_value}
            elif request.sort_key_operator == "BEGINS_WITH":
                key_condition += f" AND begins_with(#{sort_key}, :sk)"
                expression_attr_values[":sk"] = {sort_key_type: request.sort_key_value}
            expression_attr_names[f"#{sort_key}"] = sort_key

        query_params = {
            "TableName": name,
            "KeyConditionExpression": key_condition,
            "ExpressionAttributeNames": expression_attr_names,
            "ExpressionAttributeValues": expression_attr_values,
            "Limit": request.limit,
        }

        resp = dynamodb.query(**query_params)
        items = resp.get("Items", [])

        return {
            "table": name,
            "items": items,
            "count": len(items),
            "scanned_count": resp.get("ScannedCount", len(items)),
        }
    except Exception as e:
        logger.error("Failed to query table %s: %s", name, e, exc_info=True)
        return {"error": str(e), "items": [], "count": 0}


@router.api_route("/tables/{name}/items", methods=["POST", "PUT"])
def put_table_item(
    name: str,
    request: PutItemRequest,
    endpoint_url: str | None = Depends(get_endpoint_url),
) -> dict[str, Any]:
    """Create or replace an item (DynamoDB PutItem)."""
    dynamodb = get_client("dynamodb", endpoint_url)
    try:
        partition_key, sort_key = _get_partition_sort_keys(dynamodb, name)
    except Exception as e:
        logger.error("put_item describe failed for %s: %s", name, e, exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to read table: {e}") from e

    item = _coerce_item_dict(request.item, request.item_format)
    _require_key_attributes(item, partition_key, sort_key, label="item")

    try:
        dynamodb.put_item(TableName=name, Item=item)
    except ClientError as e:
        msg = _client_error_message(e)
        logger.error("put_item %s: %s", name, e, exc_info=True)
        raise HTTPException(status_code=400, detail=msg) from e

    _invalidate_table_item_count(name, endpoint_url)
    return {"ok": True, "table": name}


@router.delete("/tables/{name}/items")
def delete_table_item(
    name: str,
    request: DeleteItemRequest,
    endpoint_url: str | None = Depends(get_endpoint_url),
) -> dict[str, Any]:
    dynamodb = get_client("dynamodb", endpoint_url)
    try:
        partition_key, sort_key = _get_partition_sort_keys(dynamodb, name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read table: {e}") from e

    key = _coerce_key_dict(request.key, request.item_format)
    _require_key_attributes(key, partition_key, sort_key, label="key")

    try:
        dynamodb.delete_item(TableName=name, Key=key)
    except ClientError as e:
        msg = _client_error_message(e)
        raise HTTPException(status_code=400, detail=msg) from e

    _invalidate_table_item_count(name, endpoint_url)
    return {"ok": True, "table": name}


@router.post("/tables/{name}/items/batch")
def batch_write_items(
    name: str,
    request: BatchWriteRequest,
    endpoint_url: str | None = Depends(get_endpoint_url),
) -> dict[str, Any]:
    dynamodb = get_client("dynamodb", endpoint_url)
    try:
        partition_key, sort_key = _get_partition_sort_keys(dynamodb, name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read table: {e}") from e

    batch_requests: list[dict[str, Any]] = []
    for op in request.operations:
        if op.op == "put":
            item = _coerce_item_dict(op.item, request.item_format)
            _require_key_attributes(item, partition_key, sort_key, label="item")
            batch_requests.append({"PutRequest": {"Item": item}})
        else:
            key = _coerce_key_dict(op.key, request.item_format)
            _require_key_attributes(key, partition_key, sort_key, label="key")
            batch_requests.append({"DeleteRequest": {"Key": key}})

    try:
        resp = dynamodb.batch_write_item(RequestItems={name: batch_requests})
    except ClientError as e:
        msg = _client_error_message(e)
        raise HTTPException(status_code=400, detail=msg) from e

    _invalidate_table_item_count(name, endpoint_url)

    uproc = resp.get("UnprocessedItems", {})
    if uproc:
        return {
            "ok": True,
            "table": name,
            "unprocessed": uproc,
            "message": "Some items were not processed; retry with returned keys.",
        }

    return {"ok": True, "table": name, "unprocessed": {}}
