"""Endpoints management routes."""

import logging

from fastapi import APIRouter

from backend.aws_client import get_client
from backend.config import AWS_REGION, DEFAULT_ENDPOINT, ENDPOINTS

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/endpoints")
def list_endpoints():
    """List configured endpoints with health status."""
    results = []

    for name, url in ENDPOINTS.items():
        health = "unknown"
        try:
            s3 = get_client("s3", url)
            s3.list_buckets()
            health = "healthy"
        except Exception:
            logger.debug("Endpoint %s (%s) unhealthy", name, url, exc_info=True)
            health = "unhealthy"

        results.append({
            "name": name,
            "url": url,
            "health": health,
            "active": url == DEFAULT_ENDPOINT,
            "connection_type": "aws" if url is None or ".amazonaws.com" in url else "local",
            "region": AWS_REGION,
        })

    return {"endpoints": results}
