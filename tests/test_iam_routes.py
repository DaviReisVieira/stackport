"""Integration tests for IAM API routes."""

import json
import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from tests.moto_aws import aws, moto_account

client = TestClient(app)

NOW = datetime(2024, 6, 1, tzinfo=timezone.utc)

TRUST_LAMBDA = {
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}],
}
READ_REPORTS = {
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::reports/*"}],
}
DENY_DELETES = {
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Deny", "Action": "s3:DeleteObject", "Resource": "*"}],
}


@pytest.fixture
def iam():
    """An IAM client for a moto account that StackPort's routes read from."""
    with moto_account():
        yield aws("iam")


def managed_policy(iam, name: str, document: dict) -> str:
    return iam.create_policy(PolicyName=name, PolicyDocument=json.dumps(document))["Policy"]["Arn"]


class TestPolicyDocuments:
    """Documents come through as the JSON objects botocore parsed them into."""

    def test_role_trust_policy_and_inline_policies(self, iam):
        iam.create_role(RoleName="lambda-exec", AssumeRolePolicyDocument=json.dumps(TRUST_LAMBDA))
        iam.put_role_policy(RoleName="lambda-exec", PolicyName="read-reports", PolicyDocument=json.dumps(READ_REPORTS))
        iam.attach_role_policy(RoleName="lambda-exec", PolicyArn=managed_policy(iam, "deny-deletes", DENY_DELETES))

        resp = client.get("/api/iam/roles/lambda-exec")
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"]["RoleName"] == "lambda-exec"
        assert data["trust_policy"] == TRUST_LAMBDA
        assert data["inline_policies"] == [{"name": "read-reports", "document": READ_REPORTS}]
        assert [p["PolicyName"] for p in data["attached_policies"]] == ["deny-deletes"]

    def test_user_inline_policies(self, iam):
        iam.create_user(UserName="alice", Tags=[{"Key": "team", "Value": "backend"}])
        iam.put_user_policy(UserName="alice", PolicyName="read-reports", PolicyDocument=json.dumps(READ_REPORTS))
        iam.create_group(GroupName="developers")
        iam.add_user_to_group(GroupName="developers", UserName="alice")
        key_id = iam.create_access_key(UserName="alice")["AccessKey"]["AccessKeyId"]

        resp = client.get("/api/iam/users/alice")
        assert resp.status_code == 200
        data = resp.json()
        assert data["inline_policies"] == [{"name": "read-reports", "document": READ_REPORTS}]
        assert [g["GroupName"] for g in data["groups"]] == ["developers"]
        assert [(k["AccessKeyId"], k["Status"]) for k in data["access_keys"]] == [(key_id, "Active")]
        assert data["tags"] == {"team": "backend"}

    def test_group_inline_policies(self, iam):
        iam.create_group(GroupName="admins")
        iam.create_user(UserName="alice")
        iam.add_user_to_group(GroupName="admins", UserName="alice")
        iam.put_group_policy(GroupName="admins", PolicyName="deny-deletes", PolicyDocument=json.dumps(DENY_DELETES))

        resp = client.get("/api/iam/groups/admins")
        assert resp.status_code == 200
        data = resp.json()
        assert [u["UserName"] for u in data["users"]] == ["alice"]
        assert data["inline_policies"] == [{"name": "deny-deletes", "document": DENY_DELETES}]

    def test_managed_policy_document(self, iam):
        arn = managed_policy(iam, "read-reports", READ_REPORTS)
        iam.tag_policy(PolicyArn=arn, Tags=[{"Key": "owner", "Value": "data"}])
        iam.create_role(RoleName="reader", AssumeRolePolicyDocument=json.dumps(TRUST_LAMBDA))
        iam.attach_role_policy(RoleName="reader", PolicyArn=arn)

        resp = client.get(f"/api/iam/policies/{arn}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["document"] == READ_REPORTS
        assert [r["RoleName"] for r in data["attached_to"]["roles"]] == ["reader"]
        assert data["tags"] == {"owner": "data"}


class TestPolicyCount:
    def test_the_dashboard_counts_the_policies_the_view_lists(self, monkeypatch):
        # moto then lists AWS managed policies as well, as AWS and emulators do.
        monkeypatch.setenv("MOTO_IAM_LOAD_MANAGED_POLICIES", "true")
        monkeypatch.setattr("backend.routes.stats.STACKPORT_SERVICES", "iam")
        with moto_account():
            managed_policy(aws("iam"), "read-reports", READ_REPORTS)
            view = client.get("/api/iam/policies").json()["policies"]
            counted = client.get("/api/stats").json()["services"]["iam"]["resources"]["policies"]
            listed = client.get("/api/resources/iam").json()["resources"]["policies"]

        assert [p["PolicyName"] for p in view] == ["read-reports"]
        assert counted == 1
        assert [p["PolicyName"] for p in listed] == ["read-reports"]


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
