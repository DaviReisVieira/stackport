"""API Explorer: botocore's catalog, running operations against moto, and read-only mode."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from datetime import datetime
from unittest.mock import patch

import boto3
import botocore
import botocore.session
import pytest
from botocore.config import Config
from botocore.model import ServiceModel
from fastapi.testclient import TestClient

from backend import aws_emulator, config, service_models
from backend.learn import cli_setup
from backend.main import AWS_WIRE_LOGGERS, app, configure_aws_wire_logs
from backend.routes import explorer
from backend.routes.common import EndpointInfo, get_endpoint_info
from tests.fake_endpoint import FakeEndpoint, RecordedRequest
from tests.moto_aws import aws, moto_account

client = TestClient(app, raise_server_exceptions=False)

BUCKET = "explorer-tests"


def run(service: str, operation: str, params: dict | None = None, **options):
    return client.post(
        f"/api/explorer/services/{service}/operations/{operation}/run",
        json={"params": params or {}, **options},
    )


@pytest.fixture
def account():
    with moto_account():
        yield


@pytest.fixture
def bucket(account):
    s3 = aws("s3")
    s3.create_bucket(Bucket=BUCKET)
    return s3


class TestCatalog:
    def test_services_are_every_model_botocore_has(self):
        resp = client.get("/api/explorer/services")
        assert resp.status_code == 200
        body = resp.json()
        assert body["botocoreVersion"] == botocore.__version__
        names = [service["name"] for service in body["services"]]
        assert names == botocore.session.get_session().get_available_services()

    @pytest.mark.parametrize("service", ["sqs", "s3", "dynamodb", "scheduler", "ec2", "cognito-idp"])
    def test_full_names_match_the_models(self, service):
        listed = {entry["name"]: entry["fullName"] for entry in client.get("/api/explorer/services").json()["services"]}
        model = botocore.session.get_session().get_service_model(service)
        assert listed[service] == model.metadata["serviceFullName"]

    def test_service_lists_operations_with_access_and_paging(self):
        resp = client.get("/api/explorer/services/sqs")
        assert resp.status_code == 200
        body = resp.json()
        assert body["fullName"] == "Amazon Simple Queue Service"
        operations = {operation["name"]: operation for operation in body["operations"]}
        assert operations["ListQueues"]["access"] == "read"
        assert operations["ListQueues"]["paginated"] is True
        assert operations["ListQueues"]["summary"] == "Returns a list of your queues in the current region."
        assert operations["CreateQueue"]["access"] == "write"
        assert operations["CreateQueue"]["paginated"] is False
        assert operations["ReceiveMessage"]["access"] == "write"
        assert "<" not in body["documentation"]

    def test_streaming_and_event_stream_operations_are_flagged(self):
        operations = {op["name"]: op for op in client.get("/api/explorer/services/s3").json()["operations"]}
        assert operations["GetObject"]["streaming"] is True
        assert operations["GetObject"]["eventStream"] is False
        assert operations["SelectObjectContent"]["eventStream"] is True

    def test_unknown_service_is_404(self):
        assert client.get("/api/explorer/services/not-a-service").status_code == 404
        assert client.get("/api/explorer/services/not-a-service/operations/ListThings").status_code == 404

    def test_operation_input_as_a_shape_graph(self):
        resp = client.get("/api/explorer/services/sqs/operations/CreateQueue")
        assert resp.status_code == 200
        body = resp.json()
        assert body["methodName"] == "create_queue"
        assert body["cliCommand"] == "sqs create-queue"
        assert body["cliOptions"] == {"QueueName": "--queue-name", "Attributes": "--attributes", "tags": "--tags"}
        assert body["access"] == "write"
        assert body["pagination"] is None
        graph = body["input"]
        root = graph["shapes"][graph["root"]]
        assert root["type"] == "structure"
        assert root["required"] == ["QueueName"]
        assert [member["name"] for member in root["members"]] == ["QueueName", "Attributes", "tags"]
        assert root["members"][0]["documentation"].startswith("The name of the new queue.")
        attributes = graph["shapes"][root["members"][1]["shape"]]
        assert attributes["type"] == "map"
        assert "DelaySeconds" in graph["shapes"][attributes["key"]]["enum"]

    def test_constraints_and_flags_on_shapes(self):
        graph = client.get("/api/explorer/services/sqs/operations/ReceiveMessage").json()["input"]
        root = graph["shapes"][graph["root"]]
        members = {member["name"]: member for member in root["members"]}
        assert graph["shapes"][members["MaxNumberOfMessages"]["shape"]] == {"type": "integer"}
        attribute_names = graph["shapes"][members["MessageSystemAttributeNames"]["shape"]]
        assert attribute_names["type"] == "list"
        assert "SenderId" in graph["shapes"][attribute_names["member"]]["enum"]
        token = client.get("/api/explorer/services/ec2/operations/RunInstances").json()["input"]
        run_members = {member["name"]: member for member in token["shapes"][token["root"]]["members"]}
        assert run_members["ClientToken"]["idempotencyToken"] is True
        secret = client.get("/api/explorer/services/secretsmanager/operations/CreateSecret").json()["input"]
        secret_members = {member["name"]: member for member in secret["shapes"][secret["root"]]["members"]}
        assert secret["shapes"][secret_members["SecretString"]["shape"]]["sensitive"] is True
        put = client.get("/api/explorer/services/s3/operations/PutObject").json()["input"]
        put_members = {member["name"]: member for member in put["shapes"][put["root"]]["members"]}
        assert put["shapes"][put_members["Body"]["shape"]] == {"type": "blob", "streaming": True}

    def test_recursive_shapes_are_listed_once(self):
        graph = client.get("/api/explorer/services/dynamodb/operations/PutItem").json()["input"]
        shapes = graph["shapes"]
        value = shapes["AttributeValue"]
        members = {member["name"]: member["shape"] for member in value["members"]}
        # A map of AttributeValues and a list of them: both lead back to AttributeValue
        assert shapes[members["M"]] == {"type": "map", "key": "AttributeName", "value": "AttributeValue"}
        assert shapes[members["L"]]["member"] == "AttributeValue"
        referenced = {graph["root"]}
        for shape in shapes.values():
            referenced.update(member["shape"] for member in shape.get("members", []))
            referenced.update(shape[key] for key in ("member", "key", "value") if key in shape)
        assert referenced == set(shapes)

    def test_paging_and_cli_names(self):
        body = client.get("/api/explorer/services/s3/operations/ListObjectsV2").json()
        assert body["cliCommand"] == "s3api list-objects-v2"
        assert body["methodName"] == "list_objects_v2"
        assert body["pagination"] == {"inputTokens": ["ContinuationToken"], "limitKey": "MaxKeys", "resultKeys": ["Contents", "CommonPrefixes"]}
        assert body["streamingOutput"] is False
        invoke = client.get("/api/explorer/services/lambda/operations/Invoke").json()
        assert invoke["streamingOutput"] is True
        assert invoke["cliOptions"]["FunctionName"] == "--function-name"

    def test_operation_without_input(self):
        body = client.get("/api/explorer/services/sts/operations/GetCallerIdentity").json()
        graph = body["input"]
        assert graph["shapes"][graph["root"]]["members"] == []
        assert body["cliOptions"] == {}


class TestDocumentation:
    def test_html_becomes_plain_text(self):
        html = (
            "<fullname>Amazon Thing</fullname><p>Makes a <code>thing</code> &amp; more.</p>"
            "<ul><li><p>one</p></li><li>two <b>bold</b></li></ul><note><p>Careful.</p></note>"
        )
        assert service_models.doc_text(html) == "Makes a thing & more.\n- one\n- two bold\n\nCareful."

    def test_summary_is_the_first_sentence(self):
        assert service_models.summary("Lists things. Then more.\n\nOther paragraph.") == "Lists things."
        assert service_models.summary("The filters.\n- affinity - The affinity.\n- owner - Its owner.") == "The filters."
        long = "word " * 80
        assert len(service_models.summary(long)) <= 200
        assert service_models.summary(long).endswith("…")


def access(service: str, operation: str) -> str:
    return service_models.access_of(service, service_models.operation_model(service, operation))


class TestAccess:
    @pytest.mark.parametrize(
        ("service", "operation", "expected"),
        [
            ("sqs", "ListQueues", "read"),
            ("sqs", "GetQueueAttributes", "read"),
            ("s3", "HeadObject", "read"),
            ("ec2", "DescribeInstances", "read"),
            ("dynamodb", "BatchGetItem", "read"),
            ("dynamodb", "TransactGetItems", "read"),
            ("dynamodb", "Query", "read"),
            ("dynamodb", "Scan", "read"),
            ("logs", "FilterLogEvents", "read"),
            ("cloudtrail", "LookupEvents", "read"),
            ("elbv2", "DescribeListeners", "read"),
            ("sqs", "ReceiveMessage", "write"),
            ("sqs", "CreateQueue", "write"),
            ("dynamodb", "BatchWriteItem", "write"),
            ("dynamodb", "TransactWriteItems", "write"),
            ("dynamodb", "ExecuteStatement", "write"),
            ("athena", "StartQueryExecution", "write"),
            ("lambda", "Invoke", "write"),
            ("kms", "Encrypt", "write"),
        ],
    )
    def test_by_name(self, service, operation, expected):
        assert access(service, operation) == expected
        assert service_models.is_read_operation(service, operation) is (expected == "read")

    @pytest.mark.parametrize(
        ("service", "operation"),
        [
            ("cognito-identity", "GetId"),
            ("cognito-identity", "GetOpenIdToken"),
            ("cognito-idp", "GetUserAttributeVerificationCode"),
            ("controltower", "ListLandingZones"),
            ("iot", "DescribeEndpoint"),
            ("sagemaker", "GetScalingConfigurationRecommendation"),
        ],
    )
    def test_reads_by_name_that_create_or_send_something(self, service, operation):
        assert access(service, operation) == "write"

    @pytest.mark.parametrize(
        ("service", "operation"),
        [
            # Found in the response: keys, tokens and passwords near its top
            ("sts", "GetSessionToken"),
            ("sts", "GetFederationToken"),
            ("ecr", "GetAuthorizationToken"),
            ("codeartifact", "GetAuthorizationToken"),
            ("cognito-identity", "GetCredentialsForIdentity"),
            ("redshift", "GetClusterCredentialsWithIAM"),
            ("redshift", "GetIdentityCenterAuthToken"),
            ("redshift-serverless", "GetCredentials"),
            ("lakeformation", "GetTemporaryGlueTableCredentials"),
            ("lakeformation", "GetTemporaryDataLocationCredentials"),
            ("lightsail", "GetInstanceAccessDetails"),
            ("sso", "GetRoleCredentials"),
            # Deeper than the rule looks, so listed
            ("emr", "GetClusterSessionCredentials"),
            ("codepipeline", "GetJobDetails"),
            ("gamelift", "GetInstanceAccess"),
        ],
    )
    def test_reads_by_name_that_hand_out_credentials(self, service, operation):
        assert access(service, operation) == "write"

    @pytest.mark.parametrize(
        ("service", "operation"),
        [
            # Stored values, which the console's own views show in read-only mode too
            ("secretsmanager", "GetSecretValue"),
            ("ssm", "GetParameter"),
            # Passwords and tokens deep in a resource's settings, or not credentials at all
            ("rds", "DescribeDBInstances"),
            ("redshift", "DescribeClusters"),
            ("emr", "DescribeCluster"),
            ("glue", "GetJob"),
            ("ecs", "DescribeTaskDefinition"),
            ("dms", "DescribeEndpoints"),
            ("iam", "GetAccountPasswordPolicy"),
            ("ec2", "DescribeFleets"),
            ("chime-sdk-messaging", "ListChannels"),
        ],
    )
    def test_reads_whose_responses_only_mention_credentials(self, service, operation):
        assert access(service, operation) == "read"

    def test_a_verb_only_counts_as_a_whole_word(self):
        # "Listener" isn't "List", "Getaway" isn't "Get"
        model = ServiceModel({
            "metadata": {"protocol": "json", "apiVersion": "2020-01-01", "endpointPrefix": "x"},
            "operations": {name: {"name": name, "http": {"method": "POST", "requestUri": "/"}} for name in ("ListenerFoo", "GetawayCar")},
            "shapes": {},
        })
        assert access_of_model(model, "ListenerFoo") == "write"
        assert access_of_model(model, "GetawayCar") == "write"

    @pytest.mark.parametrize(
        ("service", "operation"),
        [("sqs", "ListThings"), ("not-a-service", "ListQueues"), ("sqs", "list_queues"), ("s3", "generate_presigned_url")],
    )
    def test_unknown_names_are_never_reads(self, service, operation):
        assert service_models.is_read_operation(service, operation) is False


def access_of_model(model: ServiceModel, operation: str) -> str:
    return service_models.access_of("x", model.operation_model(operation))


class TestRun:
    def test_read(self, account):
        url = aws("sqs").create_queue(QueueName="orders")["QueueUrl"]
        resp = run("sqs", "ListQueues")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        [response] = body["responses"]
        assert response["body"] == {"QueueUrls": [url]}
        assert response["metadata"]["httpStatusCode"] == 200
        assert response["metadata"]["requestId"]
        assert response["metadata"]["retryAttempts"] == 0
        assert body["durationMs"] >= 0
        assert body["nextToken"] is None
        assert body["notices"] == []

    def test_write(self, account):
        resp = run("sqs", "CreateQueue", {"QueueName": "jobs", "Attributes": {"DelaySeconds": "5"}})
        assert resp.status_code == 200, resp.text
        url = resp.json()["responses"][0]["body"]["QueueUrl"]
        attributes = aws("sqs").get_queue_attributes(QueueUrl=url, AttributeNames=["DelaySeconds"])["Attributes"]
        assert attributes == {"DelaySeconds": "5"}

    def test_service_stackport_has_no_view_for(self, account):
        aws("iam").create_role(RoleName="scheduler", AssumeRolePolicyDocument="{}")
        target = {"Arn": "arn:aws:sqs:us-east-1:123456789012:orders", "RoleArn": "arn:aws:iam::123456789012:role/scheduler"}
        created = run("scheduler", "CreateSchedule", {
            "Name": "nightly",
            "ScheduleExpression": "rate(1 day)",
            "FlexibleTimeWindow": {"Mode": "OFF"},
            "Target": target,
        })
        assert created.status_code == 200, created.text
        listed = run("scheduler", "ListSchedules").json()["responses"][0]["body"]
        assert [schedule["Name"] for schedule in listed["Schedules"]] == ["nightly"]

    def test_missing_parameter_is_400_with_botocore_message(self, account):
        resp = run("sqs", "CreateQueue", {})
        assert resp.status_code == 400
        assert resp.json()["detail"] == 'Parameter validation failed:\nMissing required parameter in input: "QueueName"'

    def test_unknown_parameter_is_400(self, account):
        resp = run("sqs", "ListQueues", {"QueueNamePrefx": "a"})
        assert resp.status_code == 400
        assert 'Unknown parameter in input: "QueueNamePrefx"' in resp.json()["detail"]

    def test_endpoint_error_keeps_its_status_and_message(self, account):
        resp = run("sqs", "GetQueueUrl", {"QueueName": "missing"})
        assert resp.status_code == 400
        assert "does not exist" in resp.json()["detail"]

    def test_timestamps_are_iso_8601(self, bucket):
        [listed] = run("s3", "ListBuckets").json()["responses"][0]["body"]["Buckets"]
        assert listed["Name"] == BUCKET
        assert datetime.fromisoformat(listed["CreationDate"]).tzinfo is not None

    def test_blobs_round_trip_as_text_or_base64(self, account):
        key = aws("kms").create_key()["KeyMetadata"]["KeyId"]
        encrypted = run("kms", "Encrypt", {"KeyId": key, "Plaintext": {"$base64": base64.b64encode(b"hello").decode()}})
        assert encrypted.status_code == 200, encrypted.text
        ciphertext = encrypted.json()["responses"][0]["body"]["CiphertextBlob"]
        # Whatever form it came back in goes back the same way
        decrypted = run("kms", "Decrypt", {"CiphertextBlob": ciphertext})
        assert decrypted.status_code == 200, decrypted.text
        assert decrypted.json()["responses"][0]["body"]["Plaintext"] == "hello"

    @pytest.mark.parametrize("value", ["not base64!", "é", 5])
    def test_invalid_base64_is_400(self, account, value):
        resp = run("kms", "Encrypt", {"KeyId": "k", "Plaintext": {"$base64": value}})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Plaintext isn't valid base64."

    def test_a_wrong_type_a_handler_sees_first_is_400(self, bucket):
        # botocore's SSE-C handler reads the key before botocore validates the input
        resp = run("s3", "GetObject", {"Bucket": BUCKET, "Key": "k", "SSECustomerKey": 5, "SSECustomerAlgorithm": "AES256"})
        assert resp.status_code == 400
        assert "Invalid type for parameter SSECustomerKey" in resp.json()["detail"]

    def test_a_parameter_that_can_not_go_in_the_url_is_400(self, account, caplog):
        resp = run("s3control", "ListJobs", {"AccountId": "x.evil#"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "botocore can't build the request's URL: AccountId must only contain a-z, A-Z, 0-9 and `-`."
        assert not [record for record in caplog.records if record.levelno >= logging.WARNING]

    def test_other_errors_inside_a_call_stay_server_errors(self, account):
        sqs = boto3.client("sqs", region_name="us-east-1", config=Config(ignore_configured_endpoint_urls=True))

        def broken(**_params):
            raise TypeError("a bug, not a bad parameter")

        sqs.list_queues = broken
        with patch.object(explorer, "get_client", return_value=sqs):
            assert run("sqs", "ListQueues").status_code == 500

    def test_streaming_body_text_and_bytes(self, bucket):
        bucket.put_object(Bucket=BUCKET, Key="text", Body="hello ✓".encode())
        bucket.put_object(Bucket=BUCKET, Key="bytes", Body=b"\xff\x00")
        text = run("s3", "GetObject", {"Bucket": BUCKET, "Key": "text"}).json()
        assert text["responses"][0]["body"]["Body"] == "hello ✓"
        assert text["notices"] == []
        raw = run("s3", "GetObject", {"Bucket": BUCKET, "Key": "bytes"}).json()
        assert raw["responses"][0]["body"]["Body"] == {"$base64": "/wA="}

    def test_streaming_body_is_read_up_to_the_limit(self, bucket, monkeypatch):
        monkeypatch.setattr(explorer, "STREAM_READ_LIMIT", 5)
        # Two bytes per character: the limit falls inside the third one, which is left out
        bucket.put_object(Bucket=BUCKET, Key="long", Body=("é" * 10).encode())
        body = run("s3", "GetObject", {"Bucket": BUCKET, "Key": "long"}).json()
        assert body["responses"][0]["body"]["Body"] == "éé"
        assert body["notices"] == ["Body shows the first 5 bytes of the stream; the rest wasn't read."]

    def test_event_streams_are_refused_before_any_call(self, account):
        with patch.object(explorer, "get_client", side_effect=AssertionError("no client for event streams")):
            resp = run("s3", "SelectObjectContent", {"Bucket": BUCKET, "Key": "k"})
        assert resp.status_code == 400
        assert "streams events" in resp.json()["detail"]

    @pytest.mark.parametrize("name", ["generate_presigned_url", "get_paginator", "close", "meta", "list_queues", "_make_api_call", "can_paginate"])
    def test_only_operations_of_the_model_are_reachable(self, account, name):
        with patch.object(explorer, "get_client", side_effect=AssertionError("no client for a non-operation")):
            assert run("sqs", name).status_code == 404
            assert client.get(f"/api/explorer/services/sqs/operations/{name}").status_code == 404

    def test_parameter_values_are_never_logged(self, account, caplog):
        caplog.set_level(logging.DEBUG)
        run("secretsmanager", "CreateSecret", {"Name": "db", "SecretString": "hunter2-secret"})
        run("secretsmanager", "GetSecretValue", {"SecretId": "db"})
        run("secretsmanager", "CreateSecret", {"Name": 5, "SecretString": "hunter2-secret"})
        assert "hunter2" not in caplog.text

    def test_wire_logs_come_back_when_asked_for(self):
        try:
            configure_aws_wire_logs(True)
            assert all(logging.getLogger(name).level == logging.NOTSET for name in AWS_WIRE_LOGGERS)
            configure_aws_wire_logs(False)
            assert all(logging.getLogger(name).level >= logging.INFO for name in AWS_WIRE_LOGGERS)
        finally:
            configure_aws_wire_logs(False)


class TestPagination:
    @pytest.fixture
    def objects(self, bucket):
        for index in range(3):
            bucket.put_object(Bucket=BUCKET, Key=f"k{index}", Body=b"x")
        return bucket

    def test_follows_pages_up_to_the_limit_and_says_where_to_continue(self, objects):
        resp = run("s3", "ListObjectsV2", {"Bucket": BUCKET, "MaxKeys": 1}, paginate=True, maxPages=2)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [[item["Key"] for item in page["body"]["Contents"]] for page in body["responses"]] == [["k0"], ["k1"]]
        assert set(body["nextToken"]) == {"ContinuationToken"}

        rest = run("s3", "ListObjectsV2", {"Bucket": BUCKET, "MaxKeys": 1, **body["nextToken"]}, paginate=True).json()
        assert [[item["Key"] for item in page["body"]["Contents"]] for page in rest["responses"]] == [["k2"]]
        assert rest["nextToken"] is None

    def test_one_call_still_reports_the_next_token(self, objects):
        body = run("s3", "ListObjectsV2", {"Bucket": BUCKET, "MaxKeys": 2}).json()
        assert len(body["responses"]) == 1
        assert set(body["nextToken"]) == {"ContinuationToken"}

    def test_a_token_expression_and_more_results(self, objects):
        # ListObjects (v1) continues from NextMarker || Contents[-1].Key while IsTruncated
        body = run("s3", "ListObjects", {"Bucket": BUCKET, "MaxKeys": 2}, paginate=True).json()
        assert [len(page["body"]["Contents"]) for page in body["responses"]] == [2, 1]
        assert body["nextToken"] is None

    def test_operation_that_does_not_paginate(self, account):
        resp = run("sqs", "CreateQueue", {"QueueName": "q"}, paginate=True)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "CreateQueue doesn't paginate."

    def test_responses_stop_at_the_size_limit(self, objects, monkeypatch):
        monkeypatch.setattr(explorer, "RESPONSE_SIZE_LIMIT", 600)
        body = run("s3", "ListObjectsV2", {"Bucket": BUCKET, "MaxKeys": 1}, paginate=True).json()
        assert 1 <= len(body["responses"]) < 3
        assert body["nextToken"] is not None
        assert any(notice.startswith("Stopped following pages") for notice in body["notices"])

    def test_a_response_over_the_size_limit_is_left_out(self, objects, monkeypatch):
        monkeypatch.setattr(explorer, "RESPONSE_SIZE_LIMIT", 50)
        body = run("s3", "ListObjectsV2", {"Bucket": BUCKET}).json()
        assert body["responses"][0]["body"] is None
        assert body["responses"][0]["metadata"]["httpStatusCode"] == 200
        assert "more than the" in body["notices"][0]

    def test_pages_too_large_to_show_still_count_toward_the_limit(self, objects, monkeypatch):
        monkeypatch.setattr(explorer, "RESPONSE_SIZE_LIMIT", 50)
        body = run("s3", "ListObjectsV2", {"Bucket": BUCKET, "MaxKeys": 1}, paginate=True, maxPages=50).json()
        assert [page["body"] for page in body["responses"]] == [None]
        assert body["nextToken"] is not None
        assert any(notice.startswith("Stopped following pages") for notice in body["notices"])

    def test_max_pages_is_bounded(self, account):
        assert run("s3", "ListObjectsV2", {"Bucket": BUCKET}, paginate=True, maxPages=0).status_code == 422
        assert run("s3", "ListObjectsV2", {"Bucket": BUCKET}, paginate=True, maxPages=51).status_code == 422


class TestEndpointSelection:
    def test_runs_against_the_endpoint_in_the_query(self):
        def sqs_endpoint(request: RecordedRequest):
            body = {"QueueUrls": [f"{server.url}/000000000000/picked"]}
            return 200, {"Content-Type": "application/x-amz-json-1.0", "x-amzn-RequestId": "req-fake"}, json.dumps(body).encode()

        with FakeEndpoint(handler=sqs_endpoint) as server:
            resp = client.post(
                "/api/explorer/services/sqs/operations/ListQueues/run",
                params={"endpoint": server.url},
                json={"params": {"QueueNamePrefix": "pick"}},
            )
        assert resp.status_code == 200, resp.text
        [response] = resp.json()["responses"]
        assert response["body"] == {"QueueUrls": [f"{server.url}/000000000000/picked"]}
        assert response["metadata"]["requestId"] == "req-fake"
        [request] = server.requests
        assert request.headers["x-amz-target"] == "AmazonSQS.ListQueues"
        assert json.loads(request.body) == {"QueueNamePrefix": "pick"}

    def test_numbers_json_can_not_carry_become_text(self):
        # botocore parses "NaN" and "Infinity" in a Query API's XML into floats
        def ses_endpoint(_request: RecordedRequest):
            body = (
                b'<GetSendQuotaResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><GetSendQuotaResult>'
                b"<Max24HourSend>NaN</Max24HourSend><MaxSendRate>Infinity</MaxSendRate><SentLast24Hours>3.0</SentLast24Hours>"
                b"</GetSendQuotaResult></GetSendQuotaResponse>"
            )
            return 200, {"Content-Type": "text/xml"}, body

        with FakeEndpoint(handler=ses_endpoint) as server:
            resp = client.post("/api/explorer/services/ses/operations/GetSendQuota/run", params={"endpoint": server.url}, json={})
        assert resp.status_code == 200, resp.text
        assert resp.json()["responses"][0]["body"] == {"Max24HourSend": "nan", "MaxSendRate": "inf", "SentLast24Hours": 3.0}


class TestCliSetup:
    @pytest.fixture
    def emulator_dir(self, tmp_path, monkeypatch):
        directory = tmp_path / "5599"
        directory.mkdir()
        (directory / aws_emulator.CA_FILE).write_text("ca")
        (directory / aws_emulator.CREDENTIALS_FILE).write_text("[default]\naws_access_key_id = k\naws_secret_access_key = s\n")
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        monkeypatch.setattr(cli_setup, "running_in_container", lambda: False)
        return directory

    def _get(self, path: str, emulator: dict | None) -> dict | None:
        app.dependency_overrides[get_endpoint_info] = lambda: EndpointInfo(url="https://127.0.0.1:5599", region="us-east-1")
        try:
            with patch.object(cli_setup, "detect_emulator_quickly", return_value=emulator):
                return client.get(path).json()["cliSetup"]
        finally:
            app.dependency_overrides.pop(get_endpoint_info, None)

    def test_the_setup_learn_shows_without_learn(self, emulator_dir):
        emulator = {"id": "aws-emulator", "name": "AWS Emulator", "version": "1"}
        shown = self._get("/api/explorer/cli-setup", emulator)
        assert shown == self._get("/api/learn/cli-setup", emulator)
        assert f"export AWS_CA_BUNDLE={aws_emulator.display_path(emulator_dir)}/ca.pem" in shown["script"]
        assert "export AWS_DISABLE_HOST_PREFIX_INJECTION=true" in shown["script"]
        assert any(route.path == "/cli-setup" for route in explorer.router.routes)

    def test_nothing_for_emulators_that_need_nothing(self, emulator_dir):
        assert self._get("/api/explorer/cli-setup", {"id": "moto", "name": "Moto", "version": "1"}) is None


class TestReadOnlyMode:
    @pytest.fixture
    def read_only(self, account):
        with patch("backend.main.STACKPORT_ALLOW_WRITES", False):
            yield

    def test_reads_run(self, read_only):
        resp = run("sqs", "ListQueues")
        assert resp.status_code == 200, resp.text

    @pytest.mark.parametrize(
        ("service", "operation"),
        [
            ("sqs", "CreateQueue"),
            ("sqs", "ReceiveMessage"),
            ("sqs", "ListThings"),
            ("not-a-service", "ListQueues"),
            ("s3", "generate_presigned_url"),
            ("sqs", "list_queues"),
            ("sts", "GetSessionToken"),
            ("ecr", "GetAuthorizationToken"),
        ],
    )
    def test_writes_and_unknown_operations_are_blocked(self, read_only, service, operation):
        with patch.object(explorer, "get_client", side_effect=AssertionError("blocked before the route")):
            resp = run(service, operation, {"QueueName": "nope"})
        assert resp.status_code == 403
        assert "disabled" in resp.json()["detail"].lower()

    def test_the_check_runs_off_the_event_loop(self, read_only):
        # Telling a read may load a service model, which takes tens of milliseconds
        where = []

        def is_read_operation(service, operation):
            try:
                asyncio.get_running_loop()
                where.append("event loop")
            except RuntimeError:
                where.append("worker thread")
            return service_models.is_read_operation(service, operation)

        with patch("backend.main.is_read_operation", is_read_operation):
            assert run("sqs", "ListQueues").status_code == 200
        assert where == ["worker thread"]

    def test_a_path_with_a_trailing_slash_is_blocked(self, read_only):
        resp = client.post("/api/explorer/services/sqs/operations/ListQueues/run/", json={"params": {}})
        assert resp.status_code == 403

    def test_catalog_stays_readable(self, read_only):
        assert client.get("/api/explorer/services").status_code == 200
        assert client.get("/api/explorer/services/sqs/operations/CreateQueue").status_code == 200

    def test_middleware_and_route_read_the_same_path(self):
        [route] = [r for r in explorer.router.routes if "POST" in r.methods]
        path = (explorer.PREFIX + route.path).format(service="cognito-idp", operation="ListUserPools")
        assert explorer.operation_run_by(path) == ("cognito-idp", "ListUserPools")
        assert explorer.operation_run_by(path + "/") is None
        assert explorer.operation_run_by("/api/explorer/services/sqs") is None
