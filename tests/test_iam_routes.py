"""Integration tests for IAM API routes."""

import json
import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import boto3
import pytest
from botocore.stub import Stubber
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


def paginated(mock_iam, *responses: dict) -> None:
    """Make the mocked client's paginator yield ``responses`` as its pages."""
    mock_iam.get_paginator.return_value.paginate.return_value = list(responses)


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
        paginated(mock_iam, {"Users": []})

        resp = client.get("/api/iam/users")
        assert resp.status_code == 200
        data = resp.json()
        assert data["users"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_users_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        paginated(mock_iam, {
            "Users": [
                {
                    "UserName": "alice",
                    "UserId": "AIDAEXAMPLE1",
                    "Arn": "arn:aws:iam::000000000000:user/alice",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ]
        })

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
        paginated(mock_iam, {"Roles": []})

        resp = client.get("/api/iam/roles")
        assert resp.status_code == 200
        assert resp.json()["roles"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_roles_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        paginated(mock_iam, {
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
        })

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
        paginated(mock_iam, {"Groups": []})

        resp = client.get("/api/iam/groups")
        assert resp.status_code == 200
        assert resp.json()["groups"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_groups_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        paginated(mock_iam, {
            "Groups": [
                {
                    "GroupName": "admins",
                    "GroupId": "AGPAEXAMPLE",
                    "Arn": "arn:aws:iam::000:group/admins",
                    "Path": "/",
                    "CreateDate": NOW,
                }
            ]
        })

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
        paginated(mock_iam, {"Policies": []})

        resp = client.get("/api/iam/policies")
        assert resp.status_code == 200
        assert resp.json()["policies"] == []

    @patch("backend.routes.iam.get_client")
    def test_list_policies_with_data(self, mock_get_client):
        mock_iam = MagicMock()
        mock_get_client.return_value = mock_iam
        paginated(mock_iam, {
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
        })

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
        paginated(mock_iam, {"Policies": []})

        client.get("/api/iam/policies?scope=AWS")
        call_kwargs = mock_iam.get_paginator.return_value.paginate.call_args[1]
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


class TestListsPastTheFirstPage:
    """IAM answers a hundred items at a time, so the lists have to follow the pages to the end (#237)."""

    COUNT = 105  # past the first page of 100

    # moto pages roles and policies the way IAM does, so those run against it. It returns every user and
    # group at once, so for those the pages are scripted on a real client with botocore's Stubber, which
    # fails the test unless the second request carries the Marker of the first answer.

    def test_roles(self, iam):
        for i in range(self.COUNT):
            iam.create_role(RoleName=f"role-{i:03}", AssumeRolePolicyDocument=json.dumps(TRUST_LAMBDA))

        resp = client.get("/api/iam/roles")

        assert resp.status_code == 200
        names = [r["RoleName"] for r in resp.json()["roles"]]
        assert sorted(names) == [f"role-{i:03}" for i in range(self.COUNT)]

    def test_policies(self, iam):
        for i in range(self.COUNT):
            managed_policy(iam, f"policy-{i:03}", READ_REPORTS)

        resp = client.get("/api/iam/policies")

        assert resp.status_code == 200
        names = [p["PolicyName"] for p in resp.json()["policies"]]
        assert sorted(names) == [f"policy-{i:03}" for i in range(self.COUNT)]

    def test_users(self):
        iam = boto3.client("iam", region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test")
        first = {"UserName": "alice", "UserId": "AIDAEXAMPLEUSER01", "Arn": "arn:aws:iam::000:user/alice", "Path": "/", "CreateDate": NOW}
        second = {"UserName": "bob", "UserId": "AIDAEXAMPLEUSER02", "Arn": "arn:aws:iam::000:user/bob", "Path": "/", "CreateDate": NOW}

        with Stubber(iam) as stubber:
            stubber.add_response("list_users", {"Users": [first], "IsTruncated": True, "Marker": "page-2"}, {})
            stubber.add_response("list_users", {"Users": [second], "IsTruncated": False}, {"Marker": "page-2"})
            with patch("backend.routes.iam.get_client", return_value=iam):
                resp = client.get("/api/iam/users")
            stubber.assert_no_pending_responses()

        assert resp.status_code == 200
        assert [u["UserName"] for u in resp.json()["users"]] == ["alice", "bob"]

    def test_groups(self):
        iam = boto3.client("iam", region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test")
        first = {"GroupName": "admins", "GroupId": "AGPAEXAMPLEGROUP01", "Arn": "arn:aws:iam::000:group/admins", "Path": "/", "CreateDate": NOW}
        second = {"GroupName": "devs", "GroupId": "AGPAEXAMPLEGROUP02", "Arn": "arn:aws:iam::000:group/devs", "Path": "/", "CreateDate": NOW}

        with Stubber(iam) as stubber:
            stubber.add_response("list_groups", {"Groups": [first], "IsTruncated": True, "Marker": "page-2"}, {})
            stubber.add_response("list_groups", {"Groups": [second], "IsTruncated": False}, {"Marker": "page-2"})
            with patch("backend.routes.iam.get_client", return_value=iam):
                resp = client.get("/api/iam/groups")
            stubber.assert_no_pending_responses()

        assert resp.status_code == 200
        assert [g["GroupName"] for g in resp.json()["groups"]] == ["admins", "devs"]
