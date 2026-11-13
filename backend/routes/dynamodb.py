import base64
import binascii
import json
import logging
from collections.abc import Callable, Coroutine, Iterator
from contextlib import contextmanager
from decimal import Decimal, DecimalException
from typing import Any

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.routing import APIRoute

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.dynamodb import (
    BatchWriteRequest,
    CreateTableRequest,
    DeleteItemRequest,
    PutItemRequest,
    QueryRequest,
)

logger = logging.getLogger(__name__)

_serializer = TypeSerializer()


class _ExactNumbersRequest(Request):
    """Reads a JSON body with its numbers as Decimal, the type boto3 serializes as N.

    The default parser makes 9.75 a float, which boto3 refuses because a binary
    float can't hold most decimals, and which keeps only about 17 of the 38
    digits a DynamoDB number has. Python's parser also accepts NaN and Infinity;
    they become Decimal too, so the error a client gets is about the value.
    """

    async def json(self) -> Any:
        return json.loads(await self.body(), parse_float=Decimal, parse_constant=Decimal)


class _ExactNumbersRoute(APIRoute):
    """Every DynamoDB route reads its body with _ExactNumbersRequest, so plain JSON
    items and keys reach boto3 with the numbers the client sent."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def exact_numbers_handler(request: Request) -> Response:
            return await handler(_ExactNumbersRequest(request.scope, request.receive))

        return exact_numbers_handler


def _unconvertible(label: str, name: str, reason: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"Could not convert plain {label} attribute {name!r} to DynamoDB types: {reason}")


def _plain_to_dynamodb(plain: dict[str, Any], label: str) -> dict[str, Any]:
    typed = {}
    for name, value in plain.items():
        try:
            typed[name] = _serializer.serialize(value)
        except TypeError as e:
            raise _unconvertible(label, name, str(e)) from e
        except DecimalException as e:
            # boto3 raises the bare decimal signal (Rounded, Overflow, ...) for a number DynamoDB can't hold
            raise _unconvertible(
                label, name, "DynamoDB numbers have up to 38 significant digits, with a magnitude between 1E-130 and 1E+126"
            ) from e
    return typed


# Binary (B / BS) travels as base64 over StackPort's HTTP API, the same way AWS
# writes it in DynamoDB JSON. boto3 hands us raw bytes, which JSON cannot carry.


def _to_json_safe(obj: Any) -> Any:
    """Replace every bytes value with its base64 text. Safe to apply to whole
    low-level responses: DynamoDB only returns bytes inside B and BS."""
    if isinstance(obj, (bytes, bytearray)):
        return base64.b64encode(obj).decode("ascii")
    if isinstance(obj, dict):
        return {k: _to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_json_safe(v) for v in obj]
    return obj


def _b64_to_bytes(value: Any, name: str) -> bytes:
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Attribute {name!r} is not valid base64 for type B") from e


def _attr_from_json(av: Any, name: str) -> Any:
    """Inverse of _to_json_safe for one DynamoDB attribute value. Type-aware, so
    strings under S stay strings and only B / BS are decoded."""
    if not isinstance(av, dict):
        return av
    if "B" in av:
        return {**av, "B": _b64_to_bytes(av["B"], name)}
    if "BS" in av and isinstance(av["BS"], list):
        return {**av, "BS": [_b64_to_bytes(v, name) for v in av["BS"]]}
    if "L" in av and isinstance(av["L"], list):
        return {**av, "L": [_attr_from_json(v, name) for v in av["L"]]}
    if "M" in av and isinstance(av["M"], dict):
        return {**av, "M": {k: _attr_from_json(v, f"{name}.{k}") for k, v in av["M"].items()}}
    return av


def _item_from_json(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _attr_from_json(v, k) for k, v in item.items()}


def _key_value(attr_type: str, value: str, name: str) -> dict[str, Any]:
    """Typed key value for a query condition. Binary keys arrive as base64."""
    if attr_type == "B":
        return {"B": _b64_to_bytes(value, name)}
    return {attr_type: value}


@contextmanager
def _table_must_exist(name: str) -> Iterator[None]:
    """Answer 404 when DynamoDB says the table doesn't exist.

    Any other error reaches the app-wide handlers, which answer with the
    endpoint's status and message.
    """
    try:
        yield
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            raise HTTPException(status_code=404, detail=f"Table '{name}' not found") from e
        raise


def _describe_table(dynamodb: Any, name: str) -> dict[str, Any]:
    with _table_must_exist(name):
        return dynamodb.describe_table(TableName=name)["Table"]


def _key_names(table: dict[str, Any]) -> tuple[str | None, str | None]:
    """The partition and sort key attribute names of a described table."""
    key_schema = table.get("KeySchema", [])
    partition_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "HASH"), None)
    sort_key = next((k["AttributeName"] for k in key_schema if k["KeyType"] == "RANGE"), None)
    return partition_key, sort_key


def _decode_page_token(token: str) -> dict[str, Any]:
    """The ExclusiveStartKey behind a next_token that scan_table returned."""
    try:
        key = json.loads(base64.b64decode(token, validate=True))
    except ValueError:  # binascii.Error, UnicodeDecodeError and JSONDecodeError all are
        key = None
    if not isinstance(key, dict):
        raise HTTPException(status_code=400, detail="Invalid exclusive_start_key: pass the next_token of the previous page")
    return _item_from_json(key)


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


def _coerce_attributes(raw: dict[str, Any], item_format: str, label: str) -> dict[str, Any]:
    """An item or key from the request, as DynamoDB-typed attributes."""
    if item_format == "plain":
        return _plain_to_dynamodb(raw, label)
    return _item_from_json(raw)


def _client_error_message(exc: ClientError) -> str:
    err = exc.response.get("Error", {})
    return err.get("Message", err.get("Code", str(exc)))

router = APIRouter(route_class=_ExactNumbersRoute)


@router.post("/tables", status_code=201)
def create_table(body: CreateTableRequest, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Create a table from a partition key and an optional sort key.

    Mirrors the console: Table details (name and keys) plus Table settings,
    where the default is on-demand capacity (PAY_PER_REQUEST).
    """
    dynamodb = get_client("dynamodb", **ep.client_kwargs())

    attribute_definitions = [{"AttributeName": body.partition_key.name, "AttributeType": body.partition_key.type}]
    key_schema = [{"AttributeName": body.partition_key.name, "KeyType": "HASH"}]
    if body.sort_key:
        if body.sort_key.name == body.partition_key.name:
            raise HTTPException(status_code=400, detail="The sort key must differ from the partition key")
        attribute_definitions.append({"AttributeName": body.sort_key.name, "AttributeType": body.sort_key.type})
        key_schema.append({"AttributeName": body.sort_key.name, "KeyType": "RANGE"})

    params: dict = {
        "TableName": body.name,
        "AttributeDefinitions": attribute_definitions,
        "KeySchema": key_schema,
        "BillingMode": body.billing_mode,
    }
    if body.billing_mode == "PROVISIONED":
        params["ProvisionedThroughput"] = {
            "ReadCapacityUnits": body.read_capacity,
            "WriteCapacityUnits": body.write_capacity,
        }

    try:
        response = dynamodb.create_table(**params)
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code", "")
        if code == "ResourceInUseException":
            raise HTTPException(status_code=409, detail=f"A table named '{body.name}' already exists")
        logger.debug("Failed to create table %s", body.name, exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to create table: {err}")

    description = response.get("TableDescription", {})
    return {
        "name": body.name,
        "status": description.get("TableStatus", "CREATING"),
        "partitionKey": body.partition_key.name,
        "sortKey": body.sort_key.name if body.sort_key else None,
        "billingMode": body.billing_mode,
    }


@router.get("/tables")
def list_tables(ep: EndpointInfo = Depends(get_endpoint_info)):
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
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
            partition_key, sort_key = _key_names(table)

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
def get_table_detail(name: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    table = _describe_table(dynamodb, name)
    attribute_defs = {attr["AttributeName"]: attr["AttributeType"] for attr in table.get("AttributeDefinitions", [])}
    partition_key, sort_key = _key_names(table)

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
        "key_schema": table.get("KeySchema", []),
        "global_secondary_indexes": table.get("GlobalSecondaryIndexes", []),
        "local_secondary_indexes": table.get("LocalSecondaryIndexes", []),
    }


@router.get("/tables/{name}/items")
def scan_table(
    name: str,
    limit: int = Query(default=25, ge=1, le=100, description="Max items per page"),
    exclusive_start_key: str = Query(default=None, description="Base64 encoded last evaluated key for pagination"),
    ep: EndpointInfo = Depends(get_endpoint_info),
):
    dynamodb = get_client("dynamodb", **ep.client_kwargs())

    scan_params: dict[str, Any] = {
        "TableName": name,
        "Limit": limit,
    }

    if exclusive_start_key:
        scan_params["ExclusiveStartKey"] = _decode_page_token(exclusive_start_key)

    with _table_must_exist(name):
        resp = dynamodb.scan(**scan_params)
    items = resp.get("Items", [])

    last_evaluated_key = resp.get("LastEvaluatedKey")
    next_token = None
    if last_evaluated_key:
        next_token = base64.b64encode(json.dumps(_to_json_safe(last_evaluated_key)).encode("utf-8")).decode("utf-8")

    return {
        "table": name,
        "items": _to_json_safe(items),
        "count": len(items),
        "scanned_count": resp.get("ScannedCount", len(items)),
        "next_token": next_token,
    }


@router.get("/tables/{name}/item-count")
def count_table_items(name: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Count the table's items now, like the console's "Get live item count".

    DescribeTable's ItemCount is approximate: AWS refreshes it about every six
    hours, and some emulators always report 0. This scans with Select=COUNT,
    following LastEvaluatedKey since a page stops at 1 MB of data, so on a large
    table it takes a while and, on AWS, consumes read capacity for every item.
    """
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    count = 0
    with _table_must_exist(name):
        for page in dynamodb.get_paginator("scan").paginate(TableName=name, Select="COUNT"):
            count += page["Count"]
    return {"table": name, "count": count}


@router.post("/tables/{name}/query")
def query_table(name: str, request: QueryRequest, ep: EndpointInfo = Depends(get_endpoint_info)):
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    table = _describe_table(dynamodb, name)
    attribute_defs = {attr["AttributeName"]: attr["AttributeType"] for attr in table.get("AttributeDefinitions", [])}
    partition_key, sort_key = _key_names(table)

    if not partition_key:
        raise HTTPException(status_code=400, detail="Table has no partition key in key schema")

    partition_key_type = attribute_defs.get(partition_key, "S")

    # Build key condition expression
    key_condition = f"#{partition_key} = :pk"
    expression_attr_names = {f"#{partition_key}": partition_key}
    expression_attr_values = {":pk": _key_value(partition_key_type, request.partition_key_value, partition_key)}

    if sort_key and request.sort_key_value:
        sort_key_type = attribute_defs.get(sort_key, "S")
        if request.sort_key_operator == "=":
            key_condition += f" AND #{sort_key} = :sk"
            expression_attr_values[":sk"] = _key_value(sort_key_type, request.sort_key_value, sort_key)
        elif request.sort_key_operator in ("<", "<=", ">", ">="):
            key_condition += f" AND #{sort_key} {request.sort_key_operator} :sk"
            expression_attr_values[":sk"] = _key_value(sort_key_type, request.sort_key_value, sort_key)
        elif request.sort_key_operator == "BEGINS_WITH":
            key_condition += f" AND begins_with(#{sort_key}, :sk)"
            expression_attr_values[":sk"] = _key_value(sort_key_type, request.sort_key_value, sort_key)
        expression_attr_names[f"#{sort_key}"] = sort_key

    query_params = {
        "TableName": name,
        "KeyConditionExpression": key_condition,
        "ExpressionAttributeNames": expression_attr_names,
        "ExpressionAttributeValues": expression_attr_values,
        "Limit": request.limit,
    }

    with _table_must_exist(name):
        resp = dynamodb.query(**query_params)
    items = resp.get("Items", [])

    return {
        "table": name,
        "items": _to_json_safe(items),
        "count": len(items),
        "scanned_count": resp.get("ScannedCount", len(items)),
    }


@router.api_route("/tables/{name}/items", methods=["POST", "PUT"])
def put_table_item(
    name: str,
    request: PutItemRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Create or replace an item (DynamoDB PutItem)."""
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    partition_key, sort_key = _key_names(_describe_table(dynamodb, name))

    item = _coerce_attributes(request.item, request.item_format, "item")
    _require_key_attributes(item, partition_key, sort_key, label="item")

    try:
        dynamodb.put_item(TableName=name, Item=item)
    except ClientError as e:
        msg = _client_error_message(e)
        logger.error("put_item %s: %s", name, e, exc_info=True)
        raise HTTPException(status_code=400, detail=msg) from e

    return {"ok": True, "table": name}


@router.delete("/tables/{name}/items")
def delete_table_item(
    name: str,
    request: DeleteItemRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    partition_key, sort_key = _key_names(_describe_table(dynamodb, name))

    key = _coerce_attributes(request.key, request.item_format, "key")
    _require_key_attributes(key, partition_key, sort_key, label="key")

    try:
        dynamodb.delete_item(TableName=name, Key=key)
    except ClientError as e:
        msg = _client_error_message(e)
        raise HTTPException(status_code=400, detail=msg) from e

    return {"ok": True, "table": name}


@router.post("/tables/{name}/items/batch")
def batch_write_items(
    name: str,
    request: BatchWriteRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    dynamodb = get_client("dynamodb", **ep.client_kwargs())
    partition_key, sort_key = _key_names(_describe_table(dynamodb, name))

    batch_requests: list[dict[str, Any]] = []
    for op in request.operations:
        if op.op == "put":
            item = _coerce_attributes(op.item, request.item_format, "item")
            _require_key_attributes(item, partition_key, sort_key, label="item")
            batch_requests.append({"PutRequest": {"Item": item}})
        else:
            key = _coerce_attributes(op.key, request.item_format, "key")
            _require_key_attributes(key, partition_key, sort_key, label="key")
            batch_requests.append({"DeleteRequest": {"Key": key}})

    try:
        resp = dynamodb.batch_write_item(RequestItems={name: batch_requests})
    except ClientError as e:
        msg = _client_error_message(e)
        raise HTTPException(status_code=400, detail=msg) from e

    uproc = resp.get("UnprocessedItems", {})
    if uproc:
        return {
            "ok": True,
            "table": name,
            "unprocessed": _to_json_safe(uproc),
            "message": "Some items were not processed; retry with returned keys.",
        }

    return {"ok": True, "table": name, "unprocessed": {}}
