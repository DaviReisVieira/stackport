"""Tests for KMS API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

NOW = datetime(2024, 6, 1, tzinfo=timezone.utc)


class TestListKeys:
    @patch("backend.routes.kms.get_client")
    def test_list_keys_empty(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms
        mock_kms.list_users.return_value = {"Keys": []}

        response = client.get("/api/kms/keys")

        assert response.status_code == 200
        data = response.json()
        assert data["keys"] == []

    @patch("backend.routes.kms.get_client")
    def test_list_keys_with_data(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms
        mock_kms.list_keys.return_value = {
            "Keys": [
                {
                    "KeyId": "test-id",
                    "KeyArn": "arn:aws:kms:us-east-1:000000000000:key/test-id",
                }
            ]
        }
        mock_kms.describe_key.return_value = {
            "KeyMetadata": {
                "AWSAccountId": "000000000000",
                "KeyId": "test-id",
                "Arn": "arn:aws:kms:us-east-1:000000000000:key/test-id",
                "CreationDate": NOW,
                "Enabled": True,
                "KeyUsage": "ENCRYPT_DECRYPT",
                "KeyState": "Enabled",
                "Origin": "AWS_KMS",
                "KeyManager": "CUSTOMER",
                "CustomerMasterKeySpec": "SYMMETRIC_DEFAULT",
                "KeySpec": "SYMMETRIC_DEFAULT",
                "EncryptionAlgorithms": ["SYMMETRIC_DEFAULT"],
            }
        }
        response = client.get("/api/kms/keys")

        assert response.status_code == 200
        data = response.json()
        assert data["keys"][0]["keyID"] == "test-id"
        assert (
            data["keys"][0]["keyArn"]
            == "arn:aws:kms:us-east-1:000000000000:key/test-id"
        )


class TestGetKeyDetail:
    @patch("backend.routes.kms.get_client")
    def test_get_key_detail(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms
        mock_kms.describe_key.return_value = {
            "KeyMetadata": {
                "AWSAccountId": "000000000000",
                "KeyId": "test-id",
                "Arn": "arn:aws:kms:us-east-1:000000000000:key/test-id",
                "CreationDate": NOW,
                "Enabled": True,
                "KeyUsage": "ENCRYPT_DECRYPT",
                "KeyState": "Enabled",
                "Origin": "AWS_KMS",
                "KeyManager": "CUSTOMER",
                "CustomerMasterKeySpec": "SYMMETRIC_DEFAULT",
                "KeySpec": "SYMMETRIC_DEFAULT",
                "EncryptionAlgorithms": ["SYMMETRIC_DEFAULT"],
            }
        }
        mock_kms.list_resource_tags.return_value = {"Tags": []}
        mock_kms.get_key_rotation_status.return_value = {"KeyRotationEnabled": False}

        response = client.get("/api/kms/keys/test-id")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "Enabled"
        assert data["tags"] == []
        assert data["rotationStatus"] == {"KeyRotationEnabled": False}

    def test_get_key_not_found(self):
        response = client.get("/api/kms/keys/key-nonexistent")

        assert response.status_code == 404


class TestGetKeyPolicy:
    @patch("backend.routes.kms.get_client")
    def test_get_key_policy(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms
        mock_kms.get_key_policy.return_value = {
            "Policy": '{"Version":"2012-10-17","Statement":[{"Sid":"Enable IAM User Permissions","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::000000000000:root"},"Action":"kms:*","Resource":"*"}]}',
            "PolicyName": "default",
        }

        response = client.get("/api/kms/keys/test-id/policy")

        assert response.status_code == 200
        data = response.json()
        assert data["Version"] == "2012-10-17"
        assert data["Statement"] == [
            {
                "Sid": "Enable IAM User Permissions",
                "Effect": "Allow",
                "Principal": {"AWS": "arn:aws:iam::000000000000:root"},
                "Action": "kms:*",
                "Resource": "*",
            }
        ]

    def test_get_key_policy_not_found(self):
        response = client.get("/api/kms/keys/test-id/policy")

        assert response.status_code == 404


class TestListGrants:
    @patch("backend.routes.kms.get_client")
    def test_list_grants(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms

        mock_kms.list_grants.return_value = {
            "Grants": [
                {
                    "KeyId": "arn:aws:kms:us-east-1:000000000000:key/test-key",
                    "GrantId": "test-id",
                    "CreationDate": NOW,
                    "GranteePrincipal": "arn:aws:iam::000000000000:user/test-user",
                    "Operations": ["Encrypt", "Decrypt"],
                }
            ]
        }

        response = client.get("/api/kms/keys/test-key/grants")

        assert response.status_code == 200
        data = response.json()
        assert data[0]["grantID"] == "test-id"
        assert data[0]["grantee"] == "arn:aws:iam::000000000000:user/test-user"

    @patch("backend.routes.kms.get_client")
    def test_list_grants_empty(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms

        mock_kms.list_grants.return_value = {"Grants": []}

        response = client.get("/api/kms/keys/test-key/grants")

        assert response.status_code == 200

    def test_list_grants_not_found(self):
        response = client.get("/api/kms/keys/test-key/grants")

        assert response.status_code == 404


class TestGetAliasesDetail:
    @patch("backend.routes.kms.get_client")
    def test_get_aliases_detail(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms

        mock_kms.list_aliases.return_value = {
            "Aliases": [
                {
                    "AliasName": "alias/test-alias",
                    "AliasArn": "arn:aws:kms:us-east-1:000000000000:alias/test-alias",
                    "TargetKeyId": "test-key",
                    "CreationDate": NOW,
                }
            ]
        }

        response = client.get("/api/kms/keys/test-key/aliases")

        assert response.status_code == 200
        data = response.json()
        assert data[0]["aliasName"] == "alias/test-alias"
        assert data[0]["aliasArn"] == "arn:aws:kms:us-east-1:000000000000:alias/test-alias"

    @patch("backend.routes.kms.get_client")
    def test_get_aliases_detail_empty(self, mock_get_client):
        mock_kms = MagicMock()
        mock_get_client.return_value = mock_kms

        mock_kms.list_aliases.return_value = {
            "Aliases": []
        }

        response = client.get("/api/kms/keys/test-key/aliases")
        
        assert response.status_code == 200

    def test_get_aliases_not_found(self):
        response = client.get("/api/kms/keys/test-key/aliases")

        assert response.status_code == 404