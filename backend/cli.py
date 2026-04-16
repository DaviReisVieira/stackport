"""CLI commands for StackPort."""

import csv
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import click
import uvicorn

from backend.aws_client import get_client
from backend.config import AWS_ENDPOINT_URL, AWS_REGION, LOG_LEVEL, STACKPORT_PORT, STACKPORT_SERVICES
from backend.routes.resources import DESCRIBE_REGISTRY, _extract_id, _serialize
from backend.routes.stats import SERVICE_REGISTRY, _METHOD_KWARGS, _count_items, _probe_service

logger = logging.getLogger(__name__)


@click.group(invoke_without_command=True)
@click.version_option(package_name="stackport")
@click.pass_context
def cli(ctx):
    """StackPort - Universal AWS resource browser for local emulators."""
    if ctx.invoked_subcommand is None:
        ctx.invoke(serve)


@cli.command()
@click.option("--port", default=STACKPORT_PORT, help="HTTP port")
def serve(port):
    """Start the StackPort web server (default command)."""
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, log_level=LOG_LEVEL.lower(), reload=False)


@cli.command()
@click.option("--endpoint", default=AWS_ENDPOINT_URL, help="AWS endpoint URL", envvar="AWS_ENDPOINT_URL")
@click.option("--region", default=AWS_REGION, help="AWS region", envvar="AWS_REGION")
@click.option("--output", type=click.Choice(["json", "table"]), default="table", help="Output format")
def status(endpoint, region, output):
    """Show all services with availability and resource counts."""
    # Override endpoint/region if provided
    if endpoint != AWS_ENDPOINT_URL:
        import os

        os.environ["AWS_ENDPOINT_URL"] = endpoint
    if region != AWS_REGION:
        import os

        os.environ["AWS_REGION"] = region

    enabled_services = [s.strip() for s in STACKPORT_SERVICES.split(",") if s.strip()]
    services = {}

    try:
        with ThreadPoolExecutor(max_workers=min(len(enabled_services), 10)) as executor:
            futures = {executor.submit(_probe_service, svc): svc for svc in enabled_services}
            for future in as_completed(futures):
                svc_name, result = future.result()
                services[svc_name] = result
    except Exception as exc:
        click.echo(f"Error probing services: {exc}", err=True)
        sys.exit(2)

    sorted_services = dict(sorted(services.items()))

    if output == "json":
        click.echo(json.dumps(sorted_services, indent=2))
    else:
        # Table format
        click.echo(f"{'SERVICE':<25} {'STATUS':<12} {'RESOURCES'}")
        click.echo("-" * 60)
        for svc_name, result in sorted_services.items():
            status_str = result["status"]
            resources = result.get("resources", {})
            total = sum(resources.values())
            resource_summary = ", ".join(f"{rt}={c}" for rt, c in resources.items() if c > 0) if resources else "-"
            if len(resource_summary) > 30:
                resource_summary = f"{total} total"
            click.echo(f"{svc_name:<25} {status_str:<12} {resource_summary}")

    sys.exit(0)


@cli.command()
@click.argument("service")
@click.option("--endpoint", default=AWS_ENDPOINT_URL, help="AWS endpoint URL", envvar="AWS_ENDPOINT_URL")
@click.option("--region", default=AWS_REGION, help="AWS region", envvar="AWS_REGION")
@click.option("--output", type=click.Choice(["json", "table", "csv"]), default="table", help="Output format")
def list(service, endpoint, region, output):
    """List resources for a service."""
    # Override endpoint/region if provided
    if endpoint != AWS_ENDPOINT_URL:
        import os

        os.environ["AWS_ENDPOINT_URL"] = endpoint
    if region != AWS_REGION:
        import os

        os.environ["AWS_REGION"] = region

    registry_entries = SERVICE_REGISTRY.get(service)
    if not registry_entries:
        valid_services = ", ".join(sorted(SERVICE_REGISTRY.keys()))
        click.echo(f"Error: Unknown service '{service}'.", err=True)
        click.echo(f"Valid services: {valid_services}", err=True)
        sys.exit(1)

    resources = {}
    for resource_type, boto3_service, method_name, response_key in registry_entries:
        try:
            client = get_client(boto3_service)
            method = getattr(client, method_name)
            kwargs = _METHOD_KWARGS.get((boto3_service, method_name), {})
            resp = method(**kwargs)
            items = resp.get(response_key, [])
            # Handle nested structures (e.g., cloudfront DistributionList.Items)
            if isinstance(items, dict) and "Items" in items:
                items = items.get("Items", []) or []
            resources[resource_type] = items
        except Exception as exc:
            logger.debug("Failed to list %s/%s: %s", service, resource_type, exc, exc_info=True)
            resources[resource_type] = []

    if output == "json":
        serialized = {rt: [_serialize(item) if isinstance(item, dict) else item for item in items] for rt, items in resources.items()}
        click.echo(json.dumps({"service": service, "resources": serialized}, indent=2))
    elif output == "csv":
        writer = csv.writer(sys.stdout)
        writer.writerow(["service", "resource_type", "resource_id", "name"])
        for resource_type, items in resources.items():
            for item in items:
                resource_id = _extract_id(item)
                name = item.get("Name", item.get("FunctionName", item.get("TableName", resource_id))) if isinstance(item, dict) else resource_id
                writer.writerow([service, resource_type, resource_id, name])
    else:
        # Table format
        for resource_type, items in resources.items():
            if items:
                click.echo(f"\n{resource_type.upper()} ({len(items)}):")
                click.echo("-" * 60)
                for item in items[:20]:  # Limit to first 20 for readability
                    resource_id = _extract_id(item)
                    if isinstance(item, dict):
                        name = item.get("Name", item.get("FunctionName", item.get("TableName", "")))
                        if name and name != resource_id:
                            click.echo(f"  {resource_id} ({name})")
                        else:
                            click.echo(f"  {resource_id}")
                    else:
                        click.echo(f"  {item}")
                if len(items) > 20:
                    click.echo(f"  ... and {len(items) - 20} more")

    sys.exit(0)


@cli.command()
@click.argument("service")
@click.argument("resource_type")
@click.argument("resource_id")
@click.option("--endpoint", default=AWS_ENDPOINT_URL, help="AWS endpoint URL", envvar="AWS_ENDPOINT_URL")
@click.option("--region", default=AWS_REGION, help="AWS region", envvar="AWS_REGION")
@click.option("--output", type=click.Choice(["json", "table"]), default="json", help="Output format")
def describe(service, resource_type, resource_id, endpoint, region, output):
    """Describe a specific resource."""
    # Override endpoint/region if provided
    if endpoint != AWS_ENDPOINT_URL:
        import os

        os.environ["AWS_ENDPOINT_URL"] = endpoint
    if region != AWS_REGION:
        import os

        os.environ["AWS_REGION"] = region

    # Special case for WAFv2
    if (service, resource_type) == ("wafv2", "web_acls"):
        try:
            client = get_client("wafv2")
            acls = client.list_web_acls(Scope="REGIONAL").get("WebACLs", [])
            match = next((a for a in acls if a.get("Name") == resource_id), None)
            if not match:
                click.echo(f"Error: Web ACL '{resource_id}' not found", err=True)
                sys.exit(1)
            resp = client.get_web_acl(Name=resource_id, Scope="REGIONAL", Id=match["Id"])
            resp.pop("ResponseMetadata", None)
            detail = _serialize(resp.get("WebACL", resp))
        except Exception as exc:
            click.echo(f"Error describing {service}/{resource_type}/{resource_id}: {exc}", err=True)
            sys.exit(1)
    else:
        lookup = DESCRIBE_REGISTRY.get((service, resource_type))
        if not lookup:
            click.echo(f"Error: No detail lookup registered for {service}/{resource_type}", err=True)
            sys.exit(1)

        boto3_service, method_name, id_param, response_key = lookup

        # Some APIs take list parameters
        _LIST_PARAMS = {
            "InstanceIds",
            "VpcIds",
            "SubnetIds",
            "GroupIds",
            "VolumeIds",
            "repositoryNames",
            "clusters",
            "AlarmNames",
            "LoadBalancerArns",
        }

        try:
            client = get_client(boto3_service)
            method = getattr(client, method_name)
            if id_param in _LIST_PARAMS:
                resp = method(**{id_param: [resource_id]})
            else:
                resp = method(**{id_param: resource_id})

            resp.pop("ResponseMetadata", None)

            if response_key is not None:
                detail = resp.get(response_key, resp)
            else:
                detail = resp

            detail = _serialize(detail)
        except Exception as exc:
            click.echo(f"Error describing {service}/{resource_type}/{resource_id}: {exc}", err=True)
            sys.exit(1)

    if output == "json":
        click.echo(json.dumps(detail, indent=2))
    else:
        # Table format - simple key-value pairs
        if isinstance(detail, dict):
            for key, value in detail.items():
                click.echo(f"{key}: {value}")
        elif isinstance(detail, list) and len(detail) > 0:
            # If detail is a list, show first item
            for key, value in detail[0].items():
                click.echo(f"{key}: {value}")
        else:
            click.echo(json.dumps(detail, indent=2))

    sys.exit(0)


@cli.command()
@click.argument("service")
@click.option("--endpoint", default=AWS_ENDPOINT_URL, help="AWS endpoint URL", envvar="AWS_ENDPOINT_URL")
@click.option("--region", default=AWS_REGION, help="AWS region", envvar="AWS_REGION")
@click.option("--format", "format_", type=click.Choice(["json", "csv"]), default="json", help="Output format")
@click.pass_context
def export(ctx, service, endpoint, region, format_):
    """Export all resources for a service."""
    # Reuse list command logic
    ctx.invoke(list, service=service, endpoint=endpoint, region=region, output=format_)
