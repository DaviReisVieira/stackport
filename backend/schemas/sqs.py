"""Pydantic schemas for SQS API requests."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SQSRequest(BaseModel):
    """Base for SQS request bodies.

    Unknown fields are refused, not dropped: a misspelled or AWS-cased key
    (``StringValue`` for ``stringValue``) would otherwise vanish and the call
    would reach SQS without it.
    """

    model_config = {"populate_by_name": True, "extra": "forbid"}


class RedrivePolicy(SQSRequest):
    """Redrive policy referencing an existing dead-letter queue."""

    dead_letter_target_arn: str = Field(alias="deadLetterTargetArn")
    max_receive_count: int = Field(alias="maxReceiveCount", ge=1)


class CreateQueueRequest(SQSRequest):
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


class MessageAttribute(SQSRequest):
    """A message attribute with a string value. SQS rejects an empty one."""

    data_type: str = Field("String", alias="dataType")
    string_value: str = Field(alias="stringValue", min_length=1)

    @field_validator("data_type")
    @classmethod
    def _sent_as_a_string(cls, data_type: str) -> str:
        # Custom labels are allowed (Number.float); Binary needs a binary value, which this API doesn't take.
        if data_type.split(".", 1)[0] not in ("String", "Number"):
            raise ValueError("must be String or Number, optionally with a custom label such as Number.float")
        return data_type


class SendMessageRequest(SQSRequest):
    message_body: str = Field(alias="messageBody", min_length=1)
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    message_attributes: dict[str, MessageAttribute] | None = Field(None, alias="messageAttributes")
    message_deduplication_id: str | None = Field(None, alias="messageDeduplicationId")
    message_group_id: str | None = Field(None, alias="messageGroupId")


class BatchSendEntry(SQSRequest):
    id: str = Field(min_length=1)
    message_body: str = Field(alias="messageBody", min_length=1)
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    message_deduplication_id: str | None = Field(None, alias="messageDeduplicationId")
    message_group_id: str | None = Field(None, alias="messageGroupId")


class BatchSendRequest(SQSRequest):
    entries: list[BatchSendEntry] = Field(min_length=1, max_length=10)


class BatchDeleteRequest(SQSRequest):
    receipt_handles: list[str] = Field(alias="receiptHandles", min_length=1, max_length=10)


class UpdateAttributesRequest(SQSRequest):
    visibility_timeout: int | None = Field(None, alias="visibilityTimeout", ge=0, le=43200)
    message_retention_period: int | None = Field(None, alias="messageRetentionPeriod")
    delay_seconds: int | None = Field(None, alias="delaySeconds", ge=0, le=900)
    maximum_message_size: int | None = Field(None, alias="maximumMessageSize")
    receive_message_wait_time: int | None = Field(None, alias="receiveMessageWaitTime", ge=0, le=20)


class UpdateRedrivePolicyRequest(SQSRequest):
    dead_letter_target_arn: str = Field(alias="deadLetterTargetArn", min_length=1)
    max_receive_count: int = Field(alias="maxReceiveCount", ge=1)
