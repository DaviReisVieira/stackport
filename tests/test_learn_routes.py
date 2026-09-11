"""Integration tests for Learn module API routes.

The API is exercised against a fixture trail rather than the shipped content,
so authoring a new lesson can never break these tests. The shipped content has
its own tests in test_learn_content.py.
"""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from fastapi.testclient import TestClient

from backend.learn_store import LearnProgressStore
from backend.main import app
from backend.routes import learn as learn_routes
from backend.routes.common import EndpointInfo, get_endpoint_info

client = TestClient(app)

ENDPOINT_URL = "http://emulator.test:4566"

FIXTURE_TRAIL = {
    "id": "test-trail",
    "title": "Test trail",
    "description": "A trail that exists only for these tests.",
    "lessons": [
        {
            "id": "lesson-1",
            "title": "Lesson one",
            "summary": "Two verified steps and one manual step.",
            "variables": [
                {
                    "name": "bucket",
                    "label": "Bucket",
                    "default": "test-bucket-{{suffix}}",
                    "pattern": "^[a-z0-9-]{3,40}$",
                    "patternMessage": "lowercase letters, numbers and hyphens only",
                }
            ],
            "steps": [
                {
                    "id": "make-bucket",
                    "title": "Make a bucket",
                    "instruction": "Create {{bucket}} at {{endpointUrl}}.",
                    "commands": {"cli": "aws --endpoint-url={{endpointUrl}} s3 mb s3://{{bucket}}"},
                    "verify": {"type": "s3_bucket_exists", "params": {"bucket": "{{bucket}}"}},
                },
                {
                    "id": "put-file",
                    "title": "Put a file in it",
                    "instruction": "Upload hello.txt.",
                    "verify": {"type": "s3_object_exists", "params": {"bucket": "{{bucket}}", "key": "hello.txt"}},
                },
                {
                    "id": "look-at-it",
                    "title": "Look at it",
                    "instruction": "No API can tell whether you looked.",
                    "verify": None,
                },
            ],
        }
    ],
}


@pytest.fixture(autouse=True)
def fixture_trail(tmp_path):
    """Throwaway progress store, a catalogue holding only the fixture, and a fixed endpoint.

    The endpoint is pinned through FastAPI's dependency override so the tests
    do not depend on whatever AWS_ENDPOINT_URL the machine running them has.
    """
    store = LearnProgressStore(json_path=tmp_path / "progress.json")
    app.dependency_overrides[get_endpoint_info] = lambda: EndpointInfo(url=ENDPOINT_URL, region="us-east-1")
    try:
        with (
            patch.object(learn_routes, "progress_store", store),
            patch.dict(learn_routes.TRAILS, {"test-trail": FIXTURE_TRAIL}, clear=True),
        ):
            yield store
    finally:
        app.dependency_overrides.pop(get_endpoint_info, None)


def _get_trail() -> dict:
    return client.get("/api/learn/trails/test-trail").json()


def _bucket_name() -> str:
    return _get_trail()["variables"]["lesson-1"]["bucket"]


def _verify(step_id: str) -> dict:
    return client.post(
        "/api/learn/verify",
        json={"trailId": "test-trail", "lessonId": "lesson-1", "stepId": step_id},
    )


class TestTrails:
    def test_list_trails(self):
        resp = client.get("/api/learn/trails")
        assert resp.status_code == 200
        trail = next(t for t in resp.json()["trails"] if t["id"] == "test-trail")
        assert trail["lessonCount"] == 1
        assert trail["totalSteps"] == 3
        assert trail["completedSteps"] == 0

    def test_get_trail_not_found(self):
        assert client.get("/api/learn/trails/nope").status_code == 404

    def test_get_trail_substitutes_variables(self):
        data = _get_trail()
        step = data["trail"]["lessons"][0]["steps"][0]
        bucket = data["variables"]["lesson-1"]["bucket"]

        assert bucket.startswith("test-bucket-")
        assert "{{" not in step["instruction"]
        assert bucket in step["instruction"]
        assert f"--endpoint-url={ENDPOINT_URL}" in step["commands"]["cli"]

    def test_generated_variable_is_stable_across_requests(self):
        assert _bucket_name() == _bucket_name()

    def test_variable_specs_keep_their_unresolved_default(self):
        spec = _get_trail()["trail"]["lessons"][0]["variables"][0]
        assert spec["default"] == "test-bucket-{{suffix}}"


class TestVariables:
    def test_set_variable_changes_the_commands(self):
        resp = client.post(
            "/api/learn/variables",
            json={"trailId": "test-trail", "lessonId": "lesson-1", "name": "bucket", "value": "my-own-bucket"},
        )
        assert resp.status_code == 200
        assert resp.json()["variables"]["bucket"] == "my-own-bucket"
        assert "s3://my-own-bucket" in _get_trail()["trail"]["lessons"][0]["steps"][0]["commands"]["cli"]

    def test_invalid_value_is_rejected_with_the_lesson_message(self):
        resp = client.post(
            "/api/learn/variables",
            json={"trailId": "test-trail", "lessonId": "lesson-1", "name": "bucket", "value": "Not Valid"},
        )
        assert resp.status_code == 400
        assert "lowercase" in resp.json()["detail"]

    def test_unknown_variable_is_404(self):
        resp = client.post(
            "/api/learn/variables",
            json={"trailId": "test-trail", "lessonId": "lesson-1", "name": "nope", "value": "x"},
        )
        assert resp.status_code == 404

    @patch("backend.learn.verify.get_client")
    def test_verification_follows_the_chosen_name(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        client.post(
            "/api/learn/variables",
            json={"trailId": "test-trail", "lessonId": "lesson-1", "name": "bucket", "value": "my-own-bucket"},
        )

        assert _verify("make-bucket").json()["passed"] is True
        mock_s3.head_bucket.assert_called_once_with(Bucket="my-own-bucket")


class TestVerify:
    @patch("backend.learn.verify.get_client")
    def test_verify_passes_and_marks_progress(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_bucket.return_value = {}

        data = _verify("make-bucket").json()
        assert data["passed"] is True
        assert data["verifyStatus"] == "ok"
        assert "make-bucket" in data["completed"]["lesson-1"]

    @patch("backend.learn.verify.get_client")
    def test_verify_fails_when_resource_missing(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_bucket.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadBucket")

        data = _verify("make-bucket").json()
        assert data["passed"] is False
        assert data["verifyStatus"] == "ok"
        assert data["completed"] == {}

    @patch("backend.learn.verify.get_client")
    def test_verify_service_unreachable(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_bucket.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")

        data = _verify("make-bucket").json()
        assert data["passed"] is False
        assert data["verifyStatus"] == "service_unreachable"

    @patch("backend.learn.verify.get_client")
    def test_verify_object_step_uses_the_generated_bucket(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.head_object.return_value = {"ContentLength": 21}
        bucket = _bucket_name()

        data = _verify("put-file").json()
        assert data["passed"] is True
        assert "21 bytes" in data["message"]
        mock_s3.head_object.assert_called_once_with(Bucket=bucket, Key="hello.txt")

    def test_verify_manual_step_rejected(self):
        assert _verify("look-at-it").status_code == 400

    def test_verify_unknown_step(self):
        assert _verify("nope").status_code == 404

    def test_verify_unknown_lesson(self):
        resp = client.post(
            "/api/learn/verify",
            json={"trailId": "test-trail", "lessonId": "nope", "stepId": "make-bucket"},
        )
        assert resp.status_code == 404


class TestProgress:
    def _mark(self, step_id: str, force: bool = False):
        body = {"trailId": "test-trail", "lessonId": "lesson-1", "stepId": step_id}
        if force:
            body["force"] = True
        return client.post("/api/learn/progress", json=body)

    def test_mark_manual_step(self):
        resp = self._mark("look-at-it")
        assert resp.status_code == 200
        assert "look-at-it" in resp.json()["completed"]["lesson-1"]
        assert resp.json()["skipped"] == {}

    def test_verified_step_needs_force(self):
        assert self._mark("make-bucket").status_code == 400

    def test_forcing_a_verified_step_records_a_skip(self):
        resp = self._mark("make-bucket", force=True)
        assert resp.status_code == 200
        data = resp.json()
        # skipped steps still advance the lesson, but are not claimed as done
        assert "make-bucket" in data["completed"]["lesson-1"]
        assert "make-bucket" in data["skipped"]["lesson-1"]

    @patch("backend.learn.verify.get_client")
    def test_verifying_later_clears_the_skip(self, mock_get_client):
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        self._mark("make-bucket", force=True)

        data = _verify("make-bucket").json()
        assert data["skipped"]["lesson-1"] == []

    def test_reset(self):
        self._mark("look-at-it")
        resp = client.post("/api/learn/progress/reset", json={"trailId": "test-trail"})
        assert resp.status_code == 200
        assert resp.json()["completed"] == {}

    def test_reset_forgets_the_chosen_names(self):
        client.post(
            "/api/learn/variables",
            json={"trailId": "test-trail", "lessonId": "lesson-1", "name": "bucket", "value": "my-own-bucket"},
        )
        client.post("/api/learn/progress/reset", json={"trailId": "test-trail"})
        assert _bucket_name() != "my-own-bucket"


class TestReadOnlyMode:
    def test_learn_posts_allowed_when_writes_disabled(self):
        """Progress is local state, so a read-only StackPort can still teach."""
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            resp = client.post(
                "/api/learn/progress",
                json={"trailId": "test-trail", "lessonId": "lesson-1", "stepId": "look-at-it"},
            )
            assert resp.status_code == 200
