"""Tests for Cognito API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

NOW = datetime(2024, 6, 1, tzinfo=timezone.utc)
POOL_ID = "us-east-1_abc123"
IDENTITY_POOL_ID = "us-east-1:11111111-2222-3333-4444-555555555555"


def _not_found(op: str = "Op") -> ClientError:
    return ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "missing"}}, op)


def _mock_client(mock_get_client, pages: dict[str, list[dict]] | None = None) -> MagicMock:
    """Return a mock boto3 client whose paginators yield the given pages per operation."""
    mock = MagicMock()
    mock_get_client.return_value = mock
    pages = pages or {}

    def get_paginator(name):
        paginator = MagicMock()
        paginator.paginate.return_value = pages.get(name, [])
        return paginator

    mock.get_paginator.side_effect = get_paginator
    return mock


def _raising_paginator(mock: MagicMock, error: Exception) -> None:
    paginator = MagicMock()
    paginator.paginate.side_effect = error
    mock.get_paginator.side_effect = None
    mock.get_paginator.return_value = paginator


USER = {
    "Username": "alice",
    "UserStatus": "CONFIRMED",
    "Enabled": True,
    "UserCreateDate": NOW,
    "UserLastModifiedDate": NOW,
}


class TestListUserPools:
    @patch("backend.routes.cognito.get_client")
    def test_list(self, mock_get_client):
        mock = _mock_client(
            mock_get_client,
            {
                "list_user_pools": [
                    {
                        "UserPools": [
                            {
                                "Id": POOL_ID,
                                "Name": "main",
                                "Status": "Enabled",
                                "CreationDate": NOW,
                                "LastModifiedDate": NOW,
                            }
                        ]
                    }
                ]
            },
        )
        mock.describe_user_pool.return_value = {"UserPool": {"Id": POOL_ID, "EstimatedNumberOfUsers": 4}}
        response = client.get("/api/cognito/user-pools")
        assert response.status_code == 200
        pools = response.json()["userPools"]
        assert pools == [
            {
                "id": POOL_ID,
                "name": "main",
                "estimatedNumberOfUsers": 4,
                "creationDate": NOW.isoformat(),
                "lastModifiedDate": NOW.isoformat(),
            }
        ]
        mock.get_paginator.assert_called_with("list_user_pools")
        mock.describe_user_pool.assert_called_once_with(UserPoolId=POOL_ID)

    @patch("backend.routes.cognito.get_client")
    def test_estimated_users_null_when_describe_fails_for_one_pool(self, mock_get_client):
        mock = _mock_client(
            mock_get_client,
            {"list_user_pools": [{"UserPools": [{"Id": "pool-a", "Name": "a"}, {"Id": "pool-b", "Name": "b"}]}]},
        )

        def describe(UserPoolId):
            if UserPoolId == "pool-a":
                raise ClientError({"Error": {"Code": "InternalErrorException", "Message": "x"}}, "DescribeUserPool")
            return {"UserPool": {"Id": UserPoolId, "EstimatedNumberOfUsers": 2}}

        mock.describe_user_pool.side_effect = describe
        response = client.get("/api/cognito/user-pools")
        assert response.status_code == 200
        counts = {p["id"]: p["estimatedNumberOfUsers"] for p in response.json()["userPools"]}
        assert counts == {"pool-a": None, "pool-b": 2}

    @patch("backend.routes.cognito.get_client")
    def test_estimated_users_null_when_omitted(self, mock_get_client):
        mock = _mock_client(mock_get_client, {"list_user_pools": [{"UserPools": [{"Id": POOL_ID, "Name": "main"}]}]})
        mock.describe_user_pool.return_value = {"UserPool": {"Id": POOL_ID}}
        response = client.get("/api/cognito/user-pools")
        assert response.status_code == 200
        assert response.json()["userPools"][0]["estimatedNumberOfUsers"] is None

    @patch("backend.routes.cognito.get_client")
    def test_list_empty(self, mock_get_client):
        _mock_client(mock_get_client, {"list_user_pools": [{"UserPools": []}]})
        response = client.get("/api/cognito/user-pools")
        assert response.status_code == 200
        assert response.json() == {"userPools": []}

    @patch("backend.routes.cognito.get_client")
    def test_list_error(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        _raising_paginator(mock, Exception("boom"))
        response = client.get("/api/cognito/user-pools")
        assert response.status_code == 500


class TestGetUserPool:
    @patch("backend.routes.cognito.get_client")
    def test_detail(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_user_pool.return_value = {
            "UserPool": {
                "Id": POOL_ID,
                "Name": "main",
                "EstimatedNumberOfUsers": 3,
                "MfaConfiguration": "OFF",
            },
            "ResponseMetadata": {},
        }
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}")
        assert response.status_code == 200
        data = response.json()
        assert data["Id"] == POOL_ID
        assert data["EstimatedNumberOfUsers"] == 3
        assert "ResponseMetadata" not in data
        mock.describe_user_pool.assert_called_once_with(UserPoolId=POOL_ID)

    @patch("backend.routes.cognito.get_client")
    def test_detail_without_estimated_users(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_user_pool.return_value = {"UserPool": {"Id": POOL_ID, "Name": "main"}}
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}")
        assert response.status_code == 200
        assert "EstimatedNumberOfUsers" not in response.json()

    @patch("backend.routes.cognito.get_client")
    def test_detail_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_user_pool.side_effect = _not_found("DescribeUserPool")
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}")
        assert response.status_code == 404

    @patch("backend.routes.cognito.get_client")
    def test_detail_other_error(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_user_pool.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "x"}}, "DescribeUserPool"
        )
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}")
        assert response.status_code == 500


class TestListUsers:
    @patch("backend.routes.cognito.get_client")
    def test_list(self, mock_get_client):
        _mock_client(
            mock_get_client,
            {
                "list_users": [
                    {
                        "Users": [
                            {
                                **USER,
                                "Attributes": [
                                    {"Name": "email", "Value": "alice@example.com"},
                                    {"Name": "sub", "Value": "abc"},
                                ],
                            }
                        ]
                    }
                ]
            },
        )
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users")
        assert response.status_code == 200
        users = response.json()["users"]
        assert users == [
            {
                "username": "alice",
                "status": "CONFIRMED",
                "enabled": True,
                "created": NOW.isoformat(),
                "modified": NOW.isoformat(),
                "attributes": {"email": "alice@example.com", "sub": "abc"},
            }
        ]

    @patch("backend.routes.cognito.get_client")
    def test_list_empty(self, mock_get_client):
        _mock_client(mock_get_client, {"list_users": [{"Users": []}]})
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users")
        assert response.status_code == 200
        assert response.json() == {"users": []}

    @patch("backend.routes.cognito.get_client")
    def test_list_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        _raising_paginator(mock, _not_found("ListUsers"))
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users")
        assert response.status_code == 404


class TestGetUser:
    @patch("backend.routes.cognito.get_client")
    def test_detail_with_groups(self, mock_get_client):
        mock = _mock_client(
            mock_get_client,
            {"admin_list_groups_for_user": [{"Groups": [{"GroupName": "admins"}, {"GroupName": "devs"}]}]},
        )
        mock.admin_get_user.return_value = {
            **USER,
            "UserAttributes": [{"Name": "email", "Value": "alice@example.com"}],
        }
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users/alice")
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "alice"
        assert data["attributes"] == {"email": "alice@example.com"}
        assert data["groups"] == ["admins", "devs"]
        mock.admin_get_user.assert_called_once_with(UserPoolId=POOL_ID, Username="alice")

    @patch("backend.routes.cognito.get_client")
    def test_groups_degrade_when_unsupported(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.admin_get_user.return_value = {**USER, "UserAttributes": []}
        _raising_paginator(
            mock,
            ClientError({"Error": {"Code": "InvalidAction", "Message": "nope"}}, "AdminListGroupsForUser"),
        )
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users/alice")
        assert response.status_code == 200
        assert response.json()["groups"] == []

    @patch("backend.routes.cognito.get_client")
    def test_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.admin_get_user.side_effect = _not_found("AdminGetUser")
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/users/ghost")
        assert response.status_code == 404


class TestListGroups:
    @patch("backend.routes.cognito.get_client")
    def test_list(self, mock_get_client):
        _mock_client(
            mock_get_client,
            {
                "list_groups": [
                    {
                        "Groups": [
                            {
                                "GroupName": "admins",
                                "Description": "Admins",
                                "Precedence": 1,
                                "RoleArn": "arn:aws:iam::000000000000:role/admin",
                            }
                        ]
                    }
                ]
            },
        )
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/groups")
        assert response.status_code == 200
        assert response.json()["groups"] == [
            {
                "name": "admins",
                "description": "Admins",
                "precedence": 1,
                "roleArn": "arn:aws:iam::000000000000:role/admin",
            }
        ]

    @patch("backend.routes.cognito.get_client")
    def test_list_empty(self, mock_get_client):
        _mock_client(mock_get_client, {"list_groups": [{"Groups": []}]})
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/groups")
        assert response.status_code == 200
        assert response.json() == {"groups": []}

    @patch("backend.routes.cognito.get_client")
    def test_list_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        _raising_paginator(mock, _not_found("ListGroups"))
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/groups")
        assert response.status_code == 404


class TestListClients:
    @patch("backend.routes.cognito.get_client")
    def test_list_never_returns_secret(self, mock_get_client):
        mock = _mock_client(
            mock_get_client,
            {"list_user_pool_clients": [{"UserPoolClients": [{"ClientId": "c1", "ClientName": "web"}]}]},
        )
        mock.describe_user_pool_client.return_value = {
            "UserPoolClient": {
                "UserPoolId": POOL_ID,
                "ClientId": "c1",
                "ClientName": "web",
                "ClientSecret": "super-secret-value",
                "ExplicitAuthFlows": ["ALLOW_USER_PASSWORD_AUTH"],
                "AllowedOAuthFlows": ["code"],
                "CallbackURLs": ["http://localhost:3000/callback"],
                "AccessTokenValidity": 60,
                "IdTokenValidity": 60,
                "RefreshTokenValidity": 30,
                "TokenValidityUnits": {"AccessToken": "minutes", "IdToken": "minutes", "RefreshToken": "days"},
            }
        }
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/clients")
        assert response.status_code == 200
        assert "super-secret-value" not in response.text
        assert "ClientSecret" not in response.text
        assert "clientSecret" not in response.text
        clients = response.json()["clients"]
        assert clients == [
            {
                "clientId": "c1",
                "clientName": "web",
                "explicitAuthFlows": ["ALLOW_USER_PASSWORD_AUTH"],
                "allowedOAuthFlows": ["code"],
                "callbackURLs": ["http://localhost:3000/callback"],
                "tokenValidity": {
                    "accessToken": 60,
                    "idToken": 60,
                    "refreshToken": 30,
                    "units": {"AccessToken": "minutes", "IdToken": "minutes", "RefreshToken": "days"},
                },
            }
        ]
        mock.describe_user_pool_client.assert_called_once_with(UserPoolId=POOL_ID, ClientId="c1")

    @patch("backend.routes.cognito.get_client")
    def test_list_empty(self, mock_get_client):
        _mock_client(mock_get_client, {"list_user_pool_clients": [{"UserPoolClients": []}]})
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/clients")
        assert response.status_code == 200
        assert response.json() == {"clients": []}

    @patch("backend.routes.cognito.get_client")
    def test_list_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        _raising_paginator(mock, _not_found("ListUserPoolClients"))
        response = client.get(f"/api/cognito/user-pools/{POOL_ID}/clients")
        assert response.status_code == 404


class TestIdentityPools:
    @patch("backend.routes.cognito.get_client")
    def test_list(self, mock_get_client):
        _mock_client(
            mock_get_client,
            {
                "list_identity_pools": [
                    {"IdentityPools": [{"IdentityPoolId": IDENTITY_POOL_ID, "IdentityPoolName": "ids"}]}
                ]
            },
        )
        response = client.get("/api/cognito/identity-pools")
        assert response.status_code == 200
        assert response.json() == {"identityPools": [{"id": IDENTITY_POOL_ID, "name": "ids"}]}
        assert mock_get_client.call_args.args[0] == "cognito-identity"

    @patch("backend.routes.cognito.get_client")
    def test_list_empty(self, mock_get_client):
        _mock_client(mock_get_client, {"list_identity_pools": [{"IdentityPools": []}]})
        response = client.get("/api/cognito/identity-pools")
        assert response.status_code == 200
        assert response.json() == {"identityPools": []}

    @patch("backend.routes.cognito.get_client")
    def test_detail(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_identity_pool.return_value = {
            "IdentityPoolId": IDENTITY_POOL_ID,
            "IdentityPoolName": "ids",
            "AllowUnauthenticatedIdentities": True,
            "CognitoIdentityProviders": [
                {"ProviderName": "cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123", "ClientId": "c1"}
            ],
            "SupportedLoginProviders": {"accounts.google.com": "google-app-id"},
            "ResponseMetadata": {"HTTPStatusCode": 200},
        }
        response = client.get(f"/api/cognito/identity-pools/{IDENTITY_POOL_ID}")
        assert response.status_code == 200
        data = response.json()
        assert "ResponseMetadata" not in data
        assert data["IdentityPoolName"] == "ids"
        assert data["AllowUnauthenticatedIdentities"] is True
        assert data["SupportedLoginProviders"] == {"accounts.google.com": "google-app-id"}

    @patch("backend.routes.cognito.get_client")
    def test_detail_not_found(self, mock_get_client):
        mock = _mock_client(mock_get_client)
        mock.describe_identity_pool.side_effect = _not_found("DescribeIdentityPool")
        response = client.get(f"/api/cognito/identity-pools/{IDENTITY_POOL_ID}")
        assert response.status_code == 404
