"""Tests for tag management and bulk operation routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _mock_get_client(service, *args, **kwargs):
    return MagicMock()


# --- GET tags ---


class TestGetResourceTags:
    @patch("backend.routes.tags.get_client")
    def test_get_s3_bucket_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {
            "TagSet": [{"Key": "env", "Value": "dev"}, {"Key": "team", "Value": "backend"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/s3/buckets/my-bucket/tags")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tags"] == {"env": "dev", "team": "backend"}
        assert data["service"] == "s3"
        assert data["type"] == "buckets"
        assert data["id"] == "my-bucket"

    @patch("backend.routes.tags.get_client")
    def test_get_s3_bucket_tags_empty(self, mock_gc):
        mock_client = MagicMock()
        from botocore.exceptions import ClientError

        mock_client.exceptions.ClientError = ClientError
        mock_client.get_bucket_tagging.side_effect = ClientError(
            {"Error": {"Code": "NoSuchTagSet", "Message": ""}}, "GetBucketTagging"
        )
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/s3/buckets/my-bucket/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {}

    @patch("backend.routes.tags.get_client")
    def test_get_lambda_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_function.return_value = {
            "Tags": {"project": "stackport", "version": "1.0"}
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/lambda/functions/my-func/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"project": "stackport", "version": "1.0"}

    @patch("backend.routes.tags.get_client")
    def test_get_dynamodb_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_table.return_value = {
            "Table": {"TableArn": "arn:aws:dynamodb:us-east-1:000:table/t1"}
        }
        mock_client.list_tags_of_resource.return_value = {
            "Tags": [{"Key": "env", "Value": "prod"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/dynamodb/tables/t1/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "prod"}

    @patch("backend.routes.tags.get_client")
    def test_get_sqs_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_queue_url.return_value = {"QueueUrl": "http://localhost:4566/q1"}
        mock_client.list_queue_tags.return_value = {"Tags": {"owner": "alice"}}
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/sqs/queues/q1/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"owner": "alice"}

    @patch("backend.routes.tags.get_client")
    def test_get_ec2_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_tags.return_value = {
            "Tags": [{"Key": "Name", "Value": "web-server"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/ec2/instances/i-123/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"Name": "web-server"}

    @patch("backend.routes.tags.get_client")
    def test_get_iam_user_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_user_tags.return_value = {
            "Tags": [{"Key": "dept", "Value": "eng"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/iam/users/alice/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"dept": "eng"}

    @patch("backend.routes.tags.get_client")
    def test_get_iam_role_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_role_tags.return_value = {
            "Tags": [{"Key": "env", "Value": "staging"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/iam/roles/my-role/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "staging"}

    @patch("backend.routes.tags.get_client")
    def test_get_secretsmanager_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_secret.return_value = {
            "Tags": [{"Key": "app", "Value": "web"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/secretsmanager/secrets/my-secret/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"app": "web"}

    @patch("backend.routes.tags.get_client")
    def test_get_logs_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {
            "tags": {"retention": "30d"}
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/resources/logs/log_groups/arn%3Aaws%3Alogs%3Aus-east-1%3A000%3Alog-group%3Amy-group/tags")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"retention": "30d"}

    def test_get_unsupported_service_returns_400(self):
        resp = client.get("/api/resources/unknown/things/id1/tags")
        assert resp.status_code == 400
        assert "not supported" in resp.json()["detail"].lower()


# --- PUT tags ---


class TestUpdateResourceTags:
    @patch("backend.routes.tags.get_client")
    def test_put_s3_bucket_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/resources/s3/buckets/my-bucket/tags",
            json={"tags": {"env": "prod", "team": "infra"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["tags"] == {"env": "prod", "team": "infra"}
        mock_client.put_bucket_tagging.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_s3_bucket_tags_empty_deletes(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/resources/s3/buckets/my-bucket/tags",
            json={"tags": {}},
        )
        assert resp.status_code == 200
        mock_client.delete_bucket_tagging.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_lambda_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_function.return_value = {
            "Configuration": {"FunctionArn": "arn:aws:lambda:us-east-1:000:function:f1"},
            "Tags": {"old": "tag"},
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/resources/lambda/functions/f1/tags",
            json={"tags": {"new": "tag"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.untag_resource.assert_called_once()
        mock_client.tag_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_ec2_instance_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_tags.return_value = {
            "Tags": [{"Key": "Name", "Value": "old"}]
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/resources/ec2/instances/i-123/tags",
            json={"tags": {"Name": "new-server"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.delete_tags.assert_called_once()
        mock_client.create_tags.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_iam_role_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_role_tags.return_value = {"Tags": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/resources/iam/roles/my-role/tags",
            json={"tags": {"env": "prod"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_role.assert_called_once()

    def test_put_unsupported_service_returns_400(self):
        resp = client.put(
            "/api/resources/unknown/things/id1/tags",
            json={"tags": {"a": "b"}},
        )
        assert resp.status_code == 400

    @patch("backend.routes.tags.get_client")
    def test_put_tags_server_error(self, mock_gc):
        mock_gc.side_effect = Exception("connection refused")

        resp = client.put(
            "/api/resources/s3/buckets/my-bucket/tags",
            json={"tags": {"a": "b"}},
        )
        assert resp.status_code == 500


# --- Bulk tag ---


class TestBulkTag:
    @patch("backend.routes.tags.get_client")
    def test_bulk_add_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {"TagSet": []}
        mock_client.get_function.return_value = {"Tags": {}}
        mock_client.get_function.return_value = {
            "Configuration": {"FunctionArn": "arn:aws:lambda:us-east-1:000:function:f1"},
            "Tags": {},
        }
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {"env": "staging"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "lambda", "type": "functions", "id": "f1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 2
        assert data["failed"] == 0

    @patch("backend.routes.tags.get_client")
    def test_bulk_remove_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {
            "TagSet": [{"Key": "env", "Value": "dev"}, {"Key": "team", "Value": "ops"}]
        }
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "remove",
                "tags": {"env": "dev"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 1

    @patch("backend.routes.tags.get_client")
    def test_bulk_tag_partial_failure(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {"TagSet": []}
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {"env": "prod"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "unknown", "type": "things", "id": "x"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 1
        assert data["failed"] == 1

    def test_bulk_tag_invalid_action(self):
        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "invalid",
                "tags": {"a": "b"},
                "resources": [{"service": "s3", "type": "buckets", "id": "b1"}],
            },
        )
        assert resp.status_code == 400

    def test_bulk_tag_empty_resources(self):
        resp = client.post(
            "/api/bulk/tag",
            json={"action": "add", "tags": {"a": "b"}, "resources": []},
        )
        assert resp.status_code == 400

    def test_bulk_tag_empty_tags(self):
        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {},
                "resources": [{"service": "s3", "type": "buckets", "id": "b1"}],
            },
        )
        assert resp.status_code == 400


# --- Bulk delete ---


class TestBulkDelete:
    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_resources(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "lambda", "type": "functions", "id": "f1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 2
        assert data["failed"] == 0

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_partial_failure(self, mock_gc):
        mock_client = MagicMock()
        mock_client.delete_bucket.side_effect = Exception("bucket not empty")
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert "bucket not empty" in data["results"][0]["error"]

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_unsupported_service(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "iam", "type": "users", "id": "alice"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert "not supported" in data["results"][0]["error"].lower()

    def test_bulk_delete_empty_resources(self):
        resp = client.post("/api/bulk/delete", json={"resources": []})
        assert resp.status_code == 400

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_ec2_instances(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "ec2", "type": "instances", "id": "i-123"},
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["succeeded"] == 1
        mock_client.terminate_instances.assert_called_once_with(InstanceIds=["i-123"])

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_sqs_queue(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_queue_url.return_value = {"QueueUrl": "http://localhost/q1"}
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "sqs", "type": "queues", "id": "q1"},
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["succeeded"] == 1
