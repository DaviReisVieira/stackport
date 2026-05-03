from unittest.mock import patch

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
