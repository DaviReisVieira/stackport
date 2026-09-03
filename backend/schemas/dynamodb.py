"""Pydantic schemas for DynamoDB API requests."""

from typing import Any, Literal, Union

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    partition_key_value: str
    sort_key_value: str | None = None
    sort_key_operator: str = "="  # =, <, <=, >, >=, BETWEEN, BEGINS_WITH
    limit: int = 25


class PutItemRequest(BaseModel):
    item: dict[str, Any]
    item_format: Literal["dynamodb", "plain"] = "dynamodb"


class DeleteItemRequest(BaseModel):
    key: dict[str, Any]
    item_format: Literal["dynamodb", "plain"] = "dynamodb"


class _BatchOpPut(BaseModel):
    op: Literal["put"] = "put"
    item: dict[str, Any]


class _BatchOpDelete(BaseModel):
    op: Literal["delete"] = "delete"
    key: dict[str, Any]


class BatchWriteRequest(BaseModel):
    item_format: Literal["dynamodb", "plain"] = "dynamodb"
    operations: list[Union[_BatchOpPut, _BatchOpDelete]] = Field(min_length=1, max_length=25)


class KeyDefinition(BaseModel):
    """A table key attribute: its name and its DynamoDB scalar type."""

    name: str = Field(min_length=1, max_length=255)
    type: Literal["S", "N", "B"] = "S"


class CreateTableRequest(BaseModel):
    """Create a table, mirroring the console's Table details + Table settings sections."""

    model_config = {"populate_by_name": True}

    name: str = Field(min_length=3, max_length=255, alias="name")
    partition_key: KeyDefinition = Field(alias="partitionKey")
    sort_key: KeyDefinition | None = Field(default=None, alias="sortKey")
    billing_mode: Literal["PAY_PER_REQUEST", "PROVISIONED"] = Field(
        default="PAY_PER_REQUEST", alias="billingMode"
    )
    read_capacity: int = Field(default=5, ge=1, alias="readCapacity")
    write_capacity: int = Field(default=5, ge=1, alias="writeCapacity")
