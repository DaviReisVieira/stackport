"""Endpoints management routes."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.aws_client import get_client
from backend.cache import cache
from backend.config import AWS_REGION, endpoint_store
from backend.schemas.endpoints import AddEndpointBody, SetDefaultBody, UpdateEndpointBody

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/endpoints")
def list_endpoints():
    """List configured endpoints with health status."""
    results = []
    default_name = endpoint_store.get_default_name()
    all_endpoints = endpoint_store.list_all()

    for name, entry in all_endpoints.items():
        url = entry["url"]
        auth_type = entry.get("auth_type", "default")
        health = "unknown"
        try:
            s3 = get_client(
                "s3",
                endpoint_url=url,
                region=entry.get("region"),
                auth_type=auth_type,
                auth_profile=entry.get("auth_profile"),
                auth_access_key_id=entry.get("auth_access_key_id"),
                auth_secret_access_key=entry.get("auth_secret_access_key"),
            )
            s3.list_buckets()
            health = "healthy"
        except Exception:
            logger.debug("Endpoint %s (%s) unhealthy", name, url, exc_info=True)
            health = "unhealthy"

        results.append({
            "name": name,
            "url": url,
            "health": health,
            "active": name == default_name,
            "connection_type": "aws" if url is None or ".amazonaws.com" in url else "local",
            "region": entry.get("region") or AWS_REGION,
            "source": entry["source"],
            "auth_type": auth_type,
        })

    return {"endpoints": results}


@router.post("/endpoints", status_code=201)
async def add_endpoint(body: AddEndpointBody):
    """Add a new endpoint."""
    try:
        endpoint_store.add(
            body.name,
            body.url,
            region=body.region,
            auth_type=body.auth_type,
            auth_profile=body.auth_profile,
            auth_access_key_id=body.auth_access_key_id,
            auth_secret_access_key=body.auth_secret_access_key,
        )
        entry = endpoint_store.get(body.name)
        if not entry:
            raise HTTPException(status_code=500, detail="Failed to retrieve created endpoint")

        # Broadcast change to connected clients
        from backend.websocket import broadcast_endpoints_changed
        asyncio.create_task(broadcast_endpoints_changed())

        return {
            "name": body.name,
            "url": entry["url"],
            "source": entry["source"],
            "region": entry.get("region") or AWS_REGION,
            "auth_type": entry.get("auth_type", "default"),
        }
    except ValueError as e:
        error_msg = str(e)
        if "already exists" in error_msg:
            raise HTTPException(status_code=409, detail=error_msg)
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        logger.error("Failed to add endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/endpoints/default")
async def set_default_endpoint(body: SetDefaultBody):
    """Set the default endpoint."""
    try:
        endpoint_store.set_default(body.name)

        # Broadcast change to connected clients
        from backend.websocket import broadcast_endpoints_changed
        asyncio.create_task(broadcast_endpoints_changed())

        return {
            "success": True,
            "default": body.name,
            "message": f"Default endpoint set to '{body.name}'",
        }
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg:
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        logger.error("Failed to set default endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/endpoints/{name}")
async def update_endpoint(name: str, body: UpdateEndpointBody):
    """Update an existing endpoint."""
    try:
        old_entry = endpoint_store.get(name)
        old_url = old_entry["url"] if old_entry else None

        update_kwargs: dict = {}
        if "url" in body.model_fields_set:
            update_kwargs["url"] = body.url
        if "region" in body.model_fields_set:
            update_kwargs["region"] = body.region
        if "auth_type" in body.model_fields_set:
            update_kwargs["auth_type"] = body.auth_type
        if "auth_profile" in body.model_fields_set:
            update_kwargs["auth_profile"] = body.auth_profile
        if "auth_access_key_id" in body.model_fields_set:
            update_kwargs["auth_access_key_id"] = body.auth_access_key_id
        if "auth_secret_access_key" in body.model_fields_set:
            update_kwargs["auth_secret_access_key"] = body.auth_secret_access_key
        endpoint_store.update(name, **update_kwargs)
        entry = endpoint_store.get(name)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Endpoint '{name}' not found")

        # Clear cached boto3 clients for this endpoint
        from backend.aws_client import get_client
        get_client.cache_clear()

        # Clear stats cache entries for old URL
        if old_url:
            cache.delete_by_prefix(f"{old_url}:")

        # Broadcast change to connected clients
        from backend.websocket import broadcast_endpoints_changed
        asyncio.create_task(broadcast_endpoints_changed())

        return {
            "name": name,
            "url": entry["url"],
            "source": entry["source"],
            "region": entry.get("region") or AWS_REGION,
            "auth_type": entry.get("auth_type", "default"),
        }
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg:
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        logger.error("Failed to update endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/endpoints/{name}")
async def delete_endpoint(name: str):
    """Delete an endpoint."""
    try:
        entry = endpoint_store.get(name)
        old_url = entry["url"] if entry else None

        endpoint_store.remove(name)

        # Clear cached boto3 clients
        from backend.aws_client import get_client
        get_client.cache_clear()

        # Clear stats cache entries for deleted URL
        if old_url:
            cache.delete_by_prefix(f"{old_url}:")

        # Remove from WebSocket stats tracking
        from backend.websocket import broadcast_endpoints_changed, remove_endpoint_from_stats
        remove_endpoint_from_stats(old_url)

        # Broadcast change to connected clients
        asyncio.create_task(broadcast_endpoints_changed())

        return Response(status_code=204)
    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg:
            raise HTTPException(status_code=404, detail=error_msg)
        if "last endpoint" in error_msg:
            raise HTTPException(status_code=400, detail=error_msg)
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        logger.error("Failed to delete endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/profiles")
def list_profiles():
    """List available AWS profiles from ~/.aws/config."""
    try:
        session = __import__("boto3").Session()
        profiles = session.available_profiles
        return {"profiles": sorted(profiles)}
    except Exception as e:
        logger.warning("Failed to list AWS profiles: %s", e)
        return {"profiles": []}


@router.post("/endpoints/test-connection")
def test_connection(body: AddEndpointBody):
    """Test a connection with arbitrary params (no save required)."""
    health = "unknown"
    error_message = None

    try:
        # Clear cache to ensure fresh client with new auth
        get_client.cache_clear()
        s3 = get_client(
            "s3",
            endpoint_url=body.url,
            region=body.region,
            auth_type=body.auth_type,
            auth_profile=body.auth_profile,
            auth_access_key_id=body.auth_access_key_id,
            auth_secret_access_key=body.auth_secret_access_key,
        )
        s3.list_buckets()
        health = "healthy"
    except Exception as e:
        logger.debug("Test connection failed: %s", e, exc_info=True)
        health = "unhealthy"
        error_message = str(e)

    return {
        "url": body.url,
        "health": health,
        "error": error_message,
    }


@router.post("/endpoints/{name}/health")
def check_endpoint_health(name: str):
    """Check health of a specific endpoint."""
    try:
        entry = endpoint_store.get(name)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Endpoint '{name}' not found")

        url = entry["url"]
        health = "unknown"
        error_message = None

        try:
            s3 = get_client(
                "s3",
                endpoint_url=url,
                region=entry.get("region"),
                auth_type=entry.get("auth_type", "default"),
                auth_profile=entry.get("auth_profile"),
                auth_access_key_id=entry.get("auth_access_key_id"),
                auth_secret_access_key=entry.get("auth_secret_access_key"),
            )
            s3.list_buckets()
            health = "healthy"
        except Exception as e:
            logger.debug("Endpoint %s (%s) unhealthy", name, url, exc_info=True)
            health = "unhealthy"
            error_message = str(e)

        return {
            "name": name,
            "url": url,
            "health": health,
            "error": error_message,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to check endpoint health: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
