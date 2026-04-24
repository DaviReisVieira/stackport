"""Pydantic schemas for S3 API requests."""

from pydantic import BaseModel, model_validator


class DeleteBatchBody(BaseModel):
    """Delete by explicit keys or by prefix (recursive). Provide exactly one."""

    keys: list[str] | None = None
    prefix: str | None = None

    @model_validator(mode="after")
    def exactly_one_mode(self):
        has_keys = bool(self.keys)
        has_prefix = bool(self.prefix and self.prefix.strip())
        if has_keys == has_prefix:
            raise ValueError('Provide exactly one of non-empty "keys" or "prefix"')
        return self


class CreateFolderBody(BaseModel):
    prefix: str

    @model_validator(mode="after")
    def trailing_slash(self):
        if not self.prefix.endswith("/"):
            raise ValueError('Folder prefix must end with "/"')
        if ".." in self.prefix or self.prefix.startswith("/"):
            raise ValueError("Invalid prefix")
        return self
