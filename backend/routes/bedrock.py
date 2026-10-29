"""Bedrock routes: foundation models and a Converse playground."""

import logging
import time

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.bedrock import ConverseBody

logger = logging.getLogger(__name__)

router = APIRouter()

# Bedrock error codes that mean the request itself is wrong or not allowed,
# as opposed to the service being unavailable.
_STATUS_BY_ERROR_CODE = {
    "ValidationException": 400,
    "ResourceNotFoundException": 404,
    "AccessDeniedException": 403,
    "ThrottlingException": 429,
    "ModelNotReadyException": 429,
}


def _serialize_model(model: dict) -> dict:
    return {
        "modelId": model.get("modelId", ""),
        "modelName": model.get("modelName") or model.get("modelId", ""),
        "providerName": model.get("providerName", ""),
        "inputModalities": model.get("inputModalities", []),
        "outputModalities": model.get("outputModalities", []),
    }


@router.get("/models")
def list_models(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List the text foundation models the endpoint offers.

    Bedrock is optional on emulators and needs its own permissions on real AWS,
    so a failure reports the model list as unavailable instead of a 500.
    """
    bedrock = get_client("bedrock", **ep.client_kwargs())
    try:
        response = bedrock.list_foundation_models(byOutputModality="TEXT")
    except Exception as exc:
        logger.debug("Failed to list foundation models", exc_info=True)
        return {"models": [], "available": False, "message": str(exc)}
    models = [_serialize_model(m) for m in response.get("modelSummaries", [])]
    return {"models": models, "available": True, "message": None}


@router.post("/converse")
def converse(body: ConverseBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Send one prompt to a model through the Converse API.

    Invoking a model does not change any AWS resource, so this POST is allowed
    in read-only mode (see ReadOnlyMiddleware).
    """
    runtime = get_client("bedrock-runtime", **ep.client_kwargs())
    params: dict = {
        "modelId": body.model_id,
        "messages": [{"role": "user", "content": [{"text": body.prompt}]}],
    }
    if body.system:
        params["system"] = [{"text": body.system}]
    inference_config = {
        key: value
        for key, value in (
            ("maxTokens", body.max_tokens),
            ("temperature", body.temperature),
            ("topP", body.top_p),
        )
        if value is not None
    }
    if inference_config:
        params["inferenceConfig"] = inference_config

    started = time.perf_counter()
    try:
        response = runtime.converse(**params)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        raise HTTPException(
            status_code=_STATUS_BY_ERROR_CODE.get(code, 502),
            detail=f"Failed to invoke model: {exc}",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to invoke model: {exc}")
    round_trip_ms = round((time.perf_counter() - started) * 1000)

    blocks = response.get("output", {}).get("message", {}).get("content", [])
    usage = response.get("usage", {})
    return {
        "modelId": body.model_id,
        "text": "".join(block["text"] for block in blocks if "text" in block),
        "stopReason": response.get("stopReason"),
        "usage": {
            "inputTokens": usage.get("inputTokens", 0),
            "outputTokens": usage.get("outputTokens", 0),
            "totalTokens": usage.get("totalTokens", 0),
        },
        "latencyMs": response.get("metrics", {}).get("latencyMs"),
        "roundTripMs": round_trip_ms,
    }
