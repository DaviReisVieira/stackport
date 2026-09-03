"""SNS routes: topics, subscriptions and publishing (#75)."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.schemas.sns import CreateTopicBody, PublishBody, SubscribeBody

logger = logging.getLogger(__name__)

router = APIRouter()


def _topic_name(arn: str) -> str:
    return arn.rsplit(":", 1)[-1]


def _serialize_topic(arn: str, attributes: dict) -> dict:
    return {
        "arn": arn,
        "name": _topic_name(arn),
        "displayName": attributes.get("DisplayName") or None,
        "fifo": attributes.get("FifoTopic") == "true",
        "contentBasedDeduplication": attributes.get("ContentBasedDeduplication") == "true",
        "subscriptionsConfirmed": int(attributes.get("SubscriptionsConfirmed") or 0),
        "subscriptionsPending": int(attributes.get("SubscriptionsPending") or 0),
        "owner": attributes.get("Owner"),
        "kmsMasterKeyId": attributes.get("KmsMasterKeyId"),
    }


def _serialize_subscription(sns, sub: dict) -> dict:
    entry = {
        "arn": sub.get("SubscriptionArn", ""),
        "protocol": sub.get("Protocol", ""),
        "endpoint": sub.get("Endpoint", ""),
        "owner": sub.get("Owner", ""),
        "pending": sub.get("SubscriptionArn") == "PendingConfirmation",
        "filterPolicy": None,
        "rawMessageDelivery": False,
    }
    if not entry["pending"] and entry["arn"]:
        try:
            attrs = sns.get_subscription_attributes(SubscriptionArn=entry["arn"]).get("Attributes", {})
            if attrs.get("FilterPolicy"):
                try:
                    entry["filterPolicy"] = json.loads(attrs["FilterPolicy"])
                except json.JSONDecodeError:
                    entry["filterPolicy"] = attrs["FilterPolicy"]
            entry["rawMessageDelivery"] = attrs.get("RawMessageDelivery") == "true"
        except Exception:
            logger.debug("Failed to fetch subscription attributes for %s", entry["arn"], exc_info=True)
    return entry


@router.get("/topics")
def list_topics(ep: EndpointInfo = Depends(get_endpoint_info)):
    """List SNS topics enriched with their attributes."""
    sns = get_client("sns", **ep.client_kwargs())
    topics = []
    paginator_arns = [t["TopicArn"] for t in sns.list_topics().get("Topics", [])]
    for arn in paginator_arns:
        try:
            attributes = sns.get_topic_attributes(TopicArn=arn).get("Attributes", {})
        except Exception:
            logger.debug("Failed to fetch attributes for topic %s", arn, exc_info=True)
            attributes = {}
        topics.append(_serialize_topic(arn, attributes))
    return {"topics": topics}


@router.get("/topics/{arn}")
def get_topic(arn: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Get a topic's attributes and subscriptions."""
    sns = get_client("sns", **ep.client_kwargs())
    try:
        attributes = sns.get_topic_attributes(TopicArn=arn).get("Attributes", {})
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Topic not found: {exc}")

    subscriptions = [
        _serialize_subscription(sns, sub)
        for sub in sns.list_subscriptions_by_topic(TopicArn=arn).get("Subscriptions", [])
    ]

    return {
        **_serialize_topic(arn, attributes),
        "attributes": attributes,
        "subscriptions": subscriptions,
    }


@router.post("/topics", status_code=201)
def create_topic(body: CreateTopicBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Create a Standard or FIFO topic."""
    sns = get_client("sns", **ep.client_kwargs())
    name = body.name
    attributes: dict[str, str] = {}
    if body.fifo:
        if not name.endswith(".fifo"):
            name = f"{name}.fifo"
        attributes["FifoTopic"] = "true"
        if body.content_based_deduplication:
            attributes["ContentBasedDeduplication"] = "true"
    if body.display_name:
        attributes["DisplayName"] = body.display_name

    params: dict = {"Name": name}
    if attributes:
        params["Attributes"] = attributes
    try:
        response = sns.create_topic(**params)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create topic: {exc}")
    return {"arn": response["TopicArn"], "name": name}


@router.delete("/topics/{arn}")
def delete_topic(arn: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Delete a topic."""
    sns = get_client("sns", **ep.client_kwargs())
    try:
        sns.delete_topic(TopicArn=arn)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to delete topic: {exc}")
    return {"deleted": True, "arn": arn}


@router.post("/topics/{arn}/subscriptions", status_code=201)
def subscribe(arn: str, body: SubscribeBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Subscribe an endpoint to a topic."""
    sns = get_client("sns", **ep.client_kwargs())
    attributes: dict[str, str] = {}
    if body.filter_policy:
        attributes["FilterPolicy"] = json.dumps(body.filter_policy)
    params: dict = {
        "TopicArn": arn,
        "Protocol": body.protocol,
        "Endpoint": body.endpoint,
        "ReturnSubscriptionArn": True,
    }
    if attributes:
        params["Attributes"] = attributes
    try:
        response = sns.subscribe(**params)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to subscribe: {exc}")
    return {"subscriptionArn": response.get("SubscriptionArn", "")}


@router.delete("/subscriptions/{arn}")
def unsubscribe(arn: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Remove a subscription."""
    sns = get_client("sns", **ep.client_kwargs())
    try:
        sns.unsubscribe(SubscriptionArn=arn)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to unsubscribe: {exc}")
    return {"deleted": True, "arn": arn}


@router.post("/topics/{arn}/publish")
def publish(arn: str, body: PublishBody, ep: EndpointInfo = Depends(get_endpoint_info)):
    """Publish a message to a topic."""
    sns = get_client("sns", **ep.client_kwargs())
    params: dict = {"TopicArn": arn, "Message": body.message}
    if body.subject:
        params["Subject"] = body.subject
    if body.message_group_id:
        params["MessageGroupId"] = body.message_group_id
    if body.message_deduplication_id:
        params["MessageDeduplicationId"] = body.message_deduplication_id
    if body.message_attributes:
        params["MessageAttributes"] = {
            key: {"DataType": value.data_type, "StringValue": value.string_value}
            for key, value in body.message_attributes.items()
        }
    try:
        response = sns.publish(**params)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to publish: {exc}")
    return {"messageId": response.get("MessageId", "")}
