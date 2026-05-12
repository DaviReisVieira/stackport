"""Step Functions service-specific routes."""

import json
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.stepfunctions import StartExecutionRequest, StopExecutionRequest

router = APIRouter()


@router.get("/state-machines")
def list_state_machines(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all Step Functions state machines."""
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        response = client.list_state_machines()
        return {"stateMachines": response.get("stateMachines", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/state-machines/{arn}")
def get_state_machine_detail(
    arn: str,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Get state machine detail including ASL definition."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        response = client.describe_state_machine(stateMachineArn=decoded_arn)

        # Parse definition JSON string into dict
        if "definition" in response:
            try:
                response["definition"] = json.loads(response["definition"])
            except (json.JSONDecodeError, TypeError):
                pass  # Keep as string if parsing fails

        return response
    except client.exceptions.StateMachineDoesNotExist as e:
        raise HTTPException(status_code=404, detail=f"State machine not found: {decoded_arn}") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/state-machines/{arn}/executions")
def list_executions(
    arn: str,
    status_filter: str | None = Query(None, alias="status_filter"),
    max_results: int = Query(50, alias="max_results", ge=1, le=1000),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """List executions for a state machine."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        kwargs: dict[str, Any] = {
            "stateMachineArn": decoded_arn,
            "maxResults": max_results,
        }
        if status_filter:
            kwargs["statusFilter"] = status_filter

        response = client.list_executions(**kwargs)
        return {"executions": response.get("executions", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/state-machines/{arn}/executions")
def start_execution(
    arn: str,
    request: StartExecutionRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Start a new execution of a state machine."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        kwargs: dict[str, Any] = {"stateMachineArn": decoded_arn}

        if request.name:
            kwargs["name"] = request.name
        if request.input is not None:
            kwargs["input"] = json.dumps(request.input)

        response = client.start_execution(**kwargs)
        return {
            "executionArn": response["executionArn"],
            "startDate": response["startDate"].isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/executions/{arn}")
def get_execution_detail(
    arn: str,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Get execution detail."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        response = client.describe_execution(executionArn=decoded_arn)

        # Parse input/output JSON strings into dicts
        for field in ["input", "output"]:
            if field in response:
                try:
                    response[field] = json.loads(response[field])
                except (json.JSONDecodeError, TypeError):
                    pass  # Keep as string if parsing fails

        # Convert datetime objects to ISO strings
        for date_field in ["startDate", "stopDate"]:
            if date_field in response and response[date_field]:
                response[date_field] = response[date_field].isoformat()

        return response
    except client.exceptions.ExecutionDoesNotExist as e:
        raise HTTPException(status_code=404, detail=f"Execution not found: {decoded_arn}") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/executions/{arn}/history")
def get_execution_history(
    arn: str,
    max_results: int = Query(100, alias="max_results", ge=1, le=1000),
    reverse_order: bool = Query(False, alias="reverse_order"),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Get execution history events."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        response = client.get_execution_history(
            executionArn=decoded_arn,
            maxResults=max_results,
            reverseOrder=reverse_order,
        )

        # Convert datetime objects to ISO strings in events
        events = response.get("events", [])
        for event in events:
            if "timestamp" in event:
                event["timestamp"] = event["timestamp"].isoformat()

        return {"events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/executions/{arn}/stop")
def stop_execution(
    arn: str,
    request: StopExecutionRequest,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Stop a running execution."""
    decoded_arn = unquote(arn)
    try:
        client = get_client("stepfunctions", **ep.client_kwargs())
        kwargs: dict[str, Any] = {"executionArn": decoded_arn}

        if request.error:
            kwargs["error"] = request.error
        if request.cause:
            kwargs["cause"] = request.cause

        response = client.stop_execution(**kwargs)
        return {"stopDate": response["stopDate"].isoformat()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
