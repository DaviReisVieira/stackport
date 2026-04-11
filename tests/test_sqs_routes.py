"""Integration tests for SQS API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

QUEUE_URL = "http://localhost:4566/000000000000/test-queue"


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
