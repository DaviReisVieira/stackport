"""Pydantic schemas for API Explorer requests."""

from typing import Any

from pydantic import BaseModel, Field

# Pages one run follows at most; the explorer is for looking, not for exports.
MAX_PAGES = 50


class RunOperationRequest(BaseModel):
    model_config = {"populate_by_name": True, "extra": "forbid"}

    # The operation's input, as boto3 takes it. A blob can be given as
    # {"$base64": "..."} for bytes that aren't text.
    params: dict[str, Any] = Field(default_factory=dict)
    # Follow the operation's pagination, up to max_pages responses.
    paginate: bool = False
    max_pages: int = Field(10, alias="maxPages", ge=1, le=MAX_PAGES)
