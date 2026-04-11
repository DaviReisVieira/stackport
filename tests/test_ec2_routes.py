"""Integration tests for EC2 API routes."""

import os

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

NOW = datetime(2024, 6, 1, tzinfo=timezone.utc)


class TestListInstances:
    @patch("backend.routes.ec2.get_client")
    def test_list_instances_empty(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        paginator = MagicMock()
        mock_ec2.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"Reservations": []}]

        resp = client.get("/api/ec2/instances")
        assert resp.status_code == 200
        data = resp.json()
        assert data["instances"] == []

    @patch("backend.routes.ec2.get_client")
    def test_list_instances_with_data(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        paginator = MagicMock()
        mock_ec2.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "Reservations": [
                    {
                        "Instances": [
                            {
                                "InstanceId": "i-1234567890abcdef0",
                                "State": {"Name": "running", "Code": 16},
                                "InstanceType": "t3.micro",
                                "ImageId": "ami-12345678",
                                "LaunchTime": NOW,
                                "PublicIpAddress": "54.1.2.3",
                                "PrivateIpAddress": "10.0.1.5",
                                "VpcId": "vpc-abc123",
                                "SubnetId": "subnet-def456",
                                "KeyName": "my-keypair",
                                "SecurityGroups": [
                                    {"GroupId": "sg-123", "GroupName": "default"}
                                ],
                                "Tags": [{"Key": "Name", "Value": "web-server"}],
                            }
                        ]
                    }
                ]
            }
        ]

        resp = client.get("/api/ec2/instances")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["instances"]) == 1
        assert data["instances"][0]["instanceId"] == "i-1234567890abcdef0"
        assert data["instances"][0]["name"] == "web-server"
        assert data["instances"][0]["state"] == "running"


class TestGetInstanceDetail:
    @patch("backend.routes.ec2.get_client")
    def test_get_instance_detail(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-1234567890abcdef0",
                            "State": {"Name": "running", "Code": 16},
                            "InstanceType": "t3.micro",
                            "ImageId": "ami-12345678",
                            "LaunchTime": NOW,
                            "PublicIpAddress": "54.1.2.3",
                            "PrivateIpAddress": "10.0.1.5",
                            "VpcId": "vpc-abc123",
                            "SubnetId": "subnet-def456",
                            "KeyName": "my-keypair",
                            "SecurityGroups": [{"GroupId": "sg-123", "GroupName": "default"}],
                            "NetworkInterfaces": [],
                            "BlockDeviceMappings": [],
                            "Tags": [{"Key": "Name", "Value": "web-server"}],
                        }
                    ]
                }
            ]
        }
        mock_ec2.describe_instance_attribute.return_value = {
            "UserData": {"Value": "IyEvYmluL2Jhc2gKZWNobyAiSGVsbG8gV29ybGQi"}
        }

        resp = client.get("/api/ec2/instances/i-1234567890abcdef0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["instance"]["instanceId"] == "i-1234567890abcdef0"
        assert data["instance"]["name"] == "web-server"
        assert data["instance"]["userData"] is not None

    @patch("backend.routes.ec2.get_client")
    def test_get_instance_not_found(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_instances.return_value = {"Reservations": []}

        resp = client.get("/api/ec2/instances/i-nonexistent")
        assert resp.status_code == 404


class TestStartInstance:
    @patch("backend.routes.ec2.get_client")
    def test_start_instance(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.start_instances.return_value = {
            "StartingInstances": [
                {
                    "InstanceId": "i-1234567890abcdef0",
                    "PreviousState": {"Name": "stopped", "Code": 80},
                    "CurrentState": {"Name": "pending", "Code": 0},
                }
            ]
        }

        resp = client.post("/api/ec2/instances/i-1234567890abcdef0/start")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["state"]["previous"] == "stopped"
        assert data["state"]["current"] == "pending"


class TestStopInstance:
    @patch("backend.routes.ec2.get_client")
    def test_stop_instance(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.stop_instances.return_value = {
            "StoppingInstances": [
                {
                    "InstanceId": "i-1234567890abcdef0",
                    "PreviousState": {"Name": "running", "Code": 16},
                    "CurrentState": {"Name": "stopping", "Code": 64},
                }
            ]
        }

        resp = client.post("/api/ec2/instances/i-1234567890abcdef0/stop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["state"]["previous"] == "running"
        assert data["state"]["current"] == "stopping"


class TestRebootInstance:
    @patch("backend.routes.ec2.get_client")
    def test_reboot_instance(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2

        resp = client.post("/api/ec2/instances/i-1234567890abcdef0/reboot")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "reboot initiated" in data["message"]


class TestTerminateInstance:
    @patch("backend.routes.ec2.get_client")
    def test_terminate_instance(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.terminate_instances.return_value = {
            "TerminatingInstances": [
                {
                    "InstanceId": "i-1234567890abcdef0",
                    "PreviousState": {"Name": "running", "Code": 16},
                    "CurrentState": {"Name": "shutting-down", "Code": 32},
                }
            ]
        }

        resp = client.post("/api/ec2/instances/i-1234567890abcdef0/terminate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["state"]["previous"] == "running"
        assert data["state"]["current"] == "shutting-down"


class TestListSecurityGroups:
    @patch("backend.routes.ec2.get_client")
    def test_list_security_groups(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "default",
                    "Description": "Default security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 22,
                            "ToPort": 22,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                        }
                    ],
                    "IpPermissionsEgress": [],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["securityGroups"]) == 1
        assert data["securityGroups"][0]["groupId"] == "sg-123456"


class TestListVPCs:
    @patch("backend.routes.ec2.get_client")
    def test_list_vpcs_with_subnets(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_vpcs.return_value = {
            "Vpcs": [
                {
                    "VpcId": "vpc-abc123",
                    "CidrBlock": "10.0.0.0/16",
                    "State": "available",
                    "IsDefault": True,
                    "Tags": [],
                }
            ]
        }
        mock_ec2.describe_subnets.return_value = {
            "Subnets": [
                {
                    "SubnetId": "subnet-def456",
                    "CidrBlock": "10.0.1.0/24",
                    "AvailabilityZone": "us-east-1a",
                    "AvailableIpAddressCount": 250,
                    "State": "available",
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/vpcs")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["vpcs"]) == 1
        assert data["vpcs"][0]["vpcId"] == "vpc-abc123"
        assert len(data["vpcs"][0]["subnets"]) == 1


class TestListKeyPairs:
    @patch("backend.routes.ec2.get_client")
    def test_list_key_pairs(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_key_pairs.return_value = {
            "KeyPairs": [
                {
                    "KeyPairId": "key-123456",
                    "KeyName": "my-keypair",
                    "KeyFingerprint": "aa:bb:cc:dd:ee:ff",
                    "KeyType": "rsa",
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/key-pairs")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["keyPairs"]) == 1
        assert data["keyPairs"][0]["keyName"] == "my-keypair"
