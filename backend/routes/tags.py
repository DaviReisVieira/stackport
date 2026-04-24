"""Tag management routes for all supported services."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import get_endpoint_url
from backend.schemas.tags import BulkDeleteRequest, BulkTagRequest, TagUpdateRequest

router = APIRouter()


# --- Tag getters: (service, type) -> callable(client, resource_id) -> dict ---

def _get_tags_s3_bucket(client: Any, resource_id: str) -> dict[str, str]:
    try:
        resp = client.get_bucket_tagging(Bucket=resource_id)
        return {t["Key"]: t["Value"] for t in resp.get("TagSet", [])}
    except client.exceptions.ClientError:
        return {}


def _get_tags_sqs_queue(client: Any, resource_id: str) -> dict[str, str]:
    url_resp = client.get_queue_url(QueueName=resource_id)
    queue_url = url_resp["QueueUrl"]
    resp = client.list_queue_tags(QueueUrl=queue_url)
    return resp.get("Tags", {})


def _get_tags_lambda(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.get_function(FunctionName=resource_id)
    return resp.get("Tags", {})


def _get_tags_dynamodb(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_table(TableName=resource_id)
    arn = resp["Table"]["TableArn"]
    tag_resp = client.list_tags_of_resource(ResourceArn=arn)
    return {t["Key"]: t["Value"] for t in tag_resp.get("Tags", [])}


def _get_tags_secretsmanager(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_secret(SecretId=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_logs(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_tags_for_resource(resourceArn=resource_id)
    return resp.get("tags", {})


def _get_tags_ec2_instance(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_tags(Filters=[{"Name": "resource-id", "Values": [resource_id]}])
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_iam_user(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_user_tags(UserName=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_iam_role(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_role_tags(RoleName=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_iam_policy(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_policy_tags(PolicyArn=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_rds_db_instance(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_db_instances(DBInstanceIdentifier=resource_id)
    arn = resp["DBInstances"][0]["DBInstanceArn"]
    tag_resp = client.list_tags_for_resource(ResourceName=arn)
    return {t["Key"]: t["Value"] for t in tag_resp.get("TagList", [])}


def _get_tags_rds_db_cluster(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_db_clusters(DBClusterIdentifier=resource_id)
    arn = resp["DBClusters"][0]["DBClusterArn"]
    tag_resp = client.list_tags_for_resource(ResourceName=arn)
    return {t["Key"]: t["Value"] for t in tag_resp.get("TagList", [])}


def _get_tags_sns_topic(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_tags_for_resource(ResourceArn=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}


def _get_tags_kms_key(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_resource_tags(KeyId=resource_id)
    return {t["TagKey"]: t["TagValue"] for t in resp.get("Tags", [])}


def _get_tags_ecr_repository(client: Any, resource_id: str) -> dict[str, str]:
    repo = client.describe_repositories(repositoryNames=[resource_id])
    arn = repo["repositories"][0]["repositoryArn"]
    resp = client.list_tags_for_resource(resourceArn=arn)
    return {t["Key"]: t["Value"] for t in resp.get("tags", [])}


def _get_tags_cloudformation_stack(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_stacks(StackName=resource_id)
    return {t["Key"]: t["Value"] for t in resp["Stacks"][0].get("Tags", [])}


def _get_tags_stepfunctions(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_tags_for_resource(resourceArn=resource_id)
    return {t["key"]: t["value"] for t in resp.get("tags", [])}


def _get_tags_kinesis_stream(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_tags_for_stream(StreamName=resource_id)
    tags = {t["Key"]: t["Value"] for t in resp.get("Tags", [])}
    while resp.get("HasMoreTags"):
        resp = client.list_tags_for_stream(
            StreamName=resource_id,
            ExclusiveStartTagKey=resp["Tags"][-1]["Key"],
        )
        tags.update({t["Key"]: t["Value"] for t in resp.get("Tags", [])})
    return tags


def _get_tags_ssm_parameter(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.list_tags_for_resource(ResourceType="Parameter", ResourceId=resource_id)
    return {t["Key"]: t["Value"] for t in resp.get("TagList", [])}


def _get_tags_elbv2_load_balancer(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_tags(ResourceArns=[resource_id])
    for desc in resp.get("TagDescriptions", []):
        if desc["ResourceArn"] == resource_id:
            return {t["Key"]: t["Value"] for t in desc.get("Tags", [])}
    return {}


def _get_tags_elasticache_cluster(client: Any, resource_id: str) -> dict[str, str]:
    resp = client.describe_cache_clusters(CacheClusterId=resource_id)
    arn = resp["CacheClusters"][0]["ARN"]
    tag_resp = client.list_tags_for_resource(ResourceName=arn)
    return {t["Key"]: t["Value"] for t in tag_resp.get("TagList", [])}


# --- Tag setters: (service, type) -> callable(client, resource_id, tags) ---

def _set_tags_s3_bucket(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    tag_set = [{"Key": k, "Value": v} for k, v in tags.items()]
    if tag_set:
        client.put_bucket_tagging(Bucket=resource_id, Tagging={"TagSet": tag_set})
    else:
        client.delete_bucket_tagging(Bucket=resource_id)


def _set_tags_sqs_queue(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    url_resp = client.get_queue_url(QueueName=resource_id)
    queue_url = url_resp["QueueUrl"]
    # SQS: untag all existing, then tag with new set
    existing = client.list_queue_tags(QueueUrl=queue_url).get("Tags", {})
    if existing:
        client.untag_queue(QueueUrl=queue_url, TagKeys=list(existing.keys()))
    if tags:
        client.tag_queue(QueueUrl=queue_url, Tags=tags)


def _set_tags_lambda(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.get_function(FunctionName=resource_id)
    arn = resp["Configuration"]["FunctionArn"]
    existing = resp.get("Tags", {})
    if existing:
        client.untag_resource(Resource=arn, TagKeys=list(existing.keys()))
    if tags:
        client.tag_resource(Resource=arn, Tags=tags)


def _set_tags_dynamodb(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.describe_table(TableName=resource_id)
    arn = resp["Table"]["TableArn"]
    existing = client.list_tags_of_resource(ResourceArn=arn)
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_resource(ResourceArn=arn, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_resource(ResourceArn=arn, Tags=tag_list)


def _set_tags_secretsmanager(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.describe_secret(SecretId=resource_id)
    existing = {t["Key"]: t["Value"] for t in resp.get("Tags", [])}
    if existing:
        client.untag_resource(SecretId=resource_id, TagKeys=list(existing.keys()))
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_resource(SecretId=resource_id, Tags=tag_list)


def _set_tags_logs(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    # resource_id is the log group ARN or name
    # First get existing tags to remove them
    try:
        existing = client.list_tags_for_resource(resourceArn=resource_id)
        existing_keys = list(existing.get("tags", {}).keys())
        if existing_keys:
            client.untag_resource(resourceArn=resource_id, tagKeys=existing_keys)
    except Exception:
        pass
    if tags:
        client.tag_resource(resourceArn=resource_id, tags=tags)


def _set_tags_ec2_instance(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    # Remove all existing tags
    existing = client.describe_tags(Filters=[{"Name": "resource-id", "Values": [resource_id]}])
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.delete_tags(Resources=[resource_id], Tags=[{"Key": k} for k in existing_keys])
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.create_tags(Resources=[resource_id], Tags=tag_list)


def _set_tags_iam_user(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_user_tags(UserName=resource_id)
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_user(UserName=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_user(UserName=resource_id, Tags=tag_list)


def _set_tags_iam_role(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_role_tags(RoleName=resource_id)
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_role(RoleName=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_role(RoleName=resource_id, Tags=tag_list)


def _set_tags_iam_policy(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_policy_tags(PolicyArn=resource_id)
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_policy(PolicyArn=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_policy(PolicyArn=resource_id, Tags=tag_list)


def _set_tags_rds_db_instance(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.describe_db_instances(DBInstanceIdentifier=resource_id)
    arn = resp["DBInstances"][0]["DBInstanceArn"]
    existing = client.list_tags_for_resource(ResourceName=arn)
    existing_keys = [t["Key"] for t in existing.get("TagList", [])]
    if existing_keys:
        client.remove_tags_from_resource(ResourceName=arn, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.add_tags_to_resource(ResourceName=arn, Tags=tag_list)


def _set_tags_rds_db_cluster(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.describe_db_clusters(DBClusterIdentifier=resource_id)
    arn = resp["DBClusters"][0]["DBClusterArn"]
    existing = client.list_tags_for_resource(ResourceName=arn)
    existing_keys = [t["Key"] for t in existing.get("TagList", [])]
    if existing_keys:
        client.remove_tags_from_resource(ResourceName=arn, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.add_tags_to_resource(ResourceName=arn, Tags=tag_list)


def _set_tags_sns_topic(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_tags_for_resource(ResourceArn=resource_id)
    existing_keys = [t["Key"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_resource(ResourceArn=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_resource(ResourceArn=resource_id, Tags=tag_list)


def _set_tags_kms_key(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_resource_tags(KeyId=resource_id)
    existing_keys = [t["TagKey"] for t in existing.get("Tags", [])]
    if existing_keys:
        client.untag_resource(KeyId=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"TagKey": k, "TagValue": v} for k, v in tags.items()]
        client.tag_resource(KeyId=resource_id, Tags=tag_list)


def _set_tags_ecr_repository(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    repo = client.describe_repositories(repositoryNames=[resource_id])
    arn = repo["repositories"][0]["repositoryArn"]
    existing = client.list_tags_for_resource(resourceArn=arn)
    existing_keys = [t["Key"] for t in existing.get("tags", [])]
    if existing_keys:
        client.untag_resource(resourceArn=arn, tagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.tag_resource(resourceArn=arn, tags=tag_list)


def _set_tags_stepfunctions(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_tags_for_resource(resourceArn=resource_id)
    existing_keys = [t["key"] for t in existing.get("tags", [])]
    if existing_keys:
        client.untag_resource(resourceArn=resource_id, tagKeys=existing_keys)
    if tags:
        tag_list = [{"key": k, "value": v} for k, v in tags.items()]
        client.tag_resource(resourceArn=resource_id, tags=tag_list)


def _set_tags_kinesis_stream(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = _get_tags_kinesis_stream(client, resource_id)
    if existing:
        client.remove_tags_from_stream(StreamName=resource_id, TagKeys=list(existing.keys()))
    if tags:
        client.add_tags_to_stream(StreamName=resource_id, Tags=tags)


def _set_tags_ssm_parameter(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = client.list_tags_for_resource(ResourceType="Parameter", ResourceId=resource_id)
    existing_keys = [t["Key"] for t in existing.get("TagList", [])]
    if existing_keys:
        client.remove_tags_from_resource(ResourceType="Parameter", ResourceId=resource_id, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.add_tags_to_resource(ResourceType="Parameter", ResourceId=resource_id, Tags=tag_list)


def _set_tags_elbv2_load_balancer(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    existing = _get_tags_elbv2_load_balancer(client, resource_id)
    if existing:
        client.remove_tags(ResourceArns=[resource_id], TagKeys=list(existing.keys()))
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.add_tags(ResourceArns=[resource_id], Tags=tag_list)


def _set_tags_elasticache_cluster(client: Any, resource_id: str, tags: dict[str, str]) -> None:
    resp = client.describe_cache_clusters(CacheClusterId=resource_id)
    arn = resp["CacheClusters"][0]["ARN"]
    existing = client.list_tags_for_resource(ResourceName=arn)
    existing_keys = [t["Key"] for t in existing.get("TagList", [])]
    if existing_keys:
        client.remove_tags_from_resource(ResourceName=arn, TagKeys=existing_keys)
    if tags:
        tag_list = [{"Key": k, "Value": v} for k, v in tags.items()]
        client.add_tags_to_resource(ResourceName=arn, Tags=tag_list)


# --- Registries ---

TAG_GETTER_REGISTRY: dict[tuple[str, str], tuple[str, Any]] = {
    ("s3", "buckets"): ("s3", _get_tags_s3_bucket),
    ("sqs", "queues"): ("sqs", _get_tags_sqs_queue),
    ("lambda", "functions"): ("lambda", _get_tags_lambda),
    ("dynamodb", "tables"): ("dynamodb", _get_tags_dynamodb),
    ("secretsmanager", "secrets"): ("secretsmanager", _get_tags_secretsmanager),
    ("logs", "log_groups"): ("logs", _get_tags_logs),
    ("ec2", "instances"): ("ec2", _get_tags_ec2_instance),
    ("iam", "users"): ("iam", _get_tags_iam_user),
    ("iam", "roles"): ("iam", _get_tags_iam_role),
    ("iam", "policies"): ("iam", _get_tags_iam_policy),
    ("rds", "db_instances"): ("rds", _get_tags_rds_db_instance),
    ("rds", "db_clusters"): ("rds", _get_tags_rds_db_cluster),
    ("sns", "topics"): ("sns", _get_tags_sns_topic),
    ("kms", "keys"): ("kms", _get_tags_kms_key),
    ("ecr", "repositories"): ("ecr", _get_tags_ecr_repository),
    ("cloudformation", "stacks"): ("cloudformation", _get_tags_cloudformation_stack),
    ("stepfunctions", "state_machines"): ("stepfunctions", _get_tags_stepfunctions),
    ("kinesis", "streams"): ("kinesis", _get_tags_kinesis_stream),
    ("ssm", "parameters"): ("ssm", _get_tags_ssm_parameter),
    ("elasticloadbalancing", "load_balancers"): ("elbv2", _get_tags_elbv2_load_balancer),
    ("elasticache", "cache_clusters"): ("elasticache", _get_tags_elasticache_cluster),
}

TAG_SETTER_REGISTRY: dict[tuple[str, str], tuple[str, Any]] = {
    ("s3", "buckets"): ("s3", _set_tags_s3_bucket),
    ("sqs", "queues"): ("sqs", _set_tags_sqs_queue),
    ("lambda", "functions"): ("lambda", _set_tags_lambda),
    ("dynamodb", "tables"): ("dynamodb", _set_tags_dynamodb),
    ("secretsmanager", "secrets"): ("secretsmanager", _set_tags_secretsmanager),
    ("logs", "log_groups"): ("logs", _set_tags_logs),
    ("ec2", "instances"): ("ec2", _set_tags_ec2_instance),
    ("iam", "users"): ("iam", _set_tags_iam_user),
    ("iam", "roles"): ("iam", _set_tags_iam_role),
    ("iam", "policies"): ("iam", _set_tags_iam_policy),
    ("rds", "db_instances"): ("rds", _set_tags_rds_db_instance),
    ("rds", "db_clusters"): ("rds", _set_tags_rds_db_cluster),
    ("sns", "topics"): ("sns", _set_tags_sns_topic),
    ("kms", "keys"): ("kms", _set_tags_kms_key),
    ("ecr", "repositories"): ("ecr", _set_tags_ecr_repository),
    ("stepfunctions", "state_machines"): ("stepfunctions", _set_tags_stepfunctions),
    ("kinesis", "streams"): ("kinesis", _set_tags_kinesis_stream),
    ("ssm", "parameters"): ("ssm", _set_tags_ssm_parameter),
    ("elasticloadbalancing", "load_balancers"): ("elbv2", _set_tags_elbv2_load_balancer),
    ("elasticache", "cache_clusters"): ("elasticache", _set_tags_elasticache_cluster),
}

# Delete registry: (service, type) -> (boto3_service, callable(client, resource_id))
DELETE_REGISTRY: dict[tuple[str, str], tuple[str, Any]] = {
    ("s3", "buckets"): ("s3", lambda c, rid: c.delete_bucket(Bucket=rid)),
    ("sqs", "queues"): ("sqs", lambda c, rid: c.delete_queue(QueueUrl=c.get_queue_url(QueueName=rid)["QueueUrl"])),
    ("lambda", "functions"): ("lambda", lambda c, rid: c.delete_function(FunctionName=rid)),
    ("dynamodb", "tables"): ("dynamodb", lambda c, rid: c.delete_table(TableName=rid)),
    ("secretsmanager", "secrets"): ("secretsmanager", lambda c, rid: c.delete_secret(SecretId=rid, ForceDeleteWithoutRecovery=True)),
    ("ec2", "instances"): ("ec2", lambda c, rid: c.terminate_instances(InstanceIds=[rid])),
}


# --- Routes ---

@router.get("/tags/supported")
def get_supported_tags() -> dict[str, Any]:
    """Return the list of (service, type) pairs that support tagging."""
    supported = []
    for (service, rtype) in TAG_GETTER_REGISTRY:
        writable = (service, rtype) in TAG_SETTER_REGISTRY
        supported.append({"service": service, "type": rtype, "writable": writable})
    return {"supported": supported}


@router.get("/tags/{service}/{resource_type}/{resource_id:path}")
def get_resource_tags(service: str, resource_type: str, resource_id: str, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Get tags for a specific resource."""
    key = (service, resource_type)
    if key not in TAG_GETTER_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Tagging not supported for {service}/{resource_type}")

    boto3_service, getter_fn = TAG_GETTER_REGISTRY[key]
    try:
        client = get_client(boto3_service, endpoint_url)
        tags = getter_fn(client, resource_id)
        return {"service": service, "type": resource_type, "id": resource_id, "tags": tags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/tags/{service}/{resource_type}/{resource_id:path}")
def update_resource_tags(service: str, resource_type: str, resource_id: str, body: TagUpdateRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Set tags for a specific resource (full replace)."""
    key = (service, resource_type)
    if key not in TAG_SETTER_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Tag editing not supported for {service}/{resource_type}")

    boto3_service, setter_fn = TAG_SETTER_REGISTRY[key]
    try:
        client = get_client(boto3_service, endpoint_url)
        setter_fn(client, resource_id, body.tags)
        return {"success": True, "service": service, "type": resource_type, "id": resource_id, "tags": body.tags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk/tag")
def bulk_tag(body: BulkTagRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Bulk add or remove tags across multiple resources."""
    if body.action not in ("add", "remove"):
        raise HTTPException(status_code=400, detail="action must be 'add' or 'remove'")

    if not body.resources:
        raise HTTPException(status_code=400, detail="resources list is required")

    if not body.tags:
        raise HTTPException(status_code=400, detail="tags are required")

    results: list[dict[str, Any]] = []
    for resource in body.resources:
        svc = resource.get("service", "")
        rtype = resource.get("type", "")
        rid = resource.get("id", "")
        key = (svc, rtype)

        if key not in TAG_GETTER_REGISTRY or key not in TAG_SETTER_REGISTRY:
            results.append({"service": svc, "type": rtype, "id": rid, "success": False, "error": "Tagging not supported"})
            continue

        boto3_svc_get, getter_fn = TAG_GETTER_REGISTRY[key]
        boto3_svc_set, setter_fn = TAG_SETTER_REGISTRY[key]

        try:
            client = get_client(boto3_svc_get, endpoint_url)
            existing = getter_fn(client, rid)

            if body.action == "add":
                merged = {**existing, **body.tags}
            else:
                merged = {k: v for k, v in existing.items() if k not in body.tags}

            set_client = get_client(boto3_svc_set, endpoint_url)
            setter_fn(set_client, rid, merged)
            results.append({"service": svc, "type": rtype, "id": rid, "success": True})
        except Exception as e:
            results.append({"service": svc, "type": rtype, "id": rid, "success": False, "error": str(e)})

    succeeded = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])
    return {"results": results, "succeeded": succeeded, "failed": failed}


@router.post("/bulk/delete")
def bulk_delete(body: BulkDeleteRequest, endpoint_url: str | None = Depends(get_endpoint_url)) -> dict[str, Any]:
    """Bulk delete multiple resources across services."""
    if not body.resources:
        raise HTTPException(status_code=400, detail="resources list is required")

    results: list[dict[str, Any]] = []
    for resource in body.resources:
        svc = resource.get("service", "")
        rtype = resource.get("type", "")
        rid = resource.get("id", "")
        key = (svc, rtype)

        if key not in DELETE_REGISTRY:
            results.append({"service": svc, "type": rtype, "id": rid, "success": False, "error": "Delete not supported"})
            continue

        boto3_svc, delete_fn = DELETE_REGISTRY[key]
        try:
            client = get_client(boto3_svc, endpoint_url)
            delete_fn(client, rid)
            results.append({"service": svc, "type": rtype, "id": rid, "success": True})
        except Exception as e:
            results.append({"service": svc, "type": rtype, "id": rid, "success": False, "error": str(e)})

    succeeded = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])
    return {"results": results, "succeeded": succeeded, "failed": failed}
