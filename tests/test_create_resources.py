"""Tests for creating buckets (#153) and tables (#154) from the console."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas.s3 import validate_bucket_name


@pytest.fixture
def client():
    return TestClient(app)


def _client_error(code: str, operation: str = "CreateBucket") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, operation)


class TestBucketNameRules:
    """https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html"""

    @pytest.mark.parametrize(
        "name",
        ["abc", "stackport-learn-k3xz", "my.example.s3.bucket", "a" * 63, "bucket123"],
    )
    def test_valid_names(self, name):
        assert validate_bucket_name(name) == name

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("ab", "between 3 and 63"),
            ("a" * 64, "between 3 and 63"),
            ("AmznS3DemoBucket", "lowercase"),
            ("has_underscore", "lowercase"),
            ("-starts-with-hyphen", "lowercase"),
            ("ends-with-hyphen-", "lowercase"),
            ("example..com", "two adjacent periods"),
            ("192.168.5.4", "IP address"),
            ("xn--puny", "reserved prefix 'xn--'"),
            ("sthree-bucket", "reserved prefix 'sthree-'"),
            ("amzn-s3-demo-bucket", "reserved prefix 'amzn-s3-demo-'"),
            ("bucket-s3alias", "reserved suffix '-s3alias'"),
            ("bucket--ol-s3", "reserved suffix '--ol-s3'"),
            ("bucket.mrap", "reserved suffix '.mrap'"),
            ("bucket--x-s3", "reserved suffix '--x-s3'"),
            ("bucket--table-s3", "reserved suffix '--table-s3'"),
        ],
    )
    def test_invalid_names_name_the_rule(self, name, expected):
        with pytest.raises(ValueError, match=expected):
            validate_bucket_name(name)


class TestCreateBucket:
    @patch("backend.routes.s3.get_client")
    def test_us_east_1_omits_location_constraint(self, mock_client, client):
        s3 = MagicMock()
        mock_client.return_value = s3

        response = client.post("/api/s3/buckets", json={"name": "learn-bucket", "region": "us-east-1"})
        assert response.status_code == 201
        s3.create_bucket.assert_called_once_with(Bucket="learn-bucket")

    @patch("backend.routes.s3.get_client")
    def test_other_region_sends_location_constraint(self, mock_client, client):
        s3 = MagicMock()
        mock_client.return_value = s3

        response = client.post("/api/s3/buckets", json={"name": "learn-bucket", "region": "eu-west-1"})
        assert response.status_code == 201
        s3.create_bucket.assert_called_once_with(
            Bucket="learn-bucket", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"}
        )

    @patch("backend.routes.s3.get_client")
    def test_versioning_and_tags_are_applied(self, mock_client, client):
        s3 = MagicMock()
        mock_client.return_value = s3

        response = client.post(
            "/api/s3/buckets",
            json={"name": "learn-bucket", "versioning": True, "tags": {"env": "learn"}},
        )
        assert response.status_code == 201
        s3.put_bucket_versioning.assert_called_once_with(
            Bucket="learn-bucket", VersioningConfiguration={"Status": "Enabled"}
        )
        s3.put_bucket_tagging.assert_called_once_with(
            Bucket="learn-bucket", Tagging={"TagSet": [{"Key": "env", "Value": "learn"}]}
        )

    @patch("backend.routes.s3.get_client")
    def test_no_versioning_or_tags_by_default(self, mock_client, client):
        s3 = MagicMock()
        mock_client.return_value = s3

        assert client.post("/api/s3/buckets", json={"name": "learn-bucket"}).status_code == 201
        s3.put_bucket_versioning.assert_not_called()
        s3.put_bucket_tagging.assert_not_called()

    @patch("backend.routes.s3.get_client")
    def test_duplicate_is_409(self, mock_client, client):
        s3 = MagicMock()
        s3.create_bucket.side_effect = _client_error("BucketAlreadyOwnedByYou")
        mock_client.return_value = s3

        response = client.post("/api/s3/buckets", json={"name": "learn-bucket"})
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    @patch("backend.routes.s3.get_client")
    def test_bucket_survives_a_failed_versioning_call(self, mock_client, client):
        s3 = MagicMock()
        s3.put_bucket_versioning.side_effect = _client_error("NotImplemented", "PutBucketVersioning")
        mock_client.return_value = s3

        # the bucket exists, so creation is still a success
        assert client.post("/api/s3/buckets", json={"name": "learn-bucket", "versioning": True}).status_code == 201

    def test_invalid_name_is_422_with_the_rule(self, client):
        response = client.post("/api/s3/buckets", json={"name": "Invalid_Name"})
        assert response.status_code == 422
        assert "lowercase" in str(response.json())


class TestCreateTable:
    @patch("backend.routes.dynamodb.get_client")
    def test_partition_key_only_on_demand(self, mock_client, client):
        ddb = MagicMock()
        ddb.create_table.return_value = {"TableDescription": {"TableStatus": "ACTIVE"}}
        mock_client.return_value = ddb

        response = client.post(
            "/api/dynamodb/tables",
            json={"name": "learn-orders", "partitionKey": {"name": "orderId", "type": "S"}},
        )
        assert response.status_code == 201
        assert response.json()["billingMode"] == "PAY_PER_REQUEST"

        kwargs = ddb.create_table.call_args.kwargs
        assert kwargs["AttributeDefinitions"] == [{"AttributeName": "orderId", "AttributeType": "S"}]
        assert kwargs["KeySchema"] == [{"AttributeName": "orderId", "KeyType": "HASH"}]
        assert kwargs["BillingMode"] == "PAY_PER_REQUEST"
        assert "ProvisionedThroughput" not in kwargs

    @patch("backend.routes.dynamodb.get_client")
    def test_partition_and_sort_key_with_types(self, mock_client, client):
        ddb = MagicMock()
        ddb.create_table.return_value = {"TableDescription": {"TableStatus": "CREATING"}}
        mock_client.return_value = ddb

        response = client.post(
            "/api/dynamodb/tables",
            json={
                "name": "learn-events",
                "partitionKey": {"name": "userId", "type": "S"},
                "sortKey": {"name": "ts", "type": "N"},
            },
        )
        assert response.status_code == 201
        assert response.json()["sortKey"] == "ts"

        kwargs = ddb.create_table.call_args.kwargs
        assert kwargs["AttributeDefinitions"] == [
            {"AttributeName": "userId", "AttributeType": "S"},
            {"AttributeName": "ts", "AttributeType": "N"},
        ]
        assert kwargs["KeySchema"] == [
            {"AttributeName": "userId", "KeyType": "HASH"},
            {"AttributeName": "ts", "KeyType": "RANGE"},
        ]

    @patch("backend.routes.dynamodb.get_client")
    def test_provisioned_sends_capacity(self, mock_client, client):
        ddb = MagicMock()
        ddb.create_table.return_value = {"TableDescription": {}}
        mock_client.return_value = ddb

        response = client.post(
            "/api/dynamodb/tables",
            json={
                "name": "learn-provisioned",
                "partitionKey": {"name": "id", "type": "S"},
                "billingMode": "PROVISIONED",
                "readCapacity": 10,
                "writeCapacity": 3,
            },
        )
        assert response.status_code == 201
        kwargs = ddb.create_table.call_args.kwargs
        assert kwargs["BillingMode"] == "PROVISIONED"
        assert kwargs["ProvisionedThroughput"] == {"ReadCapacityUnits": 10, "WriteCapacityUnits": 3}

    @patch("backend.routes.dynamodb.get_client")
    def test_sort_key_equal_to_partition_key_is_400(self, mock_client, client):
        mock_client.return_value = MagicMock()
        response = client.post(
            "/api/dynamodb/tables",
            json={
                "name": "learn-bad",
                "partitionKey": {"name": "id", "type": "S"},
                "sortKey": {"name": "id", "type": "S"},
            },
        )
        assert response.status_code == 400
        assert "differ" in response.json()["detail"]

    @patch("backend.routes.dynamodb.get_client")
    def test_existing_table_is_409(self, mock_client, client):
        ddb = MagicMock()
        ddb.create_table.side_effect = _client_error("ResourceInUseException", "CreateTable")
        mock_client.return_value = ddb

        response = client.post(
            "/api/dynamodb/tables", json={"name": "learn-orders", "partitionKey": {"name": "id"}}
        )
        assert response.status_code == 409

    def test_invalid_key_type_is_422(self, client):
        response = client.post(
            "/api/dynamodb/tables",
            json={"name": "learn-bad", "partitionKey": {"name": "id", "type": "X"}},
        )
        assert response.status_code == 422


class TestReadOnlyMode:
    @patch("backend.main.STACKPORT_ALLOW_WRITES", False)
    def test_creates_blocked_when_writes_disabled(self, client):
        assert client.post("/api/s3/buckets", json={"name": "learn-bucket"}).status_code == 403
        assert (
            client.post("/api/dynamodb/tables", json={"name": "t", "partitionKey": {"name": "id"}}).status_code
            == 403
        )
