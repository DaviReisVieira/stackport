"""Pydantic schemas for Try it requests: one HTTP request to an API Gateway stage or a function URL.

Only the parts a person fills in come from the request. Where it goes is
worked out by the backend from the resource, so nothing here can name a host:
the path has to be a path, and header names and values can't carry line breaks.
"""

import re
from typing import Literal
from urllib.parse import unquote

from pydantic import BaseModel, Field, field_validator

# A Lambda function's synchronous payload tops out at 6 MB; a console request is far smaller.
REQUEST_BODY_LIMIT = 1024 * 1024

# Segments of URL path characters (RFC 3986 pchar), each after a "/". "@" is
# left out: it reads like credentials in front of a host (send it as %40).
_PATH = re.compile(r"(?:/(?:[A-Za-z0-9\-._~!$&'()*+,;=:]|%[0-9A-Fa-f]{2})*)*")
# RFC 9110 token characters.
_HEADER_NAME = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
_CONTROL = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")


class NameValue(BaseModel):
    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=256)
    value: str = Field(max_length=8192)


class Header(NameValue):
    @field_validator("name")
    @classmethod
    def _token(cls, name: str) -> str:
        if not _HEADER_NAME.fullmatch(name):
            raise ValueError(f"{name!r} isn't a valid header name.")
        return name

    @field_validator("value")
    @classmethod
    def _one_line(cls, value: str) -> str:
        if _CONTROL.search(value):
            raise ValueError("A header value can't contain line breaks or other control characters.")
        try:
            value.encode("latin-1")
        except UnicodeEncodeError:
            raise ValueError("A header value can only hold Latin-1 characters.") from None
        return value


class TryItRequest(BaseModel):
    model_config = {"populate_by_name": True, "extra": "forbid"}

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] = "GET"
    # Appended to the stage or function URL, as written in a URL (percent-encoded).
    path: str = Field("/", max_length=2048)
    query: list[NameValue] = Field(default_factory=list, max_length=100)
    headers: list[Header] = Field(default_factory=list, max_length=100)
    body: str | None = None
    # Sending to AWS runs real code on a real account, so the UI asks first.
    confirmed: bool = False

    @field_validator("path")
    @classmethod
    def _relative_path(cls, path: str) -> str:
        if path == "":
            return "/"
        if "?" in path or "#" in path:
            raise ValueError("Put query parameters in the query fields, not in the path.")
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("The path has to start with a single /: it is added to the stage or function URL.")
        if not _PATH.fullmatch(path):
            raise ValueError(
                "The path can only hold URL path characters. Percent-encode anything else, "
                "such as spaces (%20) or @ (%40)."
            )
        if any(unquote(segment) in (".", "..") for segment in path.split("/")):
            raise ValueError("The path can't contain . or .. segments.")
        return path

    @field_validator("body")
    @classmethod
    def _bounded_body(cls, body: str | None) -> str | None:
        if body is not None and len(body.encode("utf-8")) > REQUEST_BODY_LIMIT:
            raise ValueError(f"The body can be at most {REQUEST_BODY_LIMIT // (1024 * 1024)} MB.")
        return body
