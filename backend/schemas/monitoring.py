"""Pydantic schemas for CloudWatch monitoring endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class MetricDimension(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    value: str


class MetricDataQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    namespace: str
    metric_name: str = Field(alias="metricName")
    dimensions: list[MetricDimension] = []
    stat: str = "Average"
    period: int = 60


class MetricDataRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    queries: list[MetricDataQuery]
    start_minutes: int = Field(alias="startMinutes", default=60)
