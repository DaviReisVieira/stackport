"""Lambda service-specific routes."""

import base64
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from backend.aws_client import get_client

router = APIRouter()


@router.get("/functions")
def list_functions() -> dict[str, Any]:
    """List all Lambda functions with metadata."""
    try:
        client = get_client("lambda")
        paginator = client.get_paginator("list_functions")

        functions = []
        for page in paginator.paginate():
            functions.extend(page.get("Functions", []))

        return {"functions": functions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}")
def get_function(function_name: str) -> dict[str, Any]:
    """Get full function configuration, code location, and tags."""
    try:
        client = get_client("lambda")
        response = client.get_function(FunctionName=function_name)

        return {
            "configuration": response.get("Configuration", {}),
            "code": response.get("Code", {}),
            "tags": response.get("Tags", {}),
            "concurrency": response.get("Concurrency"),
        }
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/code")
def download_code(function_name: str):
    """Download function deployment package.

    Returns a redirect to the presigned S3 URL or streams the content.
    Only works for ZIP-based functions, not container images.
    """
    try:
        client = get_client("lambda")
        response = client.get_function(FunctionName=function_name)

        config = response.get("Configuration", {})
        package_type = config.get("PackageType", "Zip")

        if package_type == "Image":
            raise HTTPException(
                status_code=400,
                detail="Cannot download code for container image functions"
            )

        code = response.get("Code", {})
        location = code.get("Location")

        if not location:
            raise HTTPException(status_code=404, detail="Code location not available")

        # Redirect to the presigned S3 URL
        return RedirectResponse(url=location)

    except HTTPException:
        raise
    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/functions/{function_name}/invoke")
def invoke_function(function_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Invoke a Lambda function with a JSON payload.

    Request body: { "payload": {...} }
    Returns: status, response payload, logs, error if any.
    """
    try:
        client = get_client("lambda")

        # Extract the actual payload from the request body
        function_payload = payload.get("payload", {})

        response = client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            LogType="Tail",
            Payload=json.dumps(function_payload).encode("utf-8"),
        )

        # Read the streaming body
        response_payload = response.get("Payload")
        if response_payload:
            response_payload = response_payload.read().decode("utf-8")
            try:
                response_payload = json.loads(response_payload)
            except json.JSONDecodeError:
                # Keep as string if not valid JSON
                pass

        # Decode base64 logs
        log_result = response.get("LogResult")
        logs = None
        if log_result:
            try:
                logs = base64.b64decode(log_result).decode("utf-8")
            except Exception:
                logs = None

        return {
            "statusCode": response.get("StatusCode"),
            "functionError": response.get("FunctionError"),
            "executedVersion": response.get("ExecutedVersion"),
            "payload": response_payload,
            "logs": logs,
        }

    except client.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"Function {function_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/event-sources")
def list_event_sources(function_name: str) -> dict[str, Any]:
    """List event source mappings for a function."""
    try:
        client = get_client("lambda")
        paginator = client.get_paginator("list_event_source_mappings")

        mappings = []
        for page in paginator.paginate(FunctionName=function_name):
            mappings.extend(page.get("EventSourceMappings", []))

        return {"eventSourceMappings": mappings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/aliases")
def list_aliases(function_name: str) -> dict[str, Any]:
    """List aliases for a function."""
    try:
        client = get_client("lambda")
        paginator = client.get_paginator("list_aliases")

        aliases = []
        for page in paginator.paginate(FunctionName=function_name):
            aliases.extend(page.get("Aliases", []))

        return {"aliases": aliases}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/functions/{function_name}/versions")
def list_versions(function_name: str) -> dict[str, Any]:
    """List versions for a function."""
    try:
        client = get_client("lambda")
        paginator = client.get_paginator("list_versions_by_function")

        versions = []
        for page in paginator.paginate(FunctionName=function_name):
            versions.extend(page.get("Versions", []))

        return {"versions": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
