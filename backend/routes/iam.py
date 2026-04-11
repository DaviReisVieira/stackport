import json
import logging
from urllib.parse import unquote

from fastapi import APIRouter, Query

from backend.aws_client import get_client

logger = logging.getLogger(__name__)

router = APIRouter()


def _decode_policy_document(encoded_doc: str) -> dict:
    """Decode URL-encoded policy document JSON."""
    try:
        decoded = unquote(encoded_doc)
        return json.loads(decoded)
    except Exception:
        logger.debug("Failed to decode policy document", exc_info=True)
        return {}


@router.get("/users")
def list_users():
    iam = get_client("iam")
    response = iam.list_users()
    users = [
        {
            "UserName": u["UserName"],
            "UserId": u["UserId"],
            "Arn": u["Arn"],
            "Path": u.get("Path", "/"),
            "CreateDate": u["CreateDate"].isoformat(),
        }
        for u in response.get("Users", [])
    ]
    return {"users": users}


@router.get("/users/{name}")
def get_user_detail(name: str):
    iam = get_client("iam")

    # Get user detail
    user_resp = iam.get_user(UserName=name)
    user = user_resp["User"]

    # Get attached managed policies
    attached_resp = iam.list_attached_user_policies(UserName=name)
    attached_policies = attached_resp.get("AttachedPolicies", [])

    # Get inline policies
    inline_names_resp = iam.list_user_policies(UserName=name)
    inline_policies = []
    for policy_name in inline_names_resp.get("PolicyNames", []):
        try:
            policy_resp = iam.get_user_policy(UserName=name, PolicyName=policy_name)
            doc = _decode_policy_document(policy_resp["PolicyDocument"])
            inline_policies.append({"name": policy_name, "document": doc})
        except Exception:
            logger.debug("Failed to get inline policy %s for user %s", policy_name, name, exc_info=True)

    # Get groups
    groups_resp = iam.list_groups_for_user(UserName=name)
    groups = groups_resp.get("Groups", [])

    # Get access keys
    access_keys = []
    try:
        keys_resp = iam.list_access_keys(UserName=name)
        access_keys = keys_resp.get("AccessKeyMetadata", [])
    except Exception:
        logger.debug("Failed to get access keys for user %s", name, exc_info=True)

    # Get tags
    tags = {}
    try:
        tags_resp = iam.list_user_tags(UserName=name)
        tags = {t["Key"]: t["Value"] for t in tags_resp.get("Tags", [])}
    except Exception:
        logger.debug("Failed to get tags for user %s", name, exc_info=True)

    return {
        "user": {
            "UserName": user["UserName"],
            "UserId": user["UserId"],
            "Arn": user["Arn"],
            "Path": user.get("Path", "/"),
            "CreateDate": user["CreateDate"].isoformat(),
            "PasswordLastUsed": user.get("PasswordLastUsed", "").isoformat() if user.get("PasswordLastUsed") else None,
        },
        "attached_policies": attached_policies,
        "inline_policies": inline_policies,
        "groups": groups,
        "access_keys": access_keys,
        "tags": tags,
    }


@router.get("/roles")
def list_roles():
    iam = get_client("iam")
    response = iam.list_roles()
    roles = [
        {
            "RoleName": r["RoleName"],
            "RoleId": r["RoleId"],
            "Arn": r["Arn"],
            "Path": r.get("Path", "/"),
            "CreateDate": r["CreateDate"].isoformat(),
            "MaxSessionDuration": r.get("MaxSessionDuration"),
        }
        for r in response.get("Roles", [])
    ]
    return {"roles": roles}


@router.get("/roles/{name}")
def get_role_detail(name: str):
    iam = get_client("iam")

    # Get role detail (includes AssumeRolePolicyDocument)
    role_resp = iam.get_role(RoleName=name)
    role = role_resp["Role"]
    trust_policy = _decode_policy_document(role.get("AssumeRolePolicyDocument", ""))

    # Get attached managed policies
    attached_resp = iam.list_attached_role_policies(RoleName=name)
    attached_policies = attached_resp.get("AttachedPolicies", [])

    # Get inline policies
    inline_names_resp = iam.list_role_policies(RoleName=name)
    inline_policies = []
    for policy_name in inline_names_resp.get("PolicyNames", []):
        try:
            policy_resp = iam.get_role_policy(RoleName=name, PolicyName=policy_name)
            doc = _decode_policy_document(policy_resp["PolicyDocument"])
            inline_policies.append({"name": policy_name, "document": doc})
        except Exception:
            logger.debug("Failed to get inline policy %s for role %s", policy_name, name, exc_info=True)

    # Get tags
    tags = {}
    try:
        tags_resp = iam.list_role_tags(RoleName=name)
        tags = {t["Key"]: t["Value"] for t in tags_resp.get("Tags", [])}
    except Exception:
        logger.debug("Failed to get tags for role %s", name, exc_info=True)

    return {
        "role": {
            "RoleName": role["RoleName"],
            "RoleId": role["RoleId"],
            "Arn": role["Arn"],
            "Path": role.get("Path", "/"),
            "CreateDate": role["CreateDate"].isoformat(),
            "MaxSessionDuration": role.get("MaxSessionDuration"),
        },
        "trust_policy": trust_policy,
        "attached_policies": attached_policies,
        "inline_policies": inline_policies,
        "tags": tags,
    }


@router.get("/groups")
def list_groups():
    iam = get_client("iam")
    response = iam.list_groups()
    groups = [
        {
            "GroupName": g["GroupName"],
            "GroupId": g["GroupId"],
            "Arn": g["Arn"],
            "Path": g.get("Path", "/"),
            "CreateDate": g["CreateDate"].isoformat(),
        }
        for g in response.get("Groups", [])
    ]
    return {"groups": groups}


@router.get("/groups/{name}")
def get_group_detail(name: str):
    iam = get_client("iam")

    # Get group detail and members
    group_resp = iam.get_group(GroupName=name)
    group = group_resp["Group"]
    users = group_resp.get("Users", [])

    # Get attached managed policies
    attached_resp = iam.list_attached_group_policies(GroupName=name)
    attached_policies = attached_resp.get("AttachedPolicies", [])

    # Get inline policies
    inline_names_resp = iam.list_group_policies(GroupName=name)
    inline_policies = []
    for policy_name in inline_names_resp.get("PolicyNames", []):
        try:
            policy_resp = iam.get_group_policy(GroupName=name, PolicyName=policy_name)
            doc = _decode_policy_document(policy_resp["PolicyDocument"])
            inline_policies.append({"name": policy_name, "document": doc})
        except Exception:
            logger.debug("Failed to get inline policy %s for group %s", policy_name, name, exc_info=True)

    return {
        "group": {
            "GroupName": group["GroupName"],
            "GroupId": group["GroupId"],
            "Arn": group["Arn"],
            "Path": group.get("Path", "/"),
            "CreateDate": group["CreateDate"].isoformat(),
        },
        "users": users,
        "attached_policies": attached_policies,
        "inline_policies": inline_policies,
    }


@router.get("/policies")
def list_policies(scope: str = Query(default="Local", description="Policy scope: Local, AWS, or All")):
    iam = get_client("iam")
    params = {}
    if scope in ["Local", "AWS"]:
        params["Scope"] = scope

    response = iam.list_policies(**params)
    policies = [
        {
            "PolicyName": p["PolicyName"],
            "PolicyId": p["PolicyId"],
            "Arn": p["Arn"],
            "Path": p.get("Path", "/"),
            "DefaultVersionId": p.get("DefaultVersionId"),
            "AttachmentCount": p.get("AttachmentCount", 0),
            "CreateDate": p["CreateDate"].isoformat(),
            "UpdateDate": p["UpdateDate"].isoformat(),
        }
        for p in response.get("Policies", [])
    ]
    return {"policies": policies}


@router.get("/policies/{arn:path}")
def get_policy_detail(arn: str):
    iam = get_client("iam")

    # Get policy metadata
    policy_resp = iam.get_policy(PolicyArn=arn)
    policy = policy_resp["Policy"]

    # Get policy document
    version_id = policy.get("DefaultVersionId")
    document = {}
    if version_id:
        try:
            version_resp = iam.get_policy_version(PolicyArn=arn, VersionId=version_id)
            document = _decode_policy_document(version_resp["PolicyVersion"]["Document"])
        except Exception:
            logger.debug("Failed to get policy document for %s", arn, exc_info=True)

    # Get attached entities
    attached_to = {"users": [], "roles": [], "groups": []}
    try:
        entities_resp = iam.list_entities_for_policy(PolicyArn=arn)
        attached_to = {
            "users": entities_resp.get("PolicyUsers", []),
            "roles": entities_resp.get("PolicyRoles", []),
            "groups": entities_resp.get("PolicyGroups", []),
        }
    except Exception:
        logger.debug("Failed to get attached entities for %s", arn, exc_info=True)

    # Get tags
    tags = {}
    try:
        tags_resp = iam.list_policy_tags(PolicyArn=arn)
        tags = {t["Key"]: t["Value"] for t in tags_resp.get("Tags", [])}
    except Exception:
        logger.debug("Failed to get tags for policy %s", arn, exc_info=True)

    return {
        "policy": {
            "PolicyName": policy["PolicyName"],
            "PolicyId": policy["PolicyId"],
            "Arn": policy["Arn"],
            "Path": policy.get("Path", "/"),
            "DefaultVersionId": policy.get("DefaultVersionId"),
            "AttachmentCount": policy.get("AttachmentCount", 0),
            "CreateDate": policy["CreateDate"].isoformat(),
            "UpdateDate": policy["UpdateDate"].isoformat(),
        },
        "document": document,
        "attached_to": attached_to,
        "tags": tags,
    }
