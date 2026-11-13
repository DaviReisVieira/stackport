"""The generic resource routes against moto: counts, listings and details agree.

The dashboard count, the listing and the detail view all come from the
registries in ``backend.routes.stats`` and ``backend.routes.resources``. Here
every registered detail lookup is checked the way the console uses it: create
a resource, list the type, and open the detail of every id the listing gives.
"""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Callable
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes.resources import DESCRIBE_REGISTRY
from tests.moto_aws import REGION, aws, moto_account

client = TestClient(app)

TRUST_LAMBDA = {
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}],
}


@pytest.fixture
def account():
    """A moto account StackPort reads from."""
    with moto_account():
        yield


def listed(service: str, res_type: str) -> list[dict]:
    resp = client.get(f"/api/resources/{service}")
    assert resp.status_code == 200, resp.text
    return resp.json()["resources"][res_type]


def detail(service: str, res_type: str, res_id: str):
    return client.get(f"/api/resources/{service}/{res_type}/{quote(res_id, safe='')}")


def counted(monkeypatch, service: str, res_type: str) -> int:
    monkeypatch.setattr("backend.routes.stats.STACKPORT_SERVICES", service)
    resp = client.get("/api/stats")
    assert resp.status_code == 200, resp.text
    return resp.json()["services"][service]["resources"][res_type]


def an_image() -> str:
    return aws("ec2").describe_images(Owners=["amazon"])["Images"][0]["ImageId"]


def two_subnets() -> tuple[str, list[str]]:
    ec2 = aws("ec2")
    vpc = ec2.create_vpc(CidrBlock="10.20.0.0/16")["Vpc"]["VpcId"]
    subnets = [
        ec2.create_subnet(VpcId=vpc, CidrBlock=f"10.20.{i}.0/24", AvailabilityZone=f"{REGION}{zone}")["Subnet"]["SubnetId"]
        for i, zone in enumerate("ab", start=1)
    ]
    return vpc, subnets


def a_role(name: str = "stackport-test") -> str:
    return aws("iam").create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps(TRUST_LAMBDA))["Role"]["Arn"]


class TestEc2Instances:
    def test_count_listing_and_detail_are_about_instances(self, account, monkeypatch):
        ec2 = aws("ec2")
        launched = [
            instance["InstanceId"]
            for count in (2, 1)
            for instance in ec2.run_instances(ImageId=an_image(), MinCount=count, MaxCount=count)["Instances"]
        ]

        assert sorted(item["id"] for item in listed("ec2", "instances")) == sorted(launched)
        assert counted(monkeypatch, "ec2", "instances") == 3
        resp = detail("ec2", "instances", launched[1])
        assert resp.status_code == 200, resp.text
        assert [instance["InstanceId"] for instance in resp.json()["detail"]] == [launched[1]]


class TestLoadBalancers:
    def test_listed_by_arn_which_opens_the_detail(self, account):
        _, subnets = two_subnets()
        arn = aws("elbv2").create_load_balancer(Name="web", Subnets=subnets)["LoadBalancers"][0]["LoadBalancerArn"]

        assert [item["id"] for item in listed("elasticloadbalancing", "load_balancers")] == [arn]
        resp = detail("elasticloadbalancing", "load_balancers", arn)
        assert resp.status_code == 200, resp.text
        assert [lb["LoadBalancerArn"] for lb in resp.json()["detail"]] == [arn]


class TestEventBridgeRules:
    @pytest.fixture
    def rules(self, account):
        events = aws("events")
        events.create_event_bus(Name="orders-bus")
        # The same name on two buses: two rules.
        on_default = events.put_rule(Name="audit", EventPattern=json.dumps({"source": ["billing"]}))["RuleArn"]
        on_orders = events.put_rule(
            Name="audit", EventBusName="orders-bus", EventPattern=json.dumps({"source": ["orders"]})
        )["RuleArn"]
        return {"default": on_default, "orders-bus": on_orders}

    def test_rules_on_every_bus_are_counted_and_listed(self, rules, monkeypatch):
        items = listed("events", "rules")
        assert sorted((item["id"], item["EventBusName"]) for item in items) == sorted((arn, bus) for bus, arn in rules.items())
        assert counted(monkeypatch, "events", "rules") == 2

    @pytest.mark.parametrize("bus, source", [("default", "billing"), ("orders-bus", "orders")])
    def test_detail_is_the_rule_on_its_own_bus(self, rules, bus, source):
        resp = detail("events", "rules", rules[bus])
        assert resp.status_code == 200, resp.text
        rule = resp.json()["detail"]
        assert (rule["Arn"], rule["EventBusName"]) == (rules[bus], bus)
        assert json.loads(rule["EventPattern"]) == {"source": [source]}

    def test_unknown_rule(self, rules):
        resp = detail("events", "rules", rules["orders-bus"].replace("audit", "gone"))
        assert resp.status_code == 404
        assert "wasn't found in events rules" in resp.json()["detail"]


class TestSqsDetail:
    def test_detail_has_the_queue_attributes(self, account):
        url = aws("sqs").create_queue(QueueName="jobs", Attributes={"VisibilityTimeout": "45"})["QueueUrl"]

        resp = detail("sqs", "queues", url)
        assert resp.status_code == 200, resp.text
        attributes = resp.json()["detail"]
        assert attributes["VisibilityTimeout"] == "45"
        assert attributes["QueueArn"].endswith(":jobs")


class TestDetailErrors:
    """The endpoint's answer, with its status and message, instead of a 500 with botocore's text."""

    def test_missing_resource(self, account):
        resp = detail("iam", "roles", "nobody")
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"]["code"] == "NoSuchEntity"
        assert "nobody" in body["detail"]
        assert "An error occurred" not in body["detail"]

    def test_malformed_id(self, account):
        resp = detail("ec2", "instances", "r-0123456789abcdef0")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"].startswith("InvalidInstanceID")

    def test_id_botocore_refuses_to_send(self, account):
        # ECR repository names are at least two characters long.
        resp = detail("ecr", "repositories", "a")
        assert resp.status_code == 400
        assert "repositoryNames" in resp.json()["detail"]

    def test_unregistered_type(self, account):
        resp = detail("s3", "nonsense", "x")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "No detail lookup registered for s3/nonsense"


# --- Every registered detail lookup (#175) ---------------------------------
#
# Each function creates one resource of its type in moto and returns the id the
# listing should give for it.

CREATORS: dict[tuple[str, str], Callable[[], str]] = {}


def creates(service: str, res_type: str):
    def register(create: Callable[[], str]) -> Callable[[], str]:
        CREATORS[(service, res_type)] = create
        return create

    return register


@creates("s3", "buckets")
def _bucket():
    aws("s3").create_bucket(Bucket="reports")
    return "reports"


@creates("lambda", "functions")
def _function():
    code = io.BytesIO()
    with zipfile.ZipFile(code, "w") as archive:
        archive.writestr("handler.py", "def handler(event, context):\n    return event\n")
    aws("lambda").create_function(
        FunctionName="resize", Runtime="python3.12", Role=a_role(), Handler="handler.handler", Code={"ZipFile": code.getvalue()}
    )
    return "resize"


@creates("ecs", "clusters")
def _ecs_cluster():
    return aws("ecs").create_cluster(clusterName="web")["cluster"]["clusterArn"]


@creates("ecs", "task_definitions")
def _task_definition():
    return aws("ecs").register_task_definition(
        family="web", containerDefinitions=[{"name": "app", "image": "nginx", "memory": 128}]
    )["taskDefinition"]["taskDefinitionArn"]


@creates("dynamodb", "tables")
def _table():
    aws("dynamodb").create_table(
        TableName="orders",
        KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    return "orders"


@creates("rds", "db_instances")
def _db_instance():
    aws("rds").create_db_instance(
        DBInstanceIdentifier="orders-db", DBInstanceClass="db.t3.micro", Engine="postgres",
        MasterUsername="admin", MasterUserPassword="password123", AllocatedStorage=20,
    )
    return "orders-db"


@creates("rds", "db_clusters")
def _db_cluster():
    aws("rds").create_db_cluster(
        DBClusterIdentifier="orders-cluster", Engine="aurora-postgresql", MasterUsername="admin", MasterUserPassword="password123"
    )
    return "orders-cluster"


@creates("elasticache", "cache_clusters")
def _cache_cluster():
    aws("elasticache").create_cache_cluster(CacheClusterId="sessions", Engine="redis", CacheNodeType="cache.t3.micro", NumCacheNodes=1)
    return "sessions"


@creates("sqs", "queues")
def _queue():
    return aws("sqs").create_queue(QueueName="jobs")["QueueUrl"]


@creates("sns", "topics")
def _topic():
    return aws("sns").create_topic(Name="alerts")["TopicArn"]


@creates("kinesis", "streams")
def _stream():
    aws("kinesis").create_stream(StreamName="clicks", ShardCount=1)
    return "clicks"


@creates("firehose", "delivery_streams")
def _delivery_stream():
    aws("s3").create_bucket(Bucket="archive")
    aws("firehose").create_delivery_stream(
        DeliveryStreamName="to-archive",
        ExtendedS3DestinationConfiguration={"RoleARN": a_role(), "BucketARN": "arn:aws:s3:::archive"},
    )
    return "to-archive"


@creates("events", "rules")
def _rule():
    events = aws("events")
    events.create_event_bus(Name="orders-bus")
    return events.put_rule(Name="audit", EventBusName="orders-bus", EventPattern=json.dumps({"source": ["orders"]}))["RuleArn"]


@creates("events", "event_buses")
def _event_bus():
    aws("events").create_event_bus(Name="orders-bus")
    return "orders-bus"


@creates("iam", "roles")
def _role():
    a_role("deployer")
    return "deployer"


@creates("iam", "users")
def _user():
    aws("iam").create_user(UserName="alice")
    return "alice"


@creates("iam", "policies")
def _policy():
    document = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]}
    return aws("iam").create_policy(PolicyName="read", PolicyDocument=json.dumps(document))["Policy"]["Arn"]


@creates("secretsmanager", "secrets")
def _secret():
    aws("secretsmanager").create_secret(Name="db-password", SecretString="hunter2")
    return "db-password"


@creates("kms", "keys")
def _key():
    return aws("kms").create_key(Description="orders")["KeyMetadata"]["KeyId"]


@creates("acm", "certificates")
def _certificate():
    return aws("acm").request_certificate(DomainName="example.com")["CertificateArn"]


@creates("cognito-idp", "user_pools")
def _user_pool():
    return aws("cognito-idp").create_user_pool(PoolName="customers")["UserPool"]["Id"]


@creates("cognito-identity", "identity_pools")
def _identity_pool():
    return aws("cognito-identity").create_identity_pool(
        IdentityPoolName="customers", AllowUnauthenticatedIdentities=False
    )["IdentityPoolId"]


@creates("wafv2", "web_acls")
def _web_acl():
    aws("wafv2").create_web_acl(
        Name="edge", Scope="REGIONAL", DefaultAction={"Allow": {}},
        VisibilityConfig={"SampledRequestsEnabled": False, "CloudWatchMetricsEnabled": False, "MetricName": "edge"},
    )
    return "edge"


@creates("ses", "identities")
def _identity():
    aws("ses").verify_email_identity(EmailAddress="team@example.com")
    return "team@example.com"


@creates("logs", "log_groups")
def _log_group():
    aws("logs").create_log_group(logGroupName="/app/web")
    return "/app/web"


@creates("ssm", "parameters")
def _parameter():
    aws("ssm").put_parameter(Name="/app/mode", Value="live", Type="String")
    return "/app/mode"


@creates("cloudformation", "stacks")
def _stack():
    cloudformation = aws("cloudformation")
    template = json.dumps({"Resources": {"Alerts": {"Type": "AWS::SNS::Topic"}}})
    # A deleted stack whose name the live one reuses: both are listed.
    cloudformation.create_stack(StackName="app", TemplateBody=template)
    cloudformation.delete_stack(StackName="app")
    return cloudformation.create_stack(StackName="app", TemplateBody=template)["StackId"]


@creates("stepfunctions", "state_machines")
def _state_machine():
    definition = {"StartAt": "Done", "States": {"Done": {"Type": "Succeed"}}}
    return aws("stepfunctions").create_state_machine(
        name="checkout", definition=json.dumps(definition), roleArn=a_role()
    )["stateMachineArn"]


@creates("monitoring", "alarms")
def _alarm():
    aws("cloudwatch").put_metric_alarm(
        AlarmName="high-cpu", MetricName="CPUUtilization", Namespace="AWS/EC2", Statistic="Average",
        Period=60, EvaluationPeriods=1, Threshold=90, ComparisonOperator="GreaterThanThreshold",
    )
    return "high-cpu"


@creates("monitoring", "dashboards")
def _dashboard():
    aws("cloudwatch").put_dashboard(DashboardName="ops", DashboardBody=json.dumps({"widgets": []}))
    return "ops"


@creates("route53", "hosted_zones")
def _hosted_zone():
    return aws("route53").create_hosted_zone(Name="example.com", CallerReference="stackport")["HostedZone"]["Id"]


@creates("cloudfront", "distributions")
def _distribution():
    config = {
        "CallerReference": "stackport",
        "Comment": "",
        "Enabled": True,
        "Origins": {"Quantity": 1, "Items": [{"Id": "site", "DomainName": "site.s3.amazonaws.com", "S3OriginConfig": {"OriginAccessIdentity": ""}}]},
        "DefaultCacheBehavior": {"TargetOriginId": "site", "ViewerProtocolPolicy": "allow-all", "MinTTL": 0},
    }
    return aws("cloudfront").create_distribution(DistributionConfig=config)["Distribution"]["Id"]


@creates("elasticloadbalancing", "load_balancers")
def _load_balancer():
    _, subnets = two_subnets()
    return aws("elbv2").create_load_balancer(Name="web", Subnets=subnets)["LoadBalancers"][0]["LoadBalancerArn"]


@creates("ec2", "instances")
def _instance():
    return aws("ec2").run_instances(ImageId=an_image(), MinCount=1, MaxCount=1)["Instances"][0]["InstanceId"]


@creates("ec2", "vpcs")
def _vpc():
    return two_subnets()[0]


@creates("ec2", "subnets")
def _subnet():
    return two_subnets()[1][0]


@creates("ec2", "security_groups")
def _security_group():
    vpc, _ = two_subnets()
    return aws("ec2").create_security_group(GroupName="web", Description="web", VpcId=vpc)["GroupId"]


@creates("ec2", "volumes")
def _volume():
    return aws("ec2").create_volume(AvailabilityZone=f"{REGION}a", Size=8)["VolumeId"]


@creates("elasticfilesystem", "file_systems")
def _file_system():
    return aws("efs").create_file_system(CreationToken="shared")["FileSystemId"]


@creates("ecr", "repositories")
def _repository():
    aws("ecr").create_repository(repositoryName="web")
    return "web"


@creates("glue", "databases")
def _glue_database():
    aws("glue").create_database(DatabaseInput={"Name": "lake"})
    return "lake"


@creates("glue", "crawlers")
def _crawler():
    aws("glue").create_crawler(Name="nightly", Role=a_role(), Targets={"S3Targets": [{"Path": "s3://lake/raw"}]})
    return "nightly"


@creates("athena", "workgroups")
def _workgroup():
    aws("athena").create_work_group(Name="analysts")
    return "analysts"


@creates("apigateway", "rest_apis")
def _rest_api():
    return aws("apigateway").create_rest_api(name="shop")["id"]


@creates("apigateway", "apis")
def _http_api():
    return aws("apigatewayv2").create_api(Name="shop", ProtocolType="HTTP")["ApiId"]


@creates("appsync", "graphql_apis")
def _graphql_api():
    return aws("appsync").create_graphql_api(name="shop", authenticationType="API_KEY")["graphqlApi"]["apiId"]


@creates("elasticmapreduce", "clusters")
def _emr_cluster():
    return aws("emr").run_job_flow(
        Name="etl", ReleaseLabel="emr-6.15.0", JobFlowRole="EMR_EC2_DefaultRole", ServiceRole="EMR_DefaultRole",
        Instances={"MasterInstanceType": "m5.xlarge", "SlaveInstanceType": "m5.xlarge", "InstanceCount": 1,
                   "KeepJobFlowAliveWhenNoSteps": True},
    )["JobFlowId"]


def test_every_detail_lookup_is_checked():
    # SES identities have a detail lookup of their own, outside the registry.
    assert set(CREATORS) == set(DESCRIBE_REGISTRY) | {("ses", "identities")}


@pytest.mark.parametrize("service, res_type", sorted(CREATORS), ids=[f"{s}/{t}" for s, t in sorted(CREATORS)])
def test_every_listed_id_opens_its_detail(account, monkeypatch, service, res_type):
    expected = CREATORS[(service, res_type)]()

    ids = [item["id"] for item in listed(service, res_type)]
    assert expected in ids
    assert len(set(ids)) == len(ids), f"two listed resources share an id: {ids}"
    assert counted(monkeypatch, service, res_type) == len(ids)
    # Defaults moto creates (the default VPC, the primary workgroup...) too.
    for res_id in ids:
        resp = detail(service, res_type, res_id)
        assert resp.status_code == 200, f"{res_id}: {resp.text}"
        assert resp.json()["detail"], f"{res_id}: empty detail"
