"""Tag round-trips for every taggable type, against moto.

Each type is seeded in moto and tagged through the routes under every
identifier the console hands out for it: the id from the generic resource list
and the one its service view uses, where they differ (SQS queue URL or name;
log group name or either form of its ARN). The two types moto can't tag are
checked call by call with botocore's Stubber instead.
"""

import io
import json
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes import tags as tags_routes
from tests.moto_inprocess import REGION, moto_client, moto_routes

client = TestClient(app)


def _lambda_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.py", "def handler(event, context):\n    return event\n")
    return buf.getvalue()


def _vpc_subnets(ec2) -> list[str]:
    vpc_id = ec2.create_vpc(CidrBlock="10.0.0.0/16")["Vpc"]["VpcId"]
    return [
        ec2.create_subnet(VpcId=vpc_id, CidrBlock=cidr, AvailabilityZone=zone)["Subnet"]["SubnetId"]
        for cidr, zone in (("10.0.1.0/24", f"{REGION}a"), ("10.0.2.0/24", f"{REGION}b"))
    ]


# --- Seeds: create the resource, return the identifiers the console uses for it ---


def _seed_s3_bucket() -> list[str]:
    moto_client("s3").create_bucket(Bucket="tag-bucket")
    return ["tag-bucket"]


def _seed_sqs_queue() -> list[str]:
    url = moto_client("sqs").create_queue(QueueName="orders")["QueueUrl"]
    return [url, "orders"]


def _seed_lambda_function() -> list[str]:
    role = moto_client("iam").create_role(
        RoleName="lambda-role",
        AssumeRolePolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": []}),
    )["Role"]["Arn"]
    moto_client("lambda").create_function(
        FunctionName="order-processor",
        Runtime="python3.12",
        Role=role,
        Handler="index.handler",
        Code={"ZipFile": _lambda_zip()},
    )
    return ["order-processor"]


def _seed_dynamodb_table() -> list[str]:
    moto_client("dynamodb").create_table(
        TableName="Orders",
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    return ["Orders"]


def _seed_secret() -> list[str]:
    moto_client("secretsmanager").create_secret(Name="prod/db/credentials", SecretString="s3cret")
    return ["prod/db/credentials"]


def _log_group_ids(name: str) -> list[str]:
    """The name, DescribeLogGroups' ``arn`` (ending ``:*``) and its ``logGroupArn``."""
    group = moto_client("logs").describe_log_groups(logGroupNamePrefix=name)["logGroups"][0]
    assert group["arn"] == f"{group['logGroupArn']}:*"
    return [name, group["arn"], group["logGroupArn"]]


def _seed_log_group() -> list[str]:
    moto_client("logs").create_log_group(logGroupName="/app/orders")
    return _log_group_ids("/app/orders")


def _seed_ec2_instance() -> list[str]:
    ec2 = moto_client("ec2")
    image_id = ec2.describe_images(Owners=["amazon"])["Images"][0]["ImageId"]
    instance = ec2.run_instances(ImageId=image_id, MinCount=1, MaxCount=1)["Instances"][0]
    return [instance["InstanceId"]]


def _seed_iam_user() -> list[str]:
    moto_client("iam").create_user(UserName="alice")
    return ["alice"]


def _seed_iam_role() -> list[str]:
    moto_client("iam").create_role(
        RoleName="app-exec-role",
        AssumeRolePolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": []}),
    )
    return ["app-exec-role"]


def _seed_iam_policy() -> list[str]:
    policy = moto_client("iam").create_policy(
        PolicyName="orders-read",
        Path="/app/",
        PolicyDocument=json.dumps(
            {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]}
        ),
    )
    return [policy["Policy"]["Arn"]]


def _seed_rds_db_instance() -> list[str]:
    moto_client("rds").create_db_instance(
        DBInstanceIdentifier="orders-db",
        DBInstanceClass="db.t3.micro",
        Engine="postgres",
        MasterUsername="admin",
        MasterUserPassword="password123",
        AllocatedStorage=20,
    )
    return ["orders-db"]


def _seed_rds_db_cluster() -> list[str]:
    moto_client("rds").create_db_cluster(
        DBClusterIdentifier="analytics-cluster",
        Engine="aurora-postgresql",
        MasterUsername="admin",
        MasterUserPassword="password123",
    )
    return ["analytics-cluster"]


def _seed_sns_topic() -> list[str]:
    return [moto_client("sns").create_topic(Name="order-events")["TopicArn"]]


def _seed_kms_key() -> list[str]:
    return [moto_client("kms").create_key()["KeyMetadata"]["KeyId"]]


def _seed_ecr_repository() -> list[str]:
    moto_client("ecr").create_repository(repositoryName="app/web")
    return ["app/web"]


def _seed_state_machine() -> list[str]:
    role = moto_client("iam").create_role(
        RoleName="sfn-role",
        AssumeRolePolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": []}),
    )["Role"]["Arn"]
    machine = moto_client("stepfunctions").create_state_machine(
        name="order-flow",
        definition=json.dumps({"StartAt": "Done", "States": {"Done": {"Type": "Succeed"}}}),
        roleArn=role,
    )
    return [machine["stateMachineArn"]]


def _seed_kinesis_stream() -> list[str]:
    moto_client("kinesis").create_stream(StreamName="clickstream", ShardCount=1)
    return ["clickstream"]


def _seed_ssm_parameter() -> list[str]:
    moto_client("ssm").put_parameter(Name="/app/dev/db-host", Value="db.local", Type="String")
    return ["/app/dev/db-host"]


def _seed_load_balancer() -> list[str]:
    balancer = moto_client("elbv2").create_load_balancer(Name="web-alb", Subnets=_vpc_subnets(moto_client("ec2")))
    return [balancer["LoadBalancers"][0]["LoadBalancerArn"]]


def _seed_cache_cluster() -> list[str]:
    moto_client("elasticache").create_cache_cluster(
        CacheClusterId="sessions", Engine="redis", CacheNodeType="cache.t3.micro", NumCacheNodes=1
    )
    return ["sessions"]


def _seed_emr_cluster() -> list[str]:
    cluster = moto_client("emr").run_job_flow(
        Name="etl",
        ReleaseLabel="emr-6.15.0",
        Instances={"MasterInstanceType": "m5.xlarge", "InstanceCount": 1, "KeepJobFlowAliveWhenNoSteps": True},
        JobFlowRole="EMR_EC2_DefaultRole",
        ServiceRole="EMR_DefaultRole",
    )
    return [cluster["JobFlowId"]]


SEEDS: dict[tuple[str, str], Callable[[], list[str]]] = {
    ("s3", "buckets"): _seed_s3_bucket,
    ("sqs", "queues"): _seed_sqs_queue,
    ("lambda", "functions"): _seed_lambda_function,
    ("dynamodb", "tables"): _seed_dynamodb_table,
    ("secretsmanager", "secrets"): _seed_secret,
    ("logs", "log_groups"): _seed_log_group,
    ("ec2", "instances"): _seed_ec2_instance,
    ("iam", "users"): _seed_iam_user,
    ("iam", "roles"): _seed_iam_role,
    ("iam", "policies"): _seed_iam_policy,
    ("rds", "db_instances"): _seed_rds_db_instance,
    ("rds", "db_clusters"): _seed_rds_db_cluster,
    ("sns", "topics"): _seed_sns_topic,
    ("kms", "keys"): _seed_kms_key,
    ("ecr", "repositories"): _seed_ecr_repository,
    ("stepfunctions", "state_machines"): _seed_state_machine,
    ("kinesis", "streams"): _seed_kinesis_stream,
    ("ssm", "parameters"): _seed_ssm_parameter,
    ("elasticloadbalancing", "load_balancers"): _seed_load_balancer,
    ("elasticache", "cache_clusters"): _seed_cache_cluster,
    ("elasticmapreduce", "clusters"): _seed_emr_cluster,
}

# Checked call by call with botocore's Stubber: moto doesn't implement Cognito's
# ListTagsForResource, nor API Gateway's GetTags before 5.2, and its CloudFormation
# needs packages the dev extras don't install.
STUBBED = {("cognito-idp", "user_pools"), ("apigateway", "rest_apis"), ("cloudformation", "stacks")}


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    with moto_routes(monkeypatch, tags_routes):
        yield


def _tags_url(service: str, rtype: str, resource_id: str) -> str:
    return f"/api/tags/{service}/{rtype}/{resource_id}"


def _get_tags(service: str, rtype: str, resource_id: str) -> dict[str, str]:
    resp = client.get(_tags_url(service, rtype, resource_id))
    assert resp.status_code == 200, resp.text
    return resp.json()["tags"]


def _put_tags(service: str, rtype: str, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.put(_tags_url(service, rtype, resource_id), json={"tags": tags})
    assert resp.status_code == 200, resp.text


class TestEveryWritableTypeRoundTrips:
    def test_every_taggable_type_is_covered(self):
        assert set(SEEDS) | STUBBED == set(tags_routes.TAG_GETTER_REGISTRY)
        assert set(SEEDS) <= set(tags_routes.TAG_SETTER_REGISTRY)

    @pytest.mark.parametrize(("service", "rtype"), list(SEEDS), ids=[f"{s}/{t}" for s, t in SEEDS])
    def test_replace_and_clear_under_every_identifier(self, aws, service, rtype):
        for resource_id in SEEDS[(service, rtype)]():
            _put_tags(service, rtype, resource_id, {"env": "dev", "team": "orders"})
            assert _get_tags(service, rtype, resource_id) == {"env": "dev", "team": "orders"}

            _put_tags(service, rtype, resource_id, {"team": "billing"})
            assert _get_tags(service, rtype, resource_id) == {"team": "billing"}

            _put_tags(service, rtype, resource_id, {})
            assert _get_tags(service, rtype, resource_id) == {}


class TestLogGroupIdentifiers:
    def test_every_identifier_reads_the_same_tags(self, aws):
        moto_client("logs").create_log_group(logGroupName="/app/orders", tags={"env": "dev"})
        for resource_id in _log_group_ids("/app/orders"):
            assert _get_tags("logs", "log_groups", resource_id) == {"env": "dev"}

    def test_every_identifier_tags_the_log_group_itself(self, aws):
        # moto tags any string it's given, so check the tags landed on the group's ARN.
        logs = moto_client("logs")
        logs.create_log_group(logGroupName="/app/orders")
        arn = logs.describe_log_groups(logGroupNamePrefix="/app/orders")["logGroups"][0]["logGroupArn"]
        for resource_id in _log_group_ids("/app/orders"):
            _put_tags("logs", "log_groups", resource_id, {"set-by": resource_id})
            assert logs.list_tags_for_resource(resourceArn=arn)["tags"] == {"set-by": resource_id}

    def test_name_is_matched_exactly_not_as_a_prefix(self, aws):
        logs = moto_client("logs")
        logs.create_log_group(logGroupName="/app/orders-archive", tags={"env": "archive"})
        logs.create_log_group(logGroupName="/app/orders", tags={"env": "live"})
        assert _get_tags("logs", "log_groups", "/app/orders") == {"env": "live"}

    def test_unknown_log_group_is_404(self, aws):
        resp = client.get(_tags_url("logs", "log_groups", "/app/missing"))
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Log group '/app/missing' not found"

        resp = client.put(_tags_url("logs", "log_groups", "/app/missing"), json={"tags": {"a": "b"}})
        assert resp.status_code == 404


class TestBulkOperationsUseTheGenericIds:
    def test_bulk_tag_a_queue_by_url_and_a_log_group_by_name(self, aws):
        url = moto_client("sqs").create_queue(QueueName="orders")["QueueUrl"]
        moto_client("logs").create_log_group(logGroupName="/app/orders")

        resp = client.post(
            "/api/bulk/tag",
            json={
                "action": "add",
                "tags": {"env": "dev"},
                "resources": [
                    {"service": "sqs", "type": "queues", "id": url},
                    {"service": "logs", "type": "log_groups", "id": "/app/orders"},
                ],
            },
        )
        assert resp.json()["failed"] == 0, resp.json()
        assert _get_tags("sqs", "queues", "orders") == {"env": "dev"}
        assert _get_tags("logs", "log_groups", "/app/orders") == {"env": "dev"}

    def test_bulk_delete_a_queue_by_url(self, aws):
        sqs = moto_client("sqs")
        url = sqs.create_queue(QueueName="orders")["QueueUrl"]

        resp = client.post("/api/bulk/delete", json={"resources": [{"service": "sqs", "type": "queues", "id": url}]})
        assert resp.json()["succeeded"] == 1, resp.json()
        assert sqs.list_queues().get("QueueUrls", []) == []


@contextmanager
def _stubbed(monkeypatch: pytest.MonkeyPatch, service: str, region: str = REGION) -> Iterator[Stubber]:
    stub_client = boto3.client(service, region_name=region)
    monkeypatch.setattr(tags_routes, "get_client", lambda *_args, **_kwargs: stub_client)
    with Stubber(stub_client) as stubber:
        yield stubber
        stubber.assert_no_pending_responses()


class TestCloudFormationStackTags:
    def test_reads_the_stack_tags_by_name(self, monkeypatch):
        with _stubbed(monkeypatch, "cloudformation") as stubber:
            stubber.add_response(
                "describe_stacks",
                {
                    "Stacks": [
                        {
                            "StackName": "live-stack",
                            "CreationTime": "2026-11-13T19:51:35Z",
                            "StackStatus": "CREATE_COMPLETE",
                            "Tags": [{"Key": "env", "Value": "dev"}],
                        }
                    ]
                },
                {"StackName": "live-stack"},
            )
            assert _get_tags("cloudformation", "stacks", "live-stack") == {"env": "dev"}


class TestCognitoUserPoolTags:
    POOL_ID = "us-east-1_ba8ad98fd"
    ARN = f"arn:aws:cognito-idp:us-east-1:000000000000:userpool/{POOL_ID}"

    def _describe(self, stubber: Stubber) -> None:
        stubber.add_response(
            "describe_user_pool",
            {"UserPool": {"Id": self.POOL_ID, "Name": "customers", "Arn": self.ARN}},
            {"UserPoolId": self.POOL_ID},
        )

    def test_get_reads_by_the_pool_arn(self, monkeypatch):
        with _stubbed(monkeypatch, "cognito-idp") as stubber:
            self._describe(stubber)
            stubber.add_response("list_tags_for_resource", {"Tags": {"env": "dev"}}, {"ResourceArn": self.ARN})
            assert _get_tags("cognito-idp", "user_pools", self.POOL_ID) == {"env": "dev"}

    def test_put_replaces_by_the_pool_arn(self, monkeypatch):
        with _stubbed(monkeypatch, "cognito-idp") as stubber:
            self._describe(stubber)
            stubber.add_response("list_tags_for_resource", {"Tags": {"old": "x"}}, {"ResourceArn": self.ARN})
            stubber.add_response("untag_resource", {}, {"ResourceArn": self.ARN, "TagKeys": ["old"]})
            stubber.add_response("tag_resource", {}, {"ResourceArn": self.ARN, "Tags": {"env": "dev"}})
            _put_tags("cognito-idp", "user_pools", self.POOL_ID, {"env": "dev"})


class TestApiGatewayRestApiTags:
    @pytest.mark.parametrize(
        ("region", "arn"),
        [
            ("us-east-1", "arn:aws:apigateway:us-east-1::/restapis/eocd2yo7iw"),
            ("cn-north-1", "arn:aws-cn:apigateway:cn-north-1::/restapis/eocd2yo7iw"),
        ],
    )
    def test_get_and_put_use_the_arn_of_the_clients_partition(self, monkeypatch, region, arn):
        with _stubbed(monkeypatch, "apigateway", region) as stubber:
            stubber.add_response("get_tags", {"tags": {"env": "dev"}}, {"resourceArn": arn})
            assert _get_tags("apigateway", "rest_apis", "eocd2yo7iw") == {"env": "dev"}

            stubber.add_response("get_tags", {"tags": {"old": "x"}}, {"resourceArn": arn})
            stubber.add_response("untag_resource", {}, {"resourceArn": arn, "tagKeys": ["old"]})
            stubber.add_response("tag_resource", {}, {"resourceArn": arn, "tags": {"env": "dev"}})
            _put_tags("apigateway", "rest_apis", "eocd2yo7iw", {"env": "dev"})
