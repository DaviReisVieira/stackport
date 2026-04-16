"""WebSocket support for real-time resource updates."""

import asyncio
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

from backend.config import DEFAULT_ENDPOINT, STACKPORT_SERVICES
from backend.routes.stats import _probe_service, _start_time

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections and broadcasts."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.debug("WebSocket client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.debug("WebSocket client disconnected (%d remaining)", len(self.active_connections))

    async def broadcast(self, message: dict):
        """Send a message to all connected clients."""
        data = json.dumps(message)
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception:
                logger.debug("Failed to send to client, removing", exc_info=True)
                if connection in self.active_connections:
                    self.active_connections.remove(connection)


manager = ConnectionManager()
_last_services: dict | None = None
_last_stats: dict | None = None


async def probe_loop():
    """Background task: probe services and broadcast diffs to connected clients."""
    global _last_services, _last_stats

    while True:
        await asyncio.sleep(2)

        # Skip probing if no clients are connected
        if not manager.active_connections:
            continue

        try:
            loop = asyncio.get_event_loop()
            enabled = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]

            # Run all probes concurrently in thread pool (sync boto3 calls)
            tasks = [loop.run_in_executor(None, _probe_service, svc, DEFAULT_ENDPOINT) for svc in enabled]
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
            _last_services = sorted_services
            _last_stats = {
                "services": sorted_services,
                "total_resources": total,
                "uptime_seconds": round(time.time() - _start_time, 1),
            }
            await manager.broadcast({"type": "stats", "data": _last_stats})
        except Exception:
            logger.warning("Error in probe loop", exc_info=True)


async def websocket_endpoint(websocket: WebSocket):
    """Handle a single WebSocket connection."""
    await manager.connect(websocket)
    try:
        # Send current stats immediately on connect
        if _last_stats:
            await websocket.send_text(json.dumps({"type": "stats", "data": _last_stats}))

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")
                if msg_type == "subscribe":
                    logger.debug("Client subscribed to: %s", msg.get("services"))
                elif msg_type == "unsubscribe":
                    logger.debug("Client unsubscribed from: %s", msg.get("services"))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
