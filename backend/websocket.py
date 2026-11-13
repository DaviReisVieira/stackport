"""WebSocket support for real-time resource updates."""

import asyncio
import functools
import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass

from fastapi import WebSocket, WebSocketDisconnect

from backend.aws_client import get_client
from backend.connection import EndpointInfo, InvalidEndpointUrl
from backend.routes.common import UnknownEndpoint, endpoint_info_for
from backend.routes.logs import serialize_log_event
from backend.routes.stats import collect_stats

logger = logging.getLogger(__name__)

TAIL_POLL_SECONDS = 1.0


class ConnectionManager:
    """Manages active WebSocket connections and the endpoint each one follows.

    A subscription is the endpoint the client named (a saved endpoint's name, a
    direct URL, or None for the default), not a URL: two saved endpoints can
    share a URL with different auth or TLS settings. The probe loop resolves it
    again every cycle, so an edited endpoint is followed under its new settings.
    """

    def __init__(self):
        self.active_connections: dict[WebSocket, str | None] = {}
        # Followed a name that is no longer saved: no stats until they subscribe again.
        self.suspended: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = None
        logger.debug("WebSocket client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        self.active_connections.pop(websocket, None)
        self.suspended.discard(websocket)
        logger.debug("WebSocket client disconnected (%d remaining)", len(self.active_connections))

    def set_endpoint(self, websocket: WebSocket, endpoint: str | None):
        if websocket in self.active_connections:
            self.active_connections[websocket] = endpoint
            self.suspended.discard(websocket)

    def suspend(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.suspended.add(websocket)

    def subscribers_by_scope(
        self,
    ) -> tuple[dict[str, tuple[EndpointInfo, list[WebSocket]]], list[tuple[WebSocket, str]]]:
        """Group connections by the endpoint settings they resolve to right now.

        Returns the groups, and the connections whose endpoint no longer
        resolves with the reason. Suspended connections are in neither.
        """
        groups: dict[str, tuple[EndpointInfo, list[WebSocket]]] = {}
        unresolved: list[tuple[WebSocket, str]] = []
        for ws, endpoint in list(self.active_connections.items()):
            if ws in self.suspended:
                continue
            try:
                ep = endpoint_info_for(endpoint, strict=True)
            except (InvalidEndpointUrl, UnknownEndpoint) as exc:
                unresolved.append((ws, str(exc)))
                continue
            except Exception:
                logger.warning("Could not resolve endpoint %r for a client", endpoint, exc_info=True)
                continue
            groups.setdefault(ep.cache_scope(), (ep, []))[1].append(ws)
        return groups, unresolved

    def watchers_of(self, scope: str) -> list[WebSocket]:
        """Connections following this scope right now, whatever they followed when a probe began."""
        groups, _ = self.subscribers_by_scope()
        return groups[scope][1] if scope in groups else []

    async def send_to(self, websockets: list[WebSocket], message: dict):
        data = json.dumps(message)
        for ws in websockets:
            try:
                await ws.send_text(data)
            except Exception:
                logger.debug("Failed to send to client, removing", exc_info=True)
                self.disconnect(ws)

    async def broadcast_to_all(self, message: dict):
        """Broadcast a message to all connected clients."""
        await self.send_to(list(self.active_connections), message)


@dataclass(frozen=True)
class _Snapshot:
    url: str | None
    stats: dict


manager = ConnectionManager()
# Latest stats per EndpointInfo.cache_scope(), so saved endpoints that share a URL stay apart.
_last_stats_by_scope: dict[str, _Snapshot] = {}
# Bumped when endpoints at a URL are edited or deleted: a probe that began before
# that is using settings that no longer exist, so its result is thrown away.
_invalidations: defaultdict[str | None, int] = defaultdict(int)


async def _probe_scope(scope: str, ep: EndpointInfo):
    invalidations = _invalidations[ep.url]
    try:
        stats = await asyncio.get_running_loop().run_in_executor(None, collect_stats, ep)
        if _invalidations[ep.url] != invalidations:
            return
        _last_stats_by_scope[scope] = _Snapshot(ep.url, stats)
        await manager.send_to(manager.watchers_of(scope), {"type": "stats", "data": stats})
    except Exception:
        logger.warning("Error in probe loop for endpoint %s", ep.url, exc_info=True)


async def probe_once():
    """Probe each endpoint someone is watching once, all at the same time, and send the stats to its watchers."""
    groups, unresolved = manager.subscribers_by_scope()
    for ws, reason in unresolved:
        manager.suspend(ws)
        await manager.send_to([ws], {"type": "error", "message": reason})

    await asyncio.gather(*(_probe_scope(scope, ep) for scope, (ep, _) in groups.items()))

    # Nobody is watching these any more (disconnected, switched, or the endpoint was edited)
    for scope in set(_last_stats_by_scope) - set(groups):
        del _last_stats_by_scope[scope]


async def probe_loop():
    """Background task: probe the watched endpoints every couple of seconds."""
    while True:
        await asyncio.sleep(2)
        try:
            await probe_once()
        except Exception:
            logger.warning("Probe cycle failed", exc_info=True)


async def websocket_endpoint(websocket: WebSocket):
    """Handle a single WebSocket connection."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if not isinstance(msg, dict):
                    continue
                msg_type = msg.get("type")
                if msg_type == "subscribe":
                    endpoint = msg.get("endpoint")
                    if endpoint is not None and not isinstance(endpoint, str):
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": "The endpoint must be a saved endpoint's name or a URL."})
                        )
                        continue
                    try:
                        ep = endpoint_info_for(endpoint, strict=True)
                    except UnknownEndpoint as exc:
                        manager.suspend(websocket)
                        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
                        continue
                    manager.set_endpoint(websocket, endpoint)
                    snapshot = _last_stats_by_scope.get(ep.cache_scope())
                    if snapshot:
                        await websocket.send_text(json.dumps({"type": "stats", "data": snapshot.stats}))
                    logger.debug("Client subscribed to endpoint: %s", ep.url)
                elif msg_type == "unsubscribe":
                    logger.debug("Client unsubscribed from: %s", msg.get("services"))
            except json.JSONDecodeError:
                pass
            except InvalidEndpointUrl as exc:
                await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
    except WebSocketDisconnect:
        pass
    finally:
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

    return [serialize_log_event(event) for event in raw]


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
    """Drop the stats kept for every endpoint at this URL, when one is edited or deleted.

    A saved endpoint that shares the URL is probed again on the next cycle.
    """
    _invalidations[endpoint_url] += 1
    for scope in [scope for scope, snapshot in _last_stats_by_scope.items() if snapshot.url == endpoint_url]:
        del _last_stats_by_scope[scope]
