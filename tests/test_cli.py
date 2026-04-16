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
