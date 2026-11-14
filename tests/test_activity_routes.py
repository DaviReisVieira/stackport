"""Activity: CloudTrail LookupEvents through a fake endpoint that answers on the wire.

The fake speaks CloudTrail's JSON protocol, so requests go through botocore's
real serialization and the answers through its real parsing.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import botocore.session
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas.activity import LookupAttribute
from tests.fake_endpoint import FakeEndpoint, RecordedRequest

client = TestClient(app, raise_server_exceptions=False)

TARGET = "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents"
JSON_1_1 = {"Content-Type": "application/x-amz-json-1.1"}
NOW = datetime.now(timezone.utc).replace(microsecond=0)

# What LookupEvents filters each attribute on, in an event of its answer.
ATTRIBUTE_FIELDS = {
    "EventId": lambda event: [event["EventId"]],
    "EventName": lambda event: [event["EventName"]],
    "EventSource": lambda event: [event["EventSource"]],
    "Username": lambda event: [event["Username"]],
    "ReadOnly": lambda event: [event["ReadOnly"]],
    "AccessKeyId": lambda event: [event["AccessKeyId"]],
    "ResourceName": lambda event: [resource["ResourceName"] for resource in event["Resources"]],
    "ResourceType": lambda event: [resource["ResourceType"] for resource in event["Resources"]],
}


def cloudtrail_event(
    name: str,
    source: str,
    at: datetime,
    *,
    read_only: bool = False,
    username: str = "alice",
    resources: tuple[tuple[str, str], ...] = (),
    error: tuple[str, str] | None = None,
    raw: str | None = None,
) -> dict:
    """An event as LookupEvents answers it, with its record as AWS writes one."""
    event_id = f"{name}-{int(at.timestamp())}"
    record = {
        "eventVersion": "1.09",
        "userIdentity": {"type": "IAMUser", "principalId": "AIDAEXAMPLE", "accountId": "123456789012", "userName": username},
        "eventTime": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eventSource": source,
        "eventName": name,
        "awsRegion": "us-east-1",
        "sourceIPAddress": "203.0.113.7",
        "userAgent": "aws-cli/2.17.0",
        "requestParameters": {"queueName": "orders"},
        "responseElements": None,
        "requestID": "5e0bd3f1",
        "eventID": event_id,
        "readOnly": read_only,
        "eventType": "AwsApiCall",
        "managementEvent": True,
        "recipientAccountId": "123456789012",
        "eventCategory": "Management",
    }
    if error:
        record["errorCode"], record["errorMessage"] = error
    return {
        "EventId": event_id,
        "EventName": name,
        "ReadOnly": "true" if read_only else "false",
        "AccessKeyId": "AKIAEXAMPLE",
        "EventTime": at.timestamp(),
        "EventSource": source,
        "Username": username,
        "Resources": [{"ResourceType": kind, "ResourceName": resource} for kind, resource in resources],
        "CloudTrailEvent": json.dumps(record) if raw is None else raw,
    }


@dataclass
class FakeCloudTrail:
    """LookupEvents over a list of events, newest first, the way AWS answers it."""

    events: list[dict]
    lookups: list[dict] = field(default_factory=list)

    def __call__(self, request: RecordedRequest):
        assert request.headers["x-amz-target"] == TARGET
        body = json.loads(request.body)
        self.lookups.append(body)
        selected = [event for event in self.events if self._matches(event, body)]
        offset = int(body.get("NextToken", 0))
        size = body.get("MaxResults", 50)
        answer = {"Events": selected[offset : offset + size]}
        if offset + size < len(selected):
            answer["NextToken"] = str(offset + size)
        return 200, JSON_1_1, json.dumps(answer).encode()

    @staticmethod
    def _matches(event: dict, body: dict) -> bool:
        if "StartTime" in body and event["EventTime"] < body["StartTime"]:
            return False
        if "EndTime" in body and event["EventTime"] > body["EndTime"]:
            return False
        for attribute in body.get("LookupAttributes", []):
            if attribute["AttributeValue"] not in ATTRIBUTE_FIELDS[attribute["AttributeKey"]](event):
                return False
        return True


EVENTS = [
    cloudtrail_event("DeleteQueue", "sqs.amazonaws.com", NOW - timedelta(minutes=1), resources=(("AWS::SQS::Queue", "orders"),)),
    cloudtrail_event("ListQueues", "sqs.amazonaws.com", NOW - timedelta(minutes=2), read_only=True, username="bob"),
    cloudtrail_event(
        "GetQueueUrl", "sqs.amazonaws.com", NOW - timedelta(minutes=3), read_only=True,
        error=("AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist."),
    ),
    cloudtrail_event("CreateRole", "iam.amazonaws.com", NOW - timedelta(minutes=4), resources=(("AWS::IAM::Role", "app"),)),
    cloudtrail_event("CreateQueue", "sqs.amazonaws.com", NOW - timedelta(hours=2), resources=(("AWS::SQS::Queue", "orders"),)),
]


@pytest.fixture
def cloudtrail() -> Iterator[tuple[FakeCloudTrail, str]]:
    fake = FakeCloudTrail(list(EVENTS))
    with FakeEndpoint(handler=fake) as server:
        yield fake, server.url


def lookup(url: str, **params):
    return client.get("/api/activity/events", params={"endpoint": url, **params})


def names(response) -> list[str]:
    return [event["eventName"] for event in response.json()["events"]]


class TestEvents:
    def test_the_last_hour_newest_first(self, cloudtrail):
        fake, url = cloudtrail
        before = datetime.now(timezone.utc).replace(microsecond=0)
        response = lookup(url)
        after = datetime.now(timezone.utc)
        assert response.status_code == 200, response.text
        assert names(response) == ["DeleteQueue", "ListQueues", "GetQueueUrl", "CreateRole"]
        [sent] = fake.lookups
        assert set(sent) == {"StartTime", "MaxResults"} and sent["MaxResults"] == 50
        assert (before - timedelta(hours=1)).timestamp() <= sent["StartTime"] <= (after - timedelta(hours=1)).timestamp()
        body = response.json()
        assert body["nextToken"] is None
        assert body["endTime"] is None
        assert datetime.fromisoformat(body["startTime"]).timestamp() == sent["StartTime"]

    def test_what_the_console_shows_of_an_event(self, cloudtrail):
        _, url = cloudtrail
        [deleted, listed, failed, _] = lookup(url).json()["events"]
        assert deleted == {
            "eventId": EVENTS[0]["EventId"],
            "eventName": "DeleteQueue",
            "eventSource": "sqs.amazonaws.com",
            "eventTime": (NOW - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            "username": "alice",
            "accessKeyId": "AKIAEXAMPLE",
            "readOnly": False,
            "resources": [{"type": "AWS::SQS::Queue", "name": "orders"}],
            "errorCode": None,
            "errorMessage": None,
            "sourceIpAddress": "203.0.113.7",
            "userAgent": "aws-cli/2.17.0",
            "awsRegion": "us-east-1",
            "record": json.loads(EVENTS[0]["CloudTrailEvent"]),
            "rawRecord": None,
        }
        assert listed["readOnly"] is True and listed["username"] == "bob"
        assert failed["errorCode"] == "AWS.SimpleQueueService.NonExistentQueue"
        assert failed["errorMessage"] == "The specified queue does not exist."

    def test_a_window_is_sent_as_given_to_the_second(self, cloudtrail):
        fake, url = cloudtrail
        start, end = NOW - timedelta(hours=3), NOW - timedelta(minutes=90)
        response = lookup(url, start_time=(start + timedelta(microseconds=400)).isoformat(), end_time=end.isoformat())
        assert names(response) == ["CreateQueue"]
        assert fake.lookups == [{"StartTime": int(start.timestamp()), "EndTime": int(end.timestamp()), "MaxResults": 50}]
        assert response.json()["startTime"] == start.isoformat().replace("+00:00", "Z")
        assert response.json()["endTime"] == end.isoformat().replace("+00:00", "Z")

    def test_a_time_without_a_zone_is_utc(self, cloudtrail):
        fake, url = cloudtrail
        lookup(url, start_time="2026-11-14T10:00:00")
        assert fake.lookups[0]["StartTime"] == int(datetime(2026, 11, 14, 10, tzinfo=timezone.utc).timestamp())

    def test_an_end_alone_looks_at_the_hour_before_it(self, cloudtrail):
        fake, url = cloudtrail
        end = NOW - timedelta(minutes=90)
        lookup(url, end_time=end.isoformat())
        assert fake.lookups[0]["StartTime"] == int((end - timedelta(hours=1)).timestamp())

    def test_a_start_after_the_end_is_refused_before_any_call(self, cloudtrail):
        fake, url = cloudtrail
        response = lookup(url, start_time=NOW.isoformat(), end_time=(NOW - timedelta(minutes=1)).isoformat())
        assert response.status_code == 422
        assert "start_time is after end_time" in response.text
        assert fake.lookups == []


class TestLookupAttribute:
    def test_one_attribute_per_lookup(self, cloudtrail):
        fake, url = cloudtrail
        response = lookup(url, attribute="EventSource", value="iam.amazonaws.com")
        assert names(response) == ["CreateRole"]
        assert fake.lookups[0]["LookupAttributes"] == [{"AttributeKey": "EventSource", "AttributeValue": "iam.amazonaws.com"}]

    def test_read_only(self, cloudtrail):
        _, url = cloudtrail
        assert names(lookup(url, attribute="ReadOnly", value="false")) == ["DeleteQueue", "CreateRole"]

    @pytest.mark.parametrize(
        ("params", "message"),
        [
            ({"attribute": "EventName"}, "attribute and value go together"),
            ({"value": "CreateQueue"}, "attribute and value go together"),
            ({"attribute": "ReadOnly", "value": "yes"}, "ReadOnly is looked up as true or false"),
            ({"attribute": "Region", "value": "us-east-1"}, "Input should be"),
            ({"attribute": "EventName", "value": ""}, "at least 1 character"),
        ],
    )
    def test_incomplete_or_unknown_lookups_are_refused(self, cloudtrail, params, message):
        fake, url = cloudtrail
        response = lookup(url, **params)
        assert response.status_code == 422
        assert message in response.text
        assert fake.lookups == []

    def test_the_api_docs_list_each_parameter(self):
        parameters = app.openapi()["paths"]["/api/activity/events"]["get"]["parameters"]
        assert [parameter["name"] for parameter in parameters] == [
            "start_time", "end_time", "attribute", "value", "next_token", "max_results", "endpoint",
        ]

    def test_the_attributes_are_the_ones_cloudtrail_takes(self):
        model = botocore.session.get_session().get_service_model("cloudtrail")
        assert {attribute.value for attribute in LookupAttribute} == set(model.shape_for("LookupAttributeKey").enum)


class TestPages:
    def test_one_call_per_request_even_with_more_pages(self, cloudtrail):
        fake, url = cloudtrail
        response = lookup(url, max_results=2)
        assert names(response) == ["DeleteQueue", "ListQueues"]
        assert response.json()["nextToken"] == "2"
        assert len(fake.lookups) == 1

    def test_the_next_page_continues_the_same_lookup(self, cloudtrail):
        fake, url = cloudtrail
        first = lookup(url, attribute="EventSource", value="sqs.amazonaws.com", max_results=2).json()
        second = lookup(
            url,
            attribute="EventSource",
            value="sqs.amazonaws.com",
            max_results=2,
            start_time=first["startTime"],
            next_token=first["nextToken"],
        )
        assert names(second) == ["GetQueueUrl"]
        assert second.json()["nextToken"] is None
        assert fake.lookups[1] == {**fake.lookups[0], "NextToken": "2"}

    @pytest.mark.parametrize("size", [0, 51])
    def test_page_size_is_bounded(self, cloudtrail, size):
        fake, url = cloudtrail
        assert lookup(url, max_results=size).status_code == 422
        assert fake.lookups == []

    def test_an_endpoint_refusing_the_token_keeps_its_answer(self):
        def refuse(_request):
            body = {"__type": "InvalidNextTokenException", "Message": "The token is not valid for these parameters."}
            return 400, JSON_1_1, json.dumps(body).encode()

        with FakeEndpoint(handler=refuse) as server:
            response = lookup(server.url, next_token="stale")
        assert response.status_code == 400
        assert response.json()["detail"] == "The token is not valid for these parameters."
        assert response.json()["error"]["code"] == "InvalidNextTokenException"


class TestRecords:
    @pytest.mark.parametrize(
        "raw",
        ['{"eventVersion": "1.09", "eventName": ', "[1, 2]", "null", '{"eventName": "CreateQueue", "latency": NaN}', ""],
    )
    def test_a_record_that_is_not_a_json_object_is_kept_as_sent(self, raw):
        event = cloudtrail_event("CreateQueue", "sqs.amazonaws.com", NOW - timedelta(minutes=1), raw=raw)
        with FakeEndpoint(handler=FakeCloudTrail([event])) as server:
            response = lookup(server.url)
        assert response.status_code == 200, response.text
        [served] = response.json()["events"]
        assert served["record"] is None
        assert served["rawRecord"] == raw
        # What LookupEvents itself answered is all still there
        assert served["eventName"] == "CreateQueue"
        assert served["readOnly"] is False
        assert served["errorCode"] is None and served["sourceIpAddress"] is None

    def test_an_event_without_a_record(self):
        event = cloudtrail_event("CreateQueue", "sqs.amazonaws.com", NOW - timedelta(minutes=1))
        del event["CloudTrailEvent"], event["ReadOnly"]
        with FakeEndpoint(handler=FakeCloudTrail([event])) as server:
            [served] = lookup(server.url).json()["events"]
        assert served["record"] is None and served["rawRecord"] is None
        assert served["readOnly"] is None

    def test_read_only_as_an_emulator_writes_it_in_the_record(self):
        # Without ReadOnly in the answer, the record's says; some emulators write it as a string
        event = cloudtrail_event("ListQueues", "sqs.amazonaws.com", NOW - timedelta(minutes=1))
        del event["ReadOnly"]
        event["CloudTrailEvent"] = json.dumps({**json.loads(event["CloudTrailEvent"]), "readOnly": "true"})
        with FakeEndpoint(handler=FakeCloudTrail([event])) as server:
            [served] = lookup(server.url).json()["events"]
        assert served["readOnly"] is True


class TestUnsupported:
    def test_an_endpoint_without_lookup_events_is_not_implemented(self):
        # LocalStack's answer for a service outside its plan
        def localstack(_request):
            message = "The API for service cloudtrail is either not included in your current license plan or has not yet been emulated by LocalStack."
            return 501, JSON_1_1, json.dumps({"__type": "InternalFailure", "message": message}).encode()

        with FakeEndpoint(handler=localstack) as server:
            response = lookup(server.url)
        assert response.status_code == 501
        error = response.json()["error"]
        assert error["kind"] == "not_implemented"
        assert error["operation"] == "LookupEvents"

    def test_an_unknown_operation_is_not_implemented(self):
        def unknown(_request):
            body = {"__type": "UnknownOperationException", "message": "Unknown operation LookupEvents"}
            return 400, JSON_1_1, json.dumps(body).encode()

        with FakeEndpoint(handler=unknown) as server:
            response = lookup(server.url)
        assert response.status_code == 501
        assert response.json()["error"]["kind"] == "not_implemented"
