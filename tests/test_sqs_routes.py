"""Integration tests for SQS API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from collections.abc import Iterator
from pathlib import Path
from unittest.mock import MagicMock, patch

import boto3
import botocore.session
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend.aws_emulator import AwsEmulatorFilesError
from backend.main import app
from backend.routes import sqs as sqs_routes

client = TestClient(app)

QUEUE_URL = "http://localhost:4566/000000000000/test-queue"

# Attribute names real SQS accepts. botocore does not reject unknown map keys
# client-side, and emulators often store them as-is, so a misspelled name only
# fails on AWS (InvalidAttributeName). Check against the service model instead.
VALID_QUEUE_ATTRIBUTES = set(
    botocore.session.get_session()
    .get_service_model("sqs")
    .shape_for("QueueAttributeName")
    .enum
)


def assert_valid_queue_attributes(attributes):
    unknown = set(attributes) - VALID_QUEUE_ATTRIBUTES
    assert not unknown, f"Unknown SQS queue attribute names: {sorted(unknown)}"


class TestListQueues:
    @patch("backend.routes.sqs.get_client")
    def test_list_queues_empty(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.list_queues.return_value = {}

        resp = client.get("/api/sqs/queues")
        assert resp.status_code == 200
        data = resp.json()
        assert data["queues"] == []

    @patch("backend.routes.sqs.get_client")
    def test_list_queues_with_data(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.list_queues.return_value = {"QueueUrls": [QUEUE_URL]}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {
                "ApproximateNumberOfMessages": "5",
                "ApproximateNumberOfMessagesNotVisible": "1",
                "ApproximateNumberOfMessagesDelayed": "0",
                "VisibilityTimeout": "30",
                "MessageRetentionPeriod": "345600",
                "DelaySeconds": "0",
            }
        }
        mock_sqs.list_queue_tags.return_value = {"Tags": {"env": "test"}}

        resp = client.get("/api/sqs/queues")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["queues"]) == 1
        q = data["queues"][0]
        assert q["name"] == "test-queue"
        assert q["url"] == QUEUE_URL
        assert q["type"] == "Standard"
        assert q["approximateNumberOfMessages"] == 5
        assert q["tags"] == {"env": "test"}

    @patch("backend.routes.sqs.get_client")
    def test_list_queues_fifo(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        fifo_url = "http://localhost:4566/000000000000/orders.fifo"
        mock_sqs.list_queues.return_value = {"QueueUrls": [fifo_url]}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"FifoQueue": "true"}
        }
        mock_sqs.list_queue_tags.return_value = {"Tags": {}}

        resp = client.get("/api/sqs/queues")
        assert resp.status_code == 200
        data = resp.json()
        assert data["queues"][0]["type"] == "FIFO"
        assert data["queues"][0]["name"] == "orders.fifo"

    @patch("backend.routes.sqs.get_client")
    def test_list_queues_with_redrive_policy(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.list_queues.return_value = {"QueueUrls": [QUEUE_URL]}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {
                "RedrivePolicy": '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:000:dlq","maxReceiveCount":3}',
            }
        }
        mock_sqs.list_queue_tags.return_value = {"Tags": {}}

        resp = client.get("/api/sqs/queues")
        assert resp.status_code == 200
        rp = resp.json()["queues"][0]["redrivePolicy"]
        assert rp is not None
        assert rp["maxReceiveCount"] == 3


class TestGetQueueDetail:
    @patch("backend.routes.sqs.get_client")
    def test_get_queue_detail(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {
                "QueueArn": "arn:aws:sqs:us-east-1:000:test-queue",
                "ApproximateNumberOfMessages": "10",
                "ApproximateNumberOfMessagesNotVisible": "2",
                "ApproximateNumberOfMessagesDelayed": "0",
                "VisibilityTimeout": "60",
                "MessageRetentionPeriod": "86400",
                "MaximumMessageSize": "262144",
                "DelaySeconds": "5",
                "ContentBasedDeduplication": "false",
            }
        }
        mock_sqs.list_queue_tags.return_value = {"Tags": {"team": "backend"}}

        resp = client.get("/api/sqs/queues/test-queue")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test-queue"
        assert data["arn"] == "arn:aws:sqs:us-east-1:000:test-queue"
        assert data["approximateNumberOfMessages"] == 10
        assert data["maximumMessageSize"] == 262144
        assert data["delaySeconds"] == 5
        assert data["contentBasedDeduplication"] is False
        assert data["tags"] == {"team": "backend"}

    @patch("backend.routes.sqs.get_client")
    def test_get_queue_not_found(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.side_effect = mock_sqs.exceptions.QueueDoesNotExist()

        resp = client.get("/api/sqs/queues/nonexistent")
        assert resp.status_code == 404


class TestSendMessage:
    @patch("backend.routes.sqs.get_client")
    def test_send_basic_message(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message.return_value = {
            "MessageId": "msg-123",
            "MD5OfMessageBody": "abc",
        }

        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={"messageBody": "hello world"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["messageId"] == "msg-123"
        assert data["md5OfMessageBody"] == "abc"

    @patch("backend.routes.sqs.get_client")
    def test_send_message_with_attributes(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message.return_value = {
            "MessageId": "msg-456",
            "MD5OfMessageBody": "def",
        }

        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={
                "messageBody": "test",
                "delaySeconds": 10,
                "messageAttributes": {
                    "source": {"stringValue": "api", "dataType": "String"}
                },
            },
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.send_message.call_args[1]
        assert call_kwargs["DelaySeconds"] == 10
        assert "MessageAttributes" in call_kwargs

    @patch("backend.routes.sqs.get_client")
    def test_send_message_fifo_params(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message.return_value = {
            "MessageId": "msg-789",
            "MD5OfMessageBody": "ghi",
            "SequenceNumber": "1",
        }

        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={
                "messageBody": "fifo test",
                "messageDeduplicationId": "dedup-1",
                "messageGroupId": "group-1",
            },
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.send_message.call_args[1]
        assert call_kwargs["MessageDeduplicationId"] == "dedup-1"
        assert call_kwargs["MessageGroupId"] == "group-1"


class TestReceiveMessages:
    @patch("backend.routes.sqs.get_client")
    def test_receive_messages(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.receive_message.return_value = {
            "Messages": [
                {
                    "MessageId": "msg-1",
                    "ReceiptHandle": "handle-1",
                    "Body": "hello",
                    "MD5OfBody": "abc",
                    "Attributes": {"SentTimestamp": "1234567890"},
                    "MessageAttributes": {},
                }
            ]
        }

        resp = client.get("/api/sqs/queues/test-queue/messages")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["messages"]) == 1
        assert data["messages"][0]["messageId"] == "msg-1"
        assert data["messages"][0]["body"] == "hello"

    @patch("backend.routes.sqs.get_client")
    def test_receive_messages_empty(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.receive_message.return_value = {}

        resp = client.get("/api/sqs/queues/test-queue/messages")
        assert resp.status_code == 200
        data = resp.json()
        assert data["messages"] == []

    @patch("backend.routes.sqs.get_client")
    def test_receive_messages_with_params(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.receive_message.return_value = {"Messages": []}

        resp = client.get("/api/sqs/queues/test-queue/messages?max_messages=5&visibility_timeout=30")
        assert resp.status_code == 200
        call_kwargs = mock_sqs.receive_message.call_args[1]
        assert call_kwargs["MaxNumberOfMessages"] == 5
        assert call_kwargs["VisibilityTimeout"] == 30


class TestDeleteMessage:
    @patch("backend.routes.sqs.get_client")
    def test_delete_message(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.delete("/api/sqs/queues/test-queue/messages?receipt_handle=handle-1")
        assert resp.status_code == 204


class TestPurgeQueue:
    @patch("backend.routes.sqs.get_client")
    def test_purge_queue(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.post("/api/sqs/queues/test-queue/purge")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    @patch("backend.routes.sqs.get_client")
    def test_purge_queue_not_found(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.side_effect = mock_sqs.exceptions.QueueDoesNotExist()

        resp = client.post("/api/sqs/queues/nonexistent/purge")
        assert resp.status_code == 404


class TestCreateQueue:
    @patch("backend.routes.sqs.get_client")
    def test_create_standard_queue(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:test-queue"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={"queueName": "test-queue", "queueType": "Standard"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["queueName"] == "test-queue"
        assert data["queueUrl"] == QUEUE_URL
        assert data["queueArn"] == "arn:aws:sqs:us-east-1:000:test-queue"

    @patch("backend.routes.sqs.get_client")
    def test_create_fifo_queue(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        fifo_url = "http://localhost:4566/000000000000/orders.fifo"
        mock_sqs.create_queue.return_value = {"QueueUrl": fifo_url}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:orders.fifo"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={"queueName": "orders.fifo", "queueType": "FIFO"},
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.create_queue.call_args[1]
        assert call_kwargs["Attributes"]["FifoQueue"] == "true"

    @patch("backend.routes.sqs.get_client")
    def test_create_fifo_queue_auto_appends_suffix(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        fifo_url = "http://localhost:4566/000000000000/orders.fifo"
        mock_sqs.create_queue.return_value = {"QueueUrl": fifo_url}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:orders.fifo"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={"queueName": "orders", "queueType": "FIFO"},
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.create_queue.call_args[1]
        assert call_kwargs["QueueName"] == "orders.fifo"

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_with_attributes(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:test-queue"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "test-queue",
                "visibilityTimeout": 60,
                "messageRetentionPeriod": 1209600,
                "delaySeconds": 10,
            },
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.create_queue.call_args[1]
        attrs = call_kwargs["Attributes"]
        assert attrs["VisibilityTimeout"] == "60"
        assert attrs["MessageRetentionPeriod"] == "1209600"
        assert attrs["DelaySeconds"] == "10"

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_sends_receive_wait_time_seconds(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:test-queue"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={"queueName": "test-queue", "receiveMessageWaitTime": 10},
        )
        assert resp.status_code == 200
        attrs = mock_sqs.create_queue.call_args[1]["Attributes"]
        assert attrs["ReceiveMessageWaitTimeSeconds"] == "10"
        assert "ReceiveMessageWaitTime" not in attrs

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_attribute_names_are_valid(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.side_effect = mock_sqs.exceptions.QueueDoesNotExist()
        mock_sqs.create_queue.side_effect = [
            {"QueueUrl": "http://localhost:4566/000000000000/orders-dlq.fifo"},
            {"QueueUrl": "http://localhost:4566/000000000000/orders.fifo"},
        ]
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:orders.fifo"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "orders",
                "queueType": "FIFO",
                "contentBasedDeduplication": True,
                "visibilityTimeout": 60,
                "messageRetentionPeriod": 86400,
                "delaySeconds": 5,
                "maximumMessageSize": 2048,
                "receiveMessageWaitTime": 10,
                "dlqEnabled": True,
                "sqsManagedSseEnabled": False,
                "kmsMasterKeyId": "alias/aws/sqs",
            },
        )
        assert resp.status_code == 200
        assert mock_sqs.create_queue.call_count == 2
        for call in mock_sqs.create_queue.call_args_list:
            assert_valid_queue_attributes(call[1]["Attributes"])

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_with_redrive_policy(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:test-queue"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "test-queue",
                "redrivePolicy": {
                    "deadLetterTargetArn": "arn:aws:sqs:us-east-1:000:dlq",
                    "maxReceiveCount": 5,
                },
            },
        )
        assert resp.status_code == 200
        call_kwargs = mock_sqs.create_queue.call_args[1]
        assert "RedrivePolicy" in call_kwargs["Attributes"]

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_with_tags(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.return_value = {
            "Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000:test-queue"}
        }

        resp = client.post(
            "/api/sqs/queues",
            json={"queueName": "test-queue", "tags": {"env": "dev", "team": "backend"}},
        )
        assert resp.status_code == 200
        mock_sqs.tag_queue.assert_called_once()


class TestCreateQueueWithDLQ:
    @patch("backend.routes.sqs.get_client")
    def test_create_queue_with_dlq_auto_creation(self, mock_get_client):
        """DLQ auto-creation: creates DLQ, fetches its ARN, sets redrive policy."""
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.exceptions.QueueDoesNotExist = QueueDoesNotExist

        # DLQ does not exist yet
        mock_sqs.get_queue_url.side_effect = QueueDoesNotExist()

        dlq_url = "http://localhost:4566/000000000000/test-queue-dlq"
        dlq_arn = "arn:aws:sqs:us-east-1:000:test-queue-dlq"
        main_url = QUEUE_URL
        main_arn = "arn:aws:sqs:us-east-1:000:test-queue"

        # First create_queue call is for DLQ, second is for main queue
        mock_sqs.create_queue.side_effect = [
            {"QueueUrl": dlq_url},
            {"QueueUrl": main_url},
        ]
        # get_queue_attributes called for DLQ ARN, then main queue ARN
        mock_sqs.get_queue_attributes.side_effect = [
            {"Attributes": {"QueueArn": dlq_arn}},
            {"Attributes": {"QueueArn": main_arn}},
        ]

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "test-queue",
                "queueType": "Standard",
                "dlqEnabled": True,
                "maxReceiveCount": 3,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["queueName"] == "test-queue"
        assert data["queueArn"] == main_arn
        assert data["dlqQueueName"] == "test-queue-dlq"

        # Verify DLQ was created
        assert mock_sqs.create_queue.call_count == 2
        dlq_create_kwargs = mock_sqs.create_queue.call_args_list[0][1]
        assert dlq_create_kwargs["QueueName"] == "test-queue-dlq"

        # Verify redrive policy was set on the main queue
        main_create_kwargs = mock_sqs.create_queue.call_args_list[1][1]
        import json
        redrive = json.loads(main_create_kwargs["Attributes"]["RedrivePolicy"])
        assert redrive["deadLetterTargetArn"] == dlq_arn
        assert redrive["maxReceiveCount"] == 3

    @patch("backend.routes.sqs.get_client")
    def test_create_fifo_queue_with_dlq_auto_creation(self, mock_get_client):
        """FIFO DLQ auto-creation: DLQ gets -dlq.fifo suffix."""
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.exceptions.QueueDoesNotExist = QueueDoesNotExist

        mock_sqs.get_queue_url.side_effect = QueueDoesNotExist()

        dlq_url = "http://localhost:4566/000000000000/orders-dlq.fifo"
        dlq_arn = "arn:aws:sqs:us-east-1:000:orders-dlq.fifo"
        main_url = "http://localhost:4566/000000000000/orders.fifo"
        main_arn = "arn:aws:sqs:us-east-1:000:orders.fifo"

        mock_sqs.create_queue.side_effect = [
            {"QueueUrl": dlq_url},
            {"QueueUrl": main_url},
        ]
        mock_sqs.get_queue_attributes.side_effect = [
            {"Attributes": {"QueueArn": dlq_arn}},
            {"Attributes": {"QueueArn": main_arn}},
        ]

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "orders",
                "queueType": "FIFO",
                "dlqEnabled": True,
                "maxReceiveCount": 5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["queueName"] == "orders.fifo"
        assert data["dlqQueueName"] == "orders-dlq.fifo"

        dlq_create_kwargs = mock_sqs.create_queue.call_args_list[0][1]
        assert dlq_create_kwargs["QueueName"] == "orders-dlq.fifo"
        assert dlq_create_kwargs["Attributes"]["FifoQueue"] == "true"

    @patch("backend.routes.sqs.get_client")
    def test_create_queue_with_existing_dlq(self, mock_get_client):
        """When DLQ already exists, reuse it instead of creating."""
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})

        dlq_url = "http://localhost:4566/000000000000/test-queue-dlq"
        dlq_arn = "arn:aws:sqs:us-east-1:000:test-queue-dlq"
        main_arn = "arn:aws:sqs:us-east-1:000:test-queue"

        # DLQ already exists
        mock_sqs.get_queue_url.return_value = {"QueueUrl": dlq_url}

        mock_sqs.create_queue.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.get_queue_attributes.side_effect = [
            {"Attributes": {"QueueArn": dlq_arn}},  # DLQ ARN lookup
            {"Attributes": {"QueueArn": main_arn}},  # Main queue ARN
        ]

        resp = client.post(
            "/api/sqs/queues",
            json={
                "queueName": "test-queue",
                "dlqEnabled": True,
                "maxReceiveCount": 10,
            },
        )
        assert resp.status_code == 200
        # Only one create_queue call (for main queue, not DLQ)
        assert mock_sqs.create_queue.call_count == 1


class TestDeleteQueue:
    @patch("backend.routes.sqs.get_client")
    def test_delete_queue(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.delete("/api/sqs/queues/test-queue")
        assert resp.status_code == 204

    @patch("backend.routes.sqs.get_client")
    def test_delete_queue_not_found(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.side_effect = mock_sqs.exceptions.QueueDoesNotExist()

        resp = client.delete("/api/sqs/queues/nonexistent")
        assert resp.status_code == 404


class TestUpdateQueueAttributes:
    @patch("backend.routes.sqs.get_client")
    def test_update_queue_attributes(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put(
            "/api/sqs/queues/test-queue/attributes",
            json={
                "visibilityTimeout": 90,
                "messageRetentionPeriod": 604800,
                "delaySeconds": 15,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    @patch("backend.routes.sqs.get_client")
    def test_update_queue_attributes_sends_valid_names(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put(
            "/api/sqs/queues/test-queue/attributes",
            json={
                "visibilityTimeout": 90,
                "messageRetentionPeriod": 604800,
                "delaySeconds": 15,
                "maximumMessageSize": 4096,
                "receiveMessageWaitTime": 10,
            },
        )
        assert resp.status_code == 200
        mock_sqs.set_queue_attributes.assert_called_once_with(
            QueueUrl=QUEUE_URL,
            Attributes={
                "VisibilityTimeout": "90",
                "MessageRetentionPeriod": "604800",
                "DelaySeconds": "15",
                "MaximumMessageSize": "4096",
                "ReceiveMessageWaitTimeSeconds": "10",
            },
        )
        attrs = mock_sqs.set_queue_attributes.call_args[1]["Attributes"]
        assert_valid_queue_attributes(attrs)

    @patch("backend.routes.sqs.get_client")
    def test_update_queue_attributes_empty(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put("/api/sqs/queues/test-queue/attributes", json={})
        assert resp.status_code == 400


class TestSendMessageBatch:
    @patch("backend.routes.sqs.get_client")
    def test_send_message_batch(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message_batch.return_value = {
            "Successful": [
                {"Id": "msg1", "MessageId": "msg-id-1"},
                {"Id": "msg2", "MessageId": "msg-id-2"},
            ],
            "Failed": [],
        }

        resp = client.post(
            "/api/sqs/queues/test-queue/messages/batch",
            json={
                "entries": [
                    {"id": "msg1", "messageBody": "first message"},
                    {"id": "msg2", "messageBody": "second message"},
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["successful"]) == 2
        assert data["successful"][0]["messageId"] == "msg-id-1"

    @patch("backend.routes.sqs.get_client")
    def test_send_message_batch_with_fifo_params(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message_batch.return_value = {"Successful": [], "Failed": []}

        resp = client.post(
            "/api/sqs/queues/test-queue/messages/batch",
            json={
                "entries": [
                    {
                        "id": "msg1",
                        "messageBody": "fifo msg",
                        "messageDeduplicationId": "dedup-1",
                        "messageGroupId": "group-1",
                    }
                ]
            },
        )
        assert resp.status_code == 200

    @patch("backend.routes.sqs.get_client")
    def test_send_message_batch_too_many(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        entries = [{"id": f"msg{i}", "messageBody": f"message {i}"} for i in range(11)]
        resp = client.post(
            "/api/sqs/queues/test-queue/messages/batch",
            json={"entries": entries},
        )
        assert resp.status_code == 422

    @patch("backend.routes.sqs.get_client")
    def test_send_message_batch_partial_failure(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}
        mock_sqs.send_message_batch.return_value = {
            "Successful": [{"Id": "msg1", "MessageId": "msg-id-1"}],
            "Failed": [{"Id": "msg2", "Code": "InvalidParameter", "Message": "Bad body"}],
        }

        resp = client.post(
            "/api/sqs/queues/test-queue/messages/batch",
            json={
                "entries": [
                    {"id": "msg1", "messageBody": "good"},
                    {"id": "msg2", "messageBody": "bad"},
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["successful"]) == 1
        assert len(data["failed"]) == 1


class TestDeleteMessagesBatch:
    @patch("backend.routes.sqs.get_client")
    def test_delete_messages_batch(self, mock_get_client):
        import json as json_mod
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.request(
            "DELETE",
            "/api/sqs/queues/test-queue/messages/batch",
            content=json_mod.dumps({"receiptHandles": ["handle-1", "handle-2", "handle-3"]}).encode(),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 204

    @patch("backend.routes.sqs.get_client")
    def test_delete_messages_batch_too_many(self, mock_get_client):
        import json as json_mod
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        handles = [f"handle-{i}" for i in range(11)]
        resp = client.request(
            "DELETE",
            "/api/sqs/queues/test-queue/messages/batch",
            content=json_mod.dumps({"receiptHandles": handles}).encode(),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 422


class TestUpdateRedrivePolicy:
    @patch("backend.routes.sqs.get_client")
    def test_update_redrive_policy(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put(
            "/api/sqs/queues/test-queue/redrive-policy",
            json={
                "deadLetterTargetArn": "arn:aws:sqs:us-east-1:000:dlq",
                "maxReceiveCount": 10,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert_valid_queue_attributes(mock_sqs.set_queue_attributes.call_args[1]["Attributes"])

    @patch("backend.routes.sqs.get_client")
    def test_update_redrive_policy_missing_arn(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put(
            "/api/sqs/queues/test-queue/redrive-policy",
            json={"maxReceiveCount": 5},
        )
        assert resp.status_code == 422

    @patch("backend.routes.sqs.get_client")
    def test_update_redrive_policy_invalid_count(self, mock_get_client):
        mock_sqs = MagicMock()
        mock_get_client.return_value = mock_sqs
        mock_sqs.exceptions.QueueDoesNotExist = type("QueueDoesNotExist", (Exception,), {})
        mock_sqs.get_queue_url.return_value = {"QueueUrl": QUEUE_URL}

        resp = client.put(
            "/api/sqs/queues/test-queue/redrive-policy",
            json={
                "deadLetterTargetArn": "arn:aws:sqs:us-east-1:000:dlq",
                "maxReceiveCount": 0,
            },
        )
        assert resp.status_code == 422


# --- Through a real boto3 client --------------------------------------------
# The tests below stub the endpoint's answers on a real SQS client, so request
# parameters, responses and errors all go through botocore as they do live.


@pytest.fixture
def sqs_stub(monkeypatch) -> Iterator[Stubber]:
    sqs = boto3.client(
        "sqs",
        region_name="us-east-1",
        endpoint_url="http://localhost:4566",
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    monkeypatch.setattr(sqs_routes, "get_client", lambda service_name, **_kwargs: sqs)
    with Stubber(sqs) as stubber:
        yield stubber
        stubber.assert_no_pending_responses()


class TestQueueDetailFromTheEndpoint:
    def test_reports_the_receive_wait_time(self, sqs_stub):
        # Edit settings starts its form from the detail: without the wait time
        # it sent 0, turning long polling off whenever any setting was saved.
        sqs_stub.add_response("get_queue_url", {"QueueUrl": QUEUE_URL}, {"QueueName": "test-queue"})
        sqs_stub.add_response(
            "get_queue_attributes",
            {"Attributes": {"QueueArn": "arn:aws:sqs:us-east-1:000000000000:test-queue", "ReceiveMessageWaitTimeSeconds": "10"}},
            {"QueueUrl": QUEUE_URL, "AttributeNames": ["All"]},
        )
        sqs_stub.add_response("list_queue_tags", {"Tags": {}}, {"QueueUrl": QUEUE_URL})

        resp = client.get("/api/sqs/queues/test-queue")
        assert resp.status_code == 200
        assert resp.json()["receiveMessageWaitTime"] == 10


class TestSendMessageValidation:
    """Malformed messages are refused before anything reaches the endpoint."""

    @pytest.mark.parametrize(
        ("attributes", "bad_field"),
        [
            # AWS's own casing: the attribute used to arrive with an empty value
            # (AWS Emulator answered a 500, moto stored an empty attribute).
            ({"priority": {"DataType": "String", "StringValue": "high"}}, "StringValue"),
            ({"priority": {"dataType": "String", "stringValue": ""}}, "stringValue"),
            # The route only sends string values, so a binary attribute can't work.
            ({"payload": {"dataType": "Binary", "stringValue": "aGk="}}, "dataType"),
        ],
    )
    def test_invalid_message_attributes(self, sqs_stub, attributes, bad_field):
        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={"messageBody": "x", "messageAttributes": attributes},
        )
        assert resp.status_code == 422
        (name,) = attributes
        assert ["body", "messageAttributes", name, bad_field] in [err["loc"] for err in resp.json()["detail"]]

    def test_unknown_top_level_field(self, sqs_stub):
        # Dropping it silently sent the message without its attributes.
        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={"messageBody": "x", "MessageAttributes": {"priority": {"DataType": "String", "StringValue": "high"}}},
        )
        assert resp.status_code == 422
        assert ["body", "MessageAttributes"] in [err["loc"] for err in resp.json()["detail"]]

    def test_valid_message_attributes_are_sent(self, sqs_stub):
        sqs_stub.add_response("get_queue_url", {"QueueUrl": QUEUE_URL})
        sqs_stub.add_response(
            "send_message",
            {"MessageId": "m-1", "MD5OfMessageBody": "md5"},
            {
                "QueueUrl": QUEUE_URL,
                "MessageBody": "x",
                "MessageAttributes": {
                    "priority": {"DataType": "String", "StringValue": "high"},
                    "attempt": {"DataType": "Number.int", "StringValue": "2"},
                },
            },
        )
        resp = client.post(
            "/api/sqs/queues/test-queue/messages",
            json={
                "messageBody": "x",
                "messageAttributes": {
                    "priority": {"stringValue": "high"},
                    "attempt": {"dataType": "Number.int", "stringValue": "2"},
                },
            },
        )
        assert resp.status_code == 200


ENDPOINT_ERROR = "Value 10 for parameter MessageRetentionPeriod is invalid."

# (method, path, body, the operation the endpoint refuses). All but the first
# two look the queue URL up first.
SQS_CALLS = [
    ("GET", "/api/sqs/queues", None, "list_queues"),
    ("POST", "/api/sqs/queues", {"queueName": "q"}, "create_queue"),
    ("GET", "/api/sqs/queues/q", None, "get_queue_attributes"),
    ("POST", "/api/sqs/queues/q/messages", {"messageBody": "x"}, "send_message"),
    ("GET", "/api/sqs/queues/q/messages", None, "receive_message"),
    ("DELETE", "/api/sqs/queues/q/messages?receipt_handle=rh", None, "delete_message"),
    ("POST", "/api/sqs/queues/q/purge", None, "purge_queue"),
    ("DELETE", "/api/sqs/queues/q", None, "delete_queue"),
    ("PUT", "/api/sqs/queues/q/attributes", {"messageRetentionPeriod": 10}, "set_queue_attributes"),
    ("POST", "/api/sqs/queues/q/messages/batch", {"entries": [{"id": "1", "messageBody": "x"}]}, "send_message_batch"),
    ("DELETE", "/api/sqs/queues/q/messages/batch", {"receiptHandles": ["rh"]}, "delete_message_batch"),
    (
        "PUT",
        "/api/sqs/queues/q/redrive-policy",
        {"deadLetterTargetArn": "arn:aws:sqs:us-east-1:000000000000:dlq", "maxReceiveCount": 3},
        "set_queue_attributes",
    ),
]


class TestEndpointErrors:
    @pytest.mark.parametrize(("method", "path", "body", "operation"), SQS_CALLS)
    def test_the_endpoints_4xx_is_the_answer(self, sqs_stub, method, path, body, operation):
        """A request the endpoint refuses is a 4xx with its message, not a StackPort 500."""
        if operation not in ("list_queues", "create_queue"):
            sqs_stub.add_response("get_queue_url", {"QueueUrl": QUEUE_URL})
        sqs_stub.add_client_error(
            operation, service_error_code="InvalidParameterValue", service_message=ENDPOINT_ERROR, http_status_code=400
        )

        resp = client.request(method, path, json=body)
        assert resp.status_code == 400
        assert resp.json()["detail"] == ENDPOINT_ERROR
        assert resp.json()["error"]["code"] == "InvalidParameterValue"

    def test_a_missing_queue_is_still_a_404(self, sqs_stub):
        sqs_stub.add_client_error("get_queue_url", service_error_code="QueueDoesNotExist", http_status_code=400)
        resp = client.post("/api/sqs/queues/q/messages", json={"messageBody": "x"})
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Queue q not found"

    @pytest.mark.parametrize(("method", "path", "body"), [call[:3] for call in SQS_CALLS])
    def test_unreadable_aws_emulator_files(self, monkeypatch, method, path, body):
        """Building the client can fail too: that is a credentials problem with a hint, not a bare 500."""

        def get_client(service_name, **_kwargs):
            raise AwsEmulatorFilesError(Path("/home/me/.aws/emulator/9297/emulator_credentials"), "permission denied")

        monkeypatch.setattr(sqs_routes, "get_client", get_client)
        resp = client.request(method, path, json=body)
        assert resp.status_code == 401
        assert resp.json()["error"]["kind"] == "credentials"
