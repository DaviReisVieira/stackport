"""SQS service-specific routes."""

import json
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from backend.aws_client import get_client

router = APIRouter()


def _extract_queue_name(queue_url: str) -> str:
    """Extract queue name from SQS URL."""
    return queue_url.rsplit("/", 1)[-1]


def _parse_redrive_policy(redrive_policy_json: str | None) -> dict[str, Any] | None:
    """Parse RedrivePolicy JSON string into structured dict."""
    if not redrive_policy_json:
        return None
    try:
        return json.loads(redrive_policy_json)
    except (json.JSONDecodeError, TypeError):
        return None


@router.get("/queues")
def list_queues() -> dict[str, Any]:
    """List all SQS queues with enriched attributes.

    Returns queue name, URL, message counts, type, and key attributes.
    """
    try:
        client = get_client("sqs")
        response = client.list_queues()
        queue_urls = response.get("QueueUrls", [])

        queues = []
        for url in queue_urls:
            try:
                # Get all attributes for the queue
                attrs_response = client.get_queue_attributes(
                    QueueUrl=url, AttributeNames=["All"]
                )
                attrs = attrs_response.get("Attributes", {})

                # Get tags
                try:
                    tags_response = client.list_queue_tags(QueueUrl=url)
                    tags = tags_response.get("Tags", {})
                except Exception:
                    tags = {}

                queue_name = _extract_queue_name(url)
                is_fifo = queue_name.endswith(".fifo") or attrs.get("FifoQueue") == "true"

                queues.append(
                    {
                        "name": queue_name,
                        "url": url,
                        "type": "FIFO" if is_fifo else "Standard",
                        "approximateNumberOfMessages": int(
                            attrs.get("ApproximateNumberOfMessages", 0)
                        ),
                        "approximateNumberOfMessagesNotVisible": int(
                            attrs.get("ApproximateNumberOfMessagesNotVisible", 0)
                        ),
                        "approximateNumberOfMessagesDelayed": int(
                            attrs.get("ApproximateNumberOfMessagesDelayed", 0)
                        ),
                        "visibilityTimeout": int(attrs.get("VisibilityTimeout", 30)),
                        "messageRetentionPeriod": int(
                            attrs.get("MessageRetentionPeriod", 345600)
                        ),
                        "delaySeconds": int(attrs.get("DelaySeconds", 0)),
                        "redrivePolicy": _parse_redrive_policy(
                            attrs.get("RedrivePolicy")
                        ),
                        "tags": tags,
                    }
                )
            except Exception:
                # Skip queues that fail to fetch attributes
                continue

        return {"queues": queues}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/queues/{queue_name}")
def get_queue_detail(queue_name: str) -> dict[str, Any]:
    """Get detailed attributes and tags for a specific queue."""
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        # Get all attributes
        attrs_response = client.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["All"]
        )
        attrs = attrs_response.get("Attributes", {})

        # Get tags
        try:
            tags_response = client.list_queue_tags(QueueUrl=queue_url)
            tags = tags_response.get("Tags", {})
        except Exception:
            tags = {}

        is_fifo = queue_name.endswith(".fifo") or attrs.get("FifoQueue") == "true"

        return {
            "name": queue_name,
            "url": queue_url,
            "arn": attrs.get("QueueArn"),
            "type": "FIFO" if is_fifo else "Standard",
            "approximateNumberOfMessages": int(
                attrs.get("ApproximateNumberOfMessages", 0)
            ),
            "approximateNumberOfMessagesNotVisible": int(
                attrs.get("ApproximateNumberOfMessagesNotVisible", 0)
            ),
            "approximateNumberOfMessagesDelayed": int(
                attrs.get("ApproximateNumberOfMessagesDelayed", 0)
            ),
            "visibilityTimeout": int(attrs.get("VisibilityTimeout", 30)),
            "messageRetentionPeriod": int(attrs.get("MessageRetentionPeriod", 345600)),
            "maximumMessageSize": int(attrs.get("MaximumMessageSize", 262144)),
            "delaySeconds": int(attrs.get("DelaySeconds", 0)),
            "redrivePolicy": _parse_redrive_policy(attrs.get("RedrivePolicy")),
            "contentBasedDeduplication": attrs.get("ContentBasedDeduplication") == "true",
            "tags": tags,
        }
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/queues/{queue_name}/messages")
def send_message(queue_name: str, body: dict[str, Any]) -> dict[str, Any]:
    """Send a message to the queue.

    Request body:
    {
      "messageBody": "...",
      "delaySeconds": 0,
      "messageAttributes": {"key": {"stringValue": "val", "dataType": "String"}},
      "messageDeduplicationId": "..." (FIFO only),
      "messageGroupId": "..." (FIFO only)
    }
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        message_body = body.get("messageBody", "")
        if not message_body:
            raise HTTPException(status_code=400, detail="messageBody is required")

        send_kwargs = {
            "QueueUrl": queue_url,
            "MessageBody": message_body,
        }

        # Optional parameters
        if "delaySeconds" in body:
            send_kwargs["DelaySeconds"] = body["delaySeconds"]

        if "messageAttributes" in body:
            # Convert from UI format to boto3 format
            attrs = {}
            for key, value in body["messageAttributes"].items():
                attrs[key] = {
                    "StringValue": str(value.get("stringValue", "")),
                    "DataType": value.get("dataType", "String"),
                }
            send_kwargs["MessageAttributes"] = attrs

        # FIFO-specific parameters
        if "messageDeduplicationId" in body:
            send_kwargs["MessageDeduplicationId"] = body["messageDeduplicationId"]
        if "messageGroupId" in body:
            send_kwargs["MessageGroupId"] = body["messageGroupId"]

        response = client.send_message(**send_kwargs)

        return {
            "messageId": response["MessageId"],
            "md5OfMessageBody": response["MD5OfMessageBody"],
            "sequenceNumber": response.get("SequenceNumber"),
        }
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/queues/{queue_name}/messages")
def receive_messages(
    queue_name: str,
    max_messages: int = Query(10, ge=1, le=10),
    visibility_timeout: int = Query(0, ge=0, le=43200),
) -> dict[str, Any]:
    """Receive messages from the queue.

    Use visibility_timeout=0 to peek without consuming messages.
    Use visibility_timeout > 0 to prevent redelivery during inspection.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        response = client.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=max_messages,
            VisibilityTimeout=visibility_timeout,
            MessageAttributeNames=["All"],
            AttributeNames=["All"],
        )

        messages = response.get("Messages", [])

        # Structure the messages for the frontend
        formatted_messages = []
        for msg in messages:
            formatted_messages.append(
                {
                    "messageId": msg.get("MessageId"),
                    "receiptHandle": msg.get("ReceiptHandle"),
                    "body": msg.get("Body"),
                    "md5OfBody": msg.get("MD5OfBody"),
                    "attributes": msg.get("Attributes", {}),
                    "messageAttributes": msg.get("MessageAttributes", {}),
                }
            )

        return {"messages": formatted_messages}
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/queues/{queue_name}/messages")
def delete_message(queue_name: str, receipt_handle: str = Query(...)) -> Response:
    """Delete a message from the queue using its receipt handle."""
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        # Decode receipt handle (it may be URL-encoded)
        decoded_handle = unquote(receipt_handle)

        client.delete_message(QueueUrl=queue_url, ReceiptHandle=decoded_handle)

        return Response(status_code=204)
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except client.exceptions.ReceiptHandleIsInvalid:
        raise HTTPException(status_code=400, detail="Receipt handle is invalid or expired")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/queues/{queue_name}/purge")
def purge_queue(queue_name: str) -> dict[str, Any]:
    """Purge all messages from the queue.

    Note: Can only be called once every 60 seconds.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        client.purge_queue(QueueUrl=queue_url)

        return {"success": True, "message": f"Queue {queue_name} purge initiated"}
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except client.exceptions.PurgeQueueInProgress:
        raise HTTPException(
            status_code=409,
            detail="Purge already in progress. Wait 60 seconds before purging again.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
