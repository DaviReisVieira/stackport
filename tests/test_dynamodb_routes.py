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
