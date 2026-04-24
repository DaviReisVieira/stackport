"""Pydantic schemas for SQS API requests."""

from typing import Literal

from pydantic import BaseModel, Field


class RedrivePolicy(BaseModel):
    """Redrive policy referencing an existing dead-letter queue."""

    dead_letter_target_arn: str = Field(alias="deadLetterTargetArn")
    max_receive_count: int = Field(alias="maxReceiveCount", ge=1)

    model_config = {"populate_by_name": True}


class CreateQueueRequest(BaseModel):
    queue_name: str = Field(alias="queueName", min_length=1)
    queue_type: Literal["Standard", "FIFO"] = Field("Standard", alias="queueType")
    content_based_deduplication: bool = Field(False, alias="contentBasedDeduplication")
    visibility_timeout: int | None = Field(None, alias="visibilityTimeout", ge=0, le=43200)
    message_retention_period: int | None = Field(None, alias="messageRetentionPeriod")
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    maximum_message_size: int | None = Field(None, alias="maximumMessageSize")
    receive_message_wait_time: int | None = Field(None, alias="receiveMessageWaitTime", ge=0, le=20)
    dlq_enabled: bool = Field(False, alias="dlqEnabled")
    max_receive_count: int = Field(5, alias="maxReceiveCount", ge=1)
    redrive_policy: RedrivePolicy | None = Field(None, alias="redrivePolicy")
    kms_master_key_id: str | None = Field(None, alias="kmsMasterKeyId")
    sqs_managed_sse_enabled: bool = Field(True, alias="sqsManagedSseEnabled")
    tags: dict[str, str] | None = None

    model_config = {"populate_by_name": True}


class SendMessageRequest(BaseModel):
    message_body: str = Field(alias="messageBody", min_length=1)
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    message_attributes: dict[str, dict[str, str]] | None = Field(None, alias="messageAttributes")
    message_deduplication_id: str | None = Field(None, alias="messageDeduplicationId")
    message_group_id: str | None = Field(None, alias="messageGroupId")

    model_config = {"populate_by_name": True}


class BatchSendEntry(BaseModel):
    id: str = Field(min_length=1)
    message_body: str = Field(alias="messageBody", min_length=1)
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    message_deduplication_id: str | None = Field(None, alias="messageDeduplicationId")
    message_group_id: str | None = Field(None, alias="messageGroupId")

    model_config = {"populate_by_name": True}


class BatchSendRequest(BaseModel):
    entries: list[BatchSendEntry] = Field(min_length=1, max_length=10)


class BatchDeleteRequest(BaseModel):
    receipt_handles: list[str] = Field(alias="receiptHandles", min_length=1, max_length=10)

    model_config = {"populate_by_name": True}


class UpdateAttributesRequest(BaseModel):
    visibility_timeout: int | None = Field(None, alias="visibilityTimeout", ge=0, le=43200)
    message_retention_period: int | None = Field(None, alias="messageRetentionPeriod")
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    maximum_message_size: int | None = Field(None, alias="maximumMessageSize")
    receive_message_wait_time: int | None = Field(None, alias="receiveMessageWaitTime", ge=0, le=20)

    model_config = {"populate_by_name": True}


class UpdateRedrivePolicyRequest(BaseModel):
    dead_letter_target_arn: str = Field(alias="deadLetterTargetArn", min_length=1)
    max_receive_count: int = Field(alias="maxReceiveCount", ge=1)

    model_config = {"populate_by_name": True}
