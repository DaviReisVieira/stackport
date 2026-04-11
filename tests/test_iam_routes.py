"""Integration tests for IAM API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

NOW = datetime(2024, 6, 1, tzinfo=timezone.utc)


class TestListUsers:
    @patch("backend.routes.iam.get_client")
    def test_list_users_empty(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_users.return_value = {"Users": []}

        resp = client.get("/api/iam/users")
        assert resp.status_code == 200
        data = resp.json()
        assert data["users"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_users_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_users.return_value = {
            "Users": [
                {
                    "UserName": "alice",
                    "UserId": "AIDAEXAMPLE1",
                    "Arn": "arn:aws:iam::000000000000:user/alice",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ]
        }

        resp = client.get("/api/iam/users")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["users"]) == 1
        assert data["users"][0]["UserName"] == "alice"
        assert data["users"][0]["UserId"] == "AIDAEXAMPLE1"


class TestGetUserDetail:
    @patch("backend.routes.iam.get_client")
    def test_get_user_detail(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.get_user.return_value = {
            "User": {
                "UserName": "alice",
                "UserId": "AIDAEXAMPLE1",
                "Arn": "arn:aws:iam::000000000000:user/alice",
                "Path": "/",
                "CreateDate": NOW,
            }
        }
        mock_iam.list_attached_user_policies.return_value = {
            "AttachedPolicies": [
                {"PolicyName": "ReadOnly", "PolicyArn": "arn:aws:iam::000:policy/ReadOnly"}
            ]
        }
        mock_iam.list_user_policies.return_value = {"PolicyNames": ["inline-1"]}
        mock_iam.get_user_policy.return_value = {
            "PolicyDocument": '{"Version":"2012-10-17","Statement":[]}'
        }
        mock_iam.list_groups_for_user.return_value = {
            "Groups": [
                {
                    "GroupName": "developers",
                    "GroupId": "AGPAEXAMPLE",
                    "Arn": "arn:aws:iam::000:group/developers",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ]
        }
        mock_iam.list_access_keys.return_value = {
            "AccessKeyMetadata": [
                {
                    "UserName": "alice",
                    "AccessKeyId": "AKIAEXAMPLE",
                    "Status": "Active",
                    "CreateDate": NOW,
                }
            ]
        }
        mock_iam.list_user_tags.return_value = {
            "Tags": [{"Key": "team", "Value": "backend"}]
        }

        resp = client.get("/api/iam/users/alice")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["UserName"] == "alice"
        assert len(data["attached_policies"]) == 1
        assert data["attached_policies"][0]["PolicyName"] == "ReadOnly"
        assert len(data["inline_policies"]) == 1
        assert data["inline_policies"][0]["name"] == "inline-1"
        assert len(data["groups"]) == 1
        assert data["groups"][0]["GroupName"] == "developers"
        assert len(data["access_keys"]) == 1
        assert data["access_keys"][0]["Status"] == "Active"
        assert data["tags"] == {"team": "backend"}


class TestListRoles:
    @patch("backend.routes.iam.get_client")
    def test_list_roles_empty(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_roles.return_value = {"Roles": []}

        resp = client.get("/api/iam/roles")
        assert resp.status_code == 200
        assert resp.json()["roles"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_roles_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_roles.return_value = {
            "Roles": [
                {
                    "RoleName": "lambda-exec",
                    "RoleId": "AROAEXAMPLE",
                    "Arn": "arn:aws:iam::000:role/lambda-exec",
                    "Path": "/",
                    "CreateDate": NOW,
                    "MaxSessionDuration": 3600,
                }
            ]
        }

        resp = client.get("/api/iam/roles")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["roles"]) == 1
        assert data["roles"][0]["RoleName"] == "lambda-exec"
        assert data["roles"][0]["MaxSessionDuration"] == 3600


class TestGetRoleDetail:
    @patch("backend.routes.iam.get_client")
    def test_get_role_detail(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.get_role.return_value = {
            "Role": {
                "RoleName": "lambda-exec",
                "RoleId": "AROAEXAMPLE",
                "Arn": "arn:aws:iam::000:role/lambda-exec",
                "Path": "/",
                "CreateDate": NOW,
                "MaxSessionDuration": 3600,
                "AssumeRolePolicyDocument": '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}',
            }
        }
        mock_iam.list_attached_role_policies.return_value = {
            "AttachedPolicies": [
                {"PolicyName": "AWSLambdaBasicExecutionRole", "PolicyArn": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}
            ]
        }
        mock_iam.list_role_policies.return_value = {"PolicyNames": []}
        mock_iam.list_role_tags.return_value = {"Tags": []}

        resp = client.get("/api/iam/roles/lambda-exec")
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"]["RoleName"] == "lambda-exec"
        assert data["trust_policy"]["Version"] == "2012-10-17"
        assert len(data["attached_policies"]) == 1
        assert data["inline_policies"] == []


class TestListGroups:
    @patch("backend.routes.iam.get_client")
    def test_list_groups_empty(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_groups.return_value = {"Groups": []}

        resp = client.get("/api/iam/groups")
        assert resp.status_code == 200
        assert resp.json()["groups"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_groups_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_groups.return_value = {
            "Groups": [
                {
                    "GroupName": "admins",
                    "GroupId": "AGPAEXAMPLE",
                    "Arn": "arn:aws:iam::000:group/admins",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ]
        }

        resp = client.get("/api/iam/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["groups"]) == 1
        assert data["groups"][0]["GroupName"] == "admins"


class TestGetGroupDetail:
    @patch("backend.routes.iam.get_client")
    def test_get_group_detail(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.get_group.return_value = {
            "Group": {
                "GroupName": "admins",
                "GroupId": "AGPAEXAMPLE",
                "Arn": "arn:aws:iam::000:group/admins",
                "Path": "/",
                "CreateDate": NOW,
            },
            "Users": [
                {
                    "UserName": "alice",
                    "UserId": "AIDAEXAMPLE1",
                    "Arn": "arn:aws:iam::000:user/alice",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ],
        }
        mock_iam.list_attached_group_policies.return_value = {
            "AttachedPolicies": [
                {"PolicyName": "AdminAccess", "PolicyArn": "arn:aws:iam::000:policy/AdminAccess"}
            ]
        }
        mock_iam.list_group_policies.return_value = {"PolicyNames": ["inline-group"]}
        mock_iam.get_group_policy.return_value = {
            "PolicyDocument": '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}'
        }

        resp = client.get("/api/iam/groups/admins")
        assert resp.status_code == 200
        data = resp.json()
        assert data["group"]["GroupName"] == "admins"
        assert len(data["users"]) == 1
        assert data["users"][0]["UserName"] == "alice"
        assert len(data["attached_policies"]) == 1
        assert len(data["inline_policies"]) == 1
        assert data["inline_policies"][0]["document"]["Statement"][0]["Effect"] == "Allow"


class TestListPolicies:
    @patch("backend.routes.iam.get_client")
    def test_list_policies_empty(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_policies.return_value = {"Policies": []}

        resp = client.get("/api/iam/policies")
        assert resp.status_code == 200
        assert resp.json()["policies"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_policies_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_policies.return_value = {
            "Policies": [
                {
                    "PolicyName": "MyPolicy",
                    "PolicyId": "ANPAEXAMPLE",
                    "Arn": "arn:aws:iam::000:policy/MyPolicy",
                    "Path": "/",
                    "DefaultVersionId": "v1",
                    "AttachmentCount": 2,
                    "CreateDate": NOW,
                    "UpdateDate": NOW,
                }
            ]
        }

        resp = client.get("/api/iam/policies")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["policies"]) == 1
        assert data["policies"][0]["PolicyName"] == "MyPolicy"
        assert data["policies"][0]["AttachmentCount"] == 2

    @patch("backend.routes.iam.get_client")
    def test_list_policies_scope_param(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        mock_iam.list_policies.return_value = {"Policies": []}

        client.get("/api/iam/policies?scope=AWS")
        call_kwargs = mock_iam.list_policies.call_args[1]
        assert call_kwargs["Scope"] == "AWS"


class TestGetPolicyDetail:
    @patch("backend.routes.iam.get_client")
    def test_get_policy_detail(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        arn = "arn:aws:iam::000:policy/MyPolicy"
        mock_iam.get_policy.return_value = {
            "Policy": {
                "PolicyName": "MyPolicy",
                "PolicyId": "ANPAEXAMPLE",
                "Arn": arn,
                "Path": "/",
                "DefaultVersionId": "v1",
                "AttachmentCount": 3,
                "CreateDate": NOW,
                "UpdateDate": NOW,
            }
        }
        mock_iam.get_policy_version.return_value = {
            "PolicyVersion": {
                "Document": '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}]}'
            }
        }
        mock_iam.list_entities_for_policy.return_value = {
            "PolicyUsers": [{"UserName": "alice"}],
            "PolicyRoles": [{"RoleName": "lambda-exec"}],
            "PolicyGroups": [{"GroupName": "admins"}],
        }
        mock_iam.list_policy_tags.return_value = {
            "Tags": [{"Key": "managed", "Value": "true"}]
        }

        resp = client.get(f"/api/iam/policies/{arn}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["policy"]["PolicyName"] == "MyPolicy"
        assert data["document"]["Statement"][0]["Action"] == "s3:GetObject"
        assert len(data["attached_to"]["users"]) == 1
        assert len(data["attached_to"]["roles"]) == 1
        assert len(data["attached_to"]["groups"]) == 1
        assert data["tags"] == {"managed": "true"}

    @patch("backend.routes.iam.get_client")
    def test_get_policy_no_version(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        arn = "arn:aws:iam::000:policy/EmptyPolicy"
        mock_iam.get_policy.return_value = {
            "Policy": {
                "PolicyName": "EmptyPolicy",
                "PolicyId": "ANPAEXAMPLE2",
                "Arn": arn,
                "Path": "/",
                "AttachmentCount": 0,
                "CreateDate": NOW,
                "UpdateDate": NOW,
            }
        }
        mock_iam.list_entities_for_policy.return_value = {
            "PolicyUsers": [],
            "PolicyRoles": [],
            "PolicyGroups": [],
        }
        mock_iam.list_policy_tags.return_value = {"Tags": []}

        resp = client.get(f"/api/iam/policies/{arn}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["document"] == {}
        assert data["attached_to"]["users"] == []
