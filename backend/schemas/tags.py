"""Pydantic schemas for tag management API requests."""

from pydantic import BaseModel


class TagUpdateRequest(BaseModel):
    tags: dict[str, str]


class BulkTagRequest(BaseModel):
    action: str  # "add" or "remove"
    tags: dict[str, str]
    resources: list[dict[str, str]]


class BulkDeleteRequest(BaseModel):
    resources: list[dict[str, str]]
