"""Tests for the SNS routes (#75)."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app

ARN = "arn:aws:sns:us-east-1:000000000000:orders"


@pytest.fixture
def client():
    return TestClient(app)


def _mock_sns():
    sns = MagicMock()
    sns.list_topics.return_value = {"Topics": [{"TopicArn": ARN}]}
    sns.get_topic_attributes.return_value = {
        "Attributes": {
            "DisplayName": "Orders",
            "FifoTopic": "false",
            "SubscriptionsConfirmed": "2",
            "SubscriptionsPending": "0",
            "Owner": "000000000000",
        }
    }
    sns.list_subscriptions_by_topic.return_value = {
        "Subscriptions": [
            {
                "SubscriptionArn": f"{ARN}:sub-1",
                "Protocol": "sqs",
                "Endpoint": "arn:aws:sqs:us-east-1:000000000000:orders-q",
                "Owner": "000000000000",
            }
        ]
    }
    sns.get_subscription_attributes.return_value = {
        "Attributes": {"FilterPolicy": '{"type": ["order"]}', "RawMessageDelivery": "true"}
    }
    return sns


class TestTopics:
    @patch("backend.routes.sns.get_client")
    def test_list_topics_enriched(self, mock_client, client):
        mock_client.return_value = _mock_sns()
        response = client.get("/api/sns/topics")
        assert response.status_code == 200
        topic = response.json()["topics"][0]
        assert topic["name"] == "orders"
        assert topic["displayName"] == "Orders"
        assert topic["fifo"] is False
        assert topic["subscriptionsConfirmed"] == 2

    @patch("backend.routes.sns.get_client")
    def test_list_topics_follows_pagination(self, mock_client, client):
        sns = _mock_sns()
        sns.list_topics.side_effect = [
            {"Topics": [{"TopicArn": ARN}], "NextToken": "t1"},
            {"Topics": [{"TopicArn": f"{ARN}-2"}]},
        ]
        mock_client.return_value = sns

        response = client.get("/api/sns/topics")
        assert response.status_code == 200
        assert len(response.json()["topics"]) == 2
        assert sns.list_topics.call_count == 2
        assert sns.list_topics.call_args_list[1].kwargs == {"NextToken": "t1"}

    @patch("backend.routes.sns.get_client")
    def test_get_topic_with_subscriptions(self, mock_client, client):
        mock_client.return_value = _mock_sns()
        response = client.get(f"/api/sns/topics/{ARN}")
        assert response.status_code == 200
        data = response.json()
        assert data["arn"] == ARN
        sub = data["subscriptions"][0]
        assert sub["protocol"] == "sqs"
        assert sub["filterPolicy"] == {"type": ["order"]}
        assert sub["rawMessageDelivery"] is True

    @patch("backend.routes.sns.get_client")
    def test_create_standard_topic(self, mock_client, client):
        sns = _mock_sns()
        sns.create_topic.return_value = {"TopicArn": ARN}
        mock_client.return_value = sns

        response = client.post("/api/sns/topics", json={"name": "orders", "displayName": "Orders"})
        assert response.status_code == 201
        sns.create_topic.assert_called_once_with(Name="orders", Attributes={"DisplayName": "Orders"})

    @patch("backend.routes.sns.get_client")
    def test_create_fifo_topic_appends_suffix(self, mock_client, client):
        sns = _mock_sns()
        sns.create_topic.return_value = {"TopicArn": f"{ARN}.fifo"}
        mock_client.return_value = sns

        response = client.post(
            "/api/sns/topics", json={"name": "orders", "fifo": True, "contentBasedDeduplication": True}
        )
        assert response.status_code == 201
        assert response.json()["name"] == "orders.fifo"
        kwargs = sns.create_topic.call_args.kwargs
        assert kwargs["Name"] == "orders.fifo"
        assert kwargs["Attributes"] == {"FifoTopic": "true", "ContentBasedDeduplication": "true"}

    @patch("backend.routes.sns.get_client")
    def test_delete_topic(self, mock_client, client):
        sns = _mock_sns()
        mock_client.return_value = sns
        response = client.delete(f"/api/sns/topics/{ARN}")
        assert response.status_code == 200
        sns.delete_topic.assert_called_once_with(TopicArn=ARN)


class TestSubscriptions:
    @patch("backend.routes.sns.get_client")
    def test_subscribe_with_filter_policy(self, mock_client, client):
        sns = _mock_sns()
        sns.subscribe.return_value = {"SubscriptionArn": f"{ARN}:sub-2"}
        mock_client.return_value = sns

        response = client.post(
            f"/api/sns/topics/{ARN}/subscriptions",
            json={
                "protocol": "sqs",
                "endpoint": "arn:aws:sqs:us-east-1:000000000000:orders-q",
                "filterPolicy": {"type": ["order"]},
            },
        )
        assert response.status_code == 201
        kwargs = sns.subscribe.call_args.kwargs
        assert kwargs["Protocol"] == "sqs"
        assert kwargs["Attributes"] == {"FilterPolicy": '{"type": ["order"]}'}
        assert kwargs["ReturnSubscriptionArn"] is True

    @patch("backend.routes.sns.get_client")
    def test_subscribe_with_raw_message_delivery(self, mock_client, client):
        sns = _mock_sns()
        sns.subscribe.return_value = {"SubscriptionArn": f"{ARN}:sub-3"}
        mock_client.return_value = sns

        response = client.post(
            f"/api/sns/topics/{ARN}/subscriptions",
            json={"protocol": "sqs", "endpoint": "arn:aws:sqs:us-east-1:0:q", "rawMessageDelivery": True},
        )
        assert response.status_code == 201
        assert sns.subscribe.call_args.kwargs["Attributes"] == {"RawMessageDelivery": "true"}

    @patch("backend.routes.sns.get_client")
    def test_unsubscribe(self, mock_client, client):
        sns = _mock_sns()
        mock_client.return_value = sns
        response = client.delete(f"/api/sns/subscriptions/{ARN}:sub-1")
        assert response.status_code == 200
        sns.unsubscribe.assert_called_once_with(SubscriptionArn=f"{ARN}:sub-1")


class TestPublish:
    @patch("backend.routes.sns.get_client")
    def test_publish_with_attributes(self, mock_client, client):
        sns = _mock_sns()
        sns.publish.return_value = {"MessageId": "m-1"}
        mock_client.return_value = sns

        response = client.post(
            f"/api/sns/topics/{ARN}/publish",
            json={
                "subject": "hi",
                "message": "hello",
                "messageAttributes": {"type": {"dataType": "String", "stringValue": "order"}},
            },
        )
        assert response.status_code == 200
        assert response.json() == {"messageId": "m-1"}
        kwargs = sns.publish.call_args.kwargs
        assert kwargs["Subject"] == "hi"
        assert kwargs["MessageAttributes"] == {"type": {"DataType": "String", "StringValue": "order"}}

    @patch("backend.routes.sns.get_client")
    def test_publish_fifo_fields(self, mock_client, client):
        sns = _mock_sns()
        sns.publish.return_value = {"MessageId": "m-2"}
        mock_client.return_value = sns

        response = client.post(
            f"/api/sns/topics/{ARN}/publish",
            json={"message": "hello", "messageGroupId": "g1", "messageDeduplicationId": "d1"},
        )
        assert response.status_code == 200
        kwargs = sns.publish.call_args.kwargs
        assert kwargs["MessageGroupId"] == "g1"
        assert kwargs["MessageDeduplicationId"] == "d1"
        assert "Subject" not in kwargs
