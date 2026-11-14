"""Bedrock routes: foundation models and a Converse playground."""

import time

from botocore.config import Config
from fastapi import APIRouter, Depends

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.bedrock import ConverseBody

router = APIRouter()

# A Converse call runs a model and is billed per invocation. botocore's defaults
# (up to 5 attempts, and a read timeout counts as retryable) would send a slow
# answer to the model several times, so make one attempt and wait for it.
_CONVERSE_CONFIG = Config(
    retries={"mode": "standard", "total_max_attempts": 1},
    read_timeout=300,
)


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

    Failures are not caught here: the app-wide handlers answer them with the
    right status and a classified message (not implemented, credentials, ...).
    """
    bedrock = get_client("bedrock", **ep.client_kwargs())
    response = bedrock.list_foundation_models(byOutputModality="TEXT")
    return {"models": [_serialize_model(m) for m in response.get("modelSummaries", [])]}


@router.post("/converse")
def converse(body: ConverseBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Send one prompt to a model through the Converse API.

    Invoking a model does not change any AWS resource, so this POST is allowed
    in read-only mode (see ReadOnlyMiddleware). Failures are answered by the
    app-wide handlers, which keep the upstream status (a rejected parameter is
    a 400, throttling a 429) and classify credentials and access problems.
    """
    runtime = get_client("bedrock-runtime", client_config=_CONVERSE_CONFIG, **ep.client_kwargs())
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
    response = runtime.converse(**params)
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
