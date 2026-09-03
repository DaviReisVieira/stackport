"""Pydantic schemas for SNS endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class CreateTopicBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    display_name: str | None = Field(alias="displayName", default=None)
    fifo: bool = False
    content_based_deduplication: bool = Field(alias="contentBasedDeduplication", default=False)


class SubscribeBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    protocol: str
    endpoint: str
    filter_policy: dict | None = Field(alias="filterPolicy", default=None)
    raw_message_delivery: bool = Field(alias="rawMessageDelivery", default=False)


class MessageAttributeValue(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    data_type: str = Field(alias="dataType", default="String")
    string_value: str = Field(alias="stringValue", default="")


class PublishBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str
    subject: str | None = None
    message_group_id: str | None = Field(alias="messageGroupId", default=None)
    message_deduplication_id: str | None = Field(alias="messageDeduplicationId", default=None)
    message_attributes: dict[str, MessageAttributeValue] = Field(alias="messageAttributes", default_factory=dict)
