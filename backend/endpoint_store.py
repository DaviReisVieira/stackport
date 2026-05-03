"""Persistent endpoint configuration with runtime CRUD.

Endpoints are stored in a JSON file with atomic writes. The store is thread-safe
and supports env-var seeding on first run.
"""

import json
import logging
import os
import threading
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

_UNSET = object()


class EndpointEntry(TypedDict):
    """Single endpoint configuration."""

    url: str | None  # None means real AWS
    source: str  # "env" or "user"
    region: str | None  # Optional per-endpoint region override
    auth_type: str  # "default", "profile", or "credentials"
    auth_profile: str | None  # AWS profile name (when auth_type="profile")
    auth_access_key_id: str | None  # (when auth_type="credentials")
    auth_secret_access_key: str | None  # (when auth_type="credentials")


class EndpointsConfig(TypedDict):
    """JSON file format."""

    version: int
    default: str
    deleted_env_names: list[str]
    endpoints: dict[str, EndpointEntry]


class EndpointStore:
    """Thread-safe, persistent endpoint configuration store."""

    def __init__(self, json_path: Path, env_endpoints: dict[str, str | None]):
        """Initialize the store.

        Args:
            json_path: Path to the persistent JSON file
            env_endpoints: Initial endpoints from STACKPORT_ENDPOINTS env var
        """
        self.json_path = json_path
        self.env_endpoints = env_endpoints
        self._lock = threading.RLock()
        self._config: EndpointsConfig | None = None
        self._load_or_initialize()

    def _load_or_initialize(self) -> None:
        """Load existing JSON or initialize from env vars."""
        with self._lock:
            if self.json_path.exists():
                try:
                    with open(self.json_path, "r", encoding="utf-8") as f:
                        self._config = json.load(f)
                    logger.info("Loaded endpoints from %s", self.json_path)
                    # Seed any new env endpoints not already present or deleted
                    self._seed_from_env()
                except (json.JSONDecodeError, OSError) as e:
                    logger.warning("Failed to load %s: %s. Initializing from env.", self.json_path, e)
                    self._initialize_from_env()
            else:
                self._initialize_from_env()

    def _initialize_from_env(self) -> None:
        """Create initial config from env vars."""
        endpoints: dict[str, EndpointEntry] = {}
        for name, url in self.env_endpoints.items():
            endpoints[name] = {
                "url": url,
                "source": "env",
                "region": None,
                "auth_type": "default",
                "auth_profile": None,
                "auth_access_key_id": None,
                "auth_secret_access_key": None,
            }

        default_name = next(iter(self.env_endpoints.keys())) if self.env_endpoints else "default"
        self._config = {
            "version": 2,
            "default": default_name,
            "deleted_env_names": [],
            "endpoints": endpoints,
        }
        self._save()
        logger.info("Initialized endpoints from env: %s", list(self.env_endpoints.keys()))

    def _seed_from_env(self) -> None:
        """Add env endpoints that aren't present and weren't deleted."""
        if not self._config:
            return
        self._migrate_v1_to_v2()
        deleted = set(self._config["deleted_env_names"])
        added = []
        for name, url in self.env_endpoints.items():
            if name not in self._config["endpoints"] and name not in deleted:
                self._config["endpoints"][name] = {
                    "url": url,
                    "source": "env",
                    "region": None,
                    "auth_type": "default",
                    "auth_profile": None,
                    "auth_access_key_id": None,
                    "auth_secret_access_key": None,
                }
                added.append(name)
        if added:
            self._save()
            logger.info("Seeded new env endpoints: %s", added)

    def _migrate_v1_to_v2(self) -> None:
        """Migrate v1 config (no auth fields) to v2."""
        if not self._config or self._config.get("version", 1) >= 2:
            return
        for entry in self._config["endpoints"].values():
            entry.setdefault("auth_type", "default")
            entry.setdefault("auth_profile", None)
            entry.setdefault("auth_access_key_id", None)
            entry.setdefault("auth_secret_access_key", None)
        self._config["version"] = 2
        self._save()
        logger.info("Migrated endpoints config from v1 to v2 (added auth fields)")

    def _save(self) -> None:
        """Atomically write config to disk."""
        if not self._config:
            return
        tmp_path = self.json_path.with_suffix(".tmp")
        try:
            self.json_path.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, self.json_path)
        except OSError as e:
            logger.error("Failed to write %s: %s", self.json_path, e)
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
            raise

    def list_all(self) -> dict[str, EndpointEntry]:
        """Return all endpoints."""
        with self._lock:
            if not self._config:
                return {}
            return dict(self._config["endpoints"])

    def get_default_name(self) -> str:
        """Return the default endpoint name."""
        with self._lock:
            if not self._config or not self._config["endpoints"]:
                return "default"
            return self._config["default"]

    def get_default_url(self) -> str | None:
        """Return the default endpoint URL."""
        with self._lock:
            if not self._config or not self._config["endpoints"]:
                return None
            default_name = self._config["default"]
            entry = self._config["endpoints"].get(default_name)
            return entry["url"] if entry else None

    def get(self, name: str) -> EndpointEntry | None:
        """Get a single endpoint by name."""
        with self._lock:
            if not self._config:
                return None
            return self._config["endpoints"].get(name)

    def add(
        self,
        name: str,
        url: str | None,
        region: str | None = None,
        auth_type: str = "default",
        auth_profile: str | None = None,
        auth_access_key_id: str | None = None,
        auth_secret_access_key: str | None = None,
    ) -> None:
        """Add a new endpoint.

        Raises:
            ValueError: If name already exists or is invalid
        """
        with self._lock:
            if not self._config:
                raise RuntimeError("Config not initialized")
            if name in self._config["endpoints"]:
                raise ValueError(f"Endpoint '{name}' already exists")
            if not name or not name.replace("-", "").replace("_", "").isalnum():
                raise ValueError(f"Invalid endpoint name '{name}'")
            if len(name) > 50:
                raise ValueError(f"Endpoint name too long (max 50): '{name}'")

            self._config["endpoints"][name] = {
                "url": url,
                "source": "user",
                "region": region,
                "auth_type": auth_type,
                "auth_profile": auth_profile,
                "auth_access_key_id": auth_access_key_id,
                "auth_secret_access_key": auth_secret_access_key,
            }
            # If this is the first endpoint, make it default
            if len(self._config["endpoints"]) == 1:
                self._config["default"] = name
            self._save()
            logger.info("Added endpoint: %s → %s", name, url)

    def update(
        self,
        name: str,
        url: str | None | object = _UNSET,
        region: str | None | object = _UNSET,
        auth_type: str | object = _UNSET,
        auth_profile: str | None | object = _UNSET,
        auth_access_key_id: str | None | object = _UNSET,
        auth_secret_access_key: str | None | object = _UNSET,
    ) -> None:
        """Update an existing endpoint.

        Args:
            name: Endpoint name
            url: New URL (None to use real AWS, unset to keep current)
            region: New region (None to clear, unset to keep current)
            auth_type: Auth type ("default", "profile", "credentials")
            auth_profile: AWS profile name
            auth_access_key_id: Access key ID for credentials auth
            auth_secret_access_key: Secret access key for credentials auth

        Raises:
            ValueError: If endpoint doesn't exist
        """
        with self._lock:
            if not self._config:
                raise RuntimeError("Config not initialized")
            if name not in self._config["endpoints"]:
                raise ValueError(f"Endpoint '{name}' not found")

            entry = self._config["endpoints"][name]
            if url is not _UNSET:
                entry["url"] = url  # type: ignore
            if region is not _UNSET:
                entry["region"] = region  # type: ignore
            if auth_type is not _UNSET:
                entry["auth_type"] = auth_type  # type: ignore
            if auth_profile is not _UNSET:
                entry["auth_profile"] = auth_profile  # type: ignore
            if auth_access_key_id is not _UNSET:
                entry["auth_access_key_id"] = auth_access_key_id  # type: ignore
            if auth_secret_access_key is not _UNSET:
                entry["auth_secret_access_key"] = auth_secret_access_key  # type: ignore

            self._save()
            logger.info("Updated endpoint: %s", name)

    def remove(self, name: str) -> None:
        """Remove an endpoint.

        Raises:
            ValueError: If endpoint doesn't exist or is the last one
        """
        with self._lock:
            if not self._config:
                raise RuntimeError("Config not initialized")
            if name not in self._config["endpoints"]:
                raise ValueError(f"Endpoint '{name}' not found")
            if len(self._config["endpoints"]) == 1:
                raise ValueError("Cannot delete the last endpoint")

            entry = self._config["endpoints"].pop(name)
            # Track deleted env endpoints to prevent re-seeding
            if entry["source"] == "env":
                if name not in self._config["deleted_env_names"]:
                    self._config["deleted_env_names"].append(name)

            # If we deleted the default, pick a new one
            if self._config["default"] == name:
                self._config["default"] = next(iter(self._config["endpoints"].keys()))

            self._save()
            logger.info("Removed endpoint: %s", name)

    def set_default(self, name: str) -> None:
        """Set the default endpoint.

        Raises:
            ValueError: If endpoint doesn't exist
        """
        with self._lock:
            if not self._config:
                raise RuntimeError("Config not initialized")
            if name not in self._config["endpoints"]:
                raise ValueError(f"Endpoint '{name}' not found")

            self._config["default"] = name
            self._save()
            logger.info("Set default endpoint: %s", name)

    def resolve(self, endpoint_name_or_url: str | None) -> str | None:
        """Resolve an endpoint name or URL to a URL.

        Args:
            endpoint_name_or_url: Endpoint name, direct URL, or None

        Returns:
            - If None: returns default URL
            - If starts with http:// or https://: returns as-is (direct URL)
            - Otherwise: looks up name and returns URL, or default if not found
        """
        with self._lock:
            if not self._config:
                return None

            # None → default
            if endpoint_name_or_url is None:
                return self.get_default_url()

            # Direct URL passthrough
            if endpoint_name_or_url.startswith("http://") or endpoint_name_or_url.startswith("https://"):
                return endpoint_name_or_url

            # Look up by name
            entry = self._config["endpoints"].get(endpoint_name_or_url)
            if entry:
                return entry["url"]

            # Fallback to default
            return self.get_default_url()

    def resolve_with_region(self, endpoint_name_or_url: str | None) -> tuple[str | None, str | None]:
        """Resolve an endpoint to both URL and region.

        Unlike resolve(), this preserves the endpoint name → region mapping,
        avoiding ambiguity when multiple endpoints share the same URL.

        Returns:
            Tuple of (url, region). Region is None if not set.
        """
        with self._lock:
            if not self._config:
                return None, None

            if endpoint_name_or_url is None:
                default_name = self._config["default"]
                entry = self._config["endpoints"].get(default_name)
                if entry:
                    return entry["url"], entry.get("region")
                return None, None

            if endpoint_name_or_url.startswith("http://") or endpoint_name_or_url.startswith("https://"):
                return endpoint_name_or_url, None

            entry = self._config["endpoints"].get(endpoint_name_or_url)
            if entry:
                return entry["url"], entry.get("region")

            default_name = self._config["default"]
            default_entry = self._config["endpoints"].get(default_name)
            if default_entry:
                return default_entry["url"], default_entry.get("region")
            return None, None

    def resolve_full(self, endpoint_name_or_url: str | None) -> EndpointEntry | None:
        """Resolve an endpoint to the full entry including auth info.

        Returns:
            Full EndpointEntry or None if not found.
        """
        with self._lock:
            if not self._config:
                return None

            if endpoint_name_or_url is None:
                default_name = self._config["default"]
                return self._config["endpoints"].get(default_name)

            if endpoint_name_or_url.startswith("http://") or endpoint_name_or_url.startswith("https://"):
                return None

            entry = self._config["endpoints"].get(endpoint_name_or_url)
            if entry:
                return entry

            default_name = self._config["default"]
            return self._config["endpoints"].get(default_name)

    def get_region_for_url(self, url: str | None) -> str | None:
        """Look up the per-endpoint region for a given URL."""
        with self._lock:
            if not self._config:
                return None
            for entry in self._config["endpoints"].values():
                if entry["url"] == url:
                    return entry.get("region")
            return None
