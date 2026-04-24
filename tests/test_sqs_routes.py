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
