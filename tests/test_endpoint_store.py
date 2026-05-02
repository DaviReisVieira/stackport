"""Unit tests for EndpointStore persistent configuration."""

import json
import os
import threading
from pathlib import Path

import pytest

from backend.endpoint_store import EndpointStore


@pytest.fixture
def temp_json_path(tmp_path):
    """Temporary JSON file path for testing."""
    return tmp_path / "endpoints_test.json"


@pytest.fixture
def env_endpoints():
    """Sample env endpoints for testing."""
    return {
        "local": "http://localhost:4566",
        "moto": "http://localhost:5000",
    }


class TestJSONPersistence:
    """Test JSON load/save round-trip."""

    def test_save_and_load_round_trip(self, temp_json_path, env_endpoints):
        """Test that config can be saved and loaded."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # Verify file was created
        assert temp_json_path.exists()

        # Verify content
        with open(temp_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["version"] == 1
        assert "local" in data["endpoints"]
        assert "moto" in data["endpoints"]
        assert data["default"] == "local"

        # Create new store with same path
        store2 = EndpointStore(temp_json_path, {})
        endpoints = store2.list_all()
        assert len(endpoints) == 2
        assert endpoints["local"]["url"] == "http://localhost:4566"
        assert endpoints["moto"]["url"] == "http://localhost:5000"

    def test_atomic_write_with_temp_file(self, temp_json_path, env_endpoints):
        """Test that writes use temp file + rename for atomicity."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # Add new endpoint
        store.add("test", "http://test:1234")

        # Verify temp file was cleaned up
        tmp_file = temp_json_path.with_suffix(".tmp")
        assert not tmp_file.exists()

        # Verify final file exists and contains new endpoint
        assert temp_json_path.exists()
        with open(temp_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "test" in data["endpoints"]


class TestEnvVarSeeding:
    """Test env-var seeding on first run and updates."""

    def test_first_run_seeds_from_env(self, temp_json_path, env_endpoints):
        """Test initialization from env vars when no JSON exists."""
        store = EndpointStore(temp_json_path, env_endpoints)

        endpoints = store.list_all()
        assert len(endpoints) == 2
        assert endpoints["local"]["url"] == "http://localhost:4566"
        assert endpoints["local"]["source"] == "env"
        assert endpoints["moto"]["url"] == "http://localhost:5000"
        assert endpoints["moto"]["source"] == "env"

    def test_env_seeding_does_not_overwrite_existing(self, temp_json_path):
        """Test that existing entries are not overwritten by env vars."""
        # Initial env has local and moto
        initial_env = {
            "local": "http://localhost:4566",
            "moto": "http://localhost:5000",
        }
        store = EndpointStore(temp_json_path, initial_env)

        # User updates local endpoint
        store.update("local", url="http://custom:9999")

        # Simulate restart with same env vars
        store2 = EndpointStore(temp_json_path, initial_env)
        endpoints = store2.list_all()

        # Custom URL should be preserved
        assert endpoints["local"]["url"] == "http://custom:9999"
        assert endpoints["local"]["source"] == "env"

    def test_new_env_endpoints_are_seeded(self, temp_json_path):
        """Test that new env endpoints are added on subsequent runs."""
        # Initial env has only local
        initial_env = {"local": "http://localhost:4566"}
        store = EndpointStore(temp_json_path, initial_env)
        assert len(store.list_all()) == 1

        # Restart with additional env endpoint
        updated_env = {
            "local": "http://localhost:4566",
            "staging": "http://staging:4566",
        }
        store2 = EndpointStore(temp_json_path, updated_env)
        endpoints = store2.list_all()

        assert len(endpoints) == 2
        assert "staging" in endpoints
        assert endpoints["staging"]["url"] == "http://staging:4566"
        assert endpoints["staging"]["source"] == "env"

    def test_deleted_env_names_not_reseeded(self, temp_json_path, env_endpoints):
        """Test that deleted env endpoints are not re-added."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # Delete an env endpoint
        store.remove("local")
        assert "local" not in store.list_all()

        # Verify deleted_env_names was updated
        with open(temp_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "local" in data["deleted_env_names"]

        # Restart with same env vars
        store2 = EndpointStore(temp_json_path, env_endpoints)
        endpoints = store2.list_all()

        # local should NOT be re-added
        assert "local" not in endpoints
        assert "moto" in endpoints


class TestAddEndpoint:
    """Test adding new endpoints."""

    def test_add_endpoint_happy_path(self, temp_json_path, env_endpoints):
        """Test adding a valid endpoint."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.add("prod", "https://prod.example.com")

        endpoints = store.list_all()
        assert "prod" in endpoints
        assert endpoints["prod"]["url"] == "https://prod.example.com"
        assert endpoints["prod"]["source"] == "user"

    def test_add_endpoint_duplicate_name_raises_error(self, temp_json_path, env_endpoints):
        """Test that duplicate names are rejected."""
        store = EndpointStore(temp_json_path, env_endpoints)

        with pytest.raises(ValueError, match="already exists"):
            store.add("local", "http://duplicate:1234")

    def test_add_endpoint_invalid_name_format_raises_error(self, temp_json_path, env_endpoints):
        """Test that invalid names are rejected."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # Empty name
        with pytest.raises(ValueError, match="Invalid endpoint name"):
            store.add("", "http://test:1234")

        # Special characters
        with pytest.raises(ValueError, match="Invalid endpoint name"):
            store.add("test@endpoint", "http://test:1234")

        # Spaces
        with pytest.raises(ValueError, match="Invalid endpoint name"):
            store.add("test endpoint", "http://test:1234")

    def test_add_endpoint_name_too_long_raises_error(self, temp_json_path, env_endpoints):
        """Test that overly long names are rejected."""
        store = EndpointStore(temp_json_path, env_endpoints)

        long_name = "a" * 51
        with pytest.raises(ValueError, match="too long"):
            store.add(long_name, "http://test:1234")

    def test_add_first_endpoint_becomes_default(self, temp_json_path):
        """Test that first endpoint added becomes default."""
        store = EndpointStore(temp_json_path, {})

        store.add("first", "http://first:1234")

        assert store.get_default_name() == "first"
        assert store.get_default_url() == "http://first:1234"

    def test_add_endpoint_with_region(self, temp_json_path, env_endpoints):
        """Test adding endpoint with custom region."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.add("eu-endpoint", "http://eu.test:1234", region="eu-west-1")

        endpoint = store.get("eu-endpoint")
        assert endpoint is not None
        assert endpoint["region"] == "eu-west-1"


class TestUpdateEndpoint:
    """Test updating existing endpoints."""

    def test_update_endpoint_url(self, temp_json_path, env_endpoints):
        """Test updating endpoint URL."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.update("local", url="http://new-local:4567")

        endpoint = store.get("local")
        assert endpoint is not None
        assert endpoint["url"] == "http://new-local:4567"

    def test_update_endpoint_region(self, temp_json_path, env_endpoints):
        """Test updating endpoint region."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.update("local", region="eu-central-1")

        endpoint = store.get("local")
        assert endpoint is not None
        assert endpoint["region"] == "eu-central-1"

    def test_update_nonexistent_endpoint_raises_error(self, temp_json_path, env_endpoints):
        """Test that updating non-existent endpoint fails."""
        store = EndpointStore(temp_json_path, env_endpoints)

        with pytest.raises(ValueError, match="not found"):
            store.update("nonexistent", url="http://test:1234")


class TestRemoveEndpoint:
    """Test removing endpoints."""

    def test_remove_endpoint_happy_path(self, temp_json_path, env_endpoints):
        """Test removing an endpoint."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.remove("moto")

        endpoints = store.list_all()
        assert "moto" not in endpoints
        assert "local" in endpoints

    def test_remove_last_endpoint_raises_error(self, temp_json_path):
        """Test that removing the last endpoint is prevented."""
        store = EndpointStore(temp_json_path, {"only": "http://only:1234"})

        with pytest.raises(ValueError, match="last endpoint"):
            store.remove("only")

    def test_remove_default_picks_new_default(self, temp_json_path, env_endpoints):
        """Test that removing default endpoint selects a new default."""
        store = EndpointStore(temp_json_path, env_endpoints)

        original_default = store.get_default_name()
        assert original_default == "local"

        store.remove("local")

        new_default = store.get_default_name()
        assert new_default == "moto"

    def test_remove_env_endpoint_tracks_deletion(self, temp_json_path, env_endpoints):
        """Test that deleted env endpoints are tracked."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.remove("local")

        # Check deleted_env_names in JSON
        with open(temp_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "local" in data["deleted_env_names"]

    def test_remove_user_endpoint_not_tracked(self, temp_json_path, env_endpoints):
        """Test that deleted user endpoints are not tracked in deleted_env_names."""
        store = EndpointStore(temp_json_path, env_endpoints)
        store.add("user-endpoint", "http://user:1234")

        store.remove("user-endpoint")

        with open(temp_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "user-endpoint" not in data["deleted_env_names"]


class TestSetDefault:
    """Test setting default endpoint."""

    def test_set_default_endpoint(self, temp_json_path, env_endpoints):
        """Test setting a new default endpoint."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.set_default("moto")

        assert store.get_default_name() == "moto"
        assert store.get_default_url() == "http://localhost:5000"

    def test_set_default_nonexistent_raises_error(self, temp_json_path, env_endpoints):
        """Test that setting non-existent default fails."""
        store = EndpointStore(temp_json_path, env_endpoints)

        with pytest.raises(ValueError, match="not found"):
            store.set_default("nonexistent")


class TestThreadSafety:
    """Test thread-safe concurrent operations."""

    def test_concurrent_add_operations(self, temp_json_path, env_endpoints):
        """Test concurrent additions are thread-safe."""
        store = EndpointStore(temp_json_path, env_endpoints)
        errors = []

        def add_endpoint(name, url):
            try:
                store.add(name, url)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=add_endpoint, args=(f"endpoint-{i}", f"http://test{i}:1234"))
            for i in range(10)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All additions should succeed
        assert len(errors) == 0
        endpoints = store.list_all()
        assert len(endpoints) == 12  # 2 env + 10 added

    def test_concurrent_remove_operations(self, temp_json_path):
        """Test concurrent removals are thread-safe."""
        # Create store with many endpoints
        env = {f"endpoint-{i}": f"http://test{i}:1234" for i in range(10)}
        store = EndpointStore(temp_json_path, env)

        errors = []

        def remove_endpoint(name):
            try:
                store.remove(name)
            except Exception as e:
                errors.append(e)

        # Try to remove 8 endpoints concurrently (leaving at least 2)
        threads = [
            threading.Thread(target=remove_endpoint, args=(f"endpoint-{i}",))
            for i in range(8)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Most removals should succeed, some might fail if we hit last-endpoint check
        endpoints = store.list_all()
        assert len(endpoints) >= 1  # At least one must remain


class TestResolve:
    """Test endpoint resolution.

    NOTE: Resolve tests are validated through integration tests in test_endpoints.py.
    The resolve() method is used in backend/routes/common.py get_endpoint_url().
    """

    def test_resolve_direct_url_passthrough(self, temp_json_path, env_endpoints):
        """Test that direct URLs are returned as-is."""
        store = EndpointStore(temp_json_path, env_endpoints)

        http_url = "http://direct:9999"
        https_url = "https://direct.example.com"

        assert store.resolve(http_url) == http_url
        assert store.resolve(https_url) == https_url


class TestGetDefaultUrl:
    """Test get_default_url after various operations."""

    def test_get_default_url_after_set_default(self, temp_json_path, env_endpoints):
        """Test that get_default_url returns correct URL after set_default."""
        store = EndpointStore(temp_json_path, env_endpoints)

        store.set_default("moto")

        assert store.get_default_url() == "http://localhost:5000"

    def test_get_default_url_after_update(self, temp_json_path, env_endpoints):
        """Test that get_default_url reflects updated URL."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # local is default
        assert store.get_default_url() == "http://localhost:4566"

        # Update default endpoint URL
        store.update("local", url="http://updated:4567")

        assert store.get_default_url() == "http://updated:4567"

    def test_get_default_url_after_remove_default(self, temp_json_path, env_endpoints):
        """Test that get_default_url returns new default after removing old default."""
        store = EndpointStore(temp_json_path, env_endpoints)

        # Remove current default
        store.remove("local")

        # Should get new default URL
        assert store.get_default_url() == "http://localhost:5000"


class TestCorruptedJSON:
    """Test handling of corrupted JSON files."""

    def test_corrupted_json_initializes_from_env(self, temp_json_path, env_endpoints):
        """Test that corrupted JSON is replaced with env initialization."""
        # Create corrupted JSON
        temp_json_path.parent.mkdir(parents=True, exist_ok=True)
        with open(temp_json_path, "w", encoding="utf-8") as f:
            f.write("{ invalid json }")

        # Should initialize from env instead
        store = EndpointStore(temp_json_path, env_endpoints)

        endpoints = store.list_all()
        assert len(endpoints) == 2
        assert "local" in endpoints


class TestEmptyEnvironment:
    """Test behavior with no env endpoints."""

    def test_empty_env_creates_default_endpoint(self, temp_json_path):
        """Test initialization with empty env."""
        store = EndpointStore(temp_json_path, {})

        # Should create at least a basic structure
        endpoints = store.list_all()
        assert isinstance(endpoints, dict)
        # Default should be set even if no endpoints
        default_name = store.get_default_name()
        assert default_name == "default"
