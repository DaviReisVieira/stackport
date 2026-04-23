"""Secrets Manager service-specific routes."""

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import get_endpoint_url

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
def list_secrets(endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """List all secrets with metadata."""
    try:
        client = get_client("secretsmanager", endpoint_url)
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
def get_secret_detail(secret_id: str, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Get secret metadata and value."""
    try:
        client = get_client("secretsmanager", endpoint_url)

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
