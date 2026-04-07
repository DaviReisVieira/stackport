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
