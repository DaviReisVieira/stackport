"""EC2 service-specific routes."""

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info

router = APIRouter()


def _get_instance_name(tags: list[dict] | None) -> str:
    """Extract Name tag from instance tags."""
    if not tags:
        return ""
    for tag in tags:
        if tag.get("Key") == "Name":
            return tag.get("Value", "")
    return ""


def _flatten_instances(reservations: list[dict]) -> list[dict]:
    """Flatten Reservations structure to flat list of instances."""
    instances = []
    for reservation in reservations:
        instances.extend(reservation.get("Instances", []))
    return instances


def _decode_user_data(encoded: str | None) -> str | None:
    """Decode base64-encoded user data."""
    if not encoded:
        return None
    try:
        return base64.b64decode(encoded).decode("utf-8")
    except Exception:
        return None

def _map_asg_instance(inst: dict) -> dict:
    """Map an Auto Scaling Group instance to a camelCase shape."""
    return {
        "instanceId": inst.get("InstanceId"),
        "instanceType": inst.get("InstanceType"),
        "lifecycleState": inst.get("LifecycleState"),
        "healthStatus": inst.get("HealthStatus"),
        "availabilityZone": inst.get("AvailabilityZone"),
    }


@router.get("/asgs")
def list_autoscaling_groups(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all Auto Scaling Groups with their instances."""
    try:
        client = get_client("autoscaling", **ep.client_kwargs())
        paginator = client.get_paginator("describe_auto_scaling_groups")

        all_groups = []
        for page in paginator.paginate():
            for group in page.get("AutoScalingGroups", []):
                created_time = group.get("CreatedTime")
                instances = group.get("Instances", [])
                all_groups.append(
                    {
                        "autoScalingGroupARN": group["AutoScalingGroupARN"],
                        "autoScalingGroupName": group["AutoScalingGroupName"],
                        "createdTime": created_time.isoformat() if created_time else None,
                        "desiredCapacity": group["DesiredCapacity"],
                        "maxSize": group["MaxSize"],
                        "minSize": group["MinSize"],
                        "availabilityZones": group.get("AvailabilityZones", []),
                        "healthCheckGracePeriod": group.get("HealthCheckGracePeriod", 0),
                        "instanceCount": len(instances),
                        "instances": [_map_asg_instance(i) for i in instances],
                        "loadBalancerNames": group.get("LoadBalancerNames", []),
                        "tags": group.get("Tags", []),
                    }
                )
        return {"auto_scaling_groups": all_groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/instances")
def list_instances(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all EC2 instances with enriched metadata."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        paginator = client.get_paginator("describe_instances")

        all_instances = []
        for page in paginator.paginate():
            instances = _flatten_instances(page.get("Reservations", []))
            for instance in instances:
                all_instances.append(
                    {
                        "instanceId": instance["InstanceId"],
                        "name": _get_instance_name(instance.get("Tags")),
                        "state": instance["State"]["Name"],
                        "instanceType": instance["InstanceType"],
                        "imageId": instance.get("ImageId"),
                        "launchTime": instance.get("LaunchTime").isoformat() if instance.get("LaunchTime") else None,
                        "publicIpAddress": instance.get("PublicIpAddress"),
                        "privateIpAddress": instance.get("PrivateIpAddress"),
                        "vpcId": instance.get("VpcId"),
                        "subnetId": instance.get("SubnetId"),
                        "keyName": instance.get("KeyName"),
                        "platform": instance.get("Platform"),
                        "securityGroups": instance.get("SecurityGroups", []),
                        "tags": instance.get("Tags", []),
                    }
                )

        return {"instances": all_instances}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/instances/{instance_id}")
def get_instance_detail(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get detailed information for a specific instance including user data."""
    try:
        client = get_client("ec2", **ep.client_kwargs())

        # Get instance details
        response = client.describe_instances(InstanceIds=[instance_id])
        reservations = response.get("Reservations", [])

        if not reservations or not reservations[0].get("Instances"):
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")

        instance = reservations[0]["Instances"][0]

        # Try to get user data
        user_data = None
        try:
            user_data_response = client.describe_instance_attribute(
                InstanceId=instance_id, Attribute="userData"
            )
            encoded_data = user_data_response.get("UserData", {}).get("Value")
            user_data = _decode_user_data(encoded_data)
        except Exception:
            # User data may not exist or permission denied
            pass

        return {
            "instance": {
                "instanceId": instance["InstanceId"],
                "name": _get_instance_name(instance.get("Tags")),
                "state": instance["State"]["Name"],
                "stateCode": instance["State"]["Code"],
                "instanceType": instance["InstanceType"],
                "imageId": instance.get("ImageId"),
                "launchTime": instance.get("LaunchTime").isoformat() if instance.get("LaunchTime") else None,
                "publicIpAddress": instance.get("PublicIpAddress"),
                "privateIpAddress": instance.get("PrivateIpAddress"),
                "vpcId": instance.get("VpcId"),
                "subnetId": instance.get("SubnetId"),
                "keyName": instance.get("KeyName"),
                "platform": instance.get("Platform"),
                "securityGroups": instance.get("SecurityGroups", []),
                "networkInterfaces": instance.get("NetworkInterfaces", []),
                "blockDeviceMappings": instance.get("BlockDeviceMappings", []),
                "tags": instance.get("Tags", []),
                "userData": user_data,
            }
        }
    except HTTPException:
        raise
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidInstanceID.NotFound":
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/instances/{instance_id}/start")
def start_instance(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Start a stopped EC2 instance."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.start_instances(InstanceIds=[instance_id])

        starting_instances = response.get("StartingInstances", [])
        if not starting_instances:
            raise HTTPException(status_code=500, detail="No state change returned")

        return {
            "success": True,
            "state": {
                "previous": starting_instances[0]["PreviousState"]["Name"],
                "current": starting_instances[0]["CurrentState"]["Name"],
            },
        }
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidInstanceID.NotFound":
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/instances/{instance_id}/stop")
def stop_instance(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Stop a running EC2 instance."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.stop_instances(InstanceIds=[instance_id])

        stopping_instances = response.get("StoppingInstances", [])
        if not stopping_instances:
            raise HTTPException(status_code=500, detail="No state change returned")

        return {
            "success": True,
            "state": {
                "previous": stopping_instances[0]["PreviousState"]["Name"],
                "current": stopping_instances[0]["CurrentState"]["Name"],
            },
        }
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidInstanceID.NotFound":
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/instances/{instance_id}/reboot")
def reboot_instance(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Reboot an EC2 instance."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        client.reboot_instances(InstanceIds=[instance_id])

        return {"success": True, "message": f"Instance {instance_id} reboot initiated"}
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidInstanceID.NotFound":
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/instances/{instance_id}/terminate")
def terminate_instance(instance_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Terminate an EC2 instance."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.terminate_instances(InstanceIds=[instance_id])

        terminating_instances = response.get("TerminatingInstances", [])
        if not terminating_instances:
            raise HTTPException(status_code=500, detail="No state change returned")

        return {
            "success": True,
            "state": {
                "previous": terminating_instances[0]["PreviousState"]["Name"],
                "current": terminating_instances[0]["CurrentState"]["Name"],
            },
        }
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidInstanceID.NotFound":
            raise HTTPException(status_code=404, detail=f"Instance {instance_id} not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/security-groups")
def list_security_groups(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all security groups with rules."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.describe_security_groups()

        security_groups = []
        for sg in response.get("SecurityGroups", []):
            security_groups.append(
                {
                    "groupId": sg["GroupId"],
                    "groupName": sg["GroupName"],
                    "description": sg.get("Description", ""),
                    "vpcId": sg.get("VpcId"),
                    "ipPermissions": sg.get("IpPermissions", []),
                    "ipPermissionsEgress": sg.get("IpPermissionsEgress", []),
                    "tags": sg.get("Tags", []),
                }
            )

        return {"securityGroups": security_groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _get_rule_id(rule: dict, rule_type: str, idx: int) -> str:
    """Generate a rule ID based on rule properties."""
    return f"{rule_type}-sgrule-{idx:04d}"


def _get_ip_version(ip_range: dict | None, ipv6_range: dict | None) -> str:
    """Determine IP version from rule."""
    if ipv6_range:
        return "IPv6"
    if ip_range:
        cidr = ip_range.get("CidrIp", "")
        return "IPv6" if ":" in cidr else "IPv4"
    return "IPv4"


def _format_port_range(protocol: str, from_port: int | None, to_port: int | None) -> str:
    """Format port range for display."""
    if protocol == "-1" or protocol == "all":
        return "All"
    if from_port is None and to_port is None:
        return "All"
    if from_port is not None and to_port is not None and from_port != to_port:
        return f"{from_port}-{to_port}"
    if from_port is not None:
        return str(from_port)
    return "All"


def _expand_rules(ip_permissions: list[dict], rule_type: str) -> list[dict]:
    """Expand IP permissions into individual rule rows."""
    expanded = []
    rule_idx = 0
    
    for perm in ip_permissions:
        protocol = perm.get("IpProtocol", "tcp")
        from_port = perm.get("FromPort")
        to_port = perm.get("ToPort")
        
        # Normalize protocol display
        if protocol == "-1":
            protocol = "All"
        
        # Expand IPv4 ranges
        for ip_range in perm.get("IpRanges", []):
            expanded.append({
                "ruleId": _get_rule_id(perm, rule_type, rule_idx),
                "ipVersion": "IPv4",
                "type": rule_type.capitalize(),
                "protocol": protocol,
                "portRange": _format_port_range(protocol, from_port, to_port),
                "source": ip_range.get("CidrIp", ""),
                "description": ip_range.get("Description", ""),
            })
            rule_idx += 1
        
        # Expand IPv6 ranges
        for ipv6_range in perm.get("Ipv6Ranges", []):
            expanded.append({
                "ruleId": _get_rule_id(perm, rule_type, rule_idx),
                "ipVersion": "IPv6",
                "type": rule_type.capitalize(),
                "protocol": protocol,
                "portRange": _format_port_range(protocol, from_port, to_port),
                "source": ipv6_range.get("CidrIpv6", ""),
                "description": ipv6_range.get("Description", ""),
            })
            rule_idx += 1
        
        # Expand prefix list IDs
        for prefix_list in perm.get("PrefixListIds", []):
            expanded.append({
                "ruleId": _get_rule_id(perm, rule_type, rule_idx),
                "ipVersion": "IPv4",
                "type": rule_type.capitalize(),
                "protocol": protocol,
                "portRange": _format_port_range(protocol, from_port, to_port),
                "source": prefix_list.get("PrefixListId", ""),
                "description": "",
            })
            rule_idx += 1
        
        # Expand user ID group pairs (security group references)
        for group_pair in perm.get("UserIdGroupPairs", []):
            expanded.append({
                "ruleId": _get_rule_id(perm, rule_type, rule_idx),
                "ipVersion": "IPv4",
                "type": rule_type.capitalize(),
                "protocol": protocol,
                "portRange": _format_port_range(protocol, from_port, to_port),
                "source": group_pair.get("GroupId", "") or group_pair.get("GroupName", ""),
                "description": group_pair.get("Description", ""),
            })
            rule_idx += 1
    
    # If no rules found, return empty list (don't add placeholder)
    return expanded


@router.get("/security-groups/{group_id}/inbound")
def get_security_group_inbound_rules(group_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get inbound rules for a specific security group with detailed rule information."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.describe_security_groups(GroupIds=[group_id])

        if not response.get("SecurityGroups"):
            raise HTTPException(status_code=404, detail=f"Security group {group_id} not found")

        sg = response["SecurityGroups"][0]
        inbound_rules = _expand_rules(sg.get("IpPermissions", []), "inbound")

        return {
            "groupId": group_id,
            "groupName": sg["GroupName"],
            "inboundRules": inbound_rules,
        }
    except HTTPException:
        raise
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidGroupId.NotFound":
            raise HTTPException(status_code=404, detail=f"Security group {group_id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/security-groups/{group_id}/outbound")
def get_security_group_outbound_rules(group_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Get outbound rules for a specific security group with detailed rule information."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.describe_security_groups(GroupIds=[group_id])

        if not response.get("SecurityGroups"):
            raise HTTPException(status_code=404, detail=f"Security group {group_id} not found")

        sg = response["SecurityGroups"][0]
        outbound_rules = _expand_rules(sg.get("IpPermissionsEgress", []), "outbound")

        return {
            "groupId": group_id,
            "groupName": sg["GroupName"],
            "outboundRules": outbound_rules,
        }
    except HTTPException:
        raise
    except client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidGroupId.NotFound":
            raise HTTPException(status_code=404, detail=f"Security group {group_id} not found")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vpcs")
def list_vpcs(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all VPCs with their subnets."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        vpcs_response = client.describe_vpcs()

        vpcs = []
        for vpc in vpcs_response.get("Vpcs", []):
            vpc_id = vpc["VpcId"]

            # Get subnets for this VPC
            subnets_response = client.describe_subnets(
                Filters=[{"Name": "vpc-id", "Values": [vpc_id]}]
            )

            subnets = []
            for subnet in subnets_response.get("Subnets", []):
                subnets.append(
                    {
                        "subnetId": subnet["SubnetId"],
                        "cidrBlock": subnet["CidrBlock"],
                        "availabilityZone": subnet["AvailabilityZone"],
                        "availableIpAddressCount": subnet.get("AvailableIpAddressCount", 0),
                        "state": subnet.get("State"),
                        "tags": subnet.get("Tags", []),
                    }
                )

            vpcs.append(
                {
                    "vpcId": vpc_id,
                    "cidrBlock": vpc["CidrBlock"],
                    "state": vpc.get("State"),
                    "isDefault": vpc.get("IsDefault", False),
                    "tags": vpc.get("Tags", []),
                    "subnets": subnets,
                }
            )

        return {"vpcs": vpcs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/key-pairs")
def list_key_pairs(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List all key pairs."""
    try:
        client = get_client("ec2", **ep.client_kwargs())
        response = client.describe_key_pairs()

        key_pairs = []
        for kp in response.get("KeyPairs", []):
            key_pairs.append(
                {
                    "keyPairId": kp.get("KeyPairId"),
                    "keyName": kp["KeyName"],
                    "keyFingerprint": kp.get("KeyFingerprint"),
                    "keyType": kp.get("KeyType", "rsa"),
                    "tags": kp.get("Tags", []),
                }
            )

        return {"keyPairs": key_pairs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
