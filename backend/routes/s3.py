import logging
import mimetypes
import os
from typing import Annotated

from botocore.exceptions import ClientError
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, model_validator

from backend.aws_client import get_client
from backend.cache import cache
from backend.config import AWS_REGION, S3_MAX_UPLOAD_BYTES, is_local_endpoint

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_s3_not_found(err: ClientError) -> bool:
    code = err.response.get("Error", {}).get("Code", "")
    status = err.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return code in ("404", "NoSuchKey", "NotFound") or status == 404


def _invalidate_bucket_stats(bucket_name: str) -> None:
    cache.delete(f"s3:bucket_stats:{bucket_name}")


def _validate_key_component(name: str) -> str:
    base = os.path.basename(name.replace("\\", "/"))
    if not base or base in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid file name")
    return base


def _validate_prefix_path(prefix: str) -> str:
    if ".." in prefix or prefix.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid prefix")
    return prefix


def _compose_object_key(prefix: str, filename: str) -> str:
    prefix = _validate_prefix_path(prefix or "")
    fn = _validate_key_component(filename)
    if prefix and not prefix.endswith("/"):
        prefix = prefix + "/"
    return prefix + fn


def _resolve_upload_content_type(filename: str, browser_type: str | None) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    bt = (browser_type or "").strip() or None
    if not bt or bt == "application/octet-stream":
        return guessed or "application/octet-stream"
    if guessed and guessed != bt:
        return guessed
    return bt or guessed or "application/octet-stream"


@router.get("/upload-config")
def s3_upload_config():
    return {"max_upload_bytes": S3_MAX_UPLOAD_BYTES}


def _get_bucket_stats(bucket_name: str) -> tuple[int, int]:
    """Return (object_count, total_size_bytes) for a bucket. Cached 30s.

    On real AWS this enumerates every object, which can be very slow for large
    buckets.  Only perform the full scan when targeting a local emulator.
    """
    if not is_local_endpoint():
        return (0, 0)

    cache_key = f"s3:bucket_stats:{bucket_name}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    s3 = get_client("s3")
    paginator = s3.get_paginator("list_objects_v2")
    obj_count = 0
    total_size = 0

    try:
        for page in paginator.paginate(Bucket=bucket_name):
            for obj in page.get("Contents", []):
                obj_count += 1
                total_size += obj.get("Size", 0)
    except Exception:
        logger.debug("Failed to get bucket stats for %s", bucket_name, exc_info=True)

    result = (obj_count, total_size)
    cache.set(cache_key, result, ttl=30)
    return result


@router.get("/buckets")
def list_buckets():
    s3 = get_client("s3")
    response = s3.list_buckets()
    buckets = []
    local = is_local_endpoint()

    for b in response.get("Buckets", []):
        name = b["Name"]
        obj_count, total_size = _get_bucket_stats(name)

        versioning = "Disabled"
        encryption = "Disabled"
        tags: dict[str, str] = {}

        if local:
            try:
                ver = s3.get_bucket_versioning(Bucket=name)
                versioning = ver.get("Status", "Disabled")
            except Exception:
                logger.debug("Failed to get versioning for %s", name, exc_info=True)

            try:
                s3.get_bucket_encryption(Bucket=name)
                encryption = "Enabled"
            except Exception:
                logger.debug("Failed to get encryption for %s", name, exc_info=True)

            try:
                tag_resp = s3.get_bucket_tagging(Bucket=name)
                tags = {t["Key"]: t["Value"] for t in tag_resp.get("TagSet", [])}
            except Exception:
                logger.debug("Failed to get tags for %s", name, exc_info=True)

        buckets.append(
            {
                "name": name,
                "created": b["CreationDate"].isoformat(),
                "region": AWS_REGION,
                "object_count": obj_count,
                "total_size": total_size,
                "versioning": versioning,
                "encryption": encryption,
                "tags": tags,
            }
        )

    return {"buckets": buckets}


@router.get("/buckets/{name}/objects")
def list_objects(
    name: str,
    prefix: str = Query(default="", description="Key prefix filter"),
    delimiter: str = Query(default="/", description="Hierarchy delimiter"),
):
    s3 = get_client("s3")
    paginator = s3.get_paginator("list_objects_v2")

    folders: list[str] = []
    files: list[dict] = []

    paginate_params: dict = {"Bucket": name, "Prefix": prefix}
    if delimiter:
        paginate_params["Delimiter"] = delimiter

    for page in paginator.paginate(**paginate_params):
        for cp in page.get("CommonPrefixes", []):
            folders.append(cp["Prefix"])
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key == prefix:
                continue
            file_name = key[len(prefix) :] if prefix else key
            files.append(
                {
                    "key": key,
                    "name": file_name,
                    "size": obj["Size"],
                    "content_type": "application/octet-stream",
                    "etag": obj["ETag"].strip('"'),
                    "last_modified": obj["LastModified"].isoformat(),
                }
            )

    return {
        "bucket": name,
        "prefix": prefix,
        "delimiter": delimiter,
        "folders": folders,
        "files": files,
    }


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


def _validate_object_key(key: str) -> None:
    if ".." in key or key.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid key")


@router.post("/buckets/{name}/objects/delete-batch")
def delete_objects_batch(name: str, body: DeleteBatchBody):
    """Delete multiple objects by key list or all keys under a prefix."""
    s3 = get_client("s3")

    keys_to_delete: list[str]
    if body.prefix:
        p = body.prefix
        if not p.endswith("/"):
            p = p + "/"
        _validate_prefix_path(p.rstrip("/") or "")
        keys_to_delete = []
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=name, Prefix=p):
            for obj in page.get("Contents", []):
                keys_to_delete.append(obj["Key"])
        if not keys_to_delete:
            _invalidate_bucket_stats(name)
            return {"bucket": name, "deleted": 0, "keys": []}
    else:
        keys_to_delete = list(body.keys or [])
        for k in keys_to_delete:
            _validate_object_key(k)

    deleted = 0
    for i in range(0, len(keys_to_delete), 1000):
        chunk = keys_to_delete[i : i + 1000]
        resp = s3.delete_objects(
            Bucket=name,
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )
        deleted += len(chunk) - len(resp.get("Errors", []))
        if resp.get("Errors"):
            for err in resp["Errors"]:
                logger.warning("S3 delete error: %s", err)

    _invalidate_bucket_stats(name)
    return {"bucket": name, "deleted": deleted, "keys": keys_to_delete}


@router.post("/buckets/{name}/folders")
def create_folder(name: str, body: CreateFolderBody):
    """Create a folder marker (zero-byte object with trailing /)."""
    prefix = body.prefix
    _validate_prefix_path(prefix.rstrip("/"))
    s3 = get_client("s3")
    s3.put_object(Bucket=name, Key=prefix, Body=b"", ContentType="application/x-directory")
    _invalidate_bucket_stats(name)
    return {"bucket": name, "prefix": prefix}


@router.post("/buckets/{name}/objects")
def upload_object(
    name: str,
    prefix: Annotated[str, Query(description="Key prefix for uploaded object")] = "",
    file: UploadFile = File(..., description="File to upload"),
):
    filename = file.filename or "object"
    object_key = _compose_object_key(prefix, filename)

    body = file.file.read(S3_MAX_UPLOAD_BYTES + 1)
    if len(body) > S3_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {S3_MAX_UPLOAD_BYTES} bytes",
        )

    content_type = _resolve_upload_content_type(filename, file.content_type)

    s3 = get_client("s3")
    s3.put_object(
        Bucket=name,
        Key=object_key,
        Body=body,
        ContentType=content_type,
    )
    _invalidate_bucket_stats(name)
    return {
        "bucket": name,
        "key": object_key,
        "size": len(body),
        "content_type": content_type,
    }


@router.delete("/buckets/{name}/objects/{key:path}")
def delete_object(name: str, key: str):
    _validate_object_key(key)
    s3 = get_client("s3")
    s3.delete_object(Bucket=name, Key=key)
    _invalidate_bucket_stats(name)
    return {"bucket": name, "deleted": True, "key": key}


@router.get("/buckets/{name}/objects/{key:path}")
def get_object_detail(
    name: str,
    key: str,
    download: int = Query(default=0, description="Set to 1 to download the object"),
):
    s3 = get_client("s3")

    if download == 1:
        try:
            resp = s3.get_object(Bucket=name, Key=key)
        except ClientError as e:
            if _is_s3_not_found(e):
                raise HTTPException(status_code=404, detail="Object not found") from e
            raise
        filename = key.rsplit("/", 1)[-1] or key
        return StreamingResponse(
            resp["Body"],
            media_type=resp.get("ContentType", "application/octet-stream"),
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    try:
        resp = s3.head_object(Bucket=name, Key=key)
    except ClientError as e:
        if _is_s3_not_found(e):
            raise HTTPException(status_code=404, detail="Object not found") from e
        raise

    tags: dict[str, str] = {}
    try:
        tag_resp = s3.get_object_tagging(Bucket=name, Key=key)
        tags = {t["Key"]: t["Value"] for t in tag_resp.get("TagSet", [])}
    except Exception:
        logger.debug("Failed to get object tags for %s/%s", name, key, exc_info=True)

    return {
        "bucket": name,
        "key": key,
        "size": resp["ContentLength"],
        "content_type": resp.get("ContentType", "application/octet-stream"),
        "content_encoding": resp.get("ContentEncoding"),
        "etag": resp["ETag"].strip('"'),
        "last_modified": resp["LastModified"].isoformat(),
        "version_id": resp.get("VersionId"),
        "metadata": resp.get("Metadata", {}),
        "preserved_headers": {},
        "tags": tags,
    }
