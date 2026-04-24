"""Tests for tag management and bulk operation routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _mock_get_client(service, *args, **kwargs):
    return MagicMock()


# --- GET tags ---


class TestGetResourceTags:
    @patch("backend.routes.tags.get_client")
    def test_get_s3_bucket_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {
            "TagSet": [{"Key": "env", "Value": "dev"}, {"Key": "team", "Value": "backend"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/s3/buckets/my-bucket")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tags"] == {"env": "dev", "team": "backend"}
        assert data["service"] == "s3"
        assert data["type"] == "buckets"
        assert data["id"] == "my-bucket"

    @patch("backend.routes.tags.get_client")
    def test_get_s3_bucket_tags_empty(self, mock_gc):
        mock_client = MagicMock()
        from botocore.exceptions import ClientError

        mock_client.exceptions.ClientError = ClientError
        mock_client.get_bucket_tagging.side_effect = ClientError(
            {"Error": {"Code": "NoSuchTagSet", "Message": ""}}, "GetBucketTagging"
        )
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/s3/buckets/my-bucket")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {}

    @patch("backend.routes.tags.get_client")
    def test_get_lambda_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_function.return_value = {
            "Tags": {"project": "stackport", "version": "1.0"}
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/lambda/functions/my-func")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"project": "stackport", "version": "1.0"}

    @patch("backend.routes.tags.get_client")
    def test_get_dynamodb_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_table.return_value = {
            "Table": {"TableArn": "arn:aws:dynamodb:us-east-1:000:table/t1"}
        }
        mock_client.list_tags_of_resource.return_value = {
            "Tags": [{"Key": "env", "Value": "prod"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/dynamodb/tables/t1")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "prod"}

    @patch("backend.routes.tags.get_client")
    def test_get_sqs_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_queue_url.return_value = {"QueueUrl": "http://localhost:4566/q1"}
        mock_client.list_queue_tags.return_value = {"Tags": {"owner": "alice"}}
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/sqs/queues/q1")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"owner": "alice"}

    @patch("backend.routes.tags.get_client")
    def test_get_ec2_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_tags.return_value = {
            "Tags": [{"Key": "Name", "Value": "web-server"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/ec2/instances/i-123")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"Name": "web-server"}

    @patch("backend.routes.tags.get_client")
    def test_get_iam_user_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_user_tags.return_value = {
            "Tags": [{"Key": "dept", "Value": "eng"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/iam/users/alice")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"dept": "eng"}

    @patch("backend.routes.tags.get_client")
    def test_get_iam_role_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_role_tags.return_value = {
            "Tags": [{"Key": "env", "Value": "staging"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/iam/roles/my-role")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "staging"}

    @patch("backend.routes.tags.get_client")
    def test_get_secretsmanager_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_secret.return_value = {
            "Tags": [{"Key": "app", "Value": "web"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/secretsmanager/secrets/my-secret")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"app": "web"}

    @patch("backend.routes.tags.get_client")
    def test_get_logs_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {
            "tags": {"retention": "30d"}
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/logs/log_groups/arn:aws:logs:us-east-1:000:log-group:my-group")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"retention": "30d"}

    @patch("backend.routes.tags.get_client")
    def test_get_iam_policy_tags_with_arn(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_policy_tags.return_value = {
            "Tags": [{"Key": "managed", "Value": "true"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/iam/policies/arn:aws:iam::000000000000:policy/my-policy")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"managed": "true"}
        assert resp.json()["id"] == "arn:aws:iam::000000000000:policy/my-policy"

    @patch("backend.routes.tags.get_client")
    def test_get_rds_db_instance_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_db_instances.return_value = {
            "DBInstances": [{"DBInstanceArn": "arn:aws:rds:us-east-1:000:db:mydb"}]
        }
        mock_client.list_tags_for_resource.return_value = {
            "TagList": [{"Key": "env", "Value": "prod"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/rds/db_instances/mydb")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "prod"}
        mock_client.list_tags_for_resource.assert_called_once_with(
            ResourceName="arn:aws:rds:us-east-1:000:db:mydb"
        )

    @patch("backend.routes.tags.get_client")
    def test_get_rds_db_cluster_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_db_clusters.return_value = {
            "DBClusters": [{"DBClusterArn": "arn:aws:rds:us-east-1:000:cluster:mycluster"}]
        }
        mock_client.list_tags_for_resource.return_value = {
            "TagList": [{"Key": "team", "Value": "data"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/rds/db_clusters/mycluster")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"team": "data"}

    @patch("backend.routes.tags.get_client")
    def test_get_sns_topic_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {
            "Tags": [{"Key": "app", "Value": "notifications"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/sns/topics/arn:aws:sns:us-east-1:000:my-topic")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"app": "notifications"}
        assert resp.json()["id"] == "arn:aws:sns:us-east-1:000:my-topic"

    @patch("backend.routes.tags.get_client")
    def test_get_kms_key_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_resource_tags.return_value = {
            "Tags": [{"TagKey": "purpose", "TagValue": "encryption"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/kms/keys/key-id-123")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"purpose": "encryption"}

    @patch("backend.routes.tags.get_client")
    def test_get_ecr_repository_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_repositories.return_value = {
            "repositories": [{"repositoryArn": "arn:aws:ecr:us-east-1:000:repository/my-repo"}]
        }
        mock_client.list_tags_for_resource.return_value = {
            "tags": [{"Key": "team", "Value": "platform"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/ecr/repositories/my-repo")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"team": "platform"}

    @patch("backend.routes.tags.get_client")
    def test_get_cloudformation_stack_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_stacks.return_value = {
            "Stacks": [{"Tags": [{"Key": "env", "Value": "staging"}]}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/cloudformation/stacks/my-stack")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "staging"}

    @patch("backend.routes.tags.get_client")
    def test_get_stepfunctions_state_machine_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {
            "tags": [{"key": "workflow", "value": "orders"}]
        }
        mock_gc.return_value = mock_client

        arn = "arn:aws:states:us-east-1:000:stateMachine:my-sm"
        resp = client.get(f"/api/tags/stepfunctions/state_machines/{arn}")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"workflow": "orders"}
        assert resp.json()["id"] == arn

    @patch("backend.routes.tags.get_client")
    def test_get_kinesis_stream_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_stream.return_value = {
            "Tags": [{"Key": "team", "Value": "data"}],
            "HasMoreTags": False,
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/kinesis/streams/my-stream")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"team": "data"}

    @patch("backend.routes.tags.get_client")
    def test_get_ssm_parameter_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {
            "TagList": [{"Key": "env", "Value": "dev"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/ssm/parameters/my-param")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "dev"}
        mock_client.list_tags_for_resource.assert_called_once_with(
            ResourceType="Parameter", ResourceId="my-param"
        )

    @patch("backend.routes.tags.get_client")
    def test_get_elbv2_load_balancer_tags(self, mock_gc):
        mock_client = MagicMock()
        arn = "arn:aws:elasticloadbalancing:us-east-1:000:loadbalancer/app/my-lb/abc123"
        mock_client.describe_tags.return_value = {
            "TagDescriptions": [
                {"ResourceArn": arn, "Tags": [{"Key": "env", "Value": "prod"}]}
            ]
        }
        mock_gc.return_value = mock_client

        resp = client.get(f"/api/tags/elasticloadbalancing/load_balancers/{arn}")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"env": "prod"}
        assert resp.json()["id"] == arn

    @patch("backend.routes.tags.get_client")
    def test_get_elasticache_cluster_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_cache_clusters.return_value = {
            "CacheClusters": [{"ARN": "arn:aws:elasticache:us-east-1:000:cluster:my-cache"}]
        }
        mock_client.list_tags_for_resource.return_value = {
            "TagList": [{"Key": "cost-center", "Value": "eng"}]
        }
        mock_gc.return_value = mock_client

        resp = client.get("/api/tags/elasticache/cache_clusters/my-cache")
        assert resp.status_code == 200
        assert resp.json()["tags"] == {"cost-center": "eng"}

    def test_get_unsupported_service_returns_400(self):
        resp = client.get("/api/tags/unknown/things/id1")
        assert resp.status_code == 400
        assert "not supported" in resp.json()["detail"].lower()


# --- GET /tags/supported ---


class TestTagsSupported:
    def test_returns_all_supported_types(self):
        resp = client.get("/api/tags/supported")
        assert resp.status_code == 200
        data = resp.json()
        supported = data["supported"]
        assert len(supported) == 21

        keys = {(s["service"], s["type"]) for s in supported}
        assert ("s3", "buckets") in keys
        assert ("sqs", "queues") in keys
        assert ("lambda", "functions") in keys
        assert ("dynamodb", "tables") in keys
        assert ("secretsmanager", "secrets") in keys
        assert ("logs", "log_groups") in keys
        assert ("ec2", "instances") in keys
        assert ("iam", "users") in keys
        assert ("iam", "roles") in keys
        assert ("iam", "policies") in keys
        assert ("rds", "db_instances") in keys
        assert ("rds", "db_clusters") in keys
        assert ("sns", "topics") in keys
        assert ("kms", "keys") in keys
        assert ("ecr", "repositories") in keys
        assert ("cloudformation", "stacks") in keys
        assert ("stepfunctions", "state_machines") in keys
        assert ("kinesis", "streams") in keys
        assert ("ssm", "parameters") in keys
        assert ("elasticloadbalancing", "load_balancers") in keys
        assert ("elasticache", "cache_clusters") in keys

    def test_writable_flag(self):
        resp = client.get("/api/tags/supported")
        supported = resp.json()["supported"]
        writable_lookup = {(e["service"], e["type"]): e["writable"] for e in supported}
        assert writable_lookup[("cloudformation", "stacks")] is False
        writable_count = sum(1 for e in supported if e["writable"])
        assert writable_count == 20


# --- PUT tags ---


class TestUpdateResourceTags:
    @patch("backend.routes.tags.get_client")
    def test_put_s3_bucket_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/s3/buckets/my-bucket",
            json={"tags": {"env": "prod", "team": "infra"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["tags"] == {"env": "prod", "team": "infra"}
        mock_client.put_bucket_tagging.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_s3_bucket_tags_empty_deletes(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/s3/buckets/my-bucket",
            json={"tags": {}},
        )
        assert resp.status_code == 200
        mock_client.delete_bucket_tagging.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_lambda_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_function.return_value = {
            "Configuration": {"FunctionArn": "arn:aws:lambda:us-east-1:000:function:f1"},
            "Tags": {"old": "tag"},
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/lambda/functions/f1",
            json={"tags": {"new": "tag"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.untag_resource.assert_called_once()
        mock_client.tag_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_ec2_instance_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_tags.return_value = {
            "Tags": [{"Key": "Name", "Value": "old"}]
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/ec2/instances/i-123",
            json={"tags": {"Name": "new-server"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.delete_tags.assert_called_once()
        mock_client.create_tags.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_iam_role_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_role_tags.return_value = {"Tags": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/iam/roles/my-role",
            json={"tags": {"env": "prod"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_role.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_rds_db_instance_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_db_instances.return_value = {
            "DBInstances": [{"DBInstanceArn": "arn:aws:rds:us-east-1:000:db:mydb"}]
        }
        mock_client.list_tags_for_resource.return_value = {
            "TagList": [{"Key": "old", "Value": "tag"}]
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/rds/db_instances/mydb",
            json={"tags": {"env": "prod"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.remove_tags_from_resource.assert_called_once()
        mock_client.add_tags_to_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_sns_topic_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {"Tags": []}
        mock_gc.return_value = mock_client

        arn = "arn:aws:sns:us-east-1:000:my-topic"
        resp = client.put(
            f"/api/tags/sns/topics/{arn}",
            json={"tags": {"app": "alerts"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_kms_key_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_resource_tags.return_value = {"Tags": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/kms/keys/key-123",
            json={"tags": {"purpose": "encrypt"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_resource.assert_called_once_with(
            KeyId="key-123", Tags=[{"TagKey": "purpose", "TagValue": "encrypt"}]
        )

    @patch("backend.routes.tags.get_client")
    def test_put_ecr_repository_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_repositories.return_value = {
            "repositories": [{"repositoryArn": "arn:aws:ecr:us-east-1:000:repository/my-repo"}]
        }
        mock_client.list_tags_for_resource.return_value = {"tags": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/ecr/repositories/my-repo",
            json={"tags": {"team": "platform"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_resource.assert_called_once()

    def test_put_cloudformation_tags_returns_400(self):
        resp = client.put(
            "/api/tags/cloudformation/stacks/my-stack",
            json={"tags": {"env": "prod"}},
        )
        assert resp.status_code == 400

    @patch("backend.routes.tags.get_client")
    def test_put_stepfunctions_state_machine_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {"tags": []}
        mock_gc.return_value = mock_client

        arn = "arn:aws:states:us-east-1:000:stateMachine:my-sm"
        resp = client.put(
            f"/api/tags/stepfunctions/state_machines/{arn}",
            json={"tags": {"workflow": "orders"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.tag_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_kinesis_stream_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_stream.return_value = {"Tags": [], "HasMoreTags": False}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/kinesis/streams/my-stream",
            json={"tags": {"team": "data"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.add_tags_to_stream.assert_called_once_with(
            StreamName="my-stream", Tags={"team": "data"}
        )

    @patch("backend.routes.tags.get_client")
    def test_put_ssm_parameter_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.list_tags_for_resource.return_value = {"TagList": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/ssm/parameters/my-param",
            json={"tags": {"env": "dev"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.add_tags_to_resource.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_elbv2_load_balancer_tags(self, mock_gc):
        mock_client = MagicMock()
        arn = "arn:aws:elasticloadbalancing:us-east-1:000:loadbalancer/app/my-lb/abc123"
        mock_client.describe_tags.return_value = {
            "TagDescriptions": [{"ResourceArn": arn, "Tags": []}]
        }
        mock_gc.return_value = mock_client

        resp = client.put(
            f"/api/tags/elasticloadbalancing/load_balancers/{arn}",
            json={"tags": {"env": "prod"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.add_tags.assert_called_once()

    @patch("backend.routes.tags.get_client")
    def test_put_elasticache_cluster_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.describe_cache_clusters.return_value = {
            "CacheClusters": [{"ARN": "arn:aws:elasticache:us-east-1:000:cluster:my-cache"}]
        }
        mock_client.list_tags_for_resource.return_value = {"TagList": []}
        mock_gc.return_value = mock_client

        resp = client.put(
            "/api/tags/elasticache/cache_clusters/my-cache",
            json={"tags": {"cost-center": "eng"}},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_client.add_tags_to_resource.assert_called_once()

    def test_put_unsupported_service_returns_400(self):
        resp = client.put(
            "/api/tags/unknown/things/id1",
            json={"tags": {"a": "b"}},
        )
        assert resp.status_code == 400

    @patch("backend.routes.tags.get_client")
    def test_put_tags_server_error(self, mock_gc):
        mock_gc.side_effect = Exception("connection refused")

        resp = client.put(
            "/api/tags/s3/buckets/my-bucket",
            json={"tags": {"a": "b"}},
        )
        assert resp.status_code == 500


# --- Bulk tag ---


class TestBulkTag:
    @patch("backend.routes.tags.get_client")
    def test_bulk_add_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {"TagSet": []}
        mock_client.get_function.return_value = {"Tags": {}}
        mock_client.get_function.return_value = {
            "Configuration": {"FunctionArn": "arn:aws:lambda:us-east-1:000:function:f1"},
            "Tags": {},
        }
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {"env": "staging"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "lambda", "type": "functions", "id": "f1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 2
        assert data["failed"] == 0

    @patch("backend.routes.tags.get_client")
    def test_bulk_remove_tags(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {
            "TagSet": [{"Key": "env", "Value": "dev"}, {"Key": "team", "Value": "ops"}]
        }
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "remove",
                "tags": {"env": "dev"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 1

    @patch("backend.routes.tags.get_client")
    def test_bulk_tag_partial_failure(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_bucket_tagging.return_value = {"TagSet": []}
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {"env": "prod"},
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "unknown", "type": "things", "id": "x"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 1
        assert data["failed"] == 1

    def test_bulk_tag_invalid_action(self):
        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "invalid",
                "tags": {"a": "b"},
                "resources": [{"service": "s3", "type": "buckets", "id": "b1"}],
            },
        )
        assert resp.status_code == 400

    def test_bulk_tag_empty_resources(self):
        resp = client.post(
            "/api/bulk/tag",
            json={"action": "add", "tags": {"a": "b"}, "resources": []},
        )
        assert resp.status_code == 400

    def test_bulk_tag_empty_tags(self):
        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {},
                "resources": [{"service": "s3", "type": "buckets", "id": "b1"}],
            },
        )
        assert resp.status_code == 400


# --- Bulk delete ---


class TestBulkDelete:
    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_resources(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                    {"service": "lambda", "type": "functions", "id": "f1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["succeeded"] == 2
        assert data["failed"] == 0

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_partial_failure(self, mock_gc):
        mock_client = MagicMock()
        mock_client.delete_bucket.side_effect = Exception("bucket not empty")
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "s3", "type": "buckets", "id": "bucket1"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert "bucket not empty" in data["results"][0]["error"]

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_unsupported_service(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "iam", "type": "users", "id": "alice"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert "not supported" in data["results"][0]["error"].lower()

    def test_bulk_delete_empty_resources(self):
        resp = client.post("/api/bulk/delete", json={"resources": []})
        assert resp.status_code == 400

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_ec2_instances(self, mock_gc):
        mock_client = MagicMock()
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "ec2", "type": "instances", "id": "i-123"},
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["succeeded"] == 1
        mock_client.terminate_instances.assert_called_once_with(InstanceIds=["i-123"])

    @patch("backend.routes.tags.get_client")
    def test_bulk_delete_sqs_queue(self, mock_gc):
        mock_client = MagicMock()
        mock_client.get_queue_url.return_value = {"QueueUrl": "http://localhost/q1"}
        mock_gc.return_value = mock_client

        resp = client.post(
            "/api/bulk/delete",
            json={
                "resources": [
                    {"service": "sqs", "type": "queues", "id": "q1"},
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["succeeded"] == 1
