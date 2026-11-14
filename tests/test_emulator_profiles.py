"""Emulator profiles: the registry itself, and resetting an emulator through StackPort.

The resets run against real servers on 127.0.0.1 that answer identification
the way each emulator does (the fakes from test_emulators) and their reset
route the way the running emulator did, so the tests see exactly what
StackPort sends and where.
"""

import json
import socket
import time
from dataclasses import replace
from unittest.mock import patch
from urllib.parse import urlsplit

import boto3
import pytest
from botocore.config import Config
from fastapi.testclient import TestClient

from backend import aws_emulator, config, connection, emulator_profiles, websocket
from backend.aws_client import get_client
from backend.cache import cache
from backend.connection import EndpointInfo
from backend.emulator_profiles import PROFILES, ResetFailed, ResetTarget, send_reset, with_profile
from backend.emulators import DETECTORS
from backend.endpoint_store import EndpointStore
from backend.main import app
from backend.routes.stats import SERVICE_REGISTRY
from tests.fake_endpoint import FakeEndpoint, RecordedRequest, self_signed_cert
from tests.test_emulators import aws_emulator_server, floci, localstack, ministack, moto, not_found

# What each emulator answered POST <reset path> with, running.
RESETS = {
    "ministack": ("/_ministack/reset", (200, {"Content-Type": "application/json"}, b'{"reset": "ok"}')),
    "floci": ("/_floci/state/reset", (200, {"Content-Type": "application/json;charset=UTF-8"}, b'{"status":"OK"}')),
    "moto": ("/moto-api/reset", (200, {"Content-Type": "text/html; charset=utf-8"}, b'{"status": "ok"}')),
}
IDENTIFIED_BY = {"ministack": ministack, "floci": floci, "moto": moto}
NAMES = {"ministack": "MiniStack", "floci": "Floci", "moto": "Moto"}


def resettable(emulator: str, answer=None):
    """A fake of ``emulator`` that also serves its reset route, with ``answer`` or the real one."""
    path, real_answer = RESETS[emulator]

    def serve(request: RecordedRequest):
        if request.method == "POST" and request.path.endswith(path):
            return answer(request) if callable(answer) else (answer or real_answer)
        return IDENTIFIED_BY[emulator](request)

    return serve


def posts(server: FakeEndpoint) -> list[RecordedRequest]:
    return [request for request in server.requests if request.method != "GET"]


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
    get_client.cache_clear()
    aws_emulator.read_credentials.cache_clear()
    cache.delete_by_prefix("http://127.0.0.1")
    cache.delete_by_prefix("https://127.0.0.1")
    yield
    get_client.cache_clear()


@pytest.fixture
def store(tmp_path, monkeypatch):
    saved = EndpointStore(json_path=tmp_path / "endpoints.json", env_endpoints={"local": "http://localhost:4566"})
    monkeypatch.setattr("backend.routes.endpoints.endpoint_store", saved)
    monkeypatch.setattr("backend.routes.common.endpoint_store", saved)
    return saved


@pytest.fixture
def client(store):
    return TestClient(app)


@pytest.fixture(scope="module")
def tls(tmp_path_factory):
    return self_signed_cert(tmp_path_factory.mktemp("tls"))


class TestRegistry:
    def test_every_recognised_emulator_has_a_profile(self):
        assert set(PROFILES) == {detector.id for detector in DETECTORS}

    @pytest.mark.parametrize("path", sorted(p.reset_path for p in PROFILES.values() if p.reset_path is not None))
    def test_reset_paths_are_fixed_paths(self, path):
        parts = urlsplit(path)
        assert path.startswith("/") and not path.startswith("//")
        assert (parts.scheme, parts.netloc, parts.query, parts.fragment) == ("", "", "", "")
        assert ".." not in path and "{" not in path and "%" not in path

    def test_resets_are_the_ones_each_emulator_documents(self):
        resets = {emulator: profile.reset_path for emulator, profile in PROFILES.items()}
        assert resets == {
            "aws-emulator": None,
            "ministack": "/_ministack/reset",
            "floci": "/_floci/state/reset",
            "localstack": None,
            "moto": "/moto-api/reset",
        }

    @pytest.mark.parametrize("emulator", sorted(PROFILES))
    def test_docs_are_https(self, emulator):
        assert PROFILES[emulator].docs_url.startswith("https://")

    def test_limits_name_services_stackport_shows(self):
        for profile in PROFILES.values():
            for limit in profile.limits:
                assert limit.service is None or limit.service in SERVICE_REGISTRY

    def test_profile_as_the_ui_reads_it(self):
        assert with_profile({"id": "moto", "name": "Moto", "version": None}) == {
            "id": "moto",
            "name": "Moto",
            "version": None,
            "profile": {"docs_url": "https://docs.getmoto.org/en/latest/", "reset": True, "limits": []},
        }
        limits = with_profile({"id": "aws-emulator", "name": "AWS Emulator", "version": None})["profile"]["limits"]
        assert [limit["service"] for limit in limits] == [None, "s3", "lambda"]
        assert all(limit["text"].startswith("AWS Emulator ") for limit in limits)

    def test_nothing_identified_and_unknown_ids(self):
        assert with_profile(None) is None
        assert with_profile({"id": "newcomer", "name": "Newcomer", "version": "1"})["profile"] is None


class TestReset:
    @pytest.mark.parametrize("emulator", sorted(RESETS))
    def test_posts_the_emulators_own_reset(self, emulator, client, store):
        with FakeEndpoint(handler=resettable(emulator)) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"name": "emu", "url": server.url, "emulator": {"id": emulator, "name": NAMES[emulator]}}
        [sent] = posts(server)
        assert sent.path == RESETS[emulator][0]
        assert sent.body == b""
        assert sent.headers["content-length"] == "0"
        assert sent.headers["user-agent"] == "StackPort"
        # Nothing secret: no signature, no credentials of any kind.
        assert "authorization" not in sent.headers
        assert not any(name.startswith("x-amz-") for name in sent.headers)
        # Identified afresh first, so the path belongs to whatever answers there now.
        assert server.requests.index(sent) > 0

    def test_identifies_again_rather_than_trusting_an_old_answer(self, client, store):
        with FakeEndpoint(handler=resettable("ministack")) as server:
            store.add("emu", server.url)
            assert client.get("/api/health", params={"endpoint": "emu"}).json()["emulator"]["id"] == "ministack"
            server.handler = resettable("moto")
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.json()["emulator"]["id"] == "moto"
        assert [request.path for request in posts(server)] == ["/moto-api/reset"]

    def test_under_the_endpoints_own_path(self, client, store):
        serve = resettable("ministack")

        def behind_a_prefix(request: RecordedRequest):
            if not request.path.startswith("/aws/"):
                return not_found(request)
            return serve(replace(request, path=request.path.removeprefix("/aws")))

        with FakeEndpoint(handler=behind_a_prefix) as server:
            store.add("emu", server.url + "/aws/")
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 200, resp.text
        assert [request.path for request in posts(server)] == ["/aws/_ministack/reset"]

    def test_over_https_with_the_endpoints_trust(self, client, store, tls):
        with FakeEndpoint(handler=resettable("floci"), tls=tls) as server:
            store.add("emu", server.url, ca_bundle=str(tls.cert))
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 200, resp.text
        assert [request.path for request in posts(server)] == ["/_floci/state/reset"]

    def test_never_with_certificate_checks_off(self, client, store, tls):
        # Identification still names the emulator over an untrusted certificate; the reset isn't sent.
        with FakeEndpoint(handler=resettable("floci"), tls=tls) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "tls"
        assert "didn't send the reset" in resp.json()["detail"]
        assert posts(server) == []

    def test_unreadable_ca_bundle(self, client, store, tls, tmp_path):
        with FakeEndpoint(handler=resettable("floci"), tls=tls) as server:
            store.add("emu", server.url, ca_bundle=str(tmp_path / "missing.pem"))
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "tls"
        assert posts(server) == []

    def test_a_redirect_is_not_followed(self, client, store):
        with FakeEndpoint(handler=resettable("ministack")) as elsewhere:

            # urllib would follow a 302 to a POST, as a GET to wherever it points.
            def redirect(request: RecordedRequest):
                return 302, {"Location": elsewhere.url + request.path}, b""

            with FakeEndpoint(handler=resettable("ministack", answer=redirect)) as server:
                store.add("emu", server.url)
                resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 502
        assert resp.json()["detail"] == "MiniStack answered the reset with HTTP 302."
        assert elsewhere.requests == []

    def test_explains_a_refusal_in_the_emulators_words(self, client, store):
        # EmulatorInfoController.reset when DynamoDB runs on an external DynamoDB Local.
        refusal = (
            409,
            {"Content-Type": "application/json"},
            json.dumps({
                "__type": "UnsupportedOperation",
                "message": "The DynamoDB Local backend keeps its data outside Floci; reset the external DynamoDB Local instance instead",
            }).encode(),
        )
        with FakeEndpoint(handler=resettable("floci", answer=refusal)) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 502
        assert resp.json()["detail"] == (
            "Floci answered the reset with HTTP 409: The DynamoDB Local backend keeps its data outside Floci; "
            "reset the external DynamoDB Local instance instead"
        )
        assert resp.json()["error"]["kind"] == "other"

    def test_an_answer_without_a_message(self, client, store):
        failure = (500, {"Content-Type": "text/html"}, b"<html><body>Internal Server Error</body></html>")
        with FakeEndpoint(handler=resettable("moto", answer=failure)) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.json()["detail"] == "Moto answered the reset with HTTP 500."

    def test_no_answer_in_time(self, client, store, monkeypatch):
        monkeypatch.setattr(emulator_profiles, "RESET_TIMEOUT", 0.2)

        def slow(_request):
            time.sleep(0.5)
            return RESETS["ministack"][1]

        with FakeEndpoint(handler=resettable("ministack", answer=slow)) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "unreachable"
        assert "didn't answer the reset within 0.2 seconds" in resp.json()["detail"]

    def test_nothing_listening(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        target = ResetTarget("moto", "Moto", f"http://127.0.0.1:{port}/moto-api/reset", None)
        with pytest.raises(ResetFailed) as failed:
            send_reset(target)
        assert failed.value.error.kind.value == "unreachable"
        assert failed.value.error.message == "StackPort couldn't reach Moto."

    def test_a_real_moto_server_is_emptied(self, client, store):
        pytest.importorskip("flask_cors", reason="moto[server] not installed")
        from moto.server import ThreadedMotoServer

        server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
        server.start()
        try:
            host, port = server.get_host_and_port()
            url = f"http://{host}:{port}"
            s3 = boto3.client(
                "s3", endpoint_url=url, region_name="us-east-1", aws_access_key_id="test",
                aws_secret_access_key="test", config=Config(ignore_configured_endpoint_urls=True),
            )
            s3.create_bucket(Bucket="before-the-reset")
            store.add("moto", url)
            resp = client.post("/api/endpoints/moto/reset")
            assert resp.status_code == 200, resp.text
            assert s3.list_buckets()["Buckets"] == []
        finally:
            server.stop()


class TestRefused:
    def test_unknown_endpoint(self, client):
        assert client.post("/api/endpoints/nope/reset").status_code == 404

    def test_real_aws(self, client, store, monkeypatch):
        def fail(*_args, **_kwargs):
            raise AssertionError("real AWS must not be asked anything")

        monkeypatch.setattr(emulator_profiles, "detect_emulator", fail)
        store.add("prod", None)
        resp = client.post("/api/endpoints/prod/reset")
        assert resp.status_code == 400
        assert resp.json()["detail"] == "This endpoint is real AWS. StackPort only resets emulators."

    def test_an_endpoint_that_isnt_saved(self):
        # A URL passed straight in a request is never asked anything, let alone reset.
        with FakeEndpoint(handler=resettable("ministack")) as server:
            with pytest.raises(emulator_profiles.ResetRefused):
                emulator_profiles.reset_target(EndpointInfo(url=server.url, region=None))
        assert server.requests == []

    def test_unrecognised_endpoint(self, client, store):
        with FakeEndpoint(handler=not_found) as server:
            store.add("emu", server.url)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 409
        assert "can't tell which emulator answers" in resp.json()["detail"]
        assert posts(server) == []

    @pytest.mark.parametrize(
        ("handler", "https", "name"),
        [(localstack, False, "LocalStack"), (aws_emulator_server, True, "AWS Emulator")],
    )
    def test_emulators_without_a_reset(self, handler, https, name, client, store, tls):
        with FakeEndpoint(handler=handler, tls=tls if https else None) as server:
            store.add("emu", server.url, ca_bundle=str(tls.cert) if https else None)
            resp = client.post("/api/endpoints/emu/reset")
        assert resp.status_code == 409
        assert resp.json()["detail"] == f"StackPort knows no request that resets {name}, so it can't reset it."
        assert posts(server) == []


class TestReadOnly:
    def test_reset_is_a_write(self, client, store):
        with FakeEndpoint(handler=resettable("ministack")) as server:
            store.add("emu", server.url)
            with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
                for path in ("/api/endpoints/emu/reset", "/api/endpoints/emu/reset/"):
                    resp = client.post(path)
                    assert resp.status_code == 403, path
                    assert "disabled" in resp.json()["detail"].lower()
        assert server.requests == []

    def test_endpoint_management_stays_open(self, client, store):
        # An endpoint can be called "reset"; editing it is configuration, not a write to an emulator.
        store.add("reset", "http://127.0.0.1:1")
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            assert client.put("/api/endpoints/reset", json={"region": "eu-west-1"}).status_code == 200
            assert client.post("/api/endpoints/reset/health").status_code == 200


class TestCaches:
    def test_dropped_after_a_reset(self, client, store):
        with FakeEndpoint(handler=resettable("ministack")) as server, FakeEndpoint(handler=ministack) as other:
            store.add("emu", server.url)
            ep = EndpointInfo.from_entry(store.get("emu"))
            cache.set(f"{ep.cache_scope()}:stats", {"total_resources": 7})
            cache.set(f"{ep.cache_scope()}:resources:s3", {"resources": ["gone"]})
            cache.set(f"{other.url}:stats", {"total_resources": 3})
            websocket._last_stats_by_scope[ep.cache_scope()] = websocket._Snapshot(ep.url, {"total_resources": 7})
            invalidations = websocket._invalidations[ep.url]
            try:
                assert client.post("/api/endpoints/emu/reset").status_code == 200
                assert cache.get(f"{ep.cache_scope()}:stats") is None
                assert cache.get(f"{ep.cache_scope()}:resources:s3") is None
                assert ep.cache_scope() not in websocket._last_stats_by_scope
                # A probe that started before the reset doesn't bring the old counts back.
                assert websocket._invalidations[ep.url] == invalidations + 1
                assert cache.get(f"{other.url}:stats") == {"total_resources": 3}
            finally:
                websocket._last_stats_by_scope.pop(ep.cache_scope(), None)

    def test_dropped_when_the_emulator_refuses_too(self, client, store):
        refusal = (409, {"Content-Type": "application/json"}, b'{"message": "not now"}')
        with FakeEndpoint(handler=resettable("floci", answer=refusal)) as server:
            store.add("emu", server.url)
            ep = EndpointInfo.from_entry(store.get("emu"))
            cache.set(f"{ep.cache_scope()}:stats", {"total_resources": 7})
            assert client.post("/api/endpoints/emu/reset").status_code == 502
        assert cache.get(f"{ep.cache_scope()}:stats") is None

    def test_kept_when_nothing_was_sent(self, client, store):
        with FakeEndpoint(handler=localstack) as server:
            store.add("emu", server.url)
            ep = EndpointInfo.from_entry(store.get("emu"))
            cache.set(f"{ep.cache_scope()}:stats", {"total_resources": 7})
            assert client.post("/api/endpoints/emu/reset").status_code == 409
        assert cache.get(f"{ep.cache_scope()}:stats") == {"total_resources": 7}
