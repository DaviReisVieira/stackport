import importlib.metadata
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends

from backend.aws_client import get_client

logger = logging.getLogger(__name__)
from backend.cache import cache
from backend.config import AWS_ENDPOINT_URL, AWS_REGION, STACKPORT_SERVICES
from backend.routes.common import get_endpoint_url

router = APIRouter()

SERVICE_REGISTRY: dict[str, list[tuple[str, str, str, str]]] = {
    "s3": [("buckets", "s3", "list_buckets", "Buckets")],
    "sqs": [("queues", "sqs", "list_queues", "QueueUrls")],
    "sns": [("topics", "sns", "list_topics", "Topics")],
    "dynamodb": [("tables", "dynamodb", "list_tables", "TableNames")],
    "lambda": [("functions", "lambda", "list_functions", "Functions")],
    "iam": [
        ("roles", "iam", "list_roles", "Roles"),
        ("users", "iam", "list_users", "Users"),
        ("policies", "iam", "list_policies", "Policies"),
    ],
    "logs": [("log_groups", "logs", "describe_log_groups", "logGroups")],
    "ssm": [("parameters", "ssm", "describe_parameters", "Parameters")],
    "secretsmanager": [("secrets", "secretsmanager", "list_secrets", "SecretList")],
    "kinesis": [("streams", "kinesis", "list_streams", "StreamNames")],
    "events": [
        ("rules", "events", "list_rules", "Rules"),
        ("event_buses", "events", "list_event_buses", "EventBuses"),
    ],
    "ec2": [
        ("instances", "ec2", "describe_instances", "Reservations"),
        ("vpcs", "ec2", "describe_vpcs", "Vpcs"),
        ("subnets", "ec2", "describe_subnets", "Subnets"),
        ("security_groups", "ec2", "describe_security_groups", "SecurityGroups"),
        ("volumes", "ec2", "describe_volumes", "Volumes"),
    ],
    "route53": [("hosted_zones", "route53", "list_hosted_zones", "HostedZones")],
    "kms": [("keys", "kms", "list_keys", "Keys")],
    "cloudformation": [("stacks", "cloudformation", "list_stacks", "StackSummaries")],
    "stepfunctions": [
        ("state_machines", "stepfunctions", "list_state_machines", "stateMachines"),
    ],
    "rds": [
        ("db_instances", "rds", "describe_db_instances", "DBInstances"),
        ("db_clusters", "rds", "describe_db_clusters", "DBClusters"),
    ],
    "ecs": [
        ("clusters", "ecs", "list_clusters", "clusterArns"),
        ("task_definitions", "ecs", "list_task_definitions", "taskDefinitionArns"),
    ],
    "monitoring": [
        ("alarms", "cloudwatch", "describe_alarms", "MetricAlarms"),
        ("dashboards", "cloudwatch", "list_dashboards", "DashboardEntries"),
    ],
    "ses": [("identities", "ses", "list_identities", "Identities")],
    "acm": [("certificates", "acm", "list_certificates", "CertificateSummaryList")],
    "wafv2": [("web_acls", "wafv2", "list_web_acls", "WebACLs")],
    "ecr": [("repositories", "ecr", "describe_repositories", "repositories")],
    "elasticache": [("cache_clusters", "elasticache", "describe_cache_clusters", "CacheClusters")],
    "glue": [
        ("databases", "glue", "get_databases", "DatabaseList"),
        ("crawlers", "glue", "get_crawlers", "Crawlers"),
    ],
    "athena": [("workgroups", "athena", "list_work_groups", "WorkGroups")],
    "apigateway": [("apis", "apigatewayv2", "get_apis", "Items")],
    "firehose": [("delivery_streams", "firehose", "list_delivery_streams", "DeliveryStreamNames")],
    "cognito-idp": [("user_pools", "cognito-idp", "list_user_pools", "UserPools")],
    "cognito-identity": [("identity_pools", "cognito-identity", "list_identity_pools", "IdentityPools")],
    "elasticmapreduce": [("clusters", "emr", "list_clusters", "Clusters")],
    "elasticloadbalancing": [("load_balancers", "elbv2", "describe_load_balancers", "LoadBalancers")],
    "elasticfilesystem": [("file_systems", "efs", "describe_file_systems", "FileSystems")],
    "cloudfront": [("distributions", "cloudfront", "list_distributions", "DistributionList")],
    "appsync": [("graphql_apis", "appsync", "list_graphql_apis", "graphqlApis")],
    "sts": [],
}

_start_time = time.time()


@router.get("/health")
def health():
    try:
        version = importlib.metadata.version("stackport")
    except importlib.metadata.PackageNotFoundError:
        version = "dev"
    enabled = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]
    return {
        "status": "ok",
        "version": version,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "endpoint_url": AWS_ENDPOINT_URL,
        "region": AWS_REGION,
        "services_count": len(enabled),
    }


# Some APIs require extra parameters to call
_METHOD_KWARGS: dict[tuple[str, str], dict] = {
    ("cognito-idp", "list_user_pools"): {"MaxResults": 60},
    ("cognito-identity", "list_identity_pools"): {"MaxResults": 60},
    ("wafv2", "list_web_acls"): {"Scope": "REGIONAL"},
}


def _count_items(resp, response_key: str) -> int:
    """Extract item count from a response, handling nested structures."""
    items = resp.get(response_key, [])
    # cloudfront list_distributions returns {"DistributionList": {"Items": [...]}}
    if isinstance(items, dict) and "Items" in items:
        return len(items.get("Items", []) or [])
    if isinstance(items, list):
        return len(items)
    return 0


def _probe_service(service: str, endpoint_url: str) -> tuple[str, dict]:
    """Probe a single service and return (service_name, result_dict)."""
    registry_entries = SERVICE_REGISTRY.get(service)
    if not registry_entries:
        return service, {"status": "unavailable", "resources": {}}

    resources: dict[str, int] = {}
    try:
        for resource_type, boto3_service, method_name, response_key in registry_entries:
            client = get_client(boto3_service, endpoint_url)
            method = getattr(client, method_name)
            kwargs = _METHOD_KWARGS.get((boto3_service, method_name), {})
            try:
                resp = method(**kwargs)
                resources[resource_type] = _count_items(resp, response_key)
            except Exception:
                logger.debug("Failed to probe %s/%s", service, resource_type, exc_info=True)
                resources[resource_type] = 0
        return service, {"status": "available", "resources": resources}
    except Exception:
        logger.warning("Service %s unavailable", service, exc_info=True)
        return service, {"status": "unavailable", "resources": {}}


@router.get("/stats")
def get_stats(endpoint_url: str = Depends(get_endpoint_url)):
    cache_key = f"{endpoint_url}:stats"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    enabled_services = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]
    services: dict = {}
    total_resources = 0

    with ThreadPoolExecutor(max_workers=min(len(enabled_services), 10)) as executor:
        futures = {executor.submit(_probe_service, svc, endpoint_url): svc for svc in enabled_services}
        for future in as_completed(futures):
            svc_name, result = future.result()
            services[svc_name] = result
            total_resources += sum(result["resources"].values())

    # Sort services alphabetically for stable dashboard ordering
    sorted_services = dict(sorted(services.items()))

    response = {
        "services": sorted_services,
        "total_resources": total_resources,
        "uptime_seconds": round(time.time() - _start_time, 1),
    }
    cache.set(cache_key, response, ttl=5)
    return response
