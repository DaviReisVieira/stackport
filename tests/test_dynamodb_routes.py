"""Integration tests for DynamoDB API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from collections.abc import Iterator
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes import dynamodb as dynamodb_routes

client = TestClient(app)


@pytest.fixture
def stubber(monkeypatch) -> Iterator[Stubber]:
    """A real boto3 client behind the routes, stubbed at the wire: botocore checks
    every request the routes build against the DynamoDB API model, and raises
    stubbed errors as the ClientError it would raise for a real response."""
    ddb = boto3.client(
        "dynamodb",
        region_name="us-east-1",
        endpoint_url="http://127.0.0.1:9",
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    monkeypatch.setattr(dynamodb_routes, "get_client", lambda _service, **_kwargs: ddb)
    with Stubber(ddb) as stub:
        yield stub
        stub.assert_no_pending_responses()


def describes(stub: Stubber, table: str, pk: tuple[str, str], sk: tuple[str, str] | None = None) -> None:
    """Queue a DescribeTable answer for a table with these (name, type) keys."""
    keys = [(pk, "HASH")] + ([(sk, "RANGE")] if sk else [])
    stub.add_response(
        "describe_table",
        {
            "Table": {
                "TableName": table,
                "TableStatus": "ACTIVE",
                "KeySchema": [{"AttributeName": name, "KeyType": kind} for (name, _), kind in keys],
                "AttributeDefinitions": [{"AttributeName": name, "AttributeType": t} for (name, t), _ in keys],
            }
        },
        {"TableName": table},
    )


class TestListTables:
    @patch("backend.routes.dynamodb.get_client")
    def test_list_tables_empty(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        paginator = MagicMock()
        mock_ddb.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"TableNames": []}]

        resp = client.get("/api/dynamodb/tables")
        assert resp.status_code == 200
        data = resp.json()
        assert "tables" in data
        assert data["tables"] == []

    @patch("backend.routes.dynamodb.get_client")
    def test_list_tables_with_data(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        paginator = MagicMock()
        mock_ddb.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"TableNames": ["users"]}]
        mock_ddb.describe_table.return_value = {
            "Table": {
                "TableName": "users",
                "TableStatus": "ACTIVE",
                "ItemCount": 42,
                "TableSizeBytes": 2048,
                "KeySchema": [
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                "AttributeDefinitions": [
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
                "BillingModeSummary": {"BillingMode": "PAY_PER_REQUEST"},
                "CreationDateTime": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        }

        resp = client.get("/api/dynamodb/tables")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["tables"]) == 1
        table = data["tables"][0]
        assert table["name"] == "users"
        assert table["status"] == "ACTIVE"
        assert table["item_count"] == 42
        assert table["partition_key"] == "pk"
        assert table["sort_key"] == "sk"
        assert table["billing_mode"] == "PAY_PER_REQUEST"


class TestGetTableDetail:
    @patch("backend.routes.dynamodb.get_client")
    def test_get_table_detail(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "TableName": "orders",
                "TableStatus": "ACTIVE",
                "ItemCount": 100,
                "TableSizeBytes": 4096,
                "KeySchema": [
                    {"AttributeName": "order_id", "KeyType": "HASH"},
                ],
                "AttributeDefinitions": [
                    {"AttributeName": "order_id", "AttributeType": "S"},
                ],
                "BillingModeSummary": {"BillingMode": "PROVISIONED"},
                "CreationDateTime": datetime(2024, 6, 15, tzinfo=timezone.utc),
                "GlobalSecondaryIndexes": [],
                "LocalSecondaryIndexes": [],
            }
        }

        resp = client.get("/api/dynamodb/tables/orders")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "orders"
        assert data["partition_key"] == "order_id"
        assert data["partition_key_type"] == "S"
        assert data["sort_key"] is None
        assert data["item_count"] == 100


class TestScanTable:
    @patch("backend.routes.dynamodb.get_client")
    def test_scan_returns_items(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.scan.return_value = {
            "Items": [
                {"pk": {"S": "user1"}, "name": {"S": "Alice"}},
                {"pk": {"S": "user2"}, "name": {"S": "Bob"}},
            ],
            "Count": 2,
            "ScannedCount": 2,
        }

        resp = client.get("/api/dynamodb/tables/users/items?limit=25")
        assert resp.status_code == 200
        data = resp.json()
        assert data["table"] == "users"
        assert data["count"] == 2
        assert len(data["items"]) == 2
        assert data["next_token"] is None

    @patch("backend.routes.dynamodb.get_client")
    def test_scan_with_pagination(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.scan.return_value = {
            "Items": [{"pk": {"S": "user1"}}],
            "Count": 1,
            "ScannedCount": 1,
            "LastEvaluatedKey": {"pk": {"S": "user1"}},
        }

        resp = client.get("/api/dynamodb/tables/users/items?limit=1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["next_token"] is not None

    @patch("backend.routes.dynamodb.get_client")
    def test_scan_empty_table(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.scan.return_value = {
            "Items": [],
            "Count": 0,
            "ScannedCount": 0,
        }

        resp = client.get("/api/dynamodb/tables/empty/items")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["count"] == 0


class TestQueryTable:
    @patch("backend.routes.dynamodb.get_client")
    def test_query_by_partition_key(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [
                    {"AttributeName": "pk", "AttributeType": "S"},
                ],
            }
        }
        mock_ddb.query.return_value = {
            "Items": [{"pk": {"S": "user1"}, "data": {"S": "hello"}}],
            "Count": 1,
            "ScannedCount": 1,
        }

        resp = client.post(
            "/api/dynamodb/tables/users/query",
            json={"partition_key_value": "user1", "limit": 25},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["table"] == "users"
        assert data["count"] == 1
        assert data["items"][0]["pk"]["S"] == "user1"

    @patch("backend.routes.dynamodb.get_client")
    def test_query_with_sort_key(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                "AttributeDefinitions": [
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
            }
        }
        mock_ddb.query.return_value = {
            "Items": [{"pk": {"S": "user1"}, "sk": {"S": "profile"}}],
            "Count": 1,
            "ScannedCount": 1,
        }

        resp = client.post(
            "/api/dynamodb/tables/users/query",
            json={
                "partition_key_value": "user1",
                "sort_key_value": "profile",
                "sort_key_operator": "=",
                "limit": 25,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1

    @patch("backend.routes.dynamodb.get_client")
    def test_query_with_begins_with(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                "AttributeDefinitions": [
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
            }
        }
        mock_ddb.query.return_value = {"Items": [], "Count": 0, "ScannedCount": 0}

        resp = client.post(
            "/api/dynamodb/tables/users/query",
            json={
                "partition_key_value": "user1",
                "sort_key_value": "order#",
                "sort_key_operator": "BEGINS_WITH",
                "limit": 25,
            },
        )
        assert resp.status_code == 200
        # Verify the query used begins_with
        call_kwargs = mock_ddb.query.call_args[1]
        assert "begins_with" in call_kwargs["KeyConditionExpression"]


class TestItemWrites:
    @patch("backend.routes.dynamodb.get_client")
    def test_put_item_dynamodb(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            }
        }

        resp = client.put(
            "/api/dynamodb/tables/t1/items",
            json={"item": {"pk": {"S": "a"}, "name": {"S": "X"}}, "item_format": "dynamodb"},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        mock_ddb.put_item.assert_called_once()
        call_kw = mock_ddb.put_item.call_args[1]
        assert call_kw["TableName"] == "t1"
        assert call_kw["Item"]["pk"]["S"] == "a"

    @patch("backend.routes.dynamodb.get_client")
    def test_put_item_plain(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            }
        }

        resp = client.post(
            "/api/dynamodb/tables/t1/items",
            json={"item": {"pk": "hello", "n": 42}, "item_format": "plain"},
        )
        assert resp.status_code == 200
        it = mock_ddb.put_item.call_args[1]["Item"]
        assert it["pk"]["S"] == "hello"
        assert it["n"]["N"] == "42"

    @patch("backend.routes.dynamodb.get_client")
    def test_put_item_missing_key_returns_400(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                "AttributeDefinitions": [
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
            }
        }

        resp = client.post(
            "/api/dynamodb/tables/t1/items",
            json={"item": {"pk": {"S": "a"}}, "item_format": "dynamodb"},
        )
        assert resp.status_code == 400
        assert "sort" in resp.json()["detail"].lower() or "sk" in resp.json()["detail"].lower()

    @patch("backend.routes.dynamodb.get_client")
    def test_delete_item(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            }
        }

        resp = client.request(
            "DELETE",
            "/api/dynamodb/tables/t1/items",
            json={"key": {"pk": {"S": "a"}}, "item_format": "dynamodb"},
        )
        assert resp.status_code == 200
        call_kw = mock_ddb.delete_item.call_args[1]
        assert call_kw["Key"]["pk"]["S"] == "a"
        assert call_kw["TableName"] == "t1"

    @patch("backend.routes.dynamodb.get_client")
    def test_batch_write(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            }
        }
        mock_ddb.batch_write_item.return_value = {"UnprocessedItems": {}}

        resp = client.post(
            "/api/dynamodb/tables/t1/items/batch",
            json={
                "item_format": "dynamodb",
                "operations": [
                    {"op": "put", "item": {"pk": {"S": "1"}}},
                    {"op": "delete", "key": {"pk": {"S": "2"}}},
                ],
            },
        )
        assert resp.status_code == 200
        req = mock_ddb.batch_write_item.call_args[1]["RequestItems"]
        assert "t1" in req
        assert len(req["t1"]) == 2
        assert "PutRequest" in req["t1"][0]
        assert "DeleteRequest" in req["t1"][1]

    @patch("backend.routes.dynamodb.cache.delete")
    @patch("backend.routes.dynamodb.get_client")
    def test_batch_write_partial_invalidates_cache(self, mock_get_client, mock_cache_delete):
        """Cache must be invalidated even when some items are unprocessed,
        because items NOT listed in UnprocessedItems were already written."""
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.describe_table.return_value = {
            "Table": {
                "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            }
        }
        unprocessed = {"t1": [{"PutRequest": {"Item": {"pk": {"S": "1"}}}}]}
        mock_ddb.batch_write_item.return_value = {"UnprocessedItems": unprocessed}

        resp = client.post(
            "/api/dynamodb/tables/t1/items/batch",
            json={
                "item_format": "dynamodb",
                "operations": [
                    {"op": "put", "item": {"pk": {"S": "1"}}},
                    {"op": "put", "item": {"pk": {"S": "2"}}},
                ],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["unprocessed"] == unprocessed
        assert "message" in body

        cache_keys = [c.args[0] for c in mock_cache_delete.call_args_list]
        assert any(k.endswith(":dynamodb:item_count:t1") for k in cache_keys), (
            f"expected item_count cache invalidation, got calls: {cache_keys}"
        )


# Binary attributes (#176). b"\x00\x8e\xff" is not valid UTF-8, which is what
# crashed FastAPI's encoder; its base64 form is "AI7/".
RAW = b"\x00\x8e\xff"
RAW_B64 = "AI7/"


def _hash_table(mock_ddb, key_type="S"):
    mock_ddb.describe_table.return_value = {
        "Table": {
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
            "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": key_type}],
        }
    }


class TestBinaryAttributes:
    @patch("backend.routes.dynamodb.get_client")
    def test_scan_returns_binary_as_base64(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.scan.return_value = {
            "Items": [
                {
                    "pk": {"S": "a"},
                    "blob": {"B": RAW},
                    "set": {"BS": [RAW, b"ok"]},
                    "nested": {"M": {"inner": {"B": RAW}, "list": {"L": [{"B": RAW}, {"S": "keep"}]}}},
                }
            ],
            "ScannedCount": 1,
        }

        resp = client.get("/api/dynamodb/tables/t1/items")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["pk"] == {"S": "a"}
        assert item["blob"] == {"B": RAW_B64}
        assert item["set"] == {"BS": [RAW_B64, "b2s="]}
        assert item["nested"]["M"]["inner"] == {"B": RAW_B64}
        assert item["nested"]["M"]["list"]["L"] == [{"B": RAW_B64}, {"S": "keep"}]

    @patch("backend.routes.dynamodb.get_client")
    def test_scan_paginates_on_a_binary_key(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        mock_ddb.scan.return_value = {
            "Items": [{"pk": {"B": RAW}}],
            "ScannedCount": 1,
            "LastEvaluatedKey": {"pk": {"B": RAW}},
        }

        first = client.get("/api/dynamodb/tables/t1/items?limit=1")
        assert first.status_code == 200
        body = first.json()
        assert "error" not in body
        assert body["next_token"]

        client.get(f"/api/dynamodb/tables/t1/items?limit=1&exclusive_start_key={body['next_token']}")
        assert mock_ddb.scan.call_args[1]["ExclusiveStartKey"] == {"pk": {"B": RAW}}

    @patch("backend.routes.dynamodb.get_client")
    def test_query_on_a_binary_partition_key(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb, key_type="B")
        mock_ddb.query.return_value = {"Items": [{"pk": {"B": RAW}}], "ScannedCount": 1}

        resp = client.post("/api/dynamodb/tables/t1/query", json={"partition_key_value": RAW_B64})
        assert resp.status_code == 200
        assert resp.json()["items"] == [{"pk": {"B": RAW_B64}}]
        assert mock_ddb.query.call_args[1]["ExpressionAttributeValues"][":pk"] == {"B": RAW}

    @patch("backend.routes.dynamodb.get_client")
    def test_query_with_invalid_base64_key_is_400(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb, key_type="B")

        resp = client.post("/api/dynamodb/tables/t1/query", json={"partition_key_value": "not base64!"})
        assert resp.status_code == 400
        mock_ddb.query.assert_not_called()

    @patch("backend.routes.dynamodb.get_client")
    def test_put_decodes_base64_to_bytes(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb)

        resp = client.put(
            "/api/dynamodb/tables/t1/items",
            json={
                "item": {"pk": {"S": "a"}, "blob": {"B": RAW_B64}, "set": {"BS": [RAW_B64]}, "m": {"M": {"x": {"B": RAW_B64}}}},
                "item_format": "dynamodb",
            },
        )
        assert resp.status_code == 200
        item = mock_ddb.put_item.call_args[1]["Item"]
        assert item["pk"] == {"S": "a"}
        assert item["blob"] == {"B": RAW}
        assert item["set"] == {"BS": [RAW]}
        assert item["m"] == {"M": {"x": {"B": RAW}}}

    @patch("backend.routes.dynamodb.get_client")
    def test_put_with_invalid_base64_is_400(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb)

        resp = client.put(
            "/api/dynamodb/tables/t1/items",
            json={"item": {"pk": {"S": "a"}, "blob": {"B": "not base64!"}}, "item_format": "dynamodb"},
        )
        assert resp.status_code == 400
        assert "blob" in resp.json()["detail"]
        mock_ddb.put_item.assert_not_called()

    @patch("backend.routes.dynamodb.get_client")
    def test_delete_and_batch_delete_by_binary_key(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb, key_type="B")
        mock_ddb.batch_write_item.return_value = {"UnprocessedItems": {}}

        resp = client.request(
            "DELETE", "/api/dynamodb/tables/t1/items", json={"key": {"pk": {"B": RAW_B64}}, "item_format": "dynamodb"}
        )
        assert resp.status_code == 200
        assert mock_ddb.delete_item.call_args[1]["Key"] == {"pk": {"B": RAW}}

        resp = client.post(
            "/api/dynamodb/tables/t1/items/batch",
            json={"item_format": "dynamodb", "operations": [{"op": "delete", "key": {"pk": {"B": RAW_B64}}}]},
        )
        assert resp.status_code == 200
        req = mock_ddb.batch_write_item.call_args[1]["RequestItems"]["t1"]
        assert req == [{"DeleteRequest": {"Key": {"pk": {"B": RAW}}}}]

    @patch("backend.routes.dynamodb.get_client")
    def test_batch_unprocessed_binary_is_returned_as_base64(self, mock_get_client):
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb, key_type="B")
        mock_ddb.batch_write_item.return_value = {
            "UnprocessedItems": {"t1": [{"PutRequest": {"Item": {"pk": {"B": RAW}}}}]}
        }

        resp = client.post(
            "/api/dynamodb/tables/t1/items/batch",
            json={"item_format": "dynamodb", "operations": [{"op": "put", "item": {"pk": {"B": RAW_B64}}}]},
        )
        assert resp.status_code == 200
        assert resp.json()["unprocessed"] == {"t1": [{"PutRequest": {"Item": {"pk": {"B": RAW_B64}}}}]}

    @patch("backend.routes.dynamodb.get_client")
    def test_scan_output_round_trips_through_put(self, mock_get_client):
        """What Edit does: take an item from the scan and save it unchanged."""
        mock_ddb = MagicMock()
        mock_get_client.return_value = mock_ddb
        _hash_table(mock_ddb)
        original = {"pk": {"S": "a"}, "blob": {"B": RAW}, "set": {"BS": [RAW, b"ok"]}}
        mock_ddb.scan.return_value = {"Items": [original], "ScannedCount": 1}

        scanned = client.get("/api/dynamodb/tables/t1/items").json()["items"][0]
        client.put("/api/dynamodb/tables/t1/items", json={"item": scanned, "item_format": "dynamodb"})
        assert mock_ddb.put_item.call_args[1]["Item"] == original


def send_json(path: str, body: str, method: str = "POST"):
    """Send ``body`` as written, so numbers reach the route with every digit a client typed."""
    return client.request(method, path, content=body, headers={"Content-Type": "application/json"})


class TestPlainJsonNumbers:
    """Plain JSON numbers reach DynamoDB exactly as written (#197)."""

    def test_put_keeps_decimals_big_ints_and_nested_numbers(self, stubber):
        describes(stubber, "Orders", ("pk", "S"))
        stubber.add_response(
            "put_item",
            {},
            {
                "TableName": "Orders",
                "Item": {
                    "pk": {"S": "o1"},
                    "score": {"N": "9.75"},
                    "precise": {"N": "0.12345678901234567890123"},
                    "big": {"N": "12345678901234567890"},
                    "negative": {"N": "-0.5"},
                    "exponent": {"N": "1.5E+3"},
                    "count": {"N": "3"},
                    "nested": {
                        "M": {
                            "rate": {"N": "0.1"},
                            "history": {"L": [{"N": "1.25"}, {"N": "2"}, {"M": {"x": {"N": "3.5"}}}]},
                        }
                    },
                },
            },
        )

        resp = send_json(
            "/api/dynamodb/tables/Orders/items",
            '{"item_format": "plain", "item": {"pk": "o1", "score": 9.75, "precise": 0.12345678901234567890123,'
            ' "big": 12345678901234567890, "negative": -0.5, "exponent": 1.5e3, "count": 3,'
            ' "nested": {"rate": 0.1, "history": [1.25, 2, {"x": 3.5}]}}}',
        )

        assert resp.status_code == 200, resp.text

    def test_edit_saves_a_decimal(self, stubber):
        describes(stubber, "Orders", ("pk", "S"))
        stubber.add_response("put_item", {}, {"TableName": "Orders", "Item": {"pk": {"S": "o1"}, "price": {"N": "9.99"}}})

        resp = send_json("/api/dynamodb/tables/Orders/items", '{"item_format": "plain", "item": {"pk": "o1", "price": 9.99}}', "PUT")

        assert resp.status_code == 200, resp.text

    def test_delete_by_a_decimal_number_key(self, stubber):
        describes(stubber, "Readings", ("sensor", "S"), ("at", "N"))
        stubber.add_response("delete_item", {}, {"TableName": "Readings", "Key": {"sensor": {"S": "s1"}, "at": {"N": "1.5"}}})

        resp = send_json(
            "/api/dynamodb/tables/Readings/items", '{"item_format": "plain", "key": {"sensor": "s1", "at": 1.5}}', "DELETE"
        )

        assert resp.status_code == 200, resp.text

    def test_batch_puts_and_deletes_with_decimals(self, stubber):
        describes(stubber, "Readings", ("sensor", "S"), ("at", "N"))
        stubber.add_response(
            "batch_write_item",
            {"UnprocessedItems": {}},
            {
                "RequestItems": {
                    "Readings": [
                        {"PutRequest": {"Item": {"sensor": {"S": "s1"}, "at": {"N": "2.5"}, "temp": {"N": "21.75"}}}},
                        {"DeleteRequest": {"Key": {"sensor": {"S": "s1"}, "at": {"N": "1.5"}}}},
                    ]
                }
            },
        )

        resp = send_json(
            "/api/dynamodb/tables/Readings/items/batch",
            '{"item_format": "plain", "operations": ['
            '{"op": "put", "item": {"sensor": "s1", "at": 2.5, "temp": 21.75}},'
            ' {"op": "delete", "key": {"sensor": "s1", "at": 1.5}}]}',
        )

        assert resp.status_code == 200, resp.text

    @pytest.mark.parametrize(
        "number",
        [
            "1e-300",  # smaller than the smallest magnitude DynamoDB stores
            "1e300",  # larger than the largest
            "1234567890123456789012345678901234567890",  # 40 significant digits, DynamoDB keeps 38
        ],
    )
    def test_a_number_dynamodb_cannot_store_is_a_400_naming_the_attribute(self, stubber, number):
        describes(stubber, "Orders", ("pk", "S"))

        resp = send_json("/api/dynamodb/tables/Orders/items", f'{{"item_format": "plain", "item": {{"pk": "o1", "reading": {number}}}}}')

        assert resp.status_code == 400
        assert "'reading'" in resp.json()["detail"]
        assert "38 significant digits" in resp.json()["detail"]

    def test_nan_is_a_400(self, stubber):
        describes(stubber, "Orders", ("pk", "S"))

        resp = send_json("/api/dynamodb/tables/Orders/items", '{"item_format": "plain", "item": {"pk": "o1", "reading": NaN}}')

        assert resp.status_code == 400
        assert "NaN" in resp.json()["detail"]


def table_missing(stub: Stubber, operation: str) -> None:
    """DynamoDB's answer for a table that doesn't exist (HTTP 400, like AWS and the emulators)."""
    stub.add_client_error(
        operation,
        service_error_code="ResourceNotFoundException",
        service_message="Requested resource not found",
        http_status_code=400,
    )


class TestMissingTable:
    """A table that doesn't exist is a 404 with a readable message, never a 200 carrying an error."""

    def test_scan(self, stubber):
        table_missing(stubber, "scan")

        resp = client.get("/api/dynamodb/tables/NoSuchTable/items")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Table 'NoSuchTable' not found"

    def test_detail(self, stubber):
        table_missing(stubber, "describe_table")

        resp = client.get("/api/dynamodb/tables/NoSuchTable")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Table 'NoSuchTable' not found"

    def test_query(self, stubber):
        table_missing(stubber, "describe_table")

        resp = client.post("/api/dynamodb/tables/NoSuchTable/query", json={"partition_key_value": "a"})

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Table 'NoSuchTable' not found"

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("POST", "/items", {"item": {"pk": {"S": "a"}}}),
            ("PUT", "/items", {"item": {"pk": {"S": "a"}}}),
            ("DELETE", "/items", {"key": {"pk": {"S": "a"}}}),
            ("POST", "/items/batch", {"operations": [{"op": "put", "item": {"pk": {"S": "a"}}}]}),
        ],
    )
    def test_writes(self, stubber, method, path, body):
        table_missing(stubber, "describe_table")

        resp = client.request(method, f"/api/dynamodb/tables/NoSuchTable{path}", json=body)

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Table 'NoSuchTable' not found"


class TestReadFailures:
    def test_another_scan_error_keeps_its_status_and_message(self, stubber):
        stubber.add_client_error(
            "scan",
            service_error_code="ProvisionedThroughputExceededException",
            service_message="The level of configured provisioned throughput for the table was exceeded.",
            http_status_code=400,
        )

        resp = client.get("/api/dynamodb/tables/Orders/items")

        assert resp.status_code == 400
        assert resp.json()["detail"] == "The level of configured provisioned throughput for the table was exceeded."

    def test_query_error_keeps_its_status_and_message(self, stubber):
        describes(stubber, "Orders", ("pk", "S"))
        stubber.add_client_error(
            "query", service_error_code="ValidationException", service_message="Invalid KeyConditionExpression", http_status_code=400
        )

        resp = client.post("/api/dynamodb/tables/Orders/query", json={"partition_key_value": "a"})

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Invalid KeyConditionExpression"

    def test_invalid_page_token_is_a_400_not_the_first_page_again(self, stubber):
        resp = client.get("/api/dynamodb/tables/Orders/items", params={"exclusive_start_key": "not-a-token"})

        assert resp.status_code == 400
        assert "exclusive_start_key" in resp.json()["detail"]
