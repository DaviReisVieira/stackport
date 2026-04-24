"""SQS service-specific routes."""

import json
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from backend.aws_client import get_client
from backend.routes.common import get_endpoint_url

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
def list_queues(endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """List all SQS queues with enriched attributes.

    Returns queue name, URL, message counts, type, and key attributes.
    """
    try:
        client = get_client("sqs", endpoint_url)
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


@router.post("/queues")
def create_queue(body: dict[str, Any]) -> dict[str, Any]:
    """Create a new SQS queue.

    Request body:
    {
      "queueName": "...",
      "queueType": "Standard" | "FIFO",
      "contentBasedDeduplication": false,
      "visibilityTimeout": 30,
      "messageRetentionPeriod": 345600,
      "delaySeconds": 0,
      "maximumMessageSize": 262144,
      "receiveMessageWaitTime": 0,
      "dlqEnabled": false,
      "maxReceiveCount": 5,
      "redrivePolicy": { "deadLetterTargetArn": "...", "maxReceiveCount": 5 },
      "kmsMasterKeyId": "...",
      "sqsManagedSseEnabled": true,
      "tags": { "key": "value" }
    }
    """
    try:
        client = get_client("sqs")

        queue_name = body.get("queueName", "")
        if not queue_name:
            raise HTTPException(status_code=400, detail="queueName is required")

        # Validate queue name
        queue_type = body.get("queueType", "Standard")
        is_fifo = queue_type == "FIFO"

        # Auto-append .fifo suffix for FIFO queues if not already present
        if is_fifo and not queue_name.endswith(".fifo"):
            queue_name = f"{queue_name}.fifo"

        # Build attributes dict
        attributes: dict[str, str] = {}

        if is_fifo:
            attributes["FifoQueue"] = "true"

        content_based_dedup = body.get("contentBasedDeduplication")
        if content_based_dedup:
            if not is_fifo:
                raise HTTPException(
                    status_code=400,
                    detail="ContentBasedDeduplication is only valid for FIFO queues",
                )
            attributes["ContentBasedDeduplication"] = "true"

        # Optional numeric attributes
        if "visibilityTimeout" in body:
            attributes["VisibilityTimeout"] = str(body["visibilityTimeout"])
        if "messageRetentionPeriod" in body:
            attributes["MessageRetentionPeriod"] = str(body["messageRetentionPeriod"])
        if "delaySeconds" in body:
            attributes["DelaySeconds"] = str(body["delaySeconds"])
        if "maximumMessageSize" in body:
            attributes["MaximumMessageSize"] = str(body["maximumMessageSize"])
        if "receiveMessageWaitTime" in body:
            attributes["ReceiveMessageWaitTime"] = str(body["receiveMessageWaitTime"])

        # DLQ handling - either auto-create or use provided redrivePolicy
        dlq_enabled = body.get("dlqEnabled", False)
        redrive_policy = body.get("redrivePolicy")
        dlq_queue_name = None

        if dlq_enabled and not redrive_policy:
            # Auto-create DLQ
            dlq_suffix = "-dlq.fifo" if is_fifo else "-dlq"
            dlq_queue_name = queue_name.removesuffix(".fifo") + dlq_suffix

            # Check if DLQ already exists
            try:
                dlq_url_response = client.get_queue_url(QueueName=dlq_queue_name)
                dlq_url = dlq_url_response["QueueUrl"]
                dlq_attrs_response = client.get_queue_attributes(
                    QueueUrl=dlq_url, AttributeNames=["QueueArn"]
                )
                dlq_arn = dlq_attrs_response["Attributes"]["QueueArn"]
            except client.exceptions.QueueDoesNotExist:
                # Create the DLQ
                dlq_attributes: dict[str, str] = {}
                if is_fifo:
                    dlq_attributes["FifoQueue"] = "true"
                dlq_attributes["SqsManagedSseEnabled"] = "true"

                dlq_response = client.create_queue(
                    QueueName=dlq_queue_name, Attributes=dlq_attributes
                )
                dlq_url = dlq_response["QueueUrl"]
                dlq_attrs_response = client.get_queue_attributes(
                    QueueUrl=dlq_url, AttributeNames=["QueueArn"]
                )
                dlq_arn = dlq_attrs_response["Attributes"]["QueueArn"]

            # Set redrive policy with auto-created DLQ ARN
            max_receive_count = body.get("maxReceiveCount", 5)
            redrive_policy = {
                "deadLetterTargetArn": dlq_arn,
                "maxReceiveCount": max_receive_count,
            }
            attributes["RedrivePolicy"] = json.dumps(redrive_policy)
        elif redrive_policy:
            # Use provided redrive policy (manual ARN)
            attributes["RedrivePolicy"] = json.dumps(redrive_policy)

        # SSE encryption
        sqs_managed_sse = body.get("sqsManagedSseEnabled", True)
        if not sqs_managed_sse:
            attributes["SqsManagedSseEnabled"] = "false"
            kms_key_id = body.get("kmsMasterKeyId")
            if kms_key_id:
                attributes["KmsMasterKeyId"] = kms_key_id
        else:
            attributes["SqsManagedSseEnabled"] = "true"

        # Create the queue
        create_kwargs: dict[str, Any] = {"QueueName": queue_name}
        if attributes:
            create_kwargs["Attributes"] = attributes

        response = client.create_queue(**create_kwargs)

        queue_url = response["QueueUrl"]
        arn_response = client.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"]
        )
        queue_arn = arn_response["Attributes"]["QueueArn"]

        # Apply tags if provided
        tags = body.get("tags")
        if tags:
            try:
                client.tag_queue(QueueUrl=queue_url, Tags=tags)
            except Exception:
                # Tag failure shouldn't break queue creation
                pass

        result = {
            "queueName": queue_name,
            "queueUrl": queue_url,
            "queueArn": queue_arn,
        }

        # Include DLQ info if auto-created
        if dlq_queue_name:
            result["dlqQueueName"] = dlq_queue_name

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/queues/{queue_name}")
def get_queue_detail(queue_name: str, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Get detailed attributes and tags for a specific queue."""
    try:
        client = get_client("sqs", endpoint_url)

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
def send_message(queue_name: str, body: dict[str, Any], endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
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
        client = get_client("sqs", endpoint_url)

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
    endpoint_url: str | None = Depends(get_endpoint_url),
) -> dict[str, Any]:
    """Receive messages from the queue.

    Use visibility_timeout=0 to peek without consuming messages.
    Use visibility_timeout > 0 to prevent redelivery during inspection.
    """
    try:
        client = get_client("sqs", endpoint_url)

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
def delete_message(queue_name: str, receipt_handle: str = Query(...), endpoint_url: str | None = Depends(get_endpoint_url)) -> Response:
    """Delete a message from the queue using its receipt handle."""
    try:
        client = get_client("sqs", endpoint_url)

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
def purge_queue(queue_name: str, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Purge all messages from the queue.

    Note: Can only be called once every 60 seconds.
    """
    try:
        client = get_client("sqs", endpoint_url)

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


@router.delete("/queues/{queue_name}")
def delete_queue(queue_name: str) -> Response:
    """Delete an SQS queue.

    Permanently deletes the queue and all its messages.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        client.delete_queue(QueueUrl=queue_url)

        return Response(status_code=204)
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/queues/{queue_name}/attributes")
def update_queue_attributes(queue_name: str, body: dict[str, Any]) -> dict[str, Any]:
    """Update queue attributes.

    Request body:
    {
      "visibilityTimeout": 30,
      "messageRetentionPeriod": 345600,
      "delaySeconds": 0,
      "maximumMessageSize": 262144,
      "receiveMessageWaitTime": 0
    }
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        # Build attributes dict
        attributes: dict[str, str] = {}

        if "visibilityTimeout" in body:
            attributes["VisibilityTimeout"] = str(body["visibilityTimeout"])
        if "messageRetentionPeriod" in body:
            attributes["MessageRetentionPeriod"] = str(body["messageRetentionPeriod"])
        if "delaySeconds" in body:
            attributes["DelaySeconds"] = str(body["delaySeconds"])
        if "maximumMessageSize" in body:
            attributes["MaximumMessageSize"] = str(body["maximumMessageSize"])
        if "receiveMessageWaitTime" in body:
            attributes["ReceiveMessageWaitTime"] = str(body["receiveMessageWaitTime"])

        if not attributes:
            raise HTTPException(status_code=400, detail="No attributes provided")

        client.set_queue_attributes(QueueUrl=queue_url, Attributes=attributes)

        return {
            "success": True,
            "message": f"Queue {queue_name} attributes updated successfully",
        }
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/queues/{queue_name}/messages/batch")
def send_messages_batch(queue_name: str, body: dict[str, Any]) -> dict[str, Any]:
    """Send multiple messages to the queue in one operation.

    Request body:
    {
      "entries": [
        { "id": "msg1", "messageBody": "...", "delaySeconds": 0, "messageDeduplicationId": "...", "messageGroupId": "..." },
        ...
      ]
    }

    Max 10 entries per batch.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        entries = body.get("entries", [])
        if not entries:
            raise HTTPException(status_code=400, detail="entries is required")

        if len(entries) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 entries per batch")

        # Build batch request entries
        batch_entries = []
        for entry in entries:
            msg_id = entry.get("id", "")
            if not msg_id:
                raise HTTPException(status_code=400, detail="Each entry must have an id")

            message_body = entry.get("messageBody", "")
            if not message_body:
                raise HTTPException(
                    status_code=400, detail=f"Entry {msg_id}: messageBody is required"
                )

            batch_entry: dict[str, Any] = {
                "Id": msg_id,
                "MessageBody": message_body,
            }

            if "delaySeconds" in entry:
                batch_entry["DelaySeconds"] = entry["delaySeconds"]

            if "messageDeduplicationId" in entry:
                batch_entry["MessageDeduplicationId"] = entry["messageDeduplicationId"]

            if "messageGroupId" in entry:
                batch_entry["MessageGroupId"] = entry["messageGroupId"]

            batch_entries.append(batch_entry)

        response = client.send_message_batch(
            QueueUrl=queue_url, Entries=batch_entries
        )

        successful = [
            {"id": entry["Id"], "messageId": entry["MessageId"]}
            for entry in response.get("Successful", [])
        ]
        failed = [
            {
                "id": entry["Id"],
                "code": entry.get("Code", ""),
                "message": entry.get("Message", ""),
            }
            for entry in response.get("Failed", [])
        ]

        return {"successful": successful, "failed": failed}
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/queues/{queue_name}/messages/batch")
def delete_messages_batch(queue_name: str, body: dict[str, Any]) -> Response:
    """Delete multiple messages from the queue in one operation.

    Request body:
    {
      "receiptHandles": ["handle1", "handle2", ...]
    }

    Max 10 entries per batch.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        receipt_handles = body.get("receiptHandles", [])
        if not receipt_handles:
            raise HTTPException(status_code=400, detail="receiptHandles is required")

        if len(receipt_handles) > 10:
            raise HTTPException(
                status_code=400, detail="Maximum 10 receipt handles per batch"
            )

        # Build batch request entries
        batch_entries = []
        for idx, receipt_handle in enumerate(receipt_handles):
            # Decode receipt handle (may be URL-encoded)
            decoded_handle = unquote(receipt_handle)
            batch_entries.append(
                {"Id": str(idx), "ReceiptHandle": decoded_handle}
            )

        client.delete_message_batch(QueueUrl=queue_url, Entries=batch_entries)

        return Response(status_code=204)
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/queues/{queue_name}/redrive-policy")
def update_redrive_policy(queue_name: str, body: dict[str, Any]) -> dict[str, Any]:
    """Update the dead-letter queue redrive policy.

    Request body to set DLQ:
    {
      "deadLetterTargetArn": "arn:aws:sqs:...",
      "maxReceiveCount": 5
    }

    Note: AWS does not support removing a redrive policy once set.
    You can only replace it with a new DLQ configuration.
    """
    try:
        client = get_client("sqs")

        # Get queue URL from name
        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        target_arn = body.get("deadLetterTargetArn")
        max_receive_count = body.get("maxReceiveCount")

        # Validate required fields
        if not target_arn:
            raise HTTPException(
                status_code=400, detail="deadLetterTargetArn is required"
            )
        if not max_receive_count or max_receive_count < 1:
            raise HTTPException(
                status_code=400, detail="maxReceiveCount must be at least 1"
            )

        # Set redrive policy
        redrive_policy = {
            "deadLetterTargetArn": target_arn,
            "maxReceiveCount": max_receive_count,
        }
        attributes = {"RedrivePolicy": json.dumps(redrive_policy)}

        client.set_queue_attributes(QueueUrl=queue_url, Attributes=attributes)

        return {
            "success": True,
            "message": f"Queue {queue_name} redrive policy updated successfully",
        }
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
