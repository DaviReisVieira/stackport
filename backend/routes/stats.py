import importlib.metadata
import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends

from backend.aws_client import get_client
from backend import aws_emulator
from backend.aws_emulator import AwsEmulatorFilesError
from backend.aws_errors import ENDPOINT_KINDS, UNTRUSTED_CERTIFICATE_MESSAGE, ClassifiedError, ErrorKind, classify, shorten
from backend.cache import cache
from backend.config import (
    AWS_ENDPOINT_URL,
    AWS_REGION,
    STACKPORT_ALLOW_WRITES,
    STACKPORT_LEARN,
    STACKPORT_PROBE_WORKERS,
    STACKPORT_SERVICES,
    is_local_endpoint,
)
from backend.connection import describe_connection, plan_connection
from backend.emulators import detect_emulator_quickly
from backend.routes.common import EndpointInfo, get_endpoint_info

logger = logging.getLogger(__name__)

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
    # The classic SES API, like identities. AWS keeps one set of configuration
    # sets and templates behind both APIs, and every emulator StackPort supports
    # answers these calls, while LocalStack has no SES v2 and moto no v2 templates.
    "ses": [
        ("identities", "ses", "list_identities", "Identities"),
        ("configuration_sets", "ses", "list_configuration_sets", "ConfigurationSets"),
        ("email_templates", "ses", "list_templates", "TemplatesMetadata"),
    ],
    "acm": [("certificates", "acm", "list_certificates", "CertificateSummaryList")],
    "wafv2": [("web_acls", "wafv2", "list_web_acls", "WebACLs")],
    "ecr": [("repositories", "ecr", "describe_repositories", "repositories")],
    "elasticache": [("cache_clusters", "elasticache", "describe_cache_clusters", "CacheClusters")],
    "glue": [
        ("databases", "glue", "get_databases", "DatabaseList"),
        ("crawlers", "glue", "get_crawlers", "Crawlers"),
    ],
    "athena": [("workgroups", "athena", "list_work_groups", "WorkGroups")],
    "apigateway": [
        ("rest_apis", "apigateway", "get_rest_apis", "items"),
        ("apis", "apigatewayv2", "get_apis", "Items"),
    ],
    "firehose": [("delivery_streams", "firehose", "list_delivery_streams", "DeliveryStreamNames")],
    "cognito-idp": [("user_pools", "cognito-idp", "list_user_pools", "UserPools")],
    "cognito-identity": [("identity_pools", "cognito-identity", "list_identity_pools", "IdentityPools")],
    "elasticmapreduce": [("clusters", "emr", "list_clusters", "Clusters")],
    "elasticloadbalancing": [("load_balancers", "elbv2", "describe_load_balancers", "LoadBalancers")],
    "elasticfilesystem": [("file_systems", "efs", "describe_file_systems", "FileSystems")],
    "cloudfront": [("distributions", "cloudfront", "list_distributions", "DistributionList")],
    "appsync": [("graphql_apis", "appsync", "list_graphql_apis", "graphqlApis")],
    "scheduler": [
        ("schedules", "scheduler", "list_schedules", "Schedules"),
        ("schedule_groups", "scheduler", "list_schedule_groups", "ScheduleGroups"),
    ],
    "pipes": [("pipes", "pipes", "list_pipes", "Pipes")],
    "appconfig": [("applications", "appconfig", "list_applications", "Items")],
    "servicediscovery": [
        ("namespaces", "servicediscovery", "list_namespaces", "Namespaces"),
        ("services", "servicediscovery", "list_services", "Services"),
    ],
    "codebuild": [("projects", "codebuild", "list_projects", "projects")],
    "codepipeline": [("pipelines", "codepipeline", "list_pipelines", "pipelines")],
    "codecommit": [("repositories", "codecommit", "list_repositories", "repositories")],
    "codedeploy": [("applications", "codedeploy", "list_applications", "applications")],
    "batch": [
        ("compute_environments", "batch", "describe_compute_environments", "computeEnvironments"),
        ("job_queues", "batch", "describe_job_queues", "jobQueues"),
    ],
    "eks": [("clusters", "eks", "list_clusters", "clusters")],
    # Keyed by the name OpenSearch Service signs requests with, like monitoring
    # or elasticmapreduce; boto3 calls it opensearch.
    "es": [("domains", "opensearch", "list_domain_names", "DomainNames")],
    # ListClusters, not ListClustersV2: MiniStack only serves the first. It
    # leaves out serverless clusters, which only V2 lists.
    "kafka": [("clusters", "kafka", "list_clusters", "ClusterInfoList")],
    "bedrock": [("custom_models", "bedrock", "list_custom_models", "modelSummaries")],
    "cloudtrail": [("trails", "cloudtrail", "describe_trails", "trailList")],
    "xray": [("groups", "xray", "get_groups", "Groups")],
    "verifiedpermissions": [("policy_stores", "verifiedpermissions", "list_policy_stores", "policyStores")],
    "sts": [],
}

_start_time = time.time()


@router.get("/health")
def health(ep: EndpointInfo = Depends(get_endpoint_info)):
    try:
        version = importlib.metadata.version("stackport")
    except importlib.metadata.PackageNotFoundError:
        version = "dev"
    enabled = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]

    connection_type = "local" if is_local_endpoint(ep.url) else "aws"
    try:
        connection = describe_connection(plan_connection(ep))
    except AwsEmulatorFilesError:
        # The stats probe reports this as an endpoint problem; health stays up.
        logger.debug("Can't describe the connection to %s", ep.url, exc_info=True)
        connection = None

    return {
        "status": "ok",
        "version": version,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "endpoint_url": ep.url,
        "region": ep.region or AWS_REGION,
        "services_count": len(enabled),
        "connection_type": connection_type,
        "writes_enabled": STACKPORT_ALLOW_WRITES,
        "learn_enabled": STACKPORT_LEARN,
        "connection": connection,
        "emulator": detect_emulator_quickly(ep),
    }


# Some APIs require extra parameters to call
_METHOD_KWARGS: dict[tuple[str, str], dict] = {
    ("cognito-idp", "list_user_pools"): {"MaxResults": 60},
    ("cognito-identity", "list_identity_pools"): {"MaxResults": 60},
    ("wafv2", "list_web_acls"): {"Scope": "REGIONAL"},
    # The account's own policies, which is what the IAM view lists: without a
    # scope, every AWS managed policy is counted too.
    ("iam", "list_policies"): {"Scope": "Local"},
}

# Responses that group their resources: (boto3 service, method) -> the key that
# holds the resources inside each group. describe_instances answers with
# reservations, each holding the instances launched together.
_GROUPED_ITEMS: dict[tuple[str, str], str] = {
    ("ec2", "describe_instances"): "Instances",
}

# List calls that only cover one parent per call, so they're made once for each
# parent another call lists: (boto3 service, method) -> (parent list method, its
# response key, the parent's field, the parameter that field is passed as).
# Each item keeps its parent under that parameter's name. Without EventBusName,
# list_rules only sees the default event bus.
_PER_PARENT: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("events", "list_rules"): ("list_event_buses", "EventBuses", "Name", "EventBusName"),
}


def ungroup(items: list, boto3_service: str, method_name: str) -> list:
    """The resources inside the groups a grouping response returns, or ``items`` unchanged."""
    group_key = _GROUPED_ITEMS.get((boto3_service, method_name))
    if group_key is None:
        return items
    return [item for group in items for item in group.get(group_key) or []]


def _response_items(resp: dict, boto3_service: str, method_name: str, response_key: str) -> list:
    items = resp.get(response_key) or []
    # cloudfront list_distributions returns {"DistributionList": {"Items": [...]}}
    if isinstance(items, dict):
        items = items.get("Items") or []
    return ungroup(items, boto3_service, method_name)


def list_items(client, boto3_service: str, method_name: str, response_key: str) -> list:
    """Every resource one SERVICE_REGISTRY entry lists. ``client`` is a ``boto3_service`` client."""
    kwargs = _METHOD_KWARGS.get((boto3_service, method_name), {})
    method = getattr(client, method_name)
    per_parent = _PER_PARENT.get((boto3_service, method_name))
    if per_parent is None:
        return _response_items(method(**kwargs), boto3_service, method_name, response_key)

    parent_method, parent_key, parent_field, parameter = per_parent
    items = []
    for parent in list_items(client, boto3_service, parent_method, parent_key):
        value = parent[parent_field]
        resp = method(**kwargs, **{parameter: value})
        for item in _response_items(resp, boto3_service, method_name, response_key):
            items.append({parameter: value, **item})
    return items


def _service_result(resources: dict[str, int], errors: dict[str, ClassifiedError]) -> dict:
    """Fold per-resource-type outcomes into one service status.

    - every list call worked: ``available``
    - some worked: ``available``, failed types count 0 and are listed in ``errors``
    - every call returned NotImplemented: ``unsupported`` (the endpoint lacks the service)
    - every call failed otherwise: ``unavailable``, with the most telling ``error``
    """
    if not errors:
        return {"status": "available", "resources": resources}
    if resources:
        return {
            "status": "available",
            "resources": {**resources, **{resource_type: 0 for resource_type in errors}},
            "errors": {resource_type: err.to_dict() for resource_type, err in errors.items()},
        }
    failures = list(errors.values())
    if all(err.kind is ErrorKind.NOT_IMPLEMENTED for err in failures):
        return {"status": "unsupported", "resources": {}, "error": failures[0].to_dict()}
    # Prefer an error about the connection, then anything that isn't NotImplemented.
    worst = next(
        (err for err in failures if err.kind in ENDPOINT_KINDS),
        next((err for err in failures if err.kind is not ErrorKind.NOT_IMPLEMENTED), failures[0]),
    )
    return {"status": "unavailable", "resources": {}, "error": worst.to_dict()}


def _probe_service(service: str, endpoint_url: str, region: str | None = None, **client_kwargs) -> tuple[str, dict]:
    """Probe a single service and return (service_name, result_dict).

    ``client_kwargs`` are the rest of ``EndpointInfo.client_kwargs()`` (auth and TLS).
    """
    registry_entries = SERVICE_REGISTRY.get(service)
    if not registry_entries:
        return service, {"status": "unavailable", "resources": {}}

    resources: dict[str, int] = {}
    errors: dict[str, ClassifiedError] = {}
    for index, (resource_type, boto3_service, method_name, response_key) in enumerate(registry_entries):
        try:
            client = get_client(boto3_service, endpoint_url=endpoint_url, region=region, **client_kwargs)
            resources[resource_type] = len(list_items(client, boto3_service, method_name, response_key))
        except Exception as exc:
            logger.debug("Failed to probe %s/%s", service, resource_type, exc_info=True)
            error = classify(exc) or ClassifiedError(ErrorKind.OTHER, shorten(str(exc)))
            errors[resource_type] = error
            if error.is_endpoint_problem:
                # The next call would fail the same way, after the same timeout.
                for remaining_type, *_ in registry_entries[index + 1:]:
                    errors[remaining_type] = error
                break
    return service, _service_result(resources, errors)


_ENDPOINT_KIND_VALUES = frozenset(kind.value for kind in ENDPOINT_KINDS)
_CONNECTION_KIND_VALUES = frozenset({ErrorKind.UNREACHABLE.value, ErrorKind.TLS.value})


def summarize_problem(services: dict[str, dict]) -> dict | None:
    """An endpoint-wide problem (credentials, TLS, unreachable) worth one banner, or None.

    Only when nothing worked: if any service answered, the connection itself is
    fine and the failures are per service.
    """
    if not services or any(result.get("status") == "available" for result in services.values()):
        return None
    endpoint_errors = [
        result["error"]
        for result in services.values()
        if result.get("status") == "unavailable"
        and isinstance(result.get("error"), dict)
        and result["error"].get("kind") in _ENDPOINT_KIND_VALUES
    ]
    if not endpoint_errors:
        return None
    counts = Counter((err["kind"], err.get("message")) for err in endpoint_errors)
    (kind, message), _ = counts.most_common(1)[0]
    return next(err for err in endpoint_errors if err["kind"] == kind and err.get("message") == message)


def _explain_aws_emulator_problem(ep: EndpointInfo, problem: dict | None) -> dict | None:
    """Point at the real fix when an AWS Emulator problem comes from its files.

    Without the folder, StackPort has neither the emulator's keys nor its
    certificate, which surfaces as "no credentials" or "untrusted certificate".
    Both have the same fix, so say that one instead of two partial ones. With
    the folder there but its certificate failing, a CA bundle won't help either.
    """
    if problem is None:
        return None
    relevant = problem.get("kind") == ErrorKind.CREDENTIALS.value or problem.get("message") == UNTRUSTED_CERTIFICATE_MESSAGE
    configured_by_hand = ep.auth_type != "default" or bool(ep.ca_bundle) or not ep.tls_verify
    if not relevant or configured_by_hand:
        return problem
    directory = aws_emulator.files_dir_for(ep.url)
    if directory is None:
        return problem
    if directory.exists():
        # The folder is there. If its own certificate is what failed, adding a
        # CA bundle won't help: the files and the running emulator are out of step.
        if problem.get("message") != UNTRUSTED_CERTIFICATE_MESSAGE:
            return problem
        try:
            trusted_from_folder = plan_connection(ep).trust_source == "aws-emulator"
        except AwsEmulatorFilesError:
            return problem
        if not trusted_from_folder:
            return problem
        return {
            **problem,
            "hint": (
                "The certificate didn't verify against the CA AWS Emulator wrote in "
                f"{aws_emulator.display_path(directory)}. Restart the emulator, then StackPort."
            ),
        }
    return {
        **problem,
        "hint": (
            f"If this endpoint is AWS Emulator: StackPort reads the keys and certificate it writes from "
            f"{aws_emulator.display_path(directory)}, and can't find that folder. Run StackPort where it can "
            "see it, share it as the Compose example does, or point STACKPORT_AWS_EMULATOR_DIR at it."
        ),
    }


def collect_stats(ep: EndpointInfo) -> dict:
    """Probe every enabled service of one endpoint concurrently. Blocking."""
    enabled_services = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]
    client_kwargs = ep.client_kwargs()
    endpoint_url = client_kwargs.pop("endpoint_url")
    region = client_kwargs.pop("region")

    services: dict[str, dict] = {}
    if enabled_services:
        workers = max(1, min(len(enabled_services), STACKPORT_PROBE_WORKERS))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(_probe_service, svc, endpoint_url, region, **client_kwargs): svc
                for svc in enabled_services
            }
            # An emulator serves every service from one host, so when it can't be
            # connected to (stopped, wrong port, untrusted certificate) every
            # probe would wait for the same failure: skip the ones not started.
            # Not on AWS, where each service has its own host (and a region can
            # lack a service), and not for credentials, which can be per service.
            one_host = is_local_endpoint(ep.url)
            for future in as_completed(futures):
                if future.cancelled():
                    continue
                svc_name, result = future.result()
                services[svc_name] = result
                error = result.get("error")
                if one_host and result["status"] == "unavailable" and error and error["kind"] in _CONNECTION_KIND_VALUES:
                    for pending, pending_svc in futures.items():
                        if pending.cancel():
                            services[pending_svc] = {"status": "unavailable", "resources": {}, "error": error}

    # Sort services alphabetically for stable dashboard ordering
    sorted_services = dict(sorted(services.items()))
    return {
        "services": sorted_services,
        "total_resources": sum(sum(result["resources"].values()) for result in sorted_services.values()),
        "uptime_seconds": round(time.time() - _start_time, 1),
        "problem": _explain_aws_emulator_problem(ep, summarize_problem(sorted_services)),
    }


@router.get("/stats")
def get_stats(ep: EndpointInfo = Depends(get_endpoint_info)):
    # The same URL can be saved twice with different auth or regions.
    cache_key = f"{ep.cache_scope()}:stats"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    response = collect_stats(ep)
    cache.set(cache_key, response)
    return response
