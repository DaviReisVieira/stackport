"""WebSocket support for real-time resource updates."""

import asyncio
import functools
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

from backend.aws_client import get_client
from backend.config import endpoint_store
from backend.connection import InvalidEndpointUrl, check_endpoint_url, is_direct_endpoint_url
from backend.routes.common import endpoint_info_for, endpoint_info_for_url
from backend.routes.logs import _epoch_millis_to_iso
from backend.routes.stats import collect_stats

logger = logging.getLogger(__name__)

TAIL_POLL_SECONDS = 1.0


class ConnectionManager:
    """Manages active WebSocket connections with per-endpoint subscriptions."""

    def __init__(self):
        self.active_connections: dict[WebSocket, str | None] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = endpoint_store.get_default_url()
        logger.debug("WebSocket client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        self.active_connections.pop(websocket, None)
        logger.debug("WebSocket client disconnected (%d remaining)", len(self.active_connections))

    def set_endpoint(self, websocket: WebSocket, endpoint_url: str | None):
        if websocket in self.active_connections:
            self.active_connections[websocket] = endpoint_url

    def get_active_endpoints(self) -> set[str | None]:
        return set(self.active_connections.values())

    async def broadcast_to_endpoint(self, endpoint_url: str | None, message: dict):
        data = json.dumps(message)
        for ws, ep in list(self.active_connections.items()):
            if ep == endpoint_url:
                try:
                    await ws.send_text(data)
                except Exception:
                    logger.debug("Failed to send to client, removing", exc_info=True)
                    self.active_connections.pop(ws, None)

    async def broadcast_to_all(self, message: dict):
        """Broadcast a message to all connected clients."""
        data = json.dumps(message)
        for ws in list(self.active_connections.keys()):
            try:
                await ws.send_text(data)
            except Exception:
                logger.debug("Failed to send to client, removing", exc_info=True)
                self.active_connections.pop(ws, None)


manager = ConnectionManager()
_last_stats_by_endpoint: dict[str | None, dict] = {}


async def probe_loop():
    """Background task: probe services for each active endpoint and broadcast."""
    while True:
        await asyncio.sleep(2)

        if not manager.active_connections:
            continue

        for endpoint_url in manager.get_active_endpoints():
            try:
                ep = endpoint_info_for_url(endpoint_url)
                stats = await asyncio.get_running_loop().run_in_executor(None, collect_stats, ep)
                _last_stats_by_endpoint[endpoint_url] = stats
                await manager.broadcast_to_endpoint(endpoint_url, {"type": "stats", "data": stats})
            except Exception:
                logger.warning("Error in probe loop for endpoint %s", endpoint_url, exc_info=True)


def _resolve_endpoint(name_or_url: str | None) -> str | None:
    """Resolve a subscription target. Raises InvalidEndpointUrl for a direct URL StackPort refuses."""
    if is_direct_endpoint_url(name_or_url):
        return check_endpoint_url(name_or_url)
    return endpoint_store.resolve(name_or_url)


async def websocket_endpoint(websocket: WebSocket):
    """Handle a single WebSocket connection."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")
                if msg_type == "subscribe":
                    current_ep = _resolve_endpoint(msg.get("endpoint"))
                    manager.set_endpoint(websocket, current_ep)
                    cached = _last_stats_by_endpoint.get(current_ep)
                    if cached:
                        await websocket.send_text(json.dumps({"type": "stats", "data": cached}))
                    logger.debug("Client subscribed to endpoint: %s", current_ep)
                elif msg_type == "unsubscribe":
                    logger.debug("Client unsubscribed from: %s", msg.get("services"))
            except json.JSONDecodeError:
                pass
            except InvalidEndpointUrl as exc:
                await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)


def _client_kwargs_for(endpoint_name_or_url: str | None) -> dict:
    """Build get_client kwargs (endpoint URL, region, auth, TLS) for an endpoint name or URL."""
    return endpoint_info_for(endpoint_name_or_url).client_kwargs()


def _fetch_new_events(
    group: str,
    stream: str,
    since_millis: int,
    filter_pattern: str,
    client_kwargs: dict,
) -> list[dict]:
    """Fetch log events newer than since_millis; errors degrade to an empty batch."""
    try:
        logs = get_client("logs", **client_kwargs)
        if filter_pattern:
            params: dict = {
                "logGroupName": group,
                "logStreamNames": [stream],
                "limit": 500,
                "filterPattern": filter_pattern,
            }
            if since_millis > 0:
                params["startTime"] = since_millis
            raw = logs.filter_log_events(**params).get("events", [])
        else:
            params = {
                "logGroupName": group,
                "logStreamName": stream,
                "limit": 500,
                "startFromHead": True,
            }
            if since_millis > 0:
                params["startTime"] = since_millis
            raw = logs.get_log_events(**params).get("events", [])
    except Exception:
        logger.debug("Tail fetch failed for %s/%s", group, stream, exc_info=True)
        return []

    return [
        {
            "timestamp": _epoch_millis_to_iso(event["timestamp"]),
            "timestamp_millis": event["timestamp"],
            "message": event["message"],
            "ingestion_time": _epoch_millis_to_iso(event.get("ingestionTime")),
            "event_id": event.get("eventId", ""),
        }
        for event in raw
    ]


async def logs_tail_endpoint(websocket: WebSocket):
    """Tail a log stream over WebSocket.

    The client opens the socket and sends one configuration message:
      {"type": "tail", "group": ..., "stream": ..., "endpoint": ...,
       "filterPattern": ..., "since": <epoch millis of the newest event it has>}

    The server then polls the emulator and pushes {"type": "events", "data": {"events": [...]}}
    batches until the client sends {"type": "stop"} or disconnects.
    """
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        try:
            cfg = json.loads(raw)
        except json.JSONDecodeError:
            cfg = {}
        group = cfg.get("group")
        stream = cfg.get("stream")
        if cfg.get("type") != "tail" or not group or not stream:
            await websocket.send_text(json.dumps({"type": "error", "message": "expected a tail message with group and stream"}))
            await websocket.close()
            return

        filter_pattern = cfg.get("filterPattern") or ""
        since = int(cfg.get("since") or time.time() * 1000)
        try:
            client_kwargs = _client_kwargs_for(cfg.get("endpoint"))
        except InvalidEndpointUrl as exc:
            await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
            await websocket.close()
            return

        stop = asyncio.Event()

        async def reader():
            try:
                while True:
                    msg = await websocket.receive_text()
                    try:
                        if json.loads(msg).get("type") == "stop":
                            break
                    except json.JSONDecodeError:
                        pass
            except WebSocketDisconnect:
                pass
            finally:
                stop.set()

        reader_task = asyncio.create_task(reader())
        loop = asyncio.get_event_loop()
        try:
            while not stop.is_set():
                events = await loop.run_in_executor(
                    None,
                    functools.partial(_fetch_new_events, group, stream, since, filter_pattern, client_kwargs),
                )
                if stop.is_set():
                    break
                if events:
                    since = max(e["timestamp_millis"] for e in events) + 1
                    await websocket.send_text(json.dumps({"type": "events", "data": {"events": events}}))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=TAIL_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
        finally:
            reader_task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("logs tail connection ended with error", exc_info=True)


async def broadcast_endpoints_changed():
    """Broadcast endpoints_changed event to all connected clients."""
    await manager.broadcast_to_all({"type": "endpoints_changed"})


def remove_endpoint_from_stats(endpoint_url: str | None):
    """Remove an endpoint from the stats cache when it's deleted."""
    _last_stats_by_endpoint.pop(endpoint_url, None)
