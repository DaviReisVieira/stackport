"""Tests for authored trail content and the verification checks it uses.

Bad content strands a learner mid lesson with no way forward, so everything
that ships is validated here rather than discovered at runtime.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from backend.learn.content import validate_trail
from backend.learn.hotspots import KNOWN_HOTSPOT_IDS
from backend.learn.verify import CHECKS, run_check
from backend.routes.common import EndpointInfo
from backend.routes.learn import _TRAILS_DIR

SHIPPED_TRAILS = sorted(_TRAILS_DIR.glob("*.json"))


def _endpoint() -> EndpointInfo:
    return EndpointInfo(url="http://localhost:4566", region="us-east-1")


class TestShippedContent:
    def test_there_is_content_to_ship(self):
        assert SHIPPED_TRAILS, "no trail files found"

    @pytest.mark.parametrize("path", SHIPPED_TRAILS, ids=lambda p: p.stem)
    def test_trail_is_valid(self, path: Path):
        validate_trail(json.loads(path.read_text()))

    @pytest.mark.parametrize("path", SHIPPED_TRAILS, ids=lambda p: p.stem)
    def test_every_step_offers_a_way_forward(self, path: Path):
        """A step the learner cannot act on is a dead end: it needs a console path or a command."""
        for lesson in json.loads(path.read_text())["lessons"]:
            for step in lesson["steps"]:
                where = f"{lesson['id']}/{step['id']}"
                assert step.get("console") or step.get("commands"), f"{where} has neither"

    @pytest.mark.parametrize("path", SHIPPED_TRAILS, ids=lambda p: p.stem)
    def test_cli_commands_target_the_learners_endpoint(self, path: Path):
        """A hardcoded endpoint would send the learner's command at the wrong emulator."""
        for lesson in json.loads(path.read_text())["lessons"]:
            for step in lesson["steps"]:
                cli = (step.get("commands") or {}).get("cli", "")
                if "--endpoint-url" in cli:
                    assert "--endpoint-url={{endpointUrl}}" in cli, f"{lesson['id']}/{step['id']}"


class TestValidation:
    def _trail(self, **lesson_overrides) -> dict:
        lesson = {
            "id": "l",
            "title": "L",
            "summary": "S",
            "steps": [{"id": "s", "title": "S", "instruction": "Do it."}],
        }
        lesson.update(lesson_overrides)
        return {"id": "t", "title": "T", "description": "D", "lessons": [lesson]}

    def test_minimal_trail_is_valid(self):
        validate_trail(self._trail())

    def test_missing_key_is_named(self):
        trail = self._trail()
        del trail["description"]
        with pytest.raises(ValueError, match="description"):
            validate_trail(trail)

    def test_unknown_verify_type_is_rejected(self):
        trail = self._trail(
            steps=[{"id": "s", "title": "S", "instruction": "x", "verify": {"type": "nope", "params": {}}}]
        )
        with pytest.raises(ValueError, match="unknown verify type 'nope'"):
            validate_trail(trail)

    def test_unknown_nested_verify_type_is_rejected(self):
        trail = self._trail(
            steps=[
                {
                    "id": "s",
                    "title": "S",
                    "instruction": "x",
                    "verify": {"type": "all_of", "params": {"checks": [{"type": "nope"}]}},
                }
            ]
        )
        with pytest.raises(ValueError, match="unknown verify type 'nope'"):
            validate_trail(trail)

    def test_unknown_hotspot_is_rejected(self):
        trail = self._trail(
            steps=[
                {
                    "id": "s",
                    "title": "S",
                    "instruction": "x",
                    "console": {"hotspotId": "does-not-exist", "route": "/resources/s3"},
                }
            ]
        )
        with pytest.raises(ValueError, match="unknown hotspot"):
            validate_trail(trail)

    def test_console_path_without_a_route_is_rejected(self):
        trail = self._trail(
            steps=[{"id": "s", "title": "S", "instruction": "x", "console": {"hotspotId": "s3-upload"}}]
        )
        with pytest.raises(ValueError, match="no route"):
            validate_trail(trail)

    def test_undeclared_variable_is_rejected(self):
        trail = self._trail(steps=[{"id": "s", "title": "S", "instruction": "Use {{bucket}}."}])
        with pytest.raises(ValueError, match="undeclared variable"):
            validate_trail(trail)

    def test_declared_variable_is_accepted(self):
        validate_trail(
            self._trail(
                variables=[{"name": "bucket", "label": "B", "default": "b-{{suffix}}"}],
                steps=[{"id": "s", "title": "S", "instruction": "Use {{bucket}}."}],
            )
        )

    def test_endpoint_url_needs_no_declaration(self):
        validate_trail(self._trail(steps=[{"id": "s", "title": "S", "instruction": "At {{endpointUrl}}."}]))

    def test_duplicate_step_id_is_rejected(self):
        trail = self._trail(
            steps=[
                {"id": "s", "title": "A", "instruction": "x"},
                {"id": "s", "title": "B", "instruction": "y"},
            ]
        )
        with pytest.raises(ValueError, match="duplicate step id"):
            validate_trail(trail)

    def test_lesson_completion_text_is_checked_too(self):
        trail = self._trail(completion={"summary": "You made {{bucket}}."})
        with pytest.raises(ValueError, match="undeclared variable"):
            validate_trail(trail)


class TestChecks:
    @patch("backend.learn.verify.get_client")
    def test_object_exists_reports_the_size(self, mock_get_client):
        s3 = MagicMock()
        s3.head_object.return_value = {"ContentLength": 42}
        mock_get_client.return_value = s3

        result = run_check(_endpoint(), {"type": "s3_object_exists", "params": {"bucket": "b", "key": "k"}})
        assert result["passed"] is True
        assert "42 bytes" in result["message"]

    @patch("backend.learn.verify.get_client")
    def test_object_missing_names_the_key(self, mock_get_client):
        s3 = MagicMock()
        s3.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        mock_get_client.return_value = s3

        result = run_check(_endpoint(), {"type": "s3_object_exists", "params": {"bucket": "b", "key": "hello.txt"}})
        assert result["passed"] is False
        assert "hello.txt" in result["message"]

    @patch("backend.learn.verify.get_client")
    def test_prefix_exists_when_a_key_matches(self, mock_get_client):
        s3 = MagicMock()
        s3.list_objects_v2.return_value = {"KeyCount": 1}
        mock_get_client.return_value = s3

        result = run_check(_endpoint(), {"type": "s3_prefix_exists", "params": {"bucket": "b", "prefix": "photos/"}})
        assert result["passed"] is True
        s3.list_objects_v2.assert_called_once_with(Bucket="b", Prefix="photos/", MaxKeys=1)

    @patch("backend.learn.verify.get_client")
    def test_prefix_missing(self, mock_get_client):
        s3 = MagicMock()
        s3.list_objects_v2.return_value = {"KeyCount": 0}
        mock_get_client.return_value = s3

        result = run_check(_endpoint(), {"type": "s3_prefix_exists", "params": {"bucket": "b", "prefix": "photos/"}})
        assert result["passed"] is False

    @patch("backend.learn.verify.get_client")
    def test_all_of_reports_the_first_failure(self, mock_get_client):
        s3 = MagicMock()
        s3.head_bucket.return_value = {}
        s3.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        mock_get_client.return_value = s3

        result = run_check(
            _endpoint(),
            {
                "type": "all_of",
                "params": {
                    "checks": [
                        {"type": "s3_bucket_exists", "params": {"bucket": "b"}},
                        {"type": "s3_object_exists", "params": {"bucket": "b", "key": "missing.txt"}},
                    ]
                },
            },
        )
        assert result["passed"] is False
        assert "missing.txt" in result["message"]

    @patch("backend.learn.verify.get_client")
    def test_all_of_passes_when_everything_passes(self, mock_get_client):
        s3 = MagicMock()
        s3.head_object.return_value = {"ContentLength": 1}
        mock_get_client.return_value = s3

        result = run_check(
            _endpoint(),
            {
                "type": "all_of",
                "params": {
                    "checks": [
                        {"type": "s3_bucket_exists", "params": {"bucket": "b"}},
                        {"type": "s3_object_exists", "params": {"bucket": "b", "key": "k"}},
                    ]
                },
            },
        )
        assert result["passed"] is True

    def test_all_of_with_no_sub_checks_does_not_pass(self):
        result = run_check(_endpoint(), {"type": "all_of", "params": {"checks": []}})
        assert result["passed"] is False


class TestHotspotRegistry:
    def test_ids_follow_the_naming_convention(self):
        for hotspot_id in KNOWN_HOTSPOT_IDS:
            assert hotspot_id == hotspot_id.lower()
            assert "-" in hotspot_id, hotspot_id

    def test_checks_registry_is_not_empty(self):
        assert "s3_bucket_exists" in CHECKS
