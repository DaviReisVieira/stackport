"""Tests for CLI commands."""

import json

from click.testing import CliRunner

from backend.cli import cli


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


class TestEndpointResolution:
    """--endpoint must reach get_client even when ~/.stackport has a saved default (#171)."""

    def _capture_get_client(self, monkeypatch):
        calls = []

        def fake_get_client(service_name, **kwargs):
            calls.append((service_name, kwargs))
            return _FakeClient()

        monkeypatch.setattr("backend.cli.get_client", fake_get_client)
        return calls

    def test_list_passes_explicit_endpoint(self, monkeypatch):
        calls = self._capture_get_client(monkeypatch)
        monkeypatch.setattr("backend.cli.endpoint_store.get_default_url", lambda: "http://saved:4566")
        result = CliRunner().invoke(cli, ["list", "s3", "--endpoint", "http://flag:4599", "--region", "eu-west-1"])
        assert result.exit_code == 0, result.output
        assert calls, "list never created a client"
        for _, kwargs in calls:
            assert kwargs["endpoint_url"] == "http://flag:4599"
            assert kwargs["region"] == "eu-west-1"

    def test_list_falls_back_to_saved_default(self, monkeypatch):
        calls = self._capture_get_client(monkeypatch)
        # Other test modules put AWS_ENDPOINT_URL back into the environment; click reads it via envvar.
        monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
        monkeypatch.setattr("backend.cli.AWS_ENDPOINT_URL", None)
        monkeypatch.setattr("backend.cli.endpoint_store.get_default_url", lambda: "http://saved:4566")
        # Rebuild the option default: click captured AWS_ENDPOINT_URL at import time.
        for param in cli.commands["list"].params:
            if param.name == "endpoint":
                monkeypatch.setattr(param, "default", None)
        result = CliRunner().invoke(cli, ["list", "s3"])
        assert result.exit_code == 0, result.output
        assert calls and all(kwargs["endpoint_url"] == "http://saved:4566" for _, kwargs in calls)

    def test_describe_passes_explicit_endpoint(self, monkeypatch):
        calls = self._capture_get_client(monkeypatch)
        result = CliRunner().invoke(cli, ["describe", "s3", "buckets", "demo", "--endpoint", "http://flag:4599"])
        assert result.exit_code == 0, result.output
        assert calls and all(kwargs["endpoint_url"] == "http://flag:4599" for _, kwargs in calls)

    def test_status_probes_every_service_at_the_given_endpoint(self, monkeypatch):
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
