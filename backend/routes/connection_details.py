"""Connection details: how code on this machine connects to a database, cache, search domain, broker or queue.

``GET /api/connection-details/{service}/{type}/{id}`` describes the resource
through the endpoint and answers with its addresses (see
``backend.connection_details``) and commands to copy. Nothing is sent to the
addresses themselves.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend import connection_details as details
from backend.aws_client import get_client
from backend.config import is_local_endpoint
from backend.connection import plan_connection
from backend.emulators import detect_emulator
from backend.learn.cli_setup import cli_setup_for
from backend.routes.common import EndpointInfo, get_endpoint_info

router = APIRouter()

ClientFor = Callable[[str], Any]
Found = tuple[list[details.Connection], str | None]
Lookup = Callable[[ClientFor, str, details.Place, EndpointInfo], Found]


def _rds_instance(client_for: ClientFor, res_id: str, place: details.Place, _ep: EndpointInfo) -> Found:
    instances = client_for("rds").describe_db_instances(DBInstanceIdentifier=res_id)["DBInstances"]
    return details.rds_instance(instances[0], place)


def _rds_cluster(client_for: ClientFor, res_id: str, place: details.Place, _ep: EndpointInfo) -> Found:
    clusters = client_for("rds").describe_db_clusters(DBClusterIdentifier=res_id)["DBClusters"]
    return details.rds_cluster(clusters[0], place)


def _cache_cluster(client_for: ClientFor, res_id: str, place: details.Place, _ep: EndpointInfo) -> Found:
    # Without ShowCacheNodeInfo, nodes come back without their endpoints.
    clusters = client_for("elasticache").describe_cache_clusters(CacheClusterId=res_id, ShowCacheNodeInfo=True)
    return details.cache_cluster(clusters["CacheClusters"][0], place)


def _search_domain(client_for: ClientFor, res_id: str, place: details.Place, ep: EndpointInfo) -> Found:
    status = client_for("opensearch").describe_domain(DomainName=res_id)["DomainStatus"]
    return details.search_domain(status, place, ca_bundle_variable=cli_setup_for(ep) is not None)


def _kafka_cluster(client_for: ClientFor, res_id: str, place: details.Place, _ep: EndpointInfo) -> Found:
    return details.kafka_brokers(client_for("kafka").get_bootstrap_brokers(ClusterArn=res_id), place)


def _queue(client_for: ClientFor, res_id: str, place: details.Place, _ep: EndpointInfo) -> Found:
    return details.queue(client_for("sqs").get_queue_url(QueueName=res_id)["QueueUrl"], place)


# (service, resource type) as the registries name them -> how to look its connections up.
LOOKUPS: dict[tuple[str, str], Lookup] = {
    ("rds", "db_instances"): _rds_instance,
    ("rds", "db_clusters"): _rds_cluster,
    ("elasticache", "cache_clusters"): _cache_cluster,
    ("es", "domains"): _search_domain,
    ("kafka", "clusters"): _kafka_cluster,
    ("sqs", "queues"): _queue,
}

# Their snippets use the AWS CLI's settings (the AWS CLI itself, or AWS_CA_BUNDLE for curl).
_USES_CLI_SETUP = frozenset({"sqs", "es"})


def _place(ep: EndpointInfo) -> details.Place:
    # Only a saved endpoint is identified: a URL passed in the request could point anywhere.
    emulator = detect_emulator(ep) if ep.saved and is_local_endpoint(ep.url) else None
    return details.Place(
        endpoint_url=ep.url if is_local_endpoint(ep.url) else None,
        emulator=emulator,
        region=plan_connection(ep).region,
    )


@router.get("/{service}/{res_type}/{res_id:path}")
def get_connection_details(
    service: str, res_type: str, res_id: str, ep: EndpointInfo = Depends(get_endpoint_info)
) -> dict[str, Any]:
    lookup = LOOKUPS.get((service, res_type))
    if lookup is None:
        raise HTTPException(status_code=404, detail=f"StackPort has no connection details for {service} {res_type}.")
    place = _place(ep)
    connections, problem = lookup(lambda name: get_client(name, **ep.client_kwargs()), res_id, place, ep)
    notes = [note for note in (place.note(service, connections), details.private_network_note(connections, place)) if note]
    return {
        "connections": [connection.to_dict() for connection in connections],
        "problem": problem,
        "notes": notes,
        "cliSetup": cli_setup_for(ep) if service in _USES_CLI_SETUP else None,
    }
