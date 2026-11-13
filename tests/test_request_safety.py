"""What requests can make StackPort do: endpoint URLs it accepts, and which sites may call it."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend import config
from backend.connection import InvalidEndpointUrl, check_endpoint_url
from backend.main import app
from backend.origins import origin_allowed

client = TestClient(app)


class TestEndpointUrls:
    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost:4566",
            "https://127.0.0.1:9297",
            "http://ministack:4566/",
            "https://[::1]:9297",
            "https://s3.us-east-1.amazonaws.com",
        ],
    )
    def test_ordinary_urls(self, url):
        assert check_endpoint_url(url) == url

    @pytest.mark.parametrize(
        "url",
        [
            # Python reads the host as 127.0.0.1, urllib3 (botocore's transport) as attacker.test.
            "http://attacker.test:1\\@127.0.0.1:2",
            "https://a.example\\@127.0.0.1:9297",
            "http://user:pass@host:4566",
            "http://a b:4566",
            "http://x\r\n:1",
            "ftp://x",
            "http://:80",
            "http://x:99999",
        ],
    )
    def test_ambiguous_or_odd_urls_are_refused(self, url):
        with pytest.raises(InvalidEndpointUrl):
            check_endpoint_url(url)

    def test_direct_endpoint_param_is_checked(self):
        resp = client.get("/api/health", params={"endpoint": "http://evil.test\\@127.0.0.1:2"})
        assert resp.status_code == 422
        assert "backslash" in resp.json()["detail"]

    def test_settings_form_urls_are_checked(self):
        resp = client.post("/api/endpoints/test-connection", json={"name": "t", "url": "http://u@h:1", "region": None})
        assert resp.status_code == 422


class TestCrossSiteCalls:
    def test_cors_is_off_by_default(self):
        resp = client.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in resp.headers

    def test_cors_origins_setting(self):
        assert config._parse_cors_origins({"STACKPORT_CORS_ORIGINS": " http://a:1/ , ,http://b "}) == ["http://a:1", "http://b"]
        assert config._parse_cors_origins({}) == []

    @pytest.mark.parametrize(
        ("origin", "host", "allowed"),
        [
            (None, "localhost:8080", True),  # not a browser
            ("http://localhost:8080", "localhost:8080", True),  # StackPort's own page
            ("http://localhost:5173", "localhost:5173", True),  # the Vite dev server proxying
            ("https://evil.example", "localhost:8080", False),
            ("null", "localhost:8080", False),
        ],
    )
    def test_websocket_origins(self, origin, host, allowed):
        assert origin_allowed(origin, host) is allowed

    def test_configured_origin_is_allowed(self, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_CORS_ORIGINS", ["https://tools.example"])
        assert origin_allowed("https://tools.example", "localhost:8080")

    @pytest.mark.parametrize("path", ["/ws", "/ws/logs/tail"])
    def test_websocket_from_another_site_is_refused(self, path):
        with pytest.raises(WebSocketDisconnect) as info:
            with client.websocket_connect(path, headers={"Origin": "https://evil.example"}) as ws:
                ws.receive_text()
        assert info.value.code == 1008

    def test_websocket_from_stackport_itself_works(self):
        with client.websocket_connect("/ws", headers={"Origin": "http://testserver"}) as ws:
            ws.send_text('{"type": "subscribe", "endpoint": "http://evil.test\\\\@127.0.0.1:2"}')
            assert "backslash" in ws.receive_text()


class TestStaticFiles:
    """The SPA fallback serves files from ui/dist and nothing else."""

    @pytest.mark.parametrize("path", ["/%2Fetc%2Fhosts", "/..%2F..%2Fpyproject.toml", "/%2E%2E/%2E%2E/pyproject.toml"])
    def test_paths_outside_ui_dist_get_the_app_page(self, path):
        import os

        if not os.path.isdir(os.path.join(os.path.dirname(__file__), "..", "ui", "dist")):
            pytest.skip("ui/dist isn't built")
        resp = client.get(path)
        assert resp.status_code == 200
        # The app page, not the file the path points at.
        assert resp.content == client.get("/").content

    def test_files_inside_ui_dist_are_served(self):
        import os

        if not os.path.isfile(os.path.join(os.path.dirname(__file__), "..", "ui", "dist", "index.html")):
            pytest.skip("ui/dist isn't built")
        assert "<!doctype html>" in client.get("/index.html").text.lower()

    @pytest.mark.parametrize("path", ["/", "/resources/sqs", "/settings", "/apiary", "/wsdl"])
    def test_app_routes_get_the_app_page(self, path):
        import os

        if not os.path.isfile(os.path.join(os.path.dirname(__file__), "..", "ui", "dist", "index.html")):
            pytest.skip("ui/dist isn't built")
        resp = client.get(path)
        assert resp.status_code == 200
        assert "<!doctype html>" in resp.text.lower()

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("GET", "/api/does-not-exist"),
            # A route the UI once called that never existed: the app page made it look like it worked.
            ("GET", "/api/s3/buckets/live-data"),
            ("GET", "/api"),
            ("POST", "/api/does-not-exist"),
            ("GET", "/ws"),
            ("GET", "/ws/does-not-exist"),
        ],
    )
    def test_unknown_api_paths_are_a_json_404(self, method, path):
        resp = client.request(method, path)
        assert resp.status_code == 404
        assert resp.json() == {"detail": "Not Found"}

    def test_api_paths_keep_405_for_another_method(self):
        resp = client.patch("/api/sqs/queues")
        assert resp.status_code == 405
        assert resp.json() == {"detail": "Method Not Allowed"}


class TestCrossSiteGuard:
    """Simple requests from another site's page never reach the routes."""

    CROSS_SITE = {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("POST", "/api/sqs/queues/orders/purge"),
            ("POST", "/api/ec2/instances/i-123/terminate"),
            ("GET", "/api/sqs/queues/orders/messages?visibility_timeout=43200"),
            ("GET", "/api/s3/buckets?endpoint=http://attacker.example:80"),
            ("POST", "/api/endpoints"),
        ],
    )
    def test_cross_site_requests_are_refused(self, method, path):
        resp = client.request(method, path, headers=self.CROSS_SITE)
        assert resp.status_code == 403
        assert "other websites" in resp.json()["detail"]

    def test_same_site_is_refused_too(self):
        # localhost:3000 and localhost:8080 are the same site.
        resp = client.post("/api/sqs/queues/orders/purge", headers={"Sec-Fetch-Site": "same-site", "Origin": "http://localhost:3000"})
        assert resp.status_code == 403

    @pytest.mark.parametrize("fetch_site", ["same-origin", "none"])
    def test_stackport_pages_and_typed_urls_pass(self, fetch_site):
        assert client.get("/api/health", headers={"Sec-Fetch-Site": fetch_site}).status_code == 200

    def test_clients_that_arent_browsers_pass(self):
        assert client.get("/api/health").status_code == 200

    def test_old_browser_write_from_another_origin_is_refused(self):
        resp = client.post("/api/sqs/queues/orders/purge", headers={"Origin": "https://evil.example"})
        assert resp.status_code == 403

    def test_configured_origin_passes(self, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_CORS_ORIGINS", ["https://tools.example"])
        resp = client.get("/api/health", headers={"Origin": "https://tools.example", "Sec-Fetch-Site": "cross-site"})
        assert resp.status_code == 200

    def test_the_app_page_itself_isnt_guarded(self):
        assert client.get("/", headers=self.CROSS_SITE).status_code == 200


@pytest.mark.parametrize("url", ["http://localhost%3a6379", "http://127.0.0.1:0"])
def test_hosts_urllib_would_read_differently(url):
    with pytest.raises(InvalidEndpointUrl):
        check_endpoint_url(url)


class TestHostGuard:
    """DNS rebinding: a page pointing its own domain at 127.0.0.1 isn't StackPort's page."""

    BROWSER = {"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/131", "Sec-Fetch-Site": "same-origin"}

    @pytest.mark.parametrize(
        "host",
        ["localhost:8080", "localhost", "app.localhost:8080", "127.0.0.1:8080", "[::1]:8080", "192.168.1.20:8080", "10.0.0.5"],
    )
    def test_names_that_rebinding_cant_use(self, host):
        assert client.get("/api/health", headers={**self.BROWSER, "Host": host}).status_code == 200

    def test_rebound_domain_is_refused(self):
        resp = client.get("/api/health", headers={**self.BROWSER, "Host": "rebind.attacker.example:8080"})
        assert resp.status_code == 400
        assert "STACKPORT_ALLOWED_HOSTS" in resp.text

    def test_app_page_is_refused_too(self):
        assert client.get("/", headers={**self.BROWSER, "Host": "rebind.attacker.example:8080"}).status_code == 400

    def test_old_browser_without_fetch_metadata(self):
        resp = client.get("/api/health", headers={"User-Agent": "Mozilla/5.0 Safari/605", "Host": "rebind.attacker.example"})
        assert resp.status_code == 400

    @pytest.mark.parametrize("user_agent", ["curl/8.7.1", "Java-http-client/21", "kube-probe/1.30", "python-urllib3/2.6"])
    def test_probes_and_scripts_work_with_any_host(self, user_agent):
        # e.g. Floci's console sidecar checking /api/health by container name.
        resp = client.get("/api/health", headers={"User-Agent": user_agent, "Host": "floci-stackport:8080"})
        assert resp.status_code == 200

    def test_allowed_hosts_setting(self, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_ALLOWED_HOSTS", ["stackport.internal"])
        assert client.get("/api/health", headers={**self.BROWSER, "Host": "stackport.internal:8080"}).status_code == 200
        assert client.get("/api/health", headers={**self.BROWSER, "Host": "other.internal"}).status_code == 400

    def test_wildcard_turns_it_off(self, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_ALLOWED_HOSTS", ["*"])
        assert client.get("/api/health", headers={**self.BROWSER, "Host": "anything.example"}).status_code == 200

    def test_websocket_from_rebound_domain_is_refused(self):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws", headers={**self.BROWSER, "Host": "rebind.attacker.example"}) as ws:
                ws.receive_text()

    def test_allowed_hosts_parsing(self):
        assert config._parse_allowed_hosts({"STACKPORT_ALLOWED_HOSTS": " Dev.Box. , ,proxy.example"}) == ["dev.box", "proxy.example"]
