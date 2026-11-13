"""Passing a download from an endpoint on to the browser: S3 objects, Lambda code packages."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Protocol
from urllib.parse import quote

from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

_PLAIN_FILENAME = re.compile(r"[A-Za-z0-9._-]+")

# How much of the upstream body to read for each chunk sent on. Reading a sync
# body costs a hop through the thread pool per chunk, so tiny chunks make a
# download crawl; at this size, relaying keeps pace with reading directly.
RELAY_CHUNK_BYTES = 64 * 1024


class Closeable(Protocol):
    def close(self) -> None: ...


def attachment(filename: str) -> str:
    """A Content-Disposition value that saves the download as ``filename`` (RFC 6266).

    A name outside a conservative ASCII set gets an underscored fallback plus the
    exact name, percent-encoded as UTF-8, in ``filename*`` (RFC 8187), so quotes,
    backslashes, semicolons, line breaks and characters outside Latin-1 can't
    break the header. The fallback replaces quotes and backslashes rather than
    escaping them, since some browsers don't unescape them (RFC 6266, appendix D).
    """
    if _PLAIN_FILENAME.fullmatch(filename):
        return f'attachment; filename="{filename}"'
    fallback = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


class RelayResponse(StreamingResponse):
    """Streams a body read from an open upstream response, and closes the upstream however the response ends.

    When the client goes away, Starlette stops iterating the body without
    closing it, so the body iterator can't be the one that closes the upstream.
    An error while reading the upstream propagates, so the server drops the
    connection instead of finishing a cut-off download that would look complete.
    """

    def __init__(
        self,
        content: Iterable[bytes],
        *,
        upstream: Closeable,
        media_type: str,
        headers: Mapping[str, str],
    ):
        super().__init__(content, media_type=media_type, headers=headers)
        self._upstream = upstream

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._upstream.close()
