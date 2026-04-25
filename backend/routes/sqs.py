"""SQS service-specific routes."""

import json
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from backend.aws_client import get_client
from backend.routes.common import get_endpoint_url
from backend.schemas.sqs import (
    BatchDeleteRequest,
    BatchSendRequest,
    CreateQueueRequest,
    SendMessageRequest,
    UpdateAttributesRequest,
    UpdateRedrivePolicyRequest,
)

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
def create_queue(body: CreateQueueRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Create a new SQS queue."""
    try:
        client = get_client("sqs", endpoint_url)

        queue_name = body.queue_name
        is_fifo = body.queue_type == "FIFO"

        if is_fifo and not queue_name.endswith(".fifo"):
            queue_name = f"{queue_name}.fifo"

        attributes: dict[str, str] = {}

        if is_fifo:
            attributes["FifoQueue"] = "true"

        if body.content_based_deduplication:
            if not is_fifo:
                raise HTTPException(
                    status_code=400,
                    detail="ContentBasedDeduplication is only valid for FIFO queues",
                )
            attributes["ContentBasedDeduplication"] = "true"

        if body.visibility_timeout is not None:
            attributes["VisibilityTimeout"] = str(body.visibility_timeout)
        if body.message_retention_period is not None:
            attributes["MessageRetentionPeriod"] = str(body.message_retention_period)
        if body.delay_seconds is not None:
            attributes["DelaySeconds"] = str(body.delay_seconds)
        if body.maximum_message_size is not None:
            attributes["MaximumMessageSize"] = str(body.maximum_message_size)
        if body.receive_message_wait_time is not None:
            attributes["ReceiveMessageWaitTime"] = str(body.receive_message_wait_time)

        dlq_queue_name = None

        if body.dlq_enabled and not body.redrive_policy:
            dlq_suffix = "-dlq.fifo" if is_fifo else "-dlq"
            dlq_queue_name = queue_name.removesuffix(".fifo") + dlq_suffix

            try:
                dlq_url_response = client.get_queue_url(QueueName=dlq_queue_name)
                dlq_url = dlq_url_response["QueueUrl"]
                dlq_attrs_response = client.get_queue_attributes(
                    QueueUrl=dlq_url, AttributeNames=["QueueArn"]
                )
                dlq_arn = dlq_attrs_response["Attributes"]["QueueArn"]
            except client.exceptions.QueueDoesNotExist:
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

            redrive = {
                "deadLetterTargetArn": dlq_arn,
                "maxReceiveCount": body.max_receive_count,
            }
            attributes["RedrivePolicy"] = json.dumps(redrive)
        elif body.redrive_policy:
            attributes["RedrivePolicy"] = json.dumps(
                body.redrive_policy.model_dump(by_alias=True)
            )

        if not body.sqs_managed_sse_enabled:
            attributes["SqsManagedSseEnabled"] = "false"
            if body.kms_master_key_id:
                attributes["KmsMasterKeyId"] = body.kms_master_key_id
        else:
            attributes["SqsManagedSseEnabled"] = "true"

        create_kwargs: dict[str, Any] = {"QueueName": queue_name}
        if attributes:
            create_kwargs["Attributes"] = attributes

        response = client.create_queue(**create_kwargs)

        queue_url = response["QueueUrl"]
        arn_response = client.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"]
        )
        queue_arn = arn_response["Attributes"]["QueueArn"]

        if body.tags:
            try:
                client.tag_queue(QueueUrl=queue_url, Tags=body.tags)
            except Exception:
                pass

        result: dict[str, str] = {
            "queueName": queue_name,
            "queueUrl": queue_url,
            "queueArn": queue_arn,
        }

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
def send_message(queue_name: str, body: SendMessageRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Send a message to the queue."""
    try:
        client = get_client("sqs", endpoint_url)

        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        send_kwargs: dict[str, Any] = {
            "QueueUrl": queue_url,
            "MessageBody": body.message_body,
        }

        if body.delay_seconds is not None:
            send_kwargs["DelaySeconds"] = body.delay_seconds

        if body.message_attributes:
            attrs = {}
            for key, value in body.message_attributes.items():
                attrs[key] = {
                    "StringValue": str(value.get("stringValue", "")),
                    "DataType": value.get("dataType", "String"),
                }
            send_kwargs["MessageAttributes"] = attrs

        if body.message_deduplication_id:
            send_kwargs["MessageDeduplicationId"] = body.message_deduplication_id
        if body.message_group_id:
            send_kwargs["MessageGroupId"] = body.message_group_id

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
def delete_queue(queue_name: str, endpoint_url: str | None = Depends(get_endpoint_url)) -> Response:
    """Delete an SQS queue.

    Permanently deletes the queue and all its messages.
    """
    try:
        client = get_client("sqs", endpoint_url)

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
def update_queue_attributes(queue_name: str, body: UpdateAttributesRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Update queue attributes."""
    try:
        client = get_client("sqs", endpoint_url)

        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        attributes: dict[str, str] = {}

        if body.visibility_timeout is not None:
            attributes["VisibilityTimeout"] = str(body.visibility_timeout)
        if body.message_retention_period is not None:
            attributes["MessageRetentionPeriod"] = str(body.message_retention_period)
        if body.delay_seconds is not None:
            attributes["DelaySeconds"] = str(body.delay_seconds)
        if body.maximum_message_size is not None:
            attributes["MaximumMessageSize"] = str(body.maximum_message_size)
        if body.receive_message_wait_time is not None:
            attributes["ReceiveMessageWaitTime"] = str(body.receive_message_wait_time)

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
def send_messages_batch(queue_name: str, body: BatchSendRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Send multiple messages to the queue in one operation (max 10)."""
    try:
        client = get_client("sqs", endpoint_url)

        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        batch_entries = []
        for entry in body.entries:
            batch_entry: dict[str, Any] = {
                "Id": entry.id,
                "MessageBody": entry.message_body,
            }

            if entry.delay_seconds is not None:
                batch_entry["DelaySeconds"] = entry.delay_seconds
            if entry.message_deduplication_id:
                batch_entry["MessageDeduplicationId"] = entry.message_deduplication_id
            if entry.message_group_id:
                batch_entry["MessageGroupId"] = entry.message_group_id

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/queues/{queue_name}/messages/batch")
def delete_messages_batch(queue_name: str, body: BatchDeleteRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> Response:
    """Delete multiple messages from the queue in one operation (max 10)."""
    try:
        client = get_client("sqs", endpoint_url)

        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        batch_entries = []
        for idx, receipt_handle in enumerate(body.receipt_handles):
            decoded_handle = unquote(receipt_handle)
            batch_entries.append(
                {"Id": str(idx), "ReceiptHandle": decoded_handle}
            )

        client.delete_message_batch(QueueUrl=queue_url, Entries=batch_entries)

        return Response(status_code=204)
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/queues/{queue_name}/redrive-policy")
def update_redrive_policy(queue_name: str, body: UpdateRedrivePolicyRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Update the dead-letter queue redrive policy."""
    try:
        client = get_client("sqs", endpoint_url)

        url_response = client.get_queue_url(QueueName=queue_name)
        queue_url = url_response["QueueUrl"]

        redrive_policy = {
            "deadLetterTargetArn": body.dead_letter_target_arn,
            "maxReceiveCount": body.max_receive_count,
        }
        attributes = {"RedrivePolicy": json.dumps(redrive_policy)}

        client.set_queue_attributes(QueueUrl=queue_url, Attributes=attributes)

        return {
            "success": True,
            "message": f"Queue {queue_name} redrive policy updated successfully",
        }
    except client.exceptions.QueueDoesNotExist:
        raise HTTPException(status_code=404, detail=f"Queue {queue_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
