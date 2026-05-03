"""Integration tests for Secrets Manager API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

CREATED = datetime(2025, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
CHANGED = datetime(2025, 3, 20, 14, 0, 0, tzinfo=timezone.utc)


class TestListSecrets:
    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_empty(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        paginator = MagicMock()
        mock_sm.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"SecretList": []}]

        resp = client.get("/api/secretsmanager/secrets")
        assert resp.status_code == 200
        data = resp.json()
        assert data["secrets"] == []

    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_with_data(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        paginator = MagicMock()
        mock_sm.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "SecretList": [
                    {
                        "Name": "prod/db-password",
                        "ARN": "arn:aws:secretsmanager:us-east-1:000:secret:prod/db-password-abc",
                        "Description": "Production database password",
                        "CreatedDate": CREATED,
                        "LastChangedDate": CHANGED,
                        "LastAccessedDate": None,
                        "RotationEnabled": False,
                        "Tags": [
                            {"Key": "env", "Value": "prod"},
                            {"Key": "team", "Value": "backend"},
                        ],
                    }
                ]
            }
        ]

        resp = client.get("/api/secretsmanager/secrets")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["secrets"]) == 1
        s = data["secrets"][0]
        assert s["name"] == "prod/db-password"
        assert s["arn"] == "arn:aws:secretsmanager:us-east-1:000:secret:prod/db-password-abc"
        assert s["description"] == "Production database password"
        assert s["createdDate"] == CREATED.isoformat()
        assert s["lastChangedDate"] == CHANGED.isoformat()
        assert s["lastAccessedDate"] is None
        assert s["rotationEnabled"] is False
        assert s["tags"] == {"env": "prod", "team": "backend"}

    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_no_tags(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        paginator = MagicMock()
        mock_sm.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "SecretList": [
                    {
                        "Name": "my-secret",
                        "ARN": "arn:aws:secretsmanager:us-east-1:000:secret:my-secret-xyz",
                    }
                ]
            }
        ]

        resp = client.get("/api/secretsmanager/secrets")
        assert resp.status_code == 200
        s = resp.json()["secrets"][0]
        assert s["tags"] == {}
        assert s["description"] == ""
        assert s["rotationEnabled"] is False

    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_multiple_pages(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        paginator = MagicMock()
        mock_sm.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {"SecretList": [{"Name": "secret-1", "ARN": "arn:1"}]},
            {"SecretList": [{"Name": "secret-2", "ARN": "arn:2"}]},
        ]

        resp = client.get("/api/secretsmanager/secrets")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["secrets"]) == 2
        assert data["secrets"][0]["name"] == "secret-1"
        assert data["secrets"][1]["name"] == "secret-2"

    @patch("backend.routes.secretsmanager.get_client")
    def test_list_secrets_rotation_enabled(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        paginator = MagicMock()
        mock_sm.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "SecretList": [
                    {
                        "Name": "rotated-secret",
                        "ARN": "arn:rotated",
                        "RotationEnabled": True,
                    }
                ]
            }
        ]

        resp = client.get("/api/secretsmanager/secrets")
        assert resp.status_code == 200
        assert resp.json()["secrets"][0]["rotationEnabled"] is True


class TestGetSecretDetail:
    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_with_string_value(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "Name": "prod/db-password",
            "ARN": "arn:aws:secretsmanager:us-east-1:000:secret:prod/db-password-abc",
            "Description": "Production database password",
            "CreatedDate": CREATED,
            "LastChangedDate": CHANGED,
            "LastAccessedDate": None,
            "RotationEnabled": False,
            "RotationRules": None,
            "RotationLambdaARN": None,
            "DeletedDate": None,
            "Tags": [{"Key": "env", "Value": "prod"}],
        }
        mock_sm.get_secret_value.return_value = {
            "SecretString": '{"username":"admin","password":"s3cret"}',
            "VersionId": "ver-001",
            "VersionStages": ["AWSCURRENT"],
        }

        resp = client.get("/api/secretsmanager/secrets/prod%2Fdb-password")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "prod/db-password"
        assert data["description"] == "Production database password"
        assert data["secretValue"] == '{"username":"admin","password":"s3cret"}'
        assert data["secretBinary"] is None
        assert data["versionId"] == "ver-001"
        assert data["versionStages"] == ["AWSCURRENT"]
        assert data["tags"] == {"env": "prod"}
        assert data["createdDate"] == CREATED.isoformat()
        assert data["rotationEnabled"] is False

    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_with_binary_value(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "Name": "binary-secret",
            "ARN": "arn:binary",
            "Tags": [],
        }
        raw_bytes = b"\x00\x01\x02\x03\xff"
        mock_sm.get_secret_value.return_value = {
            "SecretBinary": raw_bytes,
            "VersionId": "ver-bin",
            "VersionStages": ["AWSCURRENT"],
        }

        resp = client.get("/api/secretsmanager/secrets/binary-secret")
        assert resp.status_code == 200
        data = resp.json()
        assert data["secretValue"] is None
        import base64
        assert data["secretBinary"] == base64.b64encode(raw_bytes).decode("utf-8")
        assert data["versionId"] == "ver-bin"

    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_not_found(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.exceptions.ResourceNotFoundException = type(
            "ResourceNotFoundException", (Exception,), {}
        )
        mock_sm.describe_secret.side_effect = (
            mock_sm.exceptions.ResourceNotFoundException()
        )

        resp = client.get("/api/secretsmanager/secrets/nonexistent")
        assert resp.status_code == 404

    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_value_not_retrievable(self, mock_get_client):
        """When get_secret_value fails (e.g. pending deletion), metadata is still returned."""
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "Name": "deleted-secret",
            "ARN": "arn:deleted",
            "DeletedDate": CHANGED,
            "Tags": [],
        }
        mock_sm.get_secret_value.side_effect = Exception("marked for deletion")

        resp = client.get("/api/secretsmanager/secrets/deleted-secret")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "deleted-secret"
        assert data["secretValue"] is None
        assert data["secretBinary"] is None
        assert data["versionId"] is None
        assert data["versionStages"] is None
        assert data["deletedDate"] == CHANGED.isoformat()

    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_with_rotation(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "Name": "rotated-secret",
            "ARN": "arn:rotated",
            "RotationEnabled": True,
            "RotationRules": {"AutomaticallyAfterDays": 30},
            "RotationLambdaARN": "arn:aws:lambda:us-east-1:000:function:rotate-fn",
            "Tags": [],
        }
        mock_sm.get_secret_value.return_value = {
            "SecretString": "rotated-value",
            "VersionId": "ver-rot",
            "VersionStages": ["AWSCURRENT"],
        }

        resp = client.get("/api/secretsmanager/secrets/rotated-secret")
        assert resp.status_code == 200
        data = resp.json()
        assert data["rotationEnabled"] is True
        assert data["rotationRules"] == {"AutomaticallyAfterDays": 30}
        assert data["rotationLambdaARN"] == "arn:aws:lambda:us-east-1:000:function:rotate-fn"
        assert data["secretValue"] == "rotated-value"

    @patch("backend.routes.secretsmanager.get_client")
    def test_get_secret_plain_text_value(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "Name": "api-key",
            "ARN": "arn:api-key",
            "Tags": [],
        }
        mock_sm.get_secret_value.return_value = {
            "SecretString": "sk-abc123def456",
            "VersionId": "ver-plain",
            "VersionStages": ["AWSCURRENT"],
        }

        resp = client.get("/api/secretsmanager/secrets/api-key")
        assert resp.status_code == 200
        data = resp.json()
        assert data["secretValue"] == "sk-abc123def456"


class TestCreateSecret:
    @patch("backend.routes.secretsmanager.get_client")
    def test_create_secret_with_string(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.create_secret.return_value = {
            "Name": "test-secret",
            "ARN": "arn:aws:secretsmanager:us-east-1:000:secret:test-secret-abc",
            "VersionId": "v1",
        }

        resp = client.post(
            "/api/secretsmanager/secrets",
            json={
                "name": "test-secret",
                "description": "Test secret",
                "secret_string": "my-secret-value",
                "tags": {"env": "test"},
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "test-secret"
        assert data["arn"] == "arn:aws:secretsmanager:us-east-1:000:secret:test-secret-abc"
        assert data["versionId"] == "v1"

        mock_sm.create_secret.assert_called_once()
        call_kwargs = mock_sm.create_secret.call_args[1]
        assert call_kwargs["Name"] == "test-secret"
        assert call_kwargs["Description"] == "Test secret"
        assert call_kwargs["SecretString"] == "my-secret-value"
        assert call_kwargs["Tags"] == [{"Key": "env", "Value": "test"}]

    @patch("backend.routes.secretsmanager.get_client")
    def test_create_secret_with_binary(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.create_secret.return_value = {
            "Name": "binary-secret",
            "ARN": "arn:binary",
            "VersionId": "v1",
        }

        import base64
        binary_data = base64.b64encode(b"\x00\x01\x02").decode("utf-8")

        resp = client.post(
            "/api/secretsmanager/secrets",
            json={"name": "binary-secret", "secret_binary": binary_data},
        )
        assert resp.status_code == 201

        call_kwargs = mock_sm.create_secret.call_args[1]
        assert call_kwargs["SecretBinary"] == b"\x00\x01\x02"

    @patch("backend.routes.secretsmanager.get_client")
    def test_create_secret_duplicate_name(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.exceptions.ResourceExistsException = type(
            "ResourceExistsException", (Exception,), {}
        )
        mock_sm.create_secret.side_effect = mock_sm.exceptions.ResourceExistsException()

        resp = client.post(
            "/api/secretsmanager/secrets",
            json={"name": "existing", "secret_string": "value"},
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    @patch("backend.routes.secretsmanager.get_client")
    def test_create_secret_no_value(self, mock_get_client):
        resp = client.post(
            "/api/secretsmanager/secrets",
            json={"name": "test"},
        )
        assert resp.status_code == 400
        assert "secret_string or secret_binary" in resp.json()["detail"]


class TestUpdateSecretValue:
    @patch("backend.routes.secretsmanager.get_client")
    def test_update_secret_value(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.put_secret_value.return_value = {
            "ARN": "arn:test",
            "Name": "test-secret",
            "VersionId": "v2",
            "VersionStages": ["AWSCURRENT"],
        }

        resp = client.put(
            "/api/secretsmanager/secrets/test-secret/value",
            json={"secret_string": "new-value"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test-secret"
        assert data["versionId"] == "v2"

        mock_sm.put_secret_value.assert_called_once()
        call_kwargs = mock_sm.put_secret_value.call_args[1]
        assert call_kwargs["SecretId"] == "test-secret"
        assert call_kwargs["SecretString"] == "new-value"

    @patch("backend.routes.secretsmanager.get_client")
    def test_update_secret_value_not_found(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.exceptions.ResourceNotFoundException = type(
            "ResourceNotFoundException", (Exception,), {}
        )
        mock_sm.put_secret_value.side_effect = (
            mock_sm.exceptions.ResourceNotFoundException()
        )

        resp = client.put(
            "/api/secretsmanager/secrets/nonexistent/value",
            json={"secret_string": "value"},
        )
        assert resp.status_code == 404


class TestUpdateSecretMetadata:
    @patch("backend.routes.secretsmanager.get_client")
    def test_update_description(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm

        resp = client.put(
            "/api/secretsmanager/secrets/test-secret/metadata",
            json={"description": "New description"},
        )
        assert resp.status_code == 200
        mock_sm.update_secret.assert_called_once_with(
            SecretId="test-secret", Description="New description"
        )

    @patch("backend.routes.secretsmanager.get_client")
    def test_update_tags(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.describe_secret.return_value = {
            "ARN": "arn:test",
            "Tags": [{"Key": "old", "Value": "tag"}],
        }

        resp = client.put(
            "/api/secretsmanager/secrets/test-secret/metadata",
            json={"tags": {"new": "tag"}},
        )
        assert resp.status_code == 200
        mock_sm.untag_resource.assert_called_once()
        mock_sm.tag_resource.assert_called_once()


class TestDeleteSecret:
    @patch("backend.routes.secretsmanager.get_client")
    def test_delete_secret_with_recovery(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.delete_secret.return_value = {
            "ARN": "arn:test",
            "Name": "test-secret",
            "DeletionDate": CHANGED,
        }

        resp = client.delete("/api/secretsmanager/secrets/test-secret")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test-secret"
        assert data["deletionDate"] == CHANGED.isoformat()

        call_kwargs = mock_sm.delete_secret.call_args[1]
        assert call_kwargs["RecoveryWindowInDays"] == 7
        assert "ForceDeleteWithoutRecovery" not in call_kwargs

    @patch("backend.routes.secretsmanager.get_client")
    def test_delete_secret_force(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.delete_secret.return_value = {
            "ARN": "arn:test",
            "Name": "test-secret",
            "DeletionDate": CHANGED,
        }

        resp = client.delete("/api/secretsmanager/secrets/test-secret?force=true")
        assert resp.status_code == 200

        call_kwargs = mock_sm.delete_secret.call_args[1]
        assert call_kwargs["ForceDeleteWithoutRecovery"] is True
        assert "RecoveryWindowInDays" not in call_kwargs


class TestRestoreSecret:
    @patch("backend.routes.secretsmanager.get_client")
    def test_restore_secret(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm
        mock_sm.restore_secret.return_value = {
            "ARN": "arn:test",
            "Name": "test-secret",
        }

        resp = client.post("/api/secretsmanager/secrets/test-secret/restore")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test-secret"

    @patch("backend.routes.secretsmanager.get_client")
    def test_restore_secret_not_deleted(self, mock_get_client):
        mock_sm = MagicMock()
        mock_get_client.return_value = mock_sm

        error = Exception("Invalid request")
        error.response = {
            "Error": {"Code": "InvalidRequestException", "Message": "Secret not in deleted state"}
        }
        mock_sm.restore_secret.side_effect = error

        resp = client.post("/api/secretsmanager/secrets/test-secret/restore")
        assert resp.status_code == 400
