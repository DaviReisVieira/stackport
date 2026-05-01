import logging
import mimetypes
import os
from typing import Annotated

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from backend.aws_client import get_client
from backend.cache import cache
from backend.config import AWS_REGION, S3_MAX_UPLOAD_BYTES, is_local_endpoint
from backend.routes.common import get_endpoint_url
from backend.schemas.s3 import (
    CreateFolderBody,
    DeleteBatchBody,
    PutVersioningBody,
    PutLifecycleBody,
    PutNotificationsBody,
    PutBucketTagsBody,
    PutCORSBody,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_s3_not_found(err: ClientError) -> bool:
    code = err.response.get("Error", {}).get("Code", "")
    status = err.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return code in ("404", "NoSuchKey", "NotFound") or status == 404


def _invalidate_bucket_stats(bucket_name: str, endpoint_url: str | None) -> None:
    cache.delete(f"{endpoint_url}:s3:bucket_stats:{bucket_name}")


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


def _get_bucket_stats(bucket_name: str, endpoint_url: str | None) -> tuple[int, int]:
    """Return (object_count, total_size_bytes) for a bucket. Cached 30s.

    On real AWS this enumerates every object, which can be very slow for large
    buckets.  Only perform the full scan when targeting a local emulator.
    """
    if not is_local_endpoint(endpoint_url):
        return (0, 0)

    cache_key = f"{endpoint_url}:s3:bucket_stats:{bucket_name}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    s3 = get_client("s3", endpoint_url)
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
def list_buckets(endpoint_url: str | None = Depends(get_endpoint_url)):
    s3 = get_client("s3", endpoint_url)
    response = s3.list_buckets()
    buckets = []
    local = is_local_endpoint(endpoint_url)

    for b in response.get("Buckets", []):
        name = b["Name"]
        obj_count, total_size = _get_bucket_stats(name, endpoint_url)

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
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    s3 = get_client("s3", endpoint_url)
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



def _validate_object_key(key: str) -> None:
    if ".." in key or key.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid key")


@router.post("/buckets/{name}/objects/delete-batch")
def delete_objects_batch(name: str, body: DeleteBatchBody, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Delete multiple objects by key list or all keys under a prefix."""
    s3 = get_client("s3", endpoint_url)

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
            _invalidate_bucket_stats(name, endpoint_url)
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

    _invalidate_bucket_stats(name, endpoint_url)
    return {"bucket": name, "deleted": deleted, "keys": keys_to_delete}


@router.post("/buckets/{name}/folders")
def create_folder(name: str, body: CreateFolderBody, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Create a folder marker (zero-byte object with trailing /)."""
    prefix = body.prefix
    _validate_prefix_path(prefix.rstrip("/"))
    s3 = get_client("s3", endpoint_url)
    s3.put_object(Bucket=name, Key=prefix, Body=b"", ContentType="application/x-directory")
    _invalidate_bucket_stats(name, endpoint_url)
    return {"bucket": name, "prefix": prefix}


@router.post("/buckets/{name}/objects")
def upload_object(
    name: str,
    prefix: Annotated[str, Query(description="Key prefix for uploaded object")] = "",
    file: UploadFile = File(..., description="File to upload"),
    endpoint_url: str | None = Depends(get_endpoint_url),
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

    s3 = get_client("s3", endpoint_url)
    s3.put_object(
        Bucket=name,
        Key=object_key,
        Body=body,
        ContentType=content_type,
    )
    _invalidate_bucket_stats(name, endpoint_url)
    return {
        "bucket": name,
        "key": object_key,
        "size": len(body),
        "content_type": content_type,
    }


@router.delete("/buckets/{name}/objects/{key:path}")
def delete_object(name: str, key: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    _validate_object_key(key)
    s3 = get_client("s3", endpoint_url)
    s3.delete_object(Bucket=name, Key=key)
    _invalidate_bucket_stats(name, endpoint_url)
    return {"bucket": name, "deleted": True, "key": key}


@router.get("/buckets/{name}/objects/{key:path}")
def get_object_detail(
    name: str,
    key: str,
    download: int = Query(default=0, description="Set to 1 to download the object"),
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    s3 = get_client("s3", endpoint_url)

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


@router.get("/buckets/{name}/versioning")
def get_bucket_versioning(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Get bucket versioning status."""
    s3 = get_client("s3", endpoint_url)
    try:
        resp = s3.get_bucket_versioning(Bucket=name)
        status = resp.get("Status", "Disabled")
        mfa_delete = resp.get("MFADelete", "Disabled")
        return {"bucket": name, "status": status, "mfa_delete": mfa_delete}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Versioning not supported by this endpoint") from e
        raise


@router.put("/buckets/{name}/versioning")
def put_bucket_versioning(
    name: str,
    body: PutVersioningBody,
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    """Enable or suspend bucket versioning."""
    s3 = get_client("s3", endpoint_url)
    try:
        s3.put_bucket_versioning(
            Bucket=name,
            VersioningConfiguration={"Status": body.status},
        )
        return {"bucket": name, "status": body.status}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Versioning not supported by this endpoint") from e
        raise


@router.get("/buckets/{name}/lifecycle")
def get_bucket_lifecycle(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Get bucket lifecycle configuration."""
    s3 = get_client("s3", endpoint_url)
    try:
        resp = s3.get_bucket_lifecycle_configuration(Bucket=name)
        rules = []
        for rule in resp.get("Rules", []):
            rules.append({
                "id": rule["ID"],
                "prefix": rule.get("Filter", {}).get("Prefix", ""),
                "expiration_days": rule.get("Expiration", {}).get("Days", 0),
                "enabled": rule["Status"] == "Enabled",
            })
        return {"bucket": name, "rules": rules}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchLifecycleConfiguration", "404"):
            return {"bucket": name, "rules": []}
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Lifecycle not supported by this endpoint") from e
        raise


@router.put("/buckets/{name}/lifecycle")
def put_bucket_lifecycle(
    name: str,
    body: PutLifecycleBody,
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    """Set bucket lifecycle configuration."""
    s3 = get_client("s3", endpoint_url)
    rules = []
    for rule in body.rules:
        lifecycle_rule = {
            "ID": rule.id,
            "Status": "Enabled" if rule.enabled else "Disabled",
            "Filter": {"Prefix": rule.prefix},
            "Expiration": {"Days": rule.expiration_days},
        }
        rules.append(lifecycle_rule)

    try:
        s3.put_bucket_lifecycle_configuration(
            Bucket=name,
            LifecycleConfiguration={"Rules": rules},
        )
        return {"bucket": name, "rules_count": len(rules)}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Lifecycle not supported by this endpoint") from e
        raise


@router.delete("/buckets/{name}/lifecycle")
def delete_bucket_lifecycle(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Delete bucket lifecycle configuration."""
    s3 = get_client("s3", endpoint_url)
    try:
        s3.delete_bucket_lifecycle(Bucket=name)
        return {"bucket": name, "deleted": True}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchLifecycleConfiguration", "404"):
            return {"bucket": name, "deleted": False, "reason": "No lifecycle configuration"}
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Lifecycle not supported by this endpoint") from e
        raise


@router.get("/buckets/{name}/notifications")
def get_bucket_notifications(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Get bucket notification configuration."""
    s3 = get_client("s3", endpoint_url)
    try:
        resp = s3.get_bucket_notification_configuration(Bucket=name)
        configurations = []

        for config in resp.get("LambdaFunctionConfigurations", []):
            configurations.append({
                "id": config["Id"],
                "destination_type": "Lambda",
                "destination_arn": config["LambdaFunctionArn"],
                "events": config["Events"],
                "filter_prefix": config.get("Filter", {}).get("Key", {}).get("FilterRules", [{}])[0].get("Value", "") if config.get("Filter") else "",
                "filter_suffix": "",
            })

        for config in resp.get("QueueConfigurations", []):
            configurations.append({
                "id": config["Id"],
                "destination_type": "SQS",
                "destination_arn": config["QueueArn"],
                "events": config["Events"],
                "filter_prefix": config.get("Filter", {}).get("Key", {}).get("FilterRules", [{}])[0].get("Value", "") if config.get("Filter") else "",
                "filter_suffix": "",
            })

        for config in resp.get("TopicConfigurations", []):
            configurations.append({
                "id": config["Id"],
                "destination_type": "SNS",
                "destination_arn": config["TopicArn"],
                "events": config["Events"],
                "filter_prefix": config.get("Filter", {}).get("Key", {}).get("FilterRules", [{}])[0].get("Value", "") if config.get("Filter") else "",
                "filter_suffix": "",
            })

        return {"bucket": name, "configurations": configurations}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Notifications not supported by this endpoint") from e
        raise


@router.put("/buckets/{name}/notifications")
def put_bucket_notifications(
    name: str,
    body: PutNotificationsBody,
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    """Set bucket notification configuration."""
    s3 = get_client("s3", endpoint_url)

    lambda_configs = []
    queue_configs = []
    topic_configs = []

    for config in body.configurations:
        filter_rules = []
        if config.filter_prefix:
            filter_rules.append({"Name": "prefix", "Value": config.filter_prefix})
        if config.filter_suffix:
            filter_rules.append({"Name": "suffix", "Value": config.filter_suffix})

        notification_config = {
            "Id": config.id,
            "Events": config.events,
        }
        if filter_rules:
            notification_config["Filter"] = {"Key": {"FilterRules": filter_rules}}

        if config.destination_type == "Lambda":
            notification_config["LambdaFunctionArn"] = config.destination_arn
            lambda_configs.append(notification_config)
        elif config.destination_type == "SQS":
            notification_config["QueueArn"] = config.destination_arn
            queue_configs.append(notification_config)
        elif config.destination_type == "SNS":
            notification_config["TopicArn"] = config.destination_arn
            topic_configs.append(notification_config)

    notification_configuration = {}
    if lambda_configs:
        notification_configuration["LambdaFunctionConfigurations"] = lambda_configs
    if queue_configs:
        notification_configuration["QueueConfigurations"] = queue_configs
    if topic_configs:
        notification_configuration["TopicConfigurations"] = topic_configs

    try:
        s3.put_bucket_notification_configuration(
            Bucket=name,
            NotificationConfiguration=notification_configuration,
        )
        return {"bucket": name, "configurations_count": len(body.configurations)}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Notifications not supported by this endpoint") from e
        raise


@router.get("/buckets/{name}/tags")
def get_bucket_tags(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Get bucket tags."""
    s3 = get_client("s3", endpoint_url)
    try:
        resp = s3.get_bucket_tagging(Bucket=name)
        tags = {t["Key"]: t["Value"] for t in resp.get("TagSet", [])}
        return {"bucket": name, "tags": tags}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchTagSet", "404"):
            return {"bucket": name, "tags": {}}
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Tags not supported by this endpoint") from e
        raise


@router.put("/buckets/{name}/tags")
def put_bucket_tags(
    name: str,
    body: PutBucketTagsBody,
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    """Set bucket tags."""
    s3 = get_client("s3", endpoint_url)
    tag_set = [{"Key": k, "Value": v} for k, v in body.tags.items()]

    try:
        if tag_set:
            s3.put_bucket_tagging(Bucket=name, Tagging={"TagSet": tag_set})
        else:
            s3.delete_bucket_tagging(Bucket=name)
        return {"bucket": name, "tags": body.tags}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="Tags not supported by this endpoint") from e
        raise


@router.get("/buckets/{name}/cors")
def get_bucket_cors(name: str, endpoint_url: str | None = Depends(get_endpoint_url)):
    """Get bucket CORS configuration."""
    s3 = get_client("s3", endpoint_url)
    try:
        resp = s3.get_bucket_cors(Bucket=name)
        rules = []
        for rule in resp.get("CORSRules", []):
            rules.append({
                "id": rule.get("ID"),
                "allowed_origins": rule["AllowedOrigins"],
                "allowed_methods": rule["AllowedMethods"],
                "allowed_headers": rule.get("AllowedHeaders", []),
                "expose_headers": rule.get("ExposeHeaders", []),
                "max_age_seconds": rule.get("MaxAgeSeconds"),
            })
        return {"bucket": name, "rules": rules}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchCORSConfiguration", "404"):
            return {"bucket": name, "rules": []}
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="CORS not supported by this endpoint") from e
        raise


@router.put("/buckets/{name}/cors")
def put_bucket_cors(
    name: str,
    body: PutCORSBody,
    endpoint_url: str | None = Depends(get_endpoint_url),
):
    """Set bucket CORS configuration."""
    s3 = get_client("s3", endpoint_url)
    rules = []
    for rule in body.rules:
        cors_rule: dict = {
            "AllowedOrigins": rule.allowed_origins,
            "AllowedMethods": rule.allowed_methods,
        }
        if rule.id:
            cors_rule["ID"] = rule.id
        if rule.allowed_headers:
            cors_rule["AllowedHeaders"] = rule.allowed_headers
        if rule.expose_headers:
            cors_rule["ExposeHeaders"] = rule.expose_headers
        if rule.max_age_seconds is not None:
            cors_rule["MaxAgeSeconds"] = rule.max_age_seconds
        rules.append(cors_rule)

    try:
        if rules:
            s3.put_bucket_cors(Bucket=name, CORSConfiguration={"CORSRules": rules})
        else:
            s3.delete_bucket_cors(Bucket=name)
        return {"bucket": name, "rules_count": len(rules)}
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NotImplemented", "MethodNotAllowed"):
            raise HTTPException(status_code=501, detail="CORS not supported by this endpoint") from e
        raise
