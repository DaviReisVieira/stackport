"""Endpoint TLS settings: saved, kept consistent, and used by connection checks."""

import json
import shutil
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import aws_emulator, config, connection
from backend.aws_client import get_client
from backend.endpoint_store import CONFIG_VERSION, EndpointStore
from backend.main import app
from tests.fake_endpoint import FakeEndpoint, self_signed_cert


@pytest.fixture
def store(tmp_path):
    real_store = EndpointStore(json_path=tmp_path / "endpoints.json", env_endpoints={"local": "http://localhost:4566"})
    with patch("backend.routes.endpoints.endpoint_store", real_store):
        yield real_store


@pytest.fixture
def client(store):
    return TestClient(app)


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    base = tmp_path / "emulator"
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
    get_client.cache_clear()
    aws_emulator.read_credentials.cache_clear()
    yield base
    get_client.cache_clear()


def add(client, **fields):
    return client.post("/api/endpoints", json={"name": "emu", "url": "https://127.0.0.1:9297", **fields})


class TestSaving:
    def test_defaults(self, client, store):
        resp = add(client)
        assert resp.status_code == 201
        assert resp.json()["tls_verify"] is True and resp.json()["ca_bundle"] is None
        assert store.get("emu")["tls_verify"] is True

    def test_ca_bundle(self, client, store):
        resp = add(client, ca_bundle="  ~/certs/ca.pem  ")
        assert resp.json()["ca_bundle"] == "~/certs/ca.pem"
        assert store.get("emu")["ca_bundle"] == "~/certs/ca.pem"

    def test_verification_off(self, client, store):
        assert add(client, tls_verify=False).json()["tls_verify"] is False

    def test_both_is_rejected(self, client):
        resp = add(client, tls_verify=False, ca_bundle="/ca.pem")
        assert resp.status_code == 422
        assert "not both" in json.dumps(resp.json())

    def test_list_includes_tls_settings_and_never_the_secret(self, client):
        add(client, ca_bundle="/ca.pem", auth_type="credentials", auth_access_key_id="K", auth_secret_access_key="TOPSECRET")
        healthy = {"health": "healthy", "error": None, "error_detail": None, "connection": None}
        with patch("backend.routes.endpoints.check_connection", return_value=healthy):
            resp = client.get("/api/endpoints")
        emu = next(e for e in resp.json()["endpoints"] if e["name"] == "emu")
        assert emu["ca_bundle"] == "/ca.pem" and emu["tls_verify"] is True
        assert "TOPSECRET" not in resp.text


class TestUpdating:
    def test_setting_a_bundle_turns_verification_back_on(self, client, store):
        add(client, tls_verify=False)
        assert client.put("/api/endpoints/emu", json={"ca_bundle": "/ca.pem"}).status_code == 200
        assert (store.get("emu")["tls_verify"], store.get("emu")["ca_bundle"]) == (True, "/ca.pem")

    def test_turning_verification_off_clears_the_bundle(self, client, store):
        add(client, ca_bundle="/ca.pem")
        client.put("/api/endpoints/emu", json={"tls_verify": False})
        assert (store.get("emu")["tls_verify"], store.get("emu")["ca_bundle"]) == (False, None)

    def test_other_updates_keep_tls_settings(self, client, store):
        add(client, ca_bundle="/ca.pem")
        client.put("/api/endpoints/emu", json={"region": "eu-west-1"})
        assert store.get("emu")["ca_bundle"] == "/ca.pem"

    def test_clearing_the_bundle(self, client, store):
        add(client, ca_bundle="/ca.pem")
        client.put("/api/endpoints/emu", json={"ca_bundle": None})
        assert store.get("emu")["ca_bundle"] is None


class TestConnectionChecks:
    @pytest.fixture
    def tls(self, tmp_path):
        return self_signed_cert(tmp_path)

    @pytest.fixture
    def server(self, tls):
        with FakeEndpoint(tls=tls) as endpoint:
            yield endpoint

    def check(self, client, server, **fields):
        return client.post(
            "/api/endpoints/test-connection", json={"name": "t", "url": server.url, "region": None, **fields}
        ).json()

    def test_untrusted_certificate_explains_itself(self, client, server):
        result = self.check(client, server)
        assert result["health"] == "unhealthy"
        assert result["error_detail"]["kind"] == "tls"
        assert result["error"] == "StackPort doesn't trust the endpoint's TLS certificate."
        assert "CA bundle" in result["error_detail"]["hint"]
        assert result["connection"]["tls_trust_source"] == "system"

    def test_endpoint_ca_bundle(self, client, server, tls):
        result = self.check(client, server, ca_bundle=str(tls.cert))
        assert result["health"] == "healthy", result
        assert result["error"] is None
        assert result["connection"]["tls_trust_source"] == "endpoint"

    def test_aws_emulator_files_are_picked_up(self, client, server, tls, isolated):
        run = isolated / str(server.port)
        run.mkdir(parents=True)
        shutil.copy(tls.cert, run / "ca.pem")
        (run / "emulator_credentials").write_text(
            "[default]\naws_access_key_id = EMULATORABCDEF123456\naws_secret_access_key = S\n"
        )
        result = self.check(client, server)
        assert result["health"] == "healthy", result
        assert result["connection"]["credentials_source"] == "aws-emulator"
        assert result["connection"]["tls_trust_source"] == "aws-emulator"
        # The ListBuckets check; the emulator identification that follows is unsigned.
        assert server.requests[0].access_key_id == "EMULATORABCDEF123456"

    def test_unreadable_emulator_keys(self, client, server, tls, isolated):
        run = isolated / str(server.port)
        run.mkdir(parents=True)
        shutil.copy(tls.cert, run / "ca.pem")
        (run / "emulator_credentials").write_text("garbage")
        result = self.check(client, server)
        assert result["health"] == "unhealthy"
        assert result["error_detail"]["kind"] == "credentials"
        assert result["connection"] is None

    def test_saved_endpoint_health(self, client, server, tls):
        client.post("/api/endpoints", json={"name": "emu", "url": server.url, "ca_bundle": str(tls.cert)})
        result = client.post("/api/endpoints/emu/health").json()
        assert result["name"] == "emu" and result["health"] == "healthy", result

    def test_unknown_endpoint_health_is_404(self, client):
        assert client.post("/api/endpoints/nope/health").status_code == 404


def test_store_migrates_v2_configs(tmp_path):
    path = tmp_path / "endpoints.json"
    path.write_text(json.dumps({
        "version": 2,
        "default": "local",
        "deleted_env_names": [],
        "endpoints": {"local": {"url": "http://localhost:4566", "source": "env", "region": None,
                                "auth_type": "default", "auth_profile": None,
                                "auth_access_key_id": None, "auth_secret_access_key": None}},
    }))
    store = EndpointStore(json_path=path, env_endpoints={})
    assert store.get("local")["tls_verify"] is True
    assert store.get("local")["ca_bundle"] is None
    assert json.loads(path.read_text())["version"] == CONFIG_VERSION
