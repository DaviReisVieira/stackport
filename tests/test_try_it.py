"""Try it, end to end: StackPort describes the stage or function URL through the endpoint, then sends the request.

Each fake emulator is a real HTTP(S) server answering the control plane the
way the AWS API does (so botocore builds and parses those calls for real),
the identification route of the emulator it plays, and its data plane at
that emulator's address format. Every request that reaches it is recorded,
so the tests can show what was sent, and that a refused request sent nothing.
"""

from __future__ import annotations

import json
import socket
import ssl
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qsl, unquote, urlsplit

import boto3
import pytest
from botocore.config import Config
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend import config, try_it
from backend.connection import EndpointInfo
from backend.invoke_urls import InvokeTarget
from backend.main import app
from backend.routes import try_it as route
from backend.routes.common import get_endpoint_info
from backend.schemas.try_it import REQUEST_BODY_LIMIT, TryItRequest
from tests.fake_endpoint import FakeEndpoint, RecordedRequest, self_signed_cert
from tests.moto_aws import aws, moto_account

client = TestClient(app)

JSON = {"Content-Type": "application/json"}
REST_API = "a1b2c3d4e5"
HTTP_API = "h1b2c3d4e5"
FUNCTION = "echo"
URL_ID = "6e1439f900e347b8aafd130f057014b4"
FUNCTION_ARN = f"arn:aws:lambda:us-east-1:000000000000:function:{FUNCTION}"

HEALTH = {
    "ministack": ("/_ministack/health", {"services": {"lambda": "available"}, "version": "1.5.19"}),
    "floci": ("/_floci/health", {"services": {"lambda": "running"}, "version": "2.4.0"}),
    "localstack": ("/_localstack/health", {"services": {"lambda": "running"}, "version": "4.14.0"}),
    "moto": ("/moto-api/config", {"batch": {}, "lambda": {}}),
}


def json_response(status: int, body: Any, headers: dict[str, str] | None = None):
    return status, {**JSON, **(headers or {})}, json.dumps(body).encode()


def not_found(error_type: str, message: str):
    return json_response(404, {"message": message}, {"x-amzn-ErrorType": error_type})


@dataclass
class Emulator:
    """A fake emulator's resources and behaviour. ``plays`` is the emulator it answers identification as."""

    plays: str | None = "ministack"
    function_url: str = f"https://{URL_ID}.lambda-url.us-east-1.on.aws/"
    protocol: str = "HTTP"
    disabled_execute_api: bool = False
    list_function_urls: bool = True
    # What the data plane answers, given the request it got.
    answer: Callable[[RecordedRequest], tuple[int, dict[str, str], bytes]] | None = None
    data_plane: list[RecordedRequest] = field(default_factory=list)

    def handle(self, request: RecordedRequest):
        path, _, query = request.path.partition("?")
        health = HEALTH.get(self.plays or "")
        if health is not None and path == health[0]:
            return json_response(200, health[1])
        if self._is_data_plane(request, path):
            self.data_plane.append(request)
            return self.answer(request) if self.answer else echo(request)
        return self._control_plane(request.method, unquote(path), dict(parse_qsl(query)))

    def _is_data_plane(self, request: RecordedRequest, path: str) -> bool:
        host = request.headers.get("host", "")
        return (
            path.startswith(("/_aws/execute-api/", "/_aws/lambda-url/", "/lambda-url/"))
            or ".execute-api." in host
            or ".lambda-url." in host
        )

    def _control_plane(self, method: str, path: str, query: dict[str, str]):
        if method != "GET":
            return not_found("UnknownOperationException", f"{method} {path}")
        if path == f"/restapis/{REST_API}":
            return json_response(200, {"id": REST_API, "name": "shop", "disableExecuteApiEndpoint": self.disabled_execute_api})
        if path == f"/restapis/{REST_API}/stages":
            return json_response(200, {"item": [{"stageName": "prod"}, {"stageName": "dev"}]})
        if path in (f"/restapis/{REST_API}/stages/dev", f"/restapis/{REST_API}/stages/prod"):
            return json_response(200, {"stageName": path.rsplit("/", 1)[1]})
        if path == f"/v2/apis/{HTTP_API}":
            return json_response(200, {
                "apiId": HTTP_API,
                "name": "orders",
                "protocolType": self.protocol,
                "disableExecuteApiEndpoint": self.disabled_execute_api,
            })
        if path == f"/v2/apis/{HTTP_API}/stages":
            return json_response(200, {"items": [{"stageName": "$default"}, {"stageName": "beta"}]})
        if path in (f"/v2/apis/{HTTP_API}/stages/$default", f"/v2/apis/{HTTP_API}/stages/beta"):
            return json_response(200, {"stageName": path.rsplit("/", 1)[1]})
        if path.startswith(("/restapis/", "/v2/apis/")):
            return not_found("NotFoundException", "Invalid Stage identifier specified")
        if path == f"/2021-10-31/functions/{FUNCTION}/urls" and self.list_function_urls:
            return json_response(200, {"FunctionUrlConfigs": [
                self._url_config(None),
                self._url_config("live"),
            ]})
        if path == f"/2021-10-31/functions/{FUNCTION}/url":
            return json_response(200, self._url_config(query.get("Qualifier")))
        return not_found("UnknownOperationException", f"Unknown operation: GET {path}")

    def _url_config(self, qualifier: str | None) -> dict:
        return {
            "FunctionUrl": self.function_url,
            "FunctionArn": FUNCTION_ARN + (f":{qualifier}" if qualifier else ""),
            "AuthType": "NONE",
            "CreationTime": "2026-11-14T00:00:00Z",
            "LastModifiedTime": "2026-11-14T00:00:00Z",
        }


def echo(request: RecordedRequest):
    """What the stage or function answers: the request it got."""
    return json_response(200, {
        "method": request.method,
        "path": request.path,
        "host": request.headers.get("host"),
        "body": request.body.decode(),
    }, {"X-Echo": "1", "Set-Cookie": "a=1"})


@contextmanager
def running(emulator: Emulator, *, tls=None, saved: bool = True, **settings) -> Iterator[FakeEndpoint]:
    """The fake emulator, as the endpoint StackPort's routes use."""
    with FakeEndpoint(handler=emulator.handle, tls=tls) as server:
        info = EndpointInfo(url=server.url, region="us-east-1", saved=saved, **settings)
        app.dependency_overrides[get_endpoint_info] = lambda: info
        try:
            yield server
        finally:
            app.dependency_overrides.pop(get_endpoint_info, None)


@pytest.fixture(autouse=True)
def no_emulator_files(monkeypatch, tmp_path):
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "no-emulator")


def send(path: str, body: dict | None = None, **kwargs):
    return client.post(f"/api/try-it{path}", json=body if body is not None else {}, **kwargs)


class TestRestStage:
    def test_sends_the_request_and_returns_the_answer(self):
        emulator = Emulator()
        with running(emulator) as server:
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send", {
                "method": "POST",
                "path": "/orders/42",
                "query": [{"name": "expand", "value": "items & more"}, {"name": "expand", "value": "x"}],
                "headers": [{"name": "X-Trace", "value": "abc"}, {"name": "Accept", "value": "application/json"}],
                "body": '{"qty": 2}',
            })

        assert resp.status_code == 200, resp.text
        sent = emulator.data_plane[0]
        assert (sent.method, sent.path) == ("POST", f"/_aws/execute-api/{REST_API}/dev/orders/42?expand=items%20%26%20more&expand=x")
        assert sent.headers["host"] == f"127.0.0.1:{server.port}"
        assert sent.headers["x-trace"] == "abc"
        assert sent.body == b'{"qty": 2}'
        assert "authorization" not in sent.headers
        result = resp.json()
        assert result["status"] == 200
        assert result["request"]["url"] == f"{server.url}/_aws/execute-api/{REST_API}/dev/orders/42?expand=items%20%26%20more&expand=x"
        assert json.loads(result["bodyText"])["body"] == '{"qty": 2}'
        assert ["X-Echo", "1"] in result["headers"]
        assert result["bodyBase64"] is None
        assert result["truncated"] is False
        assert result["durationMs"] >= 0

    def test_describes_each_stage_with_its_address(self):
        with running(Emulator()) as server:
            resp = client.get(f"/api/try-it/rest-apis/{REST_API}")

        assert resp.json() == {
            "realAws": False,
            "problem": None,
            "targets": [
                {"stage": "dev", "url": f"{server.url}/_aws/execute-api/{REST_API}/dev"},
                {"stage": "prod", "url": f"{server.url}/_aws/execute-api/{REST_API}/prod"},
            ],
        }

    def test_a_stage_the_endpoint_doesnt_have_sends_nothing(self):
        emulator = Emulator()
        with running(emulator):
            resp = send(f"/rest-apis/{REST_API}/stages/nope/send")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Invalid Stage identifier specified"
        assert emulator.data_plane == []

    def test_an_api_with_its_default_endpoint_off(self):
        emulator = Emulator(disabled_execute_api=True)
        with running(emulator):
            described = client.get(f"/api/try-it/rest-apis/{REST_API}").json()
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert described["problem"].startswith("This API's default endpoint is turned off")
        assert {target["url"] for target in described["targets"]} == {None}
        assert resp.status_code == 409
        assert emulator.data_plane == []


class TestHttpStage:
    @pytest.mark.parametrize("stage", ["$default", "beta"])
    def test_names_the_stage_in_the_path(self, stage):
        emulator = Emulator(plays="floci")
        with running(emulator):
            resp = send(f"/http-apis/{HTTP_API}/stages/{stage}/send", {"method": "PATCH", "path": "/items"})

        assert resp.status_code == 200, resp.text
        assert (emulator.data_plane[0].method, emulator.data_plane[0].path) == ("PATCH", f"/_aws/execute-api/{HTTP_API}/{stage}/items")
        # A method that carries a body says it has none.
        assert emulator.data_plane[0].headers["content-length"] == "0"

    def test_localstack_by_host(self):
        emulator = Emulator(plays="localstack")
        with running(emulator) as server:
            described = client.get(f"/api/try-it/http-apis/{HTTP_API}").json()
            resp = send(f"/http-apis/{HTTP_API}/stages/$default/send", {"path": "/items"})

        host = f"{HTTP_API}.execute-api.localhost.localstack.cloud:{server.port}"
        assert described["targets"] == [
            {"stage": "$default", "url": f"http://{host}"},
            {"stage": "beta", "url": f"http://{host}/beta"},
        ]
        assert resp.status_code == 200, resp.text
        assert (emulator.data_plane[0].headers["host"], emulator.data_plane[0].path) == (host, "/items")

    def test_a_websocket_api_has_no_address(self):
        emulator = Emulator(protocol="WEBSOCKET")
        with running(emulator):
            described = client.get(f"/api/try-it/http-apis/{HTTP_API}").json()
            resp = send(f"/http-apis/{HTTP_API}/stages/beta/send")

        assert described["problem"] == "Try it sends HTTP requests, and this is a WebSocket API."
        assert resp.status_code == 409
        assert emulator.data_plane == []


class TestFunctionUrl:
    @pytest.mark.parametrize(
        ("plays", "function_url", "path"),
        [
            ("ministack", f"https://{URL_ID}.lambda-url.us-east-1.on.aws/", f"/_aws/lambda-url/{URL_ID}/hello"),
            ("floci", f"http://{URL_ID}.lambda-url.us-east-1.localhost:4566/", f"/lambda-url/{URL_ID}/hello"),
        ],
    )
    def test_by_path(self, plays, function_url, path):
        emulator = Emulator(plays=plays, function_url=function_url)
        with running(emulator):
            resp = send(f"/functions/{FUNCTION}/send", {"path": "/hello"})

        assert resp.status_code == 200, resp.text
        assert emulator.data_plane[0].path == path

    def test_localstack_by_host(self):
        emulator = Emulator(plays="localstack", function_url=f"http://{URL_ID}.lambda-url.us-east-1.localhost.localstack.cloud:4566/")
        with running(emulator) as server:
            resp = send(f"/functions/{FUNCTION}/send", {"method": "DELETE"})

        assert resp.status_code == 200, resp.text
        sent = emulator.data_plane[0]
        assert (sent.method, sent.path) == ("DELETE", "/")
        assert sent.headers["host"] == f"{URL_ID}.lambda-url.us-east-1.localhost.localstack.cloud:{server.port}"

    def test_describes_every_url_of_the_function(self):
        with running(Emulator()) as server:
            resp = client.get(f"/api/try-it/functions/{FUNCTION}")

        url = f"{server.url}/_aws/lambda-url/{URL_ID}"
        assert resp.json()["targets"] == [
            {"qualifier": None, "functionUrl": f"https://{URL_ID}.lambda-url.us-east-1.on.aws/", "authType": "NONE", "url": url},
            {"qualifier": "live", "functionUrl": f"https://{URL_ID}.lambda-url.us-east-1.on.aws/", "authType": "NONE", "url": url},
        ]

    def test_an_endpoint_that_cant_list_urls_is_asked_for_the_unqualified_one(self):
        with running(Emulator(plays="floci", list_function_urls=False)):
            resp = client.get(f"/api/try-it/functions/{FUNCTION}")

        assert [target["qualifier"] for target in resp.json()["targets"]] == [None]

    def test_an_aliases_url(self):
        emulator = Emulator()
        with running(emulator) as server:
            resp = send(f"/functions/{FUNCTION}/send", params={"qualifier": "live"})

        assert resp.status_code == 200, resp.text
        assert [request.path for request in server.requests if request.path.startswith("/2021-10-31/")] == [
            f"/2021-10-31/functions/{FUNCTION}/url?Qualifier=live"
        ]


class TestNoAddress:
    def test_moto_has_no_data_plane(self):
        emulator = Emulator(plays="moto")
        with running(emulator):
            described = client.get(f"/api/try-it/rest-apis/{REST_API}").json()
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert described["problem"] == "Moto doesn't serve REST API stages over HTTP, so there's nothing to send a request to."
        assert resp.status_code == 409
        assert resp.json()["detail"] == described["problem"]
        assert emulator.data_plane == []

    def test_an_endpoint_no_detector_recognises(self):
        emulator = Emulator(plays=None)
        with running(emulator) as server:
            described = client.get(f"/api/try-it/functions/{FUNCTION}").json()
            resp = send(f"/functions/{FUNCTION}/send")

        assert described["problem"] == (
            f"StackPort couldn't tell which emulator answers at {server.url}, "
            "so it doesn't know where that endpoint serves Lambda function URLs."
        )
        assert resp.status_code == 409
        assert emulator.data_plane == []

    @pytest.mark.parametrize("path", ["", "/.amazonaws.com"])
    def test_only_saved_endpoints(self, path):
        emulator = Emulator()

        def handle(request: RecordedRequest):
            # botocore puts the endpoint's path in front of every call
            request.path = request.path.removeprefix(path)
            return emulator.handle(request)

        with FakeEndpoint(handler=handle) as server:
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send", {"confirmed": True}, params={"endpoint": server.url + path})

        assert resp.status_code == 409
        assert "only sends requests to saved endpoints" in resp.json()["detail"]
        assert emulator.data_plane == []


class TestRefusals:
    @pytest.mark.parametrize(
        ("change", "message"),
        [
            ({"path": "http://169.254.169.254/latest"}, "has to start with a single /"),
            ({"path": "//169.254.169.254/latest"}, "has to start with a single /"),
            ({"path": "@169.254.169.254/latest"}, "has to start with a single /"),
            ({"path": "/@169.254.169.254"}, "Percent-encode anything else"),
            ({"path": "/a/../../b"}, "can't contain . or .. segments"),
            ({"path": "/a/%2e%2E/b"}, "can't contain . or .. segments"),
            ({"path": "/a b"}, "Percent-encode anything else"),
            ({"path": "/a\\b"}, "Percent-encode anything else"),
            ({"path": "/a?b=c"}, "Put query parameters in the query fields"),
            ({"headers": [{"name": "X-A", "value": "1\r\nHost: 169.254.169.254"}]}, "line breaks"),
            ({"headers": [{"name": "X-A\r\nHost", "value": "1"}]}, "isn't a valid header name"),
            ({"headers": [{"name": "Bad Name", "value": "1"}]}, "isn't a valid header name"),
            ({"body": "x" * (REQUEST_BODY_LIMIT + 1)}, "The body can be at most 1 MB"),
            ({"method": "CONNECT"}, "Input should be"),
            ({"url": "http://169.254.169.254/"}, "Extra inputs are not permitted"),
        ],
    )
    def test_nothing_is_sent(self, change, message):
        emulator = Emulator()
        with running(emulator) as server:
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send", change)

        assert resp.status_code == 422
        assert message in resp.json()["detail"][0]["msg"]
        assert server.requests == []

    @pytest.mark.parametrize("field", ["query", "headers"])
    def test_text_that_isnt_unicode(self, field):
        emulator = Emulator()
        with running(emulator) as server:
            # A lone surrogate is valid JSON, and no URL or header can carry it.
            resp = client.post(
                f"/api/try-it/rest-apis/{REST_API}/stages/dev/send",
                content=json.dumps({field: [{"name": "a", "value": "\ud800"}]}),
                headers={"Content-Type": "application/json"},
            )

        assert resp.status_code == 422
        assert resp.json()["detail"][0]["type"] == "string_unicode"
        assert server.requests == []

    def test_connection_level_headers_are_left_out(self):
        emulator = Emulator()
        with running(emulator) as server:
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send", {
                "method": "POST",
                "body": "abc",
                "headers": [
                    {"name": "Host", "value": "169.254.169.254"},
                    {"name": "Content-Length", "value": "999"},
                    {"name": "Transfer-Encoding", "value": "chunked"},
                    {"name": "Connection", "value": "close"},
                    {"name": "Authorization", "value": "Bearer token"},
                ],
            })

        sent = emulator.data_plane[0]
        assert sent.headers["host"] == f"127.0.0.1:{server.port}"
        assert sent.headers["content-length"] == "3"
        assert "transfer-encoding" not in sent.headers
        assert sent.headers["authorization"] == "Bearer token"
        assert resp.json()["notices"] == [
            "StackPort sets these headers itself, so yours were left out: Connection, Content-Length, Host, Transfer-Encoding."
        ]


class TestAnswers:
    def test_binary_body_comes_back_as_base64(self):
        emulator = Emulator(answer=lambda _request: (200, {"Content-Type": "image/png"}, b"\x89PNG\r\n\x1a\n\x00\xff"))
        with running(emulator):
            result = send(f"/rest-apis/{REST_API}/stages/dev/send").json()

        assert (result["bodyText"], result["bodyBase64"], result["bodyBytes"]) == (None, "iVBORw0KGgoA/w==", 10)

    def test_a_long_body_is_cut_off(self, monkeypatch):
        monkeypatch.setattr(try_it, "RESPONSE_BODY_LIMIT", 8)
        emulator = Emulator(answer=lambda _request: (200, {}, "ééééé".encode()))
        with running(emulator):
            result = send(f"/rest-apis/{REST_API}/stages/dev/send").json()

        # Eight bytes end inside the fifth "é": only whole characters are shown.
        assert (result["bodyText"], result["bodyBytes"], result["truncated"]) == ("éééé", 8, True)
        assert result["notices"] == ["The body is longer than 8 bytes: this is its beginning."]

    def test_redirects_are_shown_not_followed(self):
        emulator = Emulator(answer=lambda _request: (307, {"Location": "http://169.254.169.254/latest"}, b""))
        with running(emulator):
            result = send(f"/rest-apis/{REST_API}/stages/dev/send").json()

        assert result["status"] == 307
        assert ["Location", "http://169.254.169.254/latest"] in result["headers"]
        assert len(emulator.data_plane) == 1

    def test_the_stage_answering_an_error_is_an_answer(self):
        emulator = Emulator(answer=lambda _request: json_response(502, {"message": "Internal server error"}))
        with running(emulator):
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert resp.status_code == 200
        assert resp.json()["status"] == 502

    def test_head_has_no_body(self):
        emulator = Emulator()
        with running(emulator):
            result = send(f"/rest-apis/{REST_API}/stages/dev/send", {"method": "HEAD"}).json()

        assert (result["status"], result["bodyText"], result["bodyBytes"]) == (200, "", 0)


class TestTls:
    def test_trusts_what_the_endpoint_trusts(self, tmp_path):
        material = self_signed_cert(tmp_path)
        emulator = Emulator()
        with running(emulator, tls=material, ca_bundle=str(material.cert)):
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert resp.status_code == 200, resp.text
        assert len(emulator.data_plane) == 1


    def test_refuses_a_certificate_the_endpoint_doesnt_trust(self, tmp_path, monkeypatch):
        material = self_signed_cert(tmp_path)
        emulator = Emulator()
        control_plane = boto3.client(
            "apigateway", region_name="us-east-1", endpoint_url="https://127.0.0.1:9", aws_access_key_id="test",
            aws_secret_access_key="test", config=Config(ignore_configured_endpoint_urls=True),
        )
        monkeypatch.setattr(route, "get_client", lambda *_args, **_kwargs: control_plane)
        with Stubber(control_plane) as stubber, running(emulator, tls=material):
            stubber.add_response("get_rest_api", {"id": REST_API, "name": "shop"}, {"restApiId": REST_API})
            stubber.add_response("get_stage", {"stageName": "dev"}, {"restApiId": REST_API, "stageName": "dev"})
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "tls"
        assert emulator.data_plane == []


def _target(port: int) -> InvokeTarget:
    return InvokeTarget(scheme="http", connect_host="127.0.0.1", connect_port=port, host=f"127.0.0.1:{port}", base_path="/stage")


@contextmanager
def _trickling_server(parts: list[bytes], *, every: float) -> Iterator[int]:
    """A server that reads the request, then sends ``parts`` one at a time, ``every`` seconds apart."""
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        done = threading.Event()

        def answer():
            connection = server.accept()[0]
            with connection:
                connection.settimeout(5)
                try:
                    connection.recv(65536)
                    for part in parts:
                        if done.wait(every):
                            return
                        connection.sendall(part)
                    done.wait(5)
                except OSError:
                    pass  # StackPort hung up

        thread = threading.Thread(target=answer, daemon=True)
        thread.start()
        try:
            yield server.getsockname()[1]
        finally:
            done.set()
            thread.join(5)


class TestFailures:
    def test_nothing_listening(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        with pytest.raises(try_it.SendFailed) as failure:
            try_it.send(_target(port), TryItRequest(), context=None, connect_timeout=1)

        assert failure.value.error.kind.value == "unreachable"
        assert failure.value.error.message == f"StackPort couldn't reach http://127.0.0.1:{port}: the connection was refused."

    def test_an_answer_that_doesnt_come_in_time(self, monkeypatch):
        monkeypatch.setattr(try_it, "RESPONSE_TIMEOUT", 0.3)
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            accepted: list[socket.socket] = []

            def read_and_wait():
                # Accepts and reads, keeps the connection open, never answers.
                connection = server.accept()[0]
                accepted.append(connection)
                connection.recv(1024)

            threading.Thread(target=read_and_wait, daemon=True).start()
            started = time.monotonic()
            with pytest.raises(try_it.SendFailed) as failure:
                try_it.send(_target(server.getsockname()[1]), TryItRequest(), context=None, connect_timeout=1)

        for connection in accepted:
            connection.close()
        assert time.monotonic() - started < 2
        assert failure.value.error.message.endswith("didn't answer within 0.3 seconds.")

    @pytest.mark.parametrize(
        "answer",
        [
            # The status line and a header, a byte at a time.
            [b"HTTP/1.1 200 OK\r\nX-Slow: ", *[b"a"] * 60, b"\r\nContent-Length: 0\r\n\r\n"],
            # A chunk size that never ends.
            [b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1", *[b";"] * 60, b"\r\nx\r\n0\r\n\r\n"],
            # Trailers without end.
            [b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n", *[b"X-T: 1\r\n" * 1000] * 60, b"\r\n"],
        ],
        ids=["headers", "chunk-size", "trailers"],
    )
    def test_a_trickling_answer_still_ends_on_time(self, monkeypatch, answer):
        monkeypatch.setattr(try_it, "RESPONSE_TIMEOUT", 0.5)
        with _trickling_server(answer, every=0.1) as port:
            started = time.monotonic()
            with pytest.raises(try_it.SendFailed) as failure:
                try_it.send(_target(port), TryItRequest(), context=None, connect_timeout=5)

        # The server keeps trickling for 6 seconds.
        assert time.monotonic() - started < 4
        # Either the deadline ends it, or http.client refuses the answer first: newer
        # Python releases cap the trailer lines they read.
        assert failure.value.error.message in {
            f"http://127.0.0.1:{port} didn't answer within 0.5 seconds.",
            f"http://127.0.0.1:{port} didn't answer with a valid HTTP response.",
        }

    def test_a_stalled_tls_handshake_ends_on_time(self, monkeypatch):
        monkeypatch.setattr(try_it, "RESPONSE_TIMEOUT", 0.5)
        with _trickling_server([], every=0.1) as port:
            target = InvokeTarget(scheme="https", connect_host="127.0.0.1", connect_port=port, host=f"127.0.0.1:{port}", base_path="")
            started = time.monotonic()
            with pytest.raises(try_it.SendFailed) as failure:
                try_it.send(target, TryItRequest(), context=ssl.create_default_context(), connect_timeout=10)

        # A socket timeout alone would wait for connect_timeout.
        assert time.monotonic() - started < 4
        assert failure.value.error.message.endswith("didn't answer within 0.5 seconds.")

    def test_the_route_answers_502_with_the_reason(self, monkeypatch):
        def refuse(*_args, **_kwargs):
            raise try_it.SendFailed(try_it._failure("http://x", ConnectionRefusedError(), connecting=True, connect_timeout=1))

        monkeypatch.setattr("backend.routes.try_it.send", refuse)
        with running(Emulator()):
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send")

        assert resp.status_code == 502
        assert resp.json()["error"]["kind"] == "unreachable"


class TestAws:
    """Against AWS: moto answers the control plane, and the connection StackPort opens is recorded."""

    @pytest.fixture
    def connections(self, monkeypatch) -> Iterator[list[tuple[str, str, int]]]:
        opened: list[tuple[str, str, int]] = []
        emulator = Emulator(plays=None)
        with FakeEndpoint(handler=emulator.handle) as server:
            real = try_it._connection

            def connect(target, context, timeout):
                opened.append((target.scheme, target.connect_host, target.connect_port))
                assert context is None or context.verify_mode.name == "CERT_REQUIRED"
                return real(_target(server.port), None, timeout)

            monkeypatch.setattr(try_it, "_connection", connect)
            with moto_account():
                yield opened

    def _rest_api(self) -> str:
        apigateway = aws("apigateway")
        api_id = apigateway.create_rest_api(name="shop")["id"]
        root = apigateway.get_resources(restApiId=api_id)["items"][0]["id"]
        apigateway.put_method(restApiId=api_id, resourceId=root, httpMethod="GET", authorizationType="NONE")
        apigateway.put_integration(restApiId=api_id, resourceId=root, httpMethod="GET", type="MOCK")
        apigateway.create_deployment(restApiId=api_id, stageName="prod")
        return api_id

    def test_sends_to_the_apis_own_host(self, connections):
        api_id = self._rest_api()
        resp = send(f"/rest-apis/{api_id}/stages/prod/send", {"path": "/orders", "confirmed": True})

        assert resp.status_code == 200, resp.text
        assert connections == [("https", f"{api_id}.execute-api.us-east-1.amazonaws.com", 443)]
        assert resp.json()["request"]["url"] == f"https://{api_id}.execute-api.us-east-1.amazonaws.com/prod/orders"
        assert client.get(f"/api/try-it/rest-apis/{api_id}").json()["realAws"] is True

    def test_needs_confirmation(self, connections):
        api_id = self._rest_api()
        resp = send(f"/rest-apis/{api_id}/stages/prod/send", {"path": "/orders"})

        assert resp.status_code == 428
        assert connections == []

    def test_an_unsaved_aws_url_is_refused_too(self, connections):
        api_id = self._rest_api()
        unsaved = EndpointInfo(url="https://apigateway.us-east-1.amazonaws.com", region="us-east-1", saved=False)
        app.dependency_overrides[get_endpoint_info] = lambda: unsaved
        resp = send(f"/rest-apis/{api_id}/stages/prod/send", {"confirmed": True})

        assert resp.status_code == 409
        assert "only sends requests to saved endpoints" in resp.json()["detail"]
        assert connections == []

    def test_function_url(self, connections):
        lam = aws("lambda")
        role = aws("iam").create_role(RoleName="fn", AssumeRolePolicyDocument="{}")["Role"]["Arn"]
        lam.create_function(FunctionName=FUNCTION, Runtime="python3.12", Role=role, Handler="index.handler", Code={"ZipFile": b"0"})
        function_url = lam.create_function_url_config(FunctionName=FUNCTION, AuthType="NONE")["FunctionUrl"]

        resp = send(f"/functions/{FUNCTION}/send", {"confirmed": True})

        host = urlsplit(function_url).hostname
        assert resp.status_code == 200, resp.text
        assert host.endswith(".lambda-url.us-east-1.on.aws")
        assert connections == [("https", host, 443)]


class TestReadOnly:
    def test_sending_is_allowed_like_an_invoke(self):
        emulator = Emulator()
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False), running(emulator):
            resp = send(f"/rest-apis/{REST_API}/stages/dev/send", {"method": "DELETE"})

        assert resp.status_code == 200, resp.text
        assert len(emulator.data_plane) == 1

    @pytest.mark.parametrize("path", ["/api/try-it/functions/fn", "/api/try-it/functions/fn/send/more", "/api/try-it/send"])
    def test_other_writes_under_try_it_are_not(self, path):
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            assert client.post(path, json={}).status_code == 403
