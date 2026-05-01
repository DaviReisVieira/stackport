"""Tests for S3 API routes (write operations and reads)."""

import io
import os
from datetime import datetime, timezone

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from botocore.exceptions import ClientError
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class MemoryS3Store:
    """Minimal in-memory S3 for API round-trip tests."""

    _FIXED_DT = datetime(2025, 6, 15, 12, 0, 0, tzinfo=timezone.utc)

    def __init__(self):
        self._objects: dict[tuple[str, str], dict] = {}

    def put_object(self, Bucket, Key, Body, ContentType=None):
        raw = Body if isinstance(Body, (bytes, bytearray)) else Body.read()
        self._objects[(Bucket, Key)] = {
            "body": bytes(raw),
            "ContentType": ContentType or "application/octet-stream",
        }

    def delete_object(self, Bucket, Key):
        self._objects.pop((Bucket, Key), None)

    def head_object(self, Bucket, Key):
        k = (Bucket, Key)
        if k not in self._objects:
            raise ClientError(
                {
                    "Error": {"Code": "404", "Message": "Not Found"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "HeadObject",
            )
        o = self._objects[k]
        blob = o["body"]
        return {
            "ContentLength": len(blob),
            "ContentType": o["ContentType"],
            "ETag": '"etag"',
            "LastModified": self._FIXED_DT,
        }

    def get_object(self, Bucket, Key):
        k = (Bucket, Key)
        if k not in self._objects:
            raise ClientError(
                {
                    "Error": {"Code": "NoSuchKey", "Message": "Not Found"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "GetObject",
            )
        o = self._objects[k]
        return {"Body": io.BytesIO(o["body"]), "ContentType": o["ContentType"]}

    def get_object_tagging(self, Bucket, Key):
        return {"TagSet": []}

    def get_paginator(self, operation_name):
        assert operation_name == "list_objects_v2"
        parent = self

        class Paginator:
            def paginate(self, **kwargs):
                bucket = kwargs["Bucket"]
                prefix = kwargs.get("Prefix") or ""
                delimiter = kwargs.get("Delimiter") or ""

                contents = []
                common_prefixes_set: set[str] = set()

                for (b, key), meta in parent._objects.items():
                    if b != bucket or not key.startswith(prefix):
                        continue
                    if key == prefix:
                        continue
                    rel = key[len(prefix) :] if prefix else key
                    if delimiter and delimiter in rel:
                        idx = rel.index(delimiter)
                        cp = prefix + rel[: idx] + delimiter
                        common_prefixes_set.add(cp)
                        continue
                    contents.append(
                        {
                            "Key": key,
                            "Size": len(meta["body"]),
                            "LastModified": parent._FIXED_DT,
                            "ETag": '"x"',
                        }
                    )

                yield {
                    "Contents": contents,
                    "CommonPrefixes": [{"Prefix": p} for p in sorted(common_prefixes_set)],
                }

        return Paginator()


class TestUploadObject:
    @patch("backend.routes.s3.get_client")
    def test_upload_puts_object(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        files = {"file": ("hello.txt", io.BytesIO(b"hello world"), "text/plain")}
        resp = client.post(
            "/api/s3/buckets/my-bucket/objects",
            files=files,
            params={"prefix": "p/"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "my-bucket"
        assert data["key"] == "p/hello.txt"
        assert data["size"] == 11
        mock_s3.put_object.assert_called_once()
        call_kw = mock_s3.put_object.call_args.kwargs
        assert call_kw["Bucket"] == "my-bucket"
        assert call_kw["Key"] == "p/hello.txt"
        assert call_kw["Body"] == b"hello world"
        assert call_kw["ContentType"] == "text/plain"

    @patch("backend.routes.s3.get_client")
    def test_upload_uses_guess_when_browser_octet_stream(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        files = {"file": ("note.txt", io.BytesIO(b"x"), "application/octet-stream")}
        resp = client.post("/api/s3/buckets/b/objects", files=files)
        assert resp.status_code == 200
        assert resp.json()["content_type"] == "text/plain"
        assert mock_s3.put_object.call_args.kwargs["ContentType"] == "text/plain"

    @patch("backend.routes.s3.get_client")
    def test_upload_prefers_extension_when_browser_disagrees(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        files = {"file": ("photo.png", io.BytesIO(b"x"), "image/jpeg")}
        resp = client.post("/api/s3/buckets/b/objects", files=files)
        assert resp.status_code == 200
        assert resp.json()["content_type"] == "image/png"
        assert mock_s3.put_object.call_args.kwargs["ContentType"] == "image/png"

    @patch("backend.routes.s3.S3_MAX_UPLOAD_BYTES", 10)
    @patch("backend.routes.s3.get_client")
    def test_upload_rejects_large_file(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        files = {"file": ("big.bin", io.BytesIO(b"x" * 11), "application/octet-stream")}
        resp = client.post("/api/s3/buckets/b/objects", files=files)
        assert resp.status_code == 413

    @patch("backend.routes.s3.get_client")
    def test_upload_strips_path_traversal_from_filename(self, mock_get_client):
        """Malicious upload names must not create keys with `..` segments (basename is safe)."""
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        files = {"file": ("../../etc/passwd", io.BytesIO(b"secret"), "text/plain")}
        resp = client.post(
            "/api/s3/buckets/bucket/objects",
            files=files,
            params={"prefix": "p/"},
        )
        assert resp.status_code == 200
        assert mock_s3.put_object.call_args.kwargs["Key"] == "p/passwd"
        assert ".." not in mock_s3.put_object.call_args.kwargs["Key"]


class TestS3UploadConfig:
    @patch("backend.routes.s3.S3_MAX_UPLOAD_BYTES", 99)
    def test_upload_config_returns_limit(self):
        resp = client.get("/api/s3/upload-config")
        assert resp.status_code == 200
        assert resp.json() == {"max_upload_bytes": 99}


class TestDeleteObject:
    @patch("backend.routes.s3.get_client")
    def test_delete_single(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.delete("/api/s3/buckets/bkt/objects/foo/bar.txt")
        assert resp.status_code == 200
        assert resp.json() == {"bucket": "bkt", "deleted": True, "key": "foo/bar.txt"}
        mock_s3.delete_object.assert_called_once_with(Bucket="bkt", Key="foo/bar.txt")


class TestDeleteBatch:
    @patch("backend.routes.s3.get_client")
    def test_delete_by_keys(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.delete_objects.return_value = {}

        resp = client.post(
            "/api/s3/buckets/bkt/objects/delete-batch",
            json={"keys": ["a.txt", "b.txt"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] == 2
        assert len(data["keys"]) == 2
        mock_s3.delete_objects.assert_called_once()

    @patch("backend.routes.s3.get_client")
    def test_delete_by_prefix_lists_and_deletes(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {"Contents": [{"Key": "p/a.txt"}, {"Key": "p/b.txt"}]},
        ]
        mock_s3.delete_objects.return_value = {}

        resp = client.post(
            "/api/s3/buckets/bkt/objects/delete-batch",
            json={"prefix": "p/"},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2


class TestCreateFolder:
    @patch("backend.routes.s3.get_client")
    def test_create_folder_marker(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.post(
            "/api/s3/buckets/bkt/folders",
            json={"prefix": "new-folder/"},
        )
        assert resp.status_code == 200
        mock_s3.put_object.assert_called_once_with(
            Bucket="bkt",
            Key="new-folder/",
            Body=b"",
            ContentType="application/x-directory",
        )


class TestObjectDetailAfterWrite:
    @patch("backend.routes.s3.get_client")
    def test_upload_then_head_detail_returns_metadata(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        lm = datetime(2025, 1, 2, tzinfo=timezone.utc)
        mock_s3.head_object.return_value = {
            "ContentLength": 11,
            "ContentType": "text/plain",
            "ETag": '"abc"',
            "LastModified": lm,
        }

        files = {"file": ("hello.txt", io.BytesIO(b"hello world"), "text/plain")}
        up = client.post("/api/s3/buckets/my-bucket/objects", files=files, params={"prefix": "p/"})
        assert up.status_code == 200
        key = up.json()["key"]

        resp = client.get(f"/api/s3/buckets/my-bucket/objects/{key}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "my-bucket"
        assert data["key"] == key
        assert data["size"] == 11
        assert data["content_type"] == "text/plain"
        mock_s3.head_object.assert_called_once_with(Bucket="my-bucket", Key=key)

    @patch("backend.routes.s3.get_client")
    def test_head_missing_object_returns_404(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_object.side_effect = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": ""}, "ResponseMetadata": {"HTTPStatusCode": 404}},
            "HeadObject",
        )
        resp = client.get("/api/s3/buckets/b/objects/nope.txt")
        assert resp.status_code == 404

    @patch("backend.routes.s3.get_client")
    def test_delete_then_detail_returns_404(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.delete_object.return_value = {}
        mock_s3.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": ""}, "ResponseMetadata": {"HTTPStatusCode": 404}},
            "HeadObject",
        )
        client.delete("/api/s3/buckets/bkt/objects/x.txt")
        resp = client.get("/api/s3/buckets/bkt/objects/x.txt")
        assert resp.status_code == 404


class TestS3RoundTripMemory:
    @patch("backend.routes.s3.get_client")
    def test_upload_list_download_delete_flow(self, mock_get_client):
        store = MemoryS3Store()
        mock_get_client.return_value = store

        files = {"file": ("doc.txt", io.BytesIO(b"payload"), "text/plain")}
        up = client.post("/api/s3/buckets/rt-bucket/objects", files=files)
        assert up.status_code == 200
        assert up.json()["key"] == "doc.txt"

        lst = client.get("/api/s3/buckets/rt-bucket/objects")
        assert lst.status_code == 200
        names = [f["name"] for f in lst.json()["files"]]
        assert "doc.txt" in names

        detail = client.get("/api/s3/buckets/rt-bucket/objects/doc.txt")
        assert detail.status_code == 200
        assert detail.json()["size"] == 7

        dl = client.get("/api/s3/buckets/rt-bucket/objects/doc.txt?download=1")
        assert dl.status_code == 200
        assert dl.content == b"payload"

        rm = client.delete("/api/s3/buckets/rt-bucket/objects/doc.txt")
        assert rm.status_code == 200

        gone = client.get("/api/s3/buckets/rt-bucket/objects/doc.txt")
        assert gone.status_code == 404


class TestValidation:
    def test_delete_batch_requires_one_mode(self):
        resp = client.post("/api/s3/buckets/b/objects/delete-batch", json={})
        assert resp.status_code == 422

    def test_create_folder_requires_trailing_slash(self):
        resp = client.post(
            "/api/s3/buckets/b/folders",
            json={"prefix": "bad"},
        )
        assert resp.status_code == 422


class TestBucketStatsRealAws:
    """Verify that S3 bucket listing skips expensive calls on real AWS."""

    @patch("backend.routes.s3.is_local_endpoint", return_value=False)
    @patch("backend.routes.s3.get_client")
    def test_list_buckets_skips_stats_on_real_aws(self, mock_get_client, _mock_is_local):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.return_value = {
            "Buckets": [{"Name": "my-bucket", "CreationDate": datetime(2025, 1, 1, tzinfo=timezone.utc)}]
        }

        resp = client.get("/api/s3/buckets")
        assert resp.status_code == 200
        bucket = resp.json()["buckets"][0]
        assert bucket["name"] == "my-bucket"
        assert bucket["object_count"] == 0
        assert bucket["total_size"] == 0
        assert bucket["versioning"] == "Disabled"
        assert bucket["encryption"] == "Disabled"
        assert bucket["tags"] == {}
        mock_s3.get_bucket_versioning.assert_not_called()
        mock_s3.get_bucket_encryption.assert_not_called()
        mock_s3.get_bucket_tagging.assert_not_called()
        mock_s3.get_paginator.assert_not_called()

    @patch("backend.routes.s3.is_local_endpoint", return_value=True)
    @patch("backend.routes.s3.get_client")
    def test_list_buckets_fetches_stats_on_local(self, mock_get_client, _mock_is_local):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_buckets.return_value = {
            "Buckets": [{"Name": "my-bucket", "CreationDate": datetime(2025, 1, 1, tzinfo=timezone.utc)}]
        }
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"Contents": []}]
        mock_s3.get_bucket_versioning.return_value = {"Status": "Enabled"}
        mock_s3.get_bucket_encryption.return_value = {}
        mock_s3.get_bucket_tagging.return_value = {"TagSet": []}

        resp = client.get("/api/s3/buckets")
        assert resp.status_code == 200
        bucket = resp.json()["buckets"][0]
        assert bucket["versioning"] == "Enabled"
        mock_s3.get_bucket_versioning.assert_called_once()
        mock_s3.get_paginator.assert_called_once()


def test_get_bucket_versioning():
    """Test GET /api/s3/buckets/{name}/versioning."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.get_bucket_versioning.return_value = {"Status": "Enabled", "MFADelete": "Disabled"}

        resp = client.get("/api/s3/buckets/test-bucket/versioning")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["status"] == "Enabled"
        assert data["mfa_delete"] == "Disabled"


def test_put_bucket_versioning():
    """Test PUT /api/s3/buckets/{name}/versioning."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.put("/api/s3/buckets/test-bucket/versioning", json={"status": "Enabled"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["status"] == "Enabled"
        mock_s3.put_bucket_versioning.assert_called_once_with(
            Bucket="test-bucket",
            VersioningConfiguration={"Status": "Enabled"},
        )


def test_get_bucket_lifecycle():
    """Test GET /api/s3/buckets/{name}/lifecycle."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.get_bucket_lifecycle_configuration.return_value = {
            "Rules": [
                {
                    "ID": "rule-1",
                    "Status": "Enabled",
                    "Filter": {"Prefix": "logs/"},
                    "Expiration": {"Days": 30},
                }
            ]
        }

        resp = client.get("/api/s3/buckets/test-bucket/lifecycle")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert len(data["rules"]) == 1
        assert data["rules"][0]["id"] == "rule-1"
        assert data["rules"][0]["prefix"] == "logs/"
        assert data["rules"][0]["expiration_days"] == 30
        assert data["rules"][0]["enabled"] is True


def test_put_bucket_lifecycle():
    """Test PUT /api/s3/buckets/{name}/lifecycle."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.put(
            "/api/s3/buckets/test-bucket/lifecycle",
            json={
                "rules": [
                    {"id": "rule-1", "prefix": "logs/", "expirationDays": 30, "enabled": True}
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["rules_count"] == 1


def test_delete_bucket_lifecycle():
    """Test DELETE /api/s3/buckets/{name}/lifecycle."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.delete("/api/s3/buckets/test-bucket/lifecycle")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["deleted"] is True
        mock_s3.delete_bucket_lifecycle.assert_called_once_with(Bucket="test-bucket")


def test_get_bucket_notifications():
    """Test GET /api/s3/buckets/{name}/notifications."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.get_bucket_notification_configuration.return_value = {
            "LambdaFunctionConfigurations": [
                {
                    "Id": "notif-1",
                    "LambdaFunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:my-func",
                    "Events": ["s3:ObjectCreated:*"],
                }
            ]
        }

        resp = client.get("/api/s3/buckets/test-bucket/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert len(data["configurations"]) == 1
        assert data["configurations"][0]["id"] == "notif-1"
        assert data["configurations"][0]["destination_type"] == "Lambda"


def test_put_bucket_notifications():
    """Test PUT /api/s3/buckets/{name}/notifications."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.put(
            "/api/s3/buckets/test-bucket/notifications",
            json={
                "configurations": [
                    {
                        "id": "notif-1",
                        "destinationType": "Lambda",
                        "destinationArn": "arn:aws:lambda:us-east-1:123456789012:function:my-func",
                        "events": ["s3:ObjectCreated:*"],
                        "filterPrefix": "",
                        "filterSuffix": "",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["configurations_count"] == 1


def test_get_bucket_tags():
    """Test GET /api/s3/buckets/{name}/tags."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.get_bucket_tagging.return_value = {
            "TagSet": [{"Key": "env", "Value": "dev"}, {"Key": "team", "Value": "eng"}]
        }

        resp = client.get("/api/s3/buckets/test-bucket/tags")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["tags"] == {"env": "dev", "team": "eng"}


def test_put_bucket_tags():
    """Test PUT /api/s3/buckets/{name}/tags."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.put(
            "/api/s3/buckets/test-bucket/tags",
            json={"tags": {"env": "prod", "team": "eng"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["tags"] == {"env": "prod", "team": "eng"}


def test_get_bucket_cors():
    """Test GET /api/s3/buckets/{name}/cors."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.get_bucket_cors.return_value = {
            "CORSRules": [
                {
                    "ID": "cors-1",
                    "AllowedOrigins": ["*"],
                    "AllowedMethods": ["GET", "POST"],
                    "AllowedHeaders": ["*"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        }

        resp = client.get("/api/s3/buckets/test-bucket/cors")
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert len(data["rules"]) == 1
        assert data["rules"][0]["id"] == "cors-1"
        assert data["rules"][0]["allowed_origins"] == ["*"]


def test_put_bucket_cors():
    """Test PUT /api/s3/buckets/{name}/cors."""
    with patch("backend.routes.s3.get_client") as mock_get_client:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3

        resp = client.put(
            "/api/s3/buckets/test-bucket/cors",
            json={
                "rules": [
                    {
                        "id": "cors-1",
                        "allowedOrigins": ["*"],
                        "allowedMethods": ["GET", "POST"],
                        "allowedHeaders": ["*"],
                        "maxAgeSeconds": 3600,
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bucket"] == "test-bucket"
        assert data["rules_count"] == 1
