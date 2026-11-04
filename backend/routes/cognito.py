"""Read-only Cognito routes for user pools and identity pools."""

import logging
from typing import Any, NoReturn

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info

router = APIRouter()

logger = logging.getLogger(__name__)


def _raise_error(e: Exception, not_found: str, action: str) -> NoReturn:
    """Map a boto3 error to 404 for missing resources, 500 otherwise."""
    if isinstance(e, ClientError) and e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
        raise HTTPException(status_code=404, detail=not_found)
    logger.error("Failed to %s", action, exc_info=True)
    raise HTTPException(status_code=500, detail=str(e))


def _attributes(items: list[dict[str, Any]] | None) -> dict[str, str]:
    return {a["Name"]: a.get("Value", "") for a in items or []}


def _user(user: dict[str, Any], attributes_key: str) -> dict[str, Any]:
    return {
        "username": user.get("Username"),
        "status": user.get("UserStatus"),
        "enabled": user.get("Enabled"),
        "created": user.get("UserCreateDate"),
        "modified": user.get("UserLastModifiedDate"),
        "attributes": _attributes(user.get(attributes_key)),
    }


# --- User pools ---


def _estimated_users(client: Any, pool_id: str | None) -> int | None:
    """EstimatedNumberOfUsers from describe_user_pool, or None if the call fails or omits it."""
    try:
        return client.describe_user_pool(UserPoolId=pool_id)["UserPool"].get("EstimatedNumberOfUsers")
    except Exception:
        logger.warning("Could not describe user pool %s for estimated users", pool_id, exc_info=True)
        return None


@router.get("/user-pools")
def list_user_pools(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List Cognito user pools with an estimated user count per pool (null when unavailable)."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        paginator = client.get_paginator("list_user_pools")
        pools = []
        for page in paginator.paginate(MaxResults=60):
            for pool in page.get("UserPools", []):
                pools.append(
                    {
                        "id": pool.get("Id"),
                        "name": pool.get("Name"),
                        "estimatedNumberOfUsers": _estimated_users(client, pool.get("Id")),
                        "creationDate": pool.get("CreationDate"),
                        "lastModifiedDate": pool.get("LastModifiedDate"),
                    }
                )
        return {"userPools": pools}
    except Exception as e:
        _raise_error(e, "User pools not found", "list user pools")


@router.get("/user-pools/{pool_id}")
def get_user_pool(pool_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Describe one user pool. EstimatedNumberOfUsers may be missing on emulators."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        return client.describe_user_pool(UserPoolId=pool_id)["UserPool"]
    except Exception as e:
        _raise_error(e, f"User pool {pool_id} not found", f"describe user pool {pool_id}")


@router.get("/user-pools/{pool_id}/users")
def list_users(pool_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """List users in a user pool."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        paginator = client.get_paginator("list_users")
        users = []
        for page in paginator.paginate(UserPoolId=pool_id):
            for user in page.get("Users", []):
                users.append(_user(user, "Attributes"))
        return {"users": users}
    except Exception as e:
        _raise_error(e, f"User pool {pool_id} not found", f"list users for {pool_id}")


@router.get("/user-pools/{pool_id}/users/{username}")
def get_user(pool_id: str, username: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Get one user with the names of the groups it belongs to."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        user = _user(client.admin_get_user(UserPoolId=pool_id, Username=username), "UserAttributes")
    except Exception as e:
        _raise_error(e, f"User {username} not found", f"get user {username} in {pool_id}")

    groups: list[str] = []
    try:
        paginator = client.get_paginator("admin_list_groups_for_user")
        for page in paginator.paginate(UserPoolId=pool_id, Username=username):
            groups.extend(g["GroupName"] for g in page.get("Groups", []))
    except Exception:
        logger.warning("Could not list groups for user %s in %s", username, pool_id, exc_info=True)
        groups = []
    user["groups"] = groups
    return user


@router.get("/user-pools/{pool_id}/groups")
def list_groups(pool_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """List groups in a user pool."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        paginator = client.get_paginator("list_groups")
        groups = []
        for page in paginator.paginate(UserPoolId=pool_id):
            for group in page.get("Groups", []):
                groups.append(
                    {
                        "name": group.get("GroupName"),
                        "description": group.get("Description"),
                        "precedence": group.get("Precedence"),
                        "roleArn": group.get("RoleArn"),
                    }
                )
        return {"groups": groups}
    except Exception as e:
        _raise_error(e, f"User pool {pool_id} not found", f"list groups for {pool_id}")


@router.get("/user-pools/{pool_id}/groups/{group_name:path}")
def get_group(pool_id: str, group_name: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Get one group with its members. `:path` keeps group names containing "/" routable."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        group = client.get_group(GroupName=group_name, UserPoolId=pool_id)["Group"]
        paginator = client.get_paginator("list_users_in_group")
        members = []
        for page in paginator.paginate(UserPoolId=pool_id, GroupName=group_name):
            for user in page.get("Users", []):
                members.append(
                    {
                        "username": user.get("Username"),
                        "status": user.get("UserStatus"),
                        "enabled": user.get("Enabled"),
                        "email": _attributes(user.get("Attributes")).get("email"),
                    }
                )
        return {
            "name": group.get("GroupName"),
            "description": group.get("Description"),
            "precedence": group.get("Precedence"),
            "roleArn": group.get("RoleArn"),
            "created": group.get("CreationDate"),
            "modified": group.get("LastModifiedDate"),
            "members": members,
        }
    except Exception as e:
        _raise_error(e, f"Group {group_name} not found", f"get group {group_name} in {pool_id}")


@router.get("/user-pools/{pool_id}/clients")
def list_clients(pool_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """List app clients in a user pool. The client secret is never returned."""
    try:
        client = get_client("cognito-idp", **ep.client_kwargs())
        paginator = client.get_paginator("list_user_pool_clients")
        clients = []
        for page in paginator.paginate(UserPoolId=pool_id):
            for summary in page.get("UserPoolClients", []):
                detail = client.describe_user_pool_client(
                    UserPoolId=pool_id, ClientId=summary["ClientId"]
                )["UserPoolClient"]
                clients.append(
                    {
                        "clientId": detail.get("ClientId"),
                        "clientName": detail.get("ClientName"),
                        "explicitAuthFlows": detail.get("ExplicitAuthFlows", []),
                        "allowedOAuthFlows": detail.get("AllowedOAuthFlows", []),
                        "callbackURLs": detail.get("CallbackURLs", []),
                        "tokenValidity": {
                            "accessToken": detail.get("AccessTokenValidity"),
                            "idToken": detail.get("IdTokenValidity"),
                            "refreshToken": detail.get("RefreshTokenValidity"),
                            "units": detail.get("TokenValidityUnits"),
                        },
                    }
                )
        return {"clients": clients}
    except Exception as e:
        _raise_error(e, f"User pool {pool_id} not found", f"list app clients for {pool_id}")


# --- Identity pools ---


@router.get("/identity-pools")
def list_identity_pools(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List Cognito identity pools."""
    try:
        client = get_client("cognito-identity", **ep.client_kwargs())
        paginator = client.get_paginator("list_identity_pools")
        pools = []
        for page in paginator.paginate(MaxResults=60):
            for pool in page.get("IdentityPools", []):
                pools.append({"id": pool.get("IdentityPoolId"), "name": pool.get("IdentityPoolName")})
        return {"identityPools": pools}
    except Exception as e:
        _raise_error(e, "Identity pools not found", "list identity pools")


@router.get("/identity-pools/{pool_id}")
def get_identity_pool(pool_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Describe one identity pool, plus its roles and raw role mappings.

    Roles degrade to empty dicts when get_identity_pool_roles fails (some emulators lack it).
    """
    try:
        client = get_client("cognito-identity", **ep.client_kwargs())
        response = client.describe_identity_pool(IdentityPoolId=pool_id)
        response.pop("ResponseMetadata", None)
    except Exception as e:
        _raise_error(e, f"Identity pool {pool_id} not found", f"describe identity pool {pool_id}")

    try:
        roles = client.get_identity_pool_roles(IdentityPoolId=pool_id)
        response["roles"] = roles.get("Roles") or {}
        response["roleMappings"] = roles.get("RoleMappings") or {}
    except Exception:
        logger.warning("Could not get roles for identity pool %s", pool_id, exc_info=True)
        response["roles"] = {}
        response["roleMappings"] = {}
    return response
