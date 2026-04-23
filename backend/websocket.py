"""WebSocket support for real-time resource updates."""

import asyncio
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

from backend.config import DEFAULT_ENDPOINT, ENDPOINTS, STACKPORT_SERVICES
from backend.routes.stats import _probe_service, _start_time

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections with per-endpoint subscriptions."""

    def __init__(self):
        self.active_connections: dict[WebSocket, str | None] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = DEFAULT_ENDPOINT
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


manager = ConnectionManager()
_last_stats_by_endpoint: dict[str | None, dict] = {}


async def probe_loop():
    """Background task: probe services for each active endpoint and broadcast."""
    while True:
        await asyncio.sleep(2)

        if not manager.active_connections:
            continue

        active_endpoints = manager.get_active_endpoints()

        for endpoint_url in active_endpoints:
            try:
                loop = asyncio.get_event_loop()
                enabled = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]

                tasks = [loop.run_in_executor(None, _probe_service, svc, endpoint_url) for svc in enabled]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                services = {}
                total = 0
                for result in results:
                    if isinstance(result, Exception):
                        logger.debug("Probe failed: %s", result)
                        continue
                    svc_name, svc_data = result
                    services[svc_name] = svc_data
                    total += sum(svc_data.get("resources", {}).values())

                sorted_services = dict(sorted(services.items()))
                stats = {
                    "services": sorted_services,
                    "total_resources": total,
                    "uptime_seconds": round(time.time() - _start_time, 1),
                }
                _last_stats_by_endpoint[endpoint_url] = stats
                await manager.broadcast_to_endpoint(endpoint_url, {"type": "stats", "data": stats})
            except Exception:
                logger.warning("Error in probe loop for endpoint %s", endpoint_url, exc_info=True)


def _resolve_endpoint(name_or_url: str | None) -> str | None:
    if name_or_url is None:
        return DEFAULT_ENDPOINT
    if name_or_url in ENDPOINTS:
        return ENDPOINTS[name_or_url]
    return name_or_url


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
    except WebSocketDisconnect:
        manager.disconnect(websocket)
