"""Persistent endpoint configuration with runtime CRUD.

Endpoints are stored in a JSON file with atomic writes. The store is thread-safe
and supports env-var seeding on first run.
"""

import copy
import json
import logging
import os
import threading
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

_UNSET = object()

# v1: url/region. v2: auth fields. v3: TLS fields.
CONFIG_VERSION = 3

_TLS_DEFAULTS = {"tls_verify": True, "ca_bundle": None}


class EndpointEntry(TypedDict):
    """Single endpoint configuration."""

    url: str | None  # None means real AWS
    source: str  # "env" or "user"
    region: str | None  # Optional per-endpoint region override
    auth_type: str  # "default", "profile", or "credentials"
    auth_profile: str | None  # AWS profile name (when auth_type="profile")
    auth_access_key_id: str | None  # (when auth_type="credentials")
    auth_secret_access_key: str | None  # (when auth_type="credentials")
    tls_verify: bool  # False turns certificate verification off for this endpoint
    ca_bundle: str | None  # CA bundle to trust for this endpoint (e.g. a self-signed emulator)


class EndpointsConfig(TypedDict):
    """JSON file format."""

    version: int
    default: str
    deleted_env_names: list[str]
    endpoints: dict[str, EndpointEntry]


class EndpointStore:
    """Thread-safe, persistent endpoint configuration store."""

    def __init__(self, json_path: Path, env_endpoints: dict[str, str | None], env_urls_are_explicit: bool = False):
        """Initialize the store.

        Args:
            json_path: Path to the persistent JSON file
            env_endpoints: Initial endpoints from STACKPORT_ENDPOINTS env var
            env_urls_are_explicit: True when the environment set the endpoint URLs
                (STACKPORT_ENDPOINTS or AWS_ENDPOINT_URL). Saved env endpoints then
                follow them; otherwise the saved URLs stand, because an unset
                AWS_ENDPOINT_URL means "real AWS" and must not replace an emulator.
        """
        self.json_path = json_path
        self.env_endpoints = env_endpoints
        self.env_urls_are_explicit = env_urls_are_explicit
        # Env endpoints whose URL the environment replaced for this process,
        # mapped to the URL saved on disk, which is what gets written back.
        self._env_url_overrides: dict[str, str | None] = {}
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
                **_TLS_DEFAULTS,
            }

        default_name = next(iter(self.env_endpoints.keys())) if self.env_endpoints else "default"
        self._config = {
            "version": CONFIG_VERSION,
            "default": default_name,
            "deleted_env_names": [],
            "endpoints": endpoints,
        }
        self._save_if_possible()
        logger.info("Initialized endpoints from env: %s", list(self.env_endpoints.keys()))

    def _seed_from_env(self) -> None:
        """Add env endpoints that aren't present and weren't deleted, and update their URLs.

        The UI doesn't let people edit an env endpoint's URL, so the environment
        is its source of truth: starting StackPort with a new AWS_ENDPOINT_URL
        points the ``default`` endpoint at it for as long as this process runs.
        The file keeps the saved URL, so a one-off ``AWS_ENDPOINT_URL=... stackport
        list`` doesn't change what a later plain ``stackport`` uses. Region, auth
        and TLS settings made in the UI are kept.
        """
        if not self._config:
            return
        migrated = self._migrate()
        deleted = set(self._config["deleted_env_names"])
        added = []
        for name, url in self.env_endpoints.items():
            existing = self._config["endpoints"].get(name)
            if existing is not None:
                if self.env_urls_are_explicit and existing.get("source") == "env" and existing.get("url") != url:
                    logger.info("Env endpoint %s points at %s for this run (saved: %s)", name, url, existing.get("url"))
                    self._env_url_overrides[name] = existing.get("url")
                    self._config["endpoints"][name] = {**existing, "url": url}
                continue
            if name not in deleted:
                self._config["endpoints"][name] = {
                    "url": url,
                    "source": "env",
                    "region": None,
                    "auth_type": "default",
                    "auth_profile": None,
                    "auth_access_key_id": None,
                    "auth_secret_access_key": None,
                    **_TLS_DEFAULTS,
                }
                added.append(name)
        if added:
            logger.info("Seeded new env endpoints: %s", added)
        if migrated or added:
            self._save_if_possible()

    def _migrate(self) -> bool:
        """Bring an older config up to CONFIG_VERSION in memory. Returns True if anything changed."""
        if not self._config:
            return False
        version = self._config.get("version", 1)
        if version >= CONFIG_VERSION:
            return False
        for entry in self._config["endpoints"].values():
            # v2: per-endpoint auth
            entry.setdefault("auth_type", "default")
            entry.setdefault("auth_profile", None)
            entry.setdefault("auth_access_key_id", None)
            entry.setdefault("auth_secret_access_key", None)
            # v3: per-endpoint TLS trust
            for key, value in _TLS_DEFAULTS.items():
                entry.setdefault(key, value)
        self._config["version"] = CONFIG_VERSION
        logger.info("Migrated endpoints config from v%s to v%s", version, CONFIG_VERSION)
        return True

    def _save_if_possible(self) -> None:
        """Persist changes StackPort made on its own at startup (migration, env seeding).

        A read-only data directory (a mounted ConfigMap, a ``:ro`` volume) must
        not stop StackPort from starting: the changes still apply in memory.
        """
        try:
            self._save()
        except OSError:
            logger.warning("Couldn't save %s; using the updated endpoints in memory only", self.json_path)

    def _persisted_view(self) -> EndpointsConfig:
        """The config as it should be on disk: env URL overrides are for this process only."""
        if not self._env_url_overrides:
            return self._config
        endpoints = dict(self._config["endpoints"])
        for name, saved_url in self._env_url_overrides.items():
            if name in endpoints:
                endpoints[name] = {**endpoints[name], "url": saved_url}
        return {**self._config, "endpoints": endpoints}

    def _commit(self, before: tuple[EndpointsConfig, dict[str, str | None]]) -> None:
        """Save a change someone asked for; if that fails, undo it in memory and raise."""
        try:
            self._save()
        except OSError:
            self._config, self._env_url_overrides = before
            raise

    def _snapshot(self) -> tuple[EndpointsConfig, dict[str, str | None]]:
        return copy.deepcopy(self._config), dict(self._env_url_overrides)

    def _save(self) -> None:
        """Atomically write config to disk."""
        if not self._config:
            return
        tmp_path = self.json_path.with_suffix(".tmp")
        try:
            self.json_path.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self._persisted_view(), f, indent=2, ensure_ascii=False)
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
        tls_verify: bool = True,
        ca_bundle: str | None = None,
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

            before = self._snapshot()
            self._config["endpoints"][name] = {
                "url": url,
                "source": "user",
                "region": region,
                "auth_type": auth_type,
                "auth_profile": auth_profile,
                "auth_access_key_id": auth_access_key_id,
                "auth_secret_access_key": auth_secret_access_key,
                "tls_verify": tls_verify,
                "ca_bundle": ca_bundle,
            }
            # If this is the first endpoint, make it default
            if len(self._config["endpoints"]) == 1:
                self._config["default"] = name
            self._commit(before)
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
        tls_verify: bool | object = _UNSET,
        ca_bundle: str | None | object = _UNSET,
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
            tls_verify: False turns certificate verification off
            ca_bundle: CA bundle path to trust (None to clear)

        Raises:
            ValueError: If endpoint doesn't exist
        """
        with self._lock:
            if not self._config:
                raise RuntimeError("Config not initialized")
            if name not in self._config["endpoints"]:
                raise ValueError(f"Endpoint '{name}' not found")

            before = self._snapshot()
            # A new dict, so a request reading the entry meanwhile sees the old
            # or the new one, never half of each.
            entry = dict(self._config["endpoints"][name])
            if url is not _UNSET:
                entry["url"] = url  # type: ignore
                # Someone chose this URL: it's no longer the environment's.
                self._env_url_overrides.pop(name, None)
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
            if tls_verify is not _UNSET:
                entry["tls_verify"] = tls_verify  # type: ignore
            if ca_bundle is not _UNSET:
                entry["ca_bundle"] = ca_bundle  # type: ignore

            self._config["endpoints"][name] = entry  # type: ignore[assignment]
            self._commit(before)
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

            before = self._snapshot()
            entry = self._config["endpoints"].pop(name)
            self._env_url_overrides.pop(name, None)
            # Track deleted env endpoints to prevent re-seeding
            if entry["source"] == "env":
                if name not in self._config["deleted_env_names"]:
                    self._config["deleted_env_names"].append(name)

            # If we deleted the default, pick a new one
            if self._config["default"] == name:
                self._config["default"] = next(iter(self._config["endpoints"].keys()))

            self._commit(before)
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

            before = self._snapshot()
            self._config["default"] = name
            self._commit(before)
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
