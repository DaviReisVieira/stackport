"""Validate SERVICE_REGISTRY, DESCRIBE_REGISTRY, and _METHOD_KWARGS consistency."""

import csv
import io
from unittest.mock import MagicMock

import boto3
import botocore.session
import pytest
from click.testing import CliRunner

from backend.cli import cli
from backend.routes.resources import (
    _DESCRIBE_FROM_LISTING,
    _DESCRIBE_KWARGS,
    _ID_FIELDS,
    _PREFERRED_ID_FIELD,
    DESCRIBE_REGISTRY,
    _extract_id,
    _summarize_item,
)
from backend.routes.stats import _GROUPED_ITEMS, _METHOD_KWARGS, _PER_PARENT, SERVICE_REGISTRY


def _registry_methods() -> set[tuple[str, str]]:
    return {(boto3_service, method) for entries in SERVICE_REGISTRY.values() for _, boto3_service, method, _ in entries}


class TestServiceRegistry:
    def test_all_entries_are_4_tuples(self):
        for service, entries in SERVICE_REGISTRY.items():
            for entry in entries:
                assert len(entry) == 4, f"{service}: entry {entry} is not a 4-tuple"
                resource_type, boto3_service, method, response_key = entry
                assert isinstance(resource_type, str) and resource_type
                assert isinstance(boto3_service, str) and boto3_service
                assert isinstance(method, str) and method
                assert isinstance(response_key, str) and response_key

    def test_no_duplicate_resource_types_per_service(self):
        for service, entries in SERVICE_REGISTRY.items():
            types = [e[0] for e in entries]
            assert len(types) == len(set(types)), f"{service} has duplicate resource types"

    def test_expected_services_present(self):
        expected = {"s3", "sqs", "sns", "dynamodb", "lambda", "iam", "ec2", "logs"}
        assert expected.issubset(SERVICE_REGISTRY.keys())

    def test_services_are_keyed_by_the_name_they_sign_requests_with(self):
        # The name emulators route a request by: monitoring for CloudWatch, es for OpenSearch.
        session = botocore.session.get_session()
        keyed_otherwise = {
            service
            for service, entries in SERVICE_REGISTRY.items()
            for _, boto3_service, _, _ in entries
            if session.get_service_model(boto3_service).signing_name != service
        }
        # Step Functions signs as "states"; links and saved favorites use its older key.
        assert keyed_otherwise == {"stepfunctions"}


class TestDescribeRegistry:
    def test_all_entries_are_4_tuples(self):
        for key, entry in DESCRIBE_REGISTRY.items():
            assert len(entry) == 4, f"{key}: entry {entry} is not a 4-tuple"
            boto3_service, method, id_param, response_key = entry
            assert isinstance(boto3_service, str) and boto3_service
            assert isinstance(method, str) and method
            assert isinstance(id_param, str) and id_param
            assert response_key is None or isinstance(response_key, str)

    def test_keys_are_service_type_tuples(self):
        for key in DESCRIBE_REGISTRY:
            assert isinstance(key, tuple) and len(key) == 2
            service, res_type = key
            assert isinstance(service, str) and isinstance(res_type, str)


class TestMethodKwargs:
    def test_keys_reference_valid_methods(self):
        """All _METHOD_KWARGS keys should reference methods that exist in SERVICE_REGISTRY."""
        all_methods = set()
        for entries in SERVICE_REGISTRY.values():
            for _, boto3_service, method, _ in entries:
                all_methods.add((boto3_service, method))

        for key in _METHOD_KWARGS:
            assert key in all_methods, (
                f"_METHOD_KWARGS key {key} not found in SERVICE_REGISTRY methods"
            )

    def test_values_are_dicts(self):
        for key, value in _METHOD_KWARGS.items():
            assert isinstance(value, dict), f"{key}: value is not a dict"


class TestListingQuirks:
    def test_grouped_items_belong_to_registered_list_calls(self):
        assert set(_GROUPED_ITEMS) <= _registry_methods()

    def test_per_parent_calls_and_their_parents_are_registered(self):
        methods = _registry_methods()
        for (boto3_service, method), (parent_method, *_) in _PER_PARENT.items():
            assert (boto3_service, method) in methods
            assert (boto3_service, parent_method) in methods


class TestDetailQuirks:
    def test_keys_are_registered_lookups(self):
        assert set(_DESCRIBE_KWARGS) <= set(DESCRIBE_REGISTRY)
        assert set(_DESCRIBE_FROM_LISTING) <= set(DESCRIBE_REGISTRY)

    def test_lookups_through_the_listing_list_with_the_same_client(self):
        # The detail call's client lists the resource first.
        for (service, resource_type), _fields in _DESCRIBE_FROM_LISTING.items():
            list_service = next(e[1] for e in SERVICE_REGISTRY[service] if e[0] == resource_type)
            assert DESCRIBE_REGISTRY[(service, resource_type)][0] == list_service


class TestIdFields:
    def test_id_fields_are_strings(self):
        for field in _ID_FIELDS:
            assert isinstance(field, str) and field

    def test_no_duplicates(self):
        assert len(_ID_FIELDS) == len(set(_ID_FIELDS))


class TestPreferredIdField:
    @pytest.fixture(params=[
        ("apigateway", "apis", "ApiId", "ApiId"),
        ("iam", "policies", "Arn", "PolicyArn"),
        ("ec2", "subnets", "SubnetId", "SubnetIds"),
        ("ec2", "security_groups", "GroupId", "GroupIds"),
        ("elasticfilesystem", "file_systems", "FileSystemId", "FileSystemId"),
        ("rds", "db_clusters", "DBClusterIdentifier", "DBClusterIdentifier"),
        ("elasticloadbalancing", "load_balancers", "LoadBalancerArn", "LoadBalancerArns"),
        ("cloudformation", "stacks", "StackId", "StackName"),
        ("scheduler", "schedules", "Arn", "Name"),
        ("scheduler", "schedule_groups", "Name", "Name"),
        ("pipes", "pipes", "Name", "Name"),
        ("ses", "configuration_sets", "Name", "ConfigurationSetName"),
        ("ses", "email_templates", "Name", "TemplateName"),
        ("kafka", "clusters", "ClusterArn", "ClusterArn"),
        ("appconfig", "applications", "Id", "ApplicationId"),
        ("servicediscovery", "namespaces", "Id", "Id"),
        ("servicediscovery", "services", "Id", "Id"),
        ("batch", "compute_environments", "computeEnvironmentName", "computeEnvironments"),
        ("batch", "job_queues", "jobQueueName", "jobQueues"),
        ("codepipeline", "pipelines", "name", "name"),
        ("codecommit", "repositories", "repositoryName", "repositoryName"),
        ("es", "domains", "DomainName", "DomainName"),
        ("bedrock", "custom_models", "modelArn", "modelIdentifier"),
        ("cloudtrail", "trails", "TrailARN", "trailNameList"),
        ("xray", "groups", "GroupName", "GroupName"),
        ("verifiedpermissions", "policy_stores", "policyStoreId", "policyStoreId"),
    ], ids=lambda case: f"{case[0]}/{case[1]}")
    def resource_case(self, request):
        service, resource_type, id_field, id_param = request.param
        entry = next(e for e in SERVICE_REGISTRY[service] if e[0] == resource_type)
        _, boto_service, list_method, response_key = entry
        client = boto3.client(
            boto_service, region_name="us-east-1",
            aws_access_key_id="test", aws_secret_access_key="test",
        )
        model = client.meta.service_model
        operation = model.operation_model(client.meta.method_to_api_mapping[list_method])
        shape = operation.output_shape.members[response_key].member
        assert id_field in shape.members
        _, describe_method, registered_param, _ = DESCRIBE_REGISTRY[(service, resource_type)]
        assert registered_param == id_param
        describe = model.operation_model(client.meta.method_to_api_mapping[describe_method])
        assert id_param in describe.input_shape.members

        # Include every member, even optional ones: sparse fixtures hide collisions.
        # Unique field-name markers reveal which field wins; no AWS calls are made.
        item = {field: f"value-of-{field}" for field in shape.members}
        return service, resource_type, list_method, response_key, item, item[id_field]

    def test_list_id_matches_describe_contract(self, resource_case):
        service, resource_type, _, _, item, expected = resource_case
        preferred = _PREFERRED_ID_FIELD.get((service, resource_type))
        assert _extract_id(item, preferred) == expected
        assert _summarize_item(item, preferred)["id"] == expected

    @pytest.mark.parametrize("output", ["table", "csv"])
    def test_cli_list_emits_describe_identifier(self, resource_case, output, monkeypatch):
        service, resource_type, list_method, response_key, item, expected = resource_case
        client = MagicMock()
        # Other resource types listed by the same service are empty.
        for _, _, method, key in SERVICE_REGISTRY[service]:
            getattr(client, method).return_value = {key: []}
        getattr(client, list_method).return_value = {response_key: [item]}
        monkeypatch.setattr("backend.cli.get_client", lambda *args, **kwargs: client)

        result = CliRunner().invoke(cli, ["list", service, "--output", output])
        assert result.exit_code == 0, result.output
        if output == "csv":
            rows = list(csv.DictReader(io.StringIO(result.output)))
            assert len(rows) == 1
            assert rows[0]["resource_type"] == resource_type
            assert rows[0]["resource_id"] == expected
        else:
            assert any(line.startswith(f"  {expected}") for line in result.output.splitlines())
