from unittest.mock import patch

from botocore.config import Config

from backend.aws_client import get_client


class TestGetClient:
    def test_returns_boto3_client(self):
        client = get_client("s3")
        assert hasattr(client, "list_buckets")

    def test_lru_cache_returns_same_instance(self):
        c1 = get_client("s3")
        c2 = get_client("s3")
        assert c1 is c2

    def test_different_services_return_different_clients(self):
        s3 = get_client("s3")
        sqs = get_client("sqs")
        assert s3 is not sqs

    def test_per_endpoint_region_used(self):
        """Test that get_client uses per-endpoint region when passed."""
        get_client.cache_clear()
        client = get_client("s3", "http://localhost:4566", region="eu-west-1")
        assert client.meta.region_name == "eu-west-1"
        get_client.cache_clear()

    def test_falls_back_to_global_region(self):
        """Test that get_client falls back to AWS_REGION when no region passed."""
        get_client.cache_clear()
        client = get_client("s3", "http://localhost:4566", region=None)
        from backend.config import AWS_REGION
        assert client.meta.region_name == AWS_REGION
        get_client.cache_clear()


class TestClientConfig:
    """A per-call config is applied on top of the defaults, local or not."""

    def setup_method(self):
        get_client.cache_clear()

    def teardown_method(self):
        get_client.cache_clear()

    def test_override_applies_on_real_aws(self):
        override = Config(retries={"mode": "standard", "total_max_attempts": 1}, read_timeout=300)

        client = get_client("bedrock-runtime", endpoint_url=None, client_config=override)

        assert client.meta.config.read_timeout == 300
        assert client.meta.config.retries["total_max_attempts"] == 1

    def test_override_keeps_the_local_emulator_options(self):
        override = Config(retries={"mode": "standard", "total_max_attempts": 1}, read_timeout=300)

        client = get_client("bedrock-runtime", "http://localhost:4566", client_config=override)

        assert client.meta.config.read_timeout == 300
        assert client.meta.config.inject_host_prefix is False

    def test_default_client_still_retries_on_real_aws(self):
        client = get_client("bedrock-runtime", endpoint_url=None)

        assert client.meta.config.read_timeout == 60
        assert client.meta.config.retries.get("total_max_attempts", 5) != 1

    def test_the_same_config_object_reuses_the_cached_client(self):
        override = Config(read_timeout=300)

        first = get_client("bedrock-runtime", "http://localhost:4566", client_config=override)
        second = get_client("bedrock-runtime", "http://localhost:4566", client_config=override)

        assert first is second
