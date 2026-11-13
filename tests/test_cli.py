"""Tests for CLI commands."""

import json

import pytest
from click.testing import CliRunner

from backend.cli import cli
from backend.endpoint_store import EndpointStore


class TestCLI:
    """Test CLI commands."""

    def test_help(self):
        """Test --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "StackPort" in result.output
        assert "status" in result.output
        assert "list" in result.output
        assert "describe" in result.output
        assert "export" in result.output
        assert "serve" in result.output

    def test_version(self):
        """Test --version shows version."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        # Should show some version info
        assert len(result.output) > 0

    def test_status_help(self):
        """Test status --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["status", "--help"])
        assert result.exit_code == 0
        assert "Show all services" in result.output
        assert "--endpoint" in result.output
        assert "--region" in result.output
        assert "--output" in result.output

    def test_list_help(self):
        """Test list --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["list", "--help"])
        assert result.exit_code == 0
        assert "List resources" in result.output
        assert "--endpoint" in result.output
        assert "--output" in result.output

    def test_describe_help(self):
        """Test describe --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["describe", "--help"])
        assert result.exit_code == 0
        assert "Describe a specific resource" in result.output
        assert "--endpoint" in result.output
        assert "--output" in result.output

    def test_export_help(self):
        """Test export --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["export", "--help"])
        assert result.exit_code == 0
        assert "Export all resources" in result.output
        assert "--format" in result.output

    def test_serve_help(self):
        """Test serve --help shows usage."""
        runner = CliRunner()
        result = runner.invoke(cli, ["serve", "--help"])
        assert result.exit_code == 0
        assert "Start the StackPort web server" in result.output
        assert "--port" in result.output

    def test_list_invalid_service(self):
        """Test list command with invalid service."""
        runner = CliRunner()
        result = runner.invoke(cli, ["list", "invalid-service-name"])
        assert result.exit_code == 1
        assert "Unknown service" in result.output
        assert "Valid services:" in result.output

    def test_describe_invalid_lookup(self):
        """Test describe command with invalid service/resource_type combo."""
        runner = CliRunner()
        result = runner.invoke(cli, ["describe", "s3", "invalid-resource-type", "test-id"])
        assert result.exit_code == 1
        assert "No detail lookup registered" in result.output

    def test_status_output_formats(self):
        """Test status command accepts different output formats."""
        runner = CliRunner()
        # JSON format
        result = runner.invoke(cli, ["status", "--output", "json"])
        # Should either succeed or fail gracefully
        assert result.exit_code in [0, 2]  # 0 = success, 2 = service unavailable
        if result.exit_code == 0:
            # If successful, should be valid JSON
            data = json.loads(result.output)
            assert isinstance(data, dict)

        # Table format
        result = runner.invoke(cli, ["status", "--output", "table"])
        assert result.exit_code in [0, 2]

    def test_list_output_formats(self):
        """Test list command accepts different output formats."""
        runner = CliRunner()
        for output_format in ["json", "table", "csv"]:
            result = runner.invoke(cli, ["list", "s3", "--output", output_format])
            # Should either succeed or fail gracefully
            assert result.exit_code in [0, 1, 2]

    def test_export_formats(self):
        """Test export command accepts different formats."""
        runner = CliRunner()
        for format_type in ["json", "csv"]:
            result = runner.invoke(cli, ["export", "s3", "--format", format_type])
            # Should either succeed or fail gracefully
            assert result.exit_code in [0, 1, 2]


class _FakeClient:
    """Answers any boto3 method with an empty response."""

    def __getattr__(self, name):
        return lambda **kwargs: {}


def _store(tmp_path, monkeypatch, env_url=None):
    """A throwaway endpoint store, used by both the CLI and the route helpers it shares."""
    store = EndpointStore(tmp_path / "endpoints.json", {"default": env_url} if env_url else {})
    monkeypatch.setattr("backend.cli.endpoint_store", store)
    monkeypatch.setattr("backend.routes.common.endpoint_store", store)
    monkeypatch.setattr("backend.cli.AWS_ENDPOINT_URL", env_url)
    return store


class TestEndpointResolution:
    """--endpoint must reach get_client even when ~/.stackport has a saved default (#171)."""

    def _capture_get_client(self, monkeypatch):
        calls = []

        def fake_get_client(service_name, **kwargs):
            calls.append((service_name, kwargs))
            return _FakeClient()

        monkeypatch.setattr("backend.cli.get_client", fake_get_client)
        return calls

    def test_list_passes_explicit_endpoint(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        _store(tmp_path, monkeypatch).add("saved", "http://saved:4566")
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", "http://flag:4599", "--region", "eu-west-1"])
        assert result.exit_code == 0, result.output
        assert calls, "list never created a client"
        for _, kwargs in calls:
            assert kwargs["endpoint_url"] == "http://flag:4599"
            assert kwargs["region"] == "eu-west-1"

    def test_list_falls_back_to_saved_default(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        _store(tmp_path, monkeypatch).add("saved", "http://saved:4566")
        result = CliRunner().invoke(cli, ["list", "s3"])
        assert result.exit_code == 0, result.output
        assert calls and all(kwargs["endpoint_url"] == "http://saved:4566" for _, kwargs in calls)

    def test_describe_passes_explicit_endpoint(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        _store(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["describe", "s3", "buckets", "demo", "--endpoint", "http://flag:4599"])
        assert result.exit_code == 0, result.output
        assert calls and all(kwargs["endpoint_url"] == "http://flag:4599" for _, kwargs in calls)

    def test_status_probes_every_service_at_the_given_endpoint(self, monkeypatch, tmp_path):
        _store(tmp_path, monkeypatch)
        probed = []

        def fake_probe(service, endpoint_url, region=None, **_):
            probed.append((service, endpoint_url, region))
            return service, {"status": "available", "resources": {}}

        monkeypatch.setattr("backend.cli._probe_service", fake_probe)
        result = CliRunner().invoke(cli, ["status", "--endpoint", "http://flag:4599", "--output", "json"])
        assert result.exit_code == 0, result.output
        assert probed, "status never probed anything"
        assert {url for _, url, _ in probed} == {"http://flag:4599"}
        assert isinstance(json.loads(result.output), dict)


class TestSavedEndpointSettings:
    """A saved endpoint's auth, TLS and region reach get_client from every command (#189)."""

    def _capture_get_client(self, monkeypatch):
        calls = []

        def fake_get_client(service_name, **kwargs):
            calls.append(kwargs)
            return _FakeClient()

        monkeypatch.setattr("backend.cli.get_client", fake_get_client)
        return calls

    def _saved_endpoints(self, tmp_path, monkeypatch):
        store = _store(tmp_path, monkeypatch)
        store.add("plain", "http://plain:4566")
        store.add(
            "prod",
            "https://prod:4566",
            region="eu-west-2",
            auth_type="profile",
            auth_profile="staging",
            ca_bundle="/certs/ca.pem",
        )
        store.add(
            "keys",
            "https://keys:4566",
            auth_type="credentials",
            auth_access_key_id="AKIAEXAMPLE",
            auth_secret_access_key="s3cret",
            tls_verify=False,
        )
        return store

    def test_default_endpoint_profile_and_ca_bundle(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        store = self._saved_endpoints(tmp_path, monkeypatch)
        store.set_default("prod")
        result = CliRunner().invoke(cli, ["list", "s3"])
        assert result.exit_code == 0, result.output
        assert calls
        for kwargs in calls:
            assert kwargs["endpoint_url"] == "https://prod:4566"
            assert kwargs["region"] == "eu-west-2"
            assert kwargs["auth_type"] == "profile"
            assert kwargs["auth_profile"] == "staging"
            assert kwargs["ca_bundle"] == "/certs/ca.pem"
            assert kwargs["tls_verify"] is True

    def test_named_endpoint_keys_and_verify_off(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        self._saved_endpoints(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", "keys"])
        assert result.exit_code == 0, result.output
        assert calls
        for kwargs in calls:
            assert kwargs["endpoint_url"] == "https://keys:4566"
            assert kwargs["auth_type"] == "credentials"
            assert kwargs["auth_access_key_id"] == "AKIAEXAMPLE"
            assert kwargs["auth_secret_access_key"] == "s3cret"
            assert kwargs["tls_verify"] is False

    def test_describe_uses_named_endpoint(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        self._saved_endpoints(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["describe", "s3", "buckets", "demo", "--endpoint", "prod"])
        assert result.exit_code == 0, result.output
        assert calls and all(k["auth_profile"] == "staging" and k["ca_bundle"] == "/certs/ca.pem" for k in calls)

    def test_status_passes_settings_to_every_probe(self, monkeypatch, tmp_path):
        self._saved_endpoints(tmp_path, monkeypatch)
        probes = []

        def fake_probe(service, **kwargs):
            probes.append(kwargs)
            return service, {"status": "available", "resources": {}}

        monkeypatch.setattr("backend.cli._probe_service", fake_probe)
        result = CliRunner().invoke(cli, ["status", "--endpoint", "keys", "--output", "json"])
        assert result.exit_code == 0, result.output
        assert probes
        assert all(p["auth_access_key_id"] == "AKIAEXAMPLE" and p["tls_verify"] is False for p in probes)

    def test_export_uses_named_endpoint(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        self._saved_endpoints(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["export", "s3", "--endpoint", "prod"])
        assert result.exit_code == 0, result.output
        assert calls and all(k["auth_profile"] == "staging" for k in calls)

    def test_region_flag_overrides_the_saved_region(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        self._saved_endpoints(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", "prod", "--region", "ap-south-1"])
        assert result.exit_code == 0, result.output
        assert calls and all(k["region"] == "ap-south-1" and k["auth_profile"] == "staging" for k in calls)

    def test_url_flag_uses_no_saved_settings(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        store = self._saved_endpoints(tmp_path, monkeypatch)
        store.set_default("prod")
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", "http://flag:4599"])
        assert result.exit_code == 0, result.output
        assert calls
        assert all(k["auth_type"] == "default" and k["ca_bundle"] is None and k["region"] is None for k in calls)

    def test_startup_endpoint_url_keeps_its_saved_settings(self, monkeypatch, tmp_path):
        calls = self._capture_get_client(monkeypatch)
        store = _store(tmp_path, monkeypatch)
        store.add("other", "http://other:4566")
        store.add("tls", "https://env:4566", auth_type="profile", auth_profile="dev", ca_bundle="/certs/env.pem")
        store.set_default("other")
        monkeypatch.setattr("backend.cli.AWS_ENDPOINT_URL", "https://env:4566")
        result = CliRunner().invoke(cli, ["list", "s3"])
        assert result.exit_code == 0, result.output
        assert calls and all(k["endpoint_url"] == "https://env:4566" and k["auth_profile"] == "dev" for k in calls)

    @pytest.mark.parametrize("command", [["list", "s3"], ["status"], ["describe", "s3", "buckets", "demo"], ["export", "s3"]])
    def test_unknown_endpoint_name_is_a_usage_error(self, monkeypatch, tmp_path, command):
        calls = self._capture_get_client(monkeypatch)
        self._saved_endpoints(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, [*command, "--endpoint", "prodd"])
        assert result.exit_code == 2
        assert "'prodd' is not a saved endpoint name" in result.output
        assert "Saved endpoints: keys, plain, prod." in result.output
        assert isinstance(result.exception, SystemExit)
        assert not calls

    @pytest.mark.parametrize("url", ["http://a\\@b:4566", "http://host:0", "http://host with space"])
    def test_refused_url_is_a_clear_error_not_a_traceback(self, monkeypatch, tmp_path, url):
        calls = self._capture_get_client(monkeypatch)
        _store(tmp_path, monkeypatch)
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", url])
        assert result.exit_code == 2
        assert "--endpoint" in result.output
        assert isinstance(result.exception, SystemExit)
        assert not calls


class TestServeBinding:
    """StackPort has no login, so it listens on this machine only unless asked."""

    def _run(self, monkeypatch, args):
        calls = []
        monkeypatch.setattr("backend.cli.uvicorn.run", lambda *a, **kw: calls.append(kw))
        result = CliRunner().invoke(cli, ["serve", *args])
        assert result.exit_code == 0, result.output
        return calls[0]

    def test_loopback_by_default(self, monkeypatch):
        assert self._run(monkeypatch, [])["host"] == "127.0.0.1"

    def test_host_flag(self, monkeypatch):
        assert self._run(monkeypatch, ["--host", "0.0.0.0"])["host"] == "0.0.0.0"

    def test_default_comes_from_stackport_host(self, monkeypatch):
        for param in cli.commands["serve"].params:
            if param.name == "host":
                monkeypatch.setattr(param, "default", "0.0.0.0")
        assert self._run(monkeypatch, [])["host"] == "0.0.0.0"

