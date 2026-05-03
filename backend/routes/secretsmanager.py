"""Secrets Manager service-specific routes."""

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.secretsmanager import (
    CreateSecretBody,
    UpdateSecretMetadataBody,
    UpdateSecretValueBody,
)

router = APIRouter()


def _format_date(dt) -> str | None:
    """Format a datetime to ISO string, or return None."""
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


@router.get("/secrets")
def list_secrets(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all secrets with metadata."""
    try:
        client = get_client("secretsmanager", **ep.client_kwargs())
        paginator = client.get_paginator("list_secrets")

        secrets = []
        for page in paginator.paginate():
            for secret in page.get("SecretList", []):
                secrets.append(
                    {
                        "name": secret.get("Name"),
                        "arn": secret.get("ARN"),
                        "description": secret.get("Description", ""),
                        "createdDate": _format_date(secret.get("CreatedDate")),
                        "lastChangedDate": _format_date(
                            secret.get("LastChangedDate")
                        ),
                        "lastAccessedDate": _format_date(
                            secret.get("LastAccessedDate")
                        ),
                        "rotationEnabled": secret.get("RotationEnabled", False),
                        "tags": {
                            tag["Key"]: tag["Value"]
                            for tag in secret.get("Tags", [])
                        },
                    }
                )

        return {"secrets": secrets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/secrets/{secret_id:path}")
def get_secret_detail(secret_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get secret metadata and value."""
    try:
        client = get_client("secretsmanager", **ep.client_kwargs())

        # Get metadata
        try:
            meta = client.describe_secret(SecretId=secret_id)
        except client.exceptions.ResourceNotFoundException:
            raise HTTPException(
                status_code=404, detail=f"Secret '{secret_id}' not found"
            )

        # Get value
        secret_value = None
        secret_binary = None
        version_id = None
        version_stages = None
        try:
            value_resp = client.get_secret_value(SecretId=secret_id)
            secret_value = value_resp.get("SecretString")
            raw_binary = value_resp.get("SecretBinary")
            if raw_binary is not None:
                secret_binary = base64.b64encode(raw_binary).decode("utf-8")
            version_id = value_resp.get("VersionId")
            version_stages = value_resp.get("VersionStages")
        except Exception:
            # Value may not be retrievable (e.g., pending deletion)
            pass

        return {
            "name": meta.get("Name"),
            "arn": meta.get("ARN"),
            "description": meta.get("Description", ""),
            "createdDate": _format_date(meta.get("CreatedDate")),
            "lastChangedDate": _format_date(meta.get("LastChangedDate")),
            "lastAccessedDate": _format_date(meta.get("LastAccessedDate")),
            "rotationEnabled": meta.get("RotationEnabled", False),
            "rotationRules": meta.get("RotationRules"),
            "rotationLambdaARN": meta.get("RotationLambdaARN"),
            "deletedDate": _format_date(meta.get("DeletedDate")),
            "tags": {
                tag["Key"]: tag["Value"]
                for tag in meta.get("Tags", [])
            },
            "versionId": version_id,
            "versionStages": version_stages,
            "secretValue": secret_value,
            "secretBinary": secret_binary,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/secrets", status_code=201)
def create_secret(body: CreateSecretBody, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Create a new secret."""
    if not body.secret_string and not body.secret_binary:
        raise HTTPException(status_code=400, detail="Must provide either secret_string or secret_binary")

    try:
        client = get_client("secretsmanager", **ep.client_kwargs())

        kwargs: dict[str, Any] = {"Name": body.name}
        if body.description:
            kwargs["Description"] = body.description
        if body.secret_string:
            kwargs["SecretString"] = body.secret_string
        if body.secret_binary:
            kwargs["SecretBinary"] = base64.b64decode(body.secret_binary)
        if body.tags:
            kwargs["Tags"] = [{"Key": k, "Value": v} for k, v in body.tags.items()]

        resp = client.create_secret(**kwargs)
        return {
            "name": resp["Name"],
            "arn": resp["ARN"],
            "versionId": resp.get("VersionId"),
        }
    except client.exceptions.ResourceExistsException:
        raise HTTPException(status_code=409, detail=f"Secret '{body.name}' already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/secrets/{secret_id:path}/value")
def update_secret_value(secret_id: str, body: UpdateSecretValueBody, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Update a secret's value."""
    if not body.secret_string and not body.secret_binary:
        raise HTTPException(status_code=400, detail="Must provide either secret_string or secret_binary")

    try:
        client = get_client("secretsmanager", **ep.client_kwargs())

        kwargs: dict[str, Any] = {"SecretId": secret_id}
        if body.secret_string:
            kwargs["SecretString"] = body.secret_string
        if body.secret_binary:
            kwargs["SecretBinary"] = base64.b64decode(body.secret_binary)

        resp = client.put_secret_value(**kwargs)
        return {
            "arn": resp["ARN"],
            "name": resp["Name"],
            "versionId": resp["VersionId"],
            "versionStages": resp.get("VersionStages"),
        }
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Secret '{secret_id}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/secrets/{secret_id:path}/metadata")
def update_secret_metadata(secret_id: str, body: UpdateSecretMetadataBody, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Update a secret's description and/or tags."""
    try:
        client = get_client("secretsmanager", **ep.client_kwargs())

        # Update description
        if body.description is not None:
            client.update_secret(SecretId=secret_id, Description=body.description)

        # Update tags (replace all)
        if body.tags is not None:
            arn = client.describe_secret(SecretId=secret_id)["ARN"]
            # Remove all existing tags first
            existing_tags_resp = client.describe_secret(SecretId=secret_id)
            existing_tag_keys = [tag["Key"] for tag in existing_tags_resp.get("Tags", [])]
            if existing_tag_keys:
                client.untag_resource(SecretId=arn, TagKeys=existing_tag_keys)
            # Add new tags
            if body.tags:
                client.tag_resource(
                    SecretId=arn,
                    Tags=[{"Key": k, "Value": v} for k, v in body.tags.items()],
                )

        return {"success": True, "message": "Metadata updated"}
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Secret '{secret_id}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/secrets/{secret_id:path}")
def delete_secret(
    secret_id: str,
    force: bool = Query(False, description="Skip recovery window (immediate deletion)"),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Delete a secret."""
    try:
        client = get_client("secretsmanager", **ep.client_kwargs())

        kwargs: dict[str, Any] = {"SecretId": secret_id}
        if force:
            kwargs["ForceDeleteWithoutRecovery"] = True
        else:
            kwargs["RecoveryWindowInDays"] = 7

        resp = client.delete_secret(**kwargs)
        return {
            "arn": resp["ARN"],
            "name": resp["Name"],
            "deletionDate": _format_date(resp.get("DeletionDate")),
        }
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Secret '{secret_id}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/secrets/{secret_id:path}/restore")
def restore_secret(secret_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Restore a deleted secret."""
    try:
        client = get_client("secretsmanager", **ep.client_kwargs())
        resp = client.restore_secret(SecretId=secret_id)
        return {
            "arn": resp["ARN"],
            "name": resp["Name"],
        }
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code == "ResourceNotFoundException":
            raise HTTPException(status_code=404, detail=f"Secret '{secret_id}' not found")
        elif error_code == "InvalidRequestException":
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
