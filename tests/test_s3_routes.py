"""Tests for S3 API routes (write operations and reads)."""

import hashlib
import io
import os
from datetime import datetime, timezone
from urllib.parse import quote

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

import pytest
from botocore.exceptions import ClientError
from moto import mock_aws
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app
from backend.routes import s3 as s3_routes
from tests.moto_inprocess import moto_client

client = TestClient(app)

BUCKET = "my-bucket"
MIB = 1024 * 1024


@pytest.fixture
def s3(monkeypatch):
    """One S3 client on moto for the routes and the test, so the test sees what the routes send."""
    with mock_aws():
        s3_client = moto_client("s3")
        s3_client.create_bucket(Bucket=BUCKET)
        monkeypatch.setattr(s3_routes, "get_client", lambda *_args, **_kwargs: s3_client)
        yield s3_client


def sent_operations(s3_client) -> list[str]:
    """The names of the operations ``s3_client`` sends from now on, in order."""
    sent: list[str] = []
    s3_client.meta.events.register("before-call.s3", lambda model, **_: sent.append(model.name))
    return sent


def upload(filename: str, data: bytes, browser_type: str, prefix: str = ""):
    return client.post(
        f"/api/s3/buckets/{BUCKET}/objects",
        files={"file": (filename, io.BytesIO(data), browser_type)},
        params={"prefix": prefix} if prefix else None,
    )


def multipart_etag(data: bytes, part_size: int) -> str:
    """The ETag S3 gives an object uploaded in parts of ``part_size``: the MD5 of the parts' MD5s, and the part count."""
    digests = [hashlib.md5(data[i : i + part_size]).digest() for i in range(0, len(data), part_size)]
    return f'"{hashlib.md5(b"".join(digests)).hexdigest()}-{len(digests)}"'


class TestUploadObject:
    def test_upload_puts_object(self, s3):
        sent = sent_operations(s3)

        resp = upload("hello.txt", b"hello world", "text/plain", prefix="p/")

        assert resp.status_code == 200
        assert resp.json() == {"bucket": BUCKET, "key": "p/hello.txt", "size": 11, "content_type": "text/plain"}
        assert sent == ["PutObject"]
        stored = s3.get_object(Bucket=BUCKET, Key="p/hello.txt")
        assert stored["Body"].read() == b"hello world"
        assert stored["ContentType"] == "text/plain"

    def test_upload_uses_guess_when_browser_octet_stream(self, s3):
        resp = upload("note.txt", b"x", "application/octet-stream")
        assert resp.status_code == 200
        assert resp.json()["content_type"] == "text/plain"
        assert s3.head_object(Bucket=BUCKET, Key="note.txt")["ContentType"] == "text/plain"

    def test_upload_prefers_extension_when_browser_disagrees(self, s3):
        resp = upload("photo.png", b"x", "image/jpeg")
        assert resp.status_code == 200
        assert resp.json()["content_type"] == "image/png"
        assert s3.head_object(Bucket=BUCKET, Key="photo.png")["ContentType"] == "image/png"

    def test_upload_rejects_large_file(self, s3, monkeypatch):
        monkeypatch.setattr(s3_routes, "S3_MAX_UPLOAD_BYTES", 10)
        sent = sent_operations(s3)

        resp = upload("big.bin", b"x" * 11, "application/octet-stream")

        assert resp.status_code == 413
        assert resp.json()["detail"] == "File exceeds maximum size of 10 bytes"
        assert sent == []

    def test_upload_strips_path_traversal_from_filename(self, s3):
        """Malicious upload names must not create keys with `..` segments (basename is safe)."""
        resp = upload("../../etc/passwd", b"secret", "text/plain", prefix="p/")
        assert resp.status_code == 200
        assert [obj["Key"] for obj in s3.list_objects_v2(Bucket=BUCKET)["Contents"]] == ["p/passwd"]

    def test_file_under_the_part_size_goes_up_in_one_request(self, s3):
        data = os.urandom(8 * MIB - 1)
        sent = sent_operations(s3)

        resp = upload("data.bin", data, "application/octet-stream")

        assert resp.status_code == 200
        assert sent == ["PutObject"]
        assert s3.head_object(Bucket=BUCKET, Key="data.bin")["ETag"] == f'"{hashlib.md5(data).hexdigest()}"'

    def test_large_file_goes_up_in_parts_every_s3_accepts(self, s3):
        """8 MiB parts: over AWS's 5 MiB minimum, under the 16 MiB AWS Emulator takes in one request."""
        data = os.urandom(20 * MIB)
        sent = sent_operations(s3)

        resp = upload("report.csv", data, "application/octet-stream", prefix="exports/")

        assert resp.status_code == 200
        assert resp.json() == {"bucket": BUCKET, "key": "exports/report.csv", "size": 20 * MIB, "content_type": "text/csv"}
        assert sent == ["CreateMultipartUpload", "UploadPart", "UploadPart", "UploadPart", "CompleteMultipartUpload"]
        stored = s3.head_object(Bucket=BUCKET, Key="exports/report.csv")
        assert stored["ETag"] == multipart_etag(data, 8 * MIB)
        assert stored["ContentLength"] == 20 * MIB
        assert stored["ContentType"] == "text/csv"
        assert s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads", []) == []


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


class TestS3RoundTrip:
    def test_upload_list_download_delete_flow(self, s3):
        up = upload("doc.txt", b"payload", "text/plain")
        assert up.status_code == 200
        assert up.json()["key"] == "doc.txt"

        lst = client.get(f"/api/s3/buckets/{BUCKET}/objects")
        assert lst.status_code == 200
        names = [f["name"] for f in lst.json()["files"]]
        assert "doc.txt" in names

        detail = client.get(f"/api/s3/buckets/{BUCKET}/objects/doc.txt")
        assert detail.status_code == 200
        assert detail.json()["size"] == 7

        dl = client.get(f"/api/s3/buckets/{BUCKET}/objects/doc.txt?download=1")
        assert dl.status_code == 200
        assert dl.content == b"payload"

        rm = client.delete(f"/api/s3/buckets/{BUCKET}/objects/doc.txt")
        assert rm.status_code == 200

        gone = client.get(f"/api/s3/buckets/{BUCKET}/objects/doc.txt")
        assert gone.status_code == 404


class TestDownloadObject:
    @pytest.mark.parametrize(
        ("key", "disposition"),
        [
            ("exports/summary_2026-01.csv", 'attachment; filename="summary_2026-01.csv"'),
            ("docs/報告 ☕.txt", "attachment; filename=\"____.txt\"; filename*=UTF-8''%E5%A0%B1%E5%91%8A%20%E2%98%95.txt"),
            ("café.txt", "attachment; filename=\"caf_.txt\"; filename*=UTF-8''caf%C3%A9.txt"),
            (
                'docs/say "hi"\\there;.txt',
                "attachment; filename=\"say__hi__there_.txt\"; filename*=UTF-8''say%20%22hi%22%5Cthere%3B.txt",
            ),
        ],
    )
    def test_any_key_downloads_under_its_own_name(self, s3, key, disposition):
        """RFC 6266: the exact name in filename* as UTF-8, an ASCII fallback that quotes and backslashes can't break."""
        s3.put_object(Bucket=BUCKET, Key=key, Body="contenu ☕".encode(), ContentType="text/plain")

        resp = client.get(f"/api/s3/buckets/{BUCKET}/objects/{quote(key)}", params={"download": 1})

        assert resp.status_code == 200
        assert resp.headers["content-disposition"] == disposition
        assert resp.content == "contenu ☕".encode()

    def test_download_declares_its_length(self, s3):
        """So the browser shows progress, and a download cut short can't pass for a whole one."""
        s3.put_object(Bucket=BUCKET, Key="data.bin", Body=b"x" * 300_000, ContentType="application/octet-stream")

        resp = client.get(f"/api/s3/buckets/{BUCKET}/objects/data.bin", params={"download": 1})

        assert resp.headers["content-length"] == "300000"
        assert resp.headers["content-type"] == "application/octet-stream"
        assert len(resp.content) == 300_000


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
