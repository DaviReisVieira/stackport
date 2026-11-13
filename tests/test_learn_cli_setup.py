"""CLI setup shown in lessons for emulators whose CLI needs more than --endpoint-url."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import aws_emulator, config
from backend.learn import cli_setup
from backend.learn_store import LearnProgressStore
from backend.main import app
from backend.routes import learn as learn_routes
from backend.routes.common import EndpointInfo, get_endpoint_info

client = TestClient(app)

TRAIL = {
    "id": "test-trail",
    "title": "Test trail",
    "description": "A trail that exists only for these tests.",
    "lessons": [
        {
            "id": "lesson-1",
            "title": "Lesson one",
            "summary": "One step with a command.",
            "steps": [
                {
                    "id": "list",
                    "title": "List",
                    "instruction": "List things.",
                    "commands": {"cli": "aws --endpoint-url={{endpointUrl}} s3 ls"},
                    "verify": None,
                }
            ],
        }
    ],
}

AWS_EMULATOR = {"id": "aws-emulator", "name": "AWS Emulator", "version": "1.0"}


def _get(url: str, emulator: dict | None, tmp_path: Path, base: Path | None = None) -> dict:
    store = LearnProgressStore(json_path=tmp_path / "progress.json")
    app.dependency_overrides[get_endpoint_info] = lambda: EndpointInfo(url=url, region="us-east-1")
    try:
        with (
            patch.object(learn_routes, "progress_store", store),
            patch.dict(learn_routes.TRAILS, {"test-trail": TRAIL}, clear=True),
            patch.object(cli_setup, "detect_emulator", return_value=emulator),
            patch.object(config, "STACKPORT_AWS_EMULATOR_DIR", base if base is not None else tmp_path / "emulator"),
        ):
            return client.get("/api/learn/trails/test-trail").json()
    finally:
        app.dependency_overrides.pop(get_endpoint_info, None)


@pytest.mark.parametrize(
    "emulator",
    [
        {"id": "ministack", "name": "MiniStack", "version": "1"},
        {"id": "floci", "name": "Floci", "version": "1"},
        {"id": "localstack", "name": "LocalStack", "version": "1"},
        {"id": "moto", "name": "Moto", "version": "1"},
        None,
    ],
)
def test_emulators_that_need_nothing_get_no_setup(emulator, tmp_path):
    assert _get("http://localhost:4566", emulator, tmp_path)["cliSetup"] is None


def test_aws_emulator_gets_its_credentials_certificate_and_prefix_setting(tmp_path):
    data = _get("https://localhost:4566", AWS_EMULATOR, tmp_path)
    base = aws_emulator.display_path(tmp_path / "emulator" / "4566")
    shown = data["cliSetup"]

    assert shown["emulator"] == "AWS Emulator"
    assert {v["name"]: v["value"] for v in shown["variables"]} == {
        "AWS_SHARED_CREDENTIALS_FILE": f"{base}/emulator_credentials",
        "AWS_CA_BUNDLE": f"{base}/ca.pem",
        "AWS_DISABLE_HOST_PREFIX_INJECTION": "true",
    }
    # the command itself stays the plain one: the setup is delivered once, beside it
    assert data["trail"]["lessons"][0]["steps"][0]["commands"]["cli"] == "aws --endpoint-url=https://localhost:4566 s3 ls"


def test_the_folder_follows_the_endpoint_port(tmp_path):
    data = _get("https://127.0.0.1:5599", AWS_EMULATOR, tmp_path)
    ca = next(v["value"] for v in data["cliSetup"]["variables"] if v["name"] == "AWS_CA_BUNDLE")
    assert ca.endswith("/5599/ca.pem")


def test_no_setup_when_the_endpoint_cannot_be_an_aws_emulator(tmp_path):
    # AWS Emulator only serves HTTPS on a loopback host with a port
    assert _get("http://localhost:4566", AWS_EMULATOR, tmp_path)["cliSetup"] is None


def test_no_setup_when_the_folder_lookup_is_off(tmp_path):
    with patch.object(config, "STACKPORT_AWS_EMULATOR_DIR", None):
        ep = EndpointInfo(url="https://localhost:4566", region="us-east-1")
        with patch.object(cli_setup, "detect_emulator", return_value=AWS_EMULATOR):
            assert cli_setup.cli_setup_for(ep) is None


def test_paths_with_spaces_stay_one_shell_word(tmp_path):
    base = tmp_path / "my certs"
    data = _get("https://localhost:4566", AWS_EMULATOR, tmp_path, base=base)
    ca = next(v["value"] for v in data["cliSetup"]["variables"] if v["name"] == "AWS_CA_BUNDLE")
    assert ca == f"'{base}/4566/ca.pem'"


def test_home_folder_stays_a_tilde_when_the_path_is_plain():
    assert cli_setup._shell_path(Path.home() / ".aws" / "emulator" / "4566" / "ca.pem") == (
        "~/.aws/emulator/4566/ca.pem"
    )


def test_home_folder_with_spaces_uses_home_variable():
    assert cli_setup._shell_path(Path.home() / "my certs" / "ca.pem") == '"$HOME"/\'my certs/ca.pem\''
