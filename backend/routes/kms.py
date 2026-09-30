from fastapi import APIRouter, Depends, HTTPException
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.aws_client import get_client
import json, logging
from botocore.exceptions import ClientError

router = APIRouter()

logger = logging.getLogger(__name__)


@router.get("/keys")
def list_keys(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List all KMS keys with basic information"""
    try:
        client = get_client("kms", **ep.client_kwargs())
        paginator = client.get_paginator("list_keys")

        all_keys = []

        for pages in paginator.paginate():
            for key in pages["Keys"]:
                key_id = key["KeyId"]

                metadata = client.describe_key(KeyId=key_id)["KeyMetadata"]

                all_keys.append(
                    {
                        "status": metadata["KeyState"],
                        "creationDate": metadata["CreationDate"],
                        "keySpec": metadata["KeySpec"],
                        "keyUsage": metadata["KeyUsage"],
                        "keyID": key_id,
                        "keyArn": metadata["Arn"],
                    }
                )

        return {"keys": all_keys}
    except Exception as e:
        logger.error("Failed to list keys with metadata %s", id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keys/{id}")
def get_key_detail(id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    "Get detailed information for a specific kms key."
    try:
        client = get_client("kms", **ep.client_kwargs())
        metadata = client.describe_key(KeyId=id)["KeyMetadata"]
        tags = client.list_resource_tags(KeyId=id)
        rotation_status = client.get_key_rotation_status(KeyId=id)
        return {
            "status": metadata["KeyState"],
            "expiresAt": metadata.get("ValidTo"),
            "origin": metadata["Origin"],
            "description": metadata.get("Description"),
            "tags": tags["Tags"],
            "rotationStatus": {
                "keyRotationEnabled": rotation_status["KeyRotationEnabled"],
                "rotationPeriodInDays": rotation_status.get("RotationPeriodInDays"),
                "nextRotationDate": rotation_status.get("NextRotationDate"),
                "onDemandRotationStartDate": rotation_status.get(
                    "OnDemandRotationStartDate"
                ),
            },
        }
    except HTTPException:
        raise
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "NotFoundException":
            raise HTTPException(status_code=404, detail=f"Key {id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Failed to get details for %s", id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keys/{id}/policy")
def get_key_policy(id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    "Get key policy for a specific kms key"
    try:
        client = get_client("kms", **ep.client_kwargs())
        policy = client.get_key_policy(KeyId=id)
        policy = json.loads(policy["Policy"])
        return policy
    except HTTPException:
        raise
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "NotFoundException":
            raise HTTPException(status_code=404, detail=f"Key {id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Failed to get policy document for %s", id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keys/{id}/grants")
def list_grants(id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    "List grants for a specific key"
    try:
        client = get_client("kms", **ep.client_kwargs())
        paginator = client.get_paginator("list_grants")

        all_grants = []
        for pages in paginator.paginate(KeyId=id):
            for grant in pages["Grants"]:
                all_grants.append(
                    {
                        "grantID": grant["GrantId"],
                        "grantee": grant["GranteePrincipal"],
                        "operations": grant["Operations"],
                        "creationDate": grant["CreationDate"],
                    }
                )

        return all_grants
    except HTTPException:
        raise
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "NotFoundException":
            raise HTTPException(status_code=404, detail=f"Key {id} not found")
        if error_code == "InvalidAction":
            logger.warning(
                "ListGrants is not supported by the configured KMS backend",
                exc_info=True,
            )
            return []
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Failed to list grants for %s", id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keys/{id}/aliases")
def get_aliases_detail(id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    try:
        client = get_client("kms", **ep.client_kwargs())
        paginator = client.get_paginator("list_aliases")

        all_aliases = []
        for pages in paginator.paginate(KeyId=id):
            for alias in pages["Aliases"]:
                all_aliases.append(
                    {
                        "aliasName": alias["AliasName"],
                        "aliasArn": alias["AliasArn"],
                        "creationDate": alias.get("CreationDate"),
                    }
                )
        return all_aliases
    except HTTPException:
        raise
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "NotFoundException":
            raise HTTPException(status_code=404, detail=f"Key {id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Failed to get aliases for %s", id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
