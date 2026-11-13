"""Keeping other websites away from StackPort's API.

Two middlewares, both outermost:

- ``HostGuard`` answers only to the host names StackPort is meant to be opened
  with (localhost, IP addresses, STACKPORT_ALLOWED_HOSTS). A page that points
  its own domain at 127.0.0.1 (DNS rebinding) would otherwise be StackPort's
  "own" origin as far as the browser is concerned.
- ``CrossSiteGuard`` refuses requests other sites' pages make (below).

StackPort's API can create and delete resources on any endpoint it has saved,
real AWS accounts included, and it has no login: it relies on only being used
by its own pages. Browsers protect that for requests whose answer a page wants
to read (CORS, which StackPort doesn't enable unless STACKPORT_CORS_ORIGINS is
set), but not for "simple" requests (a form POST, an image GET, a no-cors
fetch) or WebSocket handshakes. ``CrossSiteGuard`` refuses those when they come
from another site.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from backend import config

# Fetch Metadata values a browser sends for StackPort's own pages ("same-origin")
# and for URLs typed or opened directly ("none"). "same-site" is refused:
# localhost:3000 and localhost:8080 are the same site.
_TRUSTED_FETCH_SITES = frozenset({"same-origin", "none"})
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_GUARDED_PREFIXES = ("/api", "/ws")


def origin_allowed(origin: str | None, host: str | None) -> bool:
    """True for StackPort's own pages, clients that aren't browsers, and configured origins."""
    if origin is None:
        # Browsers always send Origin on WebSocket handshakes and cross-site
        # writes; CLIs and scripts don't.
        return True
    if origin.rstrip("/") in config.STACKPORT_CORS_ORIGINS:
        return True
    try:
        netloc = urlsplit(origin).netloc
    except ValueError:
        return False
    return bool(netloc) and bool(host) and netloc.lower() == host.lower()


def request_allowed(scope_type: str, method: str, headers: Headers) -> bool:
    """Whether a request to the API may go ahead (see the module docstring)."""
    origin = headers.get("origin")
    if origin is not None and origin.rstrip("/") in config.STACKPORT_CORS_ORIGINS:
        return True
    fetch_site = headers.get("sec-fetch-site")
    if fetch_site is not None:
        return fetch_site in _TRUSTED_FETCH_SITES
    # A browser without Fetch Metadata: reads can't hurt (the page can't see
    # the answer), but writes and WebSockets need an Origin of StackPort's own.
    if scope_type == "websocket" or method not in _SAFE_METHODS:
        return origin_allowed(origin, headers.get("host"))
    return True


class CrossSiteGuard:
    """ASGI middleware refusing cross-site requests to /api and /ws."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket") or not scope["path"].startswith(_GUARDED_PREFIXES):
            await self.app(scope, receive, send)
            return
        if request_allowed(scope["type"], scope.get("method", "GET"), Headers(scope=scope)):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        response = JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "StackPort doesn't accept API requests from other websites. "
                    "To allow one, add its origin to STACKPORT_CORS_ORIGINS."
                )
            },
        )
        await response(scope, receive, send)


def host_allowed(host_header: str | None) -> bool:
    """Whether StackPort answers to this Host header.

    localhost (and *.localhost, which browsers keep on loopback) and IP
    addresses can't be taken over by DNS rebinding, which always arrives with a
    DNS name. Anything else has to be listed in STACKPORT_ALLOWED_HOSTS.
    """
    if not host_header:
        return False
    host = host_header.strip().lower()
    if host.startswith("["):  # [::1]:8080
        host = host[1:].split("]", 1)[0]
    elif host.count(":") == 1:
        host = host.rsplit(":", 1)[0]
    host = host.rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    allowed = config.STACKPORT_ALLOWED_HOSTS
    return "*" in allowed or host in allowed


def from_browser(headers: Headers) -> bool:
    """Whether a request comes from a web browser.

    DNS rebinding needs a browser, and every browser sends a User-Agent starting
    with "Mozilla/"; current ones also send Fetch Metadata, and Origin on
    writes. Health probes (Docker, Kubernetes, Floci's console sidecar), curl
    and scripts send none of these, so they keep working whatever Host they use.
    """
    if headers.get("sec-fetch-site") or headers.get("sec-fetch-mode") or headers.get("origin"):
        return True
    return headers.get("user-agent", "").startswith("Mozilla/")


class HostGuard:
    """ASGI middleware refusing browser requests whose Host StackPort doesn't answer to."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if not from_browser(headers) or host_allowed(headers.get("host")):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        host = headers.get("host") or ""
        response = PlainTextResponse(
            f"StackPort doesn't answer to the host name '{host}'. If you opened it through this "
            "name on purpose (a reverse proxy, a forwarded port, a machine name), add the name to "
            "STACKPORT_ALLOWED_HOSTS and restart StackPort. localhost and IP addresses always work.\n",
            status_code=400,
        )
        await response(scope, receive, send)
