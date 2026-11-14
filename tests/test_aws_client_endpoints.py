"""Every client goes where StackPort sends it: the endpoint's URL, or AWS when there is none.

boto3 also takes endpoint URLs from AWS_ENDPOINT_URL_<SERVICE> variables and
from a profile's endpoint_url or services section in the AWS config file. Here
real botocore resolves each client's endpoint from a temporary config file;
nothing is sent.
"""

import os
from urllib.parse import urlsplit

import pytest

from backend.aws_client import get_client
from backend.config import STACKPORT_PROBE_TIMEOUT

ELSEWHERE = "http://127.0.0.1:9"
EMULATOR = "http://127.0.0.1:5397"


@pytest.fixture(autouse=True)
def aws_config(monkeypatch, tmp_path):
    """A temporary AWS config file, and no endpoint settings from the environment the tests run in."""
    for name in list(os.environ):
        if name.startswith("AWS_ENDPOINT_URL") or name in {
            "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS",
            "AWS_PROFILE",
            "AWS_DEFAULT_PROFILE",
        }:
            monkeypatch.delenv(name)
    config_file = tmp_path / "config"
    config_file.write_text("")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(config_file))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    get_client.cache_clear()
    yield config_file
    get_client.cache_clear()


def on_aws(client) -> bool:
    return (urlsplit(client.meta.endpoint_url).hostname or "").endswith(".amazonaws.com")


PROFILE_ENDPOINTS = f"""\
[default]
endpoint_url = {ELSEWHERE}

[profile dev]
aws_access_key_id = AKIDDEVPROFILE
aws_secret_access_key = dev-secret
endpoint_url = {ELSEWHERE}
services = dev-endpoints

[services dev-endpoints]
s3 =
  endpoint_url = {ELSEWHERE}
"""

SERVICES_SECTION = f"""\
[default]
services = elsewhere

[services elsewhere]
s3 =
  endpoint_url = {ELSEWHERE}
sqs =
  endpoint_url = {ELSEWHERE}
"""


class TestRealAws:
    @pytest.mark.parametrize("variable", ["AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL"])
    def test_ignores_endpoint_variables(self, monkeypatch, variable):
        monkeypatch.setenv(variable, ELSEWHERE)

        assert on_aws(get_client("s3", endpoint_url=None))
        assert on_aws(get_client("sqs", endpoint_url=None))

    def test_ignores_the_default_profiles_endpoint_url(self, aws_config):
        aws_config.write_text(PROFILE_ENDPOINTS)

        assert on_aws(get_client("sqs", endpoint_url=None))

    def test_ignores_a_services_section(self, aws_config):
        aws_config.write_text(SERVICES_SECTION)

        assert on_aws(get_client("s3", endpoint_url=None))
        assert on_aws(get_client("sqs", endpoint_url=None))

    @pytest.mark.parametrize("service", ["s3", "sqs"])
    def test_an_endpoint_profile_gives_its_credentials_and_not_its_endpoints(self, aws_config, service):
        aws_config.write_text(PROFILE_ENDPOINTS)

        client = get_client(service, endpoint_url=None, auth_type="profile", auth_profile="dev")

        assert on_aws(client)
        # Signing needs no network, and a presigned URL shows the key it was signed with.
        operation = "list_buckets" if service == "s3" else "list_queues"
        assert "AKIDDEVPROFILE" in client.generate_presigned_url(operation)


class TestLocalEndpoint:
    def test_uses_its_own_url_over_every_configured_one(self, monkeypatch, aws_config):
        monkeypatch.setenv("AWS_ENDPOINT_URL_S3", ELSEWHERE)
        aws_config.write_text(PROFILE_ENDPOINTS)

        assert get_client("s3", endpoint_url=EMULATOR).meta.endpoint_url == EMULATOR
        profile_client = get_client("s3", endpoint_url=EMULATOR, auth_type="profile", auth_profile="dev")
        assert profile_client.meta.endpoint_url == EMULATOR

    def test_keeps_the_options_for_local_emulators(self):
        config = get_client("s3", endpoint_url=EMULATOR).meta.config

        assert config.inject_host_prefix is False
        assert config.connect_timeout == STACKPORT_PROBE_TIMEOUT
        assert config.retries == {"mode": "standard", "total_max_attempts": 1}
