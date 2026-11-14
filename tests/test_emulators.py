"""Emulator identification against real servers on 127.0.0.1.

Each fake answers its identification route the way the emulator's source does,
and treats every other path the way that emulator's S3 handler would, so the
tests show each emulator is recognised as itself and never as another.
"""

import json
import shutil
import socket
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import aws_emulator, config, connection, emulators
from backend.aws_client import get_client
from backend.cache import cache
from backend.connection import EndpointInfo
from backend.emulator_profiles import PROFILES
from backend.emulators import DETECTORS, detect_emulator
from backend.endpoint_store import EndpointStore
from backend.main import app
from tests.fake_endpoint import S3_EMPTY_LIST_BUCKETS, FakeEndpoint, RecordedRequest, self_signed_cert

JSON = {"Content-Type": "application/json"}
XML = {"Content-Type": "application/xml"}
CONTROL_PATH = "/_stackport/not-an-emulator-route"
ROUTES = {detector.id: detector.path for detector in DETECTORS}


def s3_error(code: str, status: int, resource: str):
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Error><Code>{code}</Code><Message>{code}</Message><Resource>{resource}</Resource></Error>"
    )
    return status, XML, body.encode()


def s3(request: RecordedRequest):
    """An emulator's S3 handler: ListBuckets at the root, any other path is a missing bucket."""
    if request.path == "/":
        return 200, XML, S3_EMPTY_LIST_BUCKETS
    return s3_error("NoSuchBucket", 404, request.path)


def health_report(report: dict):
    return 200, JSON, json.dumps(report).encode()


# ministack/app.py: _handle_health_request serves _HEALTH_PATHS, then
# _handle_unknown_localstack_request turns other /_localstack/ paths into a 404.
MINISTACK_HEALTH = {
    "services": {"s3": "available", "sqs": "available"},
    "auth": "disabled",
    "edition": "light",
    "version": "1.5.19",
    "iot_mtls": "listening",
    "ready_scripts": {"status": "completed", "total": 0, "completed": 0, "failed": 0},
}


def ministack(request: RecordedRequest):
    if request.path in ("/_ministack/health", "/_localstack/health", "/health"):
        return health_report(MINISTACK_HEALTH)
    if request.path.startswith("/_localstack/"):
        return 404, JSON, json.dumps({"error": f"Unknown LocalStack endpoint: {request.path}."}).encode()
    return s3(request)


# EmulatorInfoController is mounted at {prefix:(_floci|_localstack)}; HealthController at /health.
FLOCI_HEALTH = {
    "services": {"s3": "running", "sqs": "running", "glue": "available"},
    "edition": "community",
    "original_edition": "floci-always-free",
    "version": "1.20.0",
}


def floci(request: RecordedRequest):
    if request.path in ("/_floci/health", "/_localstack/health", "/health"):
        return health_report(FLOCI_HEALTH)
    return s3(request)


# localstack/services/internal.py: HealthResource at /_localstack/health. Its S3
# provider rejects a bucket name such as "_ministack" before looking it up.
LOCALSTACK_HEALTH = {"services": {"s3": "running", "sqs": "available"}, "edition": "community", "version": "4.0.3"}


def localstack(request: RecordedRequest):
    if request.path == "/_localstack/health":
        return health_report(LOCALSTACK_HEALTH)
    if request.path.startswith("/_"):
        return s3_error("InvalidBucketName", 400, request.path)
    return s3(request)


# moto/moto_api/_internal: GET /moto-api/config answers 201 with the config.
def moto(request: RecordedRequest):
    if request.path == "/moto-api/config":
        return 201, JSON, json.dumps({"batch": {"use_docker": True}, "lambda": {"use_docker": True}}).encode()
    return s3(request)


# vendor/server/src/lib.rs: .route(HEALTH_PATH, get(|| async { "ok" })), every
# other request goes to the services, which only take signed requests.
def aws_emulator_server(request: RecordedRequest):
    if request.path == "/__admin/health":
        return 200, {"Content-Type": "text/plain; charset=utf-8"}, b"ok"
    if request.access_key_id is None:
        return s3_error("AccessDenied", 403, request.path)
    return s3(request)


def not_found(request: RecordedRequest):
    return 404, {}, b""


EXPECTED = {
    "ministack": {"id": "ministack", "name": "MiniStack", "version": "1.5.19"},
    "floci": {"id": "floci", "name": "Floci", "version": "1.20.0"},
    "localstack": {"id": "localstack", "name": "LocalStack", "version": "4.0.3"},
    "moto": {"id": "moto", "name": "Moto", "version": None},
    "aws-emulator": {"id": "aws-emulator", "name": "AWS Emulator", "version": None},
}
HANDLERS = {
    "ministack": ministack,
    "floci": floci,
    "localstack": localstack,
    "moto": moto,
    "aws-emulator": aws_emulator_server,
}


def profiled(emulator: str, **extra) -> dict:
    """What the routes report for an identified emulator: what identification found, and its profile."""
    return {**EXPECTED[emulator], **extra, "profile": PROFILES[emulator].to_dict()}


def detect(url: str, **settings) -> dict | None:
    return detect_emulator(EndpointInfo(url=url, region=None, **settings))


def paths(server: FakeEndpoint) -> list[str]:
    return [request.path for request in server.requests]


def assert_unsigned(server: FakeEndpoint):
    for request in server.requests:
        assert request.method == "GET"
        assert "authorization" not in request.headers
        assert not any(name.startswith("x-amz-") for name in request.headers)


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    base = tmp_path / "emulator"
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
    get_client.cache_clear()
    aws_emulator.read_credentials.cache_clear()
    # Ports get reused between tests; so would their cached identifications.
    cache.delete_by_prefix("http://127.0.0.1")
    cache.delete_by_prefix("https://127.0.0.1")
    yield base
    get_client.cache_clear()


@pytest.fixture(scope="module")
def tls(tmp_path_factory):
    return self_signed_cert(tmp_path_factory.mktemp("tls"))


class Clock:
    """Stands in for the time module inside backend.cache."""

    def __init__(self):
        self.now = time.time()

    def time(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr("backend.cache.time", fake)
    return fake


class TestRecognition:
    @pytest.mark.parametrize("emulator", ["ministack", "floci", "localstack", "moto"])
    def test_each_emulator_over_http(self, emulator):
        with FakeEndpoint(handler=HANDLERS[emulator]) as server:
            assert detect(server.url) == EXPECTED[emulator]
        # Earlier routes are asked first, then a path no emulator serves.
        asked = [detector.path for detector in DETECTORS]
        assert paths(server) == [*asked[: asked.index(ROUTES[emulator]) + 1], CONTROL_PATH]
        assert_unsigned(server)

    @pytest.mark.parametrize("emulator", list(HANDLERS))
    def test_each_emulator_over_https(self, emulator, tls):
        with FakeEndpoint(handler=HANDLERS[emulator], tls=tls) as server:
            result = detect(server.url, ca_bundle=str(tls.cert))
        assert result == {**EXPECTED[emulator], "tls_trusted": True}
        assert_unsigned(server)

    def test_ministack_answering_localstacks_route_is_ministack(self):
        with FakeEndpoint(handler=ministack) as server:
            assert detect(server.url)["id"] == "ministack"
        assert "/_localstack/health" not in paths(server)

    def test_floci_answering_localstacks_route_is_floci(self):
        with FakeEndpoint(handler=floci) as server:
            assert detect(server.url)["id"] == "floci"
        assert "/_localstack/health" not in paths(server)

    def test_aws_emulator_is_only_looked_for_over_https(self):
        with FakeEndpoint(handler=aws_emulator_server) as server:
            assert detect(server.url) is None
        assert "/__admin/health" not in paths(server)

    def test_endpoint_path_and_user_info(self):
        def behind_a_prefix(request: RecordedRequest):
            if request.path == "/aws/_ministack/health":
                return health_report(MINISTACK_HEALTH)
            return s3(request)

        with FakeEndpoint(handler=behind_a_prefix) as server:
            url = server.url.replace("://", "://user:secret@") + "/aws/"
            assert detect(url)["id"] == "ministack"
        assert paths(server)[0] == "/aws/_ministack/health"
        assert_unsigned(server)

    def test_real_moto_server(self):
        pytest.importorskip("flask_cors", reason="moto[server] not installed")
        from moto.server import ThreadedMotoServer

        server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
        server.start()
        try:
            host, port = server.get_host_and_port()
            assert detect(f"http://{host}:{port}") == EXPECTED["moto"]
        finally:
            server.stop()


class TestNotMistaken:
    @pytest.mark.parametrize(
        ("body", "content_type"),
        [
            (json.dumps(LOCALSTACK_HEALTH).encode(), "application/json"),
            (json.dumps({"batch": {}, "lambda": {}}).encode(), "application/json"),
            (b"<!doctype html><title>App</title>", "text/html"),
            (b"ok", "text/plain"),
        ],
    )
    def test_a_server_that_answers_every_path_alike(self, body, content_type, tls):
        def everything(_request: RecordedRequest):
            return 200, {"Content-Type": content_type}, body

        with FakeEndpoint(handler=everything) as plain, FakeEndpoint(handler=everything, tls=tls) as secure:
            assert detect(plain.url) is None
            assert detect(secure.url, ca_bundle=str(tls.cert)) is None

    def test_s3_compatible_server_serving_objects_at_those_paths(self, tls):
        """Bucket "moto-api" with a "config" object; the other routes aren't valid bucket names."""

        def object_store(request: RecordedRequest):
            bucket = request.path.split("/")[1]
            if bucket.startswith("_"):
                return s3_error("InvalidBucketName", 400, request.path)
            return 200, {"Content-Type": "application/octet-stream"}, b'{"Name": "an object"}'

        with FakeEndpoint(handler=object_store, tls=tls) as server:
            assert detect(server.url, ca_bundle=str(tls.cert)) is None
        assert len(paths(server)) == len(DETECTORS)

    def test_a_redirect_is_not_followed(self):
        with FakeEndpoint(handler=ministack) as target:

            def redirect(request: RecordedRequest):
                return 302, {"Location": target.url + request.path}, b""

            with FakeEndpoint(handler=redirect) as server:
                assert detect(server.url) is None
        assert target.requests == []

    def test_reachable_but_unrecognised(self):
        with FakeEndpoint(handler=not_found) as server:
            assert detect(server.url) is None
        assert paths(server) == [detector.path for detector in DETECTORS if not detector.https_only]


class TestTls:
    def test_untrusted_certificate_is_identified_with_checks_off(self, tls):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            result = detect(server.url)
        assert result == {**EXPECTED["aws-emulator"], "tls_trusted": False}
        assert_unsigned(server)

    @pytest.mark.parametrize("emulator", ["ministack", "floci", "localstack", "moto"])
    def test_untrusted_certificate_for_every_emulator(self, emulator, tls):
        with FakeEndpoint(handler=HANDLERS[emulator], tls=tls) as server:
            assert detect(server.url) == {**EXPECTED[emulator], "tls_trusted": False}

    def test_verification_turned_off_is_the_endpoints_own_choice(self, tls):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            assert detect(server.url, tls_verify=False)["tls_trusted"] is True

    def test_missing_ca_bundle_file(self, tls, tmp_path):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            result = detect(server.url, ca_bundle=str(tmp_path / "missing.pem"))
        assert result == {**EXPECTED["aws-emulator"], "tls_trusted": False}

    def test_aws_emulator_files_are_trusted_without_reading_its_keys(self, tls, isolated):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            run = isolated / str(server.port)
            run.mkdir(parents=True)
            shutil.copy(tls.cert, run / "ca.pem")
            (run / "emulator_credentials").write_text("not an ini file")
            assert detect(server.url) == {**EXPECTED["aws-emulator"], "tls_trusted": True}
        assert_unsigned(server)

    def test_unreadable_emulator_directory(self, tls, isolated, monkeypatch):
        def unreadable(_url):
            raise aws_emulator.AwsEmulatorFilesError(isolated, "permission denied")

        monkeypatch.setattr(aws_emulator, "discover", unreadable)
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            assert detect(server.url) == {**EXPECTED["aws-emulator"], "tls_trusted": False}

    def test_plain_http_to_a_tls_port(self, tls):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            assert detect(server.url.replace("https://", "http://")) is None


class TestCaching:
    def test_result_is_reused(self):
        with FakeEndpoint(handler=ministack) as server:
            first = detect(server.url)
            asked = len(server.requests)
            assert detect(server.url) == first
            assert len(server.requests) == asked

    def test_refresh_looks_again(self):
        with FakeEndpoint(handler=not_found) as server:
            assert detect(server.url) is None
            server.handler = ministack
            assert detect(server.url) is None
            assert detect_emulator(EndpointInfo(url=server.url, region=None), refresh=True)["id"] == "ministack"
            assert detect(server.url)["id"] == "ministack"

    def test_tls_settings_are_part_of_the_key(self, tls):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            assert detect(server.url)["tls_trusted"] is False
            assert detect(server.url, ca_bundle=str(tls.cert))["tls_trusted"] is True
            assert detect(server.url, tls_verify=False)["tls_trusted"] is True

    def test_new_aws_emulator_files_are_looked_at_again(self, tls, isolated):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            assert detect(server.url)["tls_trusted"] is False
            run = isolated / str(server.port)
            run.mkdir(parents=True)
            shutil.copy(tls.cert, run / "ca.pem")
            assert detect(server.url)["tls_trusted"] is True

    def test_unidentified_expires_sooner_than_identified(self, clock):
        assert emulators._UNIDENTIFIED_TTL < emulators._IDENTIFIED_TTL
        with FakeEndpoint(handler=not_found) as server:
            assert detect(server.url) is None
            server.handler = ministack

            clock.now += emulators._UNIDENTIFIED_TTL - 1
            assert detect(server.url) is None
            clock.now += 2
            assert detect(server.url)["id"] == "ministack"

            server.handler = localstack
            clock.now += emulators._IDENTIFIED_TTL - 1
            assert detect(server.url)["id"] == "ministack"
            clock.now += 2
            assert detect(server.url)["id"] == "localstack"

    def test_results_are_copies(self):
        with FakeEndpoint(handler=ministack) as server:
            detect(server.url)["name"] = "changed"
            assert detect(server.url)["name"] == "MiniStack"


class TestUnreachable:
    def test_real_aws_is_never_asked(self, monkeypatch):
        def fail(*_args):
            raise AssertionError("real AWS must not be probed")

        monkeypatch.setattr(emulators, "_identify", fail)
        assert detect_emulator(EndpointInfo(url=None, region="us-east-1")) is None
        assert detect("https://dynamodb.us-east-1.amazonaws.com") is None

    @pytest.mark.parametrize("url", ["http://[::1", "ftp://127.0.0.1:21", "127.0.0.1:4566"])
    def test_urls_that_are_not_http(self, url):
        assert detect(url) is None

    def test_refused_connection(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        assert detect(f"http://127.0.0.1:{port}") is None

    def test_a_host_that_never_answers_costs_one_timeout(self, monkeypatch):
        monkeypatch.setattr(emulators, "_REQUEST_TIMEOUT", 0.3)
        accepted: list[socket.socket] = []
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            listener.settimeout(0.1)

            def accept():
                while True:
                    try:
                        accepted.append(listener.accept()[0])
                    except TimeoutError:
                        continue
                    except OSError:
                        return

            thread = threading.Thread(target=accept, daemon=True)
            thread.start()
            try:
                assert detect(f"http://127.0.0.1:{listener.getsockname()[1]}") is None
                assert len(accepted) == 1
            finally:
                for conn in accepted:
                    conn.close()
                listener.close()
                thread.join()

    def test_a_slow_endpoint_is_given_up_on_within_the_budget(self, monkeypatch):
        monkeypatch.setattr(emulators, "_TIME_BUDGET", 0.5)

        def slow(request: RecordedRequest):
            time.sleep(0.2)
            return not_found(request)

        with FakeEndpoint(handler=slow) as server:
            assert detect(server.url) is None
            assert len(server.requests) < len(DETECTORS) - 1

    def test_unexpected_failures_never_escape(self, monkeypatch):
        def broken(*_args):
            raise RuntimeError("bug")

        monkeypatch.setattr(emulators, "_identify", broken)
        with FakeEndpoint(handler=ministack) as server:
            assert detect(server.url) is None


class TestRoutes:
    @pytest.fixture
    def store(self, tmp_path, monkeypatch):
        real_store = EndpointStore(json_path=tmp_path / "endpoints.json", env_endpoints={"local": "http://localhost:4566"})
        monkeypatch.setattr("backend.routes.endpoints.endpoint_store", real_store)
        monkeypatch.setattr("backend.routes.common.endpoint_store", real_store)
        return real_store

    @pytest.fixture
    def client(self, store):
        return TestClient(app)

    def test_health_names_the_emulator(self, client, store):
        with FakeEndpoint(handler=floci) as server:
            store.add("emu", server.url)
            resp = client.get("/api/health", params={"endpoint": "emu"})
        assert resp.status_code == 200
        assert resp.json()["emulator"] == profiled("floci")

    def test_health_never_identifies_a_url_passed_in_the_request(self, client):
        # Any caller could otherwise make StackPort send requests anywhere.
        with FakeEndpoint(handler=floci) as server:
            resp = client.get("/api/health", params={"endpoint": server.url})
            assert server.requests == []
        assert resp.json()["emulator"] is None

    def test_health_for_real_aws(self, client):
        assert client.get("/api/health", params={"endpoint": "https://s3.amazonaws.com"}).json()["emulator"] is None

    def test_health_survives_a_broken_identification(self, client, monkeypatch):
        def broken(*_args):
            raise RuntimeError("bug")

        monkeypatch.setattr(emulators, "_identify", broken)
        with FakeEndpoint(handler=ministack) as server:
            resp = client.get("/api/health", params={"endpoint": server.url})
        assert resp.status_code == 200
        assert resp.json()["emulator"] is None

    def test_editing_an_endpoint_looks_again(self, client):
        with FakeEndpoint(handler=ministack) as server:
            client.post("/api/endpoints", json={"name": "emu", "url": server.url})
            assert client.get("/api/health", params={"endpoint": "emu"}).json()["emulator"]["id"] == "ministack"
            server.handler = moto
            assert client.get("/api/health", params={"endpoint": "emu"}).json()["emulator"]["id"] == "ministack"
            client.put("/api/endpoints/emu", json={"region": "eu-west-1"})
            assert client.get("/api/health", params={"endpoint": "emu"}).json()["emulator"]["id"] == "moto"

    def test_test_connection_looks_afresh(self, client):
        with FakeEndpoint(handler=not_found) as server:
            assert detect(server.url) is None
            server.handler = ministack
            result = client.post(
                "/api/endpoints/test-connection", json={"name": "t", "url": server.url, "region": None}
            ).json()
        assert result["health"] == "healthy", result
        assert result["emulator"] == profiled("ministack")

    def test_test_connection_explains_an_untrusted_certificate(self, client, tls):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            result = client.post(
                "/api/endpoints/test-connection", json={"name": "t", "url": server.url, "region": None}
            ).json()
        assert result["error_detail"]["kind"] == "tls"
        assert result["emulator"] == profiled("aws-emulator", tls_trusted=False)

    def test_test_connection_identifies_an_emulator_whose_keys_cant_be_read(self, client, tls, isolated):
        with FakeEndpoint(handler=aws_emulator_server, tls=tls) as server:
            run = isolated / str(server.port)
            run.mkdir(parents=True)
            shutil.copy(tls.cert, run / "ca.pem")
            (run / "emulator_credentials").write_text("not an ini file")
            result = client.post(
                "/api/endpoints/test-connection", json={"name": "t", "url": server.url, "region": None}
            ).json()
        assert result["error_detail"]["kind"] == "credentials"
        assert result["emulator"] == profiled("aws-emulator", tls_trusted=True)

    def test_test_connection_skips_identification_when_nothing_answers(self, client, monkeypatch):
        def fail(*_args, **_kwargs):
            raise AssertionError("nothing answered, so there is nothing to identify")

        monkeypatch.setattr("backend.routes.endpoints.detect_emulator", fail)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        result = client.post(
            "/api/endpoints/test-connection", json={"name": "t", "url": f"http://127.0.0.1:{port}", "region": None}
        ).json()
        assert result["error_detail"]["kind"] == "unreachable"
        assert result["emulator"] is None

    def test_saved_endpoint_health(self, client):
        with FakeEndpoint(handler=localstack) as server:
            client.post("/api/endpoints", json={"name": "emu", "url": server.url})
            result = client.post("/api/endpoints/emu/health").json()
        assert result["health"] == "healthy", result
        assert result["emulator"] == profiled("localstack")

    def test_listing_endpoints_does_not_identify(self, client):
        with FakeEndpoint(handler=ministack) as server:
            client.post("/api/endpoints", json={"name": "emu", "url": server.url})
            endpoints = client.get("/api/endpoints").json()["endpoints"]
        assert "emulator" not in next(e for e in endpoints if e["name"] == "emu")
        assert paths(server) == ["/"]


class TestQuickDetection:
    """GET /api/health must stay fast even when identification is slow."""

    @pytest.fixture(autouse=True)
    def fresh_cache(self):
        emulators.cache.delete_by_prefix("http://quick-test")
        yield
        emulators.cache.delete_by_prefix("http://quick-test")

    def test_slow_identification_doesnt_hold_the_caller(self, monkeypatch):
        release = threading.Event()

        def slow_identify(_base_url, _context):
            release.wait(5)
            return {"id": "moto", "name": "Moto", "version": None}

        monkeypatch.setattr(emulators, "_identify", slow_identify)
        ep = EndpointInfo(url="http://quick-test:4566", region=None, saved=True)

        started = time.monotonic()
        assert emulators.detect_emulator_quickly(ep, wait=0.1) is None
        assert time.monotonic() - started < 1

        release.set()
        deadline = time.monotonic() + 5
        while emulators.detect_emulator_quickly(ep, wait=0.1) is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert emulators.detect_emulator_quickly(ep, wait=0.1)["id"] == "moto"

    def test_concurrent_callers_share_one_identification(self, monkeypatch):
        calls = []
        release = threading.Event()

        def counting_identify(_base_url, _context):
            calls.append(1)
            release.wait(5)
            return None

        monkeypatch.setattr(emulators, "_identify", counting_identify)
        ep = EndpointInfo(url="http://quick-test:4567", region=None, saved=True)
        threads = [threading.Thread(target=emulators.detect_emulator_quickly, args=(ep, 0.2)) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        release.set()
        assert len(calls) == 1

    def test_identification_that_finishes_immediately(self, monkeypatch):
        # The done-callback then runs while the caller still holds the lock.
        monkeypatch.setattr(emulators, "_identify", lambda _b, _c: {"id": "floci", "name": "Floci", "version": "1"})
        ep = EndpointInfo(url="http://quick-test:4568", region=None, saved=True)
        assert emulators.detect_emulator_quickly(ep, wait=2)["id"] == "floci"
        assert not emulators._in_flight

    def test_real_aws_is_never_contacted(self):
        assert emulators.detect_emulator_quickly(EndpointInfo(url=None, region=None)) is None


class TestBounds:
    def test_unsaved_endpoints_are_not_identified_in_the_background(self, monkeypatch):
        monkeypatch.setattr(emulators, "_identify", lambda *_a: pytest.fail("identified an unsaved endpoint"))
        assert emulators.detect_emulator_quickly(EndpointInfo(url="http://quick-test:4570", region=None)) is None

    def test_queue_is_capped(self, monkeypatch):
        release = threading.Event()
        calls = []

        def stuck(_base_url, _context):
            calls.append(1)
            release.wait(5)
            return None

        monkeypatch.setattr(emulators, "_identify", stuck)
        try:
            for port in range(4600, 4600 + emulators._MAX_IN_FLIGHT + 5):
                emulators.detect_emulator_quickly(EndpointInfo(url=f"http://quick-cap:{port}", region=None, saved=True), wait=0)
            assert len(emulators._in_flight) == emulators._MAX_IN_FLIGHT
        finally:
            release.set()
            deadline = time.monotonic() + 5
            while emulators._in_flight and time.monotonic() < deadline:
                time.sleep(0.02)
            emulators.cache.delete_by_prefix("http://quick-cap")

    def test_a_trickling_answer_stops_at_the_time_budget(self, monkeypatch):
        monkeypatch.setattr(emulators, "_TIME_BUDGET", 0.5)

        server = socket.create_server(("127.0.0.1", 0))
        port = server.getsockname()[1]
        stop = threading.Event()

        def serve():
            conn, _ = server.accept()
            with conn:
                conn.recv(4096)
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 60000\r\n\r\n")
                while not stop.is_set():
                    try:
                        conn.sendall(b" ")
                    except OSError:
                        return
                    time.sleep(0.1)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            started = time.monotonic()
            assert emulators._identify(f"http://127.0.0.1:{port}", None) is None
            assert time.monotonic() - started < 3
        finally:
            stop.set()
            server.close()

    def test_shutdown_drops_the_pool_and_a_later_call_starts_a_new_one(self, monkeypatch):
        monkeypatch.setattr(emulators, "_identify", lambda _b, _c: {"id": "moto", "name": "Moto", "version": None})
        emulators.shutdown()
        try:
            ep = EndpointInfo(url="http://quick-test:4590", region=None, saved=True)
            assert emulators.detect_emulator_quickly(ep, wait=2)["id"] == "moto"
        finally:
            emulators.cache.delete_by_prefix("http://quick-test")
