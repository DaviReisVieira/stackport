"""Where Try it sends a request: each emulator's address formats, and AWS's.

The expected addresses are the ones each emulator answered when tried by hand
(see the module docstring of backend.invoke_urls for where each comes from).
"""

from urllib.parse import urlsplit

import pytest

from backend.emulators import DETECTORS
from backend.invoke_urls import (
    FORMATS,
    InvokeTarget,
    NoInvokeAddress,
    TargetKind,
    aws_target,
    emulator_target,
    function_url_id,
)

REGION = "us-east-1"
NAMES = {detector.id: detector.name for detector in DETECTORS}


def emulator(emulator_id: str) -> dict:
    return {"id": emulator_id, "name": NAMES[emulator_id], "version": None}


def target(endpoint: str, emulator_id: str, kind: TargetKind, **ids) -> InvokeTarget:
    return emulator_target(endpoint, emulator(emulator_id), kind, region=REGION, **ids)


def test_every_recognised_emulator_has_an_entry():
    assert set(FORMATS) == set(NAMES)


class TestRestStages:
    @pytest.mark.parametrize(
        ("emulator_id", "endpoint", "url"),
        [
            ("aws-emulator", "https://127.0.0.1:9631", "https://127.0.0.1:9631/_aws/execute-api/a1b2c3d4e5/dev"),
            ("ministack", "http://localhost:4631", "http://localhost:4631/_aws/execute-api/a1b2c3d4e5/dev"),
            ("floci", "http://localhost:4632", "http://localhost:4632/_aws/execute-api/a1b2c3d4e5/dev"),
            ("localstack", "http://localhost:4633", "http://localhost:4633/_aws/execute-api/a1b2c3d4e5/dev"),
        ],
    )
    def test_on_the_endpoints_own_address(self, emulator_id, endpoint, url):
        found = target(endpoint, emulator_id, TargetKind.REST_STAGE, api_id="a1b2c3d4e5", stage="dev")

        assert found.url == url
        parts = urlsplit(endpoint)
        assert (found.connect_host, found.connect_port, found.host) == (parts.hostname, parts.port, parts.netloc)

    def test_moto_serves_none(self):
        with pytest.raises(NoInvokeAddress, match="^Moto doesn't serve REST API stages over HTTP"):
            target("http://localhost:5000", "moto", TargetKind.REST_STAGE, api_id="a1", stage="dev")

    def test_an_unrecognised_endpoint_is_said_plainly(self):
        with pytest.raises(NoInvokeAddress, match="couldn't tell which emulator answers at http://localhost:9000"):
            emulator_target("http://localhost:9000", None, TargetKind.REST_STAGE, region=REGION, api_id="a1", stage="dev")

    def test_keeps_the_endpoints_path_and_default_port(self):
        found = target("http://proxy.internal/emulator/", "ministack", TargetKind.REST_STAGE, api_id="a1", stage="dev")

        assert found.url == "http://proxy.internal/emulator/_aws/execute-api/a1/dev"
        assert (found.connect_host, found.connect_port) == ("proxy.internal", 80)

    def test_ipv6_endpoint(self):
        found = target("http://[::1]:4631", "ministack", TargetKind.REST_STAGE, api_id="a1", stage="dev")

        assert found.url == "http://[::1]:4631/_aws/execute-api/a1/dev"
        assert (found.connect_host, found.host) == ("::1", "[::1]:4631")

    def test_ids_cannot_add_path_segments(self):
        found = target("http://localhost:4631", "ministack", TargetKind.REST_STAGE, api_id="a/../b", stage="d?x#y")

        assert found.base_path == "/_aws/execute-api/a%2F..%2Fb/d%3Fx%23y"

    @pytest.mark.parametrize("ids", [{"api_id": "..", "stage": "dev"}, {"api_id": "a1", "stage": "."}])
    def test_dot_segments_are_refused(self, ids):
        with pytest.raises(NoInvokeAddress, match="can't be . or .."):
            target("http://localhost:4631", "ministack", TargetKind.REST_STAGE, **ids)


class TestHttpStages:
    @pytest.mark.parametrize("emulator_id", ["aws-emulator", "ministack", "floci"])
    @pytest.mark.parametrize("stage", ["$default", "beta"])
    def test_the_stage_is_named_in_the_path(self, emulator_id, stage):
        found = target("http://localhost:4566", emulator_id, TargetKind.HTTP_STAGE, api_id="h1", stage=stage)

        assert found.url == f"http://localhost:4566/_aws/execute-api/h1/{stage}"

    def test_localstack_names_the_api_in_the_host(self):
        named = target("http://localhost:4633", "localstack", TargetKind.HTTP_STAGE, api_id="H1abc", stage="beta")
        default = target("http://localhost:4633", "localstack", TargetKind.HTTP_STAGE, api_id="h1abc", stage="$default")

        assert named.url == "http://h1abc.execute-api.localhost.localstack.cloud:4633/beta"
        assert (named.connect_host, named.connect_port) == ("localhost", 4633)
        assert default.url == "http://h1abc.execute-api.localhost.localstack.cloud:4633"
        assert default.base_path == ""

    def test_an_id_that_isnt_a_host_label_is_refused(self):
        with pytest.raises(NoInvokeAddress, match="can't be part of a host name"):
            target("http://localhost:4633", "localstack", TargetKind.HTTP_STAGE, api_id="h1.evil.example", stage="beta")


class TestFunctionUrls:
    @pytest.mark.parametrize(
        ("emulator_id", "url"),
        [
            ("aws-emulator", "https://127.0.0.1:9631/_aws/lambda-url/6e1439f9"),
            ("ministack", "https://127.0.0.1:9631/_aws/lambda-url/6e1439f9"),
            ("floci", "https://127.0.0.1:9631/lambda-url/6e1439f9"),
        ],
    )
    def test_by_path(self, emulator_id, url):
        found = target("https://127.0.0.1:9631", emulator_id, TargetKind.FUNCTION_URL, url_id="6e1439f9")

        assert found.url == url
        assert found.host == "127.0.0.1:9631"

    def test_localstack_by_host(self):
        found = target("http://127.0.0.1:4633", "localstack", TargetKind.FUNCTION_URL, url_id="eihmdnnc9p")

        assert found.url == "http://eihmdnnc9p.lambda-url.us-east-1.localhost.localstack.cloud:4633"
        assert (found.connect_host, found.connect_port, found.base_path) == ("127.0.0.1", 4633, "")

    @pytest.mark.parametrize(
        ("function_url", "url_id"),
        [
            # AWS Emulator announces its own endpoint.
            ("https://127.0.0.1:9631/_aws/lambda-url/6e1439f900e347b8aafd130f057014b4/", "6e1439f900e347b8aafd130f057014b4"),
            # MiniStack keeps AWS's shape.
            ("https://ceda90d3-d9c5-44d9-b3fc-5c6e070a115f.lambda-url.us-east-1.on.aws/", "ceda90d3-d9c5-44d9-b3fc-5c6e070a115f"),
            # Floci and LocalStack put the address they were reached at after the region.
            ("http://5d7f606e.lambda-url.us-east-1.localhost:4566/", "5d7f606e"),
            ("http://eihmdnnc9p.lambda-url.us-east-1.localhost.localstack.cloud:4566/", "eihmdnnc9p"),
            ("https://abc.execute-api.us-east-1.amazonaws.com/", None),
            ("not a url", None),
        ],
    )
    def test_reads_the_id_in_the_url_an_endpoint_returned(self, function_url, url_id):
        assert function_url_id(function_url) == url_id


class TestAws:
    def test_rest_stage(self):
        found = aws_target(TargetKind.REST_STAGE, region="eu-west-3", api_id="a1b2c3d4e5", stage="prod")

        assert found.url == "https://a1b2c3d4e5.execute-api.eu-west-3.amazonaws.com/prod"
        assert (found.connect_host, found.connect_port) == ("a1b2c3d4e5.execute-api.eu-west-3.amazonaws.com", 443)

    def test_china_regions_use_their_own_domain(self):
        found = aws_target(TargetKind.REST_STAGE, region="cn-north-1", api_id="a1b2c3d4e5", stage="prod")

        assert found.host == "a1b2c3d4e5.execute-api.cn-north-1.amazonaws.com.cn"

    def test_http_default_stage_is_the_root(self):
        default = aws_target(TargetKind.HTTP_STAGE, region=REGION, api_id="h1b2c3d4e5", stage="$default")
        named = aws_target(TargetKind.HTTP_STAGE, region=REGION, api_id="h1b2c3d4e5", stage="beta")

        assert default.url == "https://h1b2c3d4e5.execute-api.us-east-1.amazonaws.com"
        assert named.url == "https://h1b2c3d4e5.execute-api.us-east-1.amazonaws.com/beta"

    def test_function_url_as_aws_returned_it(self):
        found = aws_target(
            TargetKind.FUNCTION_URL, region=REGION, function_url="https://abcdefghij0123.lambda-url.us-east-1.on.aws/"
        )

        assert found.url == "https://abcdefghij0123.lambda-url.us-east-1.on.aws"
        assert (found.connect_host, found.connect_port) == ("abcdefghij0123.lambda-url.us-east-1.on.aws", 443)

    @pytest.mark.parametrize(
        "function_url",
        [
            "https://abc.lambda-url.us-east-1.on.aws.evil.example/",
            "https://abc.lambda-url.eu-west-1.on.aws/",
            "https://evil.example/_aws/lambda-url/abc/",
            "https://abc.lambda-url.us-east-1.on.aws@evil.example/",
        ],
    )
    def test_any_other_function_url_is_refused(self, function_url):
        with pytest.raises(NoInvokeAddress, match="doesn't recognise"):
            aws_target(TargetKind.FUNCTION_URL, region=REGION, function_url=function_url)

    @pytest.mark.parametrize("api_id", ["a1.evil.example", "a1/x", "a1:443", ""])
    def test_an_api_id_has_to_be_a_host_label(self, api_id):
        with pytest.raises(NoInvokeAddress):
            aws_target(TargetKind.REST_STAGE, region=REGION, api_id=api_id, stage="prod")

    @pytest.mark.parametrize("region", ["us-east-1.evil.example", "evil.example/x", "xx-nowhere-1"])
    def test_a_region_outside_aws_is_refused(self, region):
        with pytest.raises(NoInvokeAddress):
            aws_target(TargetKind.REST_STAGE, region=region, api_id="a1b2c3d4e5", stage="prod")
