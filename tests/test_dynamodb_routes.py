"""Integration tests for DynamoDB API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


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
