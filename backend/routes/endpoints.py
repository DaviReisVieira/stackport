"""Endpoints management routes."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from backend.aws_client import get_client
from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import ClassifiedError, ErrorKind, classify
from backend.cache import cache
from backend.config import AWS_REGION, endpoint_store
from backend.connection import EndpointInfo, describe_connection, plan_connection
from backend.emulator_profiles import ResetFailed, ResetRefused, reset_target, send_reset, with_profile
from backend.emulators import detect_emulator
from backend.schemas.endpoints import AddEndpointBody, SetDefaultBody, UpdateEndpointBody

logger = logging.getLogger(__name__)

router = APIRouter()


def check_connection(ep: EndpointInfo, *, identify_emulator: bool = False) -> dict:
    """Try one cheap call against the endpoint and explain the outcome.

    Returns ``health``, ``error`` (a sentence, or None), ``error_detail`` (the
    classified error), and ``connection`` (where credentials and TLS trust come
    from, without any key material). With ``identify_emulator``, also
    ``emulator``: which emulator answers, looked up afresh, or None.
    """
    result = _try_endpoint(ep)
    if identify_emulator:
        # When nothing answered there is nothing to identify, and no reason to wait again.
        detail = result["error_detail"]
        unreachable = detail is not None and detail["kind"] == ErrorKind.UNREACHABLE
        result["emulator"] = None if unreachable else with_profile(detect_emulator(ep, refresh=True))
    return result


def _try_endpoint(ep: EndpointInfo) -> dict:
    try:
        plan = plan_connection(ep)
    except AwsEmulatorFilesError as exc:
        classified = classify(exc)
        return {"health": "unhealthy", "error": classified.message, "error_detail": classified.to_dict(), "connection": None}

    connection = describe_connection(plan)
    try:
        # Every emulator implements ListBuckets, and it needs no parameters.
        get_client("s3", **ep.client_kwargs()).list_buckets()
    except Exception as exc:
        logger.debug("Endpoint %s unhealthy", ep.url, exc_info=True)
        classified = classify(exc) or ClassifiedError(ErrorKind.OTHER, str(exc))
        return {"health": "unhealthy", "error": classified.message, "error_detail": classified.to_dict(), "connection": connection}
    return {"health": "healthy", "error": None, "error_detail": None, "connection": connection}


def _public_entry(entry: dict) -> dict:
    """Fields of a saved endpoint that are safe to return (never the secret key)."""
    return {
        "url": entry["url"],
        "source": entry["source"],
        "region": entry.get("region") or AWS_REGION,
        "auth_type": entry.get("auth_type", "default"),
        "tls_verify": entry.get("tls_verify", True) is not False,
        "ca_bundle": entry.get("ca_bundle"),
    }


@router.get("/endpoints")
def list_endpoints():
    """List configured endpoints with health status."""
    results = []
    default_name = endpoint_store.get_default_name()
    all_endpoints = endpoint_store.list_all()

    for name, entry in all_endpoints.items():
        url = entry["url"]
        check = check_connection(EndpointInfo.from_entry(entry))
        results.append({
            "name": name,
            **_public_entry(entry),
            "health": check["health"],
            "active": name == default_name,
            "connection_type": "aws" if url is None or ".amazonaws.com" in url else "local",
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
            tls_verify=body.tls_verify is not False,
            ca_bundle=body.ca_bundle,
        )
        entry = endpoint_store.get(body.name)
        if not entry:
            raise HTTPException(status_code=500, detail="Failed to retrieve created endpoint")

        # Broadcast change to connected clients
        from backend.websocket import broadcast_endpoints_changed
        asyncio.create_task(broadcast_endpoints_changed())

        return {"name": body.name, **_public_entry(entry)}
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
        # A CA bundle only means something with verification on, and turning
        # verification off makes a CA bundle moot: keep the pair consistent.
        if "tls_verify" in body.model_fields_set and body.tls_verify is not None:
            update_kwargs["tls_verify"] = body.tls_verify
            if body.tls_verify is False:
                update_kwargs["ca_bundle"] = None
        if "ca_bundle" in body.model_fields_set:
            update_kwargs["ca_bundle"] = body.ca_bundle
            if body.ca_bundle:
                update_kwargs["tls_verify"] = True
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

        # Broadcast change to connected clients; live stats kept under the old settings go too
        from backend.websocket import broadcast_endpoints_changed, remove_endpoint_from_stats
        remove_endpoint_from_stats(old_url)
        asyncio.create_task(broadcast_endpoints_changed())

        return {"name": name, **_public_entry(entry)}
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
    # Drop cached clients so profile credentials refreshed on disk are re-read.
    get_client.cache_clear()
    ep = EndpointInfo(
        url=body.url,
        region=body.region,
        auth_type=body.auth_type,
        auth_profile=body.auth_profile,
        auth_access_key_id=body.auth_access_key_id,
        auth_secret_access_key=body.auth_secret_access_key,
        tls_verify=body.tls_verify is not False,
        ca_bundle=body.ca_bundle,
    )
    return {"url": body.url, **check_connection(ep, identify_emulator=True)}


@router.post("/endpoints/{name}/health")
def check_endpoint_health(name: str):
    """Check health of a specific endpoint."""
    entry = endpoint_store.get(name)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Endpoint '{name}' not found")
    return {
        "name": name,
        "url": entry["url"],
        **check_connection(EndpointInfo.from_entry(entry), identify_emulator=True),
    }


@router.post("/endpoints/{name}/reset")
async def reset_endpoint_emulator(name: str):
    """Wipe the state of the emulator behind a saved endpoint, through the emulator's own reset request.

    Async so the live stats, which belong to the event loop, are dropped there;
    the requests to the emulator run in the thread pool.
    """
    entry = endpoint_store.get(name)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Endpoint '{name}' not found")
    ep = EndpointInfo.from_entry(entry)
    try:
        target = await run_in_threadpool(reset_target, ep)
    except ResetRefused as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from None
    except ResetFailed as exc:
        return _reset_failed(ep, exc)
    try:
        await run_in_threadpool(send_reset, target)
    except ResetFailed as exc:
        return _reset_failed(ep, exc)
    finally:
        # Even a reset that failed may have wiped part of the state, so counts
        # and listings cached before it can't be trusted. The boto3 clients
        # stay valid: a reset keeps the emulator's keys and certificate.
        cache.delete_by_prefix(f"{ep.url}:")
        from backend.websocket import remove_endpoint_from_stats
        remove_endpoint_from_stats(ep.url)
    return {"name": name, "url": ep.url, "emulator": {"id": target.emulator_id, "name": target.emulator_name}}


def _reset_failed(ep: EndpointInfo, exc: ResetFailed) -> JSONResponse:
    """Answer in the shape backend.error_handlers uses for classified errors."""
    logger.warning("Resetting the emulator at %s failed: %s", ep.url, exc.error.message)
    return JSONResponse(status_code=502, content={"detail": exc.error.message, "error": exc.error.to_dict()})
