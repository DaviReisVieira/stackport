import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.cache import cache
from backend.routes.common import get_endpoint_url
from backend.routes.stats import SERVICE_REGISTRY, _METHOD_KWARGS, _count_items

logger = logging.getLogger(__name__)

router = APIRouter()

# Maps (service, resource_type) -> (boto3_service, method, id_param, response_key)
# response_key=None means return the full response (minus ResponseMetadata)
DESCRIBE_REGISTRY: dict[tuple[str, str], tuple[str, str, str, str | None]] = {
    # Storage
    ("s3", "buckets"): ("s3", "list_objects_v2", "Bucket", "Contents"),
    # Compute
    ("lambda", "functions"): ("lambda", "get_function", "FunctionName", None),
    ("ecs", "clusters"): ("ecs", "describe_clusters", "clusters", "clusters"),
    ("ecs", "task_definitions"): ("ecs", "describe_task_definition", "taskDefinition", "taskDefinition"),
    # Database
    ("dynamodb", "tables"): ("dynamodb", "describe_table", "TableName", "Table"),
    ("rds", "db_instances"): ("rds", "describe_db_instances", "DBInstanceIdentifier", "DBInstances"),
    ("rds", "db_clusters"): ("rds", "describe_db_clusters", "DBClusterIdentifier", "DBClusters"),
    ("elasticache", "cache_clusters"): ("elasticache", "describe_cache_clusters", "CacheClusterId", None),
    # Messaging
    ("sqs", "queues"): ("sqs", "get_queue_attributes", "QueueUrl", "Attributes"),
    ("sns", "topics"): ("sns", "get_topic_attributes", "TopicArn", "Attributes"),
    ("kinesis", "streams"): ("kinesis", "describe_stream", "StreamName", "StreamDescription"),
    ("firehose", "delivery_streams"): ("firehose", "describe_delivery_stream", "DeliveryStreamName", "DeliveryStreamDescription"),
    ("events", "rules"): ("events", "describe_rule", "Name", None),
    ("events", "event_buses"): ("events", "describe_event_bus", "Name", None),
    # Security & Identity
    ("iam", "roles"): ("iam", "get_role", "RoleName", "Role"),
    ("iam", "users"): ("iam", "get_user", "UserName", "User"),
    ("iam", "policies"): ("iam", "get_policy", "PolicyArn", "Policy"),
    ("secretsmanager", "secrets"): ("secretsmanager", "describe_secret", "SecretId", None),
    ("kms", "keys"): ("kms", "describe_key", "KeyId", "KeyMetadata"),
    ("acm", "certificates"): ("acm", "describe_certificate", "CertificateArn", "Certificate"),
    ("cognito-idp", "user_pools"): ("cognito-idp", "describe_user_pool", "UserPoolId", "UserPool"),
    ("cognito-identity", "identity_pools"): ("cognito-identity", "describe_identity_pool", "IdentityPoolId", None),
    # Management
    ("logs", "log_groups"): ("logs", "describe_log_groups", "logGroupNamePrefix", "logGroups"),
    ("ssm", "parameters"): ("ssm", "get_parameter", "Name", "Parameter"),
    ("cloudformation", "stacks"): ("cloudformation", "describe_stacks", "StackName", "Stacks"),
    ("stepfunctions", "state_machines"): ("stepfunctions", "describe_state_machine", "stateMachineArn", None),
    ("monitoring", "alarms"): ("cloudwatch", "describe_alarms", "AlarmNames", "MetricAlarms"),
    ("monitoring", "dashboards"): ("cloudwatch", "get_dashboard", "DashboardName", None),
    # Networking & CDN
    ("route53", "hosted_zones"): ("route53", "get_hosted_zone", "Id", "HostedZone"),
    ("cloudfront", "distributions"): ("cloudfront", "get_distribution", "Id", "Distribution"),
    ("elasticloadbalancing", "load_balancers"): ("elbv2", "describe_load_balancers", "LoadBalancerArns", "LoadBalancers"),
    # EC2
    ("ec2", "instances"): ("ec2", "describe_instances", "InstanceIds", "Reservations"),
    ("ec2", "vpcs"): ("ec2", "describe_vpcs", "VpcIds", "Vpcs"),
    ("ec2", "subnets"): ("ec2", "describe_subnets", "SubnetIds", "Subnets"),
    ("ec2", "security_groups"): ("ec2", "describe_security_groups", "GroupIds", "SecurityGroups"),
    ("ec2", "volumes"): ("ec2", "describe_volumes", "VolumeIds", "Volumes"),
    ("elasticfilesystem", "file_systems"): ("efs", "describe_file_systems", "FileSystemId", "FileSystems"),
    # Containers
    ("ecr", "repositories"): ("ecr", "describe_repositories", "repositoryNames", "repositories"),
    # Analytics & ETL
    ("glue", "databases"): ("glue", "get_database", "Name", "Database"),
    ("glue", "crawlers"): ("glue", "get_crawler", "Name", "Crawler"),
    ("athena", "workgroups"): ("athena", "get_work_group", "WorkGroup", "WorkGroup"),
    # API
    ("apigateway", "apis"): ("apigatewayv2", "get_api", "ApiId", None),
    ("appsync", "graphql_apis"): ("appsync", "get_graphql_api", "apiId", "graphqlApi"),
    # EMR
    ("elasticmapreduce", "clusters"): ("emr", "describe_cluster", "ClusterId", "Cluster"),
}

# Override the generic _ID_FIELDS for services where the default order picks
# the wrong field (e.g. Arn before Name, or Name before Id).
_PREFERRED_ID_FIELD: dict[tuple[str, str], str] = {
    ("route53", "hosted_zones"): "Id",
    ("events", "rules"): "Name",
    ("events", "event_buses"): "Name",
    ("wafv2", "web_acls"): "Name",
}

# Known ID field names for extracting a resource identifier from list results
_ID_FIELDS = [
    "BucketName",
    "FunctionName",
    "TableName",
    "TopicArn",
    "QueueUrl",
    "RoleName",
    "UserName",
    "PolicyName",
    "Arn",
    "PolicyArn",
    "logGroupName",
    "Name",
    "SecretName",
    "StreamName",
    "RuleName",
    "InstanceId",
    "VpcId",
    "SubnetId",
    "GroupId",
    "VolumeId",
    "HostedZoneId",
    "Id",
    "KeyId",
    "StackName",
    "stateMachineArn",
    "DBInstanceIdentifier",
    "DBClusterIdentifier",
    "clusterArn",
    "CertificateArn",
    "repositoryName",
    "CacheClusterId",
    "DeliveryStreamName",
    "WorkGroupName",
    "ApiId",
    "UserPoolId",
    "IdentityPoolId",
    "LoadBalancerArn",
    "FileSystemId",
    "AlarmName",
    "DashboardName",
    "CrawlerName",
    "DatabaseName",
    "DistributionId",
]


def _extract_id(item, preferred_field: str | None = None) -> str:
    """Extract a usable ID from a list API result item."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        if preferred_field and preferred_field in item:
            return str(item[preferred_field])
        for field in _ID_FIELDS:
            if field in item:
                return str(item[field])
        # Fallback: first string value
        for v in item.values():
            if isinstance(v, str):
                return v
    return str(item)


def _summarize_item(item, preferred_field: str | None = None) -> dict:
    """Create a summary dict from a list API result item."""
    if isinstance(item, str):
        return {"id": item}
    if isinstance(item, dict):
        summary = {"id": _extract_id(item, preferred_field)}
        for key, value in item.items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                summary[key] = value
            elif hasattr(value, "isoformat"):
                summary[key] = value.isoformat()
        return summary
    return {"id": str(item)}


@router.get("/resources/{service}")
def list_resources(service: str, endpoint_url: str = Depends(get_endpoint_url)):
    cache_key = f"{endpoint_url}:resources:{service}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    registry_entries = SERVICE_REGISTRY.get(service)
    if not registry_entries:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    resources: dict[str, list[dict]] = {}
    for resource_type, boto3_service, method_name, response_key in registry_entries:
        try:
            client = get_client(boto3_service, endpoint_url)
            method = getattr(client, method_name)
            kwargs = _METHOD_KWARGS.get((boto3_service, method_name), {})
            resp = method(**kwargs)
            items = resp.get(response_key, [])
            # Handle nested structures (e.g., cloudfront DistributionList.Items)
            if isinstance(items, dict) and "Items" in items:
                items = items.get("Items", []) or []
            preferred = _PREFERRED_ID_FIELD.get((service, resource_type))
            resources[resource_type] = [_summarize_item(item, preferred) for item in items]
        except Exception:
            logger.debug("Failed to list %s/%s", service, resource_type, exc_info=True)
            resources[resource_type] = []

    result = {"service": service, "resources": resources}
    cache.set(cache_key, result, ttl=5)
    return result


@router.get("/resources/{service}/{res_type}/{res_id:path}")
def get_resource_detail(service: str, res_type: str, res_id: str, endpoint_url: str = Depends(get_endpoint_url)):
    cache_key = f"{endpoint_url}:detail:{service}:{res_type}:{res_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # WAFv2 get_web_acl requires Name, Scope, AND Id — resolve Id from list first
    if (service, res_type) == ("wafv2", "web_acls"):
        try:
            client = get_client("wafv2", endpoint_url)
            acls = client.list_web_acls(Scope="REGIONAL").get("WebACLs", [])
            match = next((a for a in acls if a.get("Name") == res_id), None)
            if not match:
                raise HTTPException(404, f"Web ACL '{res_id}' not found")
            resp = client.get_web_acl(Name=res_id, Scope="REGIONAL", Id=match["Id"])
            resp.pop("ResponseMetadata", None)
            detail = _serialize(resp.get("WebACL", resp))
            result = {"service": service, "type": res_type, "id": res_id, "detail": detail}
            cache.set(cache_key, result, ttl=5)
            return result
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Failed to get detail for %s/%s/%s", service, res_type, res_id, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    lookup = DESCRIBE_REGISTRY.get((service, res_type))
    if not lookup:
        raise HTTPException(
            status_code=404,
            detail=f"No detail lookup registered for {service}/{res_type}",
        )

    boto3_service, method_name, id_param, response_key = lookup

    # Some APIs take list parameters (e.g., InstanceIds, VpcIds)
    _LIST_PARAMS = {
        "InstanceIds", "VpcIds", "SubnetIds", "GroupIds", "VolumeIds",
        "repositoryNames", "clusters", "AlarmNames", "LoadBalancerArns",
    }

    try:
        client = get_client(boto3_service, endpoint_url)
        method = getattr(client, method_name)
        if id_param in _LIST_PARAMS:
            resp = method(**{id_param: [res_id]})
        else:
            resp = method(**{id_param: res_id})

        # Remove boto3 metadata
        resp.pop("ResponseMetadata", None)

        if response_key is not None:
            detail = resp.get(response_key, resp)
        else:
            detail = resp

        # Convert datetime objects for JSON serialization
        detail = _serialize(detail)

        result = {
            "service": service,
            "type": res_type,
            "id": res_id,
            "detail": detail,
        }
        cache.set(cache_key, result, ttl=5)
        return result
    except Exception as exc:
        logger.warning("Failed to get detail for %s/%s/%s", service, res_type, res_id, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _serialize(obj):
    """Recursively convert non-JSON-serializable types."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    return obj
