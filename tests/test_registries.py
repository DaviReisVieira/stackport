"""Validate SERVICE_REGISTRY, DESCRIBE_REGISTRY, and _METHOD_KWARGS consistency."""

from backend.routes.resources import DESCRIBE_REGISTRY, _ID_FIELDS
from backend.routes.stats import SERVICE_REGISTRY, _METHOD_KWARGS


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


class TestIdFields:
    def test_id_fields_are_strings(self):
        for field in _ID_FIELDS:
            assert isinstance(field, str) and field

    def test_no_duplicates(self):
        assert len(_ID_FIELDS) == len(set(_ID_FIELDS))
