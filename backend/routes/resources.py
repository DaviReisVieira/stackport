import logging
from collections.abc import Callable
from typing import Any

from botocore.exceptions import ParamValidationError
from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.aws_errors import shorten
from backend.cache import cache
from backend.routes.common import EndpointInfo, get_endpoint_info
from backend.routes.stats import SERVICE_REGISTRY, list_items, ungroup

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
    ("scheduler", "schedules"): ("scheduler", "get_schedule", "Name", None),
    ("scheduler", "schedule_groups"): ("scheduler", "get_schedule_group", "Name", None),
    ("pipes", "pipes"): ("pipes", "describe_pipe", "Name", None),
    ("ses", "configuration_sets"): ("ses", "describe_configuration_set", "ConfigurationSetName", None),
    ("ses", "email_templates"): ("ses", "get_template", "TemplateName", "Template"),
    ("kafka", "clusters"): ("kafka", "describe_cluster", "ClusterArn", "ClusterInfo"),
    # Security & Identity
    ("iam", "roles"): ("iam", "get_role", "RoleName", "Role"),
    ("iam", "users"): ("iam", "get_user", "UserName", "User"),
    ("iam", "policies"): ("iam", "get_policy", "PolicyArn", "Policy"),
    ("secretsmanager", "secrets"): ("secretsmanager", "describe_secret", "SecretId", None),
    ("kms", "keys"): ("kms", "describe_key", "KeyId", "KeyMetadata"),
    ("acm", "certificates"): ("acm", "describe_certificate", "CertificateArn", "Certificate"),
    ("cognito-idp", "user_pools"): ("cognito-idp", "describe_user_pool", "UserPoolId", "UserPool"),
    ("cognito-identity", "identity_pools"): ("cognito-identity", "describe_identity_pool", "IdentityPoolId", None),
    ("wafv2", "web_acls"): ("wafv2", "get_web_acl", "Name", "WebACL"),
    ("verifiedpermissions", "policy_stores"): ("verifiedpermissions", "get_policy_store", "policyStoreId", None),
    # Management
    ("appconfig", "applications"): ("appconfig", "get_application", "ApplicationId", None),
    # DescribeTrails, not GetTrail: Floci only serves the first.
    ("cloudtrail", "trails"): ("cloudtrail", "describe_trails", "trailNameList", "trailList"),
    ("xray", "groups"): ("xray", "get_group", "GroupName", "Group"),
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
    ("servicediscovery", "namespaces"): ("servicediscovery", "get_namespace", "Id", "Namespace"),
    ("servicediscovery", "services"): ("servicediscovery", "get_service", "Id", "Service"),
    # EC2
    ("ec2", "instances"): ("ec2", "describe_instances", "InstanceIds", "Reservations"),
    ("ec2", "vpcs"): ("ec2", "describe_vpcs", "VpcIds", "Vpcs"),
    ("ec2", "subnets"): ("ec2", "describe_subnets", "SubnetIds", "Subnets"),
    ("ec2", "security_groups"): ("ec2", "describe_security_groups", "GroupIds", "SecurityGroups"),
    ("ec2", "volumes"): ("ec2", "describe_volumes", "VolumeIds", "Volumes"),
    ("elasticfilesystem", "file_systems"): ("efs", "describe_file_systems", "FileSystemId", "FileSystems"),
    # Containers & batch
    ("ecr", "repositories"): ("ecr", "describe_repositories", "repositoryNames", "repositories"),
    ("eks", "clusters"): ("eks", "describe_cluster", "name", "cluster"),
    ("batch", "compute_environments"): ("batch", "describe_compute_environments", "computeEnvironments", "computeEnvironments"),
    ("batch", "job_queues"): ("batch", "describe_job_queues", "jobQueues", "jobQueues"),
    # Developer tools
    ("codebuild", "projects"): ("codebuild", "batch_get_projects", "names", "projects"),
    ("codepipeline", "pipelines"): ("codepipeline", "get_pipeline", "name", None),
    ("codecommit", "repositories"): ("codecommit", "get_repository", "repositoryName", "repositoryMetadata"),
    ("codedeploy", "applications"): ("codedeploy", "get_application", "applicationName", "application"),
    # Analytics & ETL
    ("glue", "databases"): ("glue", "get_database", "Name", "Database"),
    ("glue", "crawlers"): ("glue", "get_crawler", "Name", "Crawler"),
    ("athena", "workgroups"): ("athena", "get_work_group", "WorkGroup", "WorkGroup"),
    ("es", "domains"): ("opensearch", "describe_domain", "DomainName", "DomainStatus"),
    # Machine learning
    ("bedrock", "custom_models"): ("bedrock", "get_custom_model", "modelIdentifier", None),
    # API
    ("apigateway", "rest_apis"): ("apigateway", "get_rest_api", "restApiId", None),
    ("apigateway", "apis"): ("apigatewayv2", "get_api", "ApiId", None),
    ("appsync", "graphql_apis"): ("appsync", "get_graphql_api", "apiId", "graphqlApi"),
    # EMR
    ("elasticmapreduce", "clusters"): ("emr", "describe_cluster", "ClusterId", "Cluster"),
}

# Extra parameters some detail calls need besides the id.
_DESCRIBE_KWARGS: dict[tuple[str, str], dict] = {
    # Without AttributeNames, GetQueueAttributes answers with no attributes at all.
    ("sqs", "queues"): {"AttributeNames": ["All"]},
    ("wafv2", "web_acls"): {"Scope": "REGIONAL"},
    # Without attribute names, only the name comes back.
    ("ses", "configuration_sets"): {
        "ConfigurationSetAttributeNames": ["eventDestinations", "trackingOptions", "deliveryOptions", "reputationOptions"],
    },
}

# Detail calls that need more of the resource than its id. The resource is found
# in its listing by id, and the detail call's id parameter and these are passed
# the listed item's fields of the same names. A rule is only found on its own
# event bus (rules on two buses can share a name), and a schedule in its own
# group; a web ACL needs its Id too.
_DESCRIBE_FROM_LISTING: dict[tuple[str, str], tuple[str, ...]] = {
    ("events", "rules"): ("EventBusName",),
    ("scheduler", "schedules"): ("GroupName",),
    ("wafv2", "web_acls"): ("Id",),
}

# Detail parameters that take a list of ids, given the one id.
_LIST_PARAMS = frozenset({
    "InstanceIds", "VpcIds", "SubnetIds", "GroupIds", "VolumeIds",
    "repositoryNames", "clusters", "AlarmNames", "LoadBalancerArns",
    "names", "computeEnvironments", "jobQueues", "trailNameList",
})

# Override the generic _ID_FIELDS for services where the default order picks
# the wrong field (e.g. Arn before Name, or Name before Id).
_PREFERRED_ID_FIELD: dict[tuple[str, str], str] = {
    ("route53", "hosted_zones"): "Id",
    # Unique across event buses, unlike the name.
    ("events", "rules"): "Arn",
    ("events", "event_buses"): "Name",
    # Unique across schedule groups, unlike the name.
    ("scheduler", "schedules"): "Arn",
    ("scheduler", "schedule_groups"): "Name",
    ("pipes", "pipes"): "Name",
    ("appconfig", "applications"): "Id",
    ("servicediscovery", "namespaces"): "Id",
    ("servicediscovery", "services"): "Id",
    ("codepipeline", "pipelines"): "name",
    ("xray", "groups"): "GroupName",
    # Trails replicated from another region are listed too; only their ARN finds them.
    ("cloudtrail", "trails"): "TrailARN",
    ("wafv2", "web_acls"): "Name",
    ("appsync", "graphql_apis"): "apiId",
    ("elasticmapreduce", "clusters"): "Id",
    ("cognito-idp", "user_pools"): "Id",
    ("apigateway", "rest_apis"): "id",
    ("apigateway", "apis"): "ApiId",
    ("iam", "policies"): "Arn",
    ("ec2", "subnets"): "SubnetId",
    ("ec2", "security_groups"): "GroupId",
    ("elasticfilesystem", "file_systems"): "FileSystemId",
    ("rds", "db_clusters"): "DBClusterIdentifier",
    # VpcId comes first in _ID_FIELDS.
    ("elasticloadbalancing", "load_balancers"): "LoadBalancerArn",
    # Deleted stacks are listed too, and a new stack can reuse a deleted one's
    # name; DescribeStacks takes the id for both.
    ("cloudformation", "stacks"): "StackId",
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
    "apiId",
    "ClusterId",
    "computeEnvironmentName",
    "jobQueueName",
    "DomainName",
    "ClusterArn",
    "modelArn",
    "policyStoreId",
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


class UnknownResourceType(LookupError):
    """No detail lookup is registered for the service and resource type."""


class ResourceNotFound(LookupError):
    """Nothing in a resource type's listing has the id asked for."""


def _find_listed(client, service: str, res_type: str, res_id: str) -> dict:
    """The item of ``res_type``'s listing whose id is ``res_id``."""
    _, boto3_service, method_name, response_key = next(
        entry for entry in SERVICE_REGISTRY[service] if entry[0] == res_type
    )
    preferred = _PREFERRED_ID_FIELD.get((service, res_type))
    for item in list_items(client, boto3_service, method_name, response_key):
        if _extract_id(item, preferred) == res_id:
            return item
    raise ResourceNotFound(f"'{res_id}' wasn't found in {service} {res_type}.")


def _describe_ses_identity(client, identity: str) -> dict:
    """SES identities are plain strings: put their detail together from two calls."""
    verification = client.get_identity_verification_attributes(Identities=[identity])
    attrs = verification.get("VerificationAttributes", {}).get(identity, {})
    dkim = client.get_identity_dkim_attributes(Identities=[identity])
    dkim_attrs = dkim.get("DkimAttributes", {}).get(identity, {})
    return {
        "Identity": identity,
        "VerificationStatus": attrs.get("VerificationStatus", "Unknown"),
        "VerificationToken": attrs.get("VerificationToken"),
        "DkimEnabled": dkim_attrs.get("DkimEnabled", False),
        "DkimVerificationStatus": dkim_attrs.get("DkimVerificationStatus", "Unknown"),
        "DkimTokens": dkim_attrs.get("DkimTokens", []),
    }


def describe_resource(client_for: Callable[[str], Any], service: str, res_type: str, res_id: str):
    """The detail of one listed resource, ready for JSON: what the detail route and ``stackport describe`` show.

    ``client_for(boto3_service)`` returns a client for the endpoint to ask.

    Raises:
        UnknownResourceType: no detail lookup is registered for ``service``/``res_type``.
        ResourceNotFound: the lookup goes through the listing, and nothing listed has ``res_id``.
        botocore errors from the calls, for the caller to report.
    """
    if (service, res_type) == ("ses", "identities"):
        return _serialize(_describe_ses_identity(client_for("ses"), res_id))

    lookup = DESCRIBE_REGISTRY.get((service, res_type))
    if lookup is None:
        raise UnknownResourceType(f"No detail lookup registered for {service}/{res_type}")
    boto3_service, method_name, id_param, response_key = lookup
    client = client_for(boto3_service)

    params = dict(_DESCRIBE_KWARGS.get((service, res_type), {}))
    from_listing = _DESCRIBE_FROM_LISTING.get((service, res_type))
    if from_listing is not None:
        item = _find_listed(client, service, res_type, res_id)
        params.update({field: item[field] for field in (id_param, *from_listing)})
    elif id_param in _LIST_PARAMS:
        params[id_param] = [res_id]
    else:
        params[id_param] = res_id

    resp = getattr(client, method_name)(**params)
    resp.pop("ResponseMetadata", None)
    if response_key is None:
        return _serialize(resp)
    detail = resp.get(response_key, resp)
    if isinstance(detail, list):
        detail = ungroup(detail, boto3_service, method_name)
    return _serialize(detail)


@router.get("/resources/{service}")
def list_resources(service: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    cache_key = f"{ep.cache_scope()}:resources:{service}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    registry_entries = SERVICE_REGISTRY.get(service)
    if not registry_entries:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    resources: dict[str, list[dict]] = {}
    for resource_type, boto3_service, method_name, response_key in registry_entries:
        try:
            client = get_client(boto3_service, **ep.client_kwargs())
            items = list_items(client, boto3_service, method_name, response_key)
            preferred = _PREFERRED_ID_FIELD.get((service, resource_type))
            resources[resource_type] = [_summarize_item(item, preferred) for item in items]
        except Exception:
            logger.debug("Failed to list %s/%s", service, resource_type, exc_info=True)
            resources[resource_type] = []

    result = {"service": service, "resources": resources}
    cache.set(cache_key, result, ttl=5)
    return result


@router.get("/resources/{service}/{res_type}/{res_id:path}")
def get_resource_detail(service: str, res_type: str, res_id: str, ep: EndpointInfo = Depends(get_endpoint_info)):
    cache_key = f"{ep.cache_scope()}:detail:{service}:{res_type}:{res_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Errors from the endpoint (a missing resource, a malformed id, an operation
    # it lacks) go to the app's AWS error handlers, which answer with its status.
    try:
        detail = describe_resource(lambda name: get_client(name, **ep.client_kwargs()), service, res_type, res_id)
    except (UnknownResourceType, ResourceNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ParamValidationError as exc:
        # botocore refused the id before sending it (one too short, for instance).
        raise HTTPException(status_code=400, detail=shorten(str(exc))) from exc

    result = {"service": service, "type": res_type, "id": res_id, "detail": detail}
    cache.set(cache_key, result, ttl=5)
    return result


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
