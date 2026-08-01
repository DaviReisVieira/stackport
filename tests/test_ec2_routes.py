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


class TestListAutoscalingGroups:
    @patch("backend.routes.ec2.get_client")
    def test_list_asgs_empty(self, mock_get_client):
        mock_asg = MagicMock()
        mock_get_client.return_value = mock_asg
        paginator = MagicMock()
        mock_asg.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{"AutoScalingGroups": []}]

        resp = client.get("/api/ec2/asgs")
        assert resp.status_code == 200
        data = resp.json()
        assert data["auto_scaling_groups"] == []

    @patch("backend.routes.ec2.get_client")
    def test_list_asgs_with_data(self, mock_get_client):
        mock_asg = MagicMock()
        mock_get_client.return_value = mock_asg
        paginator = MagicMock()
        mock_asg.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            {
                "AutoScalingGroups": [
                    {
                        "AutoScalingGroupARN": "arn:aws:autoscaling:us-east-1:000000000000:autoScalingGroup:uuid:autoScalingGroupName/asg-test",
                        "AutoScalingGroupName": "asg-test",
                        "CreatedTime": NOW,
                        "DesiredCapacity": 2,
                        "MaxSize": 3,
                        "MinSize": 1,
                        "AvailabilityZones": ["us-east-1a"],
                        "HealthCheckGracePeriod": 300,
                        "LoadBalancerNames": ["lb-1"],
                        "Tags": [{"Key": "env", "Value": "dev"}],
                        "Instances": [
                            {
                                "InstanceId": "i-abc123",
                                "InstanceType": "t2.micro",
                                "LifecycleState": "InService",
                                "HealthStatus": "Healthy",
                                "AvailabilityZone": "us-east-1a",
                            }
                        ],
                    }
                ]
            }
        ]

        resp = client.get("/api/ec2/asgs")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["auto_scaling_groups"]) == 1
        asg = data["auto_scaling_groups"][0]
        assert asg["autoScalingGroupName"] == "asg-test"
        assert asg["desiredCapacity"] == 2
        assert asg["createdTime"] == NOW.isoformat()
        assert asg["instanceCount"] == 1
        assert asg["loadBalancerNames"] == ["lb-1"]
        assert "deletionProtection" not in asg
        instance = asg["instances"][0]
        assert instance["instanceId"] == "i-abc123"
        assert instance["lifecycleState"] == "InService"
        assert instance["healthStatus"] == "Healthy"
        assert instance["availabilityZone"] == "us-east-1a"


class TestGetSecurityGroupInboundRules:
    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_inbound_rules(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "web-sg",
                    "Description": "Web security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 80,
                            "ToPort": 80,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "HTTP access"}],
                        },
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 443,
                            "ToPort": 443,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "HTTPS access"}],
                        },
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 22,
                            "ToPort": 22,
                            "IpRanges": [{"CidrIp": "10.0.0.0/8", "Description": "SSH access"}],
                        },
                    ],
                    "IpPermissionsEgress": [],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-123456/inbound")
        assert resp.status_code == 200
        data = resp.json()
        assert data["groupId"] == "sg-123456"
        assert data["groupName"] == "web-sg"
        assert len(data["inboundRules"]) == 3
        rule = data["inboundRules"][0]
        assert rule["ruleId"].startswith("inbound-sgrule-")
        assert rule["protocol"] == "tcp"
        assert rule["portRange"] == "80"
        assert rule["ipVersion"] == "IPv4"
        assert rule["type"] == "Inbound"
        assert rule["source"] == "0.0.0.0/0"
        assert rule["description"] == "HTTP access"

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_inbound_rules_not_found(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {"SecurityGroups": []}

        resp = client.get("/api/ec2/security-groups/sg-nonexistent/inbound")
        assert resp.status_code == 404


class TestGetSecurityGroupOutboundRules:
    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_outbound_rules(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "web-sg",
                    "Description": "Web security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [],
                    "IpPermissionsEgress": [
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 443,
                            "ToPort": 443,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "HTTPS outbound"}],
                        },
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 80,
                            "ToPort": 80,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "HTTP outbound"}],
                        },
                    ],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-123456/outbound")
        assert resp.status_code == 200
        data = resp.json()
        assert data["groupId"] == "sg-123456"
        assert data["groupName"] == "web-sg"
        assert len(data["outboundRules"]) == 2
        rule = data["outboundRules"][0]
        assert rule["ruleId"].startswith("outbound-sgrule-")
        assert rule["protocol"] == "tcp"
        assert rule["portRange"] == "443"
        assert rule["ipVersion"] == "IPv4"
        assert rule["type"] == "Outbound"
        assert rule["source"] == "0.0.0.0/0"
        assert rule["description"] == "HTTPS outbound"

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_outbound_rules_not_found(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {"SecurityGroups": []}

        resp = client.get("/api/ec2/security-groups/sg-nonexistent/outbound")
        assert resp.status_code == 404

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_outbound_rules_empty(self, mock_get_client):
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "empty-sg",
                    "Description": "Empty security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [],
                    "IpPermissionsEgress": [],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-123456/outbound")
        assert resp.status_code == 200
        data = resp.json()
        assert data["groupId"] == "sg-123456"
        assert data["groupName"] == "empty-sg"
        assert len(data["outboundRules"]) == 0


class TestGetSecurityGroupInboundRulesProtocolAll:
    """Test handling of protocol -1 (all traffic)."""

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_inbound_rules_protocol_all(self, mock_get_client):
        """Test that protocol -1 is converted to 'All' and port range shows 'All'."""
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "ecs-tasks-sg",
                    "Description": "ECS tasks security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [
                        {
                            "IpProtocol": "-1",
                            "FromPort": None,
                            "ToPort": None,
                            "IpRanges": [{"CidrIp": "10.1.0.0/16", "Description": "VPC traffic"}],
                        },
                    ],
                    "IpPermissionsEgress": [],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-123456/inbound")
        assert resp.status_code == 200
        data = resp.json()
        assert data["groupId"] == "sg-123456"
        assert data["groupName"] == "ecs-tasks-sg"
        assert len(data["inboundRules"]) == 1
        rule = data["inboundRules"][0]
        assert rule["ruleId"].startswith("inbound-sgrule-")
        assert rule["protocol"] == "All"
        assert rule["portRange"] == "All"
        assert rule["ipVersion"] == "IPv4"
        assert rule["type"] == "Inbound"
        assert rule["source"] == "10.1.0.0/16"
        assert rule["description"] == "VPC traffic"


class TestGetSecurityGroupOutboundRulesProtocolAll:
    """Test handling of protocol -1 (all traffic) for outbound rules."""

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_outbound_rules_protocol_all(self, mock_get_client):
        """Test that protocol -1 is converted to 'All' and port range shows 'All' for outbound."""
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-00220f1150c89205a",
                    "GroupName": "web-saas-development-ecs-tasks-sg",
                    "Description": "ECS tasks security group",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [],
                    "IpPermissionsEgress": [
                        {
                            "IpProtocol": "-1",
                            "FromPort": None,
                            "ToPort": None,
                            "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                        },
                    ],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-00220f1150c89205a/outbound")
        assert resp.status_code == 200
        data = resp.json()
        assert data["groupId"] == "sg-00220f1150c89205a"
        assert data["groupName"] == "web-saas-development-ecs-tasks-sg"
        assert len(data["outboundRules"]) == 1
        rule = data["outboundRules"][0]
        assert rule["ruleId"].startswith("outbound-sgrule-")
        assert rule["protocol"] == "All"
        assert rule["portRange"] == "All"
        assert rule["ipVersion"] == "IPv4"
        assert rule["type"] == "Outbound"
        assert rule["source"] == "0.0.0.0/0"


class TestSecurityGroupRulesPortRanges:
    """Test handling of port ranges."""

    @patch("backend.routes.ec2.get_client")
    def test_get_security_group_port_range(self, mock_get_client):
        """Test that port ranges are formatted correctly."""
        mock_ec2 = MagicMock()
        mock_get_client.return_value = mock_ec2
        mock_ec2.describe_security_groups.return_value = {
            "SecurityGroups": [
                {
                    "GroupId": "sg-123456",
                    "GroupName": "port-range-sg",
                    "Description": "Security group with port range",
                    "VpcId": "vpc-abc123",
                    "IpPermissions": [
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 8000,
                            "ToPort": 9000,
                            "IpRanges": [{"CidrIp": "10.0.0.0/8"}],
                        },
                    ],
                    "IpPermissionsEgress": [],
                    "Tags": [],
                }
            ]
        }

        resp = client.get("/api/ec2/security-groups/sg-123456/inbound")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["inboundRules"]) == 1
        rule = data["inboundRules"][0]
        assert rule["protocol"] == "tcp"
        assert rule["portRange"] == "8000-9000"
        assert rule["source"] == "10.0.0.0/8"
