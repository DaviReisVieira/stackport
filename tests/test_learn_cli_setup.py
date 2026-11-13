"""CLI setup shown in lessons for emulators whose CLI needs more than --endpoint-url."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import aws_emulator, config
from backend.learn import cli_setup
from backend.main import app
from backend.routes.common import EndpointInfo, get_endpoint_info

client = TestClient(app)

AWS_EMULATOR = {"id": "aws-emulator", "name": "AWS Emulator", "version": "1.0"}
URL = "https://localhost:4566"


@pytest.fixture
def emulator_dir(tmp_path, monkeypatch):
    """A base folder holding AWS Emulator's files for port 4566."""
    directory = tmp_path / "4566"
    directory.mkdir()
    (directory / aws_emulator.CA_FILE).write_text("ca")
    (directory / aws_emulator.CREDENTIALS_FILE).write_text(
        "[default]\naws_access_key_id = key\naws_secret_access_key = secret\n"
    )
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
    monkeypatch.setattr(cli_setup, "running_in_container", lambda: False)
    return tmp_path


def _get(emulator: dict | None, **endpoint) -> dict | None:
    ep = EndpointInfo(url=endpoint.pop("url", URL), region="us-east-1", **endpoint)
    app.dependency_overrides[get_endpoint_info] = lambda: ep
    try:
        with patch.object(cli_setup, "detect_emulator_quickly", return_value=emulator):
            return client.get("/api/learn/cli-setup").json()["cliSetup"]
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
def test_emulators_that_need_nothing_get_no_setup(emulator, emulator_dir):
    assert _get(emulator, url="http://localhost:4566") is None
    assert _get(emulator) is None


def test_aws_emulator_gets_credentials_certificate_and_prefix_setting(emulator_dir):
    shown = _get(AWS_EMULATOR)
    base = aws_emulator.display_path(emulator_dir / "4566")

    assert shown["emulator"] == "AWS Emulator"
    assert shown["note"] is None
    assert shown["script"].splitlines() == [
        "unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE",
        f"export AWS_SHARED_CREDENTIALS_FILE={base}/emulator_credentials",
        f"export AWS_CA_BUNDLE={base}/ca.pem",
        "export AWS_DISABLE_HOST_PREFIX_INJECTION=true",
    ]


def test_the_folder_follows_the_endpoint_port(emulator_dir):
    (emulator_dir / "5599").mkdir()
    (emulator_dir / "5599" / aws_emulator.CA_FILE).write_text("ca")
    (emulator_dir / "5599" / aws_emulator.CREDENTIALS_FILE).write_text(
        "[default]\naws_access_key_id = k\naws_secret_access_key = s\n"
    )
    assert "/5599/ca.pem" in _get(AWS_EMULATOR, url="https://127.0.0.1:5599")["script"]


def test_nothing_when_the_endpoint_has_its_own_keys_and_ca_bundle(emulator_dir):
    own = {
        "auth_type": "credentials",
        "auth_access_key_id": "mine",
        "auth_secret_access_key": "mine",
        "ca_bundle": str(emulator_dir / "4566" / "ca.pem"),
    }
    assert _get(AWS_EMULATOR, **own) is None


def test_nothing_when_stackport_finds_no_files(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
    assert _get(AWS_EMULATOR) is None


def test_nothing_when_the_folder_lookup_is_off(monkeypatch):
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", None)
    assert _get(AWS_EMULATOR) is None


def test_nothing_when_the_credentials_cannot_be_read(emulator_dir):
    (emulator_dir / "4566" / aws_emulator.CREDENTIALS_FILE).write_text("not a credentials file")
    assert _get(AWS_EMULATOR) is None


def test_in_a_container_the_paths_are_the_learners_home_folder(emulator_dir, monkeypatch):
    monkeypatch.setattr(cli_setup, "running_in_container", lambda: True)
    shown = _get(AWS_EMULATOR)

    assert "export AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/4566/emulator_credentials" in shown["script"]
    assert "export AWS_CA_BUNDLE=~/.aws/emulator/4566/ca.pem" in shown["script"]
    assert str(emulator_dir) not in shown["script"]
    assert "docker compose" in shown["note"]
    assert "cp aws-emulator:/home/emulator/.aws/emulator/4566 ~/.aws/emulator/" in shown["note"]


def test_paths_with_spaces_stay_one_shell_word(tmp_path, monkeypatch):
    base = tmp_path / "my certs"
    (base / "4566").mkdir(parents=True)
    (base / "4566" / aws_emulator.CA_FILE).write_text("ca")
    (base / "4566" / aws_emulator.CREDENTIALS_FILE).write_text(
        "[default]\naws_access_key_id = k\naws_secret_access_key = s\n"
    )
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
    monkeypatch.setattr(cli_setup, "running_in_container", lambda: False)
    assert f"export AWS_CA_BUNDLE='{base}/4566/ca.pem'" in _get(AWS_EMULATOR)["script"]


def test_home_folder_stays_a_tilde_when_the_path_is_plain():
    assert cli_setup._shell_path(Path.home() / ".aws" / "emulator" / "4566" / "ca.pem") == (
        "~/.aws/emulator/4566/ca.pem"
    )


def test_home_folder_with_spaces_uses_home_variable():
    assert cli_setup._shell_path(Path.home() / "my certs" / "ca.pem") == '"$HOME"/\'my certs/ca.pem\''


def test_container_detection_reads_the_marker_files():
    with patch.object(Path, "exists", lambda self: str(self) == "/.dockerenv"):
        assert cli_setup.running_in_container() is True
    with patch.object(Path, "exists", lambda self: str(self) == "/run/.containerenv"):
        assert cli_setup.running_in_container() is True
    with patch.object(Path, "exists", lambda self: False):
        assert cli_setup.running_in_container() is False


def test_a_raw_endpoint_url_is_never_probed(emulator_dir):
    ep = EndpointInfo(url=URL, region="us-east-1")  # not a saved endpoint
    with patch("backend.emulators._executor") as executor:
        assert cli_setup.cli_setup_for(ep) is None
    executor.assert_not_called()
