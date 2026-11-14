"""Dashboard probes: telling 'not supported' apart from 'broken', and spotting endpoint-wide failures."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, SSLError
from fastapi.testclient import TestClient

from backend.aws_errors import ClassifiedError, ErrorKind
from backend.main import app
from backend.routes import stats
from backend.routes.common import EndpointInfo
from backend.routes.stats import _probe_service, _service_result, collect_stats, summarize_problem
from tests.fake_endpoint import FakeEndpoint, ministack_s3_fallback


def not_implemented(operation="ListThings") -> ClientError:
    return ClientError(
        {"Error": {"Code": "NotImplemented", "Message": ""}, "ResponseMetadata": {"HTTPStatusCode": 501}}, operation
    )


def rejected() -> ClientError:
    return ClientError(
        {"Error": {"Code": "InvalidClientTokenId", "Message": "bad"}, "ResponseMetadata": {"HTTPStatusCode": 403}},
        "ListThings",
    )


def err(kind: ErrorKind, message="m") -> ClassifiedError:
    return ClassifiedError(kind, message)


class TestServiceResult:
    def test_all_good(self):
        assert _service_result({"buckets": 2}, {}) == {"status": "available", "resources": {"buckets": 2}}

    def test_partial_failure_keeps_the_service_available(self):
        result = _service_result({"instances": 3}, {"vpcs": err(ErrorKind.NOT_IMPLEMENTED)})
        assert result["status"] == "available"
        assert result["resources"] == {"instances": 3, "vpcs": 0}
        assert result["errors"]["vpcs"]["kind"] == "not_implemented"

    def test_everything_not_implemented_is_unsupported(self):
        result = _service_result({}, {"a": err(ErrorKind.NOT_IMPLEMENTED), "b": err(ErrorKind.NOT_IMPLEMENTED)})
        assert result["status"] == "unsupported"
        assert result["error"]["kind"] == "not_implemented"

    def test_unavailable_prefers_the_connection_error(self):
        result = _service_result(
            {}, {"a": err(ErrorKind.NOT_IMPLEMENTED), "b": err(ErrorKind.OTHER), "c": err(ErrorKind.TLS)}
        )
        assert result["status"] == "unavailable"
        assert result["error"]["kind"] == "tls"

    def test_unavailable_prefers_a_real_error_over_not_implemented(self):
        result = _service_result({}, {"a": err(ErrorKind.NOT_IMPLEMENTED), "b": err(ErrorKind.OTHER, "500")})
        assert result["error"] == {"kind": "other", "message": "500"}


class TestProbeService:
    @patch("backend.routes.stats.get_client")
    def test_counts_resources(self, mock_get_client):
        mock_get_client.return_value.list_buckets.return_value = {"Buckets": [{}, {}]}
        assert _probe_service("s3", "http://x:4566") == ("s3", {"status": "available", "resources": {"buckets": 2}})

    @patch("backend.routes.stats.get_client")
    def test_unsupported_service(self, mock_get_client):
        mock_get_client.return_value.list_work_groups.side_effect = not_implemented("ListWorkGroups")
        name, result = _probe_service("athena", "https://127.0.0.1:9297")
        assert name == "athena"
        assert result["status"] == "unsupported"
        assert result["error"]["operation"] == "ListWorkGroups"

    @patch("backend.routes.stats.get_client")
    def test_failure_building_the_client_is_classified_too(self, mock_get_client):
        mock_get_client.side_effect = SSLError(endpoint_url="https://x", error="bad cert")
        _, result = _probe_service("s3", "https://x:1")
        assert result["status"] == "unavailable"
        assert result["error"]["kind"] == "tls"

    @patch("backend.routes.stats.get_client")
    def test_forwards_tls_settings(self, mock_get_client):
        mock_get_client.return_value.list_buckets.return_value = {"Buckets": []}
        _probe_service("s3", "https://x:1", None, ca_bundle="/ca.pem", tls_verify=True)
        assert mock_get_client.call_args.kwargs["ca_bundle"] == "/ca.pem"

    @pytest.mark.parametrize("service", ["codepipeline", "xray", "verifiedpermissions", "bedrock"])
    def test_a_service_the_endpoint_hands_to_s3_is_unsupported(self, service):
        # MiniStack gives requests for APIs it doesn't serve to S3, which refuses them.
        with FakeEndpoint(handler=ministack_s3_fallback) as endpoint:
            _, result = _probe_service(service, endpoint.url)
        assert result["status"] == "unsupported"
        assert result["error"]["kind"] == "not_implemented"


class TestSummarizeProblem:
    def unavailable(self, kind: str, message="m"):
        return {"status": "unavailable", "resources": {}, "error": {"kind": kind, "message": message}}

    def test_one_banner_when_every_service_fails_to_connect(self):
        services = {name: self.unavailable("credentials", "rejected") for name in ("s3", "sqs", "sns")}
        assert summarize_problem(services) == {"kind": "credentials", "message": "rejected"}

    def test_none_when_anything_answered(self):
        services = {"s3": {"status": "available", "resources": {}}, "sqs": self.unavailable("unreachable")}
        assert summarize_problem(services) is None

    def test_none_when_failures_are_per_service(self):
        services = {
            "s3": {"status": "unsupported", "resources": {}, "error": {"kind": "not_implemented", "message": "x"}},
            "sqs": self.unavailable("other"),
        }
        assert summarize_problem(services) is None

    def test_most_common_endpoint_error_wins(self):
        services = {
            "a": self.unavailable("tls", "cert"),
            "b": self.unavailable("tls", "cert"),
            "c": self.unavailable("unreachable", "down"),
        }
        assert summarize_problem(services)["kind"] == "tls"

    def test_empty(self):
        assert summarize_problem({}) is None


class TestCollectStats:
    def test_aggregates_and_reports_the_problem(self, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "s3,sqs")
        with patch("backend.routes.stats.get_client") as mock_get_client:
            mock_get_client.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")
            result = collect_stats(EndpointInfo(url="http://localhost:4566", region=None))
        assert list(result["services"]) == ["s3", "sqs"]
        assert result["total_resources"] == 0
        assert result["problem"]["kind"] == "unreachable"

    def test_no_services_enabled(self, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", " , ")
        result = collect_stats(EndpointInfo(url="http://localhost:4566", region=None))
        assert result["services"] == {} and result["problem"] is None


class TestStatsRoute:
    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_response_has_problem_field(self, client, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "sqs")
        stats.cache.delete_by_prefix("http://probe-test:4566:")
        with patch("backend.routes.stats.get_client") as mock_get_client:
            mock_get_client.return_value.list_queues.side_effect = rejected()
            data = client.get("/api/stats?endpoint=http://probe-test:4566").json()
        assert data["services"]["sqs"]["status"] == "unavailable"
        assert data["problem"]["kind"] == "credentials"

    def test_cache_is_per_endpoint_identity(self, client, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "s3")
        stats.cache.delete_by_prefix("http://probe-test:4566:")
        with patch("backend.routes.stats.get_client") as mock_get_client:
            mock_get_client.return_value.list_buckets.return_value = {"Buckets": []}
            client.get("/api/stats?endpoint=http://probe-test:4566")
            client.get("/api/stats?endpoint=http://probe-test:4566")
        assert mock_get_client.call_count == 1


def test_probe_reuses_endpoint_info_kwargs():
    ep = EndpointInfo(url="https://x:1", region="eu-west-1", tls_verify=False)
    with patch("backend.routes.stats._probe_service", return_value=("s3", {"status": "available", "resources": {}})) as probe:
        with patch.object(stats, "STACKPORT_SERVICES", "s3"):
            collect_stats(ep)
    args, kwargs = probe.call_args
    assert args == ("s3", "https://x:1", "eu-west-1")
    assert kwargs["tls_verify"] is False


class TestFailingFast:
    """A dead endpoint shouldn't cost one timeout per resource type and service."""

    @patch("backend.routes.stats.get_client")
    def test_a_service_stops_at_the_first_connection_failure(self, mock_get_client):
        mock_get_client.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")
        _, result = _probe_service("ec2", "http://localhost:4566")
        assert mock_get_client.call_count == 1
        assert result["status"] == "unavailable" and result["error"]["kind"] == "unreachable"

    @patch("backend.routes.stats.get_client")
    def test_not_implemented_doesnt_stop_the_other_types(self, mock_get_client):
        mock_get_client.return_value.describe_instances.side_effect = not_implemented("DescribeInstances")
        mock_get_client.return_value.describe_security_groups.return_value = {"SecurityGroups": [{}]}
        _, result = _probe_service("ec2", "http://localhost:4566")
        assert result["status"] == "available"
        assert result["resources"]["security_groups"] == 1

    def test_pending_services_are_skipped_once_the_endpoint_is_down(self, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "s3,sqs,sns,dynamodb")
        monkeypatch.setattr(stats, "STACKPORT_PROBE_WORKERS", 1)
        with patch("backend.routes.stats.get_client") as mock_get_client:
            mock_get_client.side_effect = EndpointConnectionError(endpoint_url="http://localhost:4566")
            result = collect_stats(EndpointInfo(url="http://localhost:4566", region=None))
        assert mock_get_client.call_count == 1
        assert set(result["services"]) == {"s3", "sqs", "sns", "dynamodb"}
        assert all(svc["status"] == "unavailable" for svc in result["services"].values())
        assert result["problem"]["kind"] == "unreachable"


def test_stats_cache_key_includes_tls_settings(monkeypatch):
    monkeypatch.setattr(stats, "STACKPORT_SERVICES", "s3")
    seen = []
    monkeypatch.setattr(stats.cache, "get", lambda key: seen.append(key))
    monkeypatch.setattr(stats.cache, "set", lambda *_a, **_k: None)
    with patch("backend.routes.stats.get_client") as mock_get_client:
        mock_get_client.return_value.list_buckets.return_value = {"Buckets": []}
        stats.get_stats(EndpointInfo(url="https://x:1", region=None))
        stats.get_stats(EndpointInfo(url="https://x:1", region=None, ca_bundle="/ca.pem"))
    assert seen[0] != seen[1]


class TestMissingAwsEmulatorFolder:
    URL = "https://127.0.0.1:9297"
    NO_CREDENTIALS = {"kind": "credentials", "message": "StackPort has no credentials to sign requests to this endpoint.", "hint": "generic"}

    def test_hint_points_at_the_folder(self, tmp_path, monkeypatch):
        monkeypatch.setattr(stats.aws_emulator.config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
        problem = stats._explain_aws_emulator_problem(EndpointInfo(url=self.URL, region=None), self.NO_CREDENTIALS)
        assert "can't find that folder" in problem["hint"]
        assert problem["message"] == self.NO_CREDENTIALS["message"]

    def test_left_alone_when_the_folder_exists(self, tmp_path, monkeypatch):
        (tmp_path / "emulator" / "9297").mkdir(parents=True)
        monkeypatch.setattr(stats.aws_emulator.config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
        assert stats._explain_aws_emulator_problem(EndpointInfo(url=self.URL, region=None), self.NO_CREDENTIALS) == self.NO_CREDENTIALS

    def test_left_alone_for_endpoints_configured_by_hand(self, tmp_path, monkeypatch):
        monkeypatch.setattr(stats.aws_emulator.config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
        ep = EndpointInfo(url=self.URL, region=None, ca_bundle="/ca.pem")
        assert stats._explain_aws_emulator_problem(ep, self.NO_CREDENTIALS) == self.NO_CREDENTIALS

    def test_left_alone_for_a_plain_http_emulator(self):
        ep = EndpointInfo(url="http://localhost:4566", region=None)
        assert stats._explain_aws_emulator_problem(ep, self.NO_CREDENTIALS) == self.NO_CREDENTIALS

    def test_left_alone_when_the_server_isnt_tls(self, tmp_path, monkeypatch):
        monkeypatch.setattr(stats.aws_emulator.config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
        not_tls = {"kind": "tls", "message": "The endpoint didn't answer with TLS.", "hint": "use http"}
        assert stats._explain_aws_emulator_problem(EndpointInfo(url=self.URL, region=None), not_tls) == not_tls


class TestWhenNotToSkip:
    def test_real_aws_keeps_probing_other_services(self, monkeypatch):
        # A region without SES: its own host doesn't exist, the others are fine.
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "ses,s3")
        monkeypatch.setattr(stats, "STACKPORT_PROBE_WORKERS", 1)

        def client(service, **_kwargs):
            fake = MagicMock()
            if service == "ses":
                fake.list_identities.side_effect = EndpointConnectionError(endpoint_url="https://email.ap-east-1.amazonaws.com")
            else:
                fake.list_buckets.return_value = {"Buckets": [{}]}
            return fake

        with patch("backend.routes.stats.get_client", side_effect=client):
            result = collect_stats(EndpointInfo(url=None, region="ap-east-1"))
        assert result["services"]["s3"]["status"] == "available"
        assert result["problem"] is None

    def test_credentials_errors_dont_cancel_other_services(self, monkeypatch):
        monkeypatch.setattr(stats, "STACKPORT_SERVICES", "s3,sqs")
        monkeypatch.setattr(stats, "STACKPORT_PROBE_WORKERS", 1)
        with patch("backend.routes.stats.get_client") as mock_get_client:
            mock_get_client.return_value.list_buckets.side_effect = rejected()
            mock_get_client.return_value.list_queues.return_value = {"QueueUrls": ["q"]}
            result = collect_stats(EndpointInfo(url="http://localhost:4566", region=None))
        assert result["services"]["sqs"]["status"] == "available"


def test_aws_emulator_ca_that_doesnt_verify(tmp_path, monkeypatch):
    # The folder is there and StackPort trusts its ca.pem, yet the certificate failed:
    # a CA bundle won't help, restarting will.
    run = tmp_path / "emulator" / "9297"
    run.mkdir(parents=True)
    (run / "ca.pem").write_text("cert")
    monkeypatch.setattr(stats.aws_emulator.config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
    untrusted = {"kind": "tls", "message": "StackPort doesn't trust the endpoint's TLS certificate.", "hint": "set a CA bundle"}
    problem = stats._explain_aws_emulator_problem(EndpointInfo(url="https://127.0.0.1:9297", region=None), untrusted)
    assert "Restart the emulator" in problem["hint"]
    assert "CA bundle" not in problem["hint"]
