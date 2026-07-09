from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info

router = APIRouter()


def _flatten_db_instances(response: dict) -> list[dict]:
    """Extract DBInstances from describe_db_instances response."""
    return response.get("DBInstances", [])


def _flatten_db_clusters(response: dict) -> list[dict]:
    """Extract DBClusters from describe_db_clusters response."""
    return response.get("DBClusters", [])


def _get_endpoint_address(instance: dict) -> str:
    """Get the endpoint address from an RDS instance."""
    endpoint = instance.get("Endpoint", {})
    if isinstance(endpoint, dict):
        return endpoint.get("Address", "")
    return ""


def _get_endpoint_port(instance: dict) -> int:
    """Get the endpoint port from an RDS instance."""
    endpoint = instance.get("Endpoint", {})
    if isinstance(endpoint, dict):
        return endpoint.get("Port", 0)
    return 0


def _get_reader_endpoint_address(cluster: dict) -> str:
    """Get the reader endpoint address from an RDS cluster."""
    endpoint = cluster.get("ReaderEndpoint", "")
    return endpoint if isinstance(endpoint, str) else ""


@router.get("/instances")
def list_db_instances(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all RDS DB instances with enriched metadata."""
    try:
        client = get_client("rds", **ep.client_kwargs())
        paginator = client.get_paginator("describe_db_instances")

        all_instances = []
        for page in paginator.paginate():
            instances = _flatten_db_instances(page)
            for instance in instances:
                endpoint_addr = _get_endpoint_address(instance)
                endpoint_port = _get_endpoint_port(instance)

                all_instances.append(
                    {
                        "dbInstanceIdentifier": instance["DBInstanceIdentifier"],
                        "dbInstanceClass": instance.get("DBInstanceClass", ""),
                        "engine": instance.get("Engine", ""),
                        "engineVersion": instance.get("EngineVersion", ""),
                        "status": instance.get("DBInstanceStatus", ""),
                        "masterUsername": instance.get("MasterUsername", ""),
                        "endpoint": endpoint_addr,
                        "port": endpoint_port,
                        "multiAz": instance.get("MultiAZ", False),
                        "availabilityZone": instance.get("AvailabilityZone", ""),
                        "storageType": instance.get("StorageType", ""),
                        "allocatedStorage": instance.get("AllocatedStorage", 0),
                        "storageEncrypted": instance.get("StorageEncrypted", False),
                        "publiclyAccessible": instance.get("PubliclyAccessible", False),
                        "vpcSecurityGroups": instance.get("VpcSecurityGroups", []),
                        "dbSubnetGroup": instance.get("DBSubnetGroup", {}),
                        "parameterGroup": instance.get("DBParameterGroups", [{}])[0] if instance.get("DBParameterGroups") else {},
                        "tags": instance.get("TagList", []),
                        "createdTime": instance.get("InstanceCreateTime"),
                        "readReplicaSourceIdentifier": instance.get("ReadReplicaSourceDBInstanceIdentifier"),
                        "readReplicaIdentifiers": instance.get("ReadReplicaDBInstanceIdentifiers", []),
                    }
                )

        return {"instances": all_instances}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/instances/{instance_id}")
def get_db_instance_detail(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get detailed information for a specific DB instance."""
    try:
        client = get_client("rds", **ep.client_kwargs())

        response = client.describe_db_instances(DBInstanceIdentifier=instance_id)
        instances = _flatten_db_instances(response)

        if not instances:
            raise HTTPException(status_code=404, detail=f"DB Instance {instance_id} not found")

        instance = instances[0]
        endpoint_addr = _get_endpoint_address(instance)
        endpoint_port = _get_endpoint_port(instance)

        # Get tags separately
        try:
            tags_response = client.list_tags_for_resource(ResourceName=instance.get("DbiResourceId", ""))
            tags = tags_response.get("TagList", [])
        except Exception:
            tags = instance.get("TagList", [])

        return {
            "instance": {
                "dbInstanceIdentifier": instance["DBInstanceIdentifier"],
                "dbInstanceClass": instance.get("DBInstanceClass", ""),
                "engine": instance.get("Engine", ""),
                "engineVersion": instance.get("EngineVersion", ""),
                "status": instance.get("DBInstanceStatus", ""),
                "masterUsername": instance.get("MasterUsername", ""),
                "endpoint": endpoint_addr,
                "port": endpoint_port,
                "multiAz": instance.get("MultiAZ", False),
                "availabilityZone": instance.get("AvailabilityZone", ""),
                "storageType": instance.get("StorageType", ""),
                "allocatedStorage": instance.get("AllocatedStorage", 0),
                "iops": instance.get("Iops"),
                "storageEncrypted": instance.get("StorageEncrypted", False),
                "kmsKeyId": instance.get("KmsKeyId"),
                "publiclyAccessible": instance.get("PubliclyAccessible", False),
                "vpcSecurityGroups": instance.get("VpcSecurityGroups", []),
                "dbSubnetGroup": instance.get("DBSubnetGroup", {}),
                "dbParameterGroups": instance.get("DBParameterGroups", []),
                "optionGroupMemberships": instance.get("OptionGroupMemberships", []),
                "tags": tags,
                "createdTime": instance.get("InstanceCreateTime"),
                "backupRetentionPeriod": instance.get("BackupRetentionPeriod", 0),
                "preferredBackupWindow": instance.get("PreferredBackupWindow", ""),
                "preferredMaintenanceWindow": instance.get("PreferredMaintenanceWindow", ""),
                "readReplicaSourceIdentifier": instance.get("ReadReplicaSourceDBInstanceIdentifier"),
                "readReplicaIdentifiers": instance.get("ReadReplicaDBInstanceIdentifiers", []),
                "certificateDetails": instance.get("CertificateDetails", {}),
                "pendingModifiedValues": instance.get("PendingModifiedValues", {}),
                "latestRestorableTime": instance.get("LatestRestorableTime"),
                "earliestRestorableTime": instance.get("EarliestRestorableTime"),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "DBInstanceNotFound" in error_msg:
            raise HTTPException(status_code=404, detail=f"DB Instance {instance_id} not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clusters")
def list_db_clusters(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all RDS DB clusters with enriched metadata."""
    try:
        client = get_client("rds", **ep.client_kwargs())
        paginator = client.get_paginator("describe_db_clusters")

        all_clusters = []
        for page in paginator.paginate():
            clusters = _flatten_db_clusters(page)
            for cluster in clusters:
                all_clusters.append(
                    {
                        "dbClusterIdentifier": cluster["DBClusterIdentifier"],
                        "engine": cluster.get("Engine", ""),
                        "engineVersion": cluster.get("EngineVersion", ""),
                        "status": cluster.get("Status", ""),
                        "masterUsername": cluster.get("MasterUsername", ""),
                        "endpoint": cluster.get("Endpoint", ""),
                        "readerEndpoint": cluster.get("ReaderEndpoint", ""),
                        "port": cluster.get("Port", 0),
                        "multiAz": cluster.get("MultiAZ", False),
                        "storageType": cluster.get("StorageType", ""),
                        "allocatedStorage": cluster.get("AllocatedStorage", 0),
                        "storageEncrypted": cluster.get("StorageEncrypted", False),
                        "vpcSecurityGroups": cluster.get("VpcSecurityGroups", []),
                        "dbSubnetGroup": cluster.get("DBSubnetGroup", ""),
                        "parameterGroup": cluster.get("DBClusterParameterGroup", ""),
                        "tags": cluster.get("TagList", []),
                        "createdTime": cluster.get("ClusterCreateTime"),
                        "earliestRestorableTime": cluster.get("EarliestRestorableTime"),
                        "latestRestorableTime": cluster.get("LatestRestorableTime"),
                        "backupRetentionPeriod": cluster.get("BackupRetentionPeriod", 0),
                        "preferredBackupWindow": cluster.get("PreferredBackupWindow", ""),
                        "preferredMaintenanceWindow": cluster.get("PreferredMaintenanceWindow", ""),
                        "readReplicaIdentifiers": cluster.get("ReadReplicaDBClusterIdentifiers", []),
                        "dbClusterMembers": cluster.get("DBClusterMembers", []),
                        "serverlessV2ScalingConfiguration": cluster.get("ServerlessV2ScalingConfiguration", {}),
                    }
                )

        return {"clusters": all_clusters}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clusters/{cluster_id}")
def get_db_cluster_detail(cluster_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get detailed information for a specific DB cluster."""
    try:
        client = get_client("rds", **ep.client_kwargs())

        response = client.describe_db_clusters(DBClusterIdentifier=cluster_id)
        clusters = _flatten_db_clusters(response)

        if not clusters:
            raise HTTPException(status_code=404, detail=f"DB Cluster {cluster_id} not found")

        cluster = clusters[0]

        # Get tags separately
        try:
            tags_response = client.list_tags_for_resource(ResourceName=cluster.get("DbClusterResourceId", ""))
            tags = tags_response.get("TagList", [])
        except Exception:
            tags = cluster.get("TagList", [])

        return {
            "cluster": {
                "dbClusterIdentifier": cluster["DBClusterIdentifier"],
                "engine": cluster.get("Engine", ""),
                "engineVersion": cluster.get("EngineVersion", ""),
                "status": cluster.get("Status", ""),
                "masterUsername": cluster.get("MasterUsername", ""),
                "endpoint": cluster.get("Endpoint", ""),
                "readerEndpoint": cluster.get("ReaderEndpoint", ""),
                "port": cluster.get("Port", 0),
                "multiAz": cluster.get("MultiAZ", False),
                "storageType": cluster.get("StorageType", ""),
                "allocatedStorage": cluster.get("AllocatedStorage", 0),
                "storageEncrypted": cluster.get("StorageEncrypted", False),
                "kmsKeyId": cluster.get("KmsKeyId"),
                "vpcSecurityGroups": cluster.get("VpcSecurityGroups", []),
                "dbSubnetGroup": cluster.get("DBSubnetGroup", ""),
                "dbClusterParameterGroup": cluster.get("DBClusterParameterGroup", ""),
                "optionGroupMemberships": cluster.get("OptionGroupMemberships", []),
                "tags": tags,
                "createdTime": cluster.get("ClusterCreateTime"),
                "earliestRestorableTime": cluster.get("EarliestRestorableTime"),
                "latestRestorableTime": cluster.get("LatestRestorableTime"),
                "backupRetentionPeriod": cluster.get("BackupRetentionPeriod", 0),
                "preferredBackupWindow": cluster.get("PreferredBackupWindow", ""),
                "preferredMaintenanceWindow": cluster.get("PreferredMaintenanceWindow", ""),
                "readReplicaIdentifiers": cluster.get("ReadReplicaDBClusterIdentifiers", []),
                "dbClusterMembers": cluster.get("DBClusterMembers", []),
                "serverlessV2ScalingConfiguration": cluster.get("ServerlessV2ScalingConfiguration", {}),
                "scalingConfigurationInfo": cluster.get("ScalingConfigurationInfo", {}),
                "pendingModifiedValues": cluster.get("PendingModifiedValues", {}),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "DBClusterNotFound" in error_msg:
            raise HTTPException(status_code=404, detail=f"DB Cluster {cluster_id} not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshots")
def list_db_snapshots(
    instance_id: str | None = Query(None, description="Filter by DB instance identifier"),
    cluster_id: str | None = Query(None, description="Filter by DB cluster identifier"),
    snapshot_type: str | None = Query(None, description="Filter by snapshot type (automated/manual)"),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """List RDS DB snapshots with optional filters."""
    try:
        client = get_client("rds", **ep.client_kwargs())

        snapshots = []

        if instance_id:
            # Get snapshots for a specific instance
            paginator = client.get_paginator("describe_db_snapshots")
            for page in paginator.paginate(DBInstanceIdentifier=instance_id):
                snapshots.extend(page.get("DBSnapshots", []))
        elif cluster_id:
            # Get cluster snapshots
            paginator = client.get_paginator("describe_db_cluster_snapshots")
            for page in paginator.paginate(DBClusterIdentifier=cluster_id):
                snapshots.extend(page.get("DBClusterSnapshots", []))
        elif snapshot_type:
            # Get snapshots by type
            paginator = client.get_paginator("describe_db_snapshots")
            for page in paginator.paginate(SnapshotType=snapshot_type):
                snapshots.extend(page.get("DBSnapshots", []))
        else:
            # Get all snapshots (instance snapshots)
            paginator = client.get_paginator("describe_db_snapshots")
            for page in paginator.paginate():
                snapshots.extend(page.get("DBSnapshots", []))

        result = []
        for snapshot in snapshots:
            # Handle both DBSnapshot and DBClusterSnapshot
            is_cluster = "DBClusterSnapshotIdentifier" in snapshot
            result.append(
                {
                    "snapshotIdentifier": snapshot.get("DBSnapshotIdentifier" if not is_cluster else "DBClusterSnapshotIdentifier", ""),
                    "snapshotType": snapshot.get("SnapshotType", ""),
                    "status": snapshot.get("Status", ""),
                    "sourceType": "cluster" if is_cluster else "instance",
                    "sourceIdentifier": snapshot.get("DBInstanceIdentifier" if not is_cluster else "DBClusterIdentifier", ""),
                    "engine": snapshot.get("Engine", ""),
                    "engineVersion": snapshot.get("EngineVersion", ""),
                    "allocatedStorage": snapshot.get("AllocatedStorage", 0),
                    "snapshotCreateTime": snapshot.get("SnapshotCreateTime"),
                    "snapshotSize": snapshot.get("SnapshotSize", 0),
                    "encrypted": snapshot.get("Encrypted", False),
                    "kmsKeyId": snapshot.get("KmsKeyId"),
                    "tags": snapshot.get("TagList", []),
                }
            )

        return {"snapshots": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/parameter-groups")
def list_db_parameter_groups(
    source: str = Query("all", description="Source type: all, instance, or cluster"),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """List RDS DB parameter groups."""
    try:
        client = get_client("rds", **ep.client_kwargs())

        parameter_groups = []

        if source in ("all", "instance"):
            # Get instance parameter groups
            paginator = client.get_paginator("describe_db_parameter_groups")
            for page in paginator.paginate():
                for group in page.get("DBParameterGroups", []):
                    parameter_groups.append(
                        {
                            "name": group.get("DBParameterGroupName", ""),
                            "family": group.get("DBParameterGroupFamily", ""),
                            "description": group.get("Description", ""),
                            "source": "instance",
                            "tags": group.get("TagList", []),
                        }
                    )

        if source in ("all", "cluster"):
            # Get cluster parameter groups
            paginator = client.get_paginator("describe_db_cluster_parameter_groups")
            for page in paginator.paginate():
                for group in page.get("DBClusterParameterGroups", []):
                    parameter_groups.append(
                        {
                            "name": group.get("DBClusterParameterGroupName", ""),
                            "family": group.get("DBClusterParameterGroupFamily", ""),
                            "description": group.get("Description", ""),
                            "source": "cluster",
                            "tags": group.get("TagList", []),
                        }
                    )

        return {"parameterGroups": parameter_groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/parameter-groups/{group_name}")
def get_db_parameter_group_detail(
    group_name: str,
    source: str = Query("instance", description="Source type: instance or cluster"),
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Get detailed information for a specific parameter group including parameters."""
    try:
        client = get_client("rds", **ep.client_kwargs())

        if source == "cluster":
            # Get cluster parameter group details
            response = client.describe_db_cluster_parameters(DBClusterParameterGroupName=group_name)
            parameters = response.get("Parameters", [])

            # Get group info
            groups_response = client.describe_db_cluster_parameter_groups(DBClusterParameterGroupName=group_name)
            groups = groups_response.get("DBClusterParameterGroups", [])
            group_info = groups[0] if groups else {}

            return {
                "parameterGroup": {
                    "name": group_info.get("DBClusterParameterGroupName", group_name),
                    "family": group_info.get("DBClusterParameterGroupFamily", ""),
                    "description": group_info.get("Description", ""),
                    "source": "cluster",
                    "parameters": [
                        {
                            "name": p.get("ParameterName", ""),
                            "value": p.get("ParameterValue", ""),
                            "description": p.get("Description", ""),
                            "dataType": p.get("DataType", ""),
                            "allowedValues": p.get("AllowedValues", ""),
                            "isModifiable": p.get("IsModifiable", False),
                            "applyMethod": p.get("ApplyMethod", "immediate"),
                        }
                        for p in parameters
                    ],
                }
            }
        else:
            # Get instance parameter group details
            response = client.describe_db_parameters(DBParameterGroupName=group_name)
            parameters = response.get("Parameters", [])

            # Get group info
            groups_response = client.describe_db_parameter_groups(DBParameterGroupName=group_name)
            groups = groups_response.get("DBParameterGroups", [])
            group_info = groups[0] if groups else {}

            return {
                "parameterGroup": {
                    "name": group_info.get("DBParameterGroupName", group_name),
                    "family": group_info.get("DBParameterGroupFamily", ""),
                    "description": group_info.get("Description", ""),
                    "source": "instance",
                    "parameters": [
                        {
                            "name": p.get("ParameterName", ""),
                            "value": p.get("ParameterValue", ""),
                            "description": p.get("Description", ""),
                            "dataType": p.get("DataType", ""),
                            "allowedValues": p.get("AllowedValues", ""),
                            "isModifiable": p.get("IsModifiable", False),
                            "applyMethod": p.get("ApplyMethod", "immediate"),
                        }
                        for p in parameters
                    ],
                }
            }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "DBParameterGroupNotFound" in error_msg or "DBClusterParameterGroupNotFound" in error_msg:
            raise HTTPException(status_code=404, detail=f"Parameter Group {group_name} not found")
        raise HTTPException(status_code=500, detail=str(e))
