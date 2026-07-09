"""Tests for RDS routes."""

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


@pytest.fixture
def mock_rds_client(mocker):
    """Mock RDS client for testing."""
    mock_client = mocker.Mock()

    # Mock describe_db_instances
    mock_client.describe_db_instances.return_value = {
        "DBInstances": [
            {
                "DBInstanceIdentifier": "test-db-instance-1",
                "DBInstanceClass": "db.t3.micro",
                "Engine": "mysql",
                "EngineVersion": "8.0.32",
                "DBInstanceStatus": "available",
                "MasterUsername": "admin",
                "Endpoint": {
                    "Address": "test-db-instance-1.cxyz123.us-east-1.rds.amazonaws.com",
                    "Port": 3306,
                },
                "MultiAZ": True,
                "AvailabilityZone": "us-east-1a",
                "StorageType": "gp3",
                "AllocatedStorage": 100,
                "StorageEncrypted": True,
                "PubliclyAccessible": False,
                "VpcSecurityGroups": [
                    {"VpcSecurityGroupId": "sg-12345678", "Status": "active"}
                ],
                "DBSubnetGroup": {
                    "DBSubnetGroupName": "default-vpc-123",
                    "VpcId": "vpc-12345678",
                },
                "DBParameterGroups": [
                    {"DBParameterGroupName": "default.mysql8.0", "ParameterApplyStatus": "in-sync"}
                ],
                "TagList": [
                    {"Key": "Environment", "Value": "test"},
                    {"Key": "Team", "Value": "backend"},
                ],
                "InstanceCreateTime": "2024-01-15T10:00:00Z",
                "BackupRetentionPeriod": 7,
                "PreferredBackupWindow": "03:00-04:00",
                "PreferredMaintenanceWindow": "sun:04:00-sun:05:00",
                "LatestRestorableTime": "2024-01-20T10:00:00Z",
                "EarliestRestorableTime": "2024-01-15T11:00:00Z",
            },
            {
                "DBInstanceIdentifier": "test-db-instance-2",
                "DBInstanceClass": "db.t3.small",
                "Engine": "postgres",
                "EngineVersion": "15.4",
                "DBInstanceStatus": "available",
                "MasterUsername": "postgres",
                "Endpoint": {
                    "Address": "test-db-instance-2.cxyz456.us-east-1.rds.amazonaws.com",
                    "Port": 5432,
                },
                "MultiAZ": False,
                "AvailabilityZone": "us-east-1b",
                "StorageType": "gp2",
                "AllocatedStorage": 50,
                "StorageEncrypted": False,
                "PubliclyAccessible": False,
                "VpcSecurityGroups": [],
                "DBSubnetGroup": {},
                "DBParameterGroups": [],
                "TagList": [],
                "InstanceCreateTime": "2024-02-01T08:00:00Z",
                "BackupRetentionPeriod": 14,
                "PreferredBackupWindow": "02:00-03:00",
                "PreferredMaintenanceWindow": "mon:03:00-mon:04:00",
                "LatestRestorableTime": "2024-02-10T08:00:00Z",
                "EarliestRestorableTime": "2024-02-01T09:00:00Z",
            },
        ]
    }

    # Mock describe_db_clusters
    mock_client.describe_db_clusters.return_value = {
        "DBClusters": [
            {
                "DBClusterIdentifier": "test-cluster-1",
                "Engine": "aurora-mysql",
                "EngineVersion": "8.0.mysql_aurora.3.04.0",
                "Status": "available",
                "MasterUsername": "clusteradmin",
                "Endpoint": "test-cluster-1.cluster-cxyz.us-east-1.rds.amazonaws.com",
                "ReaderEndpoint": "test-cluster-1.reader-cxyz.us-east-1.rds.amazonaws.com",
                "Port": 3306,
                "MultiAZ": True,
                "StorageType": "aurora",
                "AllocatedStorage": 100,
                "StorageEncrypted": True,
                "VpcSecurityGroups": [
                    {"VpcSecurityGroupId": "sg-cluster-123", "Status": "active"}
                ],
                "DBSubnetGroup": "default-vpc-123",
                "DBClusterParameterGroup": "default.aurora-mysql8.0",
                "TagList": [
                    {"Key": "Environment", "Value": "prod"},
                ],
                "ClusterCreateTime": "2024-01-10T12:00:00Z",
                "EarliestRestorableTime": "2024-01-10T13:00:00Z",
                "LatestRestorableTime": "2024-01-20T12:00:00Z",
                "BackupRetentionPeriod": 14,
                "PreferredBackupWindow": "04:00-05:00",
                "PreferredMaintenanceWindow": "sun:05:00-sun:06:00",
                "ReadReplicaDBClusterIdentifiers": [],
                "DBClusterMembers": [
                    {
                        "DBInstanceIdentifier": "test-cluster-1-instance-1",
                        "IsClusterWriter": True,
                        "DBClusterParameterGroupStatus": "in-sync",
                        "PromotionTier": 1,
                    },
                    {
                        "DBInstanceIdentifier": "test-cluster-1-instance-2",
                        "IsClusterWriter": False,
                        "DBClusterParameterGroupStatus": "in-sync",
                        "PromotionTier": 2,
                    },
                ],
            }
        ]
    }

    # Mock describe_db_snapshots
    mock_client.describe_db_snapshots.return_value = {
        "DBSnapshots": [
            {
                "DBSnapshotIdentifier": "test-snapshot-1",
                "DBInstanceIdentifier": "test-db-instance-1",
                "SnapshotType": "automated",
                "Status": "available",
                "Engine": "mysql",
                "EngineVersion": "8.0.32",
                "AllocatedStorage": 100,
                "SnapshotCreateTime": "2024-01-19T03:00:00Z",
                "SnapshotSize": 52428800,
                "Encrypted": True,
                "TagList": [],
            }
        ]
    }

    # Mock describe_db_cluster_snapshots
    mock_client.describe_db_cluster_snapshots.return_value = {
        "DBClusterSnapshots": [
            {
                "DBClusterSnapshotIdentifier": "test-cluster-snapshot-1",
                "DBClusterIdentifier": "test-cluster-1",
                "SnapshotType": "manual",
                "Status": "available",
                "Engine": "aurora-mysql",
                "EngineVersion": "8.0.mysql_aurora.3.04.0",
                "AllocatedStorage": 100,
                "SnapshotCreateTime": "2024-01-18T04:00:00Z",
                "SnapshotSize": 104857600,
                "Encrypted": True,
                "TagList": [],
            }
        ]
    }

    # Mock describe_db_parameter_groups
    mock_client.describe_db_parameter_groups.return_value = {
        "DBParameterGroups": [
            {
                "DBParameterGroupName": "default.mysql8.0",
                "DBParameterGroupFamily": "mysql8.0",
                "Description": "Default MySQL 8.0 parameter group",
                "TagList": [],
            },
            {
                "DBParameterGroupName": "custom-mysql-params",
                "DBParameterGroupFamily": "mysql8.0",
                "Description": "Custom MySQL parameters for production",
                "TagList": [{"Key": "Environment", "Value": "prod"}],
            },
        ]
    }

    # Mock describe_db_cluster_parameter_groups
    mock_client.describe_db_cluster_parameter_groups.return_value = {
        "DBClusterParameterGroups": [
            {
                "DBClusterParameterGroupName": "default.aurora-mysql8.0",
                "DBClusterParameterGroupFamily": "aurora-mysql8.0",
                "Description": "Default Aurora MySQL 8.0 parameter group",
                "TagList": [],
            },
        ]
    }

    # Mock describe_db_parameters
    mock_client.describe_db_parameters.return_value = {
        "Parameters": [
            {
                "ParameterName": "max_connections",
                "ParameterValue": "1000",
                "Description": "Maximum number of connections",
                "DataType": "integer",
                "AllowedValues": "1-10000",
                "IsModifiable": True,
                "ApplyMethod": "pending-reboot",
            },
            {
                "ParameterName": "innodb_buffer_pool_size",
                "ParameterValue": "134217728",
                "Description": "InnoDB buffer pool size",
                "DataType": "long",
                "AllowedValues": "1048576-4294967296",
                "IsModifiable": True,
                "ApplyMethod": "dynamic",
            },
        ]
    }

    # Mock describe_db_cluster_parameters
    mock_client.describe_db_cluster_parameters.return_value = {
        "Parameters": [
            {
                "ParameterName": "aurora_parallel_query",
                "ParameterValue": "ON",
                "Description": "Enable Aurora parallel query",
                "DataType": "string",
                "AllowedValues": "ON,OFF",
                "IsModifiable": True,
                "ApplyMethod": "pending-reboot",
            },
        ]
    }

    # Mock list_tags_for_resource
    mock_client.list_tags_for_resource.return_value = {"TagList": []}

    # Patch get_client to return our mock
    mocker.patch("backend.routes.rds.get_client", return_value=mock_client)

    return mock_client


class TestListDBInstances:
    """Tests for GET /api/rds/instances endpoint."""

    def test_list_instances_success(self, mock_rds_client):
        """Test listing DB instances returns correct data."""
        response = client.get("/api/rds/instances")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "instances" in data
        assert len(data["instances"]) == 2

        instance = data["instances"][0]
        assert instance["dbInstanceIdentifier"] == "test-db-instance-1"
        assert instance["engine"] == "mysql"
        assert instance["engineVersion"] == "8.0.32"
        assert instance["status"] == "available"
        assert instance["endpoint"] == "test-db-instance-1.cxyz123.us-east-1.rds.amazonaws.com"
        assert instance["port"] == 3306
        assert instance["multiAz"] is True
        assert instance["dbInstanceClass"] == "db.t3.micro"

    def test_list_instances_empty(self, mock_rds_client):
        """Test listing DB instances when none exist."""
        mock_rds_client.describe_db_instances.return_value = {"DBInstances": []}

        response = client.get("/api/rds/instances")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["instances"] == []


class TestGetDBInstanceDetail:
    """Tests for GET /api/rds/instances/{id} endpoint."""

    def test_get_instance_detail_success(self, mock_rds_client):
        """Test getting DB instance detail returns correct data."""
        response = client.get("/api/rds/instances/test-db-instance-1")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "instance" in data
        instance = data["instance"]
        assert instance["dbInstanceIdentifier"] == "test-db-instance-1"
        assert instance["endpoint"] == "test-db-instance-1.cxyz123.us-east-1.rds.amazonaws.com"
        assert instance["port"] == 3306
        assert instance["backupRetentionPeriod"] == 7
        assert len(instance["dbParameterGroups"]) == 1

    def test_get_instance_detail_not_found(self, mock_rds_client):
        """Test getting non-existent DB instance returns 404."""
        mock_rds_client.describe_db_instances.side_effect = Exception("DBInstanceNotFound")

        response = client.get("/api/rds/instances/non-existent")

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestListDBClusters:
    """Tests for GET /api/rds/clusters endpoint."""

    def test_list_clusters_success(self, mock_rds_client):
        """Test listing DB clusters returns correct data."""
        response = client.get("/api/rds/clusters")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "clusters" in data
        assert len(data["clusters"]) == 1

        cluster = data["clusters"][0]
        assert cluster["dbClusterIdentifier"] == "test-cluster-1"
        assert cluster["engine"] == "aurora-mysql"
        assert cluster["status"] == "available"
        assert cluster["endpoint"] == "test-cluster-1.cluster-cxyz.us-east-1.rds.amazonaws.com"
        assert cluster["readerEndpoint"] == "test-cluster-1.reader-cxyz.us-east-1.rds.amazonaws.com"
        assert cluster["port"] == 3306
        assert len(cluster["dbClusterMembers"]) == 2

    def test_list_clusters_empty(self, mock_rds_client):
        """Test listing DB clusters when none exist."""
        mock_rds_client.describe_db_clusters.return_value = {"DBClusters": []}

        response = client.get("/api/rds/clusters")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["clusters"] == []


class TestGetDBClusterDetail:
    """Tests for GET /api/rds/clusters/{id} endpoint."""

    def test_get_cluster_detail_success(self, mock_rds_client):
        """Test getting DB cluster detail returns correct data."""
        response = client.get("/api/rds/clusters/test-cluster-1")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "cluster" in data
        cluster = data["cluster"]
        assert cluster["dbClusterIdentifier"] == "test-cluster-1"
        assert cluster["endpoint"] == "test-cluster-1.cluster-cxyz.us-east-1.rds.amazonaws.com"
        assert cluster["readerEndpoint"] == "test-cluster-1.reader-cxyz.us-east-1.rds.amazonaws.com"
        assert len(cluster["dbClusterMembers"]) == 2

        # Check cluster members
        members = cluster["dbClusterMembers"]
        writer = next((m for m in members if m["IsClusterWriter"]), None)
        assert writer is not None
        assert writer["DBInstanceIdentifier"] == "test-cluster-1-instance-1"

    def test_get_cluster_detail_not_found(self, mock_rds_client):
        """Test getting non-existent DB cluster returns 404."""
        mock_rds_client.describe_db_clusters.side_effect = Exception("DBClusterNotFound")

        response = client.get("/api/rds/clusters/non-existent")

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestListDBSnapshots:
    """Tests for GET /api/rds/snapshots endpoint."""

    def test_list_snapshots_success(self, mock_rds_client):
        """Test listing DB snapshots returns correct data."""
        response = client.get("/api/rds/snapshots")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "snapshots" in data
        assert len(data["snapshots"]) >= 1

        snapshot = data["snapshots"][0]
        assert snapshot["snapshotIdentifier"] == "test-snapshot-1"
        assert snapshot["snapshotType"] == "automated"
        assert snapshot["status"] == "available"
        assert snapshot["sourceType"] == "instance"

    def test_list_snapshots_by_instance(self, mock_rds_client):
        """Test listing snapshots filtered by instance."""
        response = client.get("/api/rds/snapshots?instance_id=test-db-instance-1")

        assert response.status_code == status.HTTP_200_OK

    def test_list_snapshots_by_cluster(self, mock_rds_client):
        """Test listing snapshots filtered by cluster."""
        response = client.get("/api/rds/snapshots?cluster_id=test-cluster-1")

        assert response.status_code == status.HTTP_200_OK

    def test_list_snapshots_by_type(self, mock_rds_client):
        """Test listing snapshots filtered by type."""
        response = client.get("/api/rds/snapshots?snapshot_type=automated")

        assert response.status_code == status.HTTP_200_OK


class TestListDBParameterGroups:
    """Tests for GET /api/rds/parameter-groups endpoint."""

    def test_list_parameter_groups_all(self, mock_rds_client):
        """Test listing all parameter groups."""
        response = client.get("/api/rds/parameter-groups?source=all")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "parameterGroups" in data
        # Should include both instance and cluster parameter groups
        assert len(data["parameterGroups"]) >= 2

    def test_list_parameter_groups_instance_only(self, mock_rds_client):
        """Test listing only instance parameter groups."""
        response = client.get("/api/rds/parameter-groups?source=instance")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "parameterGroups" in data
        for group in data["parameterGroups"]:
            assert group["source"] == "instance"

    def test_list_parameter_groups_cluster_only(self, mock_rds_client):
        """Test listing only cluster parameter groups."""
        response = client.get("/api/rds/parameter-groups?source=cluster")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "parameterGroups" in data
        for group in data["parameterGroups"]:
            assert group["source"] == "cluster"


class TestGetDBParameterGroupDetail:
    """Tests for GET /api/rds/parameter-groups/{name} endpoint."""

    def test_get_parameter_group_detail_instance(self, mock_rds_client):
        """Test getting instance parameter group detail."""
        response = client.get("/api/rds/parameter-groups/default.mysql8.0?source=instance")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "parameterGroup" in data
        pg = data["parameterGroup"]
        assert pg["name"] == "default.mysql8.0"
        assert pg["source"] == "instance"
        assert len(pg["parameters"]) >= 1

        param = pg["parameters"][0]
        assert "name" in param
        assert "value" in param
        assert "isModifiable" in param

    def test_get_parameter_group_detail_cluster(self, mock_rds_client):
        """Test getting cluster parameter group detail."""
        response = client.get("/api/rds/parameter-groups/default.aurora-mysql8.0?source=cluster")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "parameterGroup" in data
        pg = data["parameterGroup"]
        assert pg["source"] == "cluster"
        assert len(pg["parameters"]) >= 1

    def test_get_parameter_group_detail_not_found(self, mock_rds_client):
        """Test getting non-existent parameter group returns 404."""
        mock_rds_client.describe_db_parameters.side_effect = Exception("DBParameterGroupNotFound")

        response = client.get("/api/rds/parameter-groups/non-existent?source=instance")

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestConnectionInfo:
    """Tests for connection information display."""

    def test_instance_endpoint_format(self, mock_rds_client):
        """Test that instance endpoint is properly formatted."""
        response = client.get("/api/rds/instances")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        for instance in data["instances"]:
            # Endpoint should be a valid hostname
            assert instance["endpoint"]
            assert "." in instance["endpoint"]
            # Port should be a valid port number
            assert isinstance(instance["port"], int)
            assert 1 <= instance["port"] <= 65535

    def test_cluster_endpoint_format(self, mock_rds_client):
        """Test that cluster endpoint is properly formatted."""
        response = client.get("/api/rds/clusters")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        for cluster in data["clusters"]:
            # Endpoint should be a valid hostname
            assert cluster["endpoint"]
            assert "." in cluster["endpoint"]
            # Reader endpoint should also be present
            assert cluster["readerEndpoint"]
